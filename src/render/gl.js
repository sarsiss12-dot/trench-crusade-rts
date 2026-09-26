// WebGL2 helpers: context, programs, buffers, VAOs, textures, draw-call accounting.

export function createGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: opts.antialias !== false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    premultipliedAlpha: false,
  });
  if (!gl) return null;
  gl.stats = { drawCalls: 0, triangles: 0, instances: 0 };
  return gl;
}

export function resetStats(gl) {
  gl.stats.drawCalls = 0;
  gl.stats.triangles = 0;
  gl.stats.instances = 0;
}

/** Error thrown when the GPU context disappears during setup (not a shader bug: retry later). */
export class ContextLostError extends Error {}

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    if (gl.isContextLost()) throw new ContextLostError('webgl.context_lost');
    const log = gl.getShaderInfoLog(sh);
    // full source for developers in the console; a short message for the player
    const numbered = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
    console.error(`Shader compile failed (${name}, ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}): ${log}\n${numbered}`);
    throw new Error(`shader:${name}`);
  }
  return sh;
}

function checkShader(gl, sh, src, name, type) {
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return;
  if (gl.isContextLost()) throw new ContextLostError('webgl.context_lost');
  const numbered = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
  console.error(`Shader compile failed (${name}, ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}): ${gl.getShaderInfoLog(sh)}\n${numbered}`);
  throw new Error(`shader:${name}`);
}

function programInfo(gl, name, p) {
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const key = info.name.replace(/\[0\]$/, '');
    uniforms[key] = gl.getUniformLocation(p, info.name);
  }
  return { name, program: p, u: uniforms };
}

/**
 * Build many programs at once: every shader is compiled and every program linked before any
 * status is queried, so drivers can compile in parallel (KHR_parallel_shader_compile / Chrome's
 * GPU process) instead of stalling on each program in turn. specs: { key: [name, vs, fs] }.
 */
export function createPrograms(gl, specs) {
  gl.getExtension('KHR_parallel_shader_compile');
  const staged = {};
  for (const key in specs) {
    const [name, vs, fs] = specs[key];
    const p = gl.createProgram();
    const v = gl.createShader(gl.VERTEX_SHADER), f = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(v, vs); gl.compileShader(v);
    gl.shaderSource(f, fs); gl.compileShader(f);
    gl.attachShader(p, v); gl.attachShader(p, f);
    staged[key] = { name, p, v, f, vs, fs };
  }
  for (const key in staged) gl.linkProgram(staged[key].p);
  const out = {};
  for (const key in staged) {
    const { name, p, v, f, vs, fs } = staged[key];
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      checkShader(gl, v, vs, name, gl.VERTEX_SHADER);
      checkShader(gl, f, fs, name, gl.FRAGMENT_SHADER);
      if (gl.isContextLost()) throw new ContextLostError('webgl.context_lost');
      console.error('Program link failed (' + name + '): ' + gl.getProgramInfoLog(p));
      throw new Error(`shader:${name}`);
    }
    out[key] = programInfo(gl, name, p);
  }
  return out;
}

/** Create program; attribute locations are fixed by name map for VAO sharing. */
export function createProgram(gl, name, vsSrc, fsSrc, attribs = {}) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, name));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, name));
  for (const k in attribs) gl.bindAttribLocation(p, attribs[k], k);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    if (gl.isContextLost()) throw new ContextLostError('webgl.context_lost');
    console.error('Program link failed (' + name + '): ' + gl.getProgramInfoLog(p));
    throw new Error(`shader:${name}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const key = info.name.replace(/\[0\]$/, '');
    uniforms[key] = gl.getUniformLocation(p, info.name);
  }
  return { name, program: p, u: uniforms };
}

export function createBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}

/**
 * VAO from layout descriptors:
 *  { buffer, stride, attribs: [{ loc, size, type, normalized, offset, divisor, integer }] }
 */
export function createVAO(gl, layouts, indexBuffer) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const l of layouts) {
    gl.bindBuffer(gl.ARRAY_BUFFER, l.buffer);
    for (const a of l.attribs) {
      gl.enableVertexAttribArray(a.loc);
      if (a.integer) gl.vertexAttribIPointer(a.loc, a.size, a.type, l.stride, a.offset);
      else gl.vertexAttribPointer(a.loc, a.size, a.type, !!a.normalized, l.stride, a.offset);
      if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
    }
  }
  if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);
  return vao;
}

export function createTexture2D(gl, w, h, opts = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const internal = opts.internal || gl.RGBA8;
  const format = opts.format || gl.RGBA;
  const type = opts.type || gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, opts.data || null);
  const filter = opts.filter || gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  const wrap = opts.wrap || gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

export function drawElements(gl, mode, count, type, instances = 0) {
  if (instances > 0) {
    gl.drawElementsInstanced(mode, count, type, 0, instances);
    gl.stats.instances += instances;
    gl.stats.triangles += (count / 3) * instances;
  } else {
    gl.drawElements(mode, count, type, 0);
    gl.stats.triangles += count / 3;
  }
  gl.stats.drawCalls++;
}

export function drawArrays(gl, mode, first, count, instances = 0) {
  if (instances > 0) {
    gl.drawArraysInstanced(mode, first, count, instances);
    gl.stats.instances += instances;
    if (mode === gl.TRIANGLES) gl.stats.triangles += (count / 3) * instances;
    else if (mode === gl.TRIANGLE_STRIP) gl.stats.triangles += Math.max(0, count - 2) * instances;
  } else {
    gl.drawArrays(mode, first, count);
    if (mode === gl.TRIANGLES) gl.stats.triangles += count / 3;
  }
  gl.stats.drawCalls++;
}
