/**
 * Kaleidoscope — a cluster of neon-edged 3D blocks (pillars, chevrons, hooks, brackets, stepped
 * blocks) tumbling in the dark, folded into a 4-, 6-, 8- or 12-way mirrored snowflake with a wide
 * glow, in cyberpunk palettes that change with every look.
 *
 * Three passes:
 *  1. the 3D scene into a multisampled half-float target: instanced unit boxes, flat lit (deep
 *     blue faces, pink faces towards the key light) with antialiased edge lines of a constant
 *     pixel width, computed per fragment from the box-local position (no line geometry);
 *  2. the kaleidoscope: every output pixel folds its angle into the first wedge and samples the
 *     scene there, so the mirror lines are seamless. Every wedge lies in the upper right quadrant,
 *     so pass 1 only renders that quadrant (a view offset of the full-screen camera);
 *  3. a dual-filter bloom (down/up mip chain) whose narrow levels take the edge colour and wide
 *     levels the halo colour, composited with a soft shoulder so hot colours bloom towards white.
 *
 * Beats punch the cluster outwards and flash the key light, kicks open the glow, snares kick the
 * cluster round, hi-hats shimmer the edges. Every 16 strong beats (or ~20 s without a beat) a new
 * look cuts in behind a flash: new blocks, another symmetry, another distance, and the colours fade
 * to another palette (neon blue and pink, magenta and cyan, synthwave, acid, amber, cyan and pink).
 */
