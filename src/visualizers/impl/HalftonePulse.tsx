/**
 * Halftone Pulse — the image-to-shape grid of "Dither / ASCII Effect Pro" by sabosugi
 * (https://codepen.io/sabosugi/pen/bNegbmy, CodePen public pens are MIT), played live.
 *
 * The grid samples an uploaded image, the Sendspin artwork or (without either) a generated
 * "spectrum sun" whose rings follow their frequency band. Every cell draws one shape whose
 * size / angle / offset / opacity come from its luma via one of the pen's 23 modes. Beats swell
 * every shape, flash a bloom and send a shockwave through the source; random modes reshuffle
 * on the beat. In Auto the mode × shape look changes every 8 bars with a radial wipe.
 *
 * Rendering: Canvas 2D cannot stamp thousands of transformed shapes per frame on an iGPU, so the
 * pen's shapes are drawn once into an atlas and rendered as instanced quads (three.js): one draw
 * for the shapes, one additive draw of their blurred copies for the glow.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Eye, EyeOff, Palette, SlidersHorizontal } from 'lucide-react';
import * as THREE from 'three';
import { beatHit } from '../lib/audio';
import { createRenderer, disposeObject, disposeRenderer } from '../lib/three';
import type { OverlayProps, VisualizerFactory } from '../runtime/types';

const MODES = {
  flat: 'Static (Flat)',
  stretch_v: 'Stretch Vertical',
  stretch_h: 'Stretch Horizontal',
  checker: 'Checkerboard (Alt)',
  glitch: 'Glitch (Luma > Offset)',
  melt: 'Pixel Melt (Drip)',
  crosshatch: 'Crosshatch',
  rotation: 'Rotation (Luma > Angle)',
  halftone: 'Halftone (Luma > Size)',
  inv_halftone: 'Inverse (Dark > Size)',
  random_size: 'Random Size (Chaos)',
  random_rot: 'Random Rotation',
  opacity: 'Opacity (Luma > Alpha)',
  inv_opacity: 'Inv. Opacity (Dark > Alpha)',
  threshold: 'Threshold (Hard Cut)',
  flow: 'Flow Field (Direction)',
  edges: 'Edge Detect (Outline)',
  jitter: 'Mosaic Jitter (Scatter)',
  posterize: 'Posterize (Levels)',
  interference: 'Interference (Moiré)',
  crt_scan: 'CRT TV (Scanline)',
  bio: 'Bio-Organic (Cellular)',
  eraser: 'Eraser (Noise)',
} as const;
type Mode = keyof typeof MODES;

const SHAPES = {
  circle: 'Circle',
  rect: 'Square',
  triangle: 'Triangle',
  octagon: 'Octagon',
  star: 'Star',
  cross: 'Cross',
  rect_v: 'Rect Vertical',
  rect_h: 'Rect Horizontal',
  hex_v: 'Hexagon Vertical',
  line_diag_r: 'Diagonal /',
  line_diag_l: 'Diagonal \\',
  chevron: 'Chevron',
  trapezoid: 'Trapezoid',
  semi_top: 'Semi-Circle Top',
  semi_bottom: 'Semi-Circle Bottom',
  rect_hollow: 'Square Hollow',
  spiral: 'Spiral',
  concentric: 'Concentric Circles',
  gear: 'Gear (Cog)',
  flower: 'Flower (5 Petals)',
  shuriken: 'Shuriken',
  lightning: 'Lightning',
  diamond_hollow: 'Diamond Hollow',
  windmill: 'Windmill',
  leaf: 'Leaf',
  ghost: 'Pacman Ghost',
  ascii: 'ASCII (Glyphs)',
} as const;
type Shape = keyof typeof SHAPES;

/** Curated mode × shape pairs that Auto cycles through (the first one is the opening look). */
const LOOKS: readonly (readonly [Mode, Shape])[] = [
  ['halftone', 'circle'],
  ['rotation', 'line_diag_r'],
  ['crosshatch', 'rect'],
  ['flow', 'chevron'],
  ['stretch_v', 'rect_v'],
  ['glitch', 'rect_h'],
  ['bio', 'leaf'],
  ['posterize', 'hex_v'],
  ['checker', 'diamond_hollow'],
  ['crt_scan', 'rect'],
  ['interference', 'concentric'],
  ['jitter', 'star'],
  ['melt', 'ghost'],
  ['eraser', 'ascii'],
  ['halftone', 'ascii'],
  ['random_rot', 'lightning'],
  ['opacity', 'gear'],
  ['random_size', 'flower'],
  ['edges', 'cross'],
];

type HalftonePulseApi = {
  setImage(url: string): void;
  setMode(mode: Mode | 'auto'): void;
  setShape(shape: Shape | 'auto'): void;
  setNeon(on: boolean): void;
};

const TAU = Math.PI * 2;
const CELL = 14; // CSS px at scale 1
const MAX_CELLS = 9000;
const GAP = 1;
const BASE_SCALE = 0.9;

