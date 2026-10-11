/**
 * Daybreak: soft light geometry in a two-tone film look (raw WebGPU + WGSL, no library).
 *
 * Every scene is drawn as one channel of light: sun bursts, spiky stars, twisting ribbons, cones
 * from a beacon, a turning fan, a nebula, a dawn horizon. Shapes sit at different depths, so
 * their edges are soft (analytic depth of field, with a focus pull on every cut). The light is
 * then mapped through a palette gradient (navy → periwinkle → peach → cream by default), which
 * gives the whole picture one printed-film colour scheme. On top, at full resolution: thin line
 * work (circles, arrows, crosses, a beat counter), a starfield, grain and a rounded film gate.
 * Every few bars a cut goes through a black insert with neon strokes drawn on the beat.
 *
 * Passes per frame: field (scene light, at reduced resolution: it is soft anyway) → feedback
 * (motion blur, light trails in drops) → bloom (two levels) → final (gradient map, chromatic
 * aberration, overlays, stars, gate, grain) at full resolution.
 */
import type { AudioFrame } from '../../audio/types';
import { avg, beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { BUF, compileShader, TEX, webgpuFallback as fallback } from '../lib/webgpu';
import type { VisualizerFactory, VisualizerInstance } from '../runtime/types';

// ---------------------------------------------------------------------------------------------
// WGSL

const PRELUDE = /* wgsl */ `
struct U {
  res: vec4f,   // render w, h, aspect, world units per render px
  fres: vec4f,  // field w, h, world units per field px, -
  a: vec4f,     // time, phase, kick, snare
  b: vec4f,     // hat, bass, mid, treble
  cam: vec4f,   // world point at the frame centre (x, y), zoom, roll
  sc: vec4f,    // scene id, seed, defocus, flare
  fx: vec4f,    // exposure, chromatic aberration, feedback blend, light-trail ghost
  fx2: vec4f,   // feedback zoom, black (inserts), grain, gate weave
  fx3: vec4f,   // overlays in screen space (inserts), overlay glow (world), stars, twinkle
  fx4: vec4f,   // bloom gain, fog, energy, drop
  ramp: array<vec4f, 6>, // gradient map stops: rgb, position
  ovCol: vec4f, // overlay colour, primitive count
  sp: array<vec4f, 16>,  // scene parameters
  spec: array<vec4f, 8>, // 32 spectrum bars 0..1
  ov: array<vec4f, 24>,  // 12 overlay primitives: (type, x, y, size), (p1, p2, p3, alpha)
};
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}

const TAU = 6.2831853;

fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn h11(x: f32) -> f32 { return fract(sin(x * 91.3458) * 47453.5453); }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
// coverage of a shape with signed distance d and edge softness w (blur)
fn cover(d: f32, w: f32) -> f32 { return smoothstep(w, -w, d); }
fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
fn sdBox(p: vec2f, b: vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}
`;

// World coordinates: y up, the frame is 2 units high; the camera pans, zooms and rolls.
const CAMERA = /* wgsl */ `
fn screenPos(uv: vec2f) -> vec2f { return vec2f((uv.x - 0.5) * 2.0 * u.res.z, (0.5 - uv.y) * 2.0); }
fn world(uv: vec2f) -> vec2f { return rot2(u.cam.w) * screenPos(uv) / u.cam.z + u.cam.xy; }
`;

const FIELD_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
` + CAMERA + /* wgsl */ `
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), w.x),
             mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var q = p;
  for (var i = 0; i < 4; i++) { v += a * vnoise(q); q = rot2(0.6) * q * 2.03 + vec2f(1.7, 9.2); a *= 0.5; }
  return v;
}
fn spec(i: i32) -> f32 { let k = clamp(i, 0, 31); return u.spec[k / 4][k % 4]; }

// Haze behind everything: dark navy with lighter, slowly drifting patches.
fn fog(p: vec2f) -> f32 {
  let t = u.a.x * 0.025;
  let n = fbm(p * 0.85 + vec2f(t, -t * 0.7) + u.sc.y * 10.0);
  return u.fx4.y * (0.25 + 2.2 * n * n * n);
}

// soft glows (out-of-focus lights): sp[first..last) = (x, y, radius, intensity)
fn glows(p: vec2f, first: i32, last: i32) -> f32 {
  var L = 0.0;
  for (var k = first; k < last; k++) {
    let b = u.sp[k];
    if (b.w <= 0.0) { continue; }
    let d = length(p - b.xy) / b.z;
    L += b.w * exp(-d * d * 2.2);
  }
  return L;
}

// A wedge of light from the origin along angle ang (half-angle hw), fading out towards len.
fn wedge(q: vec2f, ang: f32, hw: f32, len: f32, w: f32) -> f32 {
  let r = length(q);
  var da = atan2(q.y, q.x) - ang;
  da -= TAU * round(da / TAU);
  if (abs(da) > 1.4) { return 0.0; }
  let d = r * sin(abs(da)) - sin(hw) * r;
  return cover(d, w + r * 0.015) * (1.0 - smoothstep(len * 0.4, len, r)) / (1.0 + r * 0.9);
}

// 0 burst: rays from a sun (lengths follow the spectrum), a folded ribbon, a moon.
fn hairpin(q: vec2f, R: f32, tail: f32) -> f32 {
  if (q.x > 0.0) { return max(abs(abs(q.y) - R), q.x - tail); }
  return abs(length(q) - R);
}
fn sceneBurst(p: vec2f, px: f32) -> f32 {
  let c = u.sp[0].xy;
  let q = p - c;
  let r = length(q);
  let a = atan2(q.y, q.x);
  let n = i32(u.sp[1].x);
  let blur = u.sc.z;
  var L = 0.0;
  for (var i = 0; i < n; i++) {
    let fi = f32(i) + u.sc.y * 31.0;
    let h1 = h11(fi * 1.37 + 0.1);
    let h2 = h11(fi * 2.71 + 0.3);
    let h3 = h11(fi * 3.93 + 0.7);
    let ang = u.sp[1].y + (f32(i) + (h1 - 0.5) * 0.7) * TAU / f32(n);
    var da = a - ang;
    da -= TAU * round(da / TAU);
    if (abs(da) > 1.0) { continue; }
    let thin = select(0.0, 1.0, h2 > 0.8); // a few hair-thin threads of light
    let hw = mix(u.sp[1].w * (0.45 + 0.9 * h3), 0.0035, thin);
    let len = u.sp[1].z * (0.5 + 0.8 * h1) * (0.55 + 0.8 * spec(i * 32 / n)) * (1.0 + 0.6 * thin);
    let d = r * sin(abs(da)) - hw * r - 0.003;
    let w = px + blur + r * 0.02;
    let along = 1.0 - smoothstep(len * 0.3, len, r);
    let fib = 0.7 + 0.3 * vnoise(vec2f(da * 70.0 + fi * 5.0, r * 5.0 - u.a.y * 2.0));
    L += cover(d, w) * along * fib * mix(0.8 + 0.6 * h3, 2.0, thin) * 1.5 / (1.0 + r * 1.3);
  }
  let core = u.sp[0].z;
  L += u.sc.w * (6.0 * exp(-r * r / (core * core)) + 0.5 / (1.0 + r * r * 40.0));
  let hp = u.sp[2];
  let hq = u.sp[3];
  if (hq.x > 0.0) {
    let qh = rot2(-hq.z) * (p - hp.xy);
    let d = hairpin(qh, hp.z, hq.y) - hp.w;
    L += hq.x * cover(d, px + blur + hq.w) * (0.75 + 0.45 * vnoise(qh * 7.0));
  }
  let m = u.sp[4];
  if (m.w > 0.0) {
    let qm = p - m.xy;
    let dm = length(qm) - m.z;
    let lit = smoothstep(-m.z, m.z * 0.6, dot(qm, normalize(c - m.xy)));
    L += m.w * (cover(dm, px * 1.5 + blur * 0.3) * (0.2 + 1.3 * lit) + 0.12 * exp(-max(dm, 0.0) * 30.0));
  }
  return L;
}

