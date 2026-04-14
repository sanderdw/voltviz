import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

/** Generate a tileable organic value-noise texture for use in the flame shader. */
function createNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size);

  // Build a small random grid whose edges wrap (tileable)
  const GRID = 16;
  const grid: number[] = new Array((GRID + 1) * (GRID + 1));
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      // Hash that produces the same value for gx=0 and gx=GRID, etc.
      const wx = gx % GRID, wy = gy % GRID;
      let h = (wx * 1619 + wy * 31337) ^ 1013904223;
      h = (Math.imul(h, 1664525) + 1013904223) | 0;
      grid[gy * (GRID + 1) + gx] = (h >>> 0) / 0xffffffff;
    }
  }

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = (i / size) * GRID;
      const fy = (j / size) * GRID;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      // Smoothstep weights for organic interpolation
      const ux = tx * tx * (3 - 2 * tx);
      const uy = ty * ty * (3 - 2 * ty);
      const gx0 = ix % GRID, gx1 = (ix + 1) % GRID;
      const gy0 = iy % GRID, gy1 = (iy + 1) % GRID;
      const v =
        grid[gy0 * (GRID + 1) + gx0] * (1 - ux) * (1 - uy) +
        grid[gy0 * (GRID + 1) + gx1] * ux       * (1 - uy) +
        grid[gy1 * (GRID + 1) + gx0] * (1 - ux) * uy +
        grid[gy1 * (GRID + 1) + gx1] * ux       * uy;
      data[j * size + i] = Math.floor(v * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Vertex shader – full-screen quad
// ---------------------------------------------------------------------------
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader – adapted from @kuvkar's flame (shadertoy.com/view/4tXXRn)
// Audio uniforms: uAudioLevel (0-1 overall), uBassLevel (0-1 bass energy)
// ---------------------------------------------------------------------------
const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D mapSampler;
  uniform vec2 dimensions;
  uniform float time;
  uniform float uAudioLevel;
  uniform float uBassLevel;
  uniform float uHueShift;
  uniform float uSensitivity;

  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  mat2 rotz(float angle) {
    mat2 m;
    m[0][0] = cos(angle); m[0][1] = -sin(angle);
    m[1][0] = sin(angle); m[1][1] = cos(angle);
    return m;
  }

  // Fractal Brownian Motion using noise texture
  float fbm(vec2 uv) {
    float n  = (texture2D(mapSampler, uv       ).r - 0.5) * 0.5;
    n       += (texture2D(mapSampler, uv * 2.0 ).r - 0.5) * 0.25;
    n       += (texture2D(mapSampler, uv * 3.0 ).r - 0.5) * 0.125;
    return n + 0.5;
  }

  // Hue shift helper (HSV rotation applied to an RGB color)
  vec3 hueShiftRGB(vec3 col, float shift) {
    const vec3 k = vec3(0.57735);
    float cosA = cos(shift);
    return col * cosA + cross(k, col) * sin(shift) + k * dot(k, col) * (1.0 - cosA);
  }

  void main() {
    vec2 uv = vUv;

    vec2 _uv = uv;
    uv -= vec2(0.5);
    uv.y /= dimensions.x / dimensions.y;

    vec2 centerUV = uv;

    // Bass drives flame height
    float audioScale = 1.0 + uBassLevel * uSensitivity * 0.6;

    // Height variation from fbm, amplified by bass
    float variationH = fbm(vec2(time * 0.3)) * 1.1 * audioScale;

    // Flame "speed" – overall audio level nudges the scroll speed
    vec2 offset = vec2(0.0, -time * 0.05 * (1.0 + uAudioLevel * 0.4));

    // Flame turbulence – bass widens the rotation
    float f = fbm(uv * 0.1 + offset);
    float l = max(0.1, length(uv));
    float turbulence = 0.45 * (1.0 + uBassLevel * uSensitivity * 0.5);
    uv += rotz(((f - 0.5) / l) * smoothstep(-0.2, 0.4, _uv.y) * turbulence) * uv;

    // Flame thickness – audio level fattens the flame slightly
    float thickness = 5.0 - uAudioLevel * uSensitivity * 1.5;
    float flame = 1.3 - length(uv.x) * max(2.0, thickness);

    // Blue inner flame at the base
    float blueflame = pow(flame * 0.9, 15.0);
    blueflame *= smoothstep(0.2, -1.0, _uv.y);
    blueflame /= max(0.001, abs(uv.x * 2.0));
    blueflame = clamp(blueflame, 0.0, 1.0);

    // Main flame body
    flame *= smoothstep(1.0, variationH * 0.5, _uv.y);
    flame  = clamp(flame, 0.0, 1.0);
    flame  = pow(flame, 3.0);
    flame /= smoothstep(1.1, -0.1, _uv.y);

    // Core colour gradient (yellow tip → red base)
    vec4 col = mix(vec4(1.0, 1.0, 0.0, 0.0), vec4(1.0, 1.0, 0.6, 0.0), flame);
    col = mix(vec4(1.0, 0.0, 0.0, 0.0), col, smoothstep(0.0, 1.6, flame));
    gl_FragColor = col;

    // Blue tint near the base
    vec4 bluecolor = mix(vec4(0.0, 0.0, 1.0, 0.0), gl_FragColor, 0.95);
    gl_FragColor = mix(gl_FragColor, bluecolor, blueflame);

    // Clip to flame shape
    gl_FragColor *= flame;
    gl_FragColor.a  = flame;

    // Soft background halo that breathes with audio
    float haloSize  = 0.5 + uAudioLevel * 0.15;
    // Clamp to 0 so areas outside the halo radius don't go negative (avoids dark patches)
    float centerL   = max(0.0, 1.0 - (length(centerUV + vec2(0.0, 0.1)) / haloSize));
    vec4  halo      = vec4(0.8, 0.3, 0.3, 0.0) * fbm(vec2(time * 0.035)) * centerL + 0.02;
    vec4  finalCol  = mix(halo, gl_FragColor, gl_FragColor.a);
    gl_FragColor    = finalCol;

    // Subtle film-grain noise
    gl_FragColor *= mix(rand(uv) + rand(uv * 0.45), 1.0, 0.9);

    // Optional hue shift (from settings)
    if (uHueShift != 0.0) {
      gl_FragColor.rgb = hueShiftRGB(gl_FragColor.rgb, uHueShift);
    }

    gl_FragColor = clamp(gl_FragColor, 0.0, 1.0);
  }
`;

export default function FlameVisualizer({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // ── Audio ──────────────────────────────────────────────────────────────
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtx.resume();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // ── Three.js ───────────────────────────────────────────────────────────
    const w = container.clientWidth;
    const h = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const noiseTexture = createNoiseTexture(256);

    const uniforms = {
      mapSampler:   { value: noiseTexture },
      dimensions:   { value: new THREE.Vector2(w, h) },
      time:         { value: 0.0 },
      uAudioLevel:  { value: 0.0 },
      uBassLevel:   { value: 0.0 },
      uHueShift:    { value: 0.0 },
      uSensitivity: { value: 1.0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    // ── Resize ────────────────────────────────────────────────────────────
    const handleResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      renderer.setSize(cw, ch);
      uniforms.dimensions.value.set(cw, ch);
    };
    window.addEventListener('resize', handleResize);

    // ── Animation loop ────────────────────────────────────────────────────
    let prevTime = performance.now();

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = (now - prevTime) / 1000;
      prevTime = now;

      analyser.getByteFrequencyData(dataArray);

      // Overall level (normalised 0-1)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const audioLevel = sum / (bufferLength * 255);

      // Bass energy (first ~10 % of bins)
      const bassEnd = Math.floor(bufferLength * 0.10);
      let bassSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += dataArray[i];
      const bassLevel = bassSum / (bassEnd * 255);

      const s = settingsRef.current;
      uniforms.time.value        += delta * 0.6 * s.speed;
      uniforms.uAudioLevel.value  = audioLevel;
      uniforms.uBassLevel.value   = bassLevel;
      uniforms.uHueShift.value    = s.hueShift ?? 0;
      uniforms.uSensitivity.value = s.sensitivity ?? 1.0;

      renderer.render(scene, camera);
    };
    animate();

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      source.disconnect();
      audioCtx.close();
      renderer.dispose();
      noiseTexture.dispose();
      material.dispose();
    };
  }, [stream]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#000' }}
    />
  );
}
