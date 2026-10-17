/**
 * Pulsar: a black-and-white space montage cut to the beat (raw WebGPU + WGSL, no library).
 *
 * Eight photographic shots, all procedural: a pulsar with its thin twin beams, its magnetosphere
 * (beaded dipole loops in 3D, cones of light along the axis), a sunrise over a planet's limb, a
 * ring eclipse with a jet, an eclipse with plasma filaments, a distant pulsar sweeping a wide
 * beam through a star field, a beam crossing curtains of gas, and a cellular star in front of the
 * Milky Way. The camera pushes in on every shot. In calm passages a shot is held long; with a
 * groove the edit cuts on the bar; a drop flashes white and the edit speeds up like a music
 * video: a new shot every other beat.
 *
 * Passes per frame: scene (HDR light, slightly reduced resolution: it is soft anyway) → bloom
 * (two levels) → anamorphic streaks (wide horizontal blurs) → final (filmic tone, contrast,
 * vignette, gradient map, white flash, grain) at full resolution.
 */
import type { AudioFrame } from '../../audio/types';
import { avg, beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { BUF, compileShader, noWebGPUReason, TEX, webgpuFallback as fallback } from '../lib/webgpu';
import type { VisualizerFactory, VisualizerInstance } from '../runtime/types';

// ---------------------------------------------------------------------------------------------
// WGSL

const PRELUDE = /* wgsl */ `
struct U {
  res: vec4f,   // render w, h, aspect, world units per render px
  fres: vec4f,  // scene w, h, world units per scene px, -
  a: vec4f,     // time, shot time, kick, snare
  b: vec4f,     // hat, bass, mid, treble
  cam: vec4f,   // world point at the frame centre (x, y), zoom, roll
  sc: vec4f,    // shot id, seed, energy, pulse
  fx: vec4f,    // exposure, bloom gain, streak gain, grain
  fx2: vec4f,   // -, white flash, vignette, mirror (-1/1)
  ramp: array<vec4f, 6>, // gradient map stops: rgb, position
  sp: array<vec4f, 8>,   // shot parameters
  spec: array<vec4f, 8>, // 32 spectrum bars 0..1
};
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}

const PI = 3.14159265;

fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn h11(x: f32) -> f32 { return fract(sin(x * 91.3458) * 47453.5453); }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
`;

const SCENE_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;

// World coordinates: y up, the frame is 2 units high; the camera pushes in, drifts and rolls.
fn world(uv: vec2f) -> vec2f {
  let s = vec2f((uv.x - 0.5) * 2.0 * u.res.z * u.fx2.w, (0.5 - uv.y) * 2.0);
  return rot2(u.cam.w) * s / u.cam.z + u.cam.xy;
}
fn fpx() -> f32 { return u.fres.z / u.cam.z; }

fn h22(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), w.x),
             mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var q = p;
  for (var i = 0; i < 5; i++) { v += a * vnoise(q); q = rot2(0.6) * q * 2.03 + vec2f(1.7, 9.2); a *= 0.5; }
  return v;
}
// sharp creases: filaments of gas
fn ridged(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.55; var q = p;
  for (var i = 0; i < 5; i++) { let n = 1.0 - abs(2.0 * vnoise(q) - 1.0); v += a * n * n; q = rot2(0.7) * q * 2.1 + vec2f(3.1, 1.7); a *= 0.5; }
  return v;
}
fn voronoi(p: vec2f) -> vec2f {
  let i = floor(p); let f = fract(p);
  var d1 = 8.0; var d2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let d = length(g + h22(i + g) - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2f(d1, d2);
}
fn specBar(i: i32) -> f32 { let k = clamp(i, 0, 31); return u.spec[k / 4][k % 4]; }
fn disc(r: f32, R: f32, px: f32) -> f32 { return smoothstep(R + px, R - px, r); }

// Point stars: soft dots (they are photographed, not drawn), twinkling faster on hi-hats.
fn starLayer(p: vec2f, cell: f32, dens: f32, seed: f32) -> f32 {
  let g = p / cell;
  let id = floor(g) + seed;
  let h = hash21(id);
  let pos = h22(id + 3.1) * 0.8 + 0.1;
  let d = length(fract(g) - pos) * cell / fpx();
  let tw = 0.75 + 0.25 * sin(u.a.x * (0.8 + 3.0 * h) * (1.0 + 1.5 * u.b.x) + h * 50.0);
  let b = pow(hash21(id + 1.3), 2.5);
  return step(1.0 - dens, h) * b * tw * (exp(-d * d / 0.9) + 0.15 * exp(-d / 2.5) * b);
}
fn starfield(p: vec2f, dens: f32) -> f32 {
  return 1.6 * starLayer(p, 0.11, min(0.9, dens * 0.18), 0.0)
       + 0.8 * starLayer(p, 0.05, min(0.9, dens * 0.22), 7.0)
       + 0.45 * starLayer(p, 0.024, min(0.9, dens * 0.26), 13.0);
}

// A beam of light from c along d: (thin core, soft sheath, distance along); it widens with the distance.
fn beam(p: vec2f, c: vec2f, d: vec2f, w0: f32, grow: f32) -> vec3f {
  let q = p - c;
  let along = dot(q, d);
  let perp = abs(q.x * d.y - q.y * d.x);
  let w = w0 + grow * abs(along) + fpx() * 0.6;
  return vec3f(exp(-perp * perp / (w * w)), exp(-perp / (w * 6.0 + 0.01)), along);
}

// 0 pulsar: the white star, two thin beams through it, a soft halo, faint stars.
fn shotPulsar(p: vec2f) -> f32 {
  let P = u.sp[0]; // beam angle, star radius, beam intensity, glow
  let R = P.y;
  let r = length(p);
  let px = fpx();
  var L = 0.05 + 0.07 * fbm(p * 1.1 + vec2f(u.a.x * 0.01, 4.0)) + starfield(p, 0.7);
  let x = max(r - R, 0.0);
  L += P.w * (1.1 * exp(-x / (R * 0.16)) + 0.3 * exp(-x / (R * 0.9)) + 0.13 * exp(-r / (R * 5.0)));
  let b = beam(p, vec2f(0.0), vec2f(cos(P.x), sin(P.x)), 0.0022, 0.0028);
  let s = abs(b.z);
  let shimmer = 0.85 + 0.3 * vnoise(vec2f(b.z * 9.0 - u.a.y * 6.0, 3.0));
  L += P.z * (2.2 * b.x + 0.16 * b.y) * shimmer / (1.0 + 0.2 * s) * smoothstep(R * 0.5, R * 1.2, s);
  return mix(L, 3.2 + 0.6 * (1.0 - r / R), disc(r, R, px * 1.3));
}

// 1 magnetosphere: dipole loops in planes through the magnetic axis (beaded, like the field
// lines of a simulation), cones of light streaming out along the axis, the star in the middle.
fn shotMagneto(p: vec2f) -> f32 {
  let M = u.sp[0].xyz;
  let R = u.sp[0].w;
  let E1 = u.sp[1].xyz;
  let E2 = u.sp[2].xyz;
  let r = length(p);
  let px = fpx();
  var L = 0.02 + 0.04 * fbm(p * 1.4 + 2.0) + 0.8 * starfield(p, 0.4);
  let A = M.xy;
  let al = max(length(A), 1e-3);
  let d = A / al;
  let along = dot(p, d);
  let perp = abs(p.x * d.y - p.y * d.x);
  let s = abs(along);
  let streaks = 0.68 + 0.32 * vnoise(vec2f(atan2(perp, s) * 70.0, sign(along) * 9.0 + u.a.x * 0.15));
  L += u.sp[2].w * exp(-pow(perp / max(s * 0.42, 1e-3), 2.0)) * smoothstep(R, R * 4.0, s) * 0.9 / (1.0 + 0.5 * s) * streaks * (0.3 + 0.7 * al);
  for (var i = 0; i < 6; i++) {
    let phi = f32(i) * PI / 6.0 + u.sp[3].x;
    let e = cos(phi) * E1 + sin(phi) * E2;
    let E = e.xy;
    let det0 = A.x * E.y - A.y * E.x;
    let det = select(det0, 1e-3, abs(det0) < 1e-3);
    let x = (p.x * E.y - p.y * E.x) / det;
    let y = (A.x * p.y - A.y * p.x) / det;
    let rr = max(length(vec2f(x, y)), 1e-4);
    let s2 = y * y / (rr * rr);
    let th = atan2(y, x);
    let behind = select(1.0, 1.0 - disc(r, R, px), x * M.z + y * e.z < 0.0);
    let edgeOn = smoothstep(0.04, 0.16, abs(det0));
    for (var j = 0; j < 2; j++) {
      let k = i * 2 + j;
      let Lj = R * (3.2 + 4.2 * f32(j) + 2.6 * h11(f32(k) * 3.7 + u.sc.y * 11.0));
      let f = rr - Lj * s2;
      let dd = abs(f) / max(fwidth(f), 1e-6);
      let bead = 0.35 + 0.9 * smoothstep(0.3, 0.9, vnoise(vec2f(th * 30.0 + u.a.y * 2.5 * select(-1.0, 1.0, j == 0), f32(k) * 5.0)));
      let line = exp(-dd * dd / 1.6) + 0.22 * exp(-dd / 5.0);
      L += u.sp[1].w * line * bead * behind * edgeOn * (0.45 + 0.9 * specBar(k * 2 + 2));
    }
  }
  return mix(L, 2.2 + 0.4 * (1.0 - r / R), disc(r, R, px * 1.3));
}

// 2 limb: a sunrise over a dark planet: the star just behind the limb with rays and a plume,
// the thin bright atmosphere, a faintly lit surface.
fn shotLimb(p: vec2f) -> f32 {
  let C = u.sp[0].xy; let Rp = u.sp[0].z; let sa = u.sp[0].w;
  let flare = u.sp[1].x; let rays = u.sp[1].y;
  let px = fpx();
  let q = p - C;
  let r = length(q);
  let n = vec2f(cos(sa), sin(sa));
  let S = C + n * (Rp + 0.015);
  let bg = 0.04 + 0.14 * fbm(p * 0.8 + 3.0) * smoothstep(-1.2, 1.0, p.y) + 0.6 * starfield(p, 0.3);
  let ds = p - S;
  let rs = length(ds);
  var sun = flare * (3.5 * exp(-rs / 0.05) + 0.9 * exp(-rs / 0.22) + 0.3 * exp(-rs / 0.8));
  let ra = atan2(ds.y, ds.x);
  var spikes = 0.0;
  for (var k = 0; k < 3; k++) {
    spikes += pow(abs(cos(ra * f32(3 + k * 2) + f32(k) * 1.3 + u.sp[1].z)), 50.0 + 40.0 * f32(k));
  }
  sun += rays * spikes * 0.4 / (1.0 + rs * 9.0);
  let pa = dot(ds, n);
  let pt = dot(ds, vec2f(-n.y, n.x));
  let plume = exp(-pow(pt / (0.05 + 0.3 * max(pa, 0.0)), 2.0)) * exp(-max(pa, 0.0) / 0.8) * smoothstep(-0.05, 0.05, pa)
            * (0.7 + 0.6 * fbm(vec2f(pt * 5.0, pa * 2.5 - u.a.x * 0.25)));
  let near = exp(-pow(acos(clamp(dot(q / max(r, 1e-4), n), -1.0, 1.0)), 2.0) / 0.3);
  let rimW = 0.005 + 0.012 * near;
  let rim = exp(-pow((r - Rp) / rimW, 2.0)) * (1.0 + 3.0 * near)
          + exp(-max(r - Rp, 0.0) / 0.05) * step(Rp, r) * (0.2 + 0.9 * near);
  let surf = 0.03 + 0.2 * fbm(q * 2.6 + 7.0) * (0.3 + 0.7 * exp(-(Rp - r) / 0.5)) * (0.5 + near) + 0.6 * near * exp(-(Rp - r) / 0.05);
  return mix(bg + sun + flare * plume * 1.4, surf, disc(r, Rp, px)) + rim;
}

// 3 ring: a dark hazy disc with a bright rim, a flare inside its lower edge and a jet leaving it,
// horizontal streaks of light behind.
fn shotRing(p: vec2f) -> f32 {
  let C = u.sp[0].xy; let R = u.sp[0].z; let ja = u.sp[0].w;
  let fl = u.sp[1].x;
  let px = fpx();
  let q = p - C;
  let r = length(q);
  var L = 0.1 + 0.2 * fbm(p * 1.1 + vec2f(u.a.x * 0.02, 5.0));
  for (var k = 0; k < 5; k++) {
    let hk = h11(f32(k) * 7.3 + u.sc.y * 3.0);
    let yk = C.y - R * 0.35 + (hk - 0.5) * 1.1;
    L += 0.3 * exp(-pow((p.y - yk) / (0.012 + 0.04 * hk), 2.0)) * (0.3 + fbm(vec2f(p.x * 1.4, f32(k) * 4.0))) * exp(-abs(p.x - C.x) / 1.6);
  }
  let F = C + vec2f(0.15 * R, -0.45 * R);
  let df = p - F;
  let inner = 0.08 + 0.35 * exp(-length(df) / (0.5 * R)) + 0.12 * fbm(q * 3.0);
  L = mix(L, inner, disc(r, R, px) * 0.85);
  let bottom = smoothstep(0.3, -0.9, q.y / max(r, 1e-4));
  L += exp(-pow((r - R) / 0.009, 2.0)) * (1.6 + 1.6 * bottom) + exp(-abs(r - R) / 0.06) * 0.35;
  L += fl * (4.0 * exp(-length(df) / 0.035) + 1.6 * exp(-pow(df.x / 0.5, 2.0) - pow(df.y / 0.022, 2.0)) + 0.6 * exp(-length(df) / 0.25));
  let b = beam(p, F, vec2f(cos(ja), sin(ja)), 0.02, 0.07);
  L += fl * (1.5 * b.x + 0.2 * b.y) * smoothstep(0.0, 0.08, b.z) / (1.0 + 0.4 * max(b.z, 0.0));
  return L;
}

// 4 eclipse: a black disc against a flare on its limb, plasma filaments swept around it.
fn shotEclipse(p: vec2f) -> f32 {
  let C = u.sp[0].xy; let R = u.sp[0].z; let fa = u.sp[0].w;
  let fl = u.sp[1].x; let fil = u.sp[1].y;
  let px = fpx();
  let q = p - C;
  let r = length(q);
  let F = C + vec2f(cos(fa), sin(fa)) * R * 0.97;
  let df = p - F;
  let dfl = length(df);
  let t = u.a.x;
  let w = p + 0.3 * vec2f(fbm(p * 1.2 + vec2f(t * 0.04, 0.0)), fbm(p * 1.2 + vec2f(4.0, -t * 0.03)));
  let filaments = pow(ridged(w * vec2f(1.4, 2.2) + vec2f(t * 0.05, 0.0)), 3.0) * 1.6;
  var L = 0.04 + 0.1 * fbm(p * 0.7) + filaments * fil * (0.07 + 1.5 * exp(-dfl / 0.7));
  let x = max(r - R, 0.0);
  L += step(R, r) * (0.9 * exp(-x / 0.05) + 0.3 * exp(-x / 0.35)) * (0.7 + 0.6 * fbm(vec2f(atan2(q.y, q.x) * 4.0, x * 3.0 - t * 0.1)));
  let inside = 0.025 + 0.06 * fbm(q * 4.0) * smoothstep(R, R * 0.4, r);
  L = mix(L, inside, disc(r, R, px));
  L += exp(-pow((r - R) / 0.007, 2.0)) * 1.2;
  // a prominence: a bright thread from the flare across the disc
  let pd = vec2f(-cos(fa + 0.12), -sin(fa + 0.12));
  let b = beam(p, F, pd, 0.004, 0.006);
  L += fl * 1.4 * b.x * step(0.0, b.z) * exp(-max(b.z, 0.0) / (R * 0.9)) * (0.6 + 0.6 * vnoise(vec2f(b.z * 18.0, t)));
  L += fl * (6.0 * exp(-dfl / 0.045) + 1.2 * exp(-dfl / 0.22) + 1.3 * exp(-pow(df.x / 0.9, 2.0) - pow(df.y / 0.02, 2.0)));
  return L;
}

// 5 wide: a distant pulsar, a broad mottled beam sweeping a dense field of stars.
fn shotWide(p: vec2f) -> f32 {
  let C = u.sp[0].xy; let ang = u.sp[0].z; let R = u.sp[0].w;
  let bi = u.sp[1].x;
  let px = fpx();
  let clusters = smoothstep(0.45, 0.75, fbm(p * 1.3 + 9.0));
  var L = 0.025 + 0.08 * fbm(p * 0.9 + 1.0) + 1.1 * starfield(p, 0.8 + 2.5 * clusters);
  let d = vec2f(cos(ang), sin(ang));
  let b = beam(p, C, d, 0.05, 0.09);
  let mott = 0.6 + 0.6 * fbm(vec2f(b.z * 2.5 - u.a.x * 0.4, dot(p - C, vec2f(-d.y, d.x)) * 9.0));
  let end = 1.0 + 3.0 * smoothstep(0.4, 2.2, -b.z);
  L += bi * (0.42 * b.x * mott * end + 0.12 * b.y);
  let core = beam(p, C, d, 0.004, 0.006);
  L += bi * 0.5 * core.x / (1.0 + abs(core.z));
  let r = length(p - C);
  L += 0.6 * exp(-max(r - R, 0.0) / 0.015) + 0.2 * exp(-r / 0.15);
  return mix(L, 2.6, disc(r, R, px));
}

// 6 wings: a beam and its star crossing curtains of gas that rise in a V.
fn shotWings(p: vec2f) -> f32 {
  let C = u.sp[0].xy; let ang = u.sp[0].z; let bi = u.sp[0].w;
  let W = u.sp[1].xy; let gas = u.sp[1].z;
  let t = u.a.x;
  var L = 0.025 + 0.06 * fbm(p * 1.2) + 0.5 * starfield(p, 0.3);
  let h = p.y - W.y;
  var m = 0.0;
  for (var k = 0; k < 2; k++) {
    let sg = f32(k) * 2.0 - 1.0;
    let cx = W.x + sg * (0.12 + 0.55 * max(h, 0.0)) + 0.08 * sin(h * 3.0 + f32(k) * 2.0);
    m += exp(-pow((p.x - cx) / (0.1 + 0.22 * max(h, 0.0)), 2.0)) * smoothstep(-0.35, 0.05, h);
  }
  let w = p + 0.2 * vec2f(fbm(p * 1.5 + vec2f(0.0, t * 0.05)), fbm(p * 1.5 + 6.0));
  let fils = pow(ridged(w * vec2f(4.0, 1.3) + vec2f(0.0, -t * 0.06)), 3.0);
  L += gas * m * (0.1 + 1.6 * fils);
  let d = vec2f(cos(ang), sin(ang));
  let b = beam(p, C, d, 0.003, 0.004);
  L += bi * (1.8 * b.x + 0.25 * b.y) * (1.0 + 0.8 * smoothstep(0.0, 1.5, b.z));
  let r = length(p - C);
  return L + bi * (3.0 * exp(-r / 0.012) + 0.6 * exp(-r / 0.08));
}

// 7 cell star: an overexposed star with a cellular surface, the Milky Way behind it.
fn shotCell(p: vec2f) -> f32 {
  let S = u.sp[0].xy; let R = u.sp[0].z; let ba = u.sp[0].w;
  let O = u.sp[1].xy; let glow = u.sp[1].z;
  let px = fpx();
  let bd = vec2f(cos(ba), sin(ba));
  let dist = abs((p.x - O.x) * bd.y - (p.y - O.y) * bd.x);
  let band = exp(-pow(dist / 0.42, 2.0));
  let clouds = fbm(p * 2.2 + 11.0);
  let dust = fbm(p * 4.5 + vec2f(3.0, 1.0));
  var L = 0.02 + band * (0.06 + 0.75 * clouds * clouds) * (1.0 - 0.85 * smoothstep(0.48, 0.7, dust));
  L += 1.1 * starfield(p, 0.5 + 3.5 * band);
  let q = (p - S) / R;
  let r = length(q);
  let x = max(r - 1.0, 0.0) * R;
  L += glow * (0.9 * exp(-x / 0.03) + 0.25 * exp(-x / 0.25) + 0.08 * exp(-x / 1.0));
  let z = sqrt(max(1.0 - r * r, 0.0));
  let sc0 = q / (0.35 + z) * 3.2 + vec2f(u.a.x * 0.03, 0.0);
  let sc = sc0 + 0.18 * vec2f(vnoise(sc0 * 2.5), vnoise(sc0 * 2.5 + 5.0));
  let v = voronoi(sc);
  let edge = smoothstep(0.01, 0.2, v.y - v.x);
  let surf = glow * mix(0.3, 1.7, edge) * (0.8 + 0.35 * vnoise(sc * 3.0 + u.a.x * 0.2)) * (0.8 + 0.4 * (1.0 - z));
  return mix(L, surf, disc(r * R, R, px));
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let p = world(i.uv);
  var L = 0.0;
  switch (i32(u.sc.x)) {
    case 1: { L = shotMagneto(p); }
    case 2: { L = shotLimb(p); }
    case 3: { L = shotRing(p); }
    case 4: { L = shotEclipse(p); }
    case 5: { L = shotWide(p); }
    case 6: { L = shotWings(p); }
    case 7: { L = shotCell(p); }
    default: { L = shotPulsar(p); }
  }
  return vec4f(max(L, 0.0), 0.0, 0.0, 1.0);
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
@fragment fn fsDown1(i: VSOut) -> @location(0) vec4f { let c = box4(i.uv); return vec4f(c * smoothstep(0.8, 2.6, c), 0.0, 0.0, 1.0); }
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
// anamorphic lens streaks: very wide horizontal blurs of the brightest light
fn streak(uv: vec2f, spread: f32) -> vec4f {
  let px = vec2f(spread / f32(textureDimensions(src, 0).x), 0.0);
  var c = tap(uv);
  var ws = 1.0;
  for (var k = 1; k <= 7; k++) {
    let w = exp(-f32(k * k) / 16.0);
    c += (tap(uv + px * f32(k)) + tap(uv - px * f32(k))) * w;
    ws += 2.0 * w;
  }
  return vec4f(c / ws, 0.0, 0.0, 1.0);
}
@fragment fn fsStreak1(i: VSOut) -> @location(0) vec4f { return streak(i.uv, 3.0); }
@fragment fn fsStreak2(i: VSOut) -> @location(0) vec4f { return streak(i.uv, 11.0); }
`;

const FINAL_WGSL = PRELUDE + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var sceneT: texture_2d<f32>;
@group(0) @binding(3) var bloom1: texture_2d<f32>;
@group(0) @binding(4) var bloom2: texture_2d<f32>;
@group(0) @binding(5) var streakT: texture_2d<f32>;

fn ramp(v: f32) -> vec3f {
  var c = u.ramp[0].rgb;
  for (var k = 1; k < 6; k++) { c = mix(c, u.ramp[k].rgb, smoothstep(u.ramp[k - 1].w, u.ramp[k].w, v)); }
  return c;
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let sp = vec2f((i.uv.x - 0.5) * 2.0 * u.res.z, (0.5 - i.uv.y) * 2.0);
  let L = textureSampleLevel(sceneT, samp, i.uv, 0.0).r
        + u.fx.y * (textureSampleLevel(bloom1, samp, i.uv, 0.0).r * 0.55 + textureSampleLevel(bloom2, samp, i.uv, 0.0).r * 0.9)
        + u.fx.z * textureSampleLevel(streakT, samp, i.uv, 0.0).r;
  var v = 1.0 - exp(-max(L, 0.0) * u.fx.x);
  v = mix(v, v * v * (3.0 - 2.0 * v), 0.4);
  v *= 1.0 - u.fx2.z * smoothstep(0.5, 1.9, length(sp * vec2f(0.72, 1.0)));
  // film grain, a little coarser than a pixel, strongest in the mid tones
  let g = hash21(floor(i.uv * u.res.xy * 0.7) + fract(u.a.x * 7.13) * 917.0) - 0.5;
  v += g * u.fx.w * (0.4 + 1.8 * v * (1.0 - v));
  v += u.fx2.y;
  return vec4f(ramp(clamp(v, 0.0, 1.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Palettes: gradient maps from black to white. Mono is the reference look; a drop may tint it.

type V3 = [number, number, number];
interface Palette { name: string; stops: V3[]; weight: number }
const RAMP_POS = [0, 0.15, 0.35, 0.55, 0.78, 1];

const PALETTES: Palette[] = [
  { name: 'mono', weight: 4, stops: [[0, 0, 0], [0.13, 0.13, 0.135], [0.34, 0.34, 0.35], [0.56, 0.56, 0.57], [0.8, 0.8, 0.81], [1, 1, 1]] },
  { name: 'xray', weight: 1, stops: [[0, 0.005, 0.015], [0.04, 0.09, 0.2], [0.12, 0.3, 0.5], [0.36, 0.64, 0.86], [0.76, 0.91, 1], [1, 1, 1]] },
  { name: 'magnetar', weight: 1, stops: [[0.01, 0, 0.02], [0.15, 0.04, 0.24], [0.45, 0.13, 0.5], [0.86, 0.38, 0.6], [1, 0.78, 0.8], [1, 1, 1]] },
  { name: 'crab', weight: 1, stops: [[0.01, 0.005, 0], [0.17, 0.07, 0.03], [0.5, 0.2, 0.08], [0.9, 0.52, 0.2], [1, 0.86, 0.62], [1, 1, 1]] },
];

function pickPalette(not: string): Palette {
  const pool = PALETTES.filter(p => p.name !== not);
  let r = Math.random() * pool.reduce((s, p) => s + p.weight, 0);
  for (const p of pool) if ((r -= p.weight) <= 0) return p;
  return pool[0];
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const s = t * t * (3 - 2 * t);
  return { name: b.name, weight: b.weight, stops: a.stops.map((c, i) => c.map((v, j) => v + (b.stops[i][j] - v) * s) as V3) };
}

function hueRotate(c: V3, deg: number): V3 {
  if (!deg) return c;
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const k = 1 / 3, sq = Math.sqrt(1 / 3);
  const m0 = cs + (1 - cs) * k, m1 = k * (1 - cs) - sq * sn, m2 = k * (1 - cs) + sq * sn;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(c[0] * m0 + c[1] * m1 + c[2] * m2),
    clamp(c[0] * m2 + c[1] * m0 + c[2] * m1),
    clamp(c[0] * m1 + c[1] * m2 + c[2] * m0),
  ];
}

// ---------------------------------------------------------------------------------------------
// Shots. Each one lays itself out from a seeded random source when it is cut to, then writes
// its shader parameters (sp, 8 vec4) every frame.

interface ShotIn {
  t: number; spin: number; pulse: number; kick: number; snare: number; hat: number;
  bass: number; mid: number; treble: number; ax: number;
}
interface Shot {
  name: string;
  /** Fits a calm passage (held long). */
  calm: boolean;
  exposure: number;
  enter(r: () => number): void;
  /** Writes the shader parameters; returns the subject the camera pushes in on (world). */
  frame(i: ShotIn, sp: Float32Array): [number, number];
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

function pulsarShot(): Shot {
  let base = 0, spin0 = NaN;
  return {
    name: 'pulsar', calm: true, exposure: 1.25,
    enter(r) { base = Math.PI / 2 + range(r, 0.25, 0.5) * sgn(r); spin0 = NaN; },
    frame(i, sp) {
      if (Number.isNaN(spin0)) spin0 = i.spin;
      sp.set([base + 0.35 * (i.spin - spin0), 0.1 * (1 + 0.06 * i.kick), 1 + 0.6 * i.pulse + 0.4 * i.treble, 1 + 0.7 * i.pulse + 0.3 * i.bass], 0);
      return [0, 0];
    },
  };
}

function magnetoShot(): Shot {
  let alpha = 1, beta = 2;
  return {
    name: 'magneto', calm: true, exposure: 1.2,
    enter(r) { alpha = range(r, 1.05, 1.35); beta = Math.PI / 2 + range(r, 0.3, 0.6) * sgn(r); },
    frame(i, sp) {
      const b = beta + 0.04 * Math.sin(i.t * 0.4);
      const M = [Math.sin(alpha) * Math.cos(b), Math.sin(alpha) * Math.sin(b), Math.cos(alpha)];
      // a basis of the plane perpendicular to the axis
      const l1 = Math.hypot(M[0], M[1]) || 1;
      const e1 = [M[1] / l1, -M[0] / l1, 0];
      const e2 = [M[1] * e1[2] - M[2] * e1[1], M[2] * e1[0] - M[0] * e1[2], M[0] * e1[1] - M[1] * e1[0]];
      sp.set([...M, 0.095 * (1 + 0.05 * i.kick)], 0);
      sp.set([...e1, 0.75 + 0.5 * i.pulse + 0.3 * i.mid], 4);
      sp.set([...e2, 0.6 + 0.5 * i.bass + 0.4 * i.pulse], 8);
      sp.set([0.12 * i.spin], 12);
      return [0, 0];
    },
  };
}

function limbShot(): Shot {
  let cx = 0, sa = 0;
  return {
    name: 'limb', calm: true, exposure: 1.15,
    enter(r) { cx = range(r, 0.15, 0.4); sa = Math.PI / 2 + range(r, 0.2, 0.32); },
    frame(i, sp) {
      sp.set([cx, -0.88, 1.55, sa], 0);
      sp.set([1 + 0.8 * i.pulse + 0.3 * i.bass, 0.5 + 1.3 * i.treble + 0.6 * i.hat, 0.05 * i.t], 4);
      return [cx + 1.55 * Math.cos(sa), -0.88 + 1.55 * Math.sin(sa)];
    },
  };
}

function ringShot(): Shot {
  let cx = 0, ja = 0;
  return {
    name: 'ring', calm: false, exposure: 1.05,
    enter(r) { cx = -range(r, 0.15, 0.35); ja = -Math.PI / 2 + range(r, 0.25, 0.45); },
    frame(i, sp) {
      sp.set([cx, 0.22, 0.62, ja], 0);
      sp.set([1 + 0.9 * i.pulse + 0.3 * i.bass], 4);
      return [cx + 0.09, 0.22 - 0.28];
    },
  };
}

function eclipseShot(): Shot {
  let cx = 0, fa = 0;
  return {
    name: 'eclipse', calm: false, exposure: 1.1,
    enter(r) { cx = range(r, 0.25, 0.45); fa = Math.PI + range(r, -0.15, 0.15); },
    frame(i, sp) {
      sp.set([cx, 0.0, 0.55, fa], 0);
      sp.set([1 + 0.9 * i.pulse + 0.3 * i.bass, 0.7 + 0.8 * i.mid + 0.3 * i.snare], 4);
      return [cx + 0.53 * Math.cos(fa), 0.53 * Math.sin(fa)];
    },
  };
}

function wideShot(): Shot {
  let base = 0, spin0 = NaN;
  return {
    name: 'wide', calm: true, exposure: 1.3,
    enter(r) { base = range(r, -0.5, -0.2); spin0 = NaN; },
    frame(i, sp) {
      if (Number.isNaN(spin0)) spin0 = i.spin;
      sp.set([0, 0, base + 0.08 * (i.spin - spin0), 0.018], 0);
      sp.set([0.8 + 0.7 * i.pulse + 0.3 * i.bass], 4);
      return [0, 0];
    },
  };
}

function wingsShot(): Shot {
  let ang = 0, wx = 0;
  return {
    name: 'wings', calm: false, exposure: 1.2,
    enter(r) { ang = range(r, 0.2, 0.45); wx = range(r, 0.3, 0.55); },
    frame(i, sp) {
      sp.set([-0.45, -0.12, ang, 1 + 0.8 * i.pulse + 0.3 * i.treble], 0);
      sp.set([wx, -0.45, 0.8 + 0.6 * i.mid + 0.3 * i.pulse], 4);
      return [-0.45, -0.12];
    },
  };
}

function cellShot(): Shot {
  let ba = 0;
  return {
    name: 'cellstar', calm: false, exposure: 1.15,
    enter(r) { ba = range(r, 0.2, 0.45); },
    frame(i, sp) {
      sp.set([0.55 * i.ax - 0.15, -0.55, 0.62 * (1 + 0.03 * i.kick), ba], 0);
      sp.set([-0.3, 0.55, 1 + 0.6 * i.pulse + 0.3 * i.bass], 4);
      return [0.55 * i.ax - 0.15, -0.55];
    },
  };
}

// shader ids follow this order
const SHOTS: Shot[] = [pulsarShot(), magnetoShot(), limbShot(), ringShot(), eclipseShot(), wideShot(), wingsShot(), cellShot()];

// ---------------------------------------------------------------------------------------------

const UNIFORM_FLOATS = 120;
const MAX_RENDER_PIXELS = 2560 * 1440;
const SCENE_SCALE = 0.8, MAX_SCENE_PIXELS = 1920 * 1080;

const Pulsar: VisualizerFactory = async ({ container }) => {
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
  const [sceneMod, bloomMod, finalMod] = await Promise.all([
    compileShader(device, SCENE_WGSL, 'pulsar-scene'), compileShader(device, BLOOM_WGSL, 'pulsar-bloom'),
    compileShader(device, FINAL_WGSL, 'pulsar-final'),
  ]);
  const LIGHT: GPUTextureFormat = 'r16float';
  const pipe = (module: GPUShaderModule, entryPoint: string, fmt: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint, targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
  const [scenePipe, down1Pipe, downPipe, blurHPipe, blurVPipe, streak1Pipe, streak2Pipe, finalPipe] = await Promise.all([
    pipe(sceneMod, 'fs', LIGHT),
    pipe(bloomMod, 'fsDown1', LIGHT), pipe(bloomMod, 'fsDown', LIGHT),
    pipe(bloomMod, 'fsBlurH', LIGHT), pipe(bloomMod, 'fsBlurV', LIGHT),
    pipe(bloomMod, 'fsStreak1', LIGHT), pipe(bloomMod, 'fsStreak2', LIGHT),
    pipe(finalMod, 'fs', format),
  ]);
  const setupError = await device.popErrorScope();
  if (setupError) throw new Error(`Pulsar: ${setupError.message}`);

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const uniformData = new Float32Array(UNIFORM_FLOATS);
  const uniformBuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });

  // --- render targets --------------------------------------------------------------------------
  let W = 2, H = 2, FW = 2, FH = 2, aspect = 1;
  let targets: GPUTexture[] = [];
  let sceneTex!: GPUTexture, b1a!: GPUTexture, b1b!: GPUTexture, b2a!: GPUTexture, b2b!: GPUTexture, sa!: GPUTexture, sb!: GPUTexture;
  let bg!: {
    scene: GPUBindGroup; down1: GPUBindGroup; blurH1: GPUBindGroup; blurV1: GPUBindGroup;
    down2: GPUBindGroup; blurH2: GPUBindGroup; blurV2: GPUBindGroup; streak1: GPUBindGroup; streak2: GPUBindGroup;
    final: GPUBindGroup;
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
    let fs = SCENE_SCALE;
    if (W * H * fs * fs > MAX_SCENE_PIXELS) fs = Math.sqrt(MAX_SCENE_PIXELS / (W * H));
    FW = Math.max(2, Math.round(W * fs));
    FH = Math.max(2, Math.round(H * fs));

    for (const t of targets) t.destroy();
    targets = [];
    const tex = (tw: number, th: number) => {
      const t = device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: LIGHT, usage: TEX.RENDER_ATTACHMENT | TEX.TEXTURE_BINDING });
      targets.push(t);
      return t;
    };
    sceneTex = tex(FW, FH);
    b1a = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));
    b1b = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));
    b2a = tex(Math.ceil(FW / 16), Math.ceil(FH / 16));
    b2b = tex(Math.ceil(FW / 16), Math.ceil(FH / 16));
    sa = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));
    sb = tex(Math.ceil(FW / 4), Math.ceil(FH / 4));

    const group = (p: GPURenderPipeline, res: GPUBindingResource[]) => device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: res.map((resource, binding) => ({ binding, resource })),
    });
    const v = (t: GPUTexture) => t.createView();
    const U = { buffer: uniformBuf };
    bg = {
      scene: group(scenePipe, [U]),
      down1: group(down1Pipe, [sampler, v(sceneTex)]),
      blurH1: group(blurHPipe, [sampler, v(b1a)]),
      blurV1: group(blurVPipe, [sampler, v(b1b)]),
      down2: group(downPipe, [sampler, v(b1a)]),
      blurH2: group(blurHPipe, [sampler, v(b2a)]),
      blurV2: group(blurVPipe, [sampler, v(b2b)]),
      streak1: group(streak1Pipe, [sampler, v(b1a)]),
      streak2: group(streak2Pipe, [sampler, v(sa)]),
      final: group(finalPipe, [U, sampler, v(sceneTex), v(b1a), v(b2a), v(sb)]),
    };
  }

  // --- animation state -------------------------------------------------------------------------
  // `?shot=<name>` holds one shot, `?palette=<name>` one palette (tuning, preview capture).
  const params = new URLSearchParams(window.location.search);
  const lockedPal = PALETTES.find(p => p.name === params.get('palette')) ?? null;
  const locked = SHOTS.findIndex(s => s.name === params.get('shot'));

  let shotIdx = 0, shotTime = 0, seed = Math.random(), mirror = 1, beatsInShot = 0;
  let zoom0 = 1, push = 0.03, pushT = 0, driftX = 0, driftY = 0, roll = 0;
  let focus: [number, number] = [0, 0];
  let white = 0, stutter = 0;
  let drift = 0, stepTarget = 0, stepCur = 0;
  let pulse = 0, kickS = 0, snareS = 0, hatS = 0, bassS = 0, midS = 0, trebleS = 0, energyS = 0;
  let eFast = -1, eSlow = 0, eWarm = 0, drop = 0, dropArmed = true;
  let palFrom = lockedPal ?? PALETTES[0], palTo = palFrom, palMix = 1;
  const specBars = new Float32Array(32);
  const barLo = new Float32Array(32), barHi = new Float32Array(32).fill(0.3);

  const palette = () => (palMix >= 1 ? palTo : mixPalette(palFrom, palTo, palMix));

  function enterShot(idx: number) {
    shotIdx = idx;
    shotTime = 0;
    beatsInShot = 0;
    seed = Math.random();
    const r = mulberry32(Math.floor(seed * 2 ** 32));
    SHOTS[idx].enter(r);
    mirror = locked >= 0 ? 1 : sgn(r);
    zoom0 = range(r, 0.92, 1.08);
    push = range(r, 0.02, 0.05);
    pushT = 0;
    driftX = range(r, -0.012, 0.012);
    driftY = range(r, -0.008, 0.008);
    roll = range(r, -0.05, 0.05);
  }

  /** The next shot: never the same twice; calm passages get the calm ones. */
  function nextShot(calm: boolean): number {
    // the pulsar is the hero: it comes back more often
    if (shotIdx !== 0 && Math.random() < 0.25) return 0;
    const pool = SHOTS.map((_, i) => i).filter(i => i !== shotIdx && (!calm || SHOTS[i].calm));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function cut(calm: boolean) {
    enterShot(nextShot(calm));
  }

  /** A drop: a white flash, a new shot, then a few bars of fast cuts. */
  function dropCut() {
    white = 1;
    if (!lockedPal) {
      palFrom = palette();
      palTo = Math.random() < 0.35 ? pickPalette(palTo.name) : PALETTES[0];
      palMix = palTo === palFrom ? 1 : 0;
    }
    if (locked < 0) {
      stutter = 16;
      cut(false);
    }
  }

  enterShot(locked >= 0 ? locked : 0);

  // --- audio -----------------------------------------------------------------------------------
  function readAudio(audio: AudioFrame, sens: number, dt: number, speed: number) {
    const tau = (s: number) => Math.exp(-dt / s);
    const calm = audio.silent || audio.beat.confidence < 0.3 || energyS < 0.15;
    if (beatHit(audio)) {
      const st = Math.min(1, beatStrength(audio) * sens);
      pulse = Math.max(pulse, st);
      stepTarget += (Math.PI / 10) * st * Math.min(2, speed);
      if (beatStrength(audio) >= STRONG_BEAT && locked < 0) {
        beatsInShot++;
        if (stutter > 0) {
          // like the reference: a new shot every other beat
          stutter--;
          if (stutter % 2 === 0) cut(false);
        }
        else if (!calm && beatsInShot >= (energyS > 0.45 ? 8 : 16) && (audio.beat.barBeat === 0 || beatsInShot >= 20)) {
          cut(false); // on the bar
        }
      }
    }
    pulse *= tau(0.18);
    white *= tau(0.12);
    const sm = (prev: number, v: number, s: number) => prev + (Math.min(1.5, v * sens) - prev) * (1 - tau(s));
    kickS = sm(kickS, audio.onsets.kick.envelope, 0.05);
    snareS = sm(snareS, audio.onsets.snare.envelope, 0.05);
    hatS = sm(hatS, audio.onsets.hat.envelope, 0.04);
    bassS = sm(bassS, audio.bands.bass, 0.12);
    midS = sm(midS, audio.bands.mid, 0.15);
    trebleS = sm(trebleS, audio.bands.treble, 0.1);
    energyS += ((audio.silent ? 0 : Math.min(1, audio.level.rms * sens * 2)) - energyS) * (1 - tau(0.4));

    // drop: the level well above its slow baseline
    const rms = audio.silent ? 0 : audio.level.rms;
    if (eFast < 0) { if (rms > 0) eFast = eSlow = rms; } // seed both from the first sound
    else {
      eFast += (rms - eFast) * (1 - tau(0.3));
      eSlow += (rms - eSlow) * (1 - tau(6));
      eWarm += dt;
    }
    const dropT = eSlow > 0.01 ? Math.min(1, Math.max(0, (eFast / eSlow - 1.1) * 3)) * Math.min(1, Math.max(0, (eWarm - 3) / 3)) : 0;
    drop += (dropT - drop) * (1 - tau(dropT > drop ? 0.15 : 0.8));
    // a drop needs a beat: a swell in calm music is no drop
    if (drop > 0.6 && dropArmed && !calm) {
      dropArmed = false;
      dropCut();
    }
    if (drop < 0.25) dropArmed = true;

    // calm passages (or a shot held too long): the next shot after a while
    if (calm) stutter = 0;
    if (locked < 0 && stutter === 0 && shotTime > 13 / Math.max(0.3, speed) && (calm || shotTime > 30)) cut(calm);

    // the beams turn: a slow drift and a tick on every beat
    stepCur += (stepTarget - stepCur) * (1 - tau(0.09));
    drift += dt * speed * (0.1 + 0.15 * energyS);
    palMix = Math.min(1, palMix + dt / 1.2);
  }

  /** 32 log-spaced spectrum bars, each in its own auto range (a floor and a ceiling that adapt). */
  function readSpectrum(audio: AudioFrame, sens: number, dt: number) {
    const spec = audio.spectrum({ fftSize: 1024, smoothing: 0.75 });
    const fall = 1 - Math.exp(-dt / 0.15);
    const loRise = 1 - Math.exp(-dt / 1.5), hiFall = 1 - Math.exp(-dt / 2.5);
    for (let i = 0; i < 32; i++) {
      const a = Math.floor(2 * Math.pow(200, i / 32)), b = Math.max(a + 1, Math.floor(2 * Math.pow(200, (i + 1) / 32)));
      const x = (avg(spec, a, b) / 255) * (0.9 + i / 60);
      barLo[i] = x < barLo[i] ? x : barLo[i] + (x - barLo[i]) * loRise;
      barHi[i] = x > barHi[i] ? x : barHi[i] + (x - barHi[i]) * hiFall;
      const range = Math.max(0.12, barHi[i] - barLo[i]);
      const v = Math.min(1, Math.max(0, 0.08 + ((x - barLo[i]) / range) * 0.92) * Math.min(1, x * 3) * sens);
      specBars[i] = v > specBars[i] ? v : specBars[i] + (v - specBars[i]) * fall;
    }
  }

  // --- per-frame uniforms ----------------------------------------------------------------------
  function writeUniforms(time: number, scale: number, hue: number) {
    const f = uniformData;
    const shot = SHOTS[shotIdx];
    f.set([W, H, aspect, 2 / H], 0);
    f.set([FW, FH, 2 / FH, 0], 4);
    f.set([time, shotTime, kickS, snareS], 8);
    f.set([hatS, bassS, midS, trebleS], 12);
    // the camera pushes in on every shot (portrait screens pull back to keep the subject)
    const fit = Math.min(1, 0.4 + 0.6 * aspect / 1.4);
    // the push-in keeps the shot's subject where it is on screen
    const grow = Math.exp(Math.min(pushT, 0.6)) * (1 + 0.03 * pulse + 0.02 * drop);
    const zoom = fit * scale * zoom0 * grow;
    const shake = 0.006 * drop;
    const cx = focus[0] * (1 - 1 / grow) + driftX * shotTime + shake * Math.sin(time * 31);
    const cy = focus[1] * (1 - 1 / grow) + driftY * shotTime + shake * Math.cos(time * 27);
    f.set([cx, cy, zoom, roll + 0.006 * Math.sin(time * 0.3)], 16);
    f.set([shotIdx, seed, energyS, pulse], 20);
    f.set([shot.exposure * (1 + 0.25 * pulse) * (1 + 0.15 * drop), 0.55 + 0.25 * drop, 0.12 + 0.2 * drop + 0.1 * trebleS, 0.045 + 0.015 * hatS], 24);
    f.set([0, Math.min(1, white), 0.55, mirror], 28);
    palette().stops.forEach((c, i) => f.set([...hueRotate(c, hue), RAMP_POS[i]], 32 + i * 4));
    f.set(specBars, 88);
    device.queue.writeBuffer(uniformBuf, 0, f);
  }

  return {
    resize(w, h, dpr) {
      if (lost) { lost.resize?.(w, h, dpr); return; }
      build(w, h, dpr);
    },

    frame({ audio, settings, dt, time }) {
      if (disposed || lost) return;
      readAudio(audio, settings.sensitivity, dt, settings.speed);
      readSpectrum(audio, settings.sensitivity, dt);
      shotTime += dt;
      // short stutter shots push in fast, like the reference
      pushT += dt * push * settings.speed * (0.6 + 1.2 * energyS + (stutter > 0 ? 4 : 0));
      const sp = uniformData.subarray(56, 88);
      sp.fill(0);
      focus = SHOTS[shotIdx].frame({
        t: time, spin: drift + stepCur, pulse, kick: kickS, snare: snareS, hat: hatS,
        bass: bassS, mid: midS, treble: trebleS, ax: aspect,
      }, sp);
      writeUniforms(time, settings.scale, settings.hueShift);

      const encoder = device.createCommandEncoder();
      const pass = (target: GPUTextureView, p: GPURenderPipeline, g: GPUBindGroup) => {
        const rp = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        rp.setPipeline(p);
        rp.setBindGroup(0, g);
        rp.draw(3);
        rp.end();
      };
      pass(sceneTex.createView(), scenePipe, bg.scene);
      pass(b1a.createView(), down1Pipe, bg.down1);
      pass(b1b.createView(), blurHPipe, bg.blurH1);
      pass(b1a.createView(), blurVPipe, bg.blurV1);
      pass(b2a.createView(), downPipe, bg.down2);
      pass(b2b.createView(), blurHPipe, bg.blurH2);
      pass(b2a.createView(), blurVPipe, bg.blurV2);
      pass(sa.createView(), streak1Pipe, bg.streak1);
      pass(sb.createView(), streak2Pipe, bg.streak2);
      pass(context.getCurrentTexture().createView(), finalPipe, bg.final);
      device.queue.submit([encoder.finish()]);
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

export default Pulsar;