// Atlas slots: every shape, then the ASCII ramp
const GLYPH_KEYS = [...'.:-=+*#%@'].map(g => `glyph:${g}`);
const SHAPE_KEYS = (Object.keys(SHAPES) as Shape[]).filter(s => s !== 'ascii');
const ATLAS_KEYS = [...SHAPE_KEYS, ...GLYPH_KEYS];
const SHAPE_SLOT = Object.fromEntries(SHAPE_KEYS.map((s, i) => [s, i])) as Record<Shape, number>;
const GLYPH_SLOT = SHAPE_KEYS.length;
const GLYPH_COUNT = GLYPH_KEYS.length;
const SLOT = 128;
const ATLAS_COLS = 8;
const ATLAS_ROWS = Math.ceil(ATLAS_KEYS.length / ATLAS_COLS);
const LOOK_BEATS = 32; // 8 bars of 4/4
const LOOK_MIN_SECONDS = 10; // raw kick fallback can fire fast: never switch sooner
const LOOK_SECONDS = 16; // fallback without a confident tempo
const WIPE_SECONDS = 0.6;
const F_LO = 45;
const F_HI = 9000;
const IMAGE_MAX = 256;
const CONTRAST = 25; // the pen's contrast slider, fixed

const HalftonePulse: VisualizerFactory = ({ container, width, height, dpr, metadata: initialMetadata }) => {
  const renderer = createRenderer(container, width, height, dpr, { antialias: false });
  renderer.setClearColor(0x07070b, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.Camera(); // unused: the vertex shader writes clip space directly

  // Shape atlas: the pen's shapes (and the ASCII glyphs) drawn once, crisp in the top half and
  // blurred in the bottom half (the glow pass).
  const atlas = buildAtlas();
  const atlasTexture = new THREE.CanvasTexture(atlas);
  atlasTexture.flipY = false;

  // One quad, instanced once per visible cell
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const instanced = (itemSize: number) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * itemSize), itemSize);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const aOffset = instanced(2); // cell centre + offset, CSS px
  const aXform = instanced(4); // 2×2 matrix (a, b, c, d) as in setTransform: rotation × scale
  const aColor = instanced(4); // rgb + alpha
  const aSprite = instanced(1); // atlas slot
  geometry.setAttribute('aOffset', aOffset);
  geometry.setAttribute('aXform', aXform);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aSprite', aSprite);
  geometry.instanceCount = 0;

  const uniforms = {
    uMap: { value: atlasTexture },
    uRes: { value: new THREE.Vector2(width, height) },
    uUnit: { value: CELL - GAP },
    uAtlas: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
  };
  const makeMaterial = (glow: boolean) => new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHalf: { value: glow ? 1 : 0 }, uQuad: { value: glow ? 1.8 : 1 }, uGain: { value: 1 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide, // the clip-space y flip reverses the winding
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: glow ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
  });
  const shapesMaterial = makeMaterial(false);
  const glowMaterial = makeMaterial(true);
  const shapes = new THREE.Mesh(geometry, shapesMaterial);
  const glow = new THREE.Mesh(geometry, glowMaterial);
  shapes.frustumCulled = glow.frustumCulled = false;
  glow.renderOrder = 1;
  scene.add(shapes, glow);

  // Grid-resolution canvas for image sources (read back once per frame)
  const src = document.createElement('canvas');
  const sctx = src.getContext('2d', { willReadFrequently: true })!;

  // Grid state (rebuilt on resize / scale change)
  let gw = 0, gh = 0, gScale = 0;
  let cols = 0, rows = 0, cell = CELL, x0 = 0, y0 = 0, rMax = 1;
  let luma = new Float32Array(0);
  let rgb = new Float32Array(0);
  let rN = new Float32Array(0); // distance from the centre (1 = half the short side)
  let th = new Float32Array(0); // angle around the centre
  let uN = new Float32Array(0);
  let vN = new Float32Array(0);

  function rebuild(w: number, h: number, scale: number) {
    gw = w; gh = h; gScale = scale;
    cell = Math.max(CELL * scale, Math.sqrt((w * h) / MAX_CELLS));
    while (Math.ceil(w / cell) * Math.ceil(h / cell) > MAX_CELLS) cell *= 1.02;
    cols = Math.max(1, Math.ceil(w / cell));
    rows = Math.max(1, Math.ceil(h / cell));
    x0 = (w - cols * cell) / 2;
    y0 = (h - rows * cell) / 2;
    uniforms.uUnit.value = Math.max(1, cell - GAP);
    const n = cols * rows;
    luma = new Float32Array(n);
    rgb = new Float32Array(n * 3);
    rN = new Float32Array(n);
    th = new Float32Array(n);
    uN = new Float32Array(n);
    vN = new Float32Array(n);
    const R = Math.max(1, Math.min(w, h) / 2);
    rMax = Math.hypot(w, h) / 2 / R;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const u = (x0 + (i + 0.5) * cell - w / 2) / R;
        const v = (y0 + (j + 0.5) * cell - h / 2) / R;
        uN[k] = u; vN[k] = v;
        rN[k] = Math.hypot(u, v);
        th[k] = Math.atan2(v, u);
      }
    }
    src.width = cols; src.height = rows;
  }

  // --- Image source: uploaded > Sendspin artwork > generated scene ---
  let uploadedImage: string | null = null;
  let artworkUrl: string | null = initialMetadata?.artwork_url ?? null;
  let failedArtworkUrl: string | null = null;
  let currentSrc: string | null = null;
  let loading: HTMLImageElement | null = null;
  let source: HTMLCanvasElement | null = null; // downscaled image; null = generated scene
  let disposed = false;

  const resolveSrc = () =>
    uploadedImage ?? (artworkUrl && artworkUrl !== failedArtworkUrl ? artworkUrl : null);

  function loadImage() {
    const next = resolveSrc();
    if (next === currentSrc) return;
    currentSrc = next;
    if (loading) {
      loading.onload = null;
      loading.onerror = null;
      loading = null;
    }
    if (!next) {
      setSource(null);
      return;
    }
    const img = new Image();
    loading = img;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loading = null;
      if (!disposed) useImage(img, next);
    };
    img.onerror = () => {
      loading = null;
      imageFailed(next);
    };
    img.src = next;
  }

  function useImage(img: HTMLImageElement, url: string) {
    const k = Math.min(1, IMAGE_MAX / Math.max(img.width, img.height, 1));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * k));
    cv.height = Math.max(1, Math.round(img.height * k));
    const g = cv.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, cv.width, cv.height);
    try {
      g.getImageData(0, 0, 1, 1);
    } catch {
      // Remote artwork tainted the canvas (CORS). Fall back to the next source.
      imageFailed(url);
      return;
    }
    setSource(cv);
  }

  // A source failed to load (or tainted the canvas): drop it and fall back to the next one
  function imageFailed(url: string) {
    if (url !== currentSrc) return;
    if (url === uploadedImage) uploadedImage = null;
    else if (url === artworkUrl) failedArtworkUrl = artworkUrl;
    loadImage();
  }

  function setSource(next: HTMLCanvasElement | null) {
    if (source && source !== next) source.width = 0;
    source = next;
    wipe = 0; // reveal the new source from the centre
  }

  // --- Looks (mode × shape) and the radial wipe between them ---
  let modeSetting: Mode | 'auto' = 'auto';
  let shapeSetting: Shape | 'auto' = 'auto';
  let neon = false;
  let lookIndex = 0;
  let cur: { mode: Mode; shape: Shape } = { mode: LOOKS[0][0], shape: LOOKS[0][1] };
  let prev = cur;
  let wipe = 1; // 0 → 1 while the new look spreads out from the centre; 1 = done
  let lookBeats = 0;
  let lookTime = 0;

  function applyLook() {
    const next = {
      mode: modeSetting === 'auto' ? LOOKS[lookIndex][0] : modeSetting,
      shape: shapeSetting === 'auto' ? LOOKS[lookIndex][1] : shapeSetting,
    };
    if (next.mode === cur.mode && next.shape === cur.shape) return;
    prev = cur;
    cur = next;
    wipe = 0;
  }

  function nextLook() {
    lookBeats = 0;
    lookTime = 0;
    if (modeSetting !== 'auto' && shapeSetting !== 'auto') return;
    lookIndex = (lookIndex + 1 + Math.floor(Math.random() * (LOOKS.length - 1))) % LOOKS.length;
    applyLook();
  }

  // --- Audio state ---
  let pulse = 0; // 1 on a beat, τ 150 ms
  let hits = 0; // seeds the per-cell randomness: random modes reshuffle on the beat
  const waves: { age: number; amp: number }[] = [];
  let bassLvl = 0, midLvl = 0, highLvl = 0;
  let plasmaPhase = 0, ringPhase = 0, wobPhase = 0, huePhase = 0, spin = 0, driftPhase = 0, crtPhase = 0, interPhase = 0;

  loadImage();

  return {
    resize(w, h, pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      uniforms.uRes.value.set(w, h);
    },

    metadata(m) {
      const next = m?.artwork_url ?? null;
      if (next === artworkUrl) return;
      artworkUrl = next;
      loadImage();
    },

    frame({ audio, settings, dt, width: w, height: h }) {
      if (w < 2 || h < 2) return;
      if (w !== gw || h !== gh || settings.scale !== gScale) rebuild(w, h, settings.scale);
      const sens = settings.sensitivity;
      const speed = settings.speed;

      // Levels (0..1, smoothed with dt) and one-shot envelopes
      const follow = Math.min(1, dt * 10);
      bassLvl += (Math.min(1, audio.bands.bass * sens) - bassLvl) * follow;
      midLvl += (Math.min(1, audio.bands.mid * sens * 1.5) - midLvl) * follow;
      highLvl += (Math.min(1, audio.bands.highMid * sens * 2) - highLvl) * follow;
      const snare = Math.min(1, audio.onsets.snare.envelope * sens);
      const hat = Math.min(1, audio.onsets.hat.envelope * sens);

      if (beatHit(audio)) {
        pulse = 1;
        hits++;
        lookBeats++;
        waves.push({ age: 0, amp: Math.min(1.2, 0.7 * sens) });
        if (waves.length > 3) waves.shift();
        // switch the look on the downbeat after 8 bars (any hit without a confident tempo)
        if (lookBeats >= LOOK_BEATS && lookTime >= LOOK_MIN_SECONDS
          && (audio.beat.barBeat === 0 || audio.beat.confidence < 0.3)) nextLook();
      }
      pulse *= Math.exp(-dt / 0.15);
      lookTime += dt;
      if (lookTime > LOOK_SECONDS && (audio.beat.confidence < 0.3 || audio.silent)) nextLook();
      if (wipe < 1) wipe = Math.min(1, wipe + dt / WIPE_SECONDS);
      for (const wv of waves) wv.age += dt;
      while (waves.length && waves[0].age > 2.5) waves.shift();

      // Phase accumulators: audio sets the rate, never multiplies elapsed time
      plasmaPhase += dt * speed * (0.25 + 1.2 * midLvl);
      ringPhase += dt * speed * (1.5 + 5 * bassLvl);
      wobPhase += dt * speed * (0.3 + 1.2 * highLvl);
      huePhase += dt * speed * 0.15;
      spin += dt * speed * (0.15 + 1.2 * midLvl);
      driftPhase += dt * speed * (0.15 + 0.5 * bassLvl);
      crtPhase += dt * speed * (0.2 + 0.6 * hat);
      interPhase += dt * speed * (0.3 + midLvl);

      const n = cols * rows;
      const waveVel = 1.3 * (0.5 + 0.5 * speed);
      const front = wipe * (rMax + 0.2);

      // ---- Pass A: sample the source into luma[] and rgb[] ----
      let img: Uint8ClampedArray | null = null;
      if (source) {
        const sw = source.width, sh = source.height;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, cols, rows);
        sctx.imageSmoothingQuality = 'high';
        sctx.filter = settings.hueShift ? `hue-rotate(${settings.hueShift}deg)` : 'none';
        // audio "camera": zoom punch on the beat, slow drift and sway
        const zoom = (1.06 + Math.min(0.25, 0.1 * pulse * sens) + 0.03 * Math.sin(driftPhase * 0.9))
          * Math.max(cols / sw, rows / sh);
        sctx.translate(cols / 2 + Math.sin(driftPhase) * cols * 0.02, rows / 2 + Math.cos(driftPhase * 0.8) * rows * 0.02);
        sctx.rotate(Math.sin(driftPhase * 0.6) * 0.04);
        sctx.drawImage(source, (-sw * zoom) / 2, (-sh * zoom) / 2, sw * zoom, sh * zoom);
        sctx.filter = 'none';
        try {
          img = sctx.getImageData(0, 0, cols, rows).data;
        } catch {
          if (currentSrc) imageFailed(currentSrc);
        }
      }
      const spec = img ? null : audio.spectrum({ fftSize: 1024, smoothing: 0.7 });
      const binHz = audio.sampleRate / 1024;
      const hue0 = settings.hueShift / 360 + 0.53;
      const contrast = (259 * (CONTRAST + 255)) / (255 * (259 - CONTRAST));

      for (let k = 0; k < n; k++) {
        const r = rN[k];
        let wave = 0;
        for (let q = 0; q < waves.length; q++) {
          const wv = waves[q];
          const d = (r - wv.age * waveVel) / (0.07 + 0.08 * wv.age);
          wave += wv.amp * Math.exp(-wv.age / 0.7 - d * d);
        }
        let ring = 0;
        if (wipe < 1) {
          const d = (r - front) / 0.07;
          ring = Math.exp(-d * d);
        }
        const o = k * 3;
        let L: number;
        let white: number;
        if (img) {
          const p = k * 4;
          if (img[p + 3] < 20) {
            luma[k] = -1;
            continue;
          }
          const R = Math.max(0, Math.min(255, contrast * (img[p] - 128) + 128));
          const G = Math.max(0, Math.min(255, contrast * (img[p + 1] - 128) + 128));
          const B = Math.max(0, Math.min(255, contrast * (img[p + 2] - 128) + 128));
          L = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
          L = L * (0.85 + 0.35 * bassLvl) + 0.5 * wave + 0.4 * ring;
          rgb[o] = R / 255; rgb[o + 1] = G / 255; rgb[o + 2] = B / 255;
          white = Math.min(1, 0.35 * wave + 0.6 * ring);
        } else {
          // spectrum sun: radius → frequency (log, bass in the centre), wobbling rings
          const t = th[k];
          const rr = r + 0.07 * Math.sin(t * 5 + wobPhase) * (0.4 + highLvl);
          const tt = Math.min(1, Math.max(0, rr / 1.35));
          const bin = Math.min(spec!.length - 1, Math.floor((F_LO * Math.pow(F_HI / F_LO, tt)) / binHz));
          // byte spectra sit high on loud music: keep the top of the range, then stripe it
          // into rings that flow outwards
          const s = Math.min(1, Math.max(0, (spec![bin] / 255 - 0.42) * 2.2) * sens);
          const stripes = 0.5 + 0.5 * Math.sin(rr * 26 - ringPhase);
          const sun = s * (0.3 + 0.7 * stripes) * (rr < 1.35 ? 1 : Math.max(0, 1 - (rr - 1.35) * 4));
          const u = uN[k], v = vN[k];
          const pl = 0.5 + 0.5 * Math.sin(u * 3.1 + plasmaPhase) * Math.cos(v * 2.3 - plasmaPhase * 0.8 + u);
          L = sun + pl * (0.08 + 0.14 * midLvl) + wave + 0.12 * pulse * Math.max(0, 1 - r) + 0.4 * ring;
          const hue = hue0 + 0.33 * Math.min(1, r / 1.4) + 0.06 * Math.sin(t * 2 + huePhase);
          // dark where the scene is dark, like a photo: modes that keep every shape full size
          // (flat, glitch, rotation…) then show the scene through colour instead of size
          hsl(hue, 0.95, Math.min(0.6, 0.05 + 0.55 * L), rgb, o);
          white = Math.min(1, 0.25 * wave + 0.5 * ring);
        }
        if (white > 0.01) {
          rgb[o] += (1 - rgb[o]) * white;
          rgb[o + 1] += (1 - rgb[o + 1]) * white;
          rgb[o + 2] += (1 - rgb[o + 2]) * white;
        }
        luma[k] = Math.min(1, L);
      }

      // ---- Pass B: one instance per visible shape ----
      const base = BASE_SCALE * (0.9 + 0.25 * bassLvl) * (1 + Math.min(1.2, 0.45 * pulse * sens));
      const glitchPow = 1 + 3 * snare;
      const flowPow = 1 + 0.5 * midLvl;
      const edgePow = 1.4 + 1.5 * snare;
      const meltPow = 0.5 + 1.5 * bassLvl;
      const jitPow = 0.4 + 2.2 * snare;
      const interPow = 1 + 0.6 * midLvl;
      const crtPow = 1 + 5 * hat;
      const eraserPow = 1.25 - 0.6 * hat;
      const threshold = 0.5 - 0.2 * pulse;
      const crtPos = crtPhase % 1;
      // neon: a rotating three-hue gradient instead of the source colours
      const na = huePhase * 0.7;
      const ndx = Math.cos(na) / (w / 2), ndy = Math.sin(na) / (h / 2);
      const nHue = settings.hueShift / 360 + 190 / 360;
      const off = aOffset.array as Float32Array;
      const xf = aXform.array as Float32Array;
      const col = aColor.array as Float32Array;
      const spr = aSprite.array as Float32Array;
      let count = 0;

      for (let j = 0; j < rows; j++) {
        const cy = y0 + (j + 0.5) * cell;
        const rowJolt = (hash(j, hits * 7 + 3) - 0.5) * cell * 6 * snare;
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const L = luma[k];
          if (L < 0) continue;
          const cx = x0 + (i + 0.5) * cell;
          const fresh = wipe >= 1 || rN[k] <= front;
          const mode = fresh ? cur.mode : prev.mode;
          const shape = fresh ? cur.shape : prev.shape;
          const lr = i + 1 < cols && luma[k + 1] >= 0 ? luma[k + 1] : L;
          const lb = j + 1 < rows && luma[k + cols] >= 0 ? luma[k + cols] : L;
          const H = hash(k, hits);

          let sx = base, sy = base, rot = 0, ox = 0, oy = 0, alpha = 1;
          switch (mode) {
            case 'flat': break;
            case 'halftone': sx = sy = L * base * 1.5; break;
            case 'inv_halftone': sx = sy = (1 - L) * base * 1.5; break;
            case 'rotation': rot = L * Math.PI + spin; break;
            case 'random_size': sx = sy = H * base * 1.3; break;
            case 'random_rot': rot = H * TAU; break;
            case 'glitch': ox = (L - 0.5) * cell * 1.5 * glitchPow + rowJolt; break;
            case 'opacity': alpha = L; break;
            case 'inv_opacity': alpha = 1 - L; break;
            case 'threshold': if (L < threshold) sx = sy = 0; break;
            case 'crosshatch':
              rot = L > 0.5 ? Math.PI / 4 : -Math.PI / 4;
              sy = base * 1.5; sx = base * 0.2;
              break;
            case 'stretch_v': sx = base * 0.5; sy = L * base * 3; break;
            case 'stretch_h': sx = L * base * 3; sy = base * 0.5; break;
            case 'flow':
              rot = Math.atan2(lb - L, lr - L) * flowPow + spin;
              sx = sy = L * base * 1.2;
              break;
            case 'edges':
              sx = sy = Math.min(2, Math.max(Math.abs(L - lr), Math.abs(L - lb)) * 5 * edgePow) * base;
              break;
            case 'melt': oy = L * cell * 2 * meltPow; sx = sy = L * base; break;
            case 'jitter':
              if (L > 0.5) {
                ox = (H - 0.5) * cell * 2 * jitPow;
                oy = (hash(k, hits + 9973) - 0.5) * cell * 2 * jitPow;
              }
              sx = sy = L * base;
              break;
            case 'checker': sx = sy = ((i + j) % 2 === 0 ? L : 1 - L) * base * 1.5; break;
            case 'posterize': sx = sy = (L > 0.8 ? 1 : L > 0.6 ? 0.8 : L > 0.3 ? 0.5 : 0.2) * base; break;
            case 'interference': {
              const pattern = Math.sin(cx * cy * 0.0001 * interPow + interPhase);
              sx = sy = Math.max(0, (L + pattern) * 0.5 * base * 1.5);
              break;
            }
            case 'crt_scan': {
              if (j % 2 === 0) {
                sx = base * 1.2; sy = base * 0.2; ox = 2 * crtPow;
              } else {
                sx = L * base; sy = base * 0.8;
              }
              const d = (j / rows - crtPos) * rows / 3; // rolling bright band
              sy *= 1 + 1.5 * Math.exp(-d * d);
              break;
            }
            case 'bio':
              rot = Math.sin(L * TAU) + H * 0.5 + spin * 0.5;
              sx = sy = (L + 0.2) * base;
              break;
            case 'eraser': if (H > L * eraserPow) sx = sy = 0; break;
          }

          if (wipe < 1) {
            // the wipe front is a ring of swollen shapes
            const d = (rN[k] - front) / 0.07;
            const boost = 1 + 0.9 * Math.exp(-d * d);
            sx *= boost; sy *= boost;
          }
          sx = Math.min(4, sx);
          sy = Math.min(4, sy);
          alpha = Math.min(1, alpha);
          if (sx * sy < 0.0004 || alpha < 0.02) continue;

          let slot: number;
          if (shape === 'ascii') {
            if (L < 0.04) continue;
            slot = GLYPH_SLOT + Math.min(GLYPH_COUNT - 1, Math.floor(L * GLYPH_COUNT));
          } else {
            slot = SHAPE_SLOT[shape];
          }

          const c2 = count * 2, c4 = count * 4;
          off[c2] = cx + ox;
          off[c2 + 1] = cy + oy;
          if (rot === 0) {
            xf[c4] = sx; xf[c4 + 1] = 0; xf[c4 + 2] = 0; xf[c4 + 3] = sy;
          } else {
            const cs = Math.cos(rot), sn = Math.sin(rot);
            xf[c4] = cs * sx; xf[c4 + 1] = sn * sx; xf[c4 + 2] = -sn * sy; xf[c4 + 3] = cs * sy;
          }
          if (neon) {
            const t = (cx - w / 2) * ndx + (cy - h / 2) * ndy; // -1..1 along the gradient
            hsl(nHue + 0.17 * (t + 1), 1, 0.6, col, c4);
          } else {
            const o = k * 3;
            col[c4] = rgb[o]; col[c4 + 1] = rgb[o + 1]; col[c4 + 2] = rgb[o + 2];
          }
          col[c4 + 3] = alpha;
          spr[count] = slot;
          count++;
        }
      }

      geometry.instanceCount = count;
      for (const a of [aOffset, aXform, aColor, aSprite]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, count * a.itemSize);
        a.needsUpdate = true;
      }
      glowMaterial.uniforms.uGain.value = 0.05 + Math.min(0.3, 0.25 * pulse * sens);
      renderer.render(scene, camera);
    },

    dispose() {
      disposed = true;
      if (loading) {
        loading.onload = null;
        loading.onerror = null;
      }
      if (source) source.width = 0;
      src.width = atlas.width = 0;
      disposeObject(scene);
      disposeRenderer(renderer);
    },

    api: {
      setImage(url: string) {
        uploadedImage = url;
        loadImage();
      },
      setMode(mode: Mode | 'auto') {
        modeSetting = mode;
        applyLook();
      },
      setShape(shape: Shape | 'auto') {
        shapeSetting = shape;
        applyLook();
      },
      setNeon(on: boolean) {
        neon = on;
      },
    } satisfies HalftonePulseApi,
  };
};

