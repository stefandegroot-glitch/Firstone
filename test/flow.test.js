import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFlow } from '../js/flow.js';

// Glatte, aber texturierte Testszene (Summe von Sinuswellen + Blobs).
function scene(w, h, ox = 0, oy = 0, gain = 1, bias = 0) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x - ox;
      const Y = y - oy;
      const val = 128 + 50 * Math.sin(X * 0.21) * Math.cos(Y * 0.17) + 40 * Math.sin((X + 2 * Y) * 0.09)
        + 60 * Math.exp(-((X - 60) ** 2 + (Y - 40) ** 2) / 120);
      g[y * w + x] = val * gain + bias;
    }
  }
  return g;
}

function medianFlow(flow, w, h) {
  const us = [];
  const vs = [];
  // Ränder auslassen: dort ist der Inhalt aus dem Bild gewandert.
  for (let y = 16; y < h - 16; y++) {
    for (let x = 16; x < w - 16; x++) {
      us.push(flow[2 * (y * w + x)] * w);
      vs.push(flow[2 * (y * w + x) + 1] * h);
    }
  }
  us.sort((a, b) => a - b);
  vs.sort((a, b) => a - b);
  return [us[us.length >> 1], vs[vs.length >> 1]];
}

test('erkennt eine globale Verschiebung', () => {
  const w = 160;
  const h = 120;
  const flow = computeFlow(scene(w, h), scene(w, h, 7, -4), w, h);
  const [u, v] = medianFlow(flow, w, h);
  assert.ok(Math.abs(u - 7) < 0.75, `u=${u}`);
  assert.ok(Math.abs(v + 4) < 0.75, `v=${v}`);
});

test('ist robust gegen Helligkeitsänderungen', () => {
  const w = 160;
  const h = 120;
  const flow = computeFlow(scene(w, h), scene(w, h, -5, 3, 1, 30), w, h);
  const [u, v] = medianFlow(flow, w, h);
  assert.ok(Math.abs(u + 5) < 0.75, `u=${u}`);
  assert.ok(Math.abs(v - 3) < 0.75, `v=${v}`);
});

test('liefert ~0 bei identischen Bildern', () => {
  const w = 96;
  const h = 64;
  const img = scene(w, h);
  const flow = computeFlow(img, img, w, h);
  const maxAbs = flow.reduce((m, f) => Math.max(m, Math.abs(f)), 0);
  assert.ok(maxAbs < 1e-3, `max=${maxAbs}`);
});

test('ist schnell genug für die Arbeitsauflösung', () => {
  const w = 192;
  const h = 108;
  const t0 = performance.now();
  computeFlow(scene(w, h), scene(w, h, 3, 2), w, h);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
  console.log(`computeFlow ${w}x${h}: ${ms.toFixed(0)} ms`);
});
