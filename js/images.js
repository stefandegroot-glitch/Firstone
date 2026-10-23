// Bildverarbeitung beim Import: verkleinern, Vorschaubild erzeugen, Aufnahmedatum lesen.

const MAX_EDGE = 2048;
const THUMB_EDGE = 360;

export function toISODate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleToBlob(img, maxEdge, quality) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ blob: b, width: canvas.width, height: canvas.height }) : reject(new Error('Bild konnte nicht kodiert werden'))), 'image/jpeg', quality));
}

/** Liefert { blob, thumb, width, height } – die EXIF-Ausrichtung ist dabei bereits angewendet. */
export async function processImage(source) {
  const img = await loadImage(source);
  const full = await scaleToBlob(img, MAX_EDGE, 0.9);
  const thumb = await scaleToBlob(img, THUMB_EDGE, 0.8);
  return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}

/** Liest DateTimeOriginal (bzw. DateTime) aus einem JPEG und gibt 'YYYY-MM-DD' oder null zurück. */
export async function readExifDate(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) break;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiffDate(v, off + 10);
      off += 2 + len;
    }
  } catch {
    // Unlesbare oder abgeschnittene EXIF-Daten ignorieren.
  }
  return null;
}

function parseTiffDate(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const readIfd = (ifd) => {
    const tags = {};
    const n = u16(ifd);
    for (let i = 0; i < n; i++) tags[u16(ifd + 2 + i * 12)] = ifd + 2 + i * 12;
    return tags;
  };
  const readString = (entry) => {
    const count = u32(entry + 4);
    const o = count > 4 ? u32(entry + 8) : entry + 8;
    let s = '';
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };

  const ifd0 = readIfd(u32(4));
  let raw = null;
  if (ifd0[0x8769]) {
    const exif = readIfd(u32(ifd0[0x8769] + 8));
    if (exif[0x9003]) raw = readString(exif[0x9003]);
  }
  if (!raw && ifd0[0x0132]) raw = readString(ifd0[0x0132]);
  const m = raw && /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
