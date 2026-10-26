// Aus Umriss-Maske und Graustufenfoto (beide im mm-Raster) werden Ausstecher und Stempel.
import {
  signedDistance, gaussianBlur, smoothMask, fillHoles, largestComponent,
  normalizeContrast, lineArt, removeSmallComponents, mirrorX,
} from './raster.js';
import { fieldToPolygons, extrude, bounds, translate } from './geometry.js';

export const DEFAULTS = {
  smoothMm: 1.5,       // Umriss glätten (Radius)
  height: 15,          // Gesamthöhe Ausstecher
  blade: 1.0,          // Wandstärke der Schneide
  rimWidth: 4,         // Breite des Griffrands (ab Schneide-Innenkante)
  rimHeight: 2,        // Höhe des Griffrands
  plate: 3,            // Stärke der Stempelplatte
  relief: 2,           // Höhe des Reliefs
  clearance: 1.0,      // Stempel ist um so viel kleiner als die Innenkante des Ausstechers
  margin: 0.8,         // Abstand Relief -> Stempelrand
  ring: true,          // Randlinie am Stempel
  ringWidth: 1.2,
  art: {
    style: 'lines',    // 'lines' | 'areas' | 'both'
    detailMm: 0.6,     // Weichzeichnung vor der Linienerkennung
    sensitivity: 0.5,  // 0..1
    level: 0.35,       // Helligkeitsschwelle für Flächen
    lineMm: 0.3,       // Linien verbreitern
    minDotMm2: 1.0,    // kleinere Inseln entfernen
    invert: false,
  },
};

// Felder berechnen (für Vorschau und Export). mask/gray: Uint8Array/Float32Array w*h.
export function computeFields({ mask, gray, w, h, pixelMm, smooth, params }) {
  const p = { ...DEFAULTS, ...params, art: { ...DEFAULTS.art, ...(params?.art || {}) } };
  const px = (mm) => mm / pixelMm;

  let shape = mask;
  if (smooth) shape = fillHoles(largestComponent(smoothMask(mask, w, h, px(p.smoothMm)), w, h), w, h);
  const sd = gaussianBlur(signedDistance(shape, w, h), w, h, 0.8);
  for (let i = 0; i < sd.length; i++) sd[i] *= pixelMm;

  const n = w * h;
  const blade = new Float32Array(n);
  const rim = new Float32Array(n);
  const plate = new Float32Array(n);
  const rimW = Math.max(p.rimWidth, p.blade);
  for (let i = 0; i < n; i++) {
    blade[i] = Math.max(-sd[i], sd[i] - p.blade);
    rim[i] = Math.max(-sd[i], sd[i] - rimW);
    plate[i] = sd[i] + p.clearance;
  }

  // Relief: Linienbild nur aus dem Bereich innerhalb des Stempels.
  const inner = new Uint8Array(n);
  for (let i = 0; i < n; i++) inner[i] = sd[i] <= -(p.clearance + p.margin) ? 1 : 0;
  const a = p.art;
  let art = lineArt(normalizeContrast(gray, inner), w, h, {
    style: a.style, detailPx: px(a.detailMm), sensitivity: a.sensitivity, level: a.level,
  });
  if (a.invert) for (let i = 0; i < n; i++) art[i] = art[i] ? 0 : 1;
  for (let i = 0; i < n; i++) art[i] &= inner[i];
  art = removeSmallComponents(art, w, h, a.minDotMm2 / (pixelMm * pixelMm));
  const sdArt = gaussianBlur(signedDistance(art, w, h), w, h, 0.7);

  const relief = new Float32Array(n);
  const ringIn = p.clearance + p.ringWidth;
  for (let i = 0; i < n; i++) {
    let g = Math.max(sdArt[i] * pixelMm - a.lineMm / 2, sd[i] + p.clearance + p.margin);
    if (p.ring) g = Math.min(g, Math.max(sd[i] + p.clearance, -(sd[i] + ringIn)));
    relief[i] = g;
  }
  return { w, h, pixelMm, params: p, sd, blade, rim, plate, relief };
}

// Dreiecksnetze für Ausstecher und Stempel (Stempel gespiegelt, damit der Abdruck seitenrichtig ist).
export function buildMeshes(fields) {
  const { w, h, pixelMm, params: p } = fields;
  const polys = (field) => fieldToPolygons(field, w, h, { pixelMm });

  const cutter = [];
  const rimH = Math.min(p.rimHeight, p.height - 1);
  const hasRim = p.rimWidth > p.blade + 0.05 && rimH > 0;
  if (hasRim) {
    extrude(polys(fields.rim), 0, rimH, cutter);
    extrude(polys(fields.blade), rimH, p.height, cutter);
  } else {
    extrude(polys(fields.blade), 0, p.height, cutter);
  }

  const stamp = [];
  extrude(polys(mirrorX(fields.plate, w, h)), 0, p.plate, stamp);
  extrude(polys(mirrorX(fields.relief, w, h)), p.plate, p.plate + p.relief, stamp);

  return { cutter: center(cutter), stamp: center(stamp) };
}

function center(tris) {
  if (!tris.length) return { tris: new Float32Array(0), size: [0, 0, 0] };
  const { min, max } = bounds(tris);
  const out = translate(tris, -(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]);
  return { tris: out, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
