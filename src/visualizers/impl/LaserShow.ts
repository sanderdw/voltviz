/**
 * Laser Show — two mirrored laser emitters fanning thin beams and smoky "sheet" fans through a
 * hazy club room.
 *
 * Everything is one full-screen fragment shader: every beam is an analytic half-line measured in
 * device pixels (a white-hot gaussian core, a coloured halo and a wide haze term lit by drifting
 * fog), every wide beam an angular wedge filled with the same fog. The light is accumulated additively
 * and tone-mapped, so crossings bloom towards white without clipping or a bloom pass.
 *
 * The CPU side choreographs the beam angles: four looks (the "hero" layout, a sweeping fan, a
 * tunnel aimed at a rotating ring and a horizontal scan) that change every 16 strong beats and
 * glide into each other. The right emitter mirrors the left one. Beats flash the beams and
 * scissor them apart, hi-hats twinkle random beams and the bass widens the halos; without a beat
 * the hero layout sways slowly. Two beams per emitter are opened into smoky wide beams (sheet
 * fans). Every 4 strong beats the width jumps to another beam: the new one widens, then the old
 * one narrows back, so there are never more than three per emitter (six on screen).
 *
 * The mids and highs give the show its character. Mids (vocals, leads, chords) send a ripple
 * through the beams, open the sweeps and slightly widen the sheet fans. Highs (hats, cymbals,
 * air) step a chase of light round the emitters on the beat and whiten and sharpen the cores. Which of the two
 * dominates also picks the next look: the hero layout or the sweeping fan for mid-heavy music,
 * the tunnel or the scan for bright music, switching after 8 strong beats when the music changes
 * character.
 */
