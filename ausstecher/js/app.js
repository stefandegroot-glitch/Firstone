import { silhouetteMask, luminance } from './raster.js';
import { computeFields, buildMeshes, DEFAULTS } from './model.js';
import { toBinaryStl, translate } from './geometry.js';
import { Viewer } from './viewer.js';

const $ = (id) => document.getElementById(id);
const ANALYSIS_PX = 480;   // Auflösung fürs Freistellen
const GRID_PX = 480;       // Rasterpunkte über die längste Seite des Ausstechers

// ---------- Einstellungen ----------

const SLIDERS = {
  form: [
    { key: 'size', label: 'Größe (längste Seite)', min: 30, max: 150, step: 1, value: 80, unit: 'mm' },
    { key: 'tolerance', label: 'Hintergrund-Toleranz', min: 5, max: 120, step: 1, value: 40, only: 'silhouette' },
    { key: 'smoothMm', label: 'Umriss glätten', min: 0, max: 6, step: 0.1, value: DEFAULTS.smoothMm, unit: 'mm' },
    { key: 'zoom', label: 'Foto-Zoom', min: 0.5, max: 4, step: 0.05, value: 1, unit: '×', only: 'shape' },
    { key: 'panX', label: 'Foto verschieben ↔', min: -0.5, max: 0.5, step: 0.01, value: 0, only: 'shape' },
    { key: 'panY', label: 'Foto verschieben ↕', min: -0.5, max: 0.5, step: 0.01, value: 0, only: 'shape' },
  ],
  art: [
    { key: 'style', label: 'Stil', type: 'select', value: DEFAULTS.art.style,
      options: [['lines', 'Linien (Konturen)'], ['areas', 'Flächen (dunkle Bereiche)'], ['both', 'Linien + Flächen']] },
    { key: 'detailMm', label: 'Detail (Weichzeichnen)', min: 0.2, max: 2.5, step: 0.05, value: DEFAULTS.art.detailMm, unit: 'mm' },
    { key: 'sensitivity', label: 'Linien-Empfindlichkeit', min: 0, max: 1, step: 0.01, value: DEFAULTS.art.sensitivity, only: 'lines' },
    { key: 'level', label: 'Flächen-Schwelle', min: 0, max: 1, step: 0.01, value: DEFAULTS.art.level, only: 'areas' },
    { key: 'lineMm', label: 'Linien verstärken', min: 0, max: 2, step: 0.05, value: DEFAULTS.art.lineMm, unit: 'mm' },
    { key: 'minDotMm2', label: 'Kleine Punkte entfernen', min: 0, max: 15, step: 0.5, value: DEFAULTS.art.minDotMm2, unit: 'mm²' },
    { key: 'invert', label: 'Invertieren', type: 'check', value: DEFAULTS.art.invert },
    { key: 'ring', label: 'Randlinie am Stempel', type: 'check', value: DEFAULTS.ring, group: 'params' },
  ],
  size: [
    { key: 'height', label: 'Höhe Ausstecher', min: 8, max: 30, step: 0.5, value: DEFAULTS.height, unit: 'mm' },
    { key: 'blade', label: 'Wandstärke Schneide', min: 0.6, max: 2.5, step: 0.1, value: DEFAULTS.blade, unit: 'mm' },
    { key: 'rimWidth', label: 'Breite Griffrand', min: 0, max: 10, step: 0.5, value: DEFAULTS.rimWidth, unit: 'mm' },
    { key: 'rimHeight', label: 'Höhe Griffrand', min: 0.6, max: 5, step: 0.2, value: DEFAULTS.rimHeight, unit: 'mm' },
    { key: 'plate', label: 'Stärke Stempelplatte', min: 1.5, max: 8, step: 0.5, value: DEFAULTS.plate, unit: 'mm' },
    { key: 'relief', label: 'Reliefhöhe', min: 0.6, max: 5, step: 0.2, value: DEFAULTS.relief, unit: 'mm' },
    { key: 'clearance', label: 'Spiel Stempel ↔ Ausstecher', min: 0, max: 3, step: 0.1, value: DEFAULTS.clearance, unit: 'mm' },
    { key: 'ringWidth', label: 'Breite Randlinie', min: 0.6, max: 3, step: 0.1, value: DEFAULTS.ringWidth, unit: 'mm' },
  ],
};