import * as THREE from 'three';
import { beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { createRenderer, disposeObject, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

/** One box of a part, in part units: position, size, rotation about z (degrees). */
interface Box { p: [number, number, number]; s: [number, number, number]; rz?: number; ry?: number }

const PREFABS: Box[][] = [
  // pillar
  [{ p: [0, 0, 0], s: [0.5, 2.6, 0.5] }],
  // capped pillar
  [{ p: [0, 0, 0], s: [0.42, 2.2, 0.42] }, { p: [0, 1.2, 0], s: [0.8, 0.22, 0.6] }, { p: [0, -1.2, 0], s: [0.8, 0.22, 0.6] }],
  // twin pillars
  [{ p: [-0.32, 0, 0], s: [0.38, 2.4, 0.5] }, { p: [0.32, 0.25, 0], s: [0.38, 2.0, 0.5] }],
  // chevron
  [{ p: [-0.42, 0, 0], s: [0.36, 1.5, 0.55], rz: -32 }, { p: [0.42, 0, 0], s: [0.36, 1.5, 0.55], rz: 32 }],
  // hook
  [{ p: [0, 0, 0], s: [0.46, 1.9, 0.5] }, { p: [0.5, 0.75, 0], s: [1.0, 0.4, 0.5] }],
  // stepped block
  [{ p: [0, 0, 0], s: [1.1, 0.5, 1.0] }, { p: [0, 0.42, 0], s: [0.75, 0.38, 0.7] }, { p: [0, 0.75, 0], s: [0.4, 0.3, 0.4] }],
  // arrow
  [{ p: [0, -0.2, 0], s: [0.32, 1.8, 0.36] }, { p: [-0.28, 0.65, 0], s: [0.26, 0.9, 0.36], rz: -42 }, { p: [0.28, 0.65, 0], s: [0.26, 0.9, 0.36], rz: 42 }],
  // bracket
  [{ p: [0, -0.62, 0], s: [1.45, 0.3, 0.45] }, { p: [-0.58, 0.05, 0], s: [0.3, 1.4, 0.45] }, { p: [0.58, 0.05, 0], s: [0.3, 1.4, 0.45] }],
  // cube with a nub
  [{ p: [0, 0, 0], s: [1.0, 1.0, 1.0] }, { p: [0.52, 0.52, 0.25], s: [0.4, 0.4, 0.4] }],
  // shard
  [{ p: [0, 0, 0], s: [0.62, 0.62, 1.7], rz: 45 }],
  // slab with a fin
  [{ p: [0, 0, 0], s: [1.6, 0.34, 0.8] }, { p: [0.3, 0.3, 0], s: [0.3, 0.5, 0.8], ry: 0 }],
];

const MAX_PARTS = 20;
const MAX_BOXES = MAX_PARTS * 3;
/** Bloom levels: enough halvings to reach a few pixels on a 4K screen. */
const LEVELS = 9;
/**
 * Glow weight by blur radius (log2 of the radius in pixels of a 600 px tall screen, from 1 = 2 px
 * up): the halo hugs the snowflake's outline (most weight at 16-32 px) and fades into the dark.
 */
const RADIUS_WEIGHT = [0.3, 0.5, 1.0, 1.6, 1.6, 0.7, 0.2, 0.04, 0];
/** Mirror symmetries (wedge pairs): 2 = 4 copies, 4 = 8, 6 = 12; the first look is 2. */
const SYMMETRIES = [2, 4, 2, 6, 4];

/**
 * Cyberpunk palettes (display colours: the passes compose in display space): dark = faces turned
 * away, main = the body colour, mid = half-lit faces (its own colour, so two complementary neons
 * do not blend through grey), lit = faces towards the key light, hot = lit faces at their hottest,
 * edge = the edge lines, near / far = the glow close to the blocks / the wide halo.
 */
const PALETTES = [
  // neon blue and pink (the reference look)
  { dark: '#001458', main: '#0a62d0', mid: '#868ee8', lit: '#eeb6fb', hot: '#fff0ff', edge: '#fff0ff', near: '#ffc4ff', far: '#3a8cff' },
  // magenta and cyan
  { dark: '#2b0038', main: '#c3168f', mid: '#9a5cf0', lit: '#5ff4ff', hot: '#e6ffff', edge: '#f0ffff', near: '#9ef8ff', far: '#ff3fae' },
  // synthwave: violet and hot pink
  { dark: '#1c0045', main: '#6a25ff', mid: '#c040e8', lit: '#ff5fb4', hot: '#ffe2f2', edge: '#ffeaf6', near: '#ff8ccc', far: '#8f4dff' },
  // acid: teal and yellow
  { dark: '#00241c', main: '#00a884', mid: '#7ee05a', lit: '#e2ff3a', hot: '#f4ffa0', edge: '#f8ffd8', near: '#f2ff8a', far: '#10ffb0' },
  // amber city with cyan neon
  { dark: '#2e0c00', main: '#e05000', mid: '#ff8a30', lit: '#ffc04a', hot: '#ffe0a0', edge: '#c8ffff', near: '#6cf6ff', far: '#ff5a10' },
  // cyan and pink
  { dark: '#002033', main: '#009fd6', mid: '#b45adc', lit: '#ff3d94', hot: '#ffc0de', edge: '#f0ffff', near: '#ff86c4', far: '#00c4ff' },
];
type PaletteKey = keyof (typeof PALETTES)[number];
const PALETTE_KEYS = Object.keys(PALETTES[0]) as PaletteKey[];
/** Seconds a palette change takes (it starts at the cut, behind the flash). */
const PALETTE_FADE = 1.2;

const quadVertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const boxVertex = /* glsl */ `
  attribute float aTone;
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec3 vNLocal;
  varying vec3 vNView;
  varying vec3 vView;
  varying float vTone;
  void main() {
    vLocal = position;
    vNLocal = normal;
    vTone = aTone;
    vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    mat4 mv = modelViewMatrix * instanceMatrix;
    // box normals lie along the scaled axes, so the plain matrix keeps their direction
    vNView = normalize(mat3(mv) * normal);
    vec4 vp = mv * vec4(position, 1.0);
    vView = vp.xyz;
    gl_Position = projectionMatrix * vp;
  }
`;

const boxFragment = /* glsl */ `
  uniform vec3 uDark;
  uniform vec3 uMain;
  uniform vec3 uMid;
  uniform vec3 uLit;
  uniform vec3 uHot;
  uniform vec3 uEdgeCol;
  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;
  uniform float uKey;     // key light strength
  uniform float uEdge;    // edge line brightness
  uniform float uLine;    // edge line half width, device pixels
  uniform float uRim;     // inner rim glow width, device pixels
  uniform float uNear;    // camera distance of the cluster centre
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec3 vNLocal;
  varying vec3 vNView;
  varying vec3 vView;
  varying float vTone;

  void main() {
    vec3 n = normalize(vNView);
    if (!gl_FrontFacing) n = -n;

    // distance to the face's border, per tangent axis, in device pixels
    // (the pixel scale comes from the linear position: fwidth(abs(x)) collapses at a face's centre
    // line, which would dot it with pixels that lose the rim light)
    vec3 d = (0.5 - abs(vLocal)) * vSize + abs(vNLocal) * 1e4;
    vec3 px3 = d / max(fwidth(vLocal * vSize), vec3(1e-5));
    float px = min(px3.x, min(px3.y, px3.z));
    float line = 1.0 - smoothstep(uLine - 0.7, uLine + 0.7, px);
    float rim = exp(-px / uRim);

    // flat lighting: dark body, main-colour fill, a key light that whitens when hot
    float key = max(dot(n, uKeyDir), 0.0);
    float fill = max(dot(n, uFillDir), 0.0);
    float facing = max(n.z, 0.0);
    vec3 col = uDark * (0.3 + 0.9 * facing);
    col = mix(col, uMain, pow(fill, 1.5) * (0.35 + 0.6 * facing));
    // faces are either lit or main-coloured: a sharp ramp keeps the mix from turning muddy
    float pk = smoothstep(0.35, 0.85, key * uKey * (0.6 + 0.7 * vTone));
    // a gradient across every face (bounce light) so flat faces are not dead flat
    float g = clamp(0.5 + dot(vLocal, vec3(-0.7, 0.9, 0.5)), 0.0, 1.0);
    col *= 0.3 + 1.0 * g;
    // half-lit faces pass through the palette's bright mid colour instead of a dull mix
    col = mix(col, uMid * (0.8 + 0.3 * g), smoothstep(0.0, 0.5, pk));
    col = mix(col, uLit * (0.85 + 0.3 * g), smoothstep(0.5, 1.0, pk));
    col = mix(col, uHot, pk * smoothstep(0.55, 1.0, key * uKey) * 0.85);
    // neon: the edges bleed light into the faces
    col += (uLit * (0.35 + 0.6 * pk) + uMain * 0.2) * rim * 0.6;
    // far blocks sink into the dark
    float depth = clamp((-vView.z - uNear) / 6.0, -1.0, 1.0);
    col *= 1.0 - 0.35 * max(depth, 0.0);
    col = mix(col, uEdgeCol * uEdge, line);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const kaleidoFragment = /* glsl */ `
  uniform sampler2D tScene; // the upper right quadrant of the screen (plus a small margin)
  uniform vec2 uCenter;      // mirror centre, on a whole pixel so the mirrored copies stay pixel-exact
  uniform vec4 uQuad;        // quadrant target: xy = its origin relative to the centre, zw = its size
  uniform float uSeg;        // wedge angle (PI / symmetry)
  varying vec2 vUv;
  void main() {
    vec2 p = gl_FragCoord.xy - uCenter;
    float r = length(p);
    float a = mod(atan(p.y, p.x), 2.0 * uSeg);
    a = uSeg - abs(a - uSeg);
    vec2 uv = (r * vec2(cos(a), sin(a)) - uQuad.xy) / uQuad.zw;
    vec2 inside = step(uv, vec2(1.0));
    gl_FragColor = vec4(texture2D(tScene, uv).rgb * inside.x * inside.y, 1.0);
  }
`;

// dual-filter (Kawase) bloom
const downFragment = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;   // 1 / source size
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
    s += texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
    s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
    s += texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
    gl_FragColor = vec4(s / 8.0, 1.0);
  }
`;

const upFragment = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;   // 1 / source size
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel * 0.5;
    vec3 s = texture2D(tSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0 * uTint, 1.0);
  }
`;

const compositeFragment = /* glsl */ `
  uniform sampler2D tImage;
  uniform sampler2D tGlow;
  uniform float uGlow;
  uniform vec3 uGlowTint;
  uniform float uFlash;
  uniform vec3 uFlashCol;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // linear up to 0.75, then a soft shoulder to 1
  vec3 shoulder(vec3 c) {
    vec3 k = vec3(0.75);
    return mix(c, k + 0.25 * (1.0 - exp(-(c - k) / 0.25)), step(k, c));
  }
  void main() {
    vec3 img = texture2D(tImage, vUv).rgb;
    // the glow saturates softly (hue kept), so the gaps inside the snowflake fill with blue light
    // instead of burning out while the halo outside can still reach far
    vec3 glow = texture2D(tGlow, vUv).rgb * uGlowTint * uGlow;
    float gm = max(glow.r, max(glow.g, glow.b));
    glow *= gm > 1e-4 ? 0.8 * (1.0 - exp(-gm / 0.8)) / gm : 1.0;
    // an outer glow: it fills the dark around and between the blocks, lit faces keep their colour
    float lum = dot(img, vec3(0.3, 0.5, 0.2));
    vec3 c = img + glow * (1.0 - smoothstep(0.02, 0.3, lum));
    // a cut flashes the glow around the blocks, the dark stays dark
    c += uFlashCol * uFlash * 2.2 * dot(glow, vec3(0.33));
    // red / green that does not fit spills into the other channels (hot pink -> white); a hot blue
    // stays blue instead of turning cyan
    float over = max(max(c.r, c.g) - 1.0, 0.0);
    c = shoulder(c + over * 0.35);
    c += (hash(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

interface Part {
  boxes: THREE.Matrix4[];
  r: number;
  theta: number;
  z: number;
  size: number;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  wobble: number;
  tone: number;
}

const Kaleidoscope: VisualizerFactory = ({ container, width, height, dpr }) => {
  const renderer = createRenderer(container, width, height, dpr, { antialias: false });
  renderer.autoClear = false;
  let W = Math.max(1, Math.round(width * dpr));
  let H = Math.max(1, Math.round(height * dpr));

  // --- 3D scene ---
  const scene = new THREE.Scene();
  // a tight depth range (the cluster stays within ~9 units of its centre, 12.5+ away)
  const camera = new THREE.PerspectiveCamera(32, width / height, 2, 30);
  const cluster = new THREE.Group();
  scene.add(cluster);

  const boxUniforms = {
    uDark: { value: new THREE.Color() },
    uMain: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uLit: { value: new THREE.Color() },
    uHot: { value: new THREE.Color() },
    uEdgeCol: { value: new THREE.Color() },
    uKeyDir: { value: new THREE.Vector3(-0.55, 0.55, 0.62).normalize() },
    uFillDir: { value: new THREE.Vector3(0.45, -0.3, 0.85).normalize() },
    uKey: { value: 1 },
    uEdge: { value: 1 },
    uLine: { value: 1 },
    uRim: { value: 8 },
    uNear: { value: 14 },
  };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const tones = new Float32Array(MAX_BOXES);
  geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(tones, 1));
  const boxMaterial = new THREE.ShaderMaterial({
    uniforms: boxUniforms, vertexShader: boxVertex, fragmentShader: boxFragment, side: THREE.DoubleSide,
  });
  const boxes = new THREE.InstancedMesh(geometry, boxMaterial, MAX_BOXES);
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boxes.frustumCulled = false;
  cluster.add(boxes);

  // --- passes ---
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false } as const;
  // the scene's upper right quadrant, with a margin so the bilinear taps on the mirror axes stay inside
  const MARGIN = 4;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const quad = new THREE.Vector4();
  const center = new THREE.Vector2();
  const sizeQuadrant = () => {
    center.set(Math.floor(W / 2), Math.floor(H / 2));
    const qw = W - center.x + MARGIN, qh = H - center.y + MARGIN;
    sceneRT.setSize(qw, qh);
    quad.set(-MARGIN, -MARGIN, qw, qh);
    // three's view offset counts from the top left of the full view
    camera.setViewOffset(W, H, center.x - MARGIN, 0, qw, qh);
  };
  const kalRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const levels = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, rtOpts));
  const sizeLevels = () => {
    let w = W, h = H;
    for (const rt of levels) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); rt.setSize(w, h); }
  };
  sizeLevels();
  sizeQuadrant();

  const fsScene = new THREE.Scene();
  const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  fsQuad.frustumCulled = false;
  fsScene.add(fsQuad);
  const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false) =>
    new THREE.ShaderMaterial({
      uniforms, vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NoBlending, transparent: additive,
    });
  const kalMat = pass(kaleidoFragment, {
    tScene: { value: sceneRT.texture }, uCenter: { value: center }, uQuad: { value: quad },
    uSeg: { value: Math.PI / 2 },
  });
  const downMat = pass(downFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upMat = pass(upFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uTint: { value: new THREE.Color() } }, true);
  const compMat = pass(compositeFragment, {
    tImage: { value: kalRT.texture }, tGlow: { value: levels[0].texture }, uGlow: { value: 1 },
    uGlowTint: { value: new THREE.Color() },
    uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color() }, uSeed: { value: 0 },
  });
  const blit = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    fsQuad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCamera);
  };

  // --- colours (palette fades and the hue shift applied on the CPU) ---
  type Colors = Record<PaletteKey, THREE.Color>;
  const toColors = (f: (k: PaletteKey) => THREE.Color) =>
    Object.fromEntries(PALETTE_KEYS.map(k => [k, f(k)])) as Colors;
  const palettes = PALETTES.map(p => toColors(k => new THREE.Color().setStyle(p[k], THREE.NoColorSpace)));
  const current = toColors(k => palettes[0][k].clone()); // the palette as it fades, before the hue shift
  const fadeFrom = toColors(() => new THREE.Color());
  const shifted = toColors(() => new THREE.Color());
  let palette = 0;
  let paletteFade = 1;  // 0..1 progress of the fade from fadeFrom to the palette
  const nextPalette = () => {
    for (const k of PALETTE_KEYS) fadeFrom[k].copy(current[k]);
    palette = (palette + 1 + Math.floor(Math.random() * (PALETTES.length - 1))) % PALETTES.length;
    paletteFade = 0;
  };
  // Glow colour and weight of every level: the narrow ones take the palette's near colour (the
  // light of the edges), the wide ones its far colour (the halo) and weigh more. The up chain multiplies a level's light by every step on
  // its way to level 0, so step k tints by levelTint[k + 1] / levelTint[k] and the composite by
  // levelTint[0]: every level ends up with exactly its own tint.
  const levelWeight = (k: number) => {
    // level k blurs over about 2^(k+1) device pixels; measure that against a 600 px tall screen
    const x = Math.max(0, Math.log2((2 ** (k + 1) * 600) / H) - 1);
    const i = Math.min(RADIUS_WEIGHT.length - 2, Math.floor(x)), f = Math.min(1, x - i);
    return RADIUS_WEIGHT[i] + (RADIUS_WEIGHT[i + 1] - RADIUS_WEIGHT[i]) * f;
  };
  const levelTint = Array.from({ length: LEVELS }, () => new THREE.Color());
  const tints = Array.from({ length: LEVELS - 1 }, () => new THREE.Color());
  let lastHue = NaN;
  const applyColors = (hueShift: number, dt: number) => {
    const fading = paletteFade < 1;
    if (!fading && hueShift === lastHue) return;
    lastHue = hueShift;
    if (fading) {
      paletteFade = Math.min(1, paletteFade + dt / PALETTE_FADE);
      const e = paletteFade * paletteFade * (3 - 2 * paletteFade);
      for (const k of PALETTE_KEYS) current[k].copy(fadeFrom[k]).lerp(palettes[palette][k], e);
    }
    const h = hueShift / 360;
    for (const k of PALETTE_KEYS) shifted[k].copy(current[k]).offsetHSL(h, 0, 0);
    boxUniforms.uDark.value.copy(shifted.dark);
    boxUniforms.uMain.value.copy(shifted.main);
    boxUniforms.uMid.value.copy(shifted.mid);
    boxUniforms.uLit.value.copy(shifted.lit);
    boxUniforms.uHot.value.copy(shifted.hot);
    boxUniforms.uEdgeCol.value.copy(shifted.edge);
    compMat.uniforms.uFlashCol.value.copy(shifted.near);
    const { near, far } = shifted;
    levelTint.forEach((t, i) => {
      const x = Math.log2((2 ** (i + 1) * 600) / H);
      t.copy(near).lerp(far, Math.min(1, Math.max(0, (x - 1) / 3)));
      // never exactly 0: the up steps divide by the previous level's tint
      t.multiplyScalar(Math.max(1e-3, levelWeight(i)) / Math.max(t.r, t.g, t.b));
    });
    tints.forEach((t, i) => {
      const a = levelTint[i], b = levelTint[i + 1];
      t.setRGB(b.r / Math.max(a.r, 1e-3), b.g / Math.max(a.g, 1e-3), b.b / Math.max(a.b, 1e-3));
    });
    compMat.uniforms.uGlowTint.value.copy(levelTint[0]);
  };

  // --- looks ---
  const parts: Part[] = [];
  let symmetry = 2;
  let camDist = 14;
  let keyBias = 1;
  let extent = 3.5;  // radius of the current cluster (world units)
  let lookIndex = 0;
  const tmpM = new THREE.Matrix4();
  const boxM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const RIGHT = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  const newLook = () => {
    symmetry = lookIndex === 0 ? 2 : SYMMETRIES[(lookIndex + Math.floor(Math.random() * 3)) % SYMMETRIES.length];
    if (lookIndex > 0) nextPalette();
    lookIndex++;
    camDist = rand(12.5, 15.5);
    keyBias = rand(0.75, 1.3);
    // fewer, bigger blocks for few mirrors; more, smaller ones for many
    const partCount = Math.min(MAX_PARTS, 12 + symmetry);
    const sizeK = symmetry <= 2 ? 1.0 : symmetry >= 6 ? 0.8 : 0.9;
    parts.length = 0;
    for (let k = 0; k < partCount; k++) {
      const prefab = PREFABS[Math.floor(Math.random() * PREFABS.length)];
      // blocks start square to the axes (the architectural look), then tumble a little
      const right = () => RIGHT[Math.floor(Math.random() * 4)];
      const base = new THREE.Quaternion().setFromEuler(tmpE.set(right() + rand(-0.25, 0.25), right() + rand(-0.25, 0.25),
        right() + (Math.random() < 0.3 ? Math.PI / 4 : 0)));
      parts.push({
        boxes: prefab.map((b, i) => new THREE.Matrix4().compose(
          tmpV.set(...b.p),
          tmpQ.setFromEuler(tmpE.set(0, (b.ry ?? 0) * Math.PI / 180, (b.rz ?? 0) * Math.PI / 180)),
          // every box of a part a little bigger than the previous one: boxes of equal thickness
          // would share face planes and z-fight (their edge lines flicker through each other)
          tmpS.set(...b.s).multiplyScalar(1 + 0.04 * i),
        )),
        // a few blocks near the middle so the centre of the snowflake is never empty
        r: k < 3 ? rand(0.3, 1.1) : rand(0.9, 2.7),
        theta: rand(0, Math.PI * 2),
        z: rand(-1.6, 1.6),
        size: rand(0.65, 1.25) * sizeK,
        base,
        axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
        spin: rand(0.25, 0.7) * (Math.random() < 0.5 ? -1 : 1),
        wobble: rand(0, Math.PI * 2),
        tone: Math.random(),
      });
    }
    let i = 0;
    for (const p of parts) for (let b = 0; b < p.boxes.length; b++) tones[i++] = p.tone;
    boxes.count = i;
    // the farthest any block can reach, so every look fills the screen alike
    extent = 0;
    for (const p of parts) {
      const reach = Math.max(...p.boxes.map(m => {
        const e = m.elements;
        return Math.hypot(e[12], e[13], e[14]) + 0.5 * Math.hypot(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
      }));
      extent = Math.max(extent, p.r + reach * p.size);
    }
    geometry.getAttribute('aTone').needsUpdate = true;
  };
  newLook();

  // --- motion state ---
  let phase = 0;       // block tumble, rate follows the level
  let turn = 0;        // cluster rotation about the view axis
  let turnKick = 0;    // snare-driven extra rotation (eased)
  let turnTarget = 0;
  let turnSign = 1;
  let level = 0;
  let glow = 1;
  let punch = 0;
  let flash = 0;
  let strongBeats = 0;
  let sinceLook = 0;

  return {
    resize(w, h, d) {
      renderer.setPixelRatio(d);
      renderer.setSize(w, h);
      W = Math.max(1, Math.round(w * d));
      H = Math.max(1, Math.round(h * d));
      kalRT.setSize(W, H);
      sizeLevels();
      lastHue = NaN; // the level weights depend on the height
      camera.aspect = w / h;
      sizeQuadrant(); // also updates the projection
    },

    frame({ audio, settings, dt, width: w, height: h }) {
      const sens = settings.sensitivity;
      const bass = Math.min(1, audio.bands.bass * sens);
      level += (bass - level) * Math.min(1, dt * 8);
      const rms = Math.min(1, audio.level.rms * 2.5 * sens);
      const kick = Math.min(1, audio.onsets.kick.envelope * sens);
      const hat = Math.min(1, audio.onsets.hat.envelope * sens);

      sinceLook += dt;
      if (beatHit(audio)) {
        const s = beatStrength(audio);
        punch = Math.max(punch, Math.min(1, s * sens));
        if (s >= STRONG_BEAT && ++strongBeats % 16 === 0) { newLook(); flash = 1; sinceLook = 0; }
      }
      // without beats the looks still change, slowly
      if (sinceLook > 20 / Math.max(0.3, settings.speed)) { newLook(); flash = 0.6; sinceLook = 0; strongBeats = 0; }
      if (audio.onsets.snare.hit) {
        turnSign = -turnSign;
        turnTarget += (0.12 + 0.18 * Math.min(1, audio.onsets.snare.strength * 0.5)) * turnSign;
      }
      punch *= Math.exp(-dt / 0.16);
      flash *= Math.exp(-dt / 0.2);
      turnKick += (turnTarget - turnKick) * (1 - Math.exp(-dt / 0.12));

      const rate = settings.speed * (0.35 + 0.9 * level);
      phase += dt * rate;
      turn += dt * rate * 0.12;
      glow += (0.9 + 0.5 * level + 0.35 * rms - glow) * Math.min(1, dt * 8);

      // --- place the blocks ---
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const fit = Math.min(1, w / h) * camDist * tanHalf * 1.25 / extent;
      cluster.scale.setScalar(fit * settings.scale * (1 + 0.09 * punch));
      cluster.rotation.set(0.35 * Math.sin(phase * 0.23), 0.45 * Math.sin(phase * 0.17 + 1), turn + turnKick);
      camera.position.set(0, 0, camDist);
      camera.lookAt(0, 0, 0);

      let i = 0;
      const spread = 1 + 0.06 * level + 0.05 * punch;
      for (const p of parts) {
        const r = p.r * spread;
        tmpV.set(r * Math.cos(p.theta), r * Math.sin(p.theta), p.z + 0.3 * Math.sin(phase * 0.5 + p.wobble));
        tmpQ2.setFromAxisAngle(p.axis, phase * p.spin + 0.35 * Math.sin(phase * 0.7 + p.wobble));
        tmpQ.copy(tmpQ2).multiply(p.base);
        tmpM.compose(tmpV, tmpQ, tmpS.setScalar(p.size));
        for (const b of p.boxes) boxes.setMatrixAt(i++, boxM.multiplyMatrices(tmpM, b));
      }
      boxes.instanceMatrix.needsUpdate = true;

      // --- uniforms ---
      applyColors(settings.hueShift, dt);
      const unit = H / 700;
      const hit = Math.min(1, Math.max(punch, kick * 0.6));
      boxUniforms.uKey.value = keyBias * (0.85 + 0.6 * hit + 0.8 * flash);
      boxUniforms.uEdge.value = 1.4 + 0.5 * hat + 0.4 * hit;
      boxUniforms.uLine.value = Math.max(1.0, 1.3 * unit);
      boxUniforms.uRim.value = 7 * unit;
      boxUniforms.uNear.value = camDist;
      kalMat.uniforms.uSeg.value = Math.PI / symmetry;
      compMat.uniforms.uGlow.value = 0.8 * glow * (1 + 0.5 * hit + 1.5 * flash);
      compMat.uniforms.uFlash.value = flash;
      compMat.uniforms.uSeed.value = (compMat.uniforms.uSeed.value + 0.618) % 64;

      // --- render ---
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      blit(kalMat, kalRT);
      let src: THREE.WebGLRenderTarget = kalRT;
      for (const rt of levels) {
        downMat.uniforms.tSrc.value = src.texture;
        downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        blit(downMat, rt);
        src = rt;
      }
      for (let k = LEVELS - 2; k >= 0; k--) {
        const from = levels[k + 1];
        upMat.uniforms.tSrc.value = from.texture;
        upMat.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
        upMat.uniforms.uTint.value.copy(tints[k]);
        blit(upMat, levels[k]);
      }
      blit(compMat, null);
    },

    dispose() {
      disposeObject(scene);
      for (const m of [kalMat, downMat, upMat, compMat]) m.dispose();
      fsQuad.geometry.dispose();
      sceneRT.dispose();
      kalRT.dispose();
      for (const rt of levels) rt.dispose();
      disposeRenderer(renderer);
    },
  };
};

export default Kaleidoscope;
