// Rendert Morph-Zwischenbilder auf der GPU (WebGL2).
// Für jeden Zeitpunkt t werden beide Fotos entlang des Flussfelds aufeinander zu
// verzerrt und dann überblendet. Ohne WebGL2 fällt es auf reines Überblenden zurück.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform float uT;
uniform float uStrength;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 f = texture(uFlow, vUv).xy * uStrength;
  vec3 a = texture(uA, vUv - uT * f).rgb;
  vec3 b = texture(uB, vUv + (1.0 - uT) * f).rgb;
  outColor = vec4(mix(a, b, uT), 1.0);
}`;

class GLMorpher {
  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texA = this.#texture(0);
    this.texB = this.#texture(1);
    this.texFlow = this.#texture(2);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uFlow'), 2);
    this.uT = gl.getUniformLocation(prog, 'uT');
    this.uStrength = gl.getUniformLocation(prog, 'uStrength');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  #texture(unit) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** a, b: Canvas in Ausgabegröße; flow: Ergebnis von computeFlow (oder null) mit Größe fw×fh. */
  setPair(a, b, flow, fw, fh) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.activeTexture(gl.TEXTURE2);
    if (flow) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, fw, fh, 0, gl.RG, gl.FLOAT, flow);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
  }

  draw(t, strength) {
    const gl = this.gl;
    gl.uniform1f(this.uT, t);
    gl.uniform1f(this.uStrength, strength);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

class CrossfadeMorpher {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setPair(a, b) {
    this.a = a;
    this.b = b;
  }

  draw(t) {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.a, 0, 0);
    ctx.globalAlpha = t;
    ctx.drawImage(this.b, 0, 0);
    ctx.globalAlpha = 1;
  }
}

export function createMorpher(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  if (gl) {
    try {
      return new GLMorpher(canvas, gl);
    } catch (err) {
      console.warn('WebGL2-Morphing nicht verfügbar, nutze Überblenden', err);
    }
  }
  const fallback = document.createElement('canvas');
  fallback.width = width;
  fallback.height = height;
  return new CrossfadeMorpher(fallback);
}
