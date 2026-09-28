// GLSL ES 3.00 shader sources. Lighting model: hemisphere ambient + low directional sun with a
// real shadow map (PCF) + rim, per-material response (cloth / leather / metal / skin / wet flesh /
// wood / glass / bone / soil / mud / stone), procedural grime/mud/rust from a generated noise
// texture, fog-of-war, distance + ground-mist haze, filmic tonemapping with split toning.
// No external textures.

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

const GLOBALS = `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform vec4 uFogParams;   // x distance density, y height falloff, z mist height, w max haze
uniform vec4 uMapParams;   // x 1/mapW, y 1/mapH, z fog-of-war enabled, w time (s)
uniform sampler2D uFowTex;
uniform sampler2D uNoiseTex;
`;

const SHADOW = `
uniform sampler2DShadow uShadowTex;
uniform mat4 uShadowMat;
uniform vec4 uShadowParams; // x enabled, y texel size (uv), z depth bias, w strength
float shadowAt(vec3 wp, vec3 N) {
  if (uShadowParams.x < 0.5) return 1.0;
  float ndl = dot(N, uSunDir);
  vec3 p = wp + N * (0.05 + 0.1 * (1.0 - abs(ndl))) + uSunDir * 0.03;
  vec4 sp = uShadowMat * vec4(p, 1.0);
  vec3 c = sp.xyz * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float t = uShadowParams.y;
  float z = c.z - uShadowParams.z;
  float s;
  if (uShadowParams.x > 1.5) { // high: 4 rotated taps (each a hardware 2x2 comparison)
    s = texture(uShadowTex, vec3(c.xy + vec2(-0.6, -0.4) * t, z));
    s += texture(uShadowTex, vec3(c.xy + vec2(0.4, -0.6) * t, z));
    s += texture(uShadowTex, vec3(c.xy + vec2(-0.4, 0.6) * t, z));
    s += texture(uShadowTex, vec3(c.xy + vec2(0.6, 0.4) * t, z));
    s *= 0.25;
  } else { // balanced: one hardware-filtered tap
    s = texture(uShadowTex, vec3(c.xy, z));
  }
  vec2 e = min(c.xy, 1.0 - c.xy);
  float fade = smoothstep(0.0, 0.07, min(e.x, e.y));
  return mix(1.0, s, fade * uShadowParams.w);
}
`;

const COMMON_FRAG = `
vec3 fogOfWar(vec3 c, vec3 wp) {
  if (uMapParams.z < 0.5) return c;
  vec2 fw = texture(uFowTex, wp.xz * uMapParams.xy).rg;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 explored = mix(vec3(lum), c, 0.35) * vec3(0.42, 0.43, 0.46);
  vec3 unexplored = mix(vec3(lum), c, 0.15) * 0.14 + vec3(0.003, 0.003, 0.004);
  vec3 fogged = mix(unexplored, explored, fw.g);
  return mix(fogged, c, fw.r);
}
vec3 atmosphere(vec3 c, vec3 wp) {
  float d = distance(uCamPos, wp);
  float f = 1.0 - exp(-pow(d * uFogParams.x, 1.5));
  float mist = clamp((uFogParams.z - wp.y) * uFogParams.y, 0.0, 1.0) * 0.22;
  f = clamp(f + mist * (1.0 - f), 0.0, uFogParams.w);
  return mix(c, uFogColor, f);
}
vec3 tonemap(vec3 c) {
  c = max(c, vec3(0.0)) * 1.1;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.8);
  // split toning: cold shadows, sickly-warm highlights (grimdark grade)
  c += vec3(-0.012, -0.002, 0.018) * (1.0 - l) * (1.0 - l) + vec3(0.02, 0.012, -0.018) * l;
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}
// Shared material response. mats: 0 cloth, 1 leather, 2 metal, 3 skin, 4 wet flesh, 5 wood,
// 6 glass, 7 bone, 8 faction accent cloth, 9 blackened metal, 10 glow, 11 soil, 12 wet mud, 13 stone
vec3 shade(vec3 alb, int mat, vec3 N, vec3 wp, vec3 obj, vec4 p0, vec3 accent, float aoY, float sh) {
  vec4 nz = texture(uNoiseTex, obj.xy * 3.1 + obj.z * 1.7 + p0.x * 0.37);
  vec4 nz2 = texture(uNoiseTex, obj.zy * 6.3 + obj.x * 0.9 + 0.21);
  if (mat == 11 || mat == 12 || mat == 13) {
    nz = texture(uNoiseTex, wp.xz * 0.075 + wp.y * 0.05 + 0.37);
    nz2 = texture(uNoiseTex, wp.xz * 0.43 + wp.y * 0.21 + 0.71);
  }
  if (mat == 8) alb = mix(alb, accent, 0.82);
  if (mat <= 1 || mat == 8) alb *= vec3(1.0 + p0.x * 0.09, 1.0 + p0.x * 0.03, 1.0 - p0.x * 0.07);
  alb *= 0.72 + 0.4 * nz.r;
  // grime: dirt collects low and in creases; fabric wear lightens edges a little
  float mudLine = 0.1 + p0.y * 0.65;
  float mud = (1.0 - smoothstep(mudLine - 0.3, mudLine, obj.y + (nz2.g - 0.5) * 0.25));
  if (mat != 10 && mat != 11 && mat != 12 && mat != 13) alb = mix(alb, vec3(0.035, 0.026, 0.018), mud * 0.85);
  float spec = 0.02, gloss = 8.0, wrap = 0.12, rimK = 0.14;
  if (mat == 2 || mat == 9) {
    float rust = smoothstep(0.5, 0.78, nz2.b) * (0.35 + p0.z);
    alb = mix(alb, vec3(0.1, 0.04, 0.016), rust * 0.6);
    alb += step(0.88, nz.g) * p0.z * 0.04;
    spec = mat == 2 ? 0.35 : 0.16; gloss = 34.0; wrap = 0.02; rimK = 0.2;
  } else if (mat == 1) { spec = 0.08; gloss = 14.0; wrap = 0.08; }
  else if (mat == 3) { spec = 0.05; gloss = 12.0; wrap = 0.35; }
  else if (mat == 4) { spec = 0.45; gloss = 46.0; wrap = 0.3; rimK = 0.22; }
  else if (mat == 5) { spec = 0.02; gloss = 8.0; alb *= 0.8 + 0.34 * nz2.r; }
  else if (mat == 6) { spec = 0.9; gloss = 90.0; wrap = 0.0; rimK = 0.3; }
  else if (mat == 7) { spec = 0.07; gloss = 16.0; wrap = 0.25; }
  else if (mat == 11) { alb *= 0.78 + 0.4 * nz2.b; wrap = 0.05; }
  else if (mat == 12) { alb *= 0.55 + 0.3 * nz2.b; spec = 0.12; gloss = 30.0; wrap = 0.05; }
  else if (mat == 13) {
    // weathered masonry: block courses, rain streaks, soot at the base
    float course = smoothstep(0.0, 0.05, abs(fract(obj.y * 2.2 + nz.g * 0.2) - 0.5) - 0.44);
    float streak = texture(uNoiseTex, vec2(wp.x * 0.9 + wp.z * 0.9, wp.y * 0.08)).r;
    alb *= (0.8 + 0.3 * nz2.g) * (1.0 - course * 0.35) * (0.85 + 0.25 * streak);
    alb = mix(alb, vec3(0.03, 0.028, 0.025), (1.0 - smoothstep(0.0, 1.6, obj.y)) * 0.45);
    spec = 0.03; wrap = 0.05;
  }
  float ndl = dot(N, uSunDir);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0) * sh;
  vec3 amb = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * aoY;
  vec3 V = normalize(uCamPos - wp);
  vec3 H = normalize(V + uSunDir);
  float fres = 0.3 + 0.7 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 4.0);
  float s = pow(max(dot(N, H), 0.0), gloss) * spec * (1.0 - mud * 0.8) * sh * fres * 2.0;
  float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0) * rimK;
  vec3 col = alb * (amb + uSunColor * diff) + uSunColor * s + uSkyColor * rim * 0.45 * aoY;
  if (mat == 10) col += alb * 2.2;
  return col;
}
`;