// 1 stars: concave stars with uneven spikes at different depths, glows, out-of-focus slabs.
fn starSd(q: vec2f, size: f32, ra: f32, n: i32, seed: f32) -> f32 {
  var d = length(q) - size * 0.27;
  for (var j = 0; j < n; j++) {
    let h = h11(seed * 17.0 + f32(j) * 3.1);
    let ang = ra + (f32(j) + (h - 0.5) * 0.4) * TAU / f32(n);
    let dir = vec2f(cos(ang), sin(ang));
    let len = size * (0.75 + 0.9 * h) * select(1.0, 1.8, j == 0);
    let t = dot(q, dir);
    if (t > 0.0) {
      // beyond the tip: the distance to the tip, so blurred spikes fade out instead of ending flat
      let perp = abs(q.x * dir.y - q.y * dir.x);
      d = min(d, select(perp - size * 0.28 * pow(1.0 - t / len, 2.0), length(q - dir * len), t >= len));
    }
  }
  return d;
}
fn sceneStars(p: vec2f, px: f32) -> f32 {
  var L = glows(p, 10, 14);
  for (var k = 14; k < 16; k++) {
    let s = u.sp[k];
    if (s.w <= 0.0) { continue; }
    let qq = rot2(-s.z) * (p - s.xy);
    L += s.w * cover(sdBox(qq, vec2f(1.6, 0.13)), 0.09 + u.sc.z);
  }
  for (var k = 0; k < 5; k++) {
    let A = u.sp[k * 2];
    let B = u.sp[k * 2 + 1];
    if (B.w <= 0.0) { continue; }
    let q = p - A.xy;
    let d = starSd(q, A.z, A.w, i32(B.x), B.y);
    L += B.w * cover(d, px + B.z + u.sc.z) * (0.8 + 0.8 * exp(-length(q) / (A.z * 0.35)));
  }
  return L;
}

// 2 ribbons: twisting bands (thin where they turn edge-on) sweeping through the frame.
fn sceneRibbons(p: vec2f, px: f32) -> f32 {
  var L = glows(p, 12, 16);
  for (var i = 0; i < 4; i++) {
    let A = u.sp[i * 3];
    let B = u.sp[i * 3 + 1];
    let C = u.sp[i * 3 + 2];
    if (C.z <= 0.0) { continue; }
    let q = rot2(-C.w) * p;
    let arg = A.z * q.x + A.w;
    let yc = A.x + A.y * sin(arg);
    let slope = A.y * A.z * cos(arg);
    let dy = (q.y - yc) / sqrt(1.0 + slope * slope);
    let tw = cos(B.y * q.x + B.z);
    let th = B.x * (0.1 + 0.9 * abs(tw));
    let d = max(abs(dy) - th, max(C.x - q.x, q.x - C.y));
    let shade = 0.5 + 0.5 * abs(tw) + 0.3 * smoothstep(-th, th, dy * sign(tw));
    L += C.z * cover(d, px + B.w + u.sc.z) * shade;
  }
  return L;
}

// 3 beacon: cones of light from one bright point, a broad beam from off-frame, lens ghosts.
fn sceneBeacon(p: vec2f, px: f32) -> f32 {
  let ap = u.sp[0];
  let q = p - ap.xy;
  let r = length(q);
  var L = 0.0;
  for (var k = 1; k < 5; k++) {
    let c = u.sp[k];
    if (c.w > 0.0) { L += c.w * wedge(q, c.x, c.y, c.z, px + u.sc.z); }
  }
  let bm = u.sp[5];
  let bm2 = u.sp[6];
  if (bm2.y > 0.0) { L += bm2.y * wedge(p - bm.xy, bm.z, bm.w, bm2.x, px + bm2.z + u.sc.z); }
  let toC = u.cam.xy - ap.xy;
  for (var g = 0; g < 4; g++) {
    let hg = h11(f32(g) + u.sc.y * 3.0);
    let tg = 1.3 + f32(g) * 0.45 + hg * 0.3;
    let gr = 0.03 + 0.12 * hg;
    let d = length(p - (ap.xy + toC * tg)) - gr;
    L += 0.07 * ap.z * cover(d, 0.01 + 0.25 * gr);
  }
  L += ap.z * (5.0 * exp(-r * r / (ap.w * ap.w)) + 0.4 / (1.0 + r * r * 50.0));
  return L;
}

// 4 fan: blades turning around a hub (twisted with the radius), floating discs.
fn sceneFan(p: vec2f, px: f32) -> f32 {
  let c = u.sp[0];
  let q = p - c.xy;
  let r = length(q);
  let n = i32(u.sp[1].x);
  var L = 0.0;
  let a = atan2(q.y, q.x) - c.w * r;
  for (var i = 0; i < n; i++) {
    let h = h11(f32(i) * 5.3 + u.sc.y * 17.0);
    var da = a - (c.z + f32(i) * TAU / f32(n));
    da -= TAU * round(da / TAU);
    if (abs(da) > 1.4) { continue; }
    let l = u.sp[1].z * (0.6 + 0.6 * h);
    let d = r * sin(abs(da)) - sin(u.sp[1].y * (0.6 + 0.6 * h)) * r * (1.0 - 0.35 * r / l);
    L += u.sp[1].w * cover(max(d, max(r - l, 0.035 - r)), px + u.sc.z + 0.004 + r * 0.012) * (1.35 - 0.7 * r / l);
  }
  for (var k = 2; k < 6; k += 2) {
    let E = u.sp[k];
    let F = u.sp[k + 1];
    if (F.y <= 0.0) { continue; }
    let qe = rot2(-F.x) * (p - E.xy);
    let d = (length(qe / E.zw) - 1.0) * min(E.z, E.w);
    L += F.y * cover(d, px + F.z + u.sc.z) * (0.65 + 0.5 * qe.y / E.w);
  }
  L += u.sc.w * (4.0 * exp(-r * r / 0.0016) + 0.3 / (1.0 + r * r * 60.0));
  return L;
}

// 5 nebula: slow clouds (calm passages), glows that bloom on soft kicks.
fn sceneNebula(p: vec2f, px: f32) -> f32 {
  let t = u.a.y * 0.12 + u.a.x * 0.015;
  let w = vec2f(fbm(p * 0.8 + vec2f(t, 1.3)), fbm(p * 0.8 + vec2f(4.1, -t)));
  let n = fbm(p * 1.3 + w * 1.7 + u.sc.y * 7.0);
  var L = 0.08 + u.sp[1].x * pow(n, 2.6);
  for (var k = 2; k < 5; k++) {
    let g = u.sp[k];
    let d = length(p - g.xy) / g.z;
    L += g.w * exp(-d * d * 2.0) * (0.4 + n);
  }
  return L;
}

// 6 horizon: a white plain under a low sun with a cross-shaped flare, a house on the horizon.
fn sceneHorizon(p: vec2f, px: f32) -> f32 {
  let H = u.sp[0];
  let S = u.sp[1];
  let hy = H.x;
  let sun = H.yz;
  let dy = p.y - hy;
  let sky = 0.1 + 0.9 * exp(-max(dy, 0.0) * 3.0) * (0.6 + 0.4 * exp(-abs(p.x - sun.x) * 1.5));
  let z = 0.35 / max(-dy, 0.004);
  let stripe = 0.5 + 0.5 * sin(z * 2.2 - S.y);
  let track = abs(abs((p.x - sun.x * 0.6) * z) - 0.9);
  var ground = (0.55 + 0.9 * exp(dy * 2.5)) * (0.75 + 0.25 * stripe * smoothstep(40.0, 4.0, z));
  ground *= 1.0 - 0.4 * cover(track - 0.05, 0.03 + px * z) * smoothstep(60.0, 8.0, z);
  var L = mix(sky, ground, cover(dy, px + u.sc.z * 0.5));
  let ds = length(p - sun);
  L += S.x * (5.0 * exp(-ds * ds / (H.w * H.w)) + 0.6 / (1.0 + ds * ds * 25.0));
  L += S.x * (0.9 * exp(-abs(p.y - sun.y) * 90.0) * exp(-abs(p.x - sun.x) * 1.0)
            + 0.7 * exp(-abs(p.x - sun.x) * 110.0) * exp(-abs(p.y - sun.y) * 2.2));
  // the house: a dark silhouette with one lit window
  let hq = (p - vec2f(S.z, hy)) / S.w;
  let body = sdBox(hq - vec2f(0.0, 0.5), vec2f(0.6, 0.5));
  let roof = max((hq.y - 1.6 + 0.8 * abs(hq.x)) * 0.78, 1.0 - hq.y);
  L = mix(L, 0.04, 0.95 * cover(min(body, roof) * S.w, px));
  L += 2.5 * cover(sdBox(hq - vec2f(0.18, 0.45), vec2f(0.13, 0.13)) * S.w, px);
  return L;
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let p = world(i.uv);
  let px = u.fres.z / u.cam.z;
  var L = fog(p);
  switch i32(u.sc.x) {
    case 0: { L += sceneBurst(p, px); }
    case 1: { L += sceneStars(p, px); }
    case 2: { L += sceneRibbons(p, px); }
    case 3: { L += sceneBeacon(p, px); }
    case 4: { L += sceneFan(p, px); }
    case 5: { L += sceneNebula(p, px); }
    case 6: { L = sceneHorizon(p, px) + L * 0.3; }
    default: {}
  }
  return vec4f(L, 0.0, 0.0, 1.0);
}
`;

// Motion blur (a blend with the last frame) and, in drops, light trails that stream outwards.
const FEEDBACK_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var cur: texture_2d<f32>;
@group(0) @binding(3) var prev: texture_2d<f32>;

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let s = textureSampleLevel(cur, samp, i.uv, 0.0).r;
  let pr = textureSampleLevel(prev, samp, (i.uv - 0.5) * u.fx2.x + 0.5, 0.0).r;
  return vec4f(max(mix(s, pr, u.fx.z), min(pr, 3.0) * u.fx.w), 0.0, 0.0, 1.0);
}
`;