const settings = {};
const inputs = {};

function fmt(v, step) {
  const d = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function buildSettings(containerId, list, onChange) {
  const box = $(containerId);
  for (const s of list) {
    settings[s.key] = s.value;
    const label = document.createElement('label');
    if (s.type === 'check') {
      label.className = 'check';
      label.innerHTML = `<input type="checkbox"> ${s.label}`;
      const input = label.querySelector('input');
      input.checked = s.value;
      input.addEventListener('change', () => { settings[s.key] = input.checked; onChange(s.key); });
    } else if (s.type === 'select') {
      label.innerHTML = `<span>${s.label}</span><select>${s.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
      const input = label.querySelector('select');
      input.value = s.value;
      input.addEventListener('change', () => { settings[s.key] = input.value; onChange(s.key); });
    } else {
      label.innerHTML = `<span>${s.label} <output></output></span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}">`;
      const input = label.querySelector('input');
      const out = label.querySelector('output');
      input.value = s.value;
      const show = () => { out.textContent = `${fmt(input.value, s.step)}${s.unit ? ` ${s.unit}` : ''}`; };
      show();
      input.addEventListener('input', () => { settings[s.key] = Number(input.value); show(); onChange(s.key); });
    }
    inputs[s.key] = { label, spec: s };
    box.append(label);
  }
}

function updateVisibility() {
  const silhouette = state.shape === 'silhouette';
  for (const { label, spec } of Object.values(inputs)) {
    let visible = true;
    if (spec.only === 'silhouette') visible = silhouette;
    if (spec.only === 'shape') visible = !silhouette;
    if (spec.only === 'lines') visible = settings.style !== 'areas';
    if (spec.only === 'areas') visible = settings.style !== 'lines';
    label.hidden = !visible;
  }
  $('shape-hint').textContent = silhouette
    ? 'Das Motiv wird vom Hintergrund getrennt. Falls Teile des Hintergrunds mitgenommen werden: in der Vorschau auf den Hintergrund tippen, um diese Farbe auszuschließen, oder die Toleranz erhöhen.'
    : 'Das Foto wird in die Form eingepasst. Mit Zoom und Verschieben den Bildausschnitt wählen.';
}

// ---------- Zustand ----------

const state = {
  image: null,       // ImageBitmap oder Canvas
  name: 'keks',
  shape: 'silhouette',
  extraColors: [],
  analysis: null,    // { rgba, w, h, scale }
  silMask: null,     // gecachte Freistell-Maske { key, mask, bbox }
  grid: null,
  fields: null,
  meshes: null,
};

const viewer = new Viewer($('preview3d'));

// Neu rechnen: kurz verzögert, damit Schieberegler flüssig bleiben.
let timer = 0;
let busy = false;
let pending = false;
function schedule(delay = 120) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!state.image) return;
  if (busy) { pending = true; return; }
  busy = true;
  $('status').textContent = 'berechne …';
  // einen Frame abwarten, damit der Status sichtbar wird
  requestAnimationFrame(() => setTimeout(() => {
    try {
      state.grid = buildGrid();
      const { mask, gray, w, h, pixelMm } = state.grid;
      state.fields = computeFields({ mask, gray, w, h, pixelMm, smooth: true, params: modelParams() });
      drawPreview();
      state.meshes = buildMeshes(state.fields);
      showMeshes();
      $('status').textContent = '';
    } catch (err) {
      console.error(err);
      $('status').textContent = `Fehler: ${err.message}`;
    }
    busy = false;
    if (pending) { pending = false; schedule(0); }
  }, 0));
}

function modelParams() {
  const s = settings;
  return {
    smoothMm: s.smoothMm, height: s.height, blade: s.blade, rimWidth: s.rimWidth, rimHeight: s.rimHeight,
    plate: s.plate, relief: s.relief, clearance: s.clearance, ring: s.ring, ringWidth: s.ringWidth,
    art: {
      style: s.style, detailMm: s.detailMm, sensitivity: s.sensitivity, level: s.level,
      lineMm: s.lineMm, minDotMm2: s.minDotMm2, invert: s.invert,
    },
  };
}