// ------------------------------------------------------------------------------- terrain

export const TERRAIN_VS = HEADER + GLOBALS + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 aExtra;
out vec3 vWorld; out vec3 vNormal; out vec4 vColor; out vec4 vExtra; out float vGrass;
void main() {
  vWorld = aPos;
  vNormal = aNormal.xyz;
  vGrass = aNormal.w;
  vColor = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  vExtra = aExtra;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const TERRAIN_FS = HEADER + GLOBALS + SHADOW + COMMON_FRAG + `
uniform sampler2D uInfTex;
uniform sampler2D uMudTex;  // Phase 4.1: traffic mud the viewer has seen (0..1)
uniform vec4 uWeather;      // x rain intensity, y ground wetness (public weather)
in vec3 vWorld; in vec3 vNormal; in vec4 vColor; in vec4 vExtra; in float vGrass;
out vec4 fragColor;
void main() {
  vec3 wp = vWorld;
  vec2 p = wp.xz;
  vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
  vec4 nM = texture(uNoiseTex, p * 0.0043 + 0.13);   // ~230 m macro tone
  vec4 nA = texture(uNoiseTex, pr * 0.019 + 0.41);   // ~50 m patches
  vec4 nB = texture(uNoiseTex, p * 0.071 + 0.27);    // ~14 m
  vec4 nC = texture(uNoiseTex, pr * 0.29 + 0.71);    // ~3.5 m clods
  vec4 nD = texture(uNoiseTex, p * 1.07 + 0.05);     // ~1 m grain
  vec3 base = vColor.rgb;
  float wetBase = vColor.a;
  float ao = vExtra.x * 1.1;
  float field = vExtra.y, crater = vExtra.z, road = vExtra.w;

  vec3 alb = base * (0.84 + 0.3 * nM.r) * (0.9 + 0.2 * nA.g);
  float clod = smoothstep(0.3, 0.8, nB.r * 0.55 + nC.g * 0.45);
  alb *= 0.88 + 0.18 * clod;
  alb *= 0.9 + 0.2 * nD.a;
  // dry cracked crust on firm ground
  float crack = 1.0 - smoothstep(0.015, 0.08, nC.b);
  alb *= 1.0 - crack * 0.28 * (1.0 - wetBase) * (1.0 - field);
  // pebbles / grit on roads and rubble
  vec4 nE = texture(uNoiseTex, pr * 2.3 + 0.61);
  float grit = smoothstep(0.7, 0.86, nE.r * 0.7 + nD.r * 0.3) * (road * 0.8 + 0.2 * (1.0 - wetBase));
  alb = mix(alb, alb * 1.25 + 0.006, grit * 0.45);
  // plough furrows
  float furrow = sin(wp.z * 3.3 + nB.r * 2.4) * 0.5 + 0.5;
  alb *= 1.0 - field * 0.32 * smoothstep(0.25, 0.85, furrow);
  // dead grass: patchy olive coverage with blade streaks
  float grassCover = vGrass * smoothstep(0.35, 0.62, nA.r * 0.65 + nB.g * 0.45 + nC.r * 0.2);
  vec3 grassCol = mix(vec3(0.05, 0.043, 0.024), vec3(0.125, 0.105, 0.052), nC.r * 0.7 + nD.g * 0.3);
  float blades = texture(uNoiseTex, vec2(p.x * 3.1, p.y * 1.2) + 0.33).a;
  grassCol *= 0.7 + 0.6 * blades;
  alb = mix(alb, grassCol, grassCover * 0.9);
  // wet ground and rare puddles (dark, sky-reflecting — never bright cut-outs)
  // wetness: sharper-edged damp patches (not soft cloud shapes), pooled in craters
  float wetN = nA.b * 0.55 + nB.g * 0.3 + nC.r * 0.15;
  float wet = clamp(wetBase * smoothstep(0.42, 0.52, wetN) * 0.85 + crater * 0.3, 0.0, 1.0);
  alb *= mix(1.0, 0.6, wet);
  float puddle = smoothstep(0.86, 0.96, wetBase + crater * 0.12) * smoothstep(0.62, 0.7, nA.r * 0.55 + nB.r * 0.3 + nC.a * 0.15);
  // Phase 4.1 rain + traffic mud: rain darkens and glosses the whole field; churned tracks turn to
  // dark rutted mud (MUD / HEAVY MUD); puddles grow in hollows while it is wet
  float mudV = texture(uMudTex, p * uMapParams.xy).r;
  float mudK = smoothstep(0.33, 0.72, mudV);
  float rainWet = uWeather.y;
  vec3 mudCol = mix(vec3(0.04, 0.031, 0.022), vec3(0.07, 0.052, 0.036), nC.g);
  float ruts = smoothstep(0.3, 0.7, texture(uNoiseTex, vec2(p.x * 0.9, p.y * 0.35) + 0.19).b);
  alb = mix(alb, mudCol * (0.8 + 0.35 * ruts), mudK * 0.8);
  float wetMore = max(rainWet * 0.6, mudK * 0.85);
  alb *= mix(1.0, 0.72, max(0.0, wetMore - wet));
  wet = max(wet, wetMore);
  puddle = max(puddle, smoothstep(0.62, 0.95, rainWet * 0.5 + mudK * 0.45 + crater * 0.35) * smoothstep(0.58, 0.68, nA.r * 0.55 + nB.r * 0.3 + nC.a * 0.15));
  // infection: blackened rot, veins, pustules (only where the viewer has explored)
  float inf = texture(uInfTex, p * uMapParams.xy).r;
  float vein = 1.0 - smoothstep(0.0, 0.03, abs(nB.r - 0.5));
  float vein2 = 1.0 - smoothstep(0.0, 0.022, abs(nC.g - 0.5));
  float pus = smoothstep(0.84, 0.88, nC.a);
  float infK = smoothstep(0.08, 0.6, inf);
  // corrupted ground: blackened, bruised, glistening; faint veins, rare pustules
  vec3 rot = mix(vec3(0.028, 0.02, 0.018), vec3(0.05, 0.028, 0.03), nB.g);
  alb = mix(alb, rot, infK * 0.65);
  alb *= 1.0 - infK * (vein * 0.35 + vein2 * 0.2);
  alb += infK * infK * pus * vec3(0.045, 0.05, 0.012);
  wetBase = max(wetBase, infK * 0.7);

  vec3 N0 = normalize(vNormal);
  vec2 bump = (nC.rg - 0.5) * 0.55 + (nD.gb - 0.5) * 0.3 + (nB.gb - 0.5) * 0.25;
  vec3 N = normalize(N0 + vec3(bump.x, 0.0, bump.y) * (1.0 - puddle) * (1.0 - grassCover * 0.5));
  float sh = shadowAt(wp, N0);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 amb = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 col = alb * (amb * ao + uSunColor * ndl * sh * mix(0.55, 1.0, ao));
  vec3 V = normalize(uCamPos - wp);
  vec3 H = normalize(V + uSunDir);
  float gloss = mix(18.0, 60.0, wet);
  col += uSunColor * pow(max(dot(N, H), 0.0), gloss) * (wet * 0.08 + infK * 0.04) * sh;
  // puddle surface
  vec2 rip = (texture(uNoiseTex, p * 1.7 + vec2(uMapParams.w * 0.6, uMapParams.w * 0.23)).rg - 0.5) * 0.14 * uWeather.x;
  vec3 Np = normalize(N0 + vec3(nD.r - 0.5 + rip.x, 0.0, nD.g - 0.5 + rip.y) * 0.06 + vec3(rip.x, 0.0, rip.y));
  float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(Np, V), 0.0, 1.0), 5.0);
  vec3 water = vec3(0.01, 0.009, 0.007) + mix(uSkyColor * 0.18, uFogColor * 0.4, 0.5) * fres;
  water += uSunColor * pow(max(dot(Np, H), 0.0), 220.0) * 0.8 * sh;
  col = mix(col, water, puddle * 0.9);
  col = fogOfWar(col, wp);
  col = atmosphere(col, wp);
  // Phase 4.1: +-0.5 LSB screen-space dither (interleaved gradient noise) breaks 8-bit banding in
  // the wide dark haze / fog gradients of the ground
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(tonemap(col) + (ign - 0.5) / 255.0, 1.0);
}`;

// ------------------------------------------------------------------------------- skinned units

export const BONES = 14;
export const POSE_TEXELS = BONES * 3 + 3; // 14 bones x 3 rows + look + accent + gore/sickness

const SKIN_FN = `
uniform highp sampler2D uPoseTex;
uniform int uRowBase;
void skinRows(int row, vec4 aBones, out vec4 r0, out vec4 r1, out vec4 r2) {
  int b0 = int(aBones.x * 255.0 + 0.5);
  int b1 = int(aBones.y * 255.0 + 0.5);
  float w = aBones.z;
  r0 = texelFetch(uPoseTex, ivec2(b0 * 3, row), 0);
  r1 = texelFetch(uPoseTex, ivec2(b0 * 3 + 1, row), 0);
  r2 = texelFetch(uPoseTex, ivec2(b0 * 3 + 2, row), 0);
  if (w > 0.004) {
    r0 = mix(r0, texelFetch(uPoseTex, ivec2(b1 * 3, row), 0), w);
    r1 = mix(r1, texelFetch(uPoseTex, ivec2(b1 * 3 + 1, row), 0), w);
    r2 = mix(r2, texelFetch(uPoseTex, ivec2(b1 * 3 + 2, row), 0), w);
  }
}
`;

export const SKINNED_VS = HEADER + GLOBALS + SKIN_FN + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 aBones;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec3 vObj;
flat out int vMat; flat out vec4 vP0; flat out vec4 vP1; flat out vec4 vP2;
void main() {
  int row = uRowBase + gl_InstanceID;
  vec4 r0, r1, r2;
  skinRows(row, aBones, r0, r1, r2);
  vec4 p = vec4(aPos, 1.0);
  vec3 wp = vec3(dot(r0, p), dot(r1, p), dot(r2, p));
  vec3 n = aNormal.xyz;
  vNormal = vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
  vP0 = texelFetch(uPoseTex, ivec2(${BONES * 3}, row), 0);
  vP1 = texelFetch(uPoseTex, ivec2(${BONES * 3 + 1}, row), 0);
  vP2 = texelFetch(uPoseTex, ivec2(${BONES * 3 + 2}, row), 0);
  vWorld = wp;
  vObj = aPos;
  vColor = pow(aColor.rgb, vec3(2.2));
  vMat = int(aColor.a * 255.0 + 0.5);
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

export const SKINNED_FS = HEADER + GLOBALS + SHADOW + COMMON_FRAG + `
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec3 vObj;
flat in int vMat; flat in vec4 vP0; flat in vec4 vP1; flat in vec4 vP2;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float aoY = mix(0.45, 1.0, smoothstep(0.0, 1.2, vObj.y));
  vec3 accent = pow(vP1.rgb, vec3(2.2));
  vec3 alb = vColor * (1.0 - vP1.a * 0.55);
  // gore layer: blood soaks cloth / skin in noisy patches (dark red; Grail ichor near-black green)
  if (vP2.x > 0.01) {
    float nb = texture(uNoiseTex, vObj.xy * 1.7 + vObj.z * 0.9 + vP0.x).r;
    float soak = smoothstep(0.62 - vP2.x * 0.5, 0.7 - vP2.x * 0.45, nb) * clamp(vP2.x * 1.6, 0.0, 1.0);
    vec3 bc = mix(vec3(0.075, 0.004, 0.003), vec3(0.018, 0.022, 0.006), vP2.z);
    alb = mix(alb, bc, soak * 0.85);
  }
  // visible sickness (infected New Antioch soldiers): sallow, greenish pallor, dark blotches
  if (vP2.y > 0.01) {
    float nb2 = texture(uNoiseTex, vObj.xz * 2.3 + vObj.y).g;
    vec3 sick = alb * vec3(0.78, 0.9, 0.52);
    alb = mix(alb, sick, vP2.y * 0.8);
    alb *= 1.0 - vP2.y * 0.45 * smoothstep(0.66, 0.74, nb2);
  }
  float sh = mix(1.0, shadowAt(vWorld, N), 0.85);
  vec3 col = shade(alb, vMat, N, vWorld, vObj, vP0, accent, aoY, sh);
  col += vP0.w * vec3(0.16, 0.14, 0.09) * (0.35 + pow(clamp(1.0 - dot(N, normalize(uCamPos - vWorld)), 0.0, 1.0), 2.0) * 2.5);
  col = fogOfWar(col, vWorld);
  col = atmosphere(col, vWorld);
  fragColor = vec4(tonemap(col), 1.0);
}`;

// ------------------------------------------------------------------------------- static instanced

const STATIC_XFORM = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=4) in vec4 iPosRot;
layout(location=5) in vec4 iParams;
vec3 instanceWorld(out vec3 nrm) {
  float s = iParams.x;
  float c = cos(iPosRot.w), sn = sin(iPosRot.w);
  vec3 p = aPos * s;
  vec3 rp = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
  vec3 n = aNormal.xyz;
  nrm = vec3(c * n.x + sn * n.z, n.y, -sn * n.x + c * n.z);
  return iPosRot.xyz + rp;
}
`;

export const STATIC_VS = HEADER + GLOBALS + STATIC_XFORM + `
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec3 vObj;
flat out int vMat; flat out vec4 vParams;
void main() {
  vec3 n;
  vec3 wp = instanceWorld(n);
  vNormal = n;
  vWorld = wp;
  vObj = aPos;
  vColor = pow(aColor.rgb, vec3(2.2));
  vMat = int(aColor.a * 255.0 + 0.5);
  vParams = iParams;
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

export const STATIC_FS = HEADER + GLOBALS + SHADOW + COMMON_FRAG + `
uniform float uModelHeight;
uniform float uMud;        // grime line parameter (<0 disables: clutter, fortification meshes)
uniform float uBackDim;    // back-face darkening (walls seen from inside); 1 for foliage
uniform vec3 uAccent;
uniform vec4 uGhost; // rgb tint, a>0 => ghost preview
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec3 vObj;
flat in int vMat; flat in vec4 vParams;
out vec4 fragColor;
void main() {
#ifdef CONSTRUCTION_CUT
  // construction progress: geometry rises from the ground (only this variant may discard: a shader
  // containing discard loses early depth / hidden-surface removal on tile-based mobile GPUs)
  float prog = vParams.z;
  if (prog < 0.999) {
    float cut = prog * uModelHeight * 1.02 + (texture(uNoiseTex, vObj.xz * 0.9).r - 0.5) * 0.35;
    if (vObj.y > cut) discard;
  }
#endif
  vec3 N = normalize(vNormal);
  bool back = !gl_FrontFacing;
  if (back && uBackDim < 0.99) N = -N; // foliage keeps its upward-bent normals on both sides
  float tint = vParams.y;
  vec3 alb = vColor * (1.0 + (tint - 0.5) * 0.25);
  float dmg = vParams.w;
  if (dmg > 0.0) {
    // damage stages (presentation): DAMAGED -> soot patches; CRITICAL -> cracks + charring
    float sc = texture(uNoiseTex, vObj.xy * 0.7 + vObj.z * 0.3).g;
    alb *= 1.0 - dmg * 0.6 * smoothstep(0.35, 0.7, sc);
    float soot = smoothstep(0.3, 0.7, dmg) * (1.0 - smoothstep(0.2, 2.2, vObj.y));
    alb *= 1.0 - 0.45 * soot * texture(uNoiseTex, vObj.xz * 0.35 + 0.3).b;
    if (dmg > 0.34) {
      vec2 cq = vObj.xy * 1.9 + vObj.zx * 0.8;
      float cn = texture(uNoiseTex, cq * 0.23).r * 0.7 + texture(uNoiseTex, cq * 0.61).g * 0.3;
      float crack = 1.0 - smoothstep(0.0, 0.018 + 0.02 * dmg, abs(cn - 0.5));
      alb *= 1.0 - crack * smoothstep(0.34, 0.8, dmg) * 0.85;
    }
  }
  float aoY = mix(0.5, 1.0, smoothstep(0.0, 1.5, vObj.y));
  // slate roofs: overlapping tile courses + staggered joints (large dark-metal surfaces only)
  if (vMat == 9 && N.y > 0.25 && N.y < 0.97 && uModelHeight > 4.0) {
    float row = fract(vObj.y * 3.4);
    float jx = fract((vObj.x + vObj.z) * 2.6 + floor(vObj.y * 3.4) * 0.5);
    alb *= (0.7 + 0.3 * smoothstep(0.0, 0.16, row)) * (0.9 + 0.1 * step(0.08, jx));
    alb *= 0.85 + 0.3 * texture(uNoiseTex, vec2(floor(vObj.y * 3.4) * 0.37, floor((vObj.x + vObj.z) * 2.6) * 0.21)).r;
  }
  float sh = uGhost.a > 0.0 ? 1.0 : shadowAt(vWorld, N);
  vec3 col = shade(alb, vMat, N, vWorld, vObj, vec4(tint - 0.5, uMud, 0.6, 0.0), uAccent, aoY, sh);
  if (back) col *= uBackDim;
  if (uGhost.a > 0.0) {
    col = mix(col, uGhost.rgb, 0.55);
    fragColor = vec4(tonemap(col), uGhost.a);
    return;
  }
  col = fogOfWar(col, vWorld);
  col = atmosphere(col, vWorld);
  fragColor = vec4(tonemap(col), 1.0);
}`;

// ------------------------------------------------------------------------------- shadow depth passes

const EMPTY_FS = HEADER + `
void main() {}`;

export const SHADOW_STATIC_VS = HEADER + GLOBALS + STATIC_XFORM + `
out float vY; flat out float vProg;
void main() {
  vec3 n;
  vec3 wp = instanceWorld(n);
  vY = aPos.y;
  vProg = iParams.z;
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

export const SHADOW_STATIC_FS = HEADER + `
uniform float uModelHeight;
in float vY; flat in float vProg;
void main() {
#ifdef CONSTRUCTION_CUT
  if (vProg < 0.999 && vY > vProg * uModelHeight * 1.02) discard;
#endif
}`;

/** Same source with a preprocessor switch (placed right after the #version line). */
export function withDefine(src, name) {
  return src.replace('#version 300 es\n', '#version 300 es\n#define ' + name + ' 1\n');
}

export const SHADOW_SKINNED_VS = HEADER + GLOBALS + SKIN_FN + `
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 aBones;
void main() {
  int row = uRowBase + gl_InstanceID;
  vec4 r0, r1, r2;
  skinRows(row, aBones, r0, r1, r2);
  vec4 p = vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(dot(r0, p), dot(r1, p), dot(r2, p), 1.0);
}`;

export const SHADOW_TERRAIN_VS = HEADER + GLOBALS + `
layout(location=0) in vec3 aPos;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

export const SHADOW_FS = EMPTY_FS;

// ------------------------------------------------------------------------------- water

export const WATER_VS = HEADER + GLOBALS + `
layout(location=0) in vec3 aPos;
out vec3 vWorld;
void main() { vWorld = aPos; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

export const WATER_FS = HEADER + GLOBALS + SHADOW + COMMON_FRAG + `
uniform sampler2D uHeightTex;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec3 wp = vWorld;
  float h = texture(uHeightTex, wp.xz * uMapParams.xy).r;
  float depth = wp.y - h;
  float t = uMapParams.w;
  vec2 flow = vec2(t * 0.012, t * 0.002);
  vec4 a = texture(uNoiseTex, wp.xz * 0.05 + flow);
  vec4 b = texture(uNoiseTex, wp.xz * 0.14 - flow * 1.9 + 0.5);
  vec3 N = normalize(vec3((a.r - 0.5) * 0.3 + (b.g - 0.5) * 0.22, 1.0, (a.g - 0.5) * 0.3 + (b.r - 0.5) * 0.22));
  vec3 V = normalize(uCamPos - wp);
  float fres = 0.03 + 0.97 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
  vec3 deepC = vec3(0.012, 0.014, 0.01);
  vec3 shallowC = vec3(0.06, 0.05, 0.034);
  float sh = shadowAt(wp, vec3(0.0, 1.0, 0.0));
  vec3 base = mix(shallowC, deepC, smoothstep(0.0, 1.8, depth));
  vec3 refl = mix(uFogColor, uSkyColor, 0.35) * 0.7;
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), 140.0) * 1.1 * sh;
  vec3 col = mix(base * (0.35 + 0.65 * max(dot(N, uSunDir), 0.0) * sh), refl, fres * 0.6) + uSunColor * spec;
  float scum = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.45, 0.7, b.b);
  col = mix(col, vec3(0.07, 0.06, 0.04), scum * 0.6);
  float alpha = smoothstep(0.0, 0.5, depth) * 0.94;
  col = fogOfWar(col, wp);
  col = atmosphere(col, wp);
  fragColor = vec4(tonemap(col), alpha);
}`;

// ------------------------------------------------------------------------------- particles

export const PARTICLE_VS = HEADER + GLOBALS + `
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 iPos;    // xyz, size
layout(location=5) in vec4 iColor;  // rgba (linear)
layout(location=6) in vec4 iVel;    // xyz dir, stretch length
layout(location=7) in vec4 iMisc;   // shape, rotation, seed, age01
uniform mat4 uView;
out vec2 vUV; out vec4 vColor; flat out int vShape; out float vSeed; out float vAge; out float vFog;
void main() {
  vec3 camRight = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 camUp = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 pos = iPos.xyz;
  vec3 wp;
  if (iVel.w > 0.0) {
    vec3 dir = normalize(iVel.xyz + vec3(1e-5));
    vec3 viewDir = normalize(uCamPos - pos);
    vec3 side = normalize(cross(dir, viewDir));
    wp = pos + dir * aCorner.y * iVel.w * 0.5 + side * aCorner.x * iPos.w;
  } else {
    float c = cos(iMisc.y), s = sin(iMisc.y);
    vec2 r = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y);
    wp = pos + (camRight * r.x + camUp * r.y) * iPos.w;
  }
  vUV = aCorner;
  vColor = iColor;
  vShape = int(iMisc.x + 0.5);
  vSeed = iMisc.z;
  vAge = iMisc.w;
  // distance haze per vertex (a billboard is small against its distance; saves per-pixel math)
  float d = distance(uCamPos, wp);
  float f = 1.0 - exp(-pow(d * uFogParams.x, 1.5));
  float mist = clamp((uFogParams.z - wp.y) * uFogParams.y, 0.0, 1.0) * 0.22;
  vFog = clamp(f + mist * (1.0 - f), 0.0, uFogParams.w);
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