const BLOOM_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;

fn tap(uv: vec2f) -> f32 { return textureSampleLevel(src, samp, uv, 0.0).r; }
fn box4(uv: vec2f) -> f32 {
  let px = 1.0 / vec2f(textureDimensions(src, 0));
  return (tap(uv + px * vec2f(-1.0, -1.0)) + tap(uv + px * vec2f(1.0, -1.0))
        + tap(uv + px * vec2f(-1.0, 1.0)) + tap(uv + px * vec2f(1.0, 1.0))) * 0.25;
}
// soft knee: only the bright light blooms
@fragment fn fsDown1(i: VSOut) -> @location(0) vec4f { let c = box4(i.uv); return vec4f(c * smoothstep(0.45, 2.0, c), 0.0, 0.0, 1.0); }
@fragment fn fsDown(i: VSOut) -> @location(0) vec4f { return vec4f(box4(i.uv), 0.0, 0.0, 1.0); }
fn blur(uv: vec2f, dir: vec2f) -> vec4f {
  let px = dir / vec2f(textureDimensions(src, 0)) * 1.3;
  var c = tap(uv) * 0.2270;
  c += (tap(uv + px * 1.3846) + tap(uv - px * 1.3846)) * 0.3162;
  c += (tap(uv + px * 3.2308) + tap(uv - px * 3.2308)) * 0.0703;
  return vec4f(c, 0.0, 0.0, 1.0);
}
@fragment fn fsBlurH(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(1.0, 0.0)); }
@fragment fn fsBlurV(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(0.0, 1.0)); }
`;

const FINAL_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var fieldT: texture_2d<f32>;
@group(0) @binding(3) var bloom1: texture_2d<f32>;
@group(0) @binding(4) var bloom2: texture_2d<f32>;
` + CAMERA + /* wgsl */ `
fn light(uv: vec2f) -> f32 {
  return textureSampleLevel(fieldT, samp, uv, 0.0).r
       + (textureSampleLevel(bloom1, samp, uv, 0.0).r * 0.5
       + textureSampleLevel(bloom2, samp, uv, 0.0).r * 0.85) * u.fx4.x;
}
fn tone(L: f32) -> f32 { return 1.0 - exp(-max(L, 0.0) * u.fx.x); }
// the gradient map: light 0..1 through the palette stops
fn ramp(v: f32) -> vec3f {
  var c = u.ramp[0].rgb;
  for (var k = 1; k < 6; k++) { c = mix(c, u.ramp[k].rgb, smoothstep(u.ramp[k - 1].w, u.ramp[k].w, v)); }
  return c;
}

// Thin line work. Returns (core coverage, glow).
fn overlays(p: vec2f, px: f32) -> vec2f {
  var core = 0.0;
  var glow = 0.0;
  let n = i32(u.ovCol.w);
  for (var k = 0; k < n; k++) {
    let A = u.ov[k * 2];
    let B = u.ov[k * 2 + 1];
    let q = p - A.yz;
    let s = A.w;
    var d = 1e3;
    var wmul = 1.0;
    var lit = 1.0;
    switch i32(A.x) {
      case 1: { // arc: radius s, start angle p1, length p2, width p3
        var t = atan2(q.y, q.x) - B.x;
        t -= TAU * floor(t / TAU);
        if (B.y >= TAU || t <= B.y) { d = abs(length(q) - s); }
        else {
          let e0 = s * vec2f(cos(B.x), sin(B.x));
          let e1 = s * vec2f(cos(B.x + B.y), sin(B.x + B.y));
          d = min(length(q - e0), length(q - e1));
        }
        wmul = B.z;
      }
      case 2: { // plus: size s, rotation p1
        let a = abs(rot2(-B.x) * q);
        d = min(max(a.x - s, a.y), max(a.y - s, a.x));
      }
      case 3: { // arrow pointing along p1
        let a = rot2(-B.x) * q;
        d = min(sdSeg(a, vec2f(-s, 0.0), vec2f(s, 0.0)),
            min(sdSeg(a, vec2f(s, 0.0), vec2f(s * 0.4, s * 0.45)), sdSeg(a, vec2f(s, 0.0), vec2f(s * 0.4, -s * 0.45))));
      }
      case 4: { // row of p1 squares, square p2 filled
        let spc = s * 1.75;
        let kk = clamp(round(q.x / spc), 0.0, B.x - 1.0);
        let bx = sdBox(q - vec2f(kk * spc, 0.0), vec2f(s * 0.5));
        d = select(abs(bx), bx, kk == B.y);
      }
      case 5: { // four-point sparkle
        let a = abs(rot2(-B.x) * q) / s;
        d = (pow(a.x, 0.6667) + pow(a.y, 0.6667) - 1.0) * s * 0.45;
      }
      case 6: { // segment to (p1, p2), width p3
        d = sdSeg(p, A.yz, B.xy);
        wmul = B.z;
      }
      case 7: { // row of p1 rings, the first p2 lit
        let spc = s * 3.4;
        let kk = clamp(round(q.x / spc), 0.0, B.x - 1.0);
        d = abs(length(q - vec2f(kk * spc, 0.0)) - s);
        lit = select(0.1, 1.0, kk < B.y);
        wmul = B.z;
      }
      default: {}
    }
    let a = B.w * lit;
    let hw = px * 0.7 * wmul;
    core += a * clamp((hw - d) / px + 0.5, 0.0, 1.0);
    glow += a * exp(-max(d - hw, 0.0) / u.fx3.y) * 0.55;
  }
  return vec2f(min(core, 1.0), glow);
}

// A sparse starfield (crisp, at full resolution), twinkling, faster on hi-hats.
fn stars(p: vec2f, px: f32) -> f32 {
  let g = 0.05;
  let cell = floor(p / g);
  let h = hash21(cell + 3.1);
  if (h < 0.84) { return 0.0; }
  let o = (vec2f(hash21(cell + 7.7), hash21(cell + 1.9)) * 0.7 + 0.15) * g;
  let d = length(p - cell * g - o);
  let tw = 0.6 + 0.4 * sin(u.a.x * (1.3 + 4.0 * h) + h * 50.0) + u.fx3.w * (hash21(cell + floor(u.a.x * 20.0)) - 0.3);
  return smoothstep(px * 1.6, 0.0, d) * max(tw, 0.0) * (0.35 + 3.5 * (h - 0.84));
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let t = u.a.x;
  let uv = i.uv + vec2f(0.0, u.fx2.w);
  let dir = uv - 0.5;
  let ca = u.fx.y * (0.25 + dot(dir, dir) * 2.0);
  let lr = tone(light(uv + dir * ca));
  let lg = tone(light(uv));
  let lb = tone(light(uv - dir * ca));
  var col = vec3f(ramp(lr).r, ramp(lg).g, ramp(lb).b);

  let p = world(uv);
  let px = u.res.w / u.cam.z;
  col += u.ovCol.rgb * stars(p, px) * u.fx3.z * (1.0 - smoothstep(0.2, 0.5, lg));
  col *= 1.0 - u.fx2.y; // inserts: a black frame
  var ov: vec2f;
  if (u.fx3.x > 0.5) { ov = overlays(screenPos(uv), u.res.w); } else { ov = overlays(p, px); }
  col += u.ovCol.rgb * (ov.x + ov.y);

  // The film gate: rounded corners, a soft dark edge, vignette.
  let asp = u.res.z;
  let fq = abs(dir) * 2.0 * vec2f(asp, 1.0);
  let rr = 0.12;
  let fd = length(max(fq - vec2f(asp, 1.0) + rr + 0.012, vec2f(0.0))) - rr;
  col *= smoothstep(0.0, -0.035, fd);
  col *= mix(0.4, 1.0, smoothstep(1.75, 0.35, length(dir * vec2f(1.45, 1.85))));

  // grain (24 fps, strongest in the mid-tones) and a little dither against banding
  let gs = i.pos.xy + vec2f(floor(t * 24.0) * 37.0, 0.0);
  let l = dot(col, vec3f(0.3, 0.55, 0.15));
  col += (hash21(gs) - 0.5) * u.fx2.z * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
  col += (hash21(gs + 17.0) - 0.5) / 255.0;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Palettes: gradient maps from shadow to highlight. The reference look (navy → peach) and the
// blues come up most.

type V3 = [number, number, number];
interface Palette { name: string; stops: V3[]; weight: number }
const RAMP_POS = [0, 0.16, 0.34, 0.52, 0.72, 1];

const PALETTES: Palette[] = [
  { name: 'dawn', weight: 3, stops: [[0.004, 0.006, 0.03], [0.05, 0.075, 0.25], [0.2, 0.26, 0.58], [0.58, 0.52, 0.64], [0.95, 0.72, 0.47], [1, 0.97, 0.9]] },
  { name: 'ultramarine', weight: 2, stops: [[0.002, 0.004, 0.03], [0.01, 0.04, 0.3], [0.06, 0.2, 0.85], [0.35, 0.55, 1], [0.76, 0.88, 1], [0.97, 0.99, 1]] },
  { name: 'glacier', weight: 1.5, stops: [[0, 0.008, 0.018], [0, 0.07, 0.15], [0.04, 0.32, 0.48], [0.28, 0.72, 0.82], [0.74, 0.96, 1], [0.97, 1, 1]] },
  { name: 'rose', weight: 1, stops: [[0.018, 0.002, 0.03], [0.12, 0.03, 0.2], [0.42, 0.15, 0.45], [0.86, 0.45, 0.6], [1, 0.78, 0.72], [1, 0.97, 0.93]] },
  { name: 'ember', weight: 1, stops: [[0.01, 0.002, 0.002], [0.13, 0.015, 0.02], [0.46, 0.06, 0.04], [0.9, 0.33, 0.08], [1, 0.73, 0.32], [1, 0.97, 0.86]] },
  { name: 'verdigris', weight: 1, stops: [[0, 0.014, 0.014], [0.02, 0.1, 0.1], [0.08, 0.32, 0.3], [0.45, 0.6, 0.42], [0.95, 0.85, 0.55], [1, 0.98, 0.9]] },
  { name: 'silver', weight: 0.6, stops: [[0.008, 0.008, 0.01], [0.07, 0.075, 0.09], [0.25, 0.26, 0.3], [0.55, 0.56, 0.6], [0.86, 0.86, 0.88], [1, 1, 1]] },
];

function pickPalette(not: string): Palette {
  const pool = PALETTES.filter(p => p.name !== not);
  let r = Math.random() * pool.reduce((s, p) => s + p.weight, 0);
  for (const p of pool) if ((r -= p.weight) <= 0) return p;
  return pool[0];
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const k = t * t * (3 - 2 * t);
  return { name: b.name, weight: b.weight, stops: a.stops.map((s, i) => s.map((v, j) => v + (b.stops[i][j] - v) * k) as V3) };
}

/** Rotate an RGB colour around the grey axis (YIQ), for the hue-shift setting. */
function hueRotate(c: V3, deg: number): V3 {
  if (!deg) return c;
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const i = 0.596 * c[0] - 0.274 * c[1] - 0.322 * c[2];
  const q = 0.211 * c[0] - 0.523 * c[1] + 0.312 * c[2];
  const i2 = i * cs - q * sn, q2 = i * sn + q * cs;
  return [
    Math.max(0, y + 0.956 * i2 + 0.621 * q2),
    Math.max(0, y - 0.272 * i2 - 0.647 * q2),
    Math.max(0, y - 1.106 * i2 + 1.703 * q2),
  ];
}

// ---------------------------------------------------------------------------------------------
// Scenes. Each one lays itself out from a seeded random source when it is entered, then writes
// its shader parameters (sp, 16 vec4) and line work (overlay primitives) every frame.

const TAU = Math.PI * 2;
const OV = { ARC: 1, PLUS: 2, ARROW: 3, SQUARES: 4, SPARKLE: 5, SEGMENT: 6, RINGS: 7 } as const;
const MAX_PRIMS = 12;

interface SceneIn {
  t: number; dt: number; local: number; sceneTime: number; spin: number;
  pulse: number; kick: number; snare: number; hat: number; bass: number; mid: number; treble: number;
  energy: number; drop: number; barBeat: number; kickHit: boolean;
  ax: number; // half the frame width in world units
  scale: number;
}
interface Look { flare: number; fog: number; defocus: number; stars: number; zoom?: number; spectrum?: boolean }
type Prim = (type: number, x: number, y: number, s: number, p1?: number, p2?: number, p3?: number, alpha?: number) => void;
interface Scene {
  name: string;
  beats: number;
  calm: boolean; // fits a quiet passage
  enter(rnd: () => number): void;
  frame(s: SceneIn, sp: Float32Array, prim: Prim): Look;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (r: () => number, a: number, b: number) => a + (b - a) * r();
const sgn = (r: () => number) => (r() < 0.5 ? -1 : 1);

function burstScene(): Scene {
  let cx = 0, cy = 0, n = 22, w = 0.04, rot0 = 0, dir = 1, ribbon = 0, ribbonSide = 1, moon = 0, mx = 0, my = 0, spark: V3[] = [];
  return {
    name: 'burst', beats: 16, calm: false,
    enter(r) {
      cx = range(r, -0.35, 0.15); cy = range(r, -0.12, 0.15);
      n = 16 + Math.floor(r() * 11); w = range(r, 0.035, 0.065); rot0 = r() * TAU; dir = sgn(r);
      ribbon = r() < 0.65 ? 1 : 0; ribbonSide = sgn(r);
      moon = r() < 0.6 ? 1 : 0; mx = range(r, 0.3, 0.75); my = range(r, 0.5, 0.75);
      spark = [0, 1, 2].map(() => [range(r, -1, 1), range(r, -0.8, 0.8), r() * 10] as V3);
    },
    frame(s, sp, prim) {
      const x = cx + 0.04 * Math.sin(s.local * 0.37), y = cy + 0.03 * Math.cos(s.local * 0.29);
      const ang = rot0 + dir * (s.local * 0.06 + s.spin * 0.35);
      sp.set([x, y, (0.035 + 0.02 * s.bass) * s.scale, 0], 0);
      sp.set([n, ang, (1.3 + 0.45 * s.kick + 0.3 * s.pulse) * s.scale, w], 4);
      if (ribbon) {
        sp.set([ribbonSide * s.ax * 0.72 + 0.1 * Math.sin(s.local * 0.4), y - 0.05, 0.22 * s.scale, (0.045 + 0.012 * s.mid) * s.scale], 8);
        sp.set([0.9 + 0.4 * s.mid, 1.4, (ribbonSide < 0 ? Math.PI : 0) + 0.15 * Math.sin(s.local * 0.3), 0.004], 12);
      }
      if (moon) sp.set([mx * s.ax, my, 0.035 * s.scale, 1.1], 16);
      prim(OV.ARC, x, y, (0.3 + 0.06 * s.kick) * s.scale, -s.spin * 0.2 + 0.6, TAU * 0.78, 1, 0.45);
      prim(OV.PLUS, x + 0.44 * s.scale, y - 0.2 * s.scale, 0.018, 0, 0, 1, 0.75);
      for (const [px, py, ph] of spark) prim(OV.SPARKLE, px * s.ax, py, 0.022, 0.2, 0, 1, Math.max(0, 0.25 + 0.6 * Math.sin(s.t * 1.7 + ph) + 0.8 * s.hat));
      return { flare: 1 + 1.6 * s.kick + 0.8 * s.pulse, fog: 0.16, defocus: 0.004, stars: 0.7, spectrum: true };
    },
  };
}

function starsScene(): Scene {
  type Star = { x: number; y: number; size: number; rot: number; rs: number; n: number; seed: number; blur: number; i: number; vx: number; vy: number };
  let stars: Star[] = [], glows: number[][] = [], slab: number[] = [], sparks: V3[] = [];
  return {
    name: 'stars', beats: 16, calm: true,
    enter(r) {
      const count = 3 + Math.floor(r() * 3);
      stars = Array.from({ length: count }, (_, k) => ({
        x: range(r, -1.1, 1.1), y: range(r, -0.7, 0.7), size: k === 0 ? range(r, 0.3, 0.45) : range(r, 0.1, 0.3),
        rot: r() * TAU, rs: range(r, 0.05, 0.2) * sgn(r), n: 4 + Math.floor(r() * 3), seed: r() * 100,
        blur: k === 0 ? 0.002 : range(r, 0.01, 0.07), i: range(r, 0.9, 1.4), vx: range(r, -0.06, 0.06), vy: range(r, -0.04, 0.04),
      }));
      glows = [0, 1, 2, 3].map(() => [range(r, -1.3, 1.3), range(r, -0.8, 0.8), range(r, 0.25, 0.55), range(r, 0.2, 0.55)]);
      slab = r() < 0.6 ? [range(r, -0.6, 0.6), range(r, -0.7, 0.7), range(r, -0.9, 0.9), range(r, 0.5, 0.9)] : [0, 0, 0, 0];
      sparks = [0, 1, 2, 3].map(() => [range(r, -1, 1), range(r, -0.85, 0.85), r() * 10] as V3);
    },
    frame(s, sp, prim) {
      const lim = s.ax + 0.5;
      const wrap = (v: number, l: number) => ((((v + l) % (2 * l)) + 2 * l) % (2 * l)) - l;
      stars.forEach((st, k) => {
        const x = wrap(st.x * s.ax + st.vx * s.local, lim), y = wrap(st.y + st.vy * s.local, 1.4);
        sp.set([x, y, st.size * s.scale * (1 + 0.14 * s.kick + 0.06 * s.pulse), st.rot + st.rs * s.local + s.spin * 0.5 * (k % 2 ? 1 : -1)], k * 8);
        sp.set([st.n, st.seed, st.blur, st.i * (0.85 + 0.3 * s.snare)], k * 8 + 4);
      });
      glows.forEach((g, k) => sp.set([g[0] * s.ax + 0.05 * Math.sin(s.local * 0.3 + k), g[1], g[2] * (1 + 0.25 * s.bass), g[3] * (0.8 + 0.6 * s.mid)], (10 + k) * 4));
      sp.set([slab[0] + 0.3 * Math.sin(s.local * 0.1), slab[1], slab[2], slab[3]], 56);
      for (const [px, py, ph] of sparks) prim(OV.SPARKLE, px * s.ax, py, 0.02, 0, 0, 1, Math.max(0, 0.2 + 0.6 * Math.sin(s.t * 2.1 + ph) + 0.9 * s.hat));
      prim(OV.PLUS, sparks[0][0] * s.ax * 0.6, sparks[1][1] * 0.6, 0.016, 0, 0, 1, 0.7);
      // a shooting line now and then
      const shoot = (s.sceneTime % 5) / 5;
      if (shoot < 0.25) {
        const k = shoot / 0.25, x0 = -s.ax * 0.9 + k * s.ax * 1.4, y0 = 0.6 - k * 0.5;
        prim(OV.SEGMENT, x0, y0, 0, x0 + 0.3, y0 - 0.1, 0.8, Math.sin(k * Math.PI) * 0.8);
      }
      return { flare: 1, fog: 0.17, defocus: 0, stars: 1 };
    },
  };
}

function ribbonsScene(): Scene {
  type Rib = { y: number; amp: number; f: number; ph: number; th: number; tf: number; tp: number; blur: number; x0: number; len: number; i: number; slant: number; v: number };
  let ribs: Rib[] = [], glows: number[][] = [], orbitY = -2.4;
  return {
    name: 'ribbons', beats: 16, calm: true,
    enter(r) {
      const slant = range(r, -0.4, 0.4);
      const count = 3 + Math.floor(r() * 2);
      ribs = Array.from({ length: count }, (_, k) => ({
        y: -0.55 + (1.1 * (k + range(r, 0.2, 0.8))) / count, amp: range(r, 0.04, 0.16), f: range(r, 1.4, 3), ph: r() * TAU,
        th: range(r, 0.05, 0.11), tf: range(r, 1.2, 3.5), tp: r() * TAU, blur: k === 1 ? 0.002 : range(r, 0.01, 0.06),
        x0: range(r, -2.5, -0.5), len: range(r, 1.2, 2.6), i: range(r, 0.9, 1.4), slant: slant + range(r, -0.08, 0.08), v: range(r, 0.25, 0.5),
      }));
      glows = [0, 1, 2, 3].map(() => [range(r, -1.3, 1.3), range(r, -0.8, 0.8), range(r, 0.3, 0.6), range(r, 0.2, 0.5)]);
      orbitY = range(r, -2.6, -2);
    },
    frame(s, sp, prim) {
      const span = 2 * s.ax + 3;
      ribs.forEach((rb, k) => {
        const x0 = ((((rb.x0 + rb.v * s.local + span / 2) % span) + span) % span) - span / 2 - 0.5;
        sp.set([rb.y, rb.amp * (1 + 0.5 * s.bass), rb.f, rb.ph + s.local * 0.9], k * 12);
        sp.set([rb.th * s.scale * (1 + 0.25 * s.kick), rb.tf, rb.tp + s.local * (0.5 + 0.6 * s.mid) + s.spin * 0.3, rb.blur], k * 12 + 4);
        sp.set([x0, x0 + rb.len * s.scale, rb.i, rb.slant], k * 12 + 8);
      });
      glows.forEach((g, k) => sp.set([g[0] * s.ax, g[1] + 0.05 * Math.sin(s.local * 0.4 + k), g[2], g[3] * (0.8 + 0.6 * s.mid)], (12 + k) * 4));
      prim(OV.ARC, 0, orbitY, 2.75, 1.0 + s.local * 0.02, 1.1, 1, 0.35);
      prim(OV.ARC, 0.4, orbitY - 0.2, 2.9, 1.2 + s.local * 0.015, 0.9, 1, 0.2);
      prim(OV.PLUS, -0.55 * s.ax, 0.55, 0.016, 0, 0, 1, 0.6);
      return { flare: 1, fog: 0.17, defocus: 0, stars: 0.6 };
    },
  };
}

function beaconScene(): Scene {
  let ax0 = 0, ay0 = 0, cones: number[][] = [], beam: number[] = [], sway = 0;
  return {
    name: 'beacon', beats: 8, calm: false,
    enter(r) {
      ax0 = range(r, -0.2, 0.2); ay0 = range(r, -0.15, 0.15);
      // a V of cones one way, one or two the other way
      const base = r() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      cones = [
        [base - range(r, 0.25, 0.5), range(r, 0.06, 0.14), range(r, 1.8, 2.6), range(r, 1, 1.35)],
        [base + range(r, 0.25, 0.5), range(r, 0.06, 0.14), range(r, 1.8, 2.6), range(r, 1, 1.35)],
        [base + Math.PI + range(r, -0.5, 0.5), range(r, 0.08, 0.18), range(r, 1.2, 2), range(r, 0.8, 1.1)],
        r() < 0.5 ? [base + Math.PI + range(r, 0.6, 1.1) * sgn(r), range(r, 0.03, 0.07), range(r, 1.5, 2.4), 1] : [0, 0, 0, 0],
      ];
      beam = [sgn(r) * 1.6, range(r, 0.6, 1.1), 0, range(r, 0.12, 0.2)];
      beam[2] = Math.atan2(ay0 - beam[1], ax0 - beam[0]) + range(r, -0.3, 0.3);
      sway = r() * TAU;
    },
    frame(s, sp, prim) {
      const x = ax0 + 0.05 * Math.sin(s.local * 0.3), y = ay0 + 0.03 * Math.cos(s.local * 0.4);
      sp.set([x, y, 1 + 1.5 * s.kick + 0.6 * s.pulse, 0.03 * s.scale], 0);
      cones.forEach((c, k) => {
        sp.set([c[0] + 0.25 * Math.sin(s.local * 0.5 + sway + k * 1.7) * 0.6 + s.spin * 0.12, c[1], c[2] * s.scale * (1 + 0.3 * s.kick), c[3]], 4 + k * 4);
      });
      sp.set([beam[0] * s.ax, beam[1], beam[2] + 0.1 * Math.sin(s.local * 0.2), beam[3]], 20);
      sp.set([3.2, 0.55 + 0.3 * s.bass, 0.05, 0], 24);
      prim(OV.SQUARES, x + 0.07, y + 0.05, 0.02, 4, s.barBeat, 1, 0.85);
      prim(OV.ARC, x + 0.6, y - 0.42, 0.73, 1.9 + s.local * 0.05, 1.3, 1, 0.4);
      prim(OV.ARROW, x - 0.32, y + 0.04, 0.03, Math.PI, 0, 1, 0.65);
      return { flare: 1, fog: 0.15, defocus: 0.002, stars: 0.6 };
    },
  };
}

function fanScene(): Scene {
  let cx = 0, cy = 0, n = 6, hw = 0.16, len = 1.9, twist = 1, rot0 = 0, dir = 1, discs: number[][] = [];
  return {
    name: 'fan', beats: 16, calm: false,
    enter(r) {
      cx = range(r, -0.25, 0.25); cy = range(r, -0.15, 0.15);
      n = 4 + Math.floor(r() * 4); hw = range(r, 0.13, 0.24); len = range(r, 1.6, 2.3);
      twist = range(r, 0.15, 0.55) * sgn(r); rot0 = r() * TAU; dir = sgn(r);
      discs = [0, 1].map(() => [range(r, 0.45, 0.9), r() * TAU, range(r, 0.18, 0.32), range(r, 0.06, 0.11), range(r, 0.01, 0.06)]);
    },
    frame(s, sp, prim) {
      const rot = rot0 + dir * (s.local * 0.35 + s.spin * 0.8);
      sp.set([cx, cy, rot, twist], 0);
      sp.set([n, hw, len * s.scale * (1 + 0.15 * s.bass), 0.7 + 0.3 * s.kick], 4);
      discs.forEach((d, k) => {
        const th = d[1] + dir * s.local * 0.25;
        sp.set([cx + Math.cos(th) * d[0] * s.ax * 0.8, cy + Math.sin(th) * d[0] * 0.55, d[2] * s.scale, d[3] * s.scale], 8 + k * 8);
        sp.set([th * 0.5, 0.95, d[4], 0], 12 + k * 8);
      });
      const R = (0.42 + 0.05 * s.kick) * s.scale;
      prim(OV.ARC, cx, cy, R, 0, TAU, 1, 0.38);
      prim(OV.ARC, cx, cy, R * 1.12, rot * 0.5, 0.5, 1, 0.5);
      for (let k = 0; k < 2; k++) {
        const a = rot * 0.5 + k * Math.PI + 0.9;
        prim(OV.ARROW, cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3, 0.03, a + (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0, 1, 0.6);
      }
      prim(OV.PLUS, cx, cy, 0.022, rot * 0.25, 0, 1, 0.5);
      return { flare: 1 + 1.2 * s.kick + 0.5 * s.pulse, fog: 0.15, defocus: 0.003, stars: 0.4 };
    },
  };
}

function nebulaScene(): Scene {
  let next = 0;
  const glows: number[][] = [[0, 0, 0.3, 0], [0, 0, 0.3, 0], [0, 0, 0.3, 0]];
  let rnd: () => number = Math.random;
  return {
    name: 'nebula', beats: 16, calm: true,
    enter(r) { rnd = r; for (const g of glows) g[3] = 0; },
    frame(s, sp, prim) {
      sp.set([0, 0, 0, 0, 0.75 + 0.45 * s.mid + 0.3 * s.bass, 0, 0, 0], 0);
      // soft kicks light up the clouds from inside
      if (s.kickHit) {
        const g = glows[next++ % glows.length];
        g[0] = range(rnd, -s.ax * 0.8, s.ax * 0.8); g[1] = range(rnd, -0.6, 0.6); g[2] = range(rnd, 0.2, 0.45); g[3] = 0.9;
      }
      glows.forEach((g, k) => { g[3] *= Math.exp(-s.dt / 0.5); sp.set(g, 8 + k * 4); });
      prim(OV.PLUS, -0.6 * s.ax, 0.35, 0.016, 0, 0, 1, 0.5);
      prim(OV.ARC, 0.5 * s.ax, -0.3, 0.12, s.local * 0.3, 4.5, 1, 0.3);
      return { flare: 1, fog: 0.12, defocus: 0, stars: 1.3 };
    },
  };
}

function horizonScene(): Scene {
  let sunX = 0, house = 0;
  return {
    name: 'horizon', beats: 16, calm: true,
    enter(r) { sunX = range(r, -0.6, 0.6); house = range(r, -0.35, 0.35); },
    frame(s, sp, prim) {
      const hy = -0.18 + 0.03 * Math.sin(s.local * 0.2);
      sp.set([hy, sunX * s.ax, hy + 0.3, (0.05 + 0.02 * s.bass) * s.scale], 0);
      sp.set([1 + 1.2 * s.kick + 0.5 * s.pulse, s.local * 3, house * s.ax, 0.055 * s.scale], 4);
      prim(OV.PLUS, sunX * s.ax, hy + 0.3, 0.05 + 0.02 * s.kick, 0, 0, 0.8, 0.35);
      return { flare: 1, fog: 0.12, defocus: 0, stars: 0.9 };
    },
  };
}

const SCENES: Scene[] = [burstScene(), starsScene(), ribbonsScene(), beaconScene(), fanScene(), nebulaScene(), horizonScene()];

// Black inserts between scenes: neon strokes drawn on during one beat (screen space).
const INSERTS: ((k: number, ax: number, prim: Prim) => void)[] = [
  (k, ax, prim) => { // two arcs drawing on
    prim(OV.ARC, -0.25, -0.05, 0.6, 2.2, 0.15 + 3.6 * k, 2.4, 1);
    prim(OV.ARC, 0.25, 0.2, 0.32, -0.6, 0.1 + 1.8 * k, 1.6, 0.8);
  },
  (k, ax, prim) => { // a row of rings lighting up, left to right
    const n = 13, r = Math.min(0.035, ax / 22);
    prim(OV.RINGS, -(n - 1) * r * 1.7, 0, r, n, Math.ceil(k * n), 2.2, 1);
  },
  (k, ax, prim) => { // parallel slashes sliding through
    for (let i = 0; i < 3; i++) {
      const o = (k * 2.6 - 1.3) + i * 0.2, x = o * ax * 0.6, y = -o * 0.9 + (i - 1) * 0.12;
      prim(OV.SEGMENT, x - 0.35, y - 0.5, 0, x + 0.35, y + 0.5, 2.2, i === 1 ? 1 : 0.6);
    }
  },
  (k, ax, prim) => { // a dial: a circle drawing on around a turning arrow
    prim(OV.ARC, 0, 0, 0.1, Math.PI / 2, 0.3 + 5.2 * k, 2, 1);
    prim(OV.ARROW, 0, 0, 0.05, Math.PI / 4 + k * Math.PI * 0.5, 0, 2, 1);
  },
];

// ---------------------------------------------------------------------------------------------

const UNIFORM_FLOATS = 260;
const MAX_RENDER_PIXELS = 2560 * 1440;
const FIELD_SCALE = 0.7, MAX_FIELD_PIXELS = 1600 * 900;

const Daybreak: VisualizerFactory = async ({ container }) => {
  const gpu = navigator.gpu;
  if (!gpu) return fallback(container, 'This browser has no WebGPU (try Chrome, Edge or Safari 26+).');
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return fallback(container, 'No WebGPU adapter: enable hardware acceleration.');
  const device = await adapter.requestDevice();

  const canvas = document.createElement('canvas');
  canvas.className = 'w-full h-full block';
  container.appendChild(canvas);
  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  let disposed = false;
  let lost: VisualizerInstance | null = null;
  void device.lost.then(info => {
    if (disposed) return;
    canvas.remove();
    lost = fallback(container, `WebGPU device lost (${info.reason || 'unknown'}).`);
    lost.resize?.(container.clientWidth, container.clientHeight, Math.min(2, window.devicePixelRatio || 1));
  });

  // --- shaders and pipelines -----------------------------------------------------------------
  device.pushErrorScope('validation');
  const [fieldMod, feedbackMod, bloomMod, finalMod] = await Promise.all([
    compileShader(device, FIELD_WGSL, 'daybreak-field'), compileShader(device, FEEDBACK_WGSL, 'daybreak-feedback'),
    compileShader(device, BLOOM_WGSL, 'daybreak-bloom'), compileShader(device, FINAL_WGSL, 'daybreak-final'),
  ]);
  const LIGHT: GPUTextureFormat = 'r16float';
  const pipe = (module: GPUShaderModule, entryPoint: string, fmt: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint, targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
  const [fieldPipe, feedbackPipe, down1Pipe, downPipe, blurHPipe, blurVPipe, finalPipe] = await Promise.all([
    pipe(fieldMod, 'fs', LIGHT), pipe(feedbackMod, 'fs', LIGHT),
    pipe(bloomMod, 'fsDown1', LIGHT), pipe(bloomMod, 'fsDown', LIGHT),
    pipe(bloomMod, 'fsBlurH', LIGHT), pipe(bloomMod, 'fsBlurV', LIGHT),
    pipe(finalMod, 'fs', format),
  ]);
  const setupError = await device.popErrorScope();
  if (setupError) throw new Error(`Daybreak: ${setupError.message}`);

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const uniformData = new Float32Array(UNIFORM_FLOATS);
  const uniformBuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });

  // --- render targets --------------------------------------------------------------------------
  let W = 2, H = 2, FW = 2, FH = 2, aspect = 1;
  let targets: GPUTexture[] = [];
  let fieldTex!: GPUTexture, accum!: GPUTexture[], b1a!: GPUTexture, b1b!: GPUTexture, b2a!: GPUTexture, b2b!: GPUTexture;
  let bg!: {
    field: GPUBindGroup; feedback: GPUBindGroup[]; down1: GPUBindGroup[];
    blurH1: GPUBindGroup; blurV1: GPUBindGroup; down2: GPUBindGroup; blurH2: GPUBindGroup; blurV2: GPUBindGroup;
    final: GPUBindGroup[];
  };

  function build(w: number, h: number, dpr: number) {
    const cssW = Math.max(1, w), cssH = Math.max(1, h);
    let s = dpr;
    if (cssW * cssH * s * s > MAX_RENDER_PIXELS) s = Math.sqrt(MAX_RENDER_PIXELS / (cssW * cssH));
    W = Math.max(2, Math.round(cssW * s));
    H = Math.max(2, Math.round(cssH * s));
    aspect = W / H;
    canvas.width = W;
    canvas.height = H;
    // the light field is soft, so it renders at a lower resolution; line work stays sharp
    let fs = FIELD_SCALE;
    if (W * H * fs * fs > MAX_FIELD_PIXELS) fs = Math.sqrt(MAX_FIELD_PIXELS / (W * H));
    FW = Math.max(2, Math.round(W * fs));
    FH = Math.max(2, Math.round(H * fs));

    for (const t of targets) t.destroy();
    targets = [];
    const tex = (tw: number, th: number) => {
      const t = device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: LIGHT, usage: TEX.RENDER_ATTACHMENT | TEX.TEXTURE_BINDING });
      targets.push(t);
      return t;
    };
    fieldTex = tex(FW, FH);
    accum = [tex(FW, FH), tex(FW, FH)];
    b1a = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));
    b1b = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));
    b2a = tex(Math.ceil(FW / 16), Math.ceil(FH / 16));
    b2b = tex(Math.ceil(FW / 16), Math.ceil(FH / 16));

    const group = (p: GPURenderPipeline, res: GPUBindingResource[]) => device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: res.map((resource, binding) => ({ binding, resource })),
    });
    const v = (t: GPUTexture) => t.createView();
    const U = { buffer: uniformBuf };
    bg = {
      field: group(fieldPipe, [U]),
      feedback: [0, 1].map(i => group(feedbackPipe, [U, sampler, v(fieldTex), v(accum[1 - i])])),
      down1: [0, 1].map(i => group(down1Pipe, [sampler, v(accum[i])])),
      blurH1: group(blurHPipe, [sampler, v(b1a)]),
      blurV1: group(blurVPipe, [sampler, v(b1b)]),
      down2: group(downPipe, [sampler, v(b1a)]),
      blurH2: group(blurHPipe, [sampler, v(b2a)]),
      blurV2: group(blurVPipe, [sampler, v(b2b)]),
      final: [0, 1].map(i => group(finalPipe, [U, sampler, v(accum[i]), v(b1a), v(b2a)])),
    };
  }

  // --- animation state -------------------------------------------------------------------------
  let local = 0, sceneTime = 0, spin = 0, spinVel = 0;
  let pulse = 0, punch = 0, flash = 0, kickS = 0, snareS = 0, hatS = 0, bassS = 0, midS = 0, trebleS = 0, energyS = 0;
  let rollSign = 1, rollTarget = 0, rollKick = 0;
  let eFast = -1, eSlow = 0, eWarm = 0, drop = 0, buildUp = 0, dropArmed = true;
  let barsInScene = 0, beatsInScene = 0, sceneIdx = 0, seed = Math.random(), cur = 0;
  let insert: { type: number; t: number; dur: number } | null = null, lastInsertType = -1, lastInsertAt = -1e9, black = 0;
  const bars = new Float32Array(32);
  const barLo = new Float32Array(32), barHi = new Float32Array(32).fill(0.3);
  const params = new URLSearchParams(window.location.search);
  const lockedPal = PALETTES.find(p => p.name === params.get('palette')) ?? null;
  const locked = SCENES.findIndex(sc => sc.name === params.get('scene'));
  let palFrom = lockedPal ?? PALETTES[0], palTo = palFrom, palMix = 1, firstScene = true;

  const palette = () => (palMix >= 1 ? palTo : mixPalette(palFrom, palTo, palMix));
  function setPalette(p: Palette, fade: boolean) {
    palFrom = fade ? palette() : p;
    palTo = p;
    palMix = fade ? 0 : 1;
  }

  function enterScene(idx: number) {
    sceneIdx = idx;
    beatsInScene = 0;
    barsInScene = 0;
    sceneTime = 0;
    seed = Math.random();
    SCENES[idx].enter(mulberry32(Math.floor(seed * 2 ** 32)));
    if (!lockedPal && !firstScene) setPalette(pickPalette(palTo.name), true);
    firstScene = false;
  }

  /** The next scene: calm ones for quiet passages, never the same twice. */
  function pickScene(calm: boolean, energetic = false): number {
    const pool = SCENES.map((s, i) => i).filter(i => i !== sceneIdx && (energetic ? !SCENES[i].calm || SCENES[i].name === 'stars' : !calm || SCENES[i].calm));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startInsert(time: number, period: number) {
    let type = Math.floor(Math.random() * INSERTS.length);
    if (type === lastInsertType) type = (type + 1) % INSERTS.length;
    lastInsertType = type;
    lastInsertAt = time;
    insert = { type, t: 0, dur: Math.min(0.75, Math.max(0.3, period || 0.5)) };
  }

  function cut(audio: AudioFrame, time: number, energetic = false) {
    const calm = audio.silent || audio.beat.confidence < 0.3 || energyS < 0.18;
    // now and then the cut goes through a black insert (a confident beat, not too often)
    if (energetic || (!calm && time - lastInsertAt > 8 && Math.random() < 0.45)) startInsert(time, audio.beat.period);
    enterScene(pickScene(calm, energetic));
  }

  enterScene(locked >= 0 ? locked : 0); // the sun burst first

  // --- audio -----------------------------------------------------------------------------------
  function readAudio(audio: AudioFrame, sens: number, dt: number, time: number, speed: number) {
    const tau = (s: number) => Math.exp(-dt / s);
    const hit = beatHit(audio);
    if (hit) {
      const st = beatStrength(audio);
      pulse = Math.max(pulse, Math.min(1, st * sens));
      punch = Math.max(punch, Math.min(1, st * sens));
      if (st >= STRONG_BEAT) {
        beatsInScene++;
        // one accent per bar: the light blows out on the "1"
        if (audio.beat.isBeat && audio.beat.barBeat === 0) {
          barsInScene++;
          flash = Math.max(flash, 0.55 * st);
          if (barsInScene % 4 === 0 && !lockedPal) setPalette(pickPalette(palTo.name), true);
        }
        if (locked < 0 && !insert && beatsInScene >= SCENES[sceneIdx].beats) cut(audio, time);
      }
    }
    pulse *= tau(0.17);
    punch *= tau(0.12);
    flash *= tau(0.16);
    const sm = (prev: number, v: number, s: number) => prev + (Math.min(1.5, v * sens) - prev) * (1 - tau(s));
    kickS = sm(kickS, audio.onsets.kick.envelope, 0.05);
    snareS = sm(snareS, audio.onsets.snare.envelope, 0.05);
    hatS = sm(hatS, audio.onsets.hat.envelope, 0.04);
    bassS = sm(bassS, audio.bands.bass, 0.12);
    midS = sm(midS, audio.bands.mid, 0.15);
    trebleS = sm(trebleS, audio.bands.treble, 0.1);
    energyS += ((audio.silent ? 0 : Math.min(1, audio.level.rms * sens * 2)) - energyS) * (1 - tau(0.4));
    // snare: a spin kick and a small roll of the frame, alternating sides
    if (audio.onsets.snare.hit) {
      const s = Math.min(1, audio.onsets.snare.strength * sens);
      spinVel += 0.9 * s * speed;
      rollSign = -rollSign;
      rollTarget = rollSign * 0.04 * s;
    }
    spinVel *= tau(0.3);
    spin += dt * spinVel;
    rollTarget *= tau(0.35);
    rollKick += (rollTarget - rollKick) * (1 - tau(0.06));
    // drop: the level well above its slow baseline; build-up: a tracked beat without a hit
    const rms = audio.silent ? 0 : audio.level.rms;
    if (eFast < 0) { if (rms > 0) eFast = eSlow = rms; } // seed both from the first sound
    else {
      eFast += (rms - eFast) * (1 - tau(0.3));
      eSlow += (rms - eSlow) * (1 - tau(6));
      eWarm += dt;
    }
    const dropT = eSlow > 0.01 ? Math.min(1, Math.max(0, (eFast / eSlow - 1.1) * 3)) * Math.min(1, Math.max(0, (eWarm - 3) / 3)) : 0;
    drop += (dropT - drop) * (1 - tau(dropT > drop ? 0.15 : 0.8));
    const buildT = !audio.silent && audio.beat.confidence >= 0.3 && audio.beat.strength < 0.35 && eFast > eSlow * 1.05 ? 1 : 0;
    buildUp += (buildT - buildUp) * (1 - tau(1));
    // the drop lands: a black insert, then straight into an energetic scene
    if (drop > 0.6 && dropArmed && locked < 0 && !insert && time - lastInsertAt > 6) {
      dropArmed = false;
      cut(audio, time, true);
    }
    if (drop < 0.25) dropArmed = true;
    palMix = Math.min(1, palMix + dt / 0.8);
    return hit;
  }

  /** 32 log-spaced spectrum bars, each in its own auto range (a floor and a ceiling that adapt). */
  function readSpectrum(audio: AudioFrame, sens: number, dt: number) {
    const spec = audio.spectrum({ fftSize: 1024, smoothing: 0.75 });
    const fall = 1 - Math.exp(-dt / 0.12);
    const loRise = 1 - Math.exp(-dt / 1.5), hiFall = 1 - Math.exp(-dt / 2.5);
    for (let i = 0; i < 32; i++) {
      const a = Math.floor(2 * Math.pow(200, i / 32)), b = Math.max(a + 1, Math.floor(2 * Math.pow(200, (i + 1) / 32)));
      const x = (avg(spec, a, b) / 255) * (0.9 + i / 60);
      barLo[i] = x < barLo[i] ? x : barLo[i] + (x - barLo[i]) * loRise;
      barHi[i] = x > barHi[i] ? x : barHi[i] + (x - barHi[i]) * hiFall;
      const range = Math.max(0.12, barHi[i] - barLo[i]);
      const v = Math.min(1, Math.max(0, 0.08 + ((x - barLo[i]) / range) * 0.92) * Math.min(1, x * 3) * sens);
      bars[i] = v > bars[i] ? v : bars[i] + (v - bars[i]) * fall;
    }
  }

  // --- per-frame uniforms ----------------------------------------------------------------------
  let primCount = 0;
  const prim: Prim = (type, x, y, s, p1 = 0, p2 = 0, p3 = 1, alpha = 1) => {
    if (primCount >= MAX_PRIMS || alpha <= 0.002) return;
    uniformData.set([type, x, y, s, p1, p2, p3, alpha], 164 + primCount * 8);
    primCount++;
  };

  function writeUniforms(look: Look, pal: Palette, time: number, hue: number, dt: number) {
    const f = uniformData;
    f.set([W, H, aspect, 2 / H], 0);
    f.set([FW, FH, 2 / FH, 0], 4);
    f.set([time, local, kickS, snareS], 8);
    f.set([hatS, bassS, midS, trebleS], 12);
    // camera: a slow handheld drift, a dolly-in on the beat, a shake in drops
    const zoom = (look.zoom ?? 1) * (1 + 0.06 * punch + 0.04 * drop);
    const ox = 0.03 * Math.sin(time * 0.31) + 0.012 * drop * Math.sin(time * 31);
    const oy = 0.02 * Math.sin(time * 0.27 + 1) + 0.012 * drop * Math.cos(time * 27);
    f.set([ox, oy, zoom, rollKick + 0.015 * Math.sin(time * 0.21)], 16);
    // a focus pull after every cut; build-ups go soft
    const defocus = look.defocus + 0.07 * Math.exp(-sceneTime / 0.22) + 0.035 * buildUp;
    f.set([sceneIdx, seed, defocus, look.flare * (1 + 0.6 * flash)], 20);
    const exposure = 1.1 * (1 + 0.26 * pulse) * (1 + 1.3 * flash) * (1 - 0.18 * buildUp) * (1 + 0.15 * drop);
    const ca = 0.0012 + 0.004 * snareS + 0.002 * pulse + 0.004 * drop + 0.003 * trebleS;
    const blend = Math.pow(0.32 + 0.25 * drop, dt * 60);
    const ghost = Math.pow(0.82 * drop, dt * 60);
    f.set([exposure, ca, blend, ghost], 24);
    f.set([1 - 0.012 * drop, black, 0.075 + 0.03 * drop, 0.0007 * Math.sin(time * 23) * (1 + 2 * drop)], 28);
    f.set([insert ? 1 : 0, insert ? 0.03 : 0.004, look.stars, Math.min(1, hatS)], 32);
    f.set([0.9 + 0.4 * Math.min(1, bassS), look.fog, energyS, drop], 36);
    pal.stops.forEach((c, i) => f.set([...hueRotate(c, hue), RAMP_POS[i]], 40 + i * 4));
    f.set([...hueRotate(pal.stops[5], hue), primCount], 64);
    f.set(bars, 132);
    device.queue.writeBuffer(uniformBuf, 0, f);
  }

  return {
    resize(w, h, dpr) {
      if (lost) { lost.resize?.(w, h, dpr); return; }
      build(w, h, dpr);
    },

    frame({ audio, settings, dt, time }) {
      if (disposed || lost) return;
      const sens = settings.sensitivity;
      const hit = readAudio(audio, sens, dt, time, settings.speed);
      local += dt * settings.speed * (0.45 + 0.9 * energyS);
      sceneTime += dt;
      if (locked < 0 && !insert && sceneTime > 24 / Math.max(0.3, settings.speed)) cut(audio, time);

      // the insert ends on the next beat (or after at most 0.75 s)
      if (insert) {
        insert.t += dt;
        if ((hit && insert.t > 0.22) || insert.t > insert.dur) insert = null;
      }
      black += ((insert ? 1 : 0) - black) * (1 - Math.exp(-dt / (insert ? 0.015 : 0.04)));

      const sp = uniformData.subarray(68, 132);
      sp.fill(0);
      uniformData.fill(0, 164);
      primCount = 0;
      const sc = SCENES[sceneIdx];
      const look = sc.frame({
        t: time, dt, local, sceneTime, spin, pulse, kick: kickS, snare: snareS, hat: hatS, bass: bassS, mid: midS, treble: trebleS,
        energy: energyS, drop, barBeat: audio.beat.barBeat, kickHit: audio.onsets.kick.hit,
        ax: aspect, scale: settings.scale,
      }, sp, prim);
      if (insert) {
        primCount = 0;
        uniformData.fill(0, 164);
        INSERTS[insert.type](Math.min(1, insert.t / insert.dur), aspect, prim);
      }
      if (look.spectrum) readSpectrum(audio, sens, dt);
      writeUniforms(look, palette(), time, settings.hueShift, dt);

      const encoder = device.createCommandEncoder();
      const pass = (target: GPUTextureView, p: GPURenderPipeline, g: GPUBindGroup) => {
        const rp = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        rp.setPipeline(p);
        rp.setBindGroup(0, g);
        rp.draw(3);
        rp.end();
      };
      const next = 1 - cur;
      pass(fieldTex.createView(), fieldPipe, bg.field);
      pass(accum[next].createView(), feedbackPipe, bg.feedback[next]);
      pass(b1a.createView(), down1Pipe, bg.down1[next]);
      pass(b1b.createView(), blurHPipe, bg.blurH1);
      pass(b1a.createView(), blurVPipe, bg.blurV1);
      pass(b2a.createView(), downPipe, bg.down2);
      pass(b2b.createView(), blurHPipe, bg.blurH2);
      pass(b2a.createView(), blurVPipe, bg.blurV2);
      pass(context.getCurrentTexture().createView(), finalPipe, bg.final[next]);
      device.queue.submit([encoder.finish()]);
      cur = next;
    },

    dispose() {
      disposed = true;
      lost?.dispose();
      for (const t of targets) t.destroy();
      uniformBuf.destroy();
      context.unconfigure();
      device.destroy();
      canvas.remove();
    },
  };
};

export default Daybreak;
