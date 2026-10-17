/**
 * Blob Tracker — VoltViz's first WebGPU visualizer (raw WebGPU + WGSL, no library).
 *
 * The "blob tracking" look: bold words on tilted 3D planes with depth of field, glowing blobs
 * and outlines, filmed off an LED wall; over it a tracker HUD that boxes every bright region
 * with a hatched (inverting) square, its "x: y:" coordinates and a line linking the boxes.
 *
 * The tracking is real: a compute shader measures the luminance of the rendered frame on a
 * coarse grid, the grid is read back asynchronously (a frame or two late, like a real tracker)
 * and labelled into connected components on the CPU, which become the tracked boxes.
 *
 * Passes per frame: scene (text planes, blobs, outline) → feedback (ghost trails) → detect
 * (compute) → bloom (two levels) → final (tone map, inverting hatch, chromatic aberration,
 * LED mask, grain). The HUD is a Canvas 2D uploaded as a texture each frame: red = white
 * lines and labels, green = the hatch that inverts the picture underneath.
 *
 * Words come from the Sendspin track title/artist when there is one. Scenes cut on strong beats.
 */
import type { AudioFrame } from '../../audio/types';
import { avg, beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { BUF, compileShader, MAP_READ, noWebGPUReason, TEX, webgpuFallback as fallback } from '../lib/webgpu';
import type { VisualizerFactory, VisualizerInstance } from '../runtime/types';

// ---------------------------------------------------------------------------------------------
// WGSL

const PRELUDE = /* wgsl */ `
struct Plane { c: vec4f, u: vec4f, v: vec4f, rect: vec4f };
struct Blob { p: vec4f, c: vec4f, s: vec4f };
struct Ring { p: vec4f, c: vec4f, s: vec4f };
struct U {
  res: vec4f,   // w, h, 1/w, 1/h (render px)
  time: vec4f,  // time, pulse, kick, snare
  cam: vec4f,   // focal, focus distance, dof, exposure
  bg: vec4f,    // rgb, -
  tint: vec4f,  // rgb, led mask amount
  fx: vec4f,    // trail decay, warp zoom, chromatic aberration, glitch
  fx2: vec4f,   // warp x, warp y, led cell (px), flash
  planes: array<Plane, 2>,
  blobs: array<Blob, 8>,
  ring: Ring,
  duoLo: vec4f, // palette grade: shadow rgb, grade amount
  duoHi: vec4f, // palette grade: highlight rgb, desaturation (build-ups)
  fx3: vec4f,   // drop, mirror fold, invert flash, hat shimmer
  fx4: vec4f,   // colour wash rgb (premultiplied), tracking tear
  fx5: vec4f,   // bloom gain, halo scale, -, -
  eq: vec4f,    // equalizer: amount, baseline y, max height, half width
  eqCol: vec4f, // equalizer colour, peak-cap brightness
  spec: array<vec4f, 8>,  // 32 bar heights 0..1
  peaks: array<vec4f, 8>, // 32 peak caps 0..1
};
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
`;

const SCENE_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var atlas: texture_2d<f32>;

struct Hit { uv: vec2f, t: f32 };

fn hitPlane(pl: Plane, d: vec3f) -> Hit {
  let n = cross(pl.u.xyz, pl.v.xyz);
  let dn = dot(d, n);
  let t = dot(pl.c.xyz, n) / select(dn, 1e-4, abs(dn) < 1e-4);
  let p = d * t - pl.c.xyz;
  let l = vec2f(dot(p, pl.u.xyz) / pl.u.w, dot(p, pl.v.xyz) / pl.v.w);
  var h: Hit;
  h.t = t;
  h.uv = pl.rect.xy + (vec2f(l.x, -l.y) * 0.5 + 0.5) * pl.rect.zw;
  return h;
}

// Text on a plane with depth of field: a mip level for the blur size plus a small disc of taps.
fn shadePlane(pl: Plane, h: Hit, footprint: f32) -> f32 {
  if (pl.c.w <= 0.0 || h.t < 0.05) { return 0.0; }
  let ts = vec2f(textureDimensions(atlas, 0));
  let coc = u.cam.z * abs(h.t - u.cam.y) / max(h.t, 0.1);
  let blurUv = coc * (h.t / u.cam.x) / pl.u.w * 0.5 * pl.rect.z;
  let lod = clamp(log2(max(footprint * ts.x, blurUv * ts.x * 0.35) + 1e-4) - 0.5, 0.0, 6.5);
  let lo = pl.rect.xy + 0.5 / ts;
  let hi = pl.rect.xy + pl.rect.zw - 0.5 / ts;
  var a = 0.0;
  for (var k = 0; k < 8; k++) {
    let ang = f32(k) * 2.39996;
    let r = sqrt((f32(k) + 0.5) / 8.0);
    let o = vec2f(cos(ang), sin(ang) * ts.x / ts.y) * r * blurUv;
    a += textureSampleLevel(atlas, samp, clamp(h.uv + o, lo, hi), lod).r;
  }
  return a / 8.0 * pl.c.w;
}

fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Blobs (rounded squares / circles with a hot core and a halo) and the outline shape.
fn shapes(sp: vec2f) -> vec3f {
  var col = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    let b = u.blobs[k];
    if (b.c.w <= 0.0) { continue; }
    let cs = cos(b.s.z);
    let sn = sin(b.s.z);
    var q = sp - b.p.xy;
    q = vec2f(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / b.p.zw;
    let rr = b.s.x;
    let dd = length(max(abs(q) - vec2f(1.0 - rr), vec2f(0.0))) - rr;
    let hard = b.s.y;
    let core = 1.0 - smoothstep(-mix(0.9, 0.04, hard), 0.03, dd);
    let halo = exp(-max(dd, 0.0) * mix(3.0, 8.0, hard) / u.fx5.y);
    let c = mix(b.c.rgb, vec3f(1.0), core * 0.65);
    col += c * (core * 2.4 + halo * 0.32) * b.c.w;
  }
  let rg = u.ring;
  if (rg.c.w > 0.0) {
    let rd = sdRoundBox(sp - rg.p.xy, rg.p.zw, rg.s.x);
    let line = exp(-pow(abs(rd) / rg.s.y, 2.0));
    let glow = exp(-abs(rd) / (rg.s.y * 9.0));
    col += rg.c.rgb * (line * 1.6 + glow * 0.22) * rg.c.w;
  }
  return col;
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let res = u.res.xy;
  let sp = (i.pos.xy - 0.5 * res) / res.y * vec2f(2.0, -2.0);
  let d = normalize(vec3f(sp, -u.cam.x));

  let h0 = hitPlane(u.planes[0], d);
  let h1 = hitPlane(u.planes[1], d);
  let f0 = length(fwidth(h0.uv));
  let f1 = length(fwidth(h1.uv));

  // Background: the scene colour, a soft falloff to the corners.
  var col = u.bg.rgb * (1.15 - 0.45 * length(sp * vec2f(0.6, 0.9)));

  // Far plane first (dimmer, usually out of focus), then the main one.
  col += vec3f(1.0) * shadePlane(u.planes[1], h1, f1) * 1.6;
  col += vec3f(1.0) * shadePlane(u.planes[0], h0, f0) * 1.7;

  // Shapes; in drops they fold onto their mirror image (the type is left alone, so it reads).
  var sh = shapes(sp);
  if (u.fx3.y > 0.0) { sh = max(sh, shapes(vec2f(-sp.x, sp.y)) * u.fx3.y); }
  col += sh;

  // LED equalizer: 32 segmented bars with a dim reflection and slowly falling peak caps.
  if (u.eq.x > 0.0) {
    let hw = u.eq.w;
    let fx = (sp.x + hw) / (2.0 * hw) * 32.0;
    if (fx >= 0.0 && fx < 32.0) {
      let bi = u32(fx);
      let fr = fract(fx);
      let hgt = u.spec[bi / 4u][bi % 4u] * u.eq.z;
      let pk = u.peaks[bi / 4u][bi % 4u] * u.eq.z;
      let y = sp.y - u.eq.y;
      let segH = u.eq.z / 24.0;
      let seg = fract(y / segH);
      let colMask = smoothstep(0.08, 0.16, fr) * (1.0 - smoothstep(0.84, 0.92, fr));
      let segMask = smoothstep(0.1, 0.22, seg) * (1.0 - smoothstep(0.78, 0.9, seg));
      let lit = select(0.0, 1.0, y >= 0.0 && y <= hgt);
      let refl = select(0.0, 0.2 * exp(y / (segH * 3.0)), y < 0.0 && -y <= hgt * 0.5);
      let cap = select(0.0, 1.0, pk > segH && abs(y - pk - segH * 0.5) < segH * 0.35);
      let top = clamp(y / max(u.eq.z, 1e-3), 0.0, 1.0);
      let c = mix(u.eqCol.rgb, vec3f(1.0), top * 0.7);
      col += c * colMask * (segMask * (lit + refl) * 1.6 + cap * u.eqCol.w) * u.eq.x;
    }
  }

  return vec4f(col, 1.0);
}
`;

const FEEDBACK_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var cur: texture_2d<f32>;
@group(0) @binding(3) var prev: texture_2d<f32>;

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let s = textureSampleLevel(cur, samp, i.uv, 0.0).rgb;
  let w = (i.uv - 0.5) * u.fx.y + 0.5 + u.fx2.xy;
  let p = min(textureSampleLevel(prev, samp, w, 0.0).rgb, vec3f(0.9)) * u.fx.x;
  return vec4f(max(s, p), 1.0);
}
`;

const BLOOM_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var hud: texture_2d<f32>;

fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }

fn box4(uv: vec2f) -> vec3f {
  let px = 1.0 / vec2f(textureDimensions(src, 0));
  return (tap(uv + px * vec2f(-1.0, -1.0)) + tap(uv + px * vec2f(1.0, -1.0))
        + tap(uv + px * vec2f(-1.0, 1.0)) + tap(uv + px * vec2f(1.0, 1.0))) * 0.25;
}

// First level: frame + HUD lines, with a soft knee so only the bright parts bloom.
@fragment fn fsDown1(i: VSOut) -> @location(0) vec4f {
  let c = box4(i.uv) + vec3f(textureSampleLevel(hud, samp, i.uv, 0.0).r * 0.45);
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return vec4f(c * smoothstep(0.25, 1.6, l), 1.0);
}

@fragment fn fsDown(i: VSOut) -> @location(0) vec4f { return vec4f(box4(i.uv), 1.0); }

fn blur(uv: vec2f, dir: vec2f) -> vec4f {
  let px = dir / vec2f(textureDimensions(src, 0)) * 1.25;
  var c = tap(uv) * 0.2270;
  c += (tap(uv + px * 1.3846) + tap(uv - px * 1.3846)) * 0.3162;
  c += (tap(uv + px * 3.2308) + tap(uv - px * 3.2308)) * 0.0703;
  return vec4f(c, 1.0);
}
@fragment fn fsBlurH(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(1.0, 0.0)); }
@fragment fn fsBlurV(i: VSOut) -> @location(0) vec4f { return blur(i.uv, vec2f(0.0, 1.0)); }
`;

const FINAL_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var frameT: texture_2d<f32>;
@group(0) @binding(3) var hudT: texture_2d<f32>;
@group(0) @binding(4) var bloom1: texture_2d<f32>;
@group(0) @binding(5) var bloom2: texture_2d<f32>;

fn hdr(uv: vec2f) -> vec3f {
  return textureSampleLevel(frameT, samp, uv, 0.0).rgb
       + (textureSampleLevel(bloom1, samp, uv, 0.0).rgb * 0.4
       + textureSampleLevel(bloom2, samp, uv, 0.0).rgb * 0.75) * u.fx5.x;
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let t = u.time.x;
  var uv = i.uv;

  // Glitch: on a hard snare, slices jump sideways and smear into blocks for a few frames.
  let g = u.fx.w;
  let r = hash21(vec2f(floor(uv.y * 30.0), floor(t * 24.0)));
  if (r > 1.0 - 0.4 * g) {
    uv.x += (r - 0.5) * 0.1 * g;
    uv.y = mix(uv.y, (floor(uv.y * 18.0) + 0.5) / 18.0, g * 0.8);
  }

  // Tracking tear: a band rolling up the screen during build-ups.
  let band = fract(uv.y + t * 0.23);
  let inBand = smoothstep(0.0, 0.015, band) * (1.0 - smoothstep(0.04, 0.07, band)) * u.fx4.w;
  uv.x += inBand * (hash21(vec2f(floor(uv.y * 240.0), floor(t * 30.0))) - 0.5) * 0.05;

  let dir = uv - 0.5;
  let ca = u.fx.z * (0.35 + dot(dir, dir) * 3.0);
  var col = vec3f(hdr(uv + dir * ca).r, hdr(uv).g, hdr(uv - dir * ca).b);

  // Grade before the tone curve so highlights still burn out to white.
  col = 1.0 - exp(-col * u.tint.rgb * u.cam.w);

  // Palette grade (a duotone cast, like a filmed LED wall) and desaturation in build-ups.
  let luma = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(col, mix(u.duoLo.rgb, u.duoHi.rgb, smoothstep(0.0, 1.0, luma)), u.duoLo.w);
  col = mix(col, vec3f(luma), u.duoHi.w);
  col += vec3f(inBand * 0.12);

  // Downbeats: a short inverted frame or a wash of the palette colour.
  col = mix(col, vec3f(1.0) - col, u.fx3.z);
  col += u.fx4.rgb;

  // HUD: green = hatch that inverts what is under it, red = lines and labels (palette-tinted white).
  let hud = textureSampleLevel(hudT, samp, uv, 0.0);
  col = mix(col, vec3f(1.0) - col, clamp(hud.g, 0.0, 1.0) * 0.8);
  col += hud.r * 0.95 * mix(vec3f(1.0), u.duoHi.rgb, 0.3);
  col += vec3f(u.fx2.w * 0.3);

  // LED wall: RGB sub-pixel columns and dark gaps between cells.
  let cell = u.fx2.z;
  let local = i.pos.xy - floor(i.pos.xy / cell) * cell;
  let ph = local.x / cell;
  let sub = vec3f(
    0.5 + 0.5 * cos(6.2831853 * (ph - 0.1667)),
    0.5 + 0.5 * cos(6.2831853 * (ph - 0.5)),
    0.5 + 0.5 * cos(6.2831853 * (ph - 0.8333)));
  let e = min(local, vec2f(cell) - local) / cell;
  let gap = smoothstep(0.0, 0.2, min(e.x, e.y));
  let mask = mix(vec3f(0.42), vec3f(1.0), sub) * mix(0.3, 1.0, gap) * 1.55;
  // hi-hats make single LED cells flicker
  let shimmer = 1.0 + u.fx3.w * (hash21(floor(i.pos.xy / cell) + vec2f(floor(t * 30.0) * 13.0, 0.0)) - 0.5);
  col = mix(col, col * mask * shimmer, u.tint.w);

  // Camera: vignette, a slow rolling refresh band, grain.
  let vig = smoothstep(1.25, 0.25, length(dir * vec2f(1.6, 1.9)));
  col *= mix(0.45, 1.0, vig);
  col *= 1.0 - 0.06 * (0.5 + 0.5 * sin(uv.y * 5.0 - t * 1.3));
  col += vec3f((hash21(i.pos.xy + vec2f(fract(t * 7.13) * 911.0, 0.0)) - 0.5) * 0.04);
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// Mipmap generation for the text atlas: each level is a linear (2×2 box) downsample of the last.
const MIP_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@fragment fn fs(i: VSOut) -> @location(0) vec4f { return textureSampleLevel(src, samp, i.uv, 0.0); }
`;

