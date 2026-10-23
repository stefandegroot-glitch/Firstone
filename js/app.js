import * as db from './db.js';
import { formatDate, processImage, readExifDate, toISODate } from './images.js';
import { canRecord, estimateDuration, renderTimelapse, resolveSize } from './renderer.js';
import { openCamera } from './camera.js';

const $ = (id) => document.getElementById(id);
const form = $('video-form');
const SETTINGS_KEY = 'zr.settings';

let photos = [];
const thumbUrls = new Map();
let abortController = null;
let resultUrl = null;

// ---------- Fotos ----------

async function refresh() {
  photos = await db.getAllPhotos();
  renderStats();
  renderGallery();
  updateSummary();
}

function streak() {
  const days = new Set(photos.map((p) => p.date));
  const d = new Date();
  if (!days.has(toISODate(d))) d.setDate(d.getDate() - 1); // heute zählt erst, wenn fotografiert
  let n = 0;
  while (days.has(toISODate(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function renderStats() {
  const today = toISODate(new Date());
  const hasToday = photos.some((p) => p.date === today);
  const s = streak();
  $('stats').textContent = photos.length
    ? `${photos.length} Fotos · ${formatDate(photos[0].date)} – ${formatDate(photos.at(-1).date)} · 🔥 ${s} ${s === 1 ? 'Tag' : 'Tage'} in Folge`
    : 'Starte deinen Zeitraffer mit dem ersten Foto.';
  $('today-status').textContent = hasToday
    ? '✅ Für heute ist schon ein Foto da. Bis morgen!'
    : '📸 Heute fehlt noch ein Foto.';
}

function renderGallery() {
  const gallery = $('gallery');
  const ids = new Set(photos.map((p) => p.id));
  for (const [id, url] of thumbUrls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
  }
  gallery.replaceChildren(
    ...photos.map((p) => {
      if (!thumbUrls.has(p.id)) thumbUrls.set(p.id, URL.createObjectURL(p.thumb ?? p.blob));
      const btn = document.createElement('button');
      btn.className = 'thumb';
      btn.title = formatDate(p.date);
      const img = document.createElement('img');
      img.src = thumbUrls.get(p.id);
      img.loading = 'lazy';
      img.alt = formatDate(p.date);
      const label = document.createElement('span');
      label.textContent = formatDate(p.date);
      btn.append(img, label);
      btn.onclick = () => editPhoto(p);
      return btn;
    }),
  );
  $('photo-count').textContent = photos.length ? `(${photos.length})` : '';
  $('gallery-empty').hidden = photos.length > 0;
}

async function savePhoto(source, date) {
  const processed = await processImage(source);
  await db.addPhoto({ date, ...processed });
}

async function importFiles(files) {
  const status = $('today-status');
  let done = 0;
  for (const file of files) {
    status.textContent = `Importiere ${++done} von ${files.length} …`;
    try {
      const date = (await readExifDate(file)) ?? toISODate(new Date(file.lastModified || Date.now()));
      await savePhoto(file, date);
    } catch (err) {
      console.error(err);
      alert(`„${file.name}“ konnte nicht importiert werden: ${err.message}`);
    }
  }
  await refresh();
}

function editPhoto(photo) {
  const dialog = $('photo-dialog');
  const img = $('photo-full');
  const url = URL.createObjectURL(photo.blob);
  img.src = url;
  $('photo-date').value = photo.date;
  dialog.onclose = async () => {
    URL.revokeObjectURL(url);
    if (dialog.returnValue === 'save' && $('photo-date').value) {
      await db.updatePhoto(photo.id, { date: $('photo-date').value });
    } else if (dialog.returnValue === 'delete') {
      if (!confirm(`Foto vom ${formatDate(photo.date)} wirklich löschen?`)) return;
      await db.deletePhoto(photo.id);
    } else {
      return;
    }
    await refresh();
  };
  dialog.returnValue = '';
  dialog.showModal();
}

$('file-input').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await importFiles(files);
};

$('btn-camera').onclick = async () => {
  try {
    const blob = await openCamera({ ghostBlob: photos.at(-1)?.blob });
    if (!blob) return;
    await savePhoto(blob, toISODate(new Date()));
    await refresh();
  } catch (err) {
    console.error(err);
    alert(`Kamera konnte nicht gestartet werden: ${err.message}\nDu kannst Fotos stattdessen importieren.`);
  }
};

// ---------- Video ----------

function readSettings() {
  const f = new FormData(form);
  return {
    format: f.get('format'),
    fit: f.get('fit'),
    holdSec: Number(f.get('holdSec')),
    transSec: Number(f.get('transSec')),
    strength: Number(f.get('strength')),
    fps: Number(f.get('fps')),
    from: f.get('from') || '',
    to: f.get('to') || '',
    showDate: f.get('showDate') === 'on',
  };
}

function restoreSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    // Ungültige gespeicherte Einstellungen ignorieren.
  }
  for (const [name, value] of Object.entries(saved)) {
    const el = form.elements[name];
    if (!el || name === 'from' || name === 'to') continue;
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  }
}

function selectedPhotos(s) {
  return photos.filter((p) => (!s.from || p.date >= s.from) && (!s.to || p.date <= s.to));
}

function updateSummary() {
  const s = readSettings();
  form.elements.holdOut.value = `${s.holdSec.toFixed(2)} s`;
  form.elements.transOut.value = `${s.transSec.toFixed(2)} s`;
  form.elements.strengthOut.value = s.strength === 0 ? 'nur überblenden' : `${Math.round(s.strength * 100)} %`;
  const sel = selectedPhotos(s);
  const [w, h] = resolveSize(s.format, sel[0]);
  const secs = estimateDuration(sel.length, s);
  $('video-summary').textContent = sel.length
    ? `${sel.length} Fotos → ca. ${secs.toFixed(1)} s Video in ${w} × ${h}.`
    : 'Keine Fotos im gewählten Zeitraum.';
  $('btn-render').disabled = $('btn-preview').disabled = sel.length === 0 || !!abortController;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Speichern der Einstellungen ist nur Komfort.
  }
}

