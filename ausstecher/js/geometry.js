// Vom Skalarfeld zum 3D-Modell: Konturen (Marching Squares), Polygone mit Löchern,
// Extrusion zu geschlossenen Körpern und binärer STL-Export.
import earcut from './vendor/earcut.mjs';

// Segmenttabelle: Ecken tl=8, tr=4, br=2, bl=1 (Bit gesetzt = innen, Feld < 0).
// Kanten: 0 oben, 1 rechts, 2 unten, 3 links. Jede Strecke läuft so,
// dass das Innere (Bildkoordinaten, y nach unten) rechts liegt.
const CASES = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[1, 0]], null, [[2, 0]], [[3, 0]],
  [[0, 3]], [[0, 2]], null, [[0, 1]], [[1, 3]], [[1, 2]], [[2, 3]], [],
];

// Liefert geschlossene Konturen der Region {field < 0} als Arrays [x0,y0,x1,y1,...]
// in Pixelkoordinaten (Pixelmitte = ganzzahlige Koordinate). Außerhalb des Gitters gilt "außen".
export function contours(field, w, h) {
  const W = w + 1; // Zellen von -1..w-1 in x und y
  const H = h + 1;
  const val = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : field[y * w + x]);
  // Kanten-IDs: horizontale Kante (zwischen (x,y) und (x+1,y)) und vertikale (zwischen (x,y) und (x,y+1)),
  // jeweils mit x,y ab -1.
  const hId = (x, y) => (y + 1) * (W + 1) + (x + 1);
  const vOff = (W + 1) * (H + 1);
  const vId = (x, y) => vOff + (y + 1) * (W + 1) + (x + 1);
  const next = new Int32Array(2 * vOff).fill(-1);
  const starts = [];

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const tl = val(cx, cy), tr = val(cx + 1, cy), br = val(cx + 1, cy + 1), bl = val(cx, cy + 1);
      const c = (tl < 0 ? 8 : 0) | (tr < 0 ? 4 : 0) | (br < 0 ? 2 : 0) | (bl < 0 ? 1 : 0);
      if (c === 0 || c === 15) continue;
      let segs = CASES[c];
      if (!segs) {
        const centerInside = (tl + tr + br + bl) / 4 < 0;
        if (c === 5) segs = centerInside ? [[3, 0], [1, 2]] : [[3, 2], [1, 0]];
        else segs = centerInside ? [[0, 1], [2, 3]] : [[0, 3], [2, 1]];
      }
      const ids = [hId(cx, cy), vId(cx + 1, cy), hId(cx, cy + 1), vId(cx, cy)];
      for (const [a, b] of segs) {
        next[ids[a]] = ids[b];
        starts.push(ids[a]);
      }
    }
  }

  const point = (id) => {
    let x, y, a, b, horizontal;
    if (id >= vOff) { const r = id - vOff; x = (r % (W + 1)) - 1; y = Math.floor(r / (W + 1)) - 1; horizontal = false; }
    else { x = (id % (W + 1)) - 1; y = Math.floor(id / (W + 1)) - 1; horizontal = true; }
    a = val(x, y);
    b = horizontal ? val(x + 1, y) : val(x, y + 1);
    const t = a === b ? 0.5 : a / (a - b);
    return horizontal ? [x + t, y] : [x, y + t];
  };

  const loops = [];
  for (const s of starts) {
    if (next[s] < 0) continue;
    const pts = [];
    let id = s;
    while (id >= 0 && next[id] >= 0) {
      const p = point(id);
      pts.push(p[0], p[1]);
      const n = next[id];
      next[id] = -1;
      id = n;
    }
    if (pts.length >= 6) loops.push(pts);
  }
  return loops;
}