export default HalftonePulse;

const VERTEX = /* glsl */ `
attribute vec2 aOffset;
attribute vec4 aXform;
attribute vec4 aColor;
attribute float aSprite;
uniform vec2 uRes;
uniform float uUnit;
uniform float uQuad;
uniform float uHalf;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec2 q = position.xy * uUnit * uQuad;
  vec2 p = aOffset + vec2(aXform.x * q.x + aXform.z * q.y, aXform.y * q.x + aXform.w * q.y);
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float c = mod(aSprite, uAtlas.x);
  float r = floor(aSprite / uAtlas.x + 0.5 / uAtlas.x) + uHalf * uAtlas.y;
  vUv = (vec2(c, r) + position.xy * 0.5 + 0.5) / vec2(uAtlas.x, uAtlas.y * 2.0);
  vColor = aColor;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uGain;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float a = texture2D(uMap, vUv).a * vColor.a * uGain;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/** Atlas of white shapes: ATLAS_COLS × ATLAS_ROWS slots, crisp on top, blurred (glow) below. */
function buildAtlas(): HTMLCanvasElement {
  const S = SLOT / 2; // the shape is S wide in its 2S slot (shapes may overflow their cell)
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_COLS * SLOT;
  atlas.height = ATLAS_ROWS * SLOT * 2;
  const g = atlas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.font = `bold ${Math.round(S * 1.25)}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const half of [0, 1]) {
    g.filter = half ? `blur(${Math.round(S * 0.12)}px)` : 'none';
    ATLAS_KEYS.forEach((key, slot) => {
      const x = (slot % ATLAS_COLS) * SLOT;
      const y = (Math.floor(slot / ATLAS_COLS) + half * ATLAS_ROWS) * SLOT;
      g.save();
      g.beginPath();
      g.rect(x, y, SLOT, SLOT);
      g.clip();
      if (key.startsWith('glyph:')) g.fillText(key.slice(6), x + S, y + S);
      else drawShape(g, x + S, y + S, S, key as Shape);
      g.restore();
    });
  }
  return atlas;
}

