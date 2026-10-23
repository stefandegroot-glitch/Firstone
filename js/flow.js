// Dichter optischer Fluss (Bild A -> Bild B) per Pyramiden-Blockmatching.
//
// Ziel ist kein exakter Fluss, sondern ein glattes Bewegungsfeld, das beim
// Überblenden die Bildinhalte aufeinander zuschiebt. Deshalb:
//  - mittelwertfreier SAD-Vergleich (robust gegen Helligkeitsänderungen zwischen Tagen),
//  - Grob-nach-fein über eine Bildpyramide (auch größere Verschiebungen),
//  - Median + konfidenzgewichtete Glättung (texturarme Flächen erben die Bewegung der Umgebung).
// Reines JavaScript ohne DOM, damit es auch in Node testbar ist.

const CONFIDENCE_K = 20; // Varianz, ab der ein Patch als "texturiert" gilt
const PRIOR = 0.05; // zieht Flächen ganz ohne Textur Richtung "keine Bewegung"

export function grayFromImageData({ data, width, height }) {
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

/**
 * Berechnet den Fluss von grayA nach grayB (beide w×h, Werte 0–255).
 * Rückgabe: Float32Array (w*h*2, interleaved u,v) in normierten Koordinaten,
 * d. h. Verschiebung geteilt durch Breite bzw. Höhe.
 */
export function computeFlow(grayA, grayB, w, h, opts = {}) {
  const { radius = 3, search = 2, minSize = 12, smooth = 2, finalSmooth = 4 } = opts;

  const pyrA = [{ d: grayA, w, h }];
  const pyrB = [{ d: grayB, w, h }];
  while (Math.min(pyrA.at(-1).w, pyrA.at(-1).h) >= minSize * 2) {
    pyrA.push(downsample(pyrA.at(-1)));
    pyrB.push(downsample(pyrB.at(-1)));
  }

  let u = null;
  let v = null;
  let pw = 0;
  for (let l = pyrA.length - 1; l >= 0; l--) {
    const A = pyrA[l];
    const B = pyrB[l];
    const n = A.w * A.h;
    let pu = new Float32Array(n);
    let pv = new Float32Array(n);
    if (u) [pu, pv] = upsample(u, v, pw, pyrA[l + 1].h, A.w, A.h);

    const m = match(A, B, pu, pv, radius, search);
    u = median3(m.u, A.w, A.h);
    v = median3(m.v, A.w, A.h);
    [u, v] = regularize(u, v, m.c, A.w, A.h, smooth);
    pw = A.w;
  }

  for (let i = 0; i < 2; i++) {
    u = blur(u, w, h, finalSmooth);
    v = blur(v, w, h, finalSmooth);
  }

  const out = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    out[2 * i] = u[i] / w;
    out[2 * i + 1] = v[i] / h;
  }
  return out;
}

function downsample({ d, w, h }) {
  const nw = w >> 1;
  const nh = h >> 1;
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const r0 = 2 * y * w;
    const r1 = r0 + w;
    for (let x = 0; x < nw; x++) {
      const x0 = 2 * x;
      out[y * nw + x] = 0.25 * (d[r0 + x0] + d[r0 + x0 + 1] + d[r1 + x0] + d[r1 + x0 + 1]);
    }
  }
  return { d: out, w: nw, h: nh };
}

function upsample(u, v, pw, ph, w, h) {
  const nu = new Float32Array(w * h);
  const nv = new Float32Array(w * h);
  const sx = pw / w;
  const sy = ph / h;
  for (let y = 0; y < h; y++) {
    const py = Math.min(ph - 1, Math.floor(y * sy));
    for (let x = 0; x < w; x++) {
      const px = Math.min(pw - 1, Math.floor(x * sx));
      nu[y * w + x] = u[py * pw + px] / sx;
      nv[y * w + x] = v[py * pw + px] / sy;
    }
  }
  return [nu, nv];
}