// ---------- Bild -> Raster ----------

function prepareAnalysis() {
  const img = state.image;
  const scale = Math.min(1, ANALYSIS_PX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  state.analysis = { rgba: ctx.getImageData(0, 0, w, h).data, w, h, scale };
  state.silMask = null;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function silhouette() {
  const a = state.analysis;
  const key = `${settings.tolerance}|${state.extraColors.join(';')}`;
  if (state.silMask?.key === key) return state.silMask;
  const mask = silhouetteMask(a.rgba, a.w, a.h, { tolerance: settings.tolerance, extraColors: state.extraColors });
  let x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    if (!mask[y * a.w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bbox = x1 < 0 ? { x: 0, y: 0, w: a.w, h: a.h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (x1 < 0) mask.fill(1);
  // Maske als Bild, damit sie beim Hochskalieren geglättet wird
  const c = makeCanvas(a.w, a.h);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(a.w, a.h);
  for (let i = 0; i < mask.length; i++) { id.data[i * 4 + 3] = mask[i] ? 255 : 0; }
  ctx.putImageData(id, 0, 0);
  state.silMask = { key, canvas: c, bbox };
  return state.silMask;
}

function shapePath(shape, x, y, s) {
  const p = new Path2D();
  const cx = x + s / 2, cy = y + s / 2;
  if (shape === 'circle') p.arc(cx, cy, s / 2, 0, Math.PI * 2);
  else if (shape === 'square') p.roundRect(x, y, s, s, s * 0.12);
  else if (shape === 'heart') {
    const u = s / 100;
    p.moveTo(x + 50 * u, y + 96 * u);
    p.bezierCurveTo(x + 18 * u, y + 72 * u, x, y + 52 * u, x, y + 30 * u);
    p.bezierCurveTo(x, y + 12 * u, x + 13 * u, y + 2 * u, x + 27 * u, y + 2 * u);
    p.bezierCurveTo(x + 38 * u, y + 2 * u, x + 46 * u, y + 9 * u, x + 50 * u, y + 18 * u);
    p.bezierCurveTo(x + 54 * u, y + 9 * u, x + 62 * u, y + 2 * u, x + 73 * u, y + 2 * u);
    p.bezierCurveTo(x + 87 * u, y + 2 * u, x + 100 * u, y + 12 * u, x + 100 * u, y + 30 * u);
    p.bezierCurveTo(x + 100 * u, y + 52 * u, x + 82 * u, y + 72 * u, x + 50 * u, y + 96 * u);
    p.closePath();
  } else if (shape === 'star') {
    const R = s / 2, r = R * 0.5;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r : R;
      const px = cx + rr * Math.cos(a), py = cy + 0.05 * s + rr * Math.sin(a);
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    }
    p.closePath();
  }
  return p;
}

function buildGrid() {
  const img = state.image;
  const s = settings;
  const pixelMm = Math.max(0.1, s.size / GRID_PX);
  const padPx = Math.ceil((Math.max(s.rimWidth, s.blade) + 3) / pixelMm);
  const contentPx = s.size / pixelMm;
  let w, h, drawPhoto, drawMask, toImage;

  if (state.shape === 'silhouette') {
    const sil = silhouette();
    const a = state.analysis;
    const k = contentPx / Math.max(sil.bbox.w, sil.bbox.h); // Rasterpixel pro Analysepixel
    w = Math.ceil(sil.bbox.w * k) + 2 * padPx;
    h = Math.ceil(sil.bbox.h * k) + 2 * padPx;
    const ox = padPx - sil.bbox.x * k, oy = padPx - sil.bbox.y * k;
    drawPhoto = (ctx) => { ctx.setTransform(k * a.scale, 0, 0, k * a.scale, ox, oy); ctx.drawImage(img, 0, 0); };
    drawMask = (ctx) => { ctx.setTransform(k, 0, 0, k, ox, oy); ctx.drawImage(sil.canvas, 0, 0); };
    toImage = (gx, gy) => [(gx - ox) / (k * a.scale), (gy - oy) / (k * a.scale)];
  } else {
    w = h = Math.ceil(contentPx) + 2 * padPx;
    const cover = Math.max(contentPx / img.width, contentPx / img.height) * s.zoom;
    const ox = padPx + contentPx / 2 - (img.width * cover) / 2 + s.panX * contentPx;
    const oy = padPx + contentPx / 2 - (img.height * cover) / 2 + s.panY * contentPx;
    drawPhoto = (ctx) => { ctx.setTransform(cover, 0, 0, cover, ox, oy); ctx.drawImage(img, 0, 0); };
    drawMask = (ctx) => { ctx.fillStyle = '#000'; ctx.fill(shapePath(state.shape, padPx, padPx, contentPx)); };
    toImage = null;
  }

  const photo = makeCanvas(w, h);
  const pctx = photo.getContext('2d', { willReadFrequently: true });
  pctx.fillStyle = '#fff';
  pctx.fillRect(0, 0, w, h);
  pctx.imageSmoothingQuality = 'high';
  drawPhoto(pctx);
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  const gray = luminance(pctx.getImageData(0, 0, w, h).data, w * h);

  const mc = makeCanvas(w, h);
  const mctx = mc.getContext('2d', { willReadFrequently: true });
  drawMask(mctx);
  const md = mctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = md[i * 4 + 3] >= 128 ? 1 : 0;

  return { w, h, pixelMm, mask, gray, photo, toImage };
}

// ---------- Vorschau ----------

function cssColor(name) {
  const c = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = c.match(/^#?([0-9a-f]{6})$/i);
  const v = m ? parseInt(m[1], 16) : 0x888888;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function drawPreview() {
  const { w, h, blade, rim, plate, relief } = state.fields;
  const canvas = $('preview2d');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  const photo = $('show-photo').checked
    ? state.grid.photo.getContext('2d').getImageData(0, 0, w, h).data : null;
  const cCut = cssColor('--c-cutter'), cRim = cssColor('--c-rim');
  const cPlate = cssColor('--c-plate'), cRelief = cssColor('--c-relief');
  for (let i = 0; i < w * h; i++) {
    let c = null, alpha = 255;
    if (relief[i] < 0) c = cRelief;
    else if (blade[i] < 0) c = cCut;
    else if (plate[i] < 0) { c = cPlate; alpha = photo ? 200 : 255; }
    else if (rim[i] < 0) c = cRim;
    const o = i * 4;
    if (photo && (!c || alpha < 255)) {
      const t = c ? alpha / 255 : 0;
      const l = c ? 1 : 0.45; // Foto außerhalb gedämpft
      out.data[o] = (c ? c[0] * t : 0) + photo[o] * (1 - t) * l;
      out.data[o + 1] = (c ? c[1] * t : 0) + photo[o + 1] * (1 - t) * l;
      out.data[o + 2] = (c ? c[2] * t : 0) + photo[o + 2] * (1 - t) * l;
      out.data[o + 3] = c ? 255 : 160;
    } else if (c) {
      out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function showMeshes() {
  const { cutter, stamp } = state.meshes;
  const gap = 8;
  const shift = (cutter.size[0] + stamp.size[0]) / 4 + gap / 2;
  viewer.setItems([
    { tris: cutter.tris, color: [0.62, 0.66, 0.74], offset: [-shift, 0, 0] },
    { tris: stamp.tris, color: [0.86, 0.66, 0.4], offset: [shift, 0, 0] },
  ]);
  const mm = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const dim = (m) => `${mm(m.size[0])} × ${mm(m.size[1])} × ${mm(m.size[2])} mm`;
  const tri = (m) => (m.tris.length / 9).toLocaleString('de-DE');
  $('dims').textContent = `Ausstecher: ${dim(cutter)} (${tri(cutter)} Dreiecke) · Stempel: ${dim(stamp)} (${tri(stamp)} Dreiecke)`;
}

// ---------- Download ----------

function download(tris, suffix) {
  const blob = new Blob([toBinaryStl(tris, `${state.name}-${suffix}`)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.name}-${suffix}.stl`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('dl-cutter').addEventListener('click', () => state.meshes && download(state.meshes.cutter.tris, 'ausstecher'));
$('dl-stamp').addEventListener('click', () => state.meshes && download(state.meshes.stamp.tris, 'stempel'));
$('dl-both').addEventListener('click', () => {
  if (!state.meshes) return;
  const { cutter, stamp } = state.meshes;
  const dx = (cutter.size[0] + stamp.size[0]) / 2 + 8;
  const a = translate(cutter.tris, -dx / 2, 0, 0);
  const b = translate(stamp.tris, dx / 2, 0, 0);
  const both = new Float32Array(a.length + b.length);
  both.set(a); both.set(b, a.length);
  download(both, 'ausstecher-und-stempel');
});

// ---------- Foto laden ----------

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    setImage(bmp, file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'keks');
  } catch (err) {
    alert(`Das Bild konnte nicht geladen werden (${err.message}).`);
  }
}

function setImage(img, name) {
  state.image = img;
  state.name = name;
  state.extraColors = [];
  prepareAnalysis();
  $('workspace').hidden = false;
  viewer.draw();
  schedule(0);
}

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

// Beispiel: gezeichnete Katze vor hellem Hintergrund.
$('demo').addEventListener('click', () => {
  const c = makeCanvas(800, 800);
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 800, 800);
  g.fillStyle = '#e39a52';
  g.beginPath();
  g.moveTo(190, 330); g.lineTo(220, 120); g.lineTo(350, 240);
  g.lineTo(450, 240); g.lineTo(580, 120); g.lineTo(610, 330);
  g.closePath(); g.fill();
  g.beginPath(); g.ellipse(400, 430, 230, 200, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a2412'; g.fillStyle = '#3a2412'; g.lineWidth = 14; g.lineCap = 'round';
  g.beginPath(); g.ellipse(320, 400, 26, 36, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(480, 400, 26, 36, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(380, 470); g.lineTo(420, 470); g.lineTo(400, 495); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(400, 495); g.quadraticCurveTo(390, 540, 350, 530); g.stroke();
  g.beginPath(); g.moveTo(400, 495); g.quadraticCurveTo(410, 540, 450, 530); g.stroke();
  for (const [x1, y1, x2, y2] of [[300, 480, 200, 460], [300, 500, 205, 520], [500, 480, 600, 460], [500, 500, 595, 520]]) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  setImage(c, 'katze');
});

// Tippen auf die Vorschau: Farbe an dieser Stelle zum Hintergrund zählen.
$('preview2d').addEventListener('click', (e) => {
  if (state.shape !== 'silhouette' || !state.grid?.toImage) return;
  const r = e.currentTarget.getBoundingClientRect();
  const { w, h } = state.grid;
  const scale = Math.min(r.width / w, r.height / h);
  const gx = (e.clientX - r.left - (r.width - w * scale) / 2) / scale;
  const gy = (e.clientY - r.top - (r.height - h * scale) / 2) / scale;
  const [ix, iy] = state.grid.toImage(gx, gy);
  const a = state.analysis;
  const ax = Math.round(ix * a.scale), ay = Math.round(iy * a.scale);
  if (ax < 0 || ay < 0 || ax >= a.w || ay >= a.h) return;
  const o = (ay * a.w + ax) * 4;
  state.extraColors.push([a.rgba[o], a.rgba[o + 1], a.rgba[o + 2]]);
  schedule(0);
});

// ---------- Start ----------

const onChange = (key) => {
  if (key === 'style') updateVisibility();
  schedule();
};
buildSettings('form-settings', SLIDERS.form, onChange);
buildSettings('art-settings', SLIDERS.art, onChange);
buildSettings('size-settings', SLIDERS.size, onChange);

$('form-settings').insertAdjacentHTML('beforeend',
  '<div class="row" id="bg-row"><button type="button" id="reset-bg">Hintergrund-Auswahl zurücksetzen</button></div>');
$('reset-bg').addEventListener('click', () => { state.extraColors = []; schedule(0); });

for (const btn of $('shape').querySelectorAll('button')) {
  btn.addEventListener('click', () => {
    state.shape = btn.dataset.shape;
    for (const b of $('shape').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    $('bg-row').hidden = state.shape !== 'silhouette';
    updateVisibility();
    schedule(0);
  });
}
$('show-photo').addEventListener('change', () => state.fields && drawPreview());
updateVisibility();