/** Deterministic 0..1 hash of a cell index and a seed (the hit count). */
function hash(i: number, seed: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** HSL (hue in turns) as 0..1 rgb into out[o..o+2]. */
function hsl(h: number, s: number, l: number, out: Float32Array, o: number) {
  h -= Math.floor(h);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[o] = hueToRgb(p, q, h + 1 / 3);
  out[o + 1] = hueToRgb(p, q, h);
  out[o + 2] = hueToRgb(p, q, h - 1 / 3);
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// --- Shape library (ported from the pen) ---
function drawShape(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, type: Shape) {
  const r = size / 2;
  ctx.beginPath();
  switch (type) {
    case 'circle': ctx.arc(x, y, r, 0, TAU); ctx.fill(); break;
    case 'rect': ctx.rect(x - r, y - r, size, size); ctx.fill(); break;
    case 'triangle': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fill(); break;
    case 'octagon': drawPoly(ctx, x, y, r, 8, Math.PI / 8); ctx.fill(); break;
    case 'star': drawStar(ctx, x, y, 5, r, r * 0.4); ctx.fill(); break;
    case 'cross': { const w = r / 3; ctx.rect(x - w, y - r, w * 2, size); ctx.rect(x - r, y - w, size, w * 2); ctx.fill(); break; }
    case 'rect_v': ctx.rect(x - r * 0.3, y - r, size * 0.3, size); ctx.fill(); break;
    case 'rect_h': ctx.rect(x - r, y - r * 0.3, size, size * 0.3); ctx.fill(); break;
    case 'hex_v': drawPoly(ctx, x, y, r, 6, Math.PI / 6); ctx.fill(); break;
    case 'line_diag_r':
      ctx.moveTo(x - r, y + r); ctx.lineTo(x - r + size * 0.2, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r - size * 0.2, y - r);
      ctx.closePath(); ctx.fill();
      break;
    case 'line_diag_l':
      ctx.moveTo(x - r, y - r); ctx.lineTo(x - r + size * 0.2, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - size * 0.2, y + r);
      ctx.closePath(); ctx.fill();
      break;
    case 'chevron': {
      const cw = r * 0.4;
      ctx.moveTo(x - r, y + r * 0.5); ctx.lineTo(x, y - r * 0.5); ctx.lineTo(x + r, y + r * 0.5);
      ctx.lineTo(x + r, y + r * 0.5 - cw); ctx.lineTo(x, y - r * 0.5 - cw); ctx.lineTo(x - r, y + r * 0.5 - cw);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'trapezoid':
      ctx.moveTo(x - r * 0.6, y - r); ctx.lineTo(x + r * 0.6, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r);
      ctx.closePath(); ctx.fill();
      break;
    case 'semi_top': ctx.arc(x, y + r * 0.1, r, Math.PI, 0); ctx.closePath(); ctx.fill(); break;
    case 'semi_bottom': ctx.arc(x, y - r * 0.1, r, 0, Math.PI); ctx.closePath(); ctx.fill(); break;
    case 'rect_hollow': ctx.rect(x - r, y - r, size, size); ctx.rect(x + r * 0.5, y - r * 0.5, -size * 0.5, size * 0.5); ctx.fill(); break;
    case 'spiral': {
      ctx.lineWidth = size * 0.15;
      ctx.lineCap = 'round';
      const loops = 2;
      const increment = r / (loops * 10);
      ctx.moveTo(x, y);
      for (let i = 0; i < loops * 20; i++) {
        const angle = 0.5 * i;
        const dist = increment * i;
        ctx.lineTo(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist);
      }
      ctx.stroke();
      break;
    }
    case 'concentric':
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      ctx.moveTo(x + r * 0.7, y); ctx.arc(x, y, r * 0.7, TAU, 0, true);
      ctx.moveTo(x + r * 0.4, y); ctx.arc(x, y, r * 0.4, 0, TAU);
      ctx.moveTo(x + r * 0.15, y); ctx.arc(x, y, r * 0.15, TAU, 0, true);
      ctx.fill();
      break;
    case 'gear': {
      const teeth = 8, outerR = r, innerR = r * 0.7, holeR = r * 0.3;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (TAU * i) / (teeth * 2);
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.moveTo(x + holeR, y);
      ctx.arc(x, y, holeR, 0, TAU, true);
      ctx.fill();
      break;
    }
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = (TAU * i) / 5;
        const px = x + Math.cos(a) * (r * 0.6), py = y + Math.sin(a) * (r * 0.6);
        ctx.moveTo(px + r * 0.4, py);
        ctx.arc(px, py, r * 0.4, 0, TAU);
      }
      ctx.fill();
      break;
    case 'shuriken': {
      const inner = r * 0.2;
      ctx.moveTo(x, y - r);
      for (let i = 0; i < 4; i++) {
        const rot = (Math.PI / 2) * i;
        ctx.quadraticCurveTo(
          x + Math.cos(rot + Math.PI / 4) * r * 0.5, y + Math.sin(rot + Math.PI / 4) * r * 0.5,
          x + Math.cos(rot + Math.PI / 2) * r, y + Math.sin(rot + Math.PI / 2) * r,
        );
        ctx.lineTo(x + Math.cos(rot + (3 * Math.PI) / 4) * inner, y + Math.sin(rot + (3 * Math.PI) / 4) * inner);
      }
      ctx.fill();
      break;
    }
    case 'lightning': {
      const w = r * 0.6;
      ctx.moveTo(x + w, y - r); ctx.lineTo(x - w * 0.2, y - r * 0.1); ctx.lineTo(x + w, y - r * 0.1);
      ctx.lineTo(x - w, y + r); ctx.lineTo(x + w * 0.2, y + r * 0.1); ctx.lineTo(x - w, y + r * 0.1);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'diamond_hollow': {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      const hr = r * 0.5;
      ctx.moveTo(x - hr, y); ctx.lineTo(x, y + hr); ctx.lineTo(x + hr, y); ctx.lineTo(x, y - hr); ctx.closePath();
      ctx.fill();
      break;
    }
    case 'windmill':
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 2) * i;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * r * 0.2, y + Math.sin(ang) * r * 0.2);
        ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        ctx.lineTo(x + Math.cos(ang + 0.5) * r, y + Math.sin(ang + 0.5) * r);
        ctx.closePath();
      }
      ctx.fill();
      break;
    case 'leaf':
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x + r, y - r * 0.5, x + r, y);
      ctx.quadraticCurveTo(x + r, y + r * 0.5, x, y + r);
      ctx.quadraticCurveTo(x - r, y + r * 0.5, x - r, y);
      ctx.quadraticCurveTo(x - r, y - r * 0.5, x, y - r);
      ctx.rect(x - size * 0.05, y - r, size * 0.1, size * 1.8);
      ctx.fill();
      break;
    case 'ghost':
      ctx.arc(x, y - r * 0.2, r * 0.8, Math.PI, 0);
      ctx.lineTo(x + r * 0.8, y + r); ctx.lineTo(x + r * 0.4, y + r * 0.7); ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.4, y + r * 0.7); ctx.lineTo(x - r * 0.8, y + r);
      ctx.closePath();
      ctx.moveTo(x - r * 0.1, y - r * 0.2); ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.2, 0, TAU);
      ctx.moveTo(x + r * 0.5, y - r * 0.2); ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.2, 0, TAU);
      ctx.fill('evenodd');
      break;
    case 'ascii': break; // glyph sprites are drawn as text
  }
}