export const PARTICLE_FS = HEADER + GLOBALS + COMMON_FRAG + `
uniform float uAdditive;
in vec2 vUV; in vec4 vColor; flat in int vShape; in float vSeed; in float vAge; in float vFog;
out vec4 fragColor;
void main() {
  float r = length(vUV);
  float a;
  vec3 c = vColor.rgb;
  if (vShape == 0) { // soft smoke / dust, lit from the sun side
    vec4 n = texture(uNoiseTex, vUV * 0.35 + vec2(vSeed, vSeed * 1.7) + vAge * 0.05);
    a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.15, 0.65, n.r + (1.0 - r) * 0.55);
    if (uAdditive < 0.5) c *= 0.75 + 0.5 * n.g;
  } else if (vShape == 1) { // flash / glow with rays
    a = pow(max(0.0, 1.0 - r), 2.2) + max(0.0, 1.0 - abs(vUV.x * vUV.y) * 22.0) * max(0.0, 1.0 - r) * 0.8;
  } else if (vShape == 2) { // streak (tracer / spark)
    a = (1.0 - abs(vUV.x)) * (1.0 - smoothstep(0.35, 1.0, abs(vUV.y)));
  } else if (vShape == 3) { // droplet / chunk
    vec4 n = texture(uNoiseTex, vUV * 0.5 + vSeed);
    a = (1.0 - smoothstep(0.6, 0.95, r + (n.r - 0.5) * 0.5));
  } else { // fly speck
    a = (1.0 - smoothstep(0.2, 0.9, r));
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  if (uAdditive < 0.5) c = mix(c, uFogColor, vFog);
  fragColor = vec4(pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)) * a, uAdditive > 0.5 ? 0.0 : a);
}`;