form.oninput = updateSummary;

async function run(record) {
  const s = readSettings();
  const sel = selectedPhotos(s);
  if (!sel.length) return;
  const [width, height] = resolveSize(s.format, sel[0]);

  abortController = new AbortController();
  $('btn-cancel').hidden = false;
  $('render-area').hidden = false;
  if (record) $('result').hidden = true;
  updateSummary();
  const progress = $('progress');
  const status = $('render-status');

  try {
    const result = await renderTimelapse(sel, { ...s, width, height }, {
      canvas: $('stage'),
      record,
      signal: abortController.signal,
      onProgress: (fraction, text) => {
        progress.value = fraction;
        status.textContent = text;
      },
    });
    if (result) showResult(result);
    status.textContent = record ? 'Fertig!' : 'Vorschau beendet.';
  } catch (err) {
    if (err.name === 'AbortError') {
      status.textContent = 'Abgebrochen.';
    } else {
      console.error(err);
      status.textContent = `Fehler: ${err.message}`;
    }
  } finally {
    abortController = null;
    $('btn-cancel').hidden = true;
    updateSummary();
  }
}

function showResult({ blob, mimeType }) {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(blob);
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const name = `zeitraffer-${toISODate(new Date())}.${ext}`;
  $('result-video').src = resultUrl;
  $('download').href = resultUrl;
  $('download').download = name;
  $('result').hidden = false;
  $('render-area').hidden = true;

  const file = new File([blob], name, { type: blob.type });
  const share = $('btn-share');
  share.hidden = !navigator.canShare?.({ files: [file] });
  share.onclick = () => navigator.share({ files: [file], title: 'Mein Zeitraffer' }).catch(() => {});
}

$('btn-preview').onclick = () => run(false);
$('btn-render').onclick = () => run(true);
$('btn-cancel').onclick = () => abortController?.abort();

// ---------- Start ----------

restoreSettings();
if (!canRecord()) {
  $('btn-render').title = 'Dein Browser kann keine Videos erzeugen.';
}
refresh();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
}
