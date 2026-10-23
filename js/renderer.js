// Baut aus der Fotoreihe das Zeitraffer-Video: Standbild – Morph – Standbild – …
//
// Die Bilder werden nacheinander auf ein Canvas gezeichnet und an eine "Senke" übergeben:
//  - Vorschau: nur im Takt der Bildrate abspielen,
//  - WebCodecs (Standard): jedes Bild mit exaktem Zeitstempel kodieren und als MP4 muxen –
//    unabhängig von der Rechengeschwindigkeit des Geräts und schneller als Echtzeit,
//  - MediaRecorder (Rückfall für ältere Browser): Canvas in Echtzeit aufnehmen.

import { computeFlow, grayFromImageData } from './flow.js';
import { createMorpher } from './morph-gl.js';
import { formatDate, loadImage } from './images.js';
import { ArrayBufferTarget, Muxer } from './vendor/mp4-muxer.mjs';

const FLOW_EDGE = 192; // Auflösung (lange Kante), auf der der Fluss berechnet wird

// [WebCodecs-Codec, Codec-Name für den MP4-Muxer]
const ENCODER_CODECS = [
  ['avc1.640028', 'avc'], // H.264 High, Level 4.0
  ['avc1.4d0028', 'avc'], // H.264 Main, Level 4.0
  ['avc1.42001f', 'avc'], // H.264 Baseline, Level 3.1
  ['vp09.00.40.08', 'vp9'],
  ['av01.0.08M.08', 'av1'],
];

const RECORDER_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function canRecord() {
  return typeof VideoEncoder !== 'undefined' || typeof MediaRecorder !== 'undefined';
}

export function resolveSize(format, firstPhoto) {
  if (format !== 'auto') return format.split('x').map(Number);
  const even = (n) => Math.round(n / 2) * 2;
  const { width = 4, height = 3 } = firstPhoto ?? {};
  const s = 1280 / Math.max(width, height);
  return [even(width * s), even(height * s)];
}

export function estimateDuration(count, { holdSec, transSec }) {
  return count === 0 ? 0 : count * holdSec + (count - 1) * transSec;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const smoothstep = (t) => t * t * (3 - 2 * t);

// Gibt dem Browser kurz die Kontrolle zurück (auch in Hintergrund-Tabs ungedrosselt).
function yieldToBrowser() {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => resolve();
    port2.postMessage(0);
  });
}

function makeClock(fps) {
  const dt = 1000 / fps;
  let next = 0;
  return {
    reset() {
      next = performance.now() + dt;
    },
    async tick() {
      const wait = next - performance.now();
      next += dt;
      if (wait > 0) await sleep(wait);
      else if (wait < -3 * dt) next = performance.now() + dt; // nach Hängern nicht "aufholen"
    },
  };
}

function fitToCanvas(img, w, h, fit) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas;
}

function grayOf(source, fw, fh) {
  const canvas = document.createElement('canvas');
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, fw, fh);
  return grayFromImageData(ctx.getImageData(0, 0, fw, fh));
}

function drawLabel(ctx, text, alpha) {
  if (alpha <= 0.01) return;
  const { width: W, height: H } = ctx.canvas;
  const size = Math.round(Math.min(W, H) * 0.05);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = size * 0.3;
  ctx.fillText(text, size * 0.8, H - size * 0.7);
  ctx.restore();
}

// ---------- Senken ----------

function previewSink(fps) {
  const clock = makeClock(fps);
  return {
    label: 'Vorschau',
    start: () => clock.reset(),
    pause() {},
    resume: () => clock.reset(),
    addFrame: () => clock.tick(),
    finish: async () => null,
    dispose() {},
  };
}

async function encoderSink(canvas, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const { width, height } = canvas;
  const bitrate = Math.round(width * height * fps * 0.15);

  let chosen = null;
  for (const [codec, muxCodec] of ENCODER_CODECS) {
    const config = { codec, width, height, bitrate, framerate: fps };
    const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (support?.supported) {
      chosen = { config, muxCodec };
      break;
    }
  }
  if (!chosen) return null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: chosen.muxCodec, width, height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure(chosen.config);

  let index = 0;
  const frameDuration = 1e6 / fps;
  return {
    label: 'Video wird erstellt',
    start() {},
    pause() {},
    resume() {},
    async addFrame() {
      if (failure) throw failure;
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * frameDuration), duration: Math.round(frameDuration) });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();
      index++;
      while (encoder.encodeQueueSize > 4) await sleep(1);
      await yieldToBrowser();
    },
    async finish() {
      await encoder.flush();
      if (failure) throw failure;
      muxer.finalize();
      return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), mimeType: 'video/mp4' };
    },
    dispose() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}

