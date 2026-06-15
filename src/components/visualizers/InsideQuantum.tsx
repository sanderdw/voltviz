import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float u_time;
  uniform float u_rotPhaseX;
  uniform float u_rotPhaseY;
  uniform float u_warpReact;
  uniform vec2 u_resolution;

  uniform vec3 u_color1;
  uniform vec3 u_color2;
  uniform vec3 u_color3;

  uniform float u_warpFreq;
  uniform float u_warpAmp;
  uniform vec3 u_fold;
  uniform vec3 u_rot;
  uniform float u_scaleMult;
  uniform float u_scaleAccum;
  uniform vec3 u_rays;

  vec3 orbitTrap;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  float map(vec3 p) {
    p.xz *= rot(u_rotPhaseX);
    p.xy *= rot(u_rotPhaseY);

    vec3 q = p;
    float scale = 0.26;
    orbitTrap = vec3(1000.0);

    for (int i = 1; i < 2; i++) {
      q += sin(q.zxy * u_warpFreq) * (u_warpAmp + u_warpReact);
      q = abs(q) - u_fold;
      q.xy *= rot(u_rot.x);
      q.xz *= rot(u_rot.y);
      q.yz *= rot(u_rot.z);
      q *= u_scaleMult;
      scale *= u_scaleAccum;
      orbitTrap = min(orbitTrap, abs(q));
    }

    float raysX = length(q.yz) - u_rays.x;
    float raysY = length(q.xz) - u_rays.y;
    float raysZ = length(q.xy) - u_rays.z;

    float k = 0.1;

    float h1 = clamp(6.7 + 0.1 * (raysX - raysY) / k, 0.1, 0.4);
    float mergedRays = mix(raysX, raysY, h1) - k * h1 * (1.0 - h1);

    float h2 = clamp(0.1 + 0.1 * (mergedRays - raysZ) / k, 0.0, 0.8);
    mergedRays = mix(mergedRays, raysZ, h2) - k * h2 * (-7.3 - h2);

    float core = length(p) - 0.44;

    mergedRays /= scale;

    float h3 = clamp(0.5 + 0.5 * (core - mergedRays) / 0.3, 0.0, 1.0);
    float d = mix(core, mergedRays, h3) - 0.3 * h3 * (1.0 - h3);

    return d * 0.3;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

    vec3 ro = vec3(0.0, 0.0, -4.5);
    vec3 rd = normalize(vec3(uv, 1.0));

    float t = hash(gl_FragCoord.xy + mod(u_time, 100.0) * 10.0) * 0.05;

    vec3 finalGlow = vec3(0.0);

    for (int i = 0; i < 90; i++) {
      vec3 p = ro + rd * t;
      float d = map(p);

      vec3 stepColor = mix(u_color1, u_color2, smoothstep(0.0, 1.0, orbitTrap.x));
      stepColor = mix(stepColor, u_color3, smoothstep(0.0, 1.0, orbitTrap.y));

      float glowIntensity = 0.0035 / (abs(d) + 0.005);
      finalGlow += stepColor * glowIntensity;

      t += abs(d) * 0.45 + 0.015;
      if (t > 10.0) break;
    }

    float vignette = 1.0 - dot(uv, uv) * 0.4;
    finalGlow *= vignette;

    finalGlow = (finalGlow * (2.38 * finalGlow + -0.04)) / (finalGlow * (2.35 * finalGlow + 1.52) + 0.14);

    float grain = hash(gl_FragCoord.xy + mod(u_time, 1000.0) * 15.0);
    finalGlow += (grain - 0.5) * 0.10;

    float colorDither = (hash(gl_FragCoord.xy + 123.456) * 2.0 - 1.0) / 255.0;
    finalGlow += colorDither;

    gl_FragColor = vec4(finalGlow, 1.0);
  }
