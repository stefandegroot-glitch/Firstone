// Rasteroperationen auf Float32Array/Uint8Array-Gittern (Zeilen von links oben).

const INF = 1e20;

// Exakte euklidische Distanztransformation (Felzenszwalb & Huttenlocher).
// Liefert für jedes Pixel den Abstand (in Pixeln) zum nächsten Pixel mit mask = 1.
export function edt(mask, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? 0 : INF;

  const pass = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    const meet = (q, p) => ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    for (let q = 1; q < len; q++) {
      let s = meet(q, v[k]);
      while (s <= z[k]) { k--; s = meet(q, v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + f[p];
    }
  };

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    pass(w);
    for (let x = 0; x < w; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}

// Vorzeichenbehaftetes Distanzfeld in Pixeln: negativ innen, positiv außen, 0 auf der Kante.
export function signedDistance(mask, w, h) {
  let any = false, all = true;
  for (let i = 0; i < w * h; i++) { if (mask[i]) any = true; else all = false; }
  const out = new Float32Array(w * h);
  if (!any) return out.fill(1e6);
  if (all) return out.fill(-1e6);
  const toInside = edt(mask, w, h);
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const toOutside = edt(inv, w, h);
  for (let i = 0; i < w * h; i++) {
    out[i] = mask[i] ? -(toOutside[i] - 0.5) : toInside[i] - 0.5;
  }
  return out;
}

export function threshold(field, value) {
  const m = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) m[i] = field[i] <= value ? 1 : 0;
  return m;
}

// Separierbarer Gauß-Weichzeichner (sigma in Pixeln), Ränder werden geklemmt.
export function gaussianBlur(src, w, h, sigma) {
  if (sigma < 0.3) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += kernel[i + r]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        acc += src[row + xx] * kernel[k + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

// Morphologisches Schließen und Öffnen mit Radius r (Pixel): glättet Kanten,
// füllt schmale Spalten und entfernt dünne Ausläufer.
export function smoothMask(mask, w, h, r) {
  if (r < 0.5) return mask;
  let m = threshold(signedDistance(mask, w, h), r);       // dilatieren
  m = threshold(signedDistance(m, w, h), -r);             // erodieren  -> Schließen
  m = threshold(signedDistance(m, w, h), -r);             // erodieren
  return threshold(signedDistance(m, w, h), r);           // dilatieren -> Öffnen
}

// Zusammenhangskomponenten (4er-Nachbarschaft). Liefert Labels und Flächen.
export function labelComponents(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const areas = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = areas.length;
    let sp = 0, area = 0;
    stack[sp++] = start; labels[start] = id;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w, y = (i - x) / w;
      if (x > 0 && mask[i - 1] && labels[i - 1] < 0) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && labels[i + 1] < 0) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && labels[i - w] < 0) { labels[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && labels[i + w] < 0) { labels[i + w] = id; stack[sp++] = i + w; }
    }
    areas.push(area);
  }
  return { labels, areas };
}

export function largestComponent(mask, w, h) {
  const { labels, areas } = labelComponents(mask, w, h);
  if (!areas.length) return mask;
  let best = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[best]) best = i;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = labels[i] === best ? 1 : 0;
  return out;
}

export function removeSmallComponents(mask, w, h, minArea) {
  if (minArea <= 1) return mask;
  const { labels, areas } = labelComponents(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = labels[i] >= 0 && areas[labels[i]] >= minArea ? 1 : 0;
  return out;
}

// Füllt alle Löcher: alles, was vom Rand aus nicht durch Hintergrund erreichbar ist, wird Vordergrund.
export function fillHoles(mask, w, h) {
  const outside = floodFromBorder((i) => !mask[i], w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

// Flutfüllung vom Bildrand über alle Pixel, für die passable(i) gilt.
export function floodFromBorder(passable, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => { if (!seen[i] && passable(i)) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return seen;
}

// Häufigste Farben am Bildrand als Schätzung des Hintergrunds.
export function borderColors(rgba, w, h, maxColors = 4) {
  const bins = new Map();
  const add = (i) => {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  };
  let total = 0;
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); total += 2; }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); total += 2; }
  return [...bins.values()]
    .filter((e) => e.n >= total * 0.04)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
}

// Motiv freistellen: Hintergrund = vom Rand erreichbare Pixel, deren Farbe
// nah an einer der Hintergrundfarben liegt. Transparente PNGs nutzen den Alphakanal.
export function silhouetteMask(rgba, w, h, { tolerance, extraColors = [] }) {
  const n = w * h;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) transparent++;
  let mask;
  if (transparent > n * 0.02) {
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const colors = [...borderColors(rgba, w, h), ...extraColors];
    const tol2 = tolerance * tolerance;
    const isBg = (i) => {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      for (const c of colors) {
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        // leicht gewichtete RGB-Distanz (Grün zählt fürs Auge am stärksten)
        if (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 <= tol2) return true;
      }
      return false;
    };
    const bg = floodFromBorder(isBg, w, h);
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;
  }
  return fillHoles(largestComponent(mask, w, h), w, h);
}

export function luminance(rgba, n) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
    g[i] = l * a + (1 - a); // Transparenz als Weiß
  }
  return g;
}

// Kontrast strecken: 2%- und 98%-Perzentil der Pixel innerhalb der Maske auf 0..1 abbilden.
export function normalizeContrast(gray, mask) {
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < gray.length; i++) {
    if (mask && !mask[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(gray[i] * 255)))]++;
    count++;
  }
  if (!count) return gray;
  const pick = (q) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * count) return v / 255; }
    return 1;
  };
  const lo = pick(0.02), hi = pick(0.98);
  const span = Math.max(hi - lo, 0.05);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(1, (gray[i] - lo) / span));
  return out;
}

// Linienbild für den Stempel: 1 = erhaben (prägt sich als Vertiefung in den Teig).
// style: 'lines' (dunkle Konturen), 'areas' (dunkle Flächen) oder 'both'.
export function lineArt(gray, w, h, { style, detailPx, sensitivity, level }) {
  const fine = gaussianBlur(gray, w, h, detailPx);
  const out = new Uint8Array(w * h);
  if (style !== 'areas') {
    const coarse = gaussianBlur(gray, w, h, detailPx * 2.5);
    const t = 0.11 - sensitivity * 0.1; // Empfindlichkeit 0..1
    for (let i = 0; i < w * h; i++) if (coarse[i] - fine[i] > t) out[i] = 1;
  }
  if (style !== 'lines') {
    for (let i = 0; i < w * h; i++) if (fine[i] < level) out[i] = 1;
  }
  return out;
}

export function mirrorX(field, w, h) {
  const out = new field.constructor(field.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = field[row + w - 1 - x];
  }
  return out;
}
