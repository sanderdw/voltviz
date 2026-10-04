/**
 * Laser Show — two mirrored laser emitters fanning thin beams and smoky "sheet" fans through a
 * hazy club room.
 *
 * Everything is one full-screen fragment shader: every beam is an analytic half-line measured in
 * device pixels (a white-hot gaussian core, a coloured halo and a wide haze term lit by drifting
 * fog), every fan an angular wedge filled with the same fog. The light is accumulated additively
 * and tone-mapped, so crossings bloom towards white without clipping or a bloom pass.
 *
 * The CPU side choreographs the beam angles: four looks (the "hero" layout, a sweeping fan, a
 * tunnel aimed at a rotating ring and a horizontal scan) that change every 16 strong beats and
 * glide into each other. The right emitter mirrors the left one. Beats flash the beams and
 * scissor them apart, kicks fire the fans, hi-hats shimmer a third of the beams and the bass
 * widens the halos; without a beat the hero layout sways slowly.
 */
import * as THREE from 'three';
import { beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { createRenderer, disposeObject, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

/** Thin beams per emitter (the right emitter mirrors the left one). */
const PER = 24;
const BEAMS = PER * 2;
const FANS = 4;

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
/** Left emitter fans: the near-vertical one and the one crossing over the centre. */
const HERO_FANS = [{ a: 88.0, w: 5.0 }, { a: 40.6, w: 3.6 }];

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
  uniform float uGlow;        // halo gain (bass)
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
      col += k * (uBeamCol[i] * (core * 1.6 + halo * uGlow + haze * 0.07) + vec3(core * 0.18));
    }

    // smoky sheet fans
    for (int i = 0; i < FANS; i++) {
      vec4 f = uFan[i];
      if (f.w <= 0.001) continue;
      vec2 e = i < 2 ? uEmit.xy : uEmit.zw;
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
  const fanAngle = HERO_FANS.map(f => f.a);
  const target = new Float64Array(PER);
  const fanTarget = new Float64Array(2);

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
      glow += (0.85 + 0.55 * level - glow) * Math.min(1, dt * 10);

      const live = !audio.silent && audio.beat.confidence >= 0.3;
      quietFor = live ? 0 : quietFor + dt;
      if (quietFor > 3 && pattern !== 0) { pattern = 0; strongBeats = 0; }

      if (beatHit(audio)) {
        const s = beatStrength(audio);
        pulse = Math.max(pulse, s);
        scissor = s;
        scissorSign = -scissorSign;
        if (s >= STRONG_BEAT && ++strongBeats % 16 === 0) {
          pattern = (pattern + 1 + Math.floor(Math.random() * 3)) % 4;
        }
      }
      pulse *= Math.exp(-dt / 0.15);
      scissor *= Math.exp(-dt / 0.2);
      snare = Math.max(snare * Math.exp(-dt / 0.15), audio.onsets.snare.envelope);

      const rate = settings.speed * (0.3 + level);
      sway += dt * rate * 0.9;
      sweep += dt * rate * 1.4;
      ring += dt * rate * 0.7;
      drift += dt * settings.speed * (0.06 + 0.1 * rms);

      // targets of the current look
      const { lx, rx, y } = layout(w, h, settings.scale);
      for (let k = 0; k < PER; k++) {
        let a: number;
        if (pattern === 1) {
          // sweeping fan into the room + a small fan outwards
          if (k < 16) a = 20 + 55 * Math.sin(sweep * 0.8) + (k / 15 - 0.5) * (60 + 70 * level);
          else a = 180 + ((k - 16) / 7 - 0.5) * 50 + 18 * Math.sin(sweep * 1.1 + 1);
        } else if (pattern === 2) {
          // tunnel: every beam aims at a point of a rotating ring around the centre
          const r = Math.min(w, h) * (0.28 + 0.06 * Math.sin(sweep * 0.5));
          const ta = (k / PER) * Math.PI * 2 + ring;
          a = Math.atan2(h * 0.5 + r * Math.sin(ta) - y, w * 0.5 + r * Math.cos(ta) - lx) / DEG;
        } else if (pattern === 3) {
          // horizontal scan
          if (k < 18) a = (k / 17 - 0.5) * 34 + 24 * Math.sin(sweep * 0.9);
          else a = 180 + (k - 20.5) * 9 - 12 * Math.sin(sweep * 0.9);
        } else {
          a = HERO[k].a + 2.5 * Math.sin(sway + k * 0.9) * (k % 2 ? 1 : -1);
        }
        target[k] = a + scissor * 3.5 * scissorSign * (k % 2 ? 1 : -1);
      }
      if (pattern === 0) {
        fanTarget[0] = HERO_FANS[0].a + 3 * Math.sin(sway * 0.7);
        fanTarget[1] = HERO_FANS[1].a + 3 * Math.sin(sway * 0.7 + 2);
      } else {
        fanTarget[0] = 92 + 22 * Math.sin(sweep * 0.6);
        fanTarget[1] = 38 + 16 * Math.sin(sweep * 0.6 + 1.7);
      }

      // glide towards them (pattern changes ease in over ~0.4 s)
      const ease = 1 - Math.exp(-dt / 0.13);
      for (let k = 0; k < PER; k++) angle[k] += wrapDeg(target[k] - angle[k]) * ease;
      for (let k = 0; k < 2; k++) fanAngle[k] += wrapDeg(fanTarget[k] - fanAngle[k]) * ease;

      // uniforms
      applyHue(settings.hueShift);
      const hat = Math.min(1, audio.onsets.hat.envelope * sens);
      // kicks also flash on their own, so the beams still hit when the tempo is not (yet) locked
      const kick = Math.min(1, audio.onsets.kick.envelope * sens);
      const hit = Math.min(1, Math.max(pulse * sens, kick * 0.7));
      const bright = 0.75 + 0.6 * hit;
      for (let k = 0; k < PER; k++) {
        const hb = HERO[k];
        const i = hb.i * bright * (k % 3 === 1 ? 1 + 0.45 * hat : 1);
        const a = angle[k] * DEG;
        const c = Math.cos(a), s = Math.sin(a);
        uniforms.uBeam.value[k].set(c, s, i, 0);
        uniforms.uBeam.value[k + PER].set(-c, s, i, 1);
        uniforms.uBeamCol.value[k].copy(shifted[hb.c]);
        uniforms.uBeamCol.value[k + PER].copy(shifted[hb.c]);
      }
      const fanI = 0.85 + 0.55 * kick + 0.25 * Math.min(1, pulse * sens);
      for (let k = 0; k < 2; k++) {
        const a = fanAngle[k] * DEG;
        const hw = (HERO_FANS[k].w + 1.2 * Math.min(1, snare * sens)) * DEG;
        uniforms.uFan.value[k].set(Math.cos(a), Math.sin(a), hw, fanI);
        uniforms.uFan.value[k + 2].set(-Math.cos(a), Math.sin(a), hw, fanI);
      }

      uniforms.uResolution.value.set(w * d, h * d);
      uniforms.uEmit.value.set(lx * d, y * d, rx * d, y * d);
      uniforms.uUnit.value = (h * d / 1250) * (0.75 + 0.25 * settings.scale);
      uniforms.uGlow.value = glow;
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