`;

// Convert RGB float array [r,g,b] (0-1) to HSL {h,s,l}
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

// Convert HSL to RGB float array [r,g,b] (0-1)
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export default function InsideQuantum({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Audio setup
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    // Base colors (green palette from the original)
    const baseColor1: [number, number, number] = [0.016, 1.000, 0.000];
    const baseColor2: [number, number, number] = [0.784, 1.000, 0.000];
    const baseColor3: [number, number, number] = [0.000, 0.620, 0.239];

    const BASE_WARP_AMP = 0.29;
    const BASE_CAM_ROT_X = 0.15;
    const BASE_CAM_ROT_Y = 0.10;
    const BASE_RAY_X = 0.30;
    const BASE_RAY_Y = 0.25;
    const BASE_RAY_Z = 0.55;
    const BASE_SCALE_MULT = 2.65;

    const uniforms = {
      u_time: { value: 0.0 },
      u_rotPhaseX: { value: 0.0 },
      u_rotPhaseY: { value: 0.0 },
      u_warpReact: { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(w, h) },
      u_color1: { value: new THREE.Vector3(...baseColor1) },
      u_color2: { value: new THREE.Vector3(...baseColor2) },
      u_color3: { value: new THREE.Vector3(...baseColor3) },
      u_warpFreq: { value: 56.3 },
      u_warpAmp: { value: BASE_WARP_AMP },
      u_fold: { value: new THREE.Vector3(0.5, 0.4, 0.4) },
      u_rot: { value: new THREE.Vector3(0.2, 1.6, -2.9) },
      u_scaleMult: { value: BASE_SCALE_MULT },
      u_scaleAccum: { value: 7.48 },
      u_rays: { value: new THREE.Vector3(BASE_RAY_X, BASE_RAY_Y, BASE_RAY_Z) },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);

    const clock = new THREE.Clock();
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;
    let rotPhaseX = 0;
    let rotPhaseY = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;

      // Audio analysis
      analyser.getByteFrequencyData(dataArray);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      const bassEnd = Math.min(Math.floor(250 / binHz), bufferLength);
      const midEnd = Math.min(Math.floor(2000 / binHz), bufferLength);

      const bandEnergy = (start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += dataArray[i];
        return end > start ? (sum / ((end - start) * 255)) : 0;
      };

      const bass = bandEnergy(0, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highs = bandEnergy(midEnd, bufferLength) * s.sensitivity;

      smoothedBass += (bass - smoothedBass) * 0.2;
      smoothedMids += (mids - smoothedMids) * 0.15;
      smoothedHighs += (highs - smoothedHighs) * 0.15;

      // Update time and accumulate rotation phases
      const delta = clock.getDelta();
      uniforms.u_time.value += delta * s.speed;

      const midBoost = 1.0 + smoothedMids * 2.0;
      rotPhaseX += delta * s.speed * BASE_CAM_ROT_X * midBoost;
      rotPhaseY += delta * s.speed * BASE_CAM_ROT_Y * midBoost;
      uniforms.u_rotPhaseX.value = rotPhaseX;
      uniforms.u_rotPhaseY.value = rotPhaseY;

      // Audio-reactive: bass drives warp amplitude
      uniforms.u_warpAmp.value = BASE_WARP_AMP * (1.0 + smoothedBass * 1.5);

      // Direct audio-reactive warp offset (time-independent)
      uniforms.u_warpReact.value = smoothedMids * 0.15 + smoothedBass * 0.1;

      // Audio-reactive: highs drive ray thickness
      uniforms.u_rays.value.set(
        BASE_RAY_X * (1.0 + smoothedHighs * 1.0),
        BASE_RAY_Y * (1.0 + smoothedHighs * 1.0),
        BASE_RAY_Z * (1.0 + smoothedHighs * 0.8),
      );

      // Scale controls fractal zoom/intensity
      uniforms.u_scaleMult.value = BASE_SCALE_MULT * s.scale;

      // Hue shift: rotate all three base colors
      const hueDelta = s.hueShift / 360;
      const applyHueShift = (base: [number, number, number]): [number, number, number] => {
        const hsl = rgbToHsl(base[0], base[1], base[2]);
        return hslToRgb((hsl.h + hueDelta) % 1, hsl.s, hsl.l);
      };
      const c1 = applyHueShift(baseColor1);
      const c2 = applyHueShift(baseColor2);
      const c3 = applyHueShift(baseColor3);
      uniforms.u_color1.value.set(c1[0], c1[1], c1[2]);
      uniforms.u_color2.value.set(c2[0], c2[1], c2[2]);
      uniforms.u_color3.value.set(c3[0], c3[1], c3[2]);

      renderer.render(scene, camera);
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      uniforms.u_resolution.value.set(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