function recorderSink(canvas, fps) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
    throw new Error('Dieser Browser kann keine Videos erzeugen.');
  }
  const mimeType = RECORDER_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    ...(mimeType && { mimeType }),
    videoBitsPerSecond: Math.round(canvas.width * canvas.height * fps * 0.2),
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const clock = makeClock(fps);

  return {
    label: 'Video wird in Echtzeit aufgenommen (Tab bitte geöffnet lassen)',
    start() {
      recorder.start(1000);
      clock.reset();
    },
    // Während der Flussberechnung pausieren, damit Rechenzeit nicht als Ruckler im Video landet.
    pause: () => recorder.pause(),
    resume() {
      recorder.resume();
      clock.reset();
    },
    addFrame: () => clock.tick(),
    async finish() {
      await clock.tick(); // letztes Bild sicher mit aufnehmen
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      const type = recorder.mimeType || mimeType || 'video/webm';
      return { blob: new Blob(chunks, { type }), mimeType: type };
    },
    dispose() {
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// ---------- Ablauf ----------

/**
 * photos: sortierte Fotos aus der DB.
 * opts: { width, height, fps, holdSec, transSec, strength, showDate, fit }
 * hooks: { canvas, record, onProgress(fraction, text), signal }
 * Liefert bei record=true { blob, mimeType }, sonst null.
 */
export async function renderTimelapse(photos, opts, hooks) {
  const { width: W, height: H, fps, holdSec, transSec, strength, showDate, fit } = opts;
  const { canvas: out, record, onProgress, signal } = hooks;
  if (photos.length === 0) throw new Error('Keine Fotos ausgewählt');

  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  const morpher = createMorpher(W, H);
  const flowScale = FLOW_EDGE / Math.max(W, H);
  const fw = Math.max(16, Math.round(W * flowScale));
  const fh = Math.max(16, Math.round(H * flowScale));

  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const transFrames = photos.length > 1 ? Math.max(1, Math.round(transSec * fps)) : 0;
  const totalFrames = photos.length * holdFrames + (photos.length - 1) * transFrames;
  let frameCount = 0;

  const prepare = async (photo) => {
    const img = await loadImage(photo.blob);
    return { canvas: fitToCanvas(img, W, H, fit), label: formatDate(photo.date) };
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  };

  let cur = await prepare(photos[0]);
  ctx.drawImage(cur.canvas, 0, 0);

  const sink = !record ? previewSink(fps) : (await encoderSink(out, fps)) ?? recorderSink(out, fps);
  const frame = async (index) => {
    checkAbort();
    await sink.addFrame();
    frameCount++;
    onProgress?.(frameCount / totalFrames, `${sink.label} – Foto ${index + 1} von ${photos.length}`);
  };

  try {
    sink.start();
    for (let i = 0; i < photos.length; i++) {
      for (let f = 0; f < holdFrames; f++) {
        ctx.drawImage(cur.canvas, 0, 0);
        if (showDate) drawLabel(ctx, cur.label, 1);
        await frame(i);
      }
      if (i + 1 === photos.length) break;

      sink.pause();
      onProgress?.(frameCount / totalFrames, `${sink.label} – berechne Übergang ${i + 1} → ${i + 2} …`);
      const next = await prepare(photos[i + 1]);
      const flow = strength > 0 ? computeFlow(grayOf(cur.canvas, fw, fh), grayOf(next.canvas, fw, fh), fw, fh) : null;
      morpher.setPair(cur.canvas, next.canvas, flow, fw, fh);
      checkAbort();
      sink.resume();

      for (let k = 1; k <= transFrames; k++) {
        const t = smoothstep(k / (transFrames + 1));
        morpher.draw(t, strength);
        ctx.drawImage(morpher.canvas, 0, 0);
        if (showDate) {
          drawLabel(ctx, cur.label, 1 - t);
          drawLabel(ctx, next.label, t);
        }
        await frame(i);
      }
      cur = next;
    }
    onProgress?.(1, `${sink.label} – wird abgeschlossen …`);
    return await sink.finish();
  } finally {
    sink.dispose();
  }
}
