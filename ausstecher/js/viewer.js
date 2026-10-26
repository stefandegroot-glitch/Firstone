// Kleine WebGL-Vorschau: Modelle drehen (ziehen) und zoomen (Mausrad / zwei Finger).

const VS = `
attribute vec3 pos; attribute vec3 nrm;
uniform mat4 mvp; uniform vec3 offset;
varying vec3 vN;
void main() { vN = nrm; gl_Position = mvp * vec4(pos + offset, 1.0); }`;
const FS = `
precision mediump float;
varying vec3 vN; uniform vec3 color;
void main() {
  vec3 n = normalize(vN);
  float l = 0.35 + 0.55 * max(dot(n, normalize(vec3(0.4, -0.5, 0.8))), 0.0)
              + 0.2 * max(dot(n, normalize(vec3(-0.6, 0.6, 0.3))), 0.0);
  gl_FragColor = vec4(color * l, 1.0);
}`;

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true });
    this.gl = gl;
    this.items = [];
    this.yaw = -0.3;
    this.pitch = 0.9;
    this.zoom = 1;
    this.radius = 60;
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    this.prog = prog;
    this.loc = {
      pos: gl.getAttribLocation(prog, 'pos'), nrm: gl.getAttribLocation(prog, 'nrm'),
      mvp: gl.getUniformLocation(prog, 'mvp'), offset: gl.getUniformLocation(prog, 'offset'),
      color: gl.getUniformLocation(prog, 'color'),
    };
    this.bindInput();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  bindInput() {
    const c = this.canvas;
    const pointers = new Map();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
    const up = (e) => { pointers.delete(e.pointerId); pinch = 0; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const [px, py] = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoom = Math.min(4, Math.max(0.3, this.zoom * (d / pinch)));
        pinch = d;
      } else {
        this.yaw += (e.clientX - px) * 0.01;
        this.pitch = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, this.pitch + (e.clientY - py) * 0.01));
      }
      this.draw();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(4, Math.max(0.3, this.zoom * Math.exp(-e.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
  }

  // items: [{ tris: Float32Array, color: [r,g,b], offset: [x,y,z] }]
  setItems(items) {
    const gl = this.gl;
    if (!gl) return;
    for (const it of this.items) { gl.deleteBuffer(it.pb); gl.deleteBuffer(it.nb); }
    let r = 10;
    this.items = items.map((it) => {
      const t = it.tris;
      const nrm = new Float32Array(t.length);
      for (let i = 0; i < t.length; i += 9) {
        const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
        const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        for (let k = 0; k < 3; k++) { nrm[i + 3 * k] = nx / l; nrm[i + 3 * k + 1] = ny / l; nrm[i + 3 * k + 2] = nz / l; }
      }
      for (let i = 0; i < t.length; i += 3) {
        r = Math.max(r, Math.hypot(t[i] + it.offset[0], t[i + 1] + it.offset[1], t[i + 2] + it.offset[2]));
      }
      const pb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, t, gl.STATIC_DRAW);
      const nb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nb);
      gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
      return { pb, nb, count: t.length / 3, color: it.color, offset: it.offset };
    });
    this.radius = r;
    this.draw();
  }

  draw() {
    const gl = this.gl;
    if (!gl) return;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);

    // Kamera: Orbit um den Ursprung, z ist oben.
    const dist = (this.radius * 3.4) / this.zoom;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const rotZ = new Float32Array([cy, -sy, 0, 0, sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    // Kippen um x: Blick von schräg oben (pitch = 0 -> von vorne, pi/2 -> von oben)
    const a = Math.PI / 2 - this.pitch;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rotX = new Float32Array([1, 0, 0, 0, 0, ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1]);
    const view = mul(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1]), mul(rotX, rotZ));
    const f = 1 / Math.tan(0.35), near = dist / 10, far = dist * 4, aspect = w / h;
    const proj = new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0,
    ]);
    gl.uniformMatrix4fv(this.loc.mvp, false, mul(proj, view));
    for (const it of this.items) {
      gl.uniform3fv(this.loc.offset, it.offset);
      gl.uniform3fv(this.loc.color, it.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, it.pb);
      gl.enableVertexAttribArray(this.loc.pos);
      gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, it.nb);
      gl.enableVertexAttribArray(this.loc.nrm);
      gl.vertexAttribPointer(this.loc.nrm, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, it.count);
    }
  }
}