import * as THREE from 'three';
import { beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { createRenderer, disposeObject, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

/** Thin beams per emitter (the right emitter mirrors the left one). */
const PER = 24;
const BEAMS = PER * 2;
/** Wide beams per emitter: two held, a third only while the width jumps to another beam. */
const WIDE = 3;
const FANS = WIDE * 2;
/** Half width of a fully opened wide beam (degrees). */
const WIDE_HW = 4.5;

const PINK = 0, VIOLET = 1, BLUE = 2;
// sRGB display colours: the shader composes and tone-maps in display space
const PALETTE = ['#ff1f7a', '#9160ff', '#4775ff'];
const FAN_COLOR = '#2b58ff';
const BG_TOP = '#110b22';
const BG_BOTTOM = '#240d2a';

/**
 * The hero layout of the left emitter (degrees, counter-clockwise from +x with y up), measured
 * from the reference: steep blues, pinks to the upper left, flat crossers into the centre and a
 * dense spread to the floor.
 */
const HERO: { a: number; c: number; i: number }[] = [
  { a: 106.9, c: BLUE, i: 0.9 },
  { a: 96.5, c: PINK, i: 0.55 },
  { a: 127.0, c: PINK, i: 0.9 },
  { a: 130.5, c: PINK, i: 0.7 },
  { a: 12.5, c: VIOLET, i: 0.85 },
  { a: 6.0, c: PINK, i: 0.45 },
  { a: 2.8, c: VIOLET, i: 0.55 },
  { a: 172.0, c: VIOLET, i: 0.6 },
  { a: 181.5, c: PINK, i: 1.25 },
  { a: 190.5, c: VIOLET, i: 0.75 },
  { a: 201.0, c: VIOLET, i: 0.7 },
  { a: 210.0, c: BLUE, i: 0.8 },
  { a: 226.0, c: PINK, i: 0.65 },
  { a: 243.5, c: PINK, i: 1.0 },
  { a: 252.0, c: BLUE, i: 0.9 },
  { a: 263.0, c: VIOLET, i: 0.6 },
  { a: 282.7, c: BLUE, i: 0.9 },
  { a: 291.0, c: VIOLET, i: 0.6 },
  { a: 304.0, c: PINK, i: 0.95 },
  { a: 318.0, c: PINK, i: 0.9 },
  { a: 331.0, c: PINK, i: 0.75 },
  { a: 344.0, c: PINK, i: 0.85 },
  { a: 351.5, c: VIOLET, i: 0.8 },
  { a: 355.0, c: PINK, i: 0.6 },
];
/** Beams opened at the start: the near-vertical blue-pink and the flat one into the centre. */
const START_WIDE = [1, 4];

const vertexShader = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

const fragmentShader = /* glsl */ `
  #define BEAMS ${BEAMS}
  #define FANS ${FANS}
  uniform vec2 uResolution;   // device pixels
  uniform vec4 uEmit;         // left xy, right xy (device pixels, y up)
  uniform vec4 uBeam[BEAMS];  // dir.xy, intensity, emitter (0 | 1)
  uniform vec3 uBeamCol[BEAMS];
  uniform vec4 uFan[FANS];    // dir.xy, half width (rad), intensity
  uniform vec3 uFanCol;
  uniform vec3 uBgTop;
  uniform vec3 uBgBottom;
  uniform float uUnit;        // device pixels per reference pixel (reference = 1250 px tall)
  uniform float uGlow;        // halo gain (bass, mids)
  uniform float uCore;        // white in the beam cores (highs)
  uniform float uFog;         // fog brightness (level)
  uniform float uFlare;       // emitter flare (beat)
  uniform float uDrift;       // fog drift phase
  uniform float uSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // lattice hash on small, wrapped coordinates: a hash of large values differs between the
  // neighbouring cells sharing a corner on some GPUs (FMA / rounding), which shows as seams
  float lattice(vec2 i) {
    vec3 p3 = fract(vec3(mod(i, 289.0).xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(lattice(i), lattice(i + vec2(1.0, 0.0)), u.x),
               mix(lattice(i + vec2(0.0, 1.0)), lattice(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
  // coarse fbm for the domain warp (the fine octaves would be smeared away anyway)
  float fbm3(vec2 p) {
    return 0.5 * noise(p) + 0.25 * noise(p * 2.03 + 17.1) + 0.125 * noise(p * 4.1 - 9.3) + 0.0625;
  }

  void main() {
    vec2 p = gl_FragCoord.xy;
    float u = uUnit;
    float lw = max(u, 0.75);  // never thinner than a device pixel can antialias

    // drifting smoke, domain-warped (shared by the fans, the beam haze and the room)
    vec2 q = p / (330.0 * u);
    vec2 w = vec2(fbm3(q + vec2(uDrift * 0.6, 3.1)), fbm3(q + vec2(5.2, -uDrift * 0.4)));
    float smoke = fbm(q * 1.3 + w * 1.6 + vec2(uDrift * 0.25, uDrift * 0.1));
    float fog = smoothstep(0.25, 0.85, smoke);

    vec3 col = vec3(0.0);
    vec3 room = vec3(0.0);

    // thin beams
    for (int i = 0; i < BEAMS; i++) {
      vec4 b = uBeam[i];
      if (b.z <= 0.001) continue;
      vec2 e = b.w < 0.5 ? uEmit.xy : uEmit.zw;
      vec2 v = p - e;
      float t = dot(v, b.xy);
      float d = abs(v.x * b.y - v.y * b.x);
      float front = smoothstep(-1.5 * lw, 3.0 * lw, t);
      float fade = 0.6 + 0.4 * exp(-t / (1400.0 * u));
      float k = b.z * front * fade;
      room += k * uBeamCol[i] * exp(-d / (260.0 * u));
      if (d > 110.0 * u || k <= 0.0) continue;  // far from this beam: nothing visible left to add
      // halos and haze open up over the first ~80 px, so the converging beams keep the emitter a point
      float open = 0.2 + 0.8 * smoothstep(0.0, 80.0 * u, t);
      float halo = (exp(-d / (3.5 * u)) * 0.9 + exp(-d / (12.0 * u)) * 0.35) * open;
      float core = exp(-(d * d) / (lw * lw * 2.2)) * (0.45 + 0.55 * open);
      float haze = exp(-d / (34.0 * u)) * (0.35 + 0.9 * fog) * open;
      col += k * (uBeamCol[i] * (core * 1.6 + halo * uGlow + haze * 0.07) + vec3(core * uCore));
    }

    // smoky sheet fans
    for (int i = 0; i < FANS; i++) {
      vec4 f = uFan[i];
      if (f.w <= 0.001) continue;
      vec2 e = i < FANS / 2 ? uEmit.xy : uEmit.zw;
      vec2 v = p - e;
      float t = dot(v, f.xy);
      float s = v.x * f.y - v.y * f.x;
      float r = length(v);
      float da = abs(atan(s, t));
      float hw = f.z;
      float inside = smoothstep(hw, hw * 0.82, da) * smoothstep(0.0, 6.0 * u, t);
      float edgeD = r * abs(da - hw);
      float edge = exp(-edgeD * edgeD / (lw * lw * 4.0)) * 1.0 + exp(-edgeD / (6.0 * u)) * 0.45;
      edge *= smoothstep(0.0, 6.0 * u, t) * step(da, hw * 1.6);
      float body = inside * (0.75 + 1.2 * fog) * (0.65 + 0.35 * smoothstep(0.0, hw, da));
      float near = 0.7 + 0.3 * exp(-r / (900.0 * u));
      col += f.w * near * (uFanCol * (body * 1.8 + edge * 1.5) + vec3(edge * 0.4));
      room += f.w * uFanCol * inside * 0.6;
    }

    // emitter flares
    for (int i = 0; i < 2; i++) {
      vec2 v = p - (i == 0 ? uEmit.xy : uEmit.zw);
      float r = length(v);
      float dot0 = exp(-r / (1.1 * u)) * 1.0 + exp(-r / (8.0 * u)) * 0.06;
      float star = exp(-abs(v.y) / (0.9 * lw)) * exp(-abs(v.x) / (26.0 * u))
                 + exp(-abs(v.x) / (0.9 * lw)) * exp(-abs(v.y) / (18.0 * u));
      col += uFlare * (vec3(1.0, 0.75, 0.95) * dot0 + vec3(0.9, 0.6, 1.0) * star * 0.12);
    }

    // the room: gradient, fog lit by the beams, vignette
    float y = gl_FragCoord.y / uResolution.y;
    vec3 bg = mix(uBgBottom, uBgTop, smoothstep(0.05, 0.95, y));
    bg *= 0.75 + 0.5 * fog;
    bg += room * (0.007 + 0.016 * fog) * uFog;
    vec2 c = gl_FragCoord.xy / uResolution - 0.5;
    float vig = 1.0 - 0.45 * dot(c, c);

    vec3 hdr = col;
    vec3 outc = bg * vig + (1.0 - exp(-hdr * 1.1));
    outc += (hash(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
    gl_FragColor = vec4(outc, 1.0);
  }
`;

const DEG = Math.PI / 180;
const wrapDeg = (a: number) => ((a % 360) + 540) % 360 - 180;

const LaserShow: VisualizerFactory = ({ container, width, height, dpr }) => {
  const renderer = createRenderer(container, width, height, dpr, { antialias: false });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uResolution: { value: new THREE.Vector2(width * dpr, height * dpr) },
    uEmit: { value: new THREE.Vector4() },
    uBeam: { value: Array.from({ length: BEAMS }, () => new THREE.Vector4()) },
    uBeamCol: { value: Array.from({ length: BEAMS }, () => new THREE.Color()) },
    uFan: { value: Array.from({ length: FANS }, () => new THREE.Vector4()) },
    uFanCol: { value: new THREE.Color() },
    uBgTop: { value: new THREE.Color() },
    uBgBottom: { value: new THREE.Color() },
    uUnit: { value: 1 },
    uGlow: { value: 1 },
    uCore: { value: 0.18 },
    uFog: { value: 1 },
    uFlare: { value: 1 },
    uDrift: { value: 0 },
    uSeed: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  // display colours; the hue shift is applied here, not per pixel
  const base = (hex: string) => new THREE.Color().setStyle(hex, THREE.NoColorSpace);
  const palette = PALETTE.map(base);
  const fanBase = base(FAN_COLOR);
  const bgTop = base(BG_TOP);
  const bgBottom = base(BG_BOTTOM);
  const shifted = PALETTE.map(() => new THREE.Color());
  let lastHue = NaN;
  const applyHue = (hueShift: number) => {
    if (hueShift === lastHue) return;
    lastHue = hueShift;
    const h = hueShift / 360;
    palette.forEach((c, i) => shifted[i].copy(c).offsetHSL(h, 0, 0));
    uniforms.uFanCol.value.copy(fanBase).offsetHSL(h, 0, 0);
    uniforms.uBgTop.value.copy(bgTop).offsetHSL(h, 0, 0);
    uniforms.uBgBottom.value.copy(bgBottom).offsetHSL(h, 0, 0);
  };

  // beam state (left emitter; the right one mirrors it)
  const angle = HERO.map(b => b.a);
  const target = new Float64Array(PER);

  let pattern = 0;
  let strongBeats = 0;
  let quietFor = 0;
  let sway = 0;       // slow sway, rate follows the level
  let sweep = 0;      // pattern motion, rate follows the level
  let ring = 0;       // tunnel ring rotation
  let drift = 0;      // fog drift
  let level = 0;
  let glow = 0;
  let pulse = 0;
  let scissor = 0;    // beat-driven spread, alternates direction per beat
  let scissorSign = 1;
  let snare = 0;
  let mid = 0;        // smoothed mid level (250 Hz - 2 kHz)
  let high = 0;       // smoothed high level (2 - 16 kHz)
  let midSlow = 0;    // their recent averages
  let highSlow = 0;
  let tilt = 0;       // slow high-vs-mid balance: > 0 bright (EDM), < 0 mid-heavy (rap, ballads)
  let ripple = 0;     // mid ripple phase
  let chase = 0;      // high chase position (turns round the emitter)
  let chaseTo = 0;    // where the chase is stepping to: it steps on the beat

  // wide beams: slot j opens beam `k` by `w` (0..1); `on` is where `w` is heading
  const wide = Array.from({ length: WIDE }, (_, j) => ({ k: START_WIDE[j] ?? -1, w: j < START_WIDE.length ? 1 : 0, on: j < START_WIDE.length, since: j }));
  let handover: { from: number; to: number } | null = null;
  let wideSerial = WIDE;
  let wideBeats = 0;
  let wideClock = 0;  // seconds since the last jump
  /** Opens another beam, well apart from the wide ones; the oldest wide beam closes once it is open. */
  const jump = () => {
    if (handover) return;
    const to = wide.findIndex(s => !s.on && s.w === 0);
    const held = wide.filter(s => s.on);
    if (to < 0 || !held.length) return;
    const from = wide.indexOf(held.reduce((a, b) => (b.since < a.since ? b : a)));
    const taken = wide.filter(s => s.k >= 0).map(s => s.k);
    const free = Array.from({ length: PER }, (_, k) => k).filter(k => !taken.includes(k));
    const apart = free.filter(k => taken.every(t => Math.abs(wrapDeg(angle[k] - angle[t])) >= 25));
    const pool = apart.length ? apart : free;
    Object.assign(wide[to], { k: pool[Math.floor(Math.random() * pool.length)], on: true, since: wideSerial++ });
    handover = { from, to };
    wideClock = 0;
  };
  const twinkle = new Float64Array(PER);

  // mid-heavy music gets the hero layout and the sweeping fan, bright music the tunnel and the scan
  const MID_LOOKS = [0, 1], HIGH_LOOKS = [2, 3];
  const character = () => (tilt > 0.02 ? 1 : tilt < -0.02 ? -1 : 0);
  const nextPattern = () => {
    const c = character();
    const pool = (c > 0 ? HIGH_LOOKS : c < 0 ? MID_LOOKS : [0, 1, 2, 3]).filter(p => p !== pattern);
    return pool[Math.floor(Math.random() * pool.length)];
  };
  const fits = (p: number) => {
    const c = character();
    return c === 0 || (c > 0 ? HIGH_LOOKS : MID_LOOKS).includes(p);
  };

  const layout = (w: number, h: number, scale: number) => {
    const spread = 0.3 * Math.min(1.25, 0.85 + 0.15 * scale);
    return { lx: w * (0.5 - spread), rx: w * (0.5 + spread), y: h * 0.5 };
  };

  return {
    resize(w, h, d) {
      renderer.setPixelRatio(d);
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w * d, h * d);
    },

    frame({ audio, settings, dt, width: w, height: h, dpr: d }) {
      const sens = settings.sensitivity;
      const bass = Math.min(1, audio.bands.bass * sens);
      level += (bass - level) * Math.min(1, dt * 8);
      const rms = Math.min(1, audio.level.rms * 2.5 * sens);
      // after Auto Gain the bands sit around 0.4-0.8 on most music, so the effects follow how far
      // the mids and highs stand above that, plus how much they rise above their recent average
      const b = audio.bands;
      const midIn = (0.4 * b.lowMid + 0.6 * b.mid) * sens;
      const highIn = (0.6 * b.highMid + 0.4 * b.treble) * sens;
      const follow = Math.min(1, dt * 6);
      const settle = Math.min(1, dt / 4);
      mid += (midIn - mid) * follow;
      high += (highIn - high) * follow;
      midSlow += (mid - midSlow) * settle;
      highSlow += (high - highSlow) * settle;
      tilt += (high - 0.7 * mid + 0.04 - tilt) * settle;
      const midAmt = Math.max(0, Math.min(1, (mid - 0.58) / 0.25 + 3 * (mid - midSlow)));
      const highAmt = Math.max(0, Math.min(1, (high - 0.3) / 0.3 + 3 * (high - highSlow)));
      glow += (0.85 + 0.55 * level + 0.35 * midAmt - glow) * Math.min(1, dt * 10);

      const live = !audio.silent && audio.beat.confidence >= 0.3;
      quietFor = live ? 0 : quietFor + dt;
      if (quietFor > 3 && pattern !== 0) { pattern = 0; strongBeats = 0; }

      if (beatHit(audio)) {
        const s = beatStrength(audio);
        pulse = Math.max(pulse, s);
        scissor = s;
        scissorSign = -scissorSign;
        chaseTo += 0.08 + 0.1 * highAmt;
        if (s >= STRONG_BEAT && ++wideBeats % 4 === 0) jump();
        if (s >= STRONG_BEAT && ++strongBeats % 8 === 0 && (strongBeats % 16 === 0 || !fits(pattern))) {
          pattern = nextPattern();
          strongBeats = 0;
        }
      }
      // hi-hats twinkle a few random beams, harder when the highs are up
      if (audio.onsets.hat.hit) {
        const n = 2 + Math.round(4 * highAmt);
        for (let j = 0; j < n; j++) {
          const k = Math.floor(Math.random() * PER);
          twinkle[k] = Math.max(twinkle[k], 0.5 + 0.5 * highAmt);
        }
      }
      const twinkleDecay = Math.exp(-dt / 0.09);
      for (let k = 0; k < PER; k++) twinkle[k] *= twinkleDecay;
      pulse *= Math.exp(-dt / 0.15);
      scissor *= Math.exp(-dt / 0.2);
      // without (strong) beats the width still moves on now and then
      wideClock += dt;
      if (!audio.silent && wideClock > (live ? 8 : 4)) jump();
      const open = dt / 0.35;
      for (const s of wide) s.w = s.on ? Math.min(1, s.w + open) : Math.max(0, s.w - open);
      if (handover) {
        const from = wide[handover.from];
        if (from.on && wide[handover.to].w >= 1) from.on = false;
        if (!from.on && from.w === 0) { from.k = -1; handover = null; }
      }
      snare = Math.max(snare * Math.exp(-dt / 0.15), audio.onsets.snare.envelope);

      const rate = settings.speed * (0.3 + level);
      sway += dt * rate * 0.9;
      sweep += dt * rate * 1.4;
      ring += dt * rate * 0.7;
      drift += dt * settings.speed * (0.06 + 0.1 * rms);
      ripple += dt * settings.speed * (1.2 + 2.5 * midAmt);
      chaseTo += dt * settings.speed * 0.05;
      chase += (chaseTo - chase) * Math.min(1, dt / 0.06);

      // targets of the current look
      const { lx, rx, y } = layout(w, h, settings.scale);
      for (let k = 0; k < PER; k++) {
        let a: number;
        if (pattern === 1) {
          // sweeping fan into the room + a small fan outwards
          if (k < 16) a = 20 + 55 * Math.sin(sweep * 0.8) + (k / 15 - 0.5) * (60 + 40 * level + 50 * midAmt);
          else a = 180 + ((k - 16) / 7 - 0.5) * 50 + 18 * Math.sin(sweep * 1.1 + 1);
        } else if (pattern === 2) {
          // tunnel: every beam aims at a point of a rotating ring around the centre
          const r = Math.min(w, h) * (0.28 + 0.06 * Math.sin(sweep * 0.5));
          const ta = (k / PER) * Math.PI * 2 + ring;
          a = Math.atan2(h * 0.5 + r * Math.sin(ta) - y, w * 0.5 + r * Math.cos(ta) - lx) / DEG;
        } else if (pattern === 3) {
          // horizontal scan
          if (k < 18) a = (k / 17 - 0.5) * (34 + 22 * midAmt) + 24 * Math.sin(sweep * 0.9);
          else a = 180 + (k - 20.5) * 9 - 12 * Math.sin(sweep * 0.9);
        } else {
          a = HERO[k].a + 2.5 * Math.sin(sway + k * 0.9) * (k % 2 ? 1 : -1);
        }
        // the mids send a wave through the beams
        a += midAmt * 3.5 * Math.sin(ripple - k * 0.55);
        target[k] = a + scissor * 3.5 * scissorSign * (k % 2 ? 1 : -1);
      }
      // glide towards them (pattern changes ease in over ~0.4 s)
      const ease = 1 - Math.exp(-dt / 0.13);
      for (let k = 0; k < PER; k++) angle[k] += wrapDeg(target[k] - angle[k]) * ease;

      // uniforms
      applyHue(settings.hueShift);
      // kicks also flash on their own, so the beams still hit when the tempo is not (yet) locked
      const kick = Math.min(1, audio.onsets.kick.envelope * sens);
      const hit = Math.min(1, Math.max(pulse * sens, kick * 0.7));
      const bright = 0.6 + 1.0 * hit;
      // the highs run a spot of light round the emitter, dimming the beams it is not on
      const chasePos = chase % 1;
      for (let k = 0; k < PER; k++) {
        const hb = HERO[k];
        const off = ((angle[k] / 360 - chasePos) % 1 + 1.5) % 1 - 0.5;
        const spot = Math.exp(-(off * off) / 0.006);
        const chaseGain = 1 - 0.45 * highAmt + 1.3 * highAmt * spot;
        const i = hb.i * bright * chaseGain * (1 + 0.5 * twinkle[k]);
        const a = angle[k] * DEG;
        const c = Math.cos(a), s = Math.sin(a);
        uniforms.uBeam.value[k].set(c, s, i, 0);
        uniforms.uBeam.value[k + PER].set(-c, s, i, 1);
        uniforms.uBeamCol.value[k].copy(shifted[hb.c]);
        uniforms.uBeamCol.value[k + PER].copy(shifted[hb.c]);
      }
      // wide beams follow their beam and pulse with the beat; mids and snares only breathe them a little
      const fanI = 0.6 + 0.1 * rms + 0.45 * kick + 0.3 * hit + 0.15 * midAmt;
      const fanHw = WIDE_HW * (0.9 + 0.2 * midAmt) + 0.5 * Math.min(1, snare * sens);
      wide.forEach((sl, j) => {
        const e = sl.w * sl.w * (3 - 2 * sl.w);
        if (sl.k < 0 || e <= 0) {
          uniforms.uFan.value[j].w = 0;
          uniforms.uFan.value[j + WIDE].w = 0;
          return;
        }
        // opens from the width of a thin beam
        const hw = (0.4 + (fanHw - 0.4) * e) * DEG;
        const i = fanI * Math.sqrt(e);
        const a = angle[sl.k] * DEG;
        uniforms.uFan.value[j].set(Math.cos(a), Math.sin(a), hw, i);
        uniforms.uFan.value[j + WIDE].set(-Math.cos(a), Math.sin(a), hw, i);
      });

      uniforms.uResolution.value.set(w * d, h * d);
      uniforms.uEmit.value.set(lx * d, y * d, rx * d, y * d);
      uniforms.uUnit.value = (h * d / 1250) * (0.75 + 0.25 * settings.scale);
      uniforms.uGlow.value = glow * (1 - 0.25 * highAmt);
      uniforms.uCore.value = 0.18 + 0.45 * highAmt;
      uniforms.uFog.value = 0.7 + 0.8 * rms;
      uniforms.uFlare.value = 0.85 + 0.6 * hit;
      uniforms.uDrift.value = drift;
      uniforms.uSeed.value = (uniforms.uSeed.value + 0.618) % 64;
      renderer.render(scene, camera);
    },

    dispose() {
      disposeObject(scene);
      disposeRenderer(renderer);
    },
  };
};

export default LaserShow;
