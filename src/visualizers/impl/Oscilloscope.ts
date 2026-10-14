/**
 * Oscilloscope: an analog CRT scope drawn by a simulated electron beam (raw WebGPU + WGSL).
 *
 * The beam is a Gaussian spot that moves along the signal. Every segment between two samples is
 * drawn with the analytic integral of the spot over the segment (erf along it, a Gaussian across
 * it), so its light per length falls with the beam speed: slow turning points glow, fast edges
 * stay faint, as on a real tube (the technique described in m1el's "woscope" write-up; own
 * implementation). The light lands in a two-component phosphor, a short fluorescence and a long
 * afterglow with its own colour, blooms, and is composited behind a slightly curved faceplate
 * with a graticule lit by the trace, a reflection in the bezel and Tek-style readouts.
 *
 * Modes (they change with the music; ?mode= locks one, ?phosphor= the colour, ?shape= a vector
 * shape): Y-T sweep with a trigger that locks onto the bass, X-Y Lissajous / goniometer, vector
 * shapes (oscilloscope music: wireframes and knots that morph and vibrate with the waveform),
 * a dot sphere on the spectrum, phosphor sparks and a polar ring.
 *
 * Passes per frame: beam (additive segments) → phosphor (persistence) → bloom (two levels) →
 * final (colour, faceplate, graticule, readouts, bezel).
 */
