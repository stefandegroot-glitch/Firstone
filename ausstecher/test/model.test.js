import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edt, signedDistance } from '../js/raster.js';
import { contours, fieldToPolygons, signedArea, extrude, toBinaryStl } from '../js/geometry.js';
import { computeFields, buildMeshes } from '../js/model.js';

function disk(w, h, cx, cy, r) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 1 : 0;
  return m;
}

// Jede gerichtete Kante muss genau einmal in Gegenrichtung vorkommen (geschlossen & konsistent orientiert).
function checkClosed(tris) {
  const key = (i) => `${tris[i].toFixed(4)},${tris[i + 1].toFixed(4)},${tris[i + 2].toFixed(4)}`;
  const edges = new Map();
  for (let t = 0; t < tris.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}|${v[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let bad = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if (edges.get(`${b}|${a}`) !== n) bad++;
  }
  return bad;
}

function volume(tris) {
  let v = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(t, t + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

test('Distanztransformation ist exakt', () => {
  const w = 7, h = 5, m = new Uint8Array(w * h);
  m[2 * w + 3] = 1;
  const d = edt(m, w, h);
  assert.equal(d[2 * w + 3], 0);
  assert.ok(Math.abs(d[0] - Math.hypot(3, 2)) < 1e-6);
  const sd = signedDistance(disk(40, 40, 20, 20, 10), 40, 40);
  assert.ok(sd[20 * 40 + 20] < -8 && sd[0] > 15);
});

test('Kontur einer Kreisscheibe ist ein Außenring mit richtiger Fläche', () => {
  const w = 100, h = 100;
  const sd = signedDistance(disk(w, h, 50, 50, 30), w, h);
  assert.equal(contours(sd, w, h).length, 1);
  const polys = fieldToPolygons(sd, w, h, { pixelMm: 0.5 });
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 0);
  const area = signedArea(polys[0].outer);
  const expected = Math.PI * 15 * 15;
  assert.ok(area > 0 && Math.abs(area - expected) / expected < 0.02, `Fläche ${area}`);
});

test('Ring wird als Polygon mit Loch erkannt und geschlossen extrudiert', () => {
  const w = 100, h = 100;
  const sd = signedDistance(disk(w, h, 50, 50, 30), w, h);
  const ring = sd.map((v) => Math.max(-v - 10, v));
  const polys = fieldToPolygons(ring, w, h, { pixelMm: 1 });
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1);
  const tris = extrude(polys, 0, 5);
  assert.equal(checkClosed(tris), 0);
  const expected = Math.PI * (30 * 30 - 20 * 20) * 5;
  const vol = volume(tris);
  assert.ok(vol > 0 && Math.abs(vol - expected) / expected < 0.03, `Volumen ${vol}`);
});

test('Ausstecher und Stempel sind geschlossene Körper mit erwarteten Maßen', () => {
  const pixelMm = 0.2;
  const w = 500, h = 500; // 100 x 100 mm, Kreis Ø 80 mm
  const mask = disk(w, h, 250, 250, 200);
  const gray = new Float32Array(w * h).fill(1);
  for (let y = 200; y < 300; y++) for (let x = 150; x < 350; x++) gray[y * w + x] = 0.1; // dunkler Balken
  const t0 = performance.now();
  const fields = computeFields({ mask, gray, w, h, pixelMm, smooth: true, params: {} });
  const { cutter, stamp } = buildMeshes(fields);
  const ms = performance.now() - t0;
  assert.equal(checkClosed(cutter.tris), 0);
  assert.equal(checkClosed(stamp.tris), 0);
  assert.ok(volume(cutter.tris) > 0 && volume(stamp.tris) > 0);
  // Ausstecher: Ø 80 + 2 * Griffrand 4 mm = 88 mm, Höhe 15 mm
  assert.ok(Math.abs(cutter.size[0] - 88) < 0.6, `Breite ${cutter.size[0]}`);
  assert.ok(Math.abs(cutter.size[2] - 15) < 1e-4);
  // Stempel: Ø 80 - 2 * 1 mm Spiel = 78 mm, Höhe 3 + 2 mm
  assert.ok(Math.abs(stamp.size[0] - 78) < 0.6, `Stempel ${stamp.size[0]}`);
  assert.ok(Math.abs(stamp.size[2] - 5) < 1e-4);
  const stl = toBinaryStl(cutter.tris);
  assert.equal(stl.byteLength, 84 + (cutter.tris.length / 9) * 50);
  console.log(`  Laufzeit ${ms.toFixed(0)} ms, ${cutter.tris.length / 9 + stamp.tris.length / 9} Dreiecke`);
  assert.ok(ms < 5000);
});