// ------------------------------------------------------------------------------- decals

export const DECAL_VS = HEADER + GLOBALS + `
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 iA;  // x, z, size, rot
layout(location=5) in vec4 iB;  // color
layout(location=6) in vec4 iC;  // shape, p1, p2, aspect
layout(location=7) in vec4 iD;  // centerY, lift, 0, 0
uniform sampler2D uHeightTex;
out vec2 vUV; out vec4 vColor; flat out int vShape; out vec3 vP; out vec3 vWorld;
void main() {
  float c = cos(iA.w), s = sin(iA.w);
  vec2 lc = aCorner * vec2(iA.z * iC.w, iA.z);
  vec2 xz = iA.xy + vec2(c * lc.x + s * lc.y, -s * lc.x + c * lc.y);
  float hc = texture(uHeightTex, iA.xy * uMapParams.xy).r;
  float h = texture(uHeightTex, xz * uMapParams.xy).r;
  float y = iD.x + (h - hc) + iD.y;
  vUV = aCorner;
  vColor = iB;
  vShape = int(iC.x + 0.5);
  vP = vec3(iC.y, iC.z, iC.w);
  vWorld = vec3(xz.x, y, xz.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

export const DECAL_FS = HEADER + GLOBALS + COMMON_FRAG + `
uniform float uAdditive;
in vec2 vUV; in vec4 vColor; flat in int vShape; in vec3 vP; in vec3 vWorld;
out vec4 fragColor;
void main() {
  float r = length(vUV);
  float a = 0.0;
  vec3 c = vColor.rgb;
  vec4 n = texture(uNoiseTex, vUV * 0.45 + vWorld.xz * 0.02);
  if (vShape == 0) { a = (1.0 - smoothstep(0.2, 1.0, r)); }                                  // blob shadow / dot
  else if (vShape == 1) { a = (1.0 - smoothstep(0.0, 0.1, abs(r - 0.82))) ; }                  // selection ring
  else if (vShape == 2) { a = (1.0 - smoothstep(0.55, 0.85, r + (n.r - 0.5) * 0.7)); }         // blood
  else if (vShape == 3) { a = (1.0 - smoothstep(0.3, 1.0, r + (n.g - 0.5) * 0.8)) * (0.7 + 0.3 * n.b); } // scorch
  else if (vShape == 4) { a = (1.0 - smoothstep(0.5, 0.9, r)) * 0.8 + (1.0 - smoothstep(0.0, 0.12, abs(r - 0.78))) * 0.4; } // crater
  else if (vShape == 5) { float rr = mix(1.0, 0.35, vP.x); a = (1.0 - smoothstep(0.0, 0.09, abs(r - rr))) * (1.0 - vP.x); } // move marker
  else if (vShape == 6) { a = pow(max(0.0, 1.0 - r), 2.0); }                          // light splat
  else if (vShape == 7) { float ang = atan(vUV.y, vUV.x); a = (1.0 - smoothstep(0.0, 0.1, abs(r - 0.8))) * step(0.0, sin(ang * 4.0 + vP.y * 3.0)); } // attack marker
  else if (vShape == 8) { float ang = atan(vUV.y, vUV.x); a = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.96))) * step(0.0, sin(ang * 18.0 + vP.y)) + (1.0 - smoothstep(0.0, 1.0, r)) * 0.12; } // area ring
  else if (vShape == 9) { vec2 q = abs(vUV); float e = max(q.x, q.y); a = (1.0 - smoothstep(0.0, 0.1, abs(e - 0.93))) + 0.1; } // footprint box
  else if (vShape == 10) { a = (1.0 - smoothstep(0.0, 0.16, abs(r - 0.84))) * (0.75 + 0.25 * n.r) + (1.0 - smoothstep(0.0, 0.84, r)) * 0.12; } // blast shock ring
  else if (vShape == 11) { float ang = atan(vUV.x, -vUV.y) / 6.2831853 + 0.5; a = (1.0 - smoothstep(0.0, 0.035, abs(r - 0.97))) * (step(ang, vP.x) * 0.85 + 0.15) + (1.0 - smoothstep(0.35, 1.0, r)) * 0.07 * (0.6 + 0.8 * n.g); } // effect area + remaining time
  else if (vShape == 12) { float q = r + (n.r - 0.5) * 0.9 - (n.b - 0.5) * 0.4; a = (1.0 - smoothstep(0.35, 0.75, q)) * (0.75 + 0.25 * n.g); } // blood spray / splatter
  // ---- Phase 4.1 range visualization (render/range_viz.js) ----
  else if (vShape == 13) { a = (1.0 - smoothstep(0.0, 0.022, abs(r - 0.975))) + step(r, 1.0) * 0.035; } // support aura: thin ring
  else if (vShape == 14) { a = (1.0 - smoothstep(0.0, 0.03, abs(r - 0.97))) * 0.9 + step(r, 1.0) * 0.1 * (0.7 + 0.6 * n.g); } // processing: ring + light fill
  else if (vShape == 15) { // firing arc: sector of half-angle vP.x (rad) from inner radius vP.y
    float ang = abs(atan(vUV.x, vUV.y));
    float inside = step(ang, vP.x) * step(vP.y, r) * step(r, 1.0);
    float edge = (1.0 - smoothstep(0.0, 0.014, abs(ang - vP.x) * r)) * step(vP.y, r) * step(r, 1.0);
    float rim = (1.0 - smoothstep(0.0, 0.02, abs(r - 0.985))) * step(ang, vP.x);
    float inner = (1.0 - smoothstep(0.0, 0.015, abs(r - vP.y))) * step(ang, vP.x) * step(0.01, vP.y);
    a = inside * 0.13 + max(max(edge, rim), inner) * 0.85;
  }
  else if (vShape == 16) { float ang = atan(vUV.y, vUV.x); a = (1.0 - smoothstep(0.0, 0.018, abs(r - 0.975))) * step(0.0, sin(ang * 48.0)) * 0.6; } // detection: faint dashes
  else if (vShape == 17) { // corpse state badge: vP.x kind, vP.y progress
    int k = int(vP.x + 0.5);
    float back = (1.0 - smoothstep(0.86, 1.0, r)) * 0.5;
    float sym = 0.0;
    vec2 q = vUV;
    if (k == 1) sym = 1.0 - smoothstep(0.26, 0.32, r); // infected, waiting
    else if (k == 2 || k == 3) { // countdown: radial progress + centre mark (diamond for a turning body)
      float ang = atan(q.x, q.y) / 6.2831853 + 0.5;
      float ring = (1.0 - smoothstep(0.0, 0.09, abs(r - 0.72))) * (step(ang, vP.y) * 0.9 + 0.2);
      float mid = k == 3 ? 1.0 - smoothstep(0.24, 0.3, abs(q.x) + abs(q.y)) : 1.0 - smoothstep(0.16, 0.22, r);
      sym = max(ring, mid);
    }
    else if (k == 4) sym = max(1.0 - smoothstep(0.06, 0.1, abs(q.x)) , 1.0 - smoothstep(0.06, 0.1, abs(q.y - 0.12))) * step(abs(q.y), 0.62) * step(abs(q.x), 0.42); // purified: cross
    else if (k == 5 || k == 6) { // risk / imminent: exclamation mark (+ ring when imminent)
      float bar = (1.0 - smoothstep(0.07, 0.11, abs(q.x))) * step(-0.05, q.y) * step(q.y, 0.55);
      float pt = 1.0 - smoothstep(0.08, 0.12, length(q - vec2(0.0, -0.3)));
      sym = max(bar, pt);
      if (k == 6) sym = max(sym, 1.0 - smoothstep(0.0, 0.08, abs(r - 0.82)));
    }
    else if (k == 7) { // usable (check mark)
      float d1 = abs(dot(q - vec2(-0.12, -0.25), normalize(vec2(1.0, -1.0)))) * step(-0.45, q.x) * step(q.x, -0.12);
      float d2 = abs(dot(q - vec2(-0.12, -0.25), normalize(vec2(1.0, 0.62)))) * step(-0.12, q.x) * step(q.x, 0.48);
      sym = max((1.0 - smoothstep(0.07, 0.11, d1)) * step(-0.45, q.x) * step(q.x, -0.1), (1.0 - smoothstep(0.07, 0.11, d2)) * step(-0.14, q.x) * step(q.x, 0.48));
    }
    else if (k == 8) { // not usable (x)
      float d1 = abs(q.x - q.y) * 0.7071, d2 = abs(q.x + q.y) * 0.7071;
      sym = (1.0 - smoothstep(0.06, 0.1, min(d1, d2))) * step(r, 0.62);
    }
    a = max(back, sym);
    c = mix(vec3(0.03, 0.028, 0.025), vColor.rgb, sym);
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  if (uAdditive < 0.5 && vShape != 1 && vShape != 5 && vShape != 7 && vShape != 8 && vShape != 9 && vShape != 11 && vShape < 13) c = fogOfWar(c, vWorld);
  fragColor = vec4(pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)) * a, uAdditive > 0.5 ? 0.0 : a);
}`;

// ------------------------------------------------------------------------------- screen overlay

export const OVERLAY_VS = HEADER + `
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 iRect;   // x, y, w, h (px)
layout(location=5) in vec4 iColor;
layout(location=6) in vec4 iFill;   // fill, style, pips, 0
uniform vec2 uScreen;
out vec2 vUV; out vec4 vColor; out vec4 vFill; out vec2 vSize;
void main() {
  vec2 uv = aCorner * 0.5 + 0.5;
  vec2 px = iRect.xy + uv * iRect.zw;
  vUV = uv;
  vColor = iColor;
  vFill = iFill;
  vSize = iRect.zw;
  gl_Position = vec4(px.x / uScreen.x * 2.0 - 1.0, 1.0 - px.y / uScreen.y * 2.0, 0.0, 1.0);
}`;

export const OVERLAY_FS = HEADER + `
in vec2 vUV; in vec4 vColor; in vec4 vFill; in vec2 vSize;
out vec4 fragColor;
void main() {
  vec2 px = vUV * vSize;
  // the dark rim scales down with the bar: at low render resolution a 1px rim would eat the fill
  float bw = clamp(min(vSize.x, vSize.y) * 0.18, 0.35, 1.0);
  float border = (px.x < bw || px.y < bw || px.x > vSize.x - bw || px.y > vSize.y - bw) ? 1.0 : 0.0;
  vec3 c;
  float a = 0.85;
  if (border > 0.5) { c = vec3(0.02, 0.018, 0.015); a = 0.9; }
  else if (vUV.x <= vFill.x) {
    c = vColor.rgb * (0.85 + 0.25 * (1.0 - vUV.y));
    if (vFill.z > 1.0) { float cell = fract(vUV.x * vFill.z); if (cell > 0.9) c *= 0.35; }
  } else { c = vec3(0.07, 0.06, 0.05); a = 0.75; }
  fragColor = vec4(c, a * vColor.a);
}`;

// ------------------------------------------------------------------------------- vignette (final)

export const VIGNETTE_VS = HEADER + `
layout(location=0) in vec2 aCorner;
out vec2 vUV;
void main() { vUV = aCorner; gl_Position = vec4(aCorner, 0.0, 1.0); }`;

export const VIGNETTE_FS = HEADER + `
uniform vec2 uAspect;
uniform float uStrength;
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec2 q = vUV * uAspect;
  float v = 1.0 - smoothstep(0.55, 1.45, length(q)) * uStrength;
  fragColor = vec4(v, v, v * 1.01, 1.0);
}`;

// ------------------------------------------------------------------------------- debug lines

export const LINE_VS = HEADER + `
layout(location=0) in vec3 aPos;
layout(location=2) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main() { vColor = aColor; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

export const LINE_FS = HEADER + `
in vec4 vColor; out vec4 fragColor;
void main() { fragColor = vColor; }`;