import type { AudioFrame } from '../../audio/types';
import { beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { BUF, compileShader, TEX, webgpuFallback as fallback } from '../lib/webgpu';
import type { VisualizerFactory, VisualizerInstance } from '../runtime/types';

// ---------------------------------------------------------------------------------------------
// WGSL

const PRELUDE = /* wgsl */ `
struct U {
  res: vec4f,  // render w, h, aspect, px per scope unit
  scr: vec4f,  // screen half width, half height (clip units, x times aspect), corner radius, curvature
  gr: vec4f,   // scope unit in clip units, graticule half width, half height (units), time
  ph: vec4f,   // fluorescence decay, afterglow decay, afterglow weight, glass scatter
  colF: vec4f, // fluorescence rgb, exposure
  colS: vec4f, // afterglow rgb, bloom gain
  colG: vec4f, // graticule rgb, graticule level
  fx: vec4f,   // bezel reflection, readout level, grain, -
};
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
`;

// The electron beam: one instanced quad per segment (a, b, energy, sigma), additive.
const BEAM_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> segs: array<vec4f>;

struct BOut { @builtin(position) pos: vec4f, @location(0) lc: vec2f, @location(1) k: vec2f };

@vertex fn vsBeam(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  let s0 = segs[ii * 2u];
  let s1 = segs[ii * 2u + 1u];
  let a = s0.xy;
  let d = s0.zw - a;
  let sig = max(s1.y, 0.7 / u.res.w); // at least 0.7 px, so thin traces stay antialiased
  let L = length(d);
  var dir = vec2f(1.0, 0.0);
  if (L > 1e-6) { dir = d / L; }
  let nrm = vec2f(-dir.y, dir.x);
  let r = sig * 3.6;
  var cs = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = cs[vi];
  let along = mix(-r, L + r, c.x);
  let across = c.y * r;
  let p = (a + dir * along + nrm * across) * u.gr.x;
  var o: BOut;
  o.pos = vec4f(p.x / u.res.z, p.y, 0.0, 1.0);
  o.lc = vec2f(along, across) / sig;
  o.k = vec2f(L / sig, s1.x / sig);
  return o;
}

fn erf(x: f32) -> f32 { // Abramowitz-Stegun 7.1.26
  let t = 1.0 / (1.0 + 0.3275911 * abs(x));
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return sign(x) * y;
}

// The spot integrated along the segment: a line's core is energy / length, a dot's peak
// energy / (sqrt(2 pi) sigma).
@fragment fn fsBeam(v: BOut) -> @location(0) vec4f {
  let x = v.lc.x;
  let y = v.lc.y;
  let len = v.k.x;
  var I: f32;
  if (len < 0.02) { I = 0.39894 * exp(-0.5 * (x * x + y * y)); }
  else { I = exp(-0.5 * y * y) * 0.5 * (erf(x * 0.70711) - erf((x - len) * 0.70711)) / len; }
  return vec4f(I * v.k.y, 0.0, 0.0, 1.0);
}
`;

// Phosphor: r = fluorescence (fades in tens of ms), g = afterglow (fades in tenths of a second).
const PHOSPHOR_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var beam: texture_2d<f32>;
@group(0) @binding(2) var prev: texture_2d<f32>;

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let ip = vec2i(i.pos.xy);
  let b = textureLoad(beam, ip, 0).r;
  let p = textureLoad(prev, ip, 0).rg;
  let f = p.x * u.ph.x + b * (1.0 - u.ph.x);
  let s = min(p.y * u.ph.y + b * (1.0 - u.ph.y), 60.0);
  return vec4f(f, s, 0.0, 1.0);
}
`;

const BLOOM_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;

fn tap(uv: vec2f) -> vec2f { return textureSampleLevel(src, samp, uv, 0.0).rg; }
fn box4(uv: vec2f) -> vec2f {
  let px = 1.0 / vec2f(textureDimensions(src, 0));
  return (tap(uv + px * vec2f(-1.0, -1.0)) + tap(uv + px * vec2f(1.0, -1.0))
        + tap(uv + px * vec2f(-1.0, 1.0)) + tap(uv + px * vec2f(1.0, 1.0))) * 0.25;
}
@fragment fn fsDown(i: VSOut) -> @location(0) vec4f { return vec4f(box4(i.uv), 0.0, 1.0); }
fn blur(uv: vec2f, dir: vec2f) -> vec4f {
  let px = dir / vec2f(textureDimensions(src, 0)) * 1.4;
  var c = tap(uv) * 0.2270;
  c += (tap(uv + px * 1.3846) + tap(uv - px * 1.3846)) * 0.3162;
  c += (tap(uv + px * 3.2308) + tap(uv - px * 3.2308)) * 0.0703;
  return vec4f(c, 0.0, 1.0);
}
@fragment fn fsBlurH(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(1.0, 0.0)); }
@fragment fn fsBlurV(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(0.0, 1.0)); }
`;

const FINAL_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var acc: texture_2d<f32>;
@group(0) @binding(3) var bloom1: texture_2d<f32>;
@group(0) @binding(4) var bloom2: texture_2d<f32>;
@group(0) @binding(5) var hud: texture_2d<f32>;

// clip position (x times aspect) -> texture uv
fn toUv(c: vec2f) -> vec2f { return vec2f(c.x / u.res.z * 0.5 + 0.5, 0.5 - c.y * 0.5); }
fn glow(uv: vec2f) -> vec2f {
  return textureSampleLevel(bloom1, samp, uv, 0.0).rg * 0.55 + textureSampleLevel(bloom2, samp, uv, 0.0).rg * 0.9;
}
fn rrect(p: vec2f, h: vec2f, r: f32) -> f32 {
  let q = abs(p) - h + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn lineCov(d: f32, hw: f32, px: f32) -> f32 { return 1.0 - smoothstep(hw - px * 0.5, hw + px * 0.5, d); }

// The graticule in scope units (one division = 0.25): a frame, division lines, and the centre
// axes with minor ticks. px = one pixel in units.
fn graticule(g: vec2f, px: f32) -> f32 {
  let ext = u.gr.yz;
  let e = abs(g) - ext;
  if (e.x > px * 2.0 || e.y > px * 2.0) { return 0.0; }
  let hw = px * 0.55;
  let m = abs(fract(g / 0.25 + 0.5) - 0.5) * 0.25;
  // division lines are dotted, like an etched Tek graticule
  let dots = abs(fract(g / 0.05 + 0.5) - 0.5) * 0.05;
  var L = max(lineCov(m.x, hw, px) * lineCov(dots.y, px * 1.1, px), lineCov(m.y, hw, px) * lineCov(dots.x, px * 1.1, px)) * 0.7;
  L = max(L, max(lineCov(abs(g.x), hw, px), lineCov(abs(g.y), hw, px)) * 0.75);
  let tick = 0.022;
  let t = abs(fract(g / 0.05 + 0.5) - 0.5) * 0.05;
  if (abs(g.y) < tick) { L = max(L, lineCov(t.x, hw, px)); }
  if (abs(g.x) < tick) { L = max(L, lineCov(t.y, hw, px)); }
  L = max(L, max(lineCov(abs(e.x), hw * 1.4, px) * step(e.y, 0.0), lineCov(abs(e.y), hw * 1.4, px) * step(e.x, 0.0)));
  return L;
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let asp = u.res.z;
  let p = vec2f((i.uv.x - 0.5) * 2.0 * asp, (0.5 - i.uv.y) * 2.0);
  let hs = u.scr.xy;
  let pxc = 2.0 / u.res.y;
  let sd = rrect(p, hs, u.scr.z);
  let n = p / hs;
  let r2 = dot(n, n) * 0.5;
  // the faceplate bulges a little: the middle of the picture is magnified
  let c = p * (1.0 - u.scr.w * (1.0 - r2));
  let uv = toUv(c);

  // phosphor light: the coating is grainy, which shows in the bright parts
  let grain = 0.88 + 0.24 * hash21(floor(i.pos.xy / 1.5) + 0.37);
  let L = textureSampleLevel(acc, samp, uv, 0.0).rg;
  let G = glow(uv) * u.colS.w;
  let txt = textureSampleLevel(hud, samp, uv, 0.0).r * u.fx.y;
  let fast = (L.x + G.x * 0.45) * grain + txt;
  let slow = (L.y * grain + G.y) * u.ph.z;
  var col = u.colF.rgb * fast + u.colS.rgb * slow;
  // the graticule, edge-lit and lit by the glow of the trace
  let gl = graticule(c / u.gr.x, pxc / u.gr.x);
  col += u.colG.rgb * gl * (u.colG.w + 0.9 * (G.x + G.y));
  // light scattered in the glass: the whole screen glows faintly with what is on it
  col += u.colS.rgb * u.ph.w * (1.0 - 0.55 * r2);
  // the unlit faceplate
  col += vec3f(0.006, 0.009, 0.008) * (1.0 - 0.5 * r2);
  col = vec3f(1.0) - exp(-col * u.colF.w);
  // a soft sheen of the room on the glass
  let sh = n - vec2f(-0.5, 0.62);
  col += vec3f(0.018, 0.02, 0.022) * exp(-dot(sh, sh) * 2.2);
  col *= mix(0.72, 1.0, smoothstep(1.15, 0.25, r2));

  // the bezel: dark plastic, lit a little from above, with the screen reflected in its lip
  let q = abs(p) - hs;
  var m = p;
  if (q.y > q.x) { m.y = sign(p.y) * (hs.y - (abs(p.y) - hs.y) * 2.6); }
  else { m.x = sign(p.x) * (hs.x - (abs(p.x) - hs.x) * 2.6); }
  let dist = max(sd, 0.0);
  let R = glow(toUv(m)) * u.colS.w;
  var bez = vec3f(0.018, 0.019, 0.021) * (0.75 + 0.5 * (1.0 - i.uv.y));
  bez += (u.colF.rgb * R.x + u.colS.rgb * R.y * u.ph.z) * u.fx.x * exp(-dist / 0.022);
  bez += vec3f(0.06) * exp(-abs(sd - pxc * 2.0) / (pxc * 1.2)) * (0.35 + 0.65 * (1.0 - i.uv.y));
  bez = vec3f(1.0) - exp(-bez * 1.3);
  let inside = smoothstep(pxc, -pxc, sd);
  col = mix(bez, col, inside);

  // grain (camera noise) and a little dither against banding
  let gs = i.pos.xy + vec2f(floor(u.gr.w * 30.0) * 37.0, 0.0);
  col += (hash21(gs) - 0.5) * u.fx.z;
  col += (hash21(gs + 17.0) - 0.5) / 255.0;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Phosphors: the fluorescence colour (bright, short) and the afterglow (the long tail).

type V3 = [number, number, number];
interface Phosphor { name: string; fast: V3; slow: V3; grat: V3; weight: number }
const PHOSPHORS: Phosphor[] = [
  { name: 'p31', fast: [0.3, 1.0, 0.42], slow: [0.1, 0.78, 0.2], grat: [0.5, 0.66, 0.56], weight: 6 },
  { name: 'p7', fast: [0.55, 0.76, 1.0], slow: [0.68, 0.92, 0.16], grat: [0.5, 0.58, 0.68], weight: 1.5 },
  { name: 'p11', fast: [0.22, 0.95, 0.88], slow: [0.06, 0.55, 0.66], grat: [0.46, 0.64, 0.66], weight: 1.5 },
  { name: 'p3', fast: [1.0, 0.64, 0.16], slow: [0.92, 0.36, 0.04], grat: [0.68, 0.56, 0.42], weight: 1 },
];

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
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------------------------------------
// Vector shapes: closed 4D paths (w = 0 for 3D shapes), resampled by arc length to NPTS points so
// any two of them morph point by point.

type P4 = [number, number, number, number];
const NPTS = 1400;
const TAU = Math.PI * 2;

function resample(path: P4[]): Float32Array {
  const m = path.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    const a = path[i - 1], b = path[i];
    cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3]);
  }
  const total = cum[m - 1];
  const out = new Float32Array(NPTS * 4);
  let j = 1;
  for (let i = 0; i < NPTS; i++) {
    const s = (i / NPTS) * total;
    while (j < m - 1 && cum[j] < s) j++;
    const len = cum[j] - cum[j - 1];
    const t = len > 0 ? (s - cum[j - 1]) / len : 0;
    for (let k = 0; k < 4; k++) out[i * 4 + k] = path[j - 1][k] + (path[j][k] - path[j - 1][k]) * t;
  }
  return out;
}

/** A path along every edge of a wireframe and back (depth first), ending where it started. */
function wire(verts: P4[], edgeLen: number): P4[] {
  const edges: [number, number][] = [];
  for (let a = 0; a < verts.length; a++) {
    for (let b = a + 1; b < verts.length; b++) {
      const d = Math.hypot(...verts[a].map((x, k) => x - verts[b][k]));
      if (Math.abs(d - edgeLen) < 1e-3) edges.push([a, b]);
    }
  }
  const adj = verts.map(() => [] as number[]);
  edges.forEach(([a, b], k) => { adj[a].push(k); adj[b].push(k); });
  const used = new Uint8Array(edges.length);
  const path: P4[] = [];
  const visit = (v: number) => {
    path.push(verts[v]);
    for (const k of adj[v]) {
      if (used[k]) continue;
      used[k] = 1;
      visit(edges[k][0] === v ? edges[k][1] : edges[k][0]);
      path.push(verts[v]);
    }
  };
  visit(0);
  return path;
}

function curve(f: (t: number) => P4, steps = 2400): P4[] {
  const out: P4[] = [];
  for (let i = 0; i <= steps; i++) out.push(f((i / steps) * TAU));
  return out;
}

interface Shape { name: string; label: string; pts: Float32Array; four: number }
let shapeCache: Shape[] | null = null;
function shapes(): Shape[] {
  if (shapeCache) return shapeCache;
  const cube: P4[] = [];
  for (let i = 0; i < 8; i++) cube.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, 0]);
  const tess: P4[] = [];
  for (let i = 0; i < 16; i++) tess.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico: P4[] = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) ico.push([0, s1, s2 * phi, 0], [s1, s2 * phi, 0, 0], [s2 * phi, 0, s1, 0]);
  const scale = (path: P4[], s: number) => path.map(p => p.map(x => x * s) as P4);
  const icoS = 0.72 / Math.hypot(1, phi);
  shapeCache = [
    { name: 'cube', label: 'CUBE', pts: resample(scale(wire(cube, 2), 0.5)), four: 0 },
    { name: 'tesseract', label: 'TESSERACT', pts: resample(scale(wire(tess, 2), 0.4)), four: 1 },
    { name: 'icosa', label: 'ICOSAHEDRON', pts: resample(scale(wire(ico, 2), icoS)), four: 0 },
    { name: 'coil', label: 'TOROID', pts: resample(curve(t => {
      const r = 0.56 + 0.19 * Math.cos(22 * t);
      return [r * Math.cos(t), r * Math.sin(t), 0.19 * Math.sin(22 * t), 0];
    }, 4000)), four: 0 },
    { name: 'knot', label: 'TORUS KNOT 2,5', pts: resample(curve(t => {
      const r = 0.5 + 0.2 * Math.cos(5 * t);
      return [r * Math.cos(2 * t), r * Math.sin(2 * t), 0.2 * Math.sin(5 * t), 0];
    })), four: 0 },
    { name: 'spring', label: 'HELIX', pts: resample([
      ...curve(t => {
        const x = t / TAU;
        return [-0.8 + 1.6 * x, 0.28 * Math.cos(TAU * 11 * x), 0.28 * Math.sin(TAU * 11 * x), 0];
      }, 3000),
      [0.8, 0, 0, 0], [-0.8, 0, 0, 0], [-0.8, 0.28, 0, 0],
    ]), four: 0 },
    { name: 'yarn', label: 'LOXODROME', pts: resample(curve(t => {
      // pole to pole and back, the way back turned by half a winding
      const up = t < Math.PI, ph = up ? t : TAU - t, off = up ? 0 : Math.PI / 14;
      const a = 14 * ph + off;
      return [0.62 * Math.sin(ph) * Math.cos(a), 0.62 * Math.cos(ph), 0.62 * Math.sin(ph) * Math.sin(a), 0];
    }, 4000)), four: 0 },
    { name: 'lissajous', label: 'LISSAJOUS 3:4:5', pts: resample(curve(t => [
      0.6 * Math.sin(3 * t + Math.PI / 2), 0.6 * Math.sin(4 * t), 0.6 * Math.sin(5 * t), 0,
    ])), four: 0 },
  ];
  return shapeCache;
}

// ---------------------------------------------------------------------------------------------
// Modes

interface Mode { name: string; calm: boolean; loud: boolean; beats: number; persist: number }
const MODES: Mode[] = [
  { name: 'yt', calm: true, loud: true, beats: 32, persist: 0.2 },
  { name: 'xy', calm: true, loud: false, beats: 32, persist: 0.45 },
  { name: 'vector', calm: true, loud: true, beats: 48, persist: 0.14 },
  { name: 'dots', calm: false, loud: true, beats: 32, persist: 0.1 },
  { name: 'sparks', calm: false, loud: true, beats: 32, persist: 0.3 },
  { name: 'polar', calm: true, loud: true, beats: 32, persist: 0.26 },
];
const YT = 0, XY = 1, VECTOR = 2, DOTS = 3, SPARKS = 4, POLAR = 5;
const YT_VARIANTS = ['bass', 'full', 'dual', 'stereo'] as const;
const TIME_STEPS = [0.1, 0.2, 0.5, 1, 2, 5]; // ms per division

const UNIFORM_FLOATS = 32;
const MAX_RENDER_PIXELS = 2560 * 1440;
const MAX_SEGS = 12000;
const N_OUTER = 560, N_INNER = 150;
const MAX_SPARKS = 1800;
const SQRT_2PI = 2.5066283;
const BEAM_GAIN = 2.6;

/** Fibonacci sphere points (x, y, z). */
function fibSphere(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * ga;
    out.set([r * Math.cos(a), y, r * Math.sin(a)], i * 3);
  }
  return out;
}

const Oscilloscope: VisualizerFactory = async ({ container }) => {
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
  const [beamMod, phosMod, bloomMod, finalMod] = await Promise.all([
    compileShader(device, BEAM_WGSL, 'oscilloscope-beam'), compileShader(device, PHOSPHOR_WGSL, 'oscilloscope-phosphor'),
    compileShader(device, BLOOM_WGSL, 'oscilloscope-bloom'), compileShader(device, FINAL_WGSL, 'oscilloscope-final'),
  ]);
  const BEAM: GPUTextureFormat = 'r16float', LIGHT: GPUTextureFormat = 'rg16float';
  const pipe = (module: GPUShaderModule, entryPoint: string, fmt: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint, targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
  const [beamPipe, phosPipe, downPipe, blurHPipe, blurVPipe, finalPipe] = await Promise.all([
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: beamMod, entryPoint: 'vsBeam' },
      fragment: { module: beamMod, entryPoint: 'fsBeam', targets: [{ format: BEAM, blend: { color: add, alpha: add } }] },
      primitive: { topology: 'triangle-list' },
    }),
    pipe(phosMod, 'fs', LIGHT),
    pipe(bloomMod, 'fsDown', LIGHT), pipe(bloomMod, 'fsBlurH', LIGHT), pipe(bloomMod, 'fsBlurV', LIGHT),
    pipe(finalMod, 'fs', format),
  ]);
  const setupError = await device.popErrorScope();
  if (setupError) throw new Error(`Oscilloscope: ${setupError.message}`);

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const uniformData = new Float32Array(UNIFORM_FLOATS);
  const uniformBuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });
  const segData = new Float32Array(MAX_SEGS * 8);
  const segBuf = device.createBuffer({ size: segData.byteLength, usage: BUF.STORAGE | BUF.COPY_DST });
  const beamBG = device.createBindGroup({
    layout: beamPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }, { binding: 1, resource: { buffer: segBuf } }],
  });

  // Readouts (Canvas 2D, uploaded when the text changes)
  const hudCanvas = document.createElement('canvas');
  const hud = hudCanvas.getContext('2d')!;

  // --- render targets and the screen geometry --------------------------------------------------
  let W = 2, H = 2, aspect = 1, hudScale = 1;
  let hsx = 1, hsy = 1, unit = 1, GX = 1, GY = 1;
  let targets: GPUTexture[] = [];
  let beamTex!: GPUTexture, accum!: GPUTexture[], hudTex!: GPUTexture, b1a!: GPUTexture, b1b!: GPUTexture, b2a!: GPUTexture, b2b!: GPUTexture;
  let bg!: {
    phos: GPUBindGroup[]; down1: GPUBindGroup[]; blurH1: GPUBindGroup; blurV1: GPUBindGroup;
    down2: GPUBindGroup; blurH2: GPUBindGroup; blurV2: GPUBindGroup; final: GPUBindGroup[];
  };
  let hudKey = '', cur = 0;

  function build(w: number, h: number, dpr: number) {
    const cssW = Math.max(1, w), cssH = Math.max(1, h);
    let s = dpr;
    if (cssW * cssH * s * s > MAX_RENDER_PIXELS) s = Math.sqrt(MAX_RENDER_PIXELS / (cssW * cssH));
    W = Math.max(2, Math.round(cssW * s));
    H = Math.max(2, Math.round(cssH * s));
    aspect = W / H;
    canvas.width = W;
    canvas.height = H;
    hudScale = Math.min(s, 1.5);
    hudCanvas.width = Math.max(1, Math.round(cssW * hudScale));
    hudCanvas.height = Math.max(1, Math.round(cssH * hudScale));

    // the screen fills the frame inside a bezel; the scope unit (4 divisions) fits its short side
    const margin = 0.075;
    hsx = Math.max(0.2, aspect - margin * Math.min(1, aspect));
    hsy = 1 - margin;
    unit = 0.9 * Math.min(hsy, hsx);
    GX = Math.max(1, Math.floor((hsx / unit) * 0.97 * 4)) / 4;
    GY = Math.max(1, Math.floor((hsy / unit) * 0.97 * 4)) / 4;

    for (const t of targets) t.destroy();
    targets = [];
    const tex = (tw: number, th: number, fmt: GPUTextureFormat = LIGHT, extra = 0) => {
      const t = device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: fmt, usage: TEX.RENDER_ATTACHMENT | TEX.TEXTURE_BINDING | extra });
      targets.push(t);
      return t;
    };
    beamTex = tex(W, H, BEAM);
    accum = [tex(W, H), tex(W, H)];
    hudTex = tex(hudCanvas.width, hudCanvas.height, 'rgba8unorm', TEX.COPY_DST);
    b1a = tex(Math.ceil(W / 4), Math.ceil(H / 4));
    b1b = tex(Math.ceil(W / 4), Math.ceil(H / 4));
    b2a = tex(Math.ceil(W / 16), Math.ceil(H / 16));
    b2b = tex(Math.ceil(W / 16), Math.ceil(H / 16));

    const group = (p: GPURenderPipeline, res: GPUBindingResource[]) => device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: res.map((resource, binding) => ({ binding, resource })),
    });
    const v = (t: GPUTexture) => t.createView();
    const U = { buffer: uniformBuf };
    bg = {
      phos: [0, 1].map(i => group(phosPipe, [U, v(beamTex), v(accum[1 - i])])),
      down1: [0, 1].map(i => group(downPipe, [sampler, v(accum[i])])),
      blurH1: group(blurHPipe, [sampler, v(b1a)]),
      blurV1: group(blurVPipe, [sampler, v(b1b)]),
      down2: group(downPipe, [sampler, v(b1a)]),
      blurH2: group(blurHPipe, [sampler, v(b2a)]),
      blurV2: group(blurVPipe, [sampler, v(b2b)]),
      final: [0, 1].map(i => group(finalPipe, [U, sampler, v(accum[i]), v(b1a), v(b2a), v(hudTex)])),
    };
    hudKey = '';
  }

  // --- beam segments ----------------------------------------------------------------------------
  let segCount = 0, totalE = 0, sigma = 0.004, gain = 1, jx = 0, jy = 0;
  function seg(ax: number, ay: number, bx: number, by: number, e: number, sig = sigma) {
    if (segCount >= MAX_SEGS || e <= 0) return;
    const o = segCount++ * 8;
    segData[o] = ax + jx; segData[o + 1] = ay + jy; segData[o + 2] = bx + jx; segData[o + 3] = by + jy;
    segData[o + 4] = e * gain * BEAM_GAIN; segData[o + 5] = sig;
    totalE += e * gain;
  }
  /** A dot whose peak is `b` (the beam held in place, or blanked between dots). */
  const dot = (x: number, y: number, b: number, sig = sigma) => seg(x, y, x, y, b * sig * SQRT_2PI, sig);

  // --- signal analysis: mono mix, bass (low-passed) signal, trigger, period --------------------
  const N = 2048;
  const mono = new Float32Array(N), bass = new Float32Array(N), soft = new Float32Array(N);
  const side = new Float32Array(N), midLp = new Float32Array(N), sideLp = new Float32Array(N);
  let left: Float32Array = mono, right: Float32Array = mono, stereo = false;
  let periodS = 400, rmsBass = 0, srate = 48000;
  const crossings: number[] = [];
  const prevWin = new Float32Array(48);
  let hasPrev = false, trigd = false;
  let tStep = 3, tStepWant = 3, tStepSince = 0;

  function analyse(audio: AudioFrame, dt: number) {
    const st = audio.stereo();
    left = st.left;
    right = st.right;
    const sr = (srate = audio.sampleRate || 48000);
    const aB = 1 - Math.exp((-TAU * 170) / sr), aS = 1 - Math.exp((-TAU * 5000) / sr), aM = 1 - Math.exp((-TAU * 1100) / sr);
    let y1 = 0, y2 = 0, z = 0, zm = 0, zs = 0, sideE = 0, midE = 0;
    for (let i = 0; i < 48; i++) y1 += (left[i] + right[i]) * 0.5;
    y1 /= 48; y2 = y1; z = y1; zm = y1;
    for (let i = 0; i < N; i++) {
      const m = (left[i] + right[i]) * 0.5, s = (left[i] - right[i]) * 0.5;
      mono[i] = m;
      side[i] = s;
      y1 += aB * (m - y1);
      y2 += aB * (y1 - y2);
      bass[i] = y2;
      z += aS * (m - z);
      soft[i] = z;
      zm += aM * (m - zm);
      zs += aM * (s - zs);
      midLp[i] = zm;
      sideLp[i] = zs;
      sideE += s * s;
      midE += m * m;
    }
    stereo = left !== right && sideE > midE * 0.004;
    // rising zero crossings of the bass signal, with hysteresis
    let e = 0;
    for (let i = 0; i < N; i++) e += bass[i] * bass[i];
    rmsBass = Math.sqrt(e / N);
    const hyst = 0.25 * rmsBass + 0.0015;
    crossings.length = 0;
    let armed = false;
    for (let i = 64; i < N; i++) {
      const v = bass[i];
      if (v < -hyst) armed = true;
      else if (armed && v >= 0 && bass[i - 1] < 0) {
        crossings.push(i - 1 + -bass[i - 1] / (v - bass[i - 1]));
        armed = false;
      }
    }
    if (crossings.length >= 3) {
      const gaps: number[] = [];
      for (let i = 1; i < crossings.length; i++) gaps.push(crossings[i] - crossings[i - 1]);
      gaps.sort((a, b) => a - b);
      const med = Math.min(sr / 30, Math.max(sr / 600, gaps[gaps.length >> 1]));
      periodS = Math.exp(Math.log(periodS) + (Math.log(med) - Math.log(periodS)) * (1 - Math.exp(-dt / 0.35)));
    }
  }

  /** The start (fractional sample) of a window of `win` samples: the crossing whose window looks
   *  most like the last one (the trace stands still), or free-running when there is none. */
  function trigger(win: number): number {
    let best = -1, bestErr = Infinity;
    const last = N - win - 2;
    for (let c = crossings.length - 1; c >= 0; c--) {
      const x = crossings[c];
      if (x > last) continue;
      if (!hasPrev) { best = x; break; }
      let err = 0;
      for (let k = 0; k < 48; k++) {
        const d = bass[Math.min(N - 1, Math.floor(x + (k / 48) * win))] - prevWin[k];
        err += d * d;
      }
      if (err < bestErr) { bestErr = err; best = x; }
      if (crossings.length - c > 10) break;
    }
    trigd = best >= 0;
    if (best < 0) best = Math.max(0, last);
    for (let k = 0; k < 48; k++) prevWin[k] = bass[Math.min(N - 1, Math.floor(best + (k / 48) * win))];
    hasPrev = trigd;
    return best;
  }

  /** Draw `win` samples of `sig` from `start` across the graticule. */
  function sweep(sig: Float32Array, start: number, win: number, yGain: number, yOff: number, b: number) {
    const i0 = Math.ceil(start), off = i0 - start;
    const dx = (2 * GX) / win;
    const n = Math.min(win, N - 1 - i0);
    let px = -GX + off * dx, py = yOff + sig[i0] * yGain;
    for (let k = 1; k <= n; k++) {
      const x = -GX + (k + off) * dx, y = yOff + sig[i0 + k] * yGain;
      seg(px, py, x, y, b * dx);
      px = x; py = y;
    }
  }

  // --- state -------------------------------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const lockedMode = MODES.findIndex(m => m.name === params.get('mode'));
  const lockedPh = PHOSPHORS.find(p => p.name === params.get('phosphor')) ?? null;
  const lockedShape = shapes().findIndex(s => s.name === params.get('shape'));
  const lockedVariant = YT_VARIANTS.find(v => v === params.get('variant')) ?? null;

  let mode = lockedMode >= 0 ? lockedMode : YT, modeTime = 0, beatsInMode = 0, barsInMode = 0, blank = 0;
  let ytVariant: (typeof YT_VARIANTS)[number] = 'bass', polarK = 2, xyVariant: 'ms' | 'phase' = 'phase';
  let phFrom = lockedPh ?? PHOSPHORS[0], phTo = phFrom, phMix = 1;
  let pulse = 0, flash = 0, kickS = 0, snareS = 0, hatS = 0, bassS = 0, trebleS = 0, energyS = 0;
  let eFast = -1, eSlow = 0, eWarm = 0, drop = 0, dropArmed = true, lastCut = -1e9;
  let yaw = 0, pitch = 0, roll = 0, xw = 0, zw = 0, spin = 0, spinVel = 0, morph = 1;
  let shapeA = lockedShape >= 0 ? lockedShape : 0, shapeB = shapeA;
  let scatter = 0;
  const outer = fibSphere(N_OUTER), inner = fibSphere(N_INNER);
  const sphereBins = new Float32Array(40);
  const proj = new Float32Array(NPTS * 3);
  const sp = {
    x: new Float32Array(MAX_SPARKS), y: new Float32Array(MAX_SPARKS), vx: new Float32Array(MAX_SPARKS), vy: new Float32Array(MAX_SPARKS),
    px: new Float32Array(MAX_SPARKS), py: new Float32Array(MAX_SPARKS), life: new Float32Array(MAX_SPARKS), max: new Float32Array(MAX_SPARKS),
    sig: new Float32Array(MAX_SPARKS), br: new Float32Array(MAX_SPARKS),
  };
  let sparkCount = 0, spawnAcc = 0;

  function pickPhosphor(not: string): Phosphor {
    const pool = PHOSPHORS.filter(p => p.name !== not);
    let r = Math.random() * pool.reduce((s, p) => s + p.weight, 0);
    for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
    return pool[0];
  }
  const phosphor = (): Phosphor => {
    if (phMix >= 1) return phTo;
    const t = phMix * phMix * (3 - 2 * phMix);
    return { name: phTo.name, fast: mix3(phFrom.fast, phTo.fast, t), slow: mix3(phFrom.slow, phTo.slow, t), grat: mix3(phFrom.grat, phTo.grat, t), weight: 1 };
  };

  function enterMode(idx: number, energetic: boolean) {
    mode = idx;
    modeTime = 0;
    beatsInMode = 0;
    barsInMode = 0;
    blank = 1;
    if (mode === YT) ytVariant = lockedVariant ?? (energetic ? (['dual', 'full', 'stereo'] as const)[Math.floor(Math.random() * 3)] : YT_VARIANTS[Math.floor(Math.random() * 2)]);
    if (mode === XY) xyVariant = params.get('variant') === 'ms' || (params.get('variant') !== 'phase' && Math.random() < 0.5) ? 'ms' : 'phase';
    if (mode === POLAR) polarK = [1, 2, 3, 5][Math.floor(Math.random() * 4)];
    if (mode === VECTOR && lockedShape < 0) nextShape(true);
    if (mode === SPARKS) sparkCount = 0;
    // now and then the tube is swapped for one with another phosphor
    if (!lockedPh && !first && Math.random() < 0.3) {
      phFrom = phosphor();
      phTo = Math.random() < 0.5 ? PHOSPHORS[0] : pickPhosphor(phTo.name);
      phMix = 0;
    }
  }

  function nextShape(cut: boolean) {
    const list = shapes();
    let n = Math.floor(Math.random() * list.length);
    if (n === shapeB) n = (n + 1) % list.length;
    shapeA = cut ? n : shapeB;
    shapeB = n;
    morph = cut ? 1 : 0;
  }

  function cut(audio: AudioFrame, time: number, energetic = false) {
    lastCut = time;
    const calm = audio.silent || audio.beat.confidence < 0.3 || energyS < 0.16;
    const pool = MODES.map((_, i) => i).filter(i => i !== mode && (energetic ? MODES[i].loud && i !== XY : calm ? MODES[i].calm : MODES[i].loud));
    enterMode(pool[Math.floor(Math.random() * pool.length)], energetic || !calm);
  }

  let first = true;
  if (lockedMode >= 0) enterMode(lockedMode, false);
  first = false;
  blank = 0;

  // --- audio -----------------------------------------------------------------------------------
  function readAudio(audio: AudioFrame, sens: number, dt: number, time: number, speed: number) {
    const tau = (s: number) => Math.exp(-dt / s);
    if (beatHit(audio)) {
      const st = beatStrength(audio);
      pulse = Math.max(pulse, Math.min(1, st * sens));
      if (st >= STRONG_BEAT) {
        beatsInMode++;
        if (audio.beat.isBeat && audio.beat.barBeat === 0) {
          barsInMode++;
          flash = Math.max(flash, 0.6 * st);
          if (mode === VECTOR && lockedShape < 0 && barsInMode % 4 === 0) nextShape(false);
        }
        if (lockedMode < 0 && beatsInMode >= MODES[mode].beats) cut(audio, time);
      }
    }
    pulse *= tau(0.15);
    flash *= tau(0.2);
    const sm = (prev: number, v: number, s: number) => prev + (Math.min(1.5, v * sens) - prev) * (1 - tau(s));
    kickS = sm(kickS, audio.onsets.kick.envelope, 0.05);
    snareS = sm(snareS, audio.onsets.snare.envelope, 0.05);
    hatS = sm(hatS, audio.onsets.hat.envelope, 0.04);
    bassS = sm(bassS, audio.bands.bass, 0.12);
    trebleS = sm(trebleS, audio.bands.treble, 0.1);
    energyS += ((audio.silent ? 0 : Math.min(1, audio.level.rms * sens * 2)) - energyS) * (1 - tau(0.4));
    if (audio.onsets.snare.hit) spinVel += 1.2 * Math.min(1, audio.onsets.snare.strength * sens) * speed * (Math.random() < 0.5 ? -1 : 1);
    spinVel *= tau(0.35);
    spin += dt * spinVel;
    // a drop (the level well above its slow baseline) cuts to a loud mode
    const rms = audio.silent ? 0 : audio.level.rms;
    if (eFast < 0) { if (rms > 0) eFast = eSlow = rms; }
    else {
      eFast += (rms - eFast) * (1 - tau(0.3));
      eSlow += (rms - eSlow) * (1 - tau(6));
      eWarm += dt;
    }
    const dropT = eSlow > 0.01 ? Math.min(1, Math.max(0, (eFast / eSlow - 1.1) * 3)) * Math.min(1, Math.max(0, (eWarm - 3) / 3)) : 0;
    drop += (dropT - drop) * (1 - tau(dropT > drop ? 0.15 : 0.8));
    if (drop > 0.6 && dropArmed && lockedMode < 0 && time - lastCut > 6) {
      dropArmed = false;
      cut(audio, time, true);
    }
    if (drop < 0.25) dropArmed = true;
  }

  // --- the modes ----------------------------------------------------------------------------------
  let label = '', chans: { name: string; y: number; vdiv: number }[] = [], timeLabel = '';

  function drawYT(sens: number, scale: number, b: number, sr: number) {
    // time base: about four periods of the bass, in 1-2-5 steps that change only when they must
    const divs = GX * 8;
    const want = (4.2 * periodS) / sr / divs * 1000;
    let k = 0;
    while (k < TIME_STEPS.length - 1 && TIME_STEPS[k + 1] <= want * 1.2 && TIME_STEPS[k + 1] * divs * sr / 1000 < N * 0.72) k++;
    if (k !== tStepWant) { tStepWant = k; tStepSince = 0; }
    if (tStepSince > 0.6 || !hasPrev) tStep = tStepWant;
    const win = Math.max(16, Math.round(TIME_STEPS[tStep] * divs * sr / 1000));
    const start = trigger(win);
    const g = 0.95 * sens * scale;
    const dual = ytVariant === 'dual' || ytVariant === 'stereo';
    const off = dual ? GY * 0.5 : 0;
    const gb = g * 1.15;
    if (ytVariant === 'bass') { sweep(bass, start, win, gb, 0, b); chans = [{ name: 'CH1', y: 0, vdiv: 0.25 / gb }]; }
    else if (ytVariant === 'full') { sweep(soft, start, win, g * 0.8, 0, b); chans = [{ name: 'CH1', y: 0, vdiv: 0.25 / g }]; }
    else if (ytVariant === 'dual') {
      sweep(bass, start, win, gb * 0.8, off, b);
      sweep(soft, start, win, g * 0.7, -off, b * 0.8);
      chans = [{ name: 'CH1', y: off, vdiv: 0.25 / (gb * 0.8) }, { name: 'CH2', y: -off, vdiv: 0.25 / (g * 0.7) }];
    } else {
      sweep(left, start, win, g * 0.7, off, b);
      sweep(right, start, win, g * 0.7, -off, b);
      chans = [{ name: 'CH1', y: off, vdiv: 0.25 / (g * 0.7) }, { name: 'CH2', y: -off, vdiv: 0.25 / (g * 0.7) }];
    }
    timeLabel = `M ${TIME_STEPS[tStep] < 1 ? `${TIME_STEPS[tStep] * 1000}µs` : `${TIME_STEPS[tStep].toFixed(2)}ms`}`;
    label = ytVariant === 'bass' ? 'Y-T  BW 170Hz' : ytVariant === 'dual' ? 'Y-T  CH1 BW 170Hz' : ytVariant === 'stereo' ? 'Y-T  L / R' : 'Y-T';
  }

  function drawXY(sens: number, scale: number, b: number) {
    const n = 800, s0 = N - n;
    const g = 0.9 * sens * scale * (1 + 0.08 * pulse);
    const e = b * 0.006;
    let px = 0, py = 0;
    if (stereo && xyVariant === 'ms') {
      // goniometer: mid up, side across
      for (let i = 0; i < n; i++) {
        const k = s0 + i, x = sideLp[k] * g * 2.2, y = midLp[k] * g * 0.75;
        if (i) seg(px, py, x, y, e);
        px = x; py = y;
      }
      label = 'X-Y  M/S';
    } else {
      // the signal against itself a quarter period later: a sine draws a circle, music loops
      const d = Math.max(3, Math.min(600, Math.round(periodS / 4)));
      const v = (k: number) => bass[k] * 1.2 + (midLp[k] - bass[k]) * 0.55 + (stereo ? sideLp[k] * 0.5 : 0);
      for (let i = 0; i < n; i++) {
        const k = s0 + i, x = v(k) * g, y = v(k - d) * g;
        const rx = (x - y) * Math.SQRT1_2 * 1.4, ry = (x + y) * Math.SQRT1_2 * 0.85;
        if (i) seg(px, py, rx, ry, e);
        px = rx; py = ry;
      }
      label = `X-Y  CH2 = CH1 −${((d / srate) * 1000).toFixed(1)}ms`;
    }
    chans = [{ name: 'CH1', y: 0, vdiv: 0.25 / g }, { name: 'CH2', y: 0, vdiv: 0.25 / g }];
    timeLabel = 'X-Y';
  }

  function drawVector(dt: number, sens: number, scale: number, speed: number, b: number) {
    const list = shapes();
    const A = list[shapeA], B = list[shapeB];
    morph = Math.min(1, morph + dt * speed / 1.1);
    const t = morph * morph * (3 - 2 * morph);
    const four = A.four + (B.four - A.four) * t;
    const rate = dt * speed * (0.25 + 0.7 * energyS);
    yaw += rate * 0.9;
    pitch = 0.42 * Math.sin(yaw * 0.37) + 0.2;
    roll = spin * 0.6;
    xw += rate * 0.8;
    zw += rate * 0.45;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spn = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const ca = Math.cos(xw), sa = Math.sin(xw), cb = Math.cos(zw), sb = Math.sin(zw);
    const S = 1.15 * scale * (1 + 0.1 * pulse + 0.04 * kickS);
    for (let i = 0; i < NPTS; i++) {
      const o = i * 4;
      let x = A.pts[o] + (B.pts[o] - A.pts[o]) * t;
      let y = A.pts[o + 1] + (B.pts[o + 1] - A.pts[o + 1]) * t;
      let z = A.pts[o + 2] + (B.pts[o + 2] - A.pts[o + 2]) * t;
      let w = A.pts[o + 3] + (B.pts[o + 3] - A.pts[o + 3]) * t;
      if (four > 0) {
        // rotate in the x-w and z-w planes, then a perspective from 4D to 3D
        const x4 = x * ca - w * sa, w1 = x * sa + w * ca;
        const z4 = z * cb - w1 * sb, w4 = z * sb + w1 * cb;
        const k4 = 1.5 / (2.2 - w4);
        x += (x4 * k4 - x) * four; z += (z4 * k4 - z) * four; y += (y * k4 - y) * four;
        w = w4;
      }
      // yaw, pitch, roll, then perspective
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y1 = y * cp - z1 * spn, z2 = y * spn + z1 * cp;
      const x2 = x1 * cr - y1 * sr, y2 = x1 * sr + y1 * cr;
      const k = 2.6 / (3.0 - z2);
      proj[i * 3] = x2 * k * S;
      proj[i * 3 + 1] = y2 * k * S;
      proj[i * 3 + 2] = z2;
    }
    // the waveform shakes the beam across the path (the fuzzy edges of oscilloscope music)
    const amp = 0.032 * sens * (0.3 + 0.8 * Math.min(1, energyS * 2));
    let total = 0;
    for (let i = 0; i < NPTS; i++) {
      const j = (i + 1) % NPTS;
      total += Math.hypot(proj[j * 3] - proj[i * 3], proj[j * 3 + 1] - proj[i * 3 + 1]);
    }
    const e = b * 0.75 * (total / NPTS);
    let fx = 0, fy = 0, lx = 0, ly = 0, ld = 0;
    for (let i = 0; i <= NPTS; i++) {
      const c = i % NPTS, p = (c + NPTS - 1) % NPTS, q = (c + 1) % NPTS;
      const tx = proj[q * 3] - proj[p * 3], ty = proj[q * 3 + 1] - proj[p * 3 + 1];
      const tl = Math.hypot(tx, ty);
      const wv = mono[N - NPTS + c] * amp;
      const x = proj[c * 3] + (tl > 1e-5 ? (-ty / tl) * wv : 0);
      const y = proj[c * 3 + 1] + (tl > 1e-5 ? (tx / tl) * wv : 0);
      const depth = proj[c * 3 + 2];
      if (i === 0) { fx = x; fy = y; }
      else if (i === NPTS) seg(lx, ly, fx, fy, e * (0.62 + 0.3 * (depth + ld) * 0.5));
      else seg(lx, ly, x, y, e * (0.62 + 0.3 * (depth + ld) * 0.5));
      lx = x; ly = y; ld = depth;
    }
    chans = [{ name: 'CH1', y: 0, vdiv: 0.25 / amp / 4 }, { name: 'CH2', y: 0, vdiv: 0.25 / amp / 4 }];
    timeLabel = 'X-Y';
    label = `VECTOR  ${t < 0.5 ? A.label : B.label}`;
  }

  function drawDots(audio: AudioFrame, dt: number, sens: number, scale: number, speed: number, b: number) {
    const spec = audio.spectrum({ fftSize: 1024, smoothing: 0.6 });
    const fall = 1 - Math.exp(-dt / 0.1);
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(2 * Math.pow(150, i / 40)), c = Math.max(a + 1, Math.floor(2 * Math.pow(150, (i + 1) / 40)));
      let s = 0;
      for (let k = a; k < c; k++) s += spec[k];
      const v = Math.min(1.4, (s / (c - a) / 255) * (1 + i / 50) * sens);
      sphereBins[i] = v > sphereBins[i] ? v : sphereBins[i] + (v - sphereBins[i]) * fall;
    }
    yaw += dt * speed * (0.3 + 0.8 * energyS);
    const tilt = 0.4 + 0.15 * Math.sin(yaw * 0.31);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(spin * 0.5), sr = Math.sin(spin * 0.5);
    const R = 0.62 * scale * (1 + 0.08 * pulse);
    const put = (pts: Float32Array, i: number, r: number, br: number, sizeMul: number) => {
      const x0 = pts[i * 3] * r, y0 = pts[i * 3 + 1] * r, z0 = pts[i * 3 + 2] * r;
      const x1 = x0 * cy + z0 * sy, z1 = -x0 * sy + z0 * cy;
      const y1 = y0 * ct - z1 * st, z2 = y0 * st + z1 * ct;
      const x2 = x1 * cr - y1 * sr, y2 = x1 * sr + y1 * cr;
      const k = 2.6 / (3.0 - z2);
      // depth of field: dots far from the focus plane are bigger and dimmer
      const defocus = 1 + 1.3 * Math.abs(z2 + 0.15) * sizeMul;
      const front = 0.45 + 0.55 * Math.max(0, Math.min(1, (z2 / Math.max(r, 0.01) + 1) * 0.5));
      dot(x2 * k, y2 * k, (br * front) / defocus, sigma * defocus * 0.8);
    };
    for (let i = 0; i < N_OUTER; i++) {
      const lat = Math.abs(outer[i * 3 + 1]);
      const bin = Math.min(39, Math.floor(lat * 39.99));
      const tw = hatS > 0.25 && ((i * 7919 + Math.floor(modeTime * 30)) % 13) === 0 ? 1.8 : 1;
      put(outer, i, R * (1 + 0.42 * sphereBins[bin]), b * 0.38 * tw, 1);
    }
    const ri = R * 0.3 * (1 + 0.3 * kickS + 0.15 * pulse);
    for (let i = 0; i < N_INNER; i++) put(inner, i, ri, b * 0.42, 0.4);
    chans = [{ name: 'CH1', y: 0, vdiv: 0.1 }, { name: 'CH2', y: 0, vdiv: 0.1 }];
    timeLabel = 'X-Y  Z-AXIS';
    label = 'DOTS  SPECTRUM SPHERE';
  }

  function drawSparks(audio: AudioFrame, dt: number, sens: number, scale: number, b: number) {
    const spawn = (n: number, power: number) => {
      for (let k = 0; k < n && sparkCount < MAX_SPARKS; k++) {
        const i = sparkCount++;
        const spread = 0.28 + 0.4 * trebleS;
        const a = Math.PI / 2 + (Math.random() - 0.5) * 2 * spread * (Math.random() < 0.8 ? 0.5 : 1);
        const v = (0.7 + 1.5 * Math.pow(Math.random(), 0.7)) * (0.75 + 0.45 * power) * Math.sqrt(scale) * GY;
        sp.x[i] = sp.px[i] = (Math.random() - 0.5) * 0.16;
        sp.y[i] = sp.py[i] = -GY * 1.02;
        sp.vx[i] = Math.cos(a) * v;
        sp.vy[i] = Math.sin(a) * v;
        sp.max[i] = sp.life[i] = 1.2 + 1.6 * Math.random();
        sp.sig[i] = 0.8 + 2.6 * Math.pow(Math.random(), 3);
        sp.br[i] = 0.35 + 0.55 * Math.random();
      }
    };
    spawnAcc += dt * (12 + 150 * energyS) * sens;
    const n = Math.floor(spawnAcc);
    spawnAcc -= n;
    spawn(n, bassS);
    if (beatHit(audio)) spawn(Math.round(90 * beatStrength(audio) * sens), 0.6 + bassS);
    const gr = 1.25 * GY, drag = Math.exp(-dt * 0.55);
    for (let i = 0; i < sparkCount; i++) {
      sp.life[i] -= dt;
      if (sp.life[i] <= 0 || sp.y[i] < -GY * 1.3) {
        // remove: move the last one here
        const l = --sparkCount;
        for (const arr of Object.values(sp)) arr[i] = arr[l];
        i--;
        continue;
      }
      sp.px[i] = sp.x[i]; sp.py[i] = sp.y[i];
      sp.vy[i] -= gr * dt;
      sp.vx[i] *= drag; sp.vy[i] *= drag;
      sp.x[i] += sp.vx[i] * dt;
      sp.y[i] += sp.vy[i] * dt;
      const f = sp.life[i] / sp.max[i];
      const tw = hatS > 0.2 ? 0.55 + 0.9 * Math.random() : 1;
      const s = sigma * sp.sig[i] * 1.3;
      const br = b * sp.br[i] * Math.min(1, f * 3) * tw / sp.sig[i];
      seg(sp.px[i], sp.py[i], sp.x[i], sp.y[i], br * s * SQRT_2PI, s);
    }
    chans = [{ name: 'CH1', y: 0, vdiv: 0.2 }];
    timeLabel = 'X-Y  Z-AXIS';
    label = 'DOTS  PHOSPHOR SPARKS';
  }

  function drawPolar(dt: number, sens: number, scale: number, speed: number, b: number) {
    let k = polarK;
    while (k > 1 && k * periodS > N * 0.45) k--;
    const win = Math.max(64, Math.min(Math.floor(N * 0.45), Math.round(k * periodS)));
    const start = trigger(win);
    yaw += dt * speed * (0.15 + 0.5 * energyS);
    const R0 = 0.6 * scale * (1 + 0.08 * pulse);
    const amp = 0.3 * sens;
    for (let ring = 0; ring < 3; ring++) {
      const s0 = start - ring * win;
      if (s0 < 0) break;
      const r0 = R0 * (1 - 0.24 * ring), br = b * Math.pow(0.55, ring);
      const i0 = Math.ceil(s0);
      let px = 0, py = 0;
      for (let i = 0; i <= win; i++) {
        const idx = Math.min(N - 1, i0 + (i % win));
        const v = bass[idx] * 1.3 + (midLp[idx] - bass[idx]) * 0.5;
        const a = yaw * (ring % 2 ? -1 : 1) + (TAU * i) / win;
        const r = Math.max(0, r0 + v * amp * (1 - 0.2 * ring));
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i) seg(px, py, x, y, br * ((TAU * r0) / win));
        px = x; py = y;
      }
    }
    chans = [{ name: 'CH1', y: 0, vdiv: 0.25 / amp }];
    timeLabel = `POLAR  ${k}×T`;
    label = 'POLAR  Z-MOD';
  }

  // --- readouts ----------------------------------------------------------------------------------
  let hudNext = 0;
  function drawHud(time: number, audio: AudioFrame) {
    if (time < hudNext && hudKey) return;
    hudNext = time + 0.25;
    const bpm = audio.beat.confidence >= 0.3 && audio.beat.bpm > 0 ? `${audio.beat.bpm.toFixed(1)} BPM` : '---.- BPM';
    const state = mode === YT || mode === POLAR ? (audio.silent ? 'READY' : trigd ? "TRIG'D" : 'AUTO') : 'XY';
    const mv = (v: number) => (v >= 1 ? `${v.toFixed(2)}V` : `${Math.round(v * 1000)}mV`);
    const key = [bpm, state, label, timeLabel, W, H, ...chans.map(c => `${c.name}${mv(c.vdiv)}${c.y.toFixed(2)}`)].join('|');
    if (key === hudKey) return;
    hudKey = key;

    const cw = hudCanvas.width, ch = hudCanvas.height;
    const toX = (x: number) => (x / aspect * 0.5 + 0.5) * cw;
    const toY = (y: number) => (0.5 - y * 0.5) * ch;
    const c = hud;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    const gTop = GY * unit, gLeft = -GX * unit;
    const band = (hsy - gTop) * ch * 0.5;
    const fs = Math.max(9, Math.min(band * 0.34, 17 * hudScale));
    c.font = `400 ${fs}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    c.fillStyle = '#fff';
    c.textBaseline = 'middle';
    const yTop = toY((hsy + gTop) * 0.5), yBot = toY(-(hsy + gTop) * 0.5);
    const xl = toX(gLeft), xr = toX(-gLeft);
    c.textAlign = 'left';
    c.fillText(chans.map(k => `${k.name} ${mv(k.vdiv)}`).join('   '), xl, yTop);
    c.fillText(`${timeLabel}`, xl, yBot);
    c.textAlign = 'right';
    c.fillText(state, xr, yTop);
    c.fillText(bpm, xr, yBot);
    c.textAlign = 'center';
    c.fillText(label, (xl + xr) / 2, yBot);
    // ground markers at the left edge of the graticule for each Y-T channel
    if (mode === YT) {
      chans.forEach((k, i) => {
        const y = toY(k.y * unit), x = xl - fs * 0.35;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - fs * 0.55, y - fs * 0.38);
        c.lineTo(x - fs * 0.55, y + fs * 0.38);
        c.closePath();
        c.fill();
        c.textAlign = 'right';
        c.fillText(String(i + 1), x - fs * 0.7, y);
      });
    }
    device.queue.copyExternalImageToTexture({ source: hudCanvas }, { texture: hudTex, premultipliedAlpha: true }, [cw, ch]);
  }

  // --- per-frame uniforms ----------------------------------------------------------------------
  function writeUniforms(time: number, hue: number, dt: number, calm: boolean) {
    const f = uniformData;
    const ph = phosphor();
    const persist = MODES[mode].persist * (calm ? 1.5 : 1);
    f.set([W, H, aspect, unit * H * 0.5], 0);
    f.set([hsx, hsy, 0.09, 0.045], 4);
    f.set([unit, GX, GY, time], 8);
    f.set([Math.exp(-dt / 0.03), Math.exp(-dt / persist), 0.85, scatter], 12);
    f.set([...hueRotate(ph.fast, hue), 1.5 * (1 + 0.25 * flash)], 16);
    f.set([...hueRotate(ph.slow, hue), 1.3 + 0.5 * Math.min(1, bassS) + 0.5 * flash], 20);
    f.set([...hueRotate(ph.grat, hue), 0.16], 24);
    f.set([0.6, 0.5, 0.012, 0], 28);
    device.queue.writeBuffer(uniformBuf, 0, f);
  }

  return {
    resize(w, h, dpr) {
      if (lost) { lost.resize?.(w, h, dpr); return; }
      build(w, h, dpr);
    },

    frame({ audio, settings, dt, time }) {
      if (disposed || lost) return;
      const sens = settings.sensitivity, scale = settings.scale, speed = settings.speed;
      readAudio(audio, sens, dt, time, speed);
      analyse(audio, dt);
      modeTime += dt;
      tStepSince += dt;
      morph = Math.min(1, morph);
      phMix = Math.min(1, phMix + dt / 0.9);
      if (lockedMode < 0 && modeTime > 32 / Math.max(0.3, speed)) cut(audio, time);
      const calm = audio.silent || audio.beat.confidence < 0.3 || energyS < 0.16;

      // the beam: brighter on the beat, a little out of focus on the snare, jittery on hats
      segCount = 0;
      totalE = 0;
      blank = Math.max(0, blank - dt / 0.08);
      gain = 1 - blank;
      sigma = (0.0042 + 0.0035 * snareS) * Math.max(0.8, Math.min(1.6, scale));
      const jit = 0.0035 * Math.max(0, hatS - 0.15);
      jx = (Math.random() - 0.5) * jit;
      jy = (Math.random() - 0.5) * jit;
      const b = (0.9 + 0.85 * pulse + 0.35 * flash) * (audio.silent ? 0.6 : 1);
      switch (mode) {
        case YT: drawYT(sens, scale, b, srate); break;
        case XY: drawXY(sens, scale, b); break;
        case VECTOR: drawVector(dt, sens, scale, speed, b); break;
        case DOTS: drawDots(audio, dt, sens, scale, speed, b); break;
        case SPARKS: drawSparks(audio, dt, sens, scale, b); break;
        default: drawPolar(dt, sens, scale, speed, b);
      }
      scatter += (Math.min(0.06, totalE * 0.004) - scatter) * (1 - Math.exp(-dt / 0.1));
      drawHud(time, audio);
      writeUniforms(time, settings.hueShift, dt, calm);
      if (segCount) device.queue.writeBuffer(segBuf, 0, segData, 0, segCount * 8);

      const encoder = device.createCommandEncoder();
      const beam = encoder.beginRenderPass({ colorAttachments: [{ view: beamTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      if (segCount) {
        beam.setPipeline(beamPipe);
        beam.setBindGroup(0, beamBG);
        beam.draw(6, segCount);
      }
      beam.end();
      const pass = (target: GPUTextureView, p: GPURenderPipeline, g: GPUBindGroup) => {
        const rp = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        rp.setPipeline(p);
        rp.setBindGroup(0, g);
        rp.draw(3);
        rp.end();
      };
      const next = 1 - cur;
      pass(accum[next].createView(), phosPipe, bg.phos[next]);
      pass(b1a.createView(), downPipe, bg.down1[next]);
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
      segBuf.destroy();
      context.unconfigure();
      device.destroy();
      canvas.remove();
    },
  };
};

export default Oscilloscope;