function drawPoly(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, sides: number, offset: number) {
  const step = TAU / sides;
  for (let i = 0; i < sides; i++) {
    const ang = i * step + offset;
    if (i === 0) ctx.moveTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
    else ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
  }
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.lineTo(cx, cy - outer);
  ctx.closePath();
}

export function Overlay({ api }: OverlayProps) {
  const vizApi = api as HalftonePulseApi | null;
  const [image, setImage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | 'auto'>('auto');
  const [shape, setShape] = useState<Shape | 'auto'>('auto');
  const [neon, setNeon] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => { if (image) vizApi?.setImage(image); }, [vizApi, image]);
  useEffect(() => { vizApi?.setMode(mode); }, [vizApi, mode]);
  useEffect(() => { vizApi?.setShape(shape); }, [vizApi, shape]);
  useEffect(() => { vizApi?.setNeon(neon); }, [vizApi, neon]);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setImage(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  const pill = 'px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors';
  const field = 'w-full px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer outline-none transition-colors';

  return (
    <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-20">
      {showUI && styleOpen && (
        <div className="w-64 max-w-[calc(100vw-3rem)] flex flex-col gap-2 p-3 bg-black/60 backdrop-blur-sm border border-white/20 rounded-2xl">
          <select aria-label="Mode" value={mode} onChange={e => setMode(e.target.value as Mode | 'auto')}
            className={field} style={{ colorScheme: 'dark' }}>
            <option value="auto">Mode: Auto (every 8 bars)</option>
            {Object.entries(MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Shape" value={shape} onChange={e => setShape(e.target.value as Shape | 'auto')}
            className={field} style={{ colorScheme: 'dark' }}>
            <option value="auto">Shape: Auto</option>
            {Object.entries(SHAPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button
            onClick={() => setNeon(!neon)}
            className={`flex items-center justify-center gap-2 ${field} ${neon ? 'bg-fuchsia-500/20 border-fuchsia-400/50 text-fuchsia-200' : ''}`}
          >
            <Palette className="w-4 h-4" />
            {neon ? 'Colors: Neon' : 'Colors: Source'}
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        {showUI && (
          <>
            <button onClick={() => setStyleOpen(!styleOpen)} aria-expanded={styleOpen} className={`flex items-center gap-2 ${pill}`}>
              <SlidersHorizontal className="w-4 h-4" />
              Style
            </button>
            <label className={`flex items-center gap-2 ${pill}`}>
              <ImagePlus className="w-4 h-4" />
              {image ? 'Change Image' : 'Upload Image'}
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
          </>
        )}
        <button
          onClick={() => setShowUI(!showUI)}
          className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors cursor-pointer"
          title={showUI ? 'Hide UI' : 'Show UI'}
        >
          {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