// Douglas-Peucker für geschlossene Linienzüge (tol in denselben Einheiten wie die Punkte).
export function simplifyLoop(pts, tol) {
  const n = pts.length / 2;
  if (n < 8) return pts;
  const keep = new Uint8Array(n);
  // Startpunkt und den davon am weitesten entfernten Punkt fest behalten.
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  keep[0] = keep[far] = 1;
  const tol2 = tol * tol;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[2 * a], ay = pts[2 * a + 1];
    const bx = pts[2 * (b % n)], by = pts[2 * (b % n) + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx, ey = py - t * dy;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out.length >= 6 ? out : pts;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

function reverseLoop(pts) {
  const out = new Array(pts.length);
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    out[2 * i] = pts[2 * (n - 1 - i)];
    out[2 * i + 1] = pts[2 * (n - 1 - i) + 1];
  }
  return out;
}

function pointInLoop(x, y, pts) {
  let inside = false;
  for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Feld -> Polygone in mm (y nach oben). Außenringe gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn.
// pixelMm: Kantenlänge eines Pixels; originX/Y: Pixelkoordinate, die auf (0,0) mm fällt.
export function fieldToPolygons(field, w, h, { pixelMm, tolMm = 0.03, minAreaMm2 = 0.05 }) {
  const loops = contours(field, w, h)
    .map((l) => {
      const mm = new Array(l.length);
      for (let i = 0; i < l.length; i += 2) {
        mm[i] = l[i] * pixelMm;
        mm[i + 1] = (h - 1 - l[i + 1]) * pixelMm; // y spiegeln: Bild nach unten -> mm nach oben
      }
      return reverseLoop(simplifyLoop(mm, tolMm));
    })
    .filter((l) => Math.abs(signedArea(l)) >= minAreaMm2);

  // Durch die Konstruktion (Inneres rechts in Bildkoordinaten) laufen Außenringe nach dem
  // Spiegeln der y-Achse im Uhrzeigersinn; umgedreht haben sie positive Fläche, Löcher negative.
  const outers = [], holes = [];
  for (const l of loops) (signedArea(l) > 0 ? outers : holes).push(l);
  const polys = outers.map((o) => ({ outer: o, area: signedArea(o), holes: [] }));
  for (const hole of holes) {
    let target = null;
    for (const p of polys) {
      if (pointInLoop(hole[0], hole[1], p.outer) && (!target || p.area < target.area)) target = p;
    }
    if (target) target.holes.push(hole);
  }
  return polys.map(({ outer, holes: hs }) => ({ outer, holes: hs }));
}

// Extrudiert Polygone zwischen z0 und z1. Hängt Dreiecke (je 9 Floats) an tris an.
export function extrude(polys, z0, z1, tris = []) {
  for (const { outer, holes } of polys) {
    const flat = outer.slice();
    const holeIdx = [];
    for (const hl of holes) { holeIdx.push(flat.length / 2); flat.push(...hl); }
    const idx = earcut(flat, holeIdx);
    for (let i = 0; i < idx.length; i += 3) {
      let a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ccw = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1])
        - (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]) > 0;
      if (!ccw) [b, c] = [c, b];
      // Deckel oben (Normale +z) und Boden unten (Normale -z)
      tris.push(flat[2 * a], flat[2 * a + 1], z1, flat[2 * b], flat[2 * b + 1], z1, flat[2 * c], flat[2 * c + 1], z1);
      tris.push(flat[2 * a], flat[2 * a + 1], z0, flat[2 * c], flat[2 * c + 1], z0, flat[2 * b], flat[2 * b + 1], z0);
    }
    for (const ring of [outer, ...holes]) {
      for (let i = 0, n = ring.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
        tris.push(ax, ay, z0, bx, by, z0, bx, by, z1);
        tris.push(ax, ay, z0, bx, by, z1, ax, ay, z1);
      }
    }
  }
  return tris;
}

export function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < min[k]) min[k] = tris[i + k];
      if (tris[i + k] > max[k]) max[k] = tris[i + k];
    }
  }
  return { min, max };
}

export function translate(tris, dx, dy, dz) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    out[i] = tris[i] + dx; out[i + 1] = tris[i + 1] + dy; out[i + 2] = tris[i + 2] + dz;
  }
  return out;
}

export function toBinaryStl(tris, name = 'model') {
  const count = tris.length / 9;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const header = `${name} - erstellt mit Keks-Ausstecher-Generator`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (let k = 0; k < 9; k++) { view.setFloat32(o, tris[t + k], true); o += 4; }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