const DETECT_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<u32>;
@group(0) @binding(2) var<uniform> grid: vec4u; // cols, rows, cell px, -

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= grid.x || id.y >= grid.y) { return; }
  let dims = textureDimensions(src, 0);
  let c = grid.z;
  var s = 0.0;
  for (var j = 0u; j < 4u; j++) {
    for (var i = 0u; i < 4u; i++) {
      let p = vec2u(id.x * c + (i * c) / 4u + c / 8u, id.y * c + (j * c) / 4u + c / 8u);
      s += dot(textureLoad(src, min(p, dims - 1u), 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
    }
  }
  outBuf[id.y * grid.x + id.x] = u32(clamp(s / 16.0, 0.0, 60.0) * 1000.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Scene description (CPU side)

type V3 = [number, number, number];

interface PlaneSpec { row: number; pos: V3; yaw: number; pitch: number; roll: number; h: number; intensity: number }
interface BlobSpec { x: number; y: number; sx: number; sy: number; color: V3; intensity: number; round: number; hard: number; rot?: number }
interface RingSpec { x: number; y: number; hx: number; hy: number; radius: number; thickness: number; color: V3; intensity: number }
interface EqSpec { amount: number; y: number; h: number; hw: number }
interface SceneOut {
  planes: (PlaneSpec | null)[]; blobs: BlobSpec[]; ring: RingSpec | null; eq?: EqSpec;
  focus: number; dof: number; trail: number; drift: [number, number]; zoom: number;
}
interface SceneIn {
  phase: number; local: number; pulse: number; kick: number; snare: number; hat: number;
  bass: number; mid: number; treble: number; seed: number; ax: number; scale: number;
  /** Smoothed sub, bass, lowMid, mid, highMid, treble, kick and snare envelopes (0..1.5). */
  bands: number[];
  pal: Palette;
  aspect: (row: number) => number;
}

/** A colour look: background, grade, and the colours of blobs, outlines and bars. */
interface Palette {
  name: string;
  bg: V3; tint: V3;
  accent: V3; alt: V3; hot: V3; // blob / outline / bar colours
  lo: V3; hi: V3; grade: number; // duotone grade: shadow and highlight colour, amount
}

// Blue first: the pick is weighted towards the first three.
const PALETTES: Palette[] = [
  { name: 'ultramarine', bg: [0.02, 0.08, 0.6], tint: [0.95, 0.97, 1.05], accent: [0.7, 0.85, 1], alt: [0.45, 0.62, 1], hot: [0.92, 0.96, 1], lo: [0, 0.03, 0.28], hi: [0.92, 0.96, 1], grade: 0.3 },
  { name: 'cobalt', bg: [0.004, 0.016, 0.07], tint: [0.75, 0.95, 1.1], accent: [0.2, 0.85, 1], alt: [0.35, 0.5, 1], hot: [0.85, 1, 1], lo: [0, 0.02, 0.09], hi: [0.78, 1, 1], grade: 0.45 },
  { name: 'violet', bg: [0.03, 0.008, 0.1], tint: [0.95, 0.82, 1.1], accent: [0.72, 0.45, 1], alt: [1, 0.35, 0.78], hot: [1, 0.9, 1], lo: [0.05, 0, 0.13], hi: [1, 0.88, 1], grade: 0.4 },
  { name: 'acid', bg: [0.006, 0.012, 0.004], tint: [0.85, 1.05, 0.7], accent: [0.75, 1, 0.2], alt: [0.3, 1, 0.6], hot: [0.95, 1, 0.85], lo: [0, 0.02, 0], hi: [0.92, 1, 0.7], grade: 0.4 },
  { name: 'infrared', bg: [0.022, 0.006, 0.004], tint: [1.1, 0.8, 0.66], accent: [1, 0.42, 0.1], alt: [1, 0.16, 0.22], hot: [1, 0.95, 0.82], lo: [0.07, 0, 0], hi: [1, 0.9, 0.76], grade: 0.4 },
  { name: 'mint', bg: [0.008, 0.022, 0.018], tint: [0.72, 1, 0.85], accent: [0.45, 1, 0.65], alt: [1, 0.55, 0.2], hot: [0.9, 1, 0.92], lo: [0, 0.03, 0.02], hi: [0.85, 1, 0.9], grade: 0.3 },
  { name: 'mono', bg: [0.02, 0.02, 0.024], tint: [1, 1, 1], accent: [0.9, 0.92, 1], alt: [1, 0.96, 0.82], hot: [1, 1, 1], lo: [0, 0, 0], hi: [1, 1, 1], grade: 0 },
];
const PALETTE_WEIGHTS = [2, 2, 1.5, 1, 1, 1, 0.75];

function pickPalette(not: string, blueOnly = false): Palette {
  const n = blueOnly ? 2 : PALETTES.length;
  let total = 0;
  for (let i = 0; i < n; i++) if (PALETTES[i].name !== not) total += PALETTE_WEIGHTS[i];
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    if (PALETTES[i].name === not) continue;
    r -= PALETTE_WEIGHTS[i];
    if (r <= 0) return PALETTES[i];
  }
  return PALETTES[0];
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const m = (x: V3, y: V3): V3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  return {
    name: b.name, bg: m(a.bg, b.bg), tint: m(a.tint, b.tint), accent: m(a.accent, b.accent), alt: m(a.alt, b.alt),
    hot: m(a.hot, b.hot), lo: m(a.lo, b.lo), hi: m(a.hi, b.hi), grade: a.grade + (b.grade - a.grade) * t,
  };
}

const ROW_MAIN = 0, ROW_SECOND = 1, ROW_DIGITS = 2;

function basis(yaw: number, pitch: number, roll: number): { u: V3; v: V3 } {
  const rot = (x: number, y: number, z: number): V3 => {
    // Rz(roll) → Rx(pitch) → Ry(yaw)
    const cr = Math.cos(roll), sr = Math.sin(roll);
    let a = x * cr - y * sr, b = x * sr + y * cr, c = z;
    const cp = Math.cos(pitch), spn = Math.sin(pitch);
    const b2 = b * cp - c * spn, c2 = b * spn + c * cp;
    b = b2; c = c2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const a2 = a * cy + c * sy, c3 = -a * sy + c * cy;
    a = a2; c = c3;
    return [a, b, c];
  };
  return { u: rot(1, 0, 0), v: rot(0, 1, 0) };
}

const SCENES: { name: string; beats: number; build: (s: SceneIn) => SceneOut }[] = [
  {
    name: 'drift', beats: 16, // a word receding diagonally, warm blobs on the left (the reference look)
    build: s => {
      const sway = Math.sin(s.phase * 0.21 + s.seed * 6);
      const slide = 0.5 - s.local * 0.16;
      const b = basis(0.5 + 0.07 * sway, -0.1, 0.34);
      const push = s.pulse * 0.1;
      const o = (i: number) => 0.035 * Math.sin(s.phase * 0.6 + i * 2.1);
      return {
        planes: [
          { row: ROW_MAIN, pos: [0.3 * s.ax + b.u[0] * slide, 0.02 + b.u[1] * slide, -3.4 + b.u[2] * slide + push], yaw: 0.5 + 0.07 * sway, pitch: -0.1, roll: 0.34, h: 0.5 * s.scale, intensity: 1.15 + 0.4 * s.mid },
          { row: ROW_SECOND, pos: [2.3 * s.ax, 1.35, -8.5], yaw: 0.55, pitch: 0, roll: 0.35, h: 0.8 * s.scale, intensity: 0.35 },
        ],
        blobs: [
          { x: -0.4 * s.ax + o(0), y: -0.42 + o(1), sx: 0.17 * s.scale * (1 + 0.3 * s.kick), sy: 0.15 * s.scale * (1 + 0.3 * s.kick), color: s.pal.accent, intensity: 0.8 + 0.9 * s.kick, round: 0.45, hard: 0.25 },
          { x: -1.28 * s.ax + o(2), y: 0.74 + o(3), sx: 0.13 * s.scale, sy: 0.12 * s.scale, color: s.pal.hot, intensity: 0.8 + 0.6 * s.bass, round: 0.4, hard: 0.35 },
          { x: -1.02 * s.ax + o(4), y: 0.62 + o(5), sx: 0.09 * s.scale, sy: 0.085 * s.scale, color: s.pal.alt, intensity: 0.7 + 0.8 * s.hat, round: 0.35, hard: 0.4 },
        ],
        ring: null, focus: 3, dof: 0.16, trail: 0.72, drift: [0.0003, -0.0002], zoom: 0.999,
      };
    },
  },
  {
    name: 'count', beats: 8, // huge digits counting the beats
    build: s => ({
      planes: [
        { row: ROW_DIGITS, pos: [0.05 * Math.sin(s.phase * 0.17), -0.05, -2.45 + s.pulse * 0.12], yaw: 0.2 * Math.sin(s.local * 0.31 + s.seed * 4), pitch: 0.06, roll: -0.03, h: 0.95 * s.scale, intensity: 1.1 + 0.3 * s.mid },
        null,
      ],
      blobs: [
        { x: 0, y: 0, sx: 1.1, sy: 0.65, color: s.pal.accent, intensity: 0.1 + 0.15 * s.bass, round: 1, hard: 0 },
      ],
      ring: null, focus: 3, dof: 0.2, trail: 0.7, drift: [0, 0], zoom: 0.998,
    }),
  },
  {
    name: 'ritual', beats: 16, // a cluster of dots next to a tilted word
    build: s => {
      const cx = -0.62 * s.ax, cy = 0.04;
      const dots: [number, number][] = [[-0.14, 0.11], [-0.03, 0.15], [-0.15, -0.04], [-0.04, 0.0], [0.1, 0.1], [0.03, -0.14]];
      const bands = [s.bass, s.kick, s.mid, s.snare, s.hat, s.treble];
      const sc = s.scale * (1 + 0.25 * s.pulse);
      return {
        planes: [
          { row: ROW_MAIN, pos: [0.72 * s.ax, -0.05, -3.1 + s.pulse * 0.1], yaw: 0.42 + 0.05 * Math.sin(s.phase * 0.2), pitch: -0.06, roll: 0.22, h: 0.5 * s.scale, intensity: 1.1 + 0.3 * s.mid },
          null,
        ],
        blobs: [
          { x: cx, y: cy, sx: 0.32 * s.scale, sy: 0.3 * s.scale, color: s.pal.alt, intensity: 0.12 + 0.2 * s.bass, round: 1, hard: 0 },
          ...dots.map(([dx, dy], i): BlobSpec => ({
            x: cx + dx * sc + 0.008 * Math.sin(s.phase * 1.3 + i), y: cy + dy * sc, sx: 0.048 * sc, sy: 0.048 * sc,
            color: s.pal.hot, intensity: 0.55 + 0.9 * bands[i], round: 1, hard: 0.8,
          })),
        ],
        ring: null, focus: 3, dof: 0.4, trail: 0.74, drift: [0.0002, 0], zoom: 0.999,
      };
    },
  },
  {
    name: 'ticker', beats: 8, // a long phrase running through the frame
    build: s => {
      const hW = 0.3 * s.scale * s.aspect(ROW_MAIN);
      const span = 2 * hW + 3.2 * s.ax;
      const x = hW + 1.6 * s.ax - ((s.local * 0.55) % span);
      return {
        planes: [{ row: ROW_MAIN, pos: [x, 0.02, -2.4 + s.pulse * 0.08], yaw: 0, pitch: 0, roll: 0, h: 0.3 * s.scale, intensity: 1.3 + 0.3 * s.mid }, null],
        blobs: [],
        ring: null, focus: 3, dof: 0.05, trail: 0.8, drift: [0, 0], zoom: 1,
      };
    },
  },
  {
    name: 'blue', beats: 8, // a white pill in an ellipse on a saturated blue screen (always ultramarine)
    build: s => {
      const k = 1 + 0.35 * s.kick;
      return {
        planes: [{ row: ROW_SECOND, pos: [0.85 * s.ax, -0.08, -3.0 + s.pulse * 0.1], yaw: -0.38, pitch: 0.05, roll: 0.06, h: 0.32 * s.scale, intensity: 1.15 }, null],
        blobs: [{ x: -0.2 * s.ax, y: 0.05, sx: 0.2 * s.scale * k, sy: 0.11 * s.scale * k, color: s.pal.hot, intensity: 0.9 + 0.5 * s.bass, round: 0.95, hard: 0.6, rot: -0.12 }],
        ring: { x: -0.2 * s.ax, y: 0.05, hx: 0.36 * s.scale * k, hy: 0.21 * s.scale * k, radius: 0.21 * s.scale * k, thickness: 0.005, color: s.pal.accent, intensity: 0.7 },
        focus: 3, dof: 0.2, trail: 0.7, drift: [0, 0], zoom: 0.999,
      };
    },
  },
  {
    name: 'capsule', beats: 16, // a capsule outline with a word breaking out of it
    build: s => ({
      planes: [{ row: ROW_MAIN, pos: [0.4 * s.ax, -0.06, -2.8 + s.pulse * 0.1], yaw: 0.38 + 0.06 * Math.sin(s.phase * 0.25), pitch: 0.04, roll: -0.08, h: 0.4 * s.scale, intensity: 1.2 + 0.3 * s.mid }, null],
      blobs: [{ x: -0.72 * s.ax, y: 0.0, sx: 0.15 * s.scale * (1 + 0.3 * s.kick), sy: 0.11 * s.scale * (1 + 0.3 * s.kick), color: s.pal.hot, intensity: 0.8 + 0.8 * s.kick, round: 0.5, hard: 0.5 }],
      ring: { x: -0.18 * s.ax, y: 0.0, hx: 0.85 * s.ax * s.scale, hy: 0.25 * s.scale, radius: 0.25 * s.scale, thickness: 0.007, color: s.pal.accent, intensity: 1.1 + 0.6 * s.pulse },
      focus: 3, dof: 0.3, trail: 0.72, drift: [0.0002, 0], zoom: 0.999,
    }),
  },
  {
    name: 'equalizer', beats: 16, // a big LED spectrum; the tracker boxes the tallest bars
    build: s => ({
      planes: [{ row: ROW_MAIN, pos: [0, 0.66, -3.3 + s.pulse * 0.1], yaw: 0.14 * Math.sin(s.phase * 0.2), pitch: -0.05, roll: 0, h: 0.24 * s.scale, intensity: 1.1 + 0.3 * s.mid }, null],
      blobs: [{ x: 0, y: -0.25, sx: 1.5 * s.ax, sy: 0.45, color: s.pal.accent, intensity: 0.05 + 0.12 * s.bass, round: 1, hard: 0 }],
      ring: null, focus: 3, dof: 0.1, trail: 0.7, drift: [0, 0.0002], zoom: 1,
      eq: { amount: 1, y: -0.66, h: 0.95 * s.scale, hw: 1.5 * s.ax },
    }),
  },
  {
    name: 'orbit', beats: 16, // blobs circling a word, each one a frequency band; a ring that kicks
    build: s => {
      const n = 8, rx = 0.95 * s.ax * s.scale, ry = 0.42 * s.scale;
      const blobs: BlobSpec[] = [];
      for (let i = 0; i < n; i++) {
        const a = s.phase * 0.5 + (i / n) * Math.PI * 2;
        const e = Math.min(1.2, s.bands[i]);
        const depth = 0.75 + 0.25 * Math.sin(a); // the far side of the orbit is smaller and dimmer
        const r = (0.035 + 0.08 * e) * s.scale * depth;
        blobs.push({
          x: Math.cos(a) * rx, y: Math.sin(a) * ry + 0.02, sx: r, sy: r, color: i % 2 ? s.pal.alt : s.pal.accent,
          intensity: (0.45 + 1.1 * e) * depth, round: i % 3 === 0 ? 0.35 : 1, hard: 0.55,
        });
      }
      const k = 1 + 0.12 * s.kick;
      return {
        planes: [{ row: ROW_MAIN, pos: [0, 0, -3.0 + s.pulse * 0.12], yaw: 0.35 * Math.sin(s.phase * 0.33), pitch: 0.08 * Math.sin(s.phase * 0.21), roll: 0, h: 0.36 * s.scale, intensity: 1.15 + 0.3 * s.mid }, null],
        blobs,
        ring: { x: 0, y: 0.02, hx: rx * 1.1 * k, hy: ry * k, radius: ry * k, thickness: 0.004, color: s.pal.accent, intensity: 0.5 + 0.9 * s.kick },
        focus: 3, dof: 0.12, trail: 0.78, drift: [0, 0], zoom: 0.998,
      };
    },
  },
];

const FALLBACK_WORDS = ['elements', 'signal', 'my ritual', 'transmit', 'resonance', 'frequency', 'voltage', 'pulse', 'inner space', 'sequence'];
const TICKER_FALLBACK = ['communication', 'transmission', 'synchronize', 'interference'];

function wordsFrom(meta: { title?: string | null; artist?: string | null } | null): string[] {
  const src = [meta?.title, meta?.artist].filter(Boolean).join(' ');
  const words = src.split(/[\s\-–—_/|,.:;()[\]]+/).map(w => w.replace(/[^\p{L}\p{N}'&]/gu, '')).filter(w => w.length >= 2 && w.length <= 14);
  return words.length ? words.map(w => w.toLowerCase()) : FALLBACK_WORDS;
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
// Blob detection (CPU side of the tracker)

interface Det { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; score: number }
interface Track {
  id: number; x0: number; y0: number; x1: number; y1: number;
  t: Det; age: number; miss: number; scramble: number;
}

const GRID_MAX_W = 200, GRID_MAX_H = 120;
const THRESHOLD = 1300; // luminance * 1000 (HDR, before the tone curve)

function findBlobs(data: Uint32Array, gw: number, gh: number, maxCells: number, threshold: number, maxKeep: number,
  labels: Int32Array, members: Int32Array): Det[] {
  const n = gw * gh;
  let thr = threshold;
  for (let pass = 0; pass < 4; pass++) {
    let on = 0;
    for (let i = 0; i < n; i++) if (data[i] > thr) on++;
    if (on < n * 0.22) break;
    thr *= 1.6;
  }
  labels.fill(0, 0, n);
  const out: Det[] = [];
  let label = 0;
  for (let start = 0; start < n; start++) {
    if (labels[start] || data[start] <= thr) continue;
    label++;
    let head = 0, tail = 0;
    members[tail++] = start;
    labels[start] = label;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (head < tail) {
      const idx = members[head++];
      const x = idx % gw, y = (idx - x) / gw;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !labels[idx - 1] && data[idx - 1] > thr) { labels[idx - 1] = label; members[tail++] = idx - 1; }
      if (x < gw - 1 && !labels[idx + 1] && data[idx + 1] > thr) { labels[idx + 1] = label; members[tail++] = idx + 1; }
      if (y > 0 && !labels[idx - gw] && data[idx - gw] > thr) { labels[idx - gw] = label; members[tail++] = idx - gw; }
      if (y < gh - 1 && !labels[idx + gw] && data[idx + gw] > thr) { labels[idx + gw] = label; members[tail++] = idx + gw; }
    }
    const count = tail;
    if (count < 2 || count > n * 0.35) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // Long runs of type split along the long axis (a box per letter or two); big regions split
    // into a grid, so a box never grows past `maxCells`.
    const nx = Math.min(8, Math.max(w > 2.2 * h && w >= 6 ? Math.round(w / (h * 1.15)) : 1, Math.ceil(w / maxCells)));
    const ny = Math.min(4, Math.ceil(h / maxCells));
    for (let p = 0; p < nx * ny; p++) {
      const pxi = p % nx, pyi = (p - pxi) / nx;
      if (nx * ny > 2 && (pxi + 2 * pyi) % 3 !== 0) continue; // box every third chunk: the type stays readable
      const cxa = x0 + (pxi * w) / nx, cxb = x0 + ((pxi + 1) * w) / nx;
      const cya = y0 + (pyi * h) / ny, cyb = y0 + ((pyi + 1) * h) / ny;
      let px0 = gw, py0 = gh, px1 = -1, py1 = -1, pw = 0, psx = 0, psy = 0, pc = 0;
      for (let m = 0; m < count; m++) {
        const idx = members[m];
        const x = idx % gw;
        if (x < cxa || x >= cxb) continue;
        const y = (idx - x) / gw;
        if (y < cya || y >= cyb) continue;
        const v = data[idx];
        pw += v; psx += x * v; psy += y * v; pc++;
        if (x < px0) px0 = x; if (x > px1) px1 = x;
        if (y < py0) py0 = y; if (y > py1) py1 = y;
      }
      if (pc < 2) continue;
      out.push({ x0: px0, y0: py0, x1: px1 + 1, y1: py1 + 1, cx: psx / pw + 0.5, cy: psy / pw + 0.5, score: pw });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // Keep boxes apart (a stronger one nearby wins), so they spread over the frame and the
  // type between them stays readable.
  const kept: Det[] = [];
  for (const d of out) {
    const dw = d.x1 - d.x0, dh = d.y1 - d.y0;
    const clash = kept.some(k => Math.hypot(k.cx - d.cx, k.cy - d.cy) < 1.1 * Math.max(dw, dh, k.x1 - k.x0, k.y1 - k.y0));
    if (!clash) kept.push(d);
    if (kept.length >= maxKeep) break;
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------

const UNIFORM_FLOATS = 260;
const MAX_RENDER_PIXELS = 2560 * 1440;
const ATLAS_W = 2048, ATLAS_H = 1024, ROW_H = 256, ATLAS_MIPS = 7;

const BlobTracker: VisualizerFactory = async ({ container, metadata: initialMeta }) => {
  const gpu = navigator.gpu;
  if (!gpu) return fallback(container, noWebGPUReason());
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
  const compile = (code: string, label: string) => compileShader(device, code, label);
  const [sceneMod, feedbackMod, bloomMod, finalMod, detectMod, mipMod] = await Promise.all([
    compile(SCENE_WGSL, 'blobtracker-scene'), compile(FEEDBACK_WGSL, 'blobtracker-feedback'),
    compile(BLOOM_WGSL, 'blobtracker-bloom'), compile(FINAL_WGSL, 'blobtracker-final'),
    compile(DETECT_WGSL, 'blobtracker-detect'), compile(MIP_WGSL, 'blobtracker-mip'),
  ]);
  const HDR: GPUTextureFormat = 'rgba16float';
  const pipe = (module: GPUShaderModule, entryPoint: string, fmt: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint, targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
  const [scenePipe, feedbackPipe, down1Pipe, downPipe, blurHPipe, blurVPipe, finalPipe, mipPipe, detectPipe] = await Promise.all([
    pipe(sceneMod, 'fs', HDR), pipe(feedbackMod, 'fs', HDR),
    pipe(bloomMod, 'fsDown1', HDR), pipe(bloomMod, 'fsDown', HDR),
    pipe(bloomMod, 'fsBlurH', HDR), pipe(bloomMod, 'fsBlurV', HDR),
    pipe(finalMod, 'fs', format), pipe(mipMod, 'fs', 'rgba8unorm'),
    device.createComputePipelineAsync({ layout: 'auto', compute: { module: detectMod, entryPoint: 'main' } }),
  ]);
  const setupError = await device.popErrorScope();
  if (setupError) throw new Error(`Blob Tracker: ${setupError.message}`);

  const sampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });
  const uniformData = new Float32Array(UNIFORM_FLOATS);
  const uniformBuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });
  const gridBuf = device.createBuffer({ size: 16, usage: BUF.UNIFORM | BUF.COPY_DST });
  const lumaBytes = GRID_MAX_W * GRID_MAX_H * 4;
  const lumaBuf = device.createBuffer({ size: lumaBytes, usage: BUF.STORAGE | BUF.COPY_SRC });
  const readbacks = [0, 1].map(() => ({
    buf: device.createBuffer({ size: lumaBytes, usage: BUF.MAP_READ | BUF.COPY_DST }),
    busy: false,
  }));

  // --- text atlas: words drawn with Canvas 2D one row at a time, mipmaps built on the GPU ----
  // The row canvas is CPU-backed (willReadFrequently) so reading it back never stalls on the GPU;
  // uploads are queued and flushed (with one mip rebuild) at the start of the next frame.
  const atlasTex = device.createTexture({
    size: [ATLAS_W, ATLAS_H], format: 'rgba8unorm', mipLevelCount: ATLAS_MIPS,
    usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT,
  });
  const mipLevels = Array.from({ length: ATLAS_MIPS - 1 }, (_, i) => ({
    target: atlasTex.createView({ baseMipLevel: i + 1, mipLevelCount: 1 }),
    group: device.createBindGroup({
      layout: mipPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: atlasTex.createView({ baseMipLevel: i, mipLevelCount: 1 }) }],
    }),
  }));
  const rowCanvas = document.createElement('canvas');
  rowCanvas.width = ATLAS_W;
  rowCanvas.height = ROW_H;
  const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
  const rowWidth = [ATLAS_W / 4, ATLAS_W / 4, ATLAS_W / 4, ATLAS_W / 4];
  const rowText = ['', '', '', ''];
  let atlasDirty = false;
  const FONT = '"Segoe UI", "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

  function renderRow(row: number, text: string, digits = false) {
    if (rowText[row] === text) return;
    rowText[row] = text;
    const ctx = rowCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ATLAS_W, ROW_H);
    const pad = 44;
    let size = digits ? 214 : 164;
    ctx.font = `${digits ? 700 : 800} ${size}px ${FONT}`;
    let tw = ctx.measureText(text).width;
    if (tw > ATLAS_W - 2 * pad) {
      size *= (ATLAS_W - 2 * pad) / tw;
      ctx.font = `${digits ? 700 : 800} ${size}px ${FONT}`;
      tw = ctx.measureText(text).width;
    }
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, pad, ROW_H / 2 + size * (digits ? 0.36 : 0.3));
    rowWidth[row] = Math.min(ATLAS_W, Math.ceil(tw + pad * 2));
    const px = ctx.getImageData(0, 0, ATLAS_W, ROW_H);
    device.queue.writeTexture({ texture: atlasTex, origin: { x: 0, y: row * ROW_H } }, px.data, { bytesPerRow: ATLAS_W * 4 }, [ATLAS_W, ROW_H]);
    atlasDirty = true;
  }

  function buildMips(encoder: GPUCommandEncoder) {
    for (const lv of mipLevels) {
      const rp = encoder.beginRenderPass({ colorAttachments: [{ view: lv.target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      rp.setPipeline(mipPipe);
      rp.setBindGroup(0, lv.group);
      rp.draw(3);
      rp.end();
    }
  }
  const rowAspect = (row: number) => rowWidth[row] / ROW_H;

  // --- HUD (Canvas 2D: red = lines/labels, green = inverting hatch) ----------------------------
  const hudCanvas = document.createElement('canvas');
  const hud = hudCanvas.getContext('2d')!;
  const hatchTile = document.createElement('canvas');
  hatchTile.width = hatchTile.height = 11;
  {
    const t = hatchTile.getContext('2d')!;
    t.strokeStyle = '#0f0';
    t.lineWidth = 2;
    t.beginPath();
    t.moveTo(-1, 12); t.lineTo(12, -1);
    t.moveTo(-1, 1); t.lineTo(1, -1);
    t.moveTo(10, 12); t.lineTo(12, 10);
    t.stroke();
  }
  const hatch = hud.createPattern(hatchTile, 'repeat')!;

  // --- size-dependent resources ----------------------------------------------------------------
  let W = 1, H = 1, cssW = 1, cssH = 1, pxPerCss = 1, hudScale = 1;
  let gridW = 1, gridH = 1, cellPx = 8;
  let targets: GPUTexture[] = [];
  let sceneTex!: GPUTexture, accum!: GPUTexture[], hudTex!: GPUTexture, b1a!: GPUTexture, b1b!: GPUTexture, b2a!: GPUTexture, b2b!: GPUTexture;
  let bg: {
    scene: GPUBindGroup; feedback: GPUBindGroup[]; down1: GPUBindGroup[]; blurH1: GPUBindGroup; blurV1: GPUBindGroup;
    down2: GPUBindGroup; blurH2: GPUBindGroup; blurV2: GPUBindGroup; final: GPUBindGroup[]; detect: GPUBindGroup[];
  };

  const sceneBG = device.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }, { binding: 1, resource: sampler }, { binding: 2, resource: atlasTex.createView() }],
  });

  function build(w: number, h: number, dpr: number) {
    cssW = Math.max(1, w); cssH = Math.max(1, h);
    let s = dpr;
    if (cssW * cssH * s * s > MAX_RENDER_PIXELS) s = Math.sqrt(MAX_RENDER_PIXELS / (cssW * cssH));
    pxPerCss = s;
    W = Math.max(2, Math.round(cssW * s));
    H = Math.max(2, Math.round(cssH * s));
    canvas.width = W;
    canvas.height = H;
    hudScale = Math.min(s, 1.5);
    hudCanvas.width = Math.max(1, Math.round(cssW * hudScale));
    hudCanvas.height = Math.max(1, Math.round(cssH * hudScale));

    cellPx = Math.max(Math.round(10 * s), Math.ceil(W / GRID_MAX_W), Math.ceil(H / GRID_MAX_H));
    gridW = Math.ceil(W / cellPx);
    gridH = Math.ceil(H / cellPx);
    device.queue.writeBuffer(gridBuf, 0, new Uint32Array([gridW, gridH, cellPx, 0]));

    for (const t of targets) t.destroy();
    const tex = (tw: number, th: number, fmt: GPUTextureFormat = HDR, extra = 0) => {
      const t = device.createTexture({
        size: [Math.max(1, tw), Math.max(1, th)], format: fmt,
        usage: TEX.RENDER_ATTACHMENT | TEX.TEXTURE_BINDING | extra,
      });
      targets.push(t);
      return t;
    };
    targets = [];
    sceneTex = tex(W, H);
    accum = [tex(W, H), tex(W, H)];
    hudTex = tex(hudCanvas.width, hudCanvas.height, 'rgba8unorm', TEX.COPY_DST);
    b1a = tex(Math.ceil(W / 4), Math.ceil(H / 4));
    b1b = tex(Math.ceil(W / 4), Math.ceil(H / 4));
    b2a = tex(Math.ceil(W / 16), Math.ceil(H / 16));
    b2b = tex(Math.ceil(W / 16), Math.ceil(H / 16));

    const group = (p: GPURenderPipeline | GPUComputePipeline, res: GPUBindingResource[]) => device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: res.map((resource, binding) => ({ binding, resource })),
    });
    const v = (t: GPUTexture) => t.createView();
    const U = { buffer: uniformBuf };
    bg = {
      scene: sceneBG,
      feedback: [0, 1].map(i => group(feedbackPipe, [U, sampler, v(sceneTex), v(accum[1 - i])])),
      down1: [0, 1].map(i => group(down1Pipe, [sampler, v(accum[i]), v(hudTex)])),
      blurH1: group(blurHPipe, [sampler, v(b1a)]),
      blurV1: group(blurVPipe, [sampler, v(b1b)]),
      down2: group(downPipe, [sampler, v(b1a)]),
      blurH2: group(blurHPipe, [sampler, v(b2a)]),
      blurV2: group(blurVPipe, [sampler, v(b2b)]),
      final: [0, 1].map(i => group(finalPipe, [U, sampler, v(accum[i]), v(hudTex), v(b1a), v(b2a)])),
      detect: [0, 1].map(i => group(detectPipe, [v(accum[i]), { buffer: lumaBuf }, { buffer: gridBuf }])),
    };
    tracks.length = 0;
    detGen++;
  }

  // --- tracker state ---------------------------------------------------------------------------
  const labels = new Int32Array(GRID_MAX_W * GRID_MAX_H);
  const members = new Int32Array(GRID_MAX_W * GRID_MAX_H);
  const tracks: Track[] = [];
  let nextTrackId = 1;
  let detGen = 0;

  function ingest(data: Uint32Array, gw: number, gh: number, cell: number) {
    const k = cell / pxPerCss; // css px per grid cell
    // loud parts lower the threshold and allow more boxes: the tracker gets busier with the music
    const thr = THRESHOLD * (1.15 - 0.35 * Math.min(1, Math.max(0, eFast) * 3));
    const dets = findBlobs(data, gw, gh, Math.max(3, Math.round((cssH * 0.24) / k)), thr, 7 + Math.round(3 * drop), labels, members).map(d => ({
      x0: d.x0 * k, y0: d.y0 * k, x1: d.x1 * k, y1: d.y1 * k, cx: d.cx * k, cy: d.cy * k, score: d.score,
    }));
    const used = new Set<Track>();
    const reach = Math.min(cssW, cssH) * 0.12;
    for (const d of dets) {
      let best: Track | null = null, bestD = Infinity;
      for (const t of tracks) {
        if (used.has(t)) continue;
        const dist = Math.hypot((t.t.cx) - d.cx, (t.t.cy) - d.cy);
        if (dist < bestD && dist < reach + (d.x1 - d.x0) * 0.5) { best = t; bestD = dist; }
      }
      if (best) {
        best.t = d; best.age++; best.miss = 0; used.add(best);
      } else if (tracks.length < 22) {
        const t: Track = { id: nextTrackId++, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, t: d, age: 1, miss: 0, scramble: 0 };
        tracks.push(t);
        used.add(t);
      }
    }
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (used.has(t)) continue;
      if (++t.miss > 4) tracks.splice(i, 1);
    }
  }

  function requestDetection(encoder: GPUCommandEncoder, cur: number): (() => void) | null {
    const rb = readbacks.find(r => !r.busy);
    if (!rb) return null;
    const pass = encoder.beginComputePass();
    pass.setPipeline(detectPipe);
    pass.setBindGroup(0, bg.detect[cur]);
    pass.dispatchWorkgroups(Math.ceil(gridW / 8), Math.ceil(gridH / 8));
    pass.end();
    const bytes = gridW * gridH * 4;
    encoder.copyBufferToBuffer(lumaBuf, 0, rb.buf, 0, bytes);
    rb.busy = true;
    const gw = gridW, gh = gridH, cell = cellPx, gen = detGen;
    return () => {
      rb.buf.mapAsync(MAP_READ, 0, bytes).then(() => {
        if (disposed) return;
        if (gen === detGen) ingest(new Uint32Array(rb.buf.getMappedRange(0, bytes)), gw, gh, cell);
        rb.buf.unmap();
        rb.busy = false;
      }, () => { rb.busy = false; });
    };
  }

  // --- animation state -------------------------------------------------------------------------
  let metaWords = wordsFrom(initialMeta);
  let wordIdx = 0;
  let phase = 0, local = 0, sceneTime = 0;
  let pulse = 0, glitch = 0, flash = 0, kickS = 0, snareS = 0, hatS = 0, bassS = 0, midS = 0, trebleS = 0;
  const bandsS = new Array<number>(8).fill(0);
  let punch = 0, rollSign = 1, rollTarget = 0, rollKick = 0; // zoom punch, snare roll
  let eFast = -1, eSlow = 0, eWarm = 0, drop = 0, buildUp = 0; // energy against its slow baseline
  let invert = 0, wash = 0, barsInScene = 0, scrambleBurst = 0, focal = 1.8;
  const bars = new Float32Array(32), peaks = new Float32Array(32);
  const barLo = new Float32Array(32), barHi = new Float32Array(32).fill(0.3);
  let palFrom = PALETTES[0], palTo = PALETTES[0], palMix = 1;
  const lockedPal = PALETTES.find(p => p.name === new URLSearchParams(window.location.search).get('palette')) ?? null;
  let sceneIdx = 0, beatsInScene = 0, seed = Math.random();
  let counter = 6141;
  let cur = 0;
  let order = shuffle([...SCENES.keys()]);
  let orderPos = 0;

  function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const digitsText = () => String(counter % 10000).padStart(4, '0');

  const palette = () => (palMix >= 1 ? palTo : mixPalette(palFrom, palTo, palMix));
  function setPalette(p: Palette, fade: boolean) {
    palFrom = fade ? palette() : p;
    palTo = p;
    palMix = fade ? 0 : 1;
  }

  function nextWord(): string {
    const w = metaWords[wordIdx % metaWords.length];
    wordIdx++;
    return w;
  }

  function enterScene(idx: number) {
    sceneIdx = idx;
    beatsInScene = 0;
    local = 0;
    sceneTime = 0;
    barsInScene = 0;
    seed = Math.random();
    const name = SCENES[idx].name;
    setPalette(lockedPal ?? (name === 'blue' ? PALETTES[0] : pickPalette(palTo.name, name === 'equalizer')), false);
    if (name === 'count') renderRow(ROW_DIGITS, digitsText(), true);
    if (name === 'ticker') {
      const t = metaWords === FALLBACK_WORDS
        ? TICKER_FALLBACK[Math.floor(Math.random() * TICKER_FALLBACK.length)]
        : metaWords.slice(0, 4).join(' ');
      renderRow(ROW_MAIN, t);
    } else {
      renderRow(ROW_MAIN, nextWord());
    }
    const second = nextWord();
    renderRow(ROW_SECOND, name === 'blue' ? second.charAt(0).toUpperCase() : second);
  }

  function cut() {
    orderPos++;
    if (orderPos >= order.length) {
      const last = order[order.length - 1];
      order = shuffle([...SCENES.keys()]);
      if (order[0] === last) order.push(order.shift()!);
      orderPos = 0;
    }
    enterScene(order[orderPos]);
    flash = 0.6;
  }

  // `?scene=<name>` / `?palette=<name>` hold one scene / one palette (tuning, preview capture).
  const params = new URLSearchParams(window.location.search);
  const locked = SCENES.findIndex(sc => sc.name === params.get('scene'));
  enterScene(locked >= 0 ? locked : order[0]);

  // --- per-frame uniforms ----------------------------------------------------------------------
  function writeUniforms(sc: SceneOut, pal: Palette, time: number, hue: number, dt: number) {
    const f = uniformData;
    const hr = (c: V3) => hueRotate(c, hue);
    f.fill(0);
    f.set([W, H, 1 / W, 1 / H], 0);
    f.set([time, pulse, kickS, snareS], 4);
    // Focus on the near third of the main plane: the near end reads, the far end goes soft.
    let focus = sc.focus;
    const main = sc.planes[0];
    if (main) {
      const b = basis(main.yaw, main.pitch, main.roll);
      const k = 0.35 * main.h * rowAspect(main.row);
      const dist = (sgn: number) => Math.hypot(main.pos[0] + sgn * b.u[0] * k, main.pos[1] + sgn * b.u[1] * k, main.pos[2] + sgn * b.u[2] * k);
      focus = Math.min(dist(-1), dist(1));
    }
    // the beat, or a kick the tracker did not fire on (soft music without a confident tempo)
    const hit = Math.min(1, Math.max(pulse, kickS * 0.6));
    focal = 1.8 * (1 + 0.12 * punch); // zoom punch: the whole frame dollies in on the beat
    f.set([focal, focus, sc.dof + 0.12 * buildUp, 1.05 * (0.85 + 0.55 * hit)], 8);
    f.set([...hr(pal.bg), 0], 12);
    f.set([...hr(pal.tint), 1], 16);
    // drops: longer trails that zoom outwards (a tunnel), more aberration
    const trail = Math.pow(sc.trail + (0.8 - sc.trail) * drop * 0.6, dt * 60);
    f.set([trail, sc.zoom - pulse * 0.004 - 0.005 * drop, 0.0016 + 0.006 * snareS + 0.003 * pulse + 0.004 * trebleS + 0.004 * drop, glitch], 20);
    const ledCell = Math.max(3, Math.min(10, Math.round(H / 220)));
    f.set([sc.drift[0], sc.drift[1], ledCell, flash], 24);
    // handheld camera: a slow wander, a kick nudge, a shake in drops
    const shx = 0.012 * Math.sin(time * 0.9) + 0.006 * Math.sin(time * 2.3) + 0.0025 * pulse * Math.sin(time * 37) + 0.008 * drop * Math.sin(time * 29);
    const shy = 0.01 * Math.sin(time * 0.7 + 1) + 0.006 * Math.cos(time * 1.9) + 0.008 * drop * Math.cos(time * 23);
    for (let i = 0; i < 2; i++) {
      const p = sc.planes[i];
      const o = 28 + i * 16;
      if (!p) continue;
      const b = basis(p.yaw, p.pitch, p.roll + rollKick);
      const z = p.pos[2];
      f.set([p.pos[0] + shx * -z, p.pos[1] + shy * -z, z, p.intensity], o);
      f.set([...b.u, p.h * rowAspect(p.row)], o + 4);
      f.set([...b.v, p.h], o + 8);
      f.set([0, (p.row * ROW_H) / ATLAS_H, rowWidth[p.row] / ATLAS_W, ROW_H / ATLAS_H], o + 12);
    }
    sc.blobs.slice(0, 8).forEach((b, i) => {
      const o = 60 + i * 12;
      f.set([b.x + shx * 1.8, b.y + shy * 1.8, b.sx, b.sy], o);
      f.set([...hr(b.color), b.intensity], o + 4);
      f.set([b.round, b.hard, b.rot ?? 0, 0], o + 8);
    });
    if (sc.ring) {
      const r = sc.ring;
      f.set([r.x + shx * 1.8, r.y + shy * 1.8, r.hx, r.hy], 156);
      f.set([...hr(r.color), r.intensity], 160);
      f.set([r.radius, r.thickness, 0, 0], 164);
    }
    const mirror = Math.min(1, Math.max(0, (drop - 0.5) * 2.5)); // drops fold the shapes
    f.set([...hr(pal.lo), pal.grade], 168);
    f.set([...hr(pal.hi), 0.55 * buildUp], 172);
    f.set([drop, mirror, invert, 0.4 * Math.min(1, hatS)], 176);
    const w = hr(pal.accent);
    f.set([w[0] * wash, w[1] * wash, w[2] * wash, buildUp], 180);
    f.set([0.75 + 0.35 * Math.min(1, bassS), 1 + 0.3 * Math.min(1, bassS), 0, 0], 184);
    if (sc.eq) {
      f.set([sc.eq.amount, sc.eq.y + shy * 1.8, sc.eq.h, sc.eq.hw], 188);
      f.set([...hr(pal.accent), 1.4], 192);
      f.set(bars, 196);
      f.set(peaks, 228);
    }
    device.queue.writeBuffer(uniformBuf, 0, f);
  }

  /** Screen position (css px) of a 3D point, or null behind the camera. */
  function project(p: V3): [number, number] | null {
    if (p[2] > -0.05) return null;
    const sx = (p[0] / -p[2]) * focal, sy = (p[1] / -p[2]) * focal;
    return [cssW / 2 + (sx * cssH) / 2, cssH / 2 - (sy * cssH) / 2];
  }

  function drawHud(sc: SceneOut, dt: number, hatHit: boolean) {
    const c = hud;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    c.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'butt';

    // Perspective guide lines along the main text plane.
    const main = sc.planes[0];
    if (main && (main.yaw !== 0 || main.roll !== 0)) {
      const b = basis(main.yaw, main.pitch, main.roll + rollKick);
      const hw = main.h * rowAspect(main.row) * 0.5;
      for (const [off, a] of [[-1.7, 0.2], [2.1, 0.13], [-4.2, 0.08]] as const) {
        const at = (k: number): V3 => [
          main.pos[0] + b.u[0] * k + b.v[0] * off * main.h,
          main.pos[1] + b.u[1] * k + b.v[1] * off * main.h,
          main.pos[2] + b.u[2] * k + b.v[2] * off * main.h,
        ];
        const p = project(at(-hw)), q = project(at(hw));
        if (!p || !q) continue;
        const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
        const ext = (cssW + cssH) * 2;
        c.strokeStyle = `rgba(255,0,0,${a})`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(p[0] - (dx / len) * ext, p[1] - (dy / len) * ext);
        c.lineTo(q[0] + (dx / len) * ext, q[1] + (dy / len) * ext);
        c.stroke();
      }
    }

    // Smooth the boxes toward their latest detections.
    const k = 1 - Math.exp(-dt * 16);
    for (const t of tracks) {
      t.x0 += (t.t.x0 - t.x0) * k; t.y0 += (t.t.y0 - t.y0) * k;
      t.x1 += (t.t.x1 - t.x1) * k; t.y1 += (t.t.y1 - t.y1) * k;
      t.scramble = Math.max(0, t.scramble - dt);
    }
    const live = tracks.filter(t => t.age >= 3);
    if (hatHit && live.length) live[Math.floor(Math.random() * live.length)].scramble = 0.09;
    for (; scrambleBurst > 0 && live.length; scrambleBurst--) live[Math.floor(Math.random() * live.length)].scramble = 0.14;

    // Link the boxes: nearest-neighbour chain from the leftmost, ends extended off-screen.
    if (live.length > 1) {
      const rest = [...live];
      rest.sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1));
      const chain = [rest.shift()!];
      while (rest.length) {
        const last = chain[chain.length - 1];
        const lx = (last.x0 + last.x1) / 2, ly = (last.y0 + last.y1) / 2;
        let bi = 0, bd = Infinity;
        rest.forEach((t, i) => {
          const d = Math.hypot((t.x0 + t.x1) / 2 - lx, (t.y0 + t.y1) / 2 - ly);
          if (d < bd) { bd = d; bi = i; }
        });
        chain.push(rest.splice(bi, 1)[0]);
      }
      const pts = chain.map(t => [(t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2] as [number, number]);
      const ext = (a: [number, number], b: [number, number]): [number, number] => {
        const dx = a[0] - b[0], dy = a[1] - b[1], len = Math.hypot(dx, dy) || 1, e = cssW + cssH;
        return [a[0] + (dx / len) * e, a[1] + (dy / len) * e];
      };
      c.strokeStyle = `rgba(255,0,0,${0.7 + 0.3 * pulse})`;
      c.lineWidth = 1.3;
      c.beginPath();
      const start = ext(pts[0], pts[1]);
      c.moveTo(start[0], start[1]);
      for (const p of pts) c.lineTo(p[0], p[1]);
      const end = ext(pts[pts.length - 1], pts[pts.length - 2]);
      c.lineTo(end[0], end[1]);
      c.stroke();
    }

    const fs = Math.round(Math.max(11, Math.min(20, cssH / 44)));
    c.font = `500 ${fs}px ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace`;
    c.textBaseline = 'bottom';
    const grow = 3 + Math.max(pulse, kickS * 0.6) * 7 + punch * 6;
    const labelBoxes: [number, number, number, number][] = [];
    for (const t of live) {
      const a = Math.min(1, t.age / 4) * (1 - t.miss / 5);
      const x = Math.round(t.x0 - grow), y = Math.round(t.y0 - grow);
      const w = Math.round(t.x1 - t.x0 + grow * 2), h = Math.round(t.y1 - t.y0 + grow * 2);
      c.globalAlpha = a;
      if (t.id % 3 !== 0) { // a third of the boxes are outlines only
        hatch.setTransform(new DOMMatrix().translateSelf(x, y));
        c.fillStyle = hatch;
        c.fillRect(x, y, w, h);
      }
      c.strokeStyle = '#f00';
      c.lineWidth = 1.3;
      c.strokeRect(x + 0.5, y + 0.5, w, h);
      const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
      const label = t.scramble > 0
        ? `x: ${Math.floor(Math.random() * 1900)} y: ${Math.floor(Math.random() * 1000)}`
        : `x: ${Math.round(cx)} y: ${Math.round(cy)}`;
      const lx = x - fs * 0.4, ly = y - 3, lw = c.measureText(label).width;
      if (labelBoxes.some(([ax, ay, aw]) => lx < ax + aw && ax < lx + lw && Math.abs(ay - ly) < fs)) continue;
      labelBoxes.push([lx, ly, lw, fs]);
      c.fillStyle = '#f00';
      c.fillText(label, lx, ly);
    }
    c.globalAlpha = 1;
    device.queue.copyExternalImageToTexture({ source: hudCanvas }, { texture: hudTex, premultipliedAlpha: true }, [hudCanvas.width, hudCanvas.height]);
  }

  function onDownbeat(st: number) {
    barsInScene++;
    // one accent per bar, alternating: an inverted frame, then a wash of the palette colour
    if (barsInScene % 2) invert = Math.max(invert, 0.75 * st);
    else wash = Math.max(wash, 0.3 * st);
    // every other bar the colours move on (the blue scene stays blue)
    if (barsInScene % 2 === 0 && !lockedPal && SCENES[sceneIdx].name !== 'blue') setPalette(pickPalette(palTo.name, SCENES[sceneIdx].name === 'equalizer'), true);
  }

  function readAudio(audio: AudioFrame, sens: number, dt: number) {
    const tau = (s: number) => Math.exp(-dt / s);
    const hit = beatHit(audio);
    if (hit) {
      const st = beatStrength(audio);
      pulse = Math.max(pulse, Math.min(1, st * sens));
      punch = Math.max(punch, Math.min(1, st * sens));
      counter++;
      if (SCENES[sceneIdx].name === 'count') renderRow(ROW_DIGITS, digitsText(), true);
      if (st >= STRONG_BEAT) {
        beatsInScene++;
        scrambleBurst = 2;
        if (audio.beat.isBeat && audio.beat.barBeat === 0) onDownbeat(st);
        // halfway through a long scene the word changes (one row upload, at most once a scene)
        if (beatsInScene === 8 && SCENES[sceneIdx].beats >= 16) renderRow(ROW_MAIN, nextWord());
      }
    }
    pulse *= tau(0.17);
    punch *= tau(0.12);
    const sm = (prev: number, v: number, s: number) => prev + (Math.min(1.5, v * sens) - prev) * (1 - tau(s));
    kickS = sm(kickS, audio.onsets.kick.envelope, 0.05);
    snareS = sm(snareS, audio.onsets.snare.envelope, 0.05);
    hatS = sm(hatS, audio.onsets.hat.envelope, 0.04);
    bassS = sm(bassS, audio.bands.bass, 0.12);
    midS = sm(midS, audio.bands.mid, 0.15);
    trebleS = sm(trebleS, audio.bands.treble, 0.1);
    const bd = audio.bands;
    [bd.sub, bd.bass, bd.lowMid, bd.mid, bd.highMid, bd.treble, audio.onsets.kick.envelope, audio.onsets.snare.envelope]
      .forEach((v, i) => { bandsS[i] = sm(bandsS[i], v, 0.08); });
    // snare: the frame rolls a little, alternating sides
    if (audio.onsets.snare.hit) {
      rollSign = -rollSign;
      rollTarget = rollSign * 0.06 * Math.min(1, audio.onsets.snare.strength * sens);
    }
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
    // no drops until the baseline has heard a few seconds of the track
    const dropT = eSlow > 0.01 ? Math.min(1, Math.max(0, (eFast / eSlow - 1.1) * 3)) * Math.min(1, Math.max(0, (eWarm - 3) / 3)) : 0;
    drop += (dropT - drop) * (1 - tau(dropT > drop ? 0.15 : 0.8));
    const buildT = !audio.silent && audio.beat.confidence >= 0.3 && audio.beat.strength < 0.35 && eFast > eSlow * 1.05 ? 1 : 0;
    buildUp += (buildT - buildUp) * (1 - tau(1));
    // the glitch is for driving music: it needs a confident beat
    if (audio.onsets.snare.hit && audio.beat.confidence >= 0.3 && audio.onsets.snare.strength * sens > 0.65 - 0.25 * drop) glitch = 1;
    glitch *= tau(0.07);
    flash *= tau(0.1);
    invert *= tau(0.08);
    wash *= tau(0.12);
    palMix = Math.min(1, palMix + dt / 0.6);
    return hit;
  }

  /**
   * 32 log-spaced spectrum bars (fast attack, eased fall) with slowly falling peak caps. Each bar
   * has its own range (a floor that follows the quiet, a ceiling that follows the loud), so a loud
   * track shows its hits instead of pinning every bar at the top.
   */
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
      peaks[i] = Math.max(bars[i], peaks[i] - dt * 0.45);
    }
  }

  return {
    resize(w, h, dpr) {
      if (lost) { lost.resize?.(w, h, dpr); return; }
      build(w, h, dpr);
    },

    metadata(m) {
      metaWords = wordsFrom(m);
      wordIdx = 0;
    },

    frame({ audio, settings, dt, time }) {
      if (disposed) return;
      if (lost) return;
      const sens = settings.sensitivity;
      readAudio(audio, sens, dt);
      const hatHit = audio.onsets.hat.hit;
      const energy = audio.silent ? 0 : Math.min(1, audio.level.rms * sens * 2);
      const rate = settings.speed * (0.35 + energy);
      phase += dt * rate;
      local += dt * rate;
      sceneTime += dt;

      const s = SCENES[sceneIdx];
      if (locked < 0 && (beatsInScene >= s.beats || sceneTime > 16 / Math.max(0.3, settings.speed))) cut();

      const pal = palette();
      const sc = SCENES[sceneIdx].build({
        phase, local, pulse, kick: kickS, snare: snareS, hat: hatS, bass: bassS, mid: midS, treble: trebleS,
        seed, ax: Math.min(1, cssW / cssH / 1.78), scale: settings.scale, bands: bandsS, pal, aspect: rowAspect,
      });
      if (sc.eq) readSpectrum(audio, sens, dt);
      writeUniforms(sc, pal, time, settings.hueShift, dt);
      drawHud(sc, dt, hatHit);

      const encoder = device.createCommandEncoder();
      const pass = (target: GPUTexture | GPUTextureView, p: GPURenderPipeline, g: GPUBindGroup) => {
        const rp = encoder.beginRenderPass({
          colorAttachments: [{ view: 'createView' in target ? target.createView() : target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        });
        rp.setPipeline(p);
        rp.setBindGroup(0, g);
        rp.draw(3);
        rp.end();
      };
      const next = 1 - cur;
      if (atlasDirty) { buildMips(encoder); atlasDirty = false; }
      pass(sceneTex, scenePipe, bg.scene);
      pass(accum[next], feedbackPipe, bg.feedback[next]);
      const afterSubmit = requestDetection(encoder, next);
      pass(b1a, down1Pipe, bg.down1[next]);
      pass(b1b, blurHPipe, bg.blurH1);
      pass(b1a, blurVPipe, bg.blurV1);
      pass(b2a, downPipe, bg.down2);
      pass(b2b, blurHPipe, bg.blurH2);
      pass(b2a, blurVPipe, bg.blurV2);
      pass(context.getCurrentTexture().createView(), finalPipe, bg.final[next]);
      device.queue.submit([encoder.finish()]);
      afterSubmit?.();
      cur = next;
    },

    dispose() {
      disposed = true;
      lost?.dispose();
      for (const t of targets) t.destroy();
      atlasTex.destroy();
      uniformBuf.destroy();
      gridBuf.destroy();
      lumaBuf.destroy();
      for (const r of readbacks) r.buf.destroy();
      context.unconfigure();
      device.destroy();
      canvas.remove();
    },
  };
};

export default BlobTracker;