function match(A, B, pu, pv, r, S) {
  const { w, h } = A;
  const a = A.d;
  const b = B.d;
  const meanA = blur(a, w, h, r);
  const meanB = blur(b, w, h, r);
  const sq = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) sq[i] = a[i] * a[i];
  const meanA2 = blur(sq, w, h, r);

  const u = new Float32Array(w * h);
  const v = new Float32Array(w * h);
  const c = new Float32Array(w * h);
  const side = 2 * S + 1;
  const costs = new Float32Array(side * side);
  const exact = new Uint8Array(side * side);
  const penalty = 0.5 * (2 * r + 1) ** 2;
  const cx = (x) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const cy = (y) => (y < 0 ? 0 : y >= h ? h - 1 : y);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ma = meanA[i];
      const variance = Math.max(0, meanA2[i] - ma * ma);
      c[i] = variance / (variance + CONFIDENCE_K);

      const bu = Math.round(pu[i]);
      const bv = Math.round(pv[i]);
      let best = Infinity;
      let bi = 0;
      for (let dy = -S; dy <= S; dy++) {
        for (let dx = -S; dx <= S; dx++) {
          const tx = x + bu + dx;
          const ty = y + bv + dy;
          const mb = meanB[cy(ty) * w + cx(tx)];
          let cost = penalty * (Math.abs(dx) + Math.abs(dy));
          let j = -r;
          for (; j <= r && cost < best; j++) {
            const rowA = cy(y + j) * w;
            const rowB = cy(ty + j) * w;
            for (let k = -r; k <= r; k++) {
              cost += Math.abs(a[rowA + cx(x + k)] - ma - b[rowB + cx(tx + k)] + mb);
            }
          }
          const ci = (dy + S) * side + (dx + S);
          costs[ci] = cost;
          exact[ci] = j > r ? 1 : 0;
          if (cost < best) {
            best = cost;
            bi = ci;
          }
        }
      }

      const bdx = (bi % side) - S;
      const bdy = Math.floor(bi / side) - S;
      // Subpixel-Verfeinerung per Parabel durch die Nachbarkosten.
      // (Abgebrochene Kandidaten haben nur Untergrenzen als Kosten – dann nicht verfeinern.)
      let sx = 0;
      let sy = 0;
      if (bdx > -S && bdx < S && exact[bi - 1] && exact[bi + 1]) {
        sx = parabola(costs[bi - 1], best, costs[bi + 1]);
      }
      if (bdy > -S && bdy < S && exact[bi - side] && exact[bi + side]) {
        sy = parabola(costs[bi - side], best, costs[bi + side]);
      }
      u[i] = bu + bdx + sx;
      v[i] = bv + bdy + sy;
    }
  }
  return { u, v, c };
}

function parabola(l, m, r) {
  const den = l - 2 * m + r;
  if (!(den > 1e-6)) return 0;
  return Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den)));
}

function median3(src, w, h) {
  const out = new Float32Array(src.length);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let j = -1; j <= 1; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j));
        for (let k = -1; k <= 1; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          win[n++] = src[yy * w + xx];
        }
      }
      win.sort();
      out[y * w + x] = win[4];
    }
  }
  return out;
}

// Normalisierte Faltung: Flussvektoren werden nach Konfidenz gewichtet geglättet.
function regularize(u, v, c, w, h, r) {
  const cu = new Float32Array(u.length);
  const cv = new Float32Array(v.length);
  for (let i = 0; i < u.length; i++) {
    cu[i] = u[i] * c[i];
    cv[i] = v[i] * c[i];
  }
  const bc = blur(c, w, h, r);
  const bu = blur(cu, w, h, r);
  const bv = blur(cv, w, h, r);
  for (let i = 0; i < u.length; i++) {
    const den = bc[i] + PRIOR;
    bu[i] /= den;
    bv[i] /= den;
  }
  return [bu, bv];
}

/** Separabler Boxfilter mit Radius r; am Rand wird über die vorhandenen Pixel gemittelt. */
export function blur(src, w, h, r) {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let s = 0;
      for (let k = x0; k <= x1; k++) s += src[row + k];
      tmp[row + x] = s / (x1 - x0 + 1);
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = y0; k <= y1; k++) s += tmp[k * w + x];
      out[y * w + x] = s / (y1 - y0 + 1);
    }
  }
  return out;
}
