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
  uniform float uPhase;
  uniform float uTwist1Phase;
  uniform float uTwist2Phase;
  uniform float uTwistReact;
  uniform vec2 uResolution;

  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;

  uniform float uGlobalRotX;
  uniform float uGlobalRotY;
  uniform float uCoreSquash;
  uniform float uCoreRadius;
  uniform float uRayCorrection;

  uniform float uL1Twist;
  uniform float uL1Scale;
  uniform float uL1ScaleY;
  uniform float uL1Thickness;

  uniform float uL2Twist;
  uniform float uL2Scale;
  uniform float uL2ScaleY;
  uniform float uL2Thickness;

  uniform float uStepMult;
  uniform float uStepMin;

  #define MAX_STEPS 42
  #define MAX_DIST 12.8

  mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  float map(vec3 p) {
    p.xz *= rot(uPhase * uGlobalRotX);
    p.yz *= rot(uPhase * uGlobalRotY);

    float core = length(vec3(p.x, p.y * uCoreSquash, p.z)) - uCoreRadius;

    vec3 q = p;
    q.xz *= rot(q.y * uL1Twist + uTwist1Phase + uTwistReact);
    q *= uL1Scale;
    q.y *= uL1ScaleY;

    float g1 = dot(sin(q), cos(q.yzx));
    float r1 = abs(g1) - uL1Thickness;

    vec3 q2 = p;
    q2.xz *= rot(q2.y * uL2Twist + uTwist2Phase + uTwistReact * 0.7);
    q2 *= uL2Scale;
    q2.y *= uL2ScaleY;

    float g2 = dot(sin(q2), cos(q2.yzx));
    float r2 = abs(g2) - uL2Thickness;

    float rays = max(r1, r2);
    rays *= uRayCorrection;

    return max(core, rays);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

    vec3 ro = vec3(0.0, 0.0, -4.5);
    vec3 rd = normalize(vec3(uv, 1.0));

    float t = uPhase;
    float rayT = 0.0;
    vec3 glow = vec3(0.0);

    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 p = ro + rd * rayT;
      float d = map(p);

      float mixFactor1 = sin(p.y * 2.0 + p.x * 1.5 - t) * 0.5 + 0.5;
      vec3 rayColor = mix(uColor1, uColor2, mixFactor1);

      float mixFactor2 = sin(p.z * 3.0 + t * 2.0) * 0.5 + 0.5;
      rayColor = mix(rayColor, uColor3, mixFactor2);

      float intensity = 0.0018 / (abs(d) + 0.005);
      glow += rayColor * intensity;

      rayT += max(abs(d) * uStepMult, uStepMin);

      if (rayT > MAX_DIST) break;
    }

    vec3 finalColor = glow * 0.7;
    finalColor = smoothstep(0.0, 1.1, finalColor);
    finalColor = pow(finalColor, vec3(1.05));
    finalColor *= 1.0 - length(uv) * 0.5;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Base constants matching the original params
const BASE_SPEED = 0.7;
const BASE_CORE_RADIUS = 2.8322;
const BASE_L1_TWIST_SPEED = 0.2;
const BASE_L2_TWIST_SPEED = -0.4;
const BASE_L1_THICKNESS = 0.1;
const BASE_L2_THICKNESS = 0.06;

export default function HoloBlinds({ stream, settings }: Props) {
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
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    // Three.js setup
    const DPR = Math.min(window.devicePixelRatio, 1.0) * 0.8;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(DPR);
    renderer.setSize(w, h);
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Pre-compute base HSL values for hueShift support
    const baseColor1 = new THREE.Color(0.349, 0.000, 1.000);
    const baseColor2 = new THREE.Color(1.000, 0.251, 0.000);
    const baseColor3 = new THREE.Color(0.000, 0.482, 1.000);
    const hsl1 = { h: 0, s: 0, l: 0 };
    const hsl2 = { h: 0, s: 0, l: 0 };
    const hsl3 = { h: 0, s: 0, l: 0 };
    baseColor1.getHSL(hsl1);
    baseColor2.getHSL(hsl2);
    baseColor3.getHSL(hsl3);

    const uniforms = {
      uPhase: { value: 0.0 },
      uTwist1Phase: { value: 0.0 },
      uTwist2Phase: { value: 0.0 },
      uTwistReact: { value: 0.0 },
      uResolution: { value: new THREE.Vector2(w * DPR, h * DPR) },
      uColor1: { value: new THREE.Vector3(0.349, 0.000, 1.000) },
      uColor2: { value: new THREE.Vector3(1.000, 0.251, 0.000) },
      uColor3: { value: new THREE.Vector3(0.000, 0.482, 1.000) },
      uGlobalRotX: { value: 0.1 },
      uGlobalRotY: { value: 0.03 },
      uCoreSquash: { value: -0.2 },
      uCoreRadius: { value: BASE_CORE_RADIUS },
      uRayCorrection: { value: 0.35 },
      uL1Twist: { value: 43.1 },
      uL1Scale: { value: -0.2 },
      uL1ScaleY: { value: -0.21 },
      uL1Thickness: { value: BASE_L1_THICKNESS },
      uL2Twist: { value: 0.3 },
      uL2Scale: { value: 1.5 },
      uL2ScaleY: { value: 0.0 },
      uL2Thickness: { value: BASE_L2_THICKNESS },
      uStepMult: { value: 0.48 },
      uStepMin: { value: 0.017 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const clock = new THREE.Clock();
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;
    let globalPhase = 0;
    let twist1Phase = 0;
    let twist2Phase = 0;
    const tmpColor = new THREE.Color();

    const bandEnergy = (start: number, end: number): number => {
      let sum = 0;
      for (let i = start; i < end; i++) sum += freqData[i];
      return end > start ? sum / ((end - start) * 255) : 0;
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;

      analyser.getByteFrequencyData(freqData);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      const bassEnd = Math.min(Math.floor(250 / binHz), freqBins);
      const midEnd = Math.min(Math.floor(2000 / binHz), freqBins);

      const bass = bandEnergy(0, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highs = bandEnergy(midEnd, freqBins) * s.sensitivity;

      smoothedBass += (bass - smoothedBass) * 0.15;
      smoothedMids += (mids - smoothedMids) * 0.12;
      smoothedHighs += (highs - smoothedHighs) * 0.10;

      const delta = clock.getDelta();

      // Accumulate phases: audio modulates the rate, not a multiplier on elapsed time
      const currentSpeed = BASE_SPEED * s.speed * (1.0 + smoothedBass * 0.25);
      const midBoost = 1.0 + smoothedMids * 0.6;
      globalPhase += delta * currentSpeed;
      twist1Phase += delta * currentSpeed * BASE_L1_TWIST_SPEED * midBoost;
      twist2Phase += delta * currentSpeed * BASE_L2_TWIST_SPEED * midBoost;

      uniforms.uPhase.value = globalPhase;
      uniforms.uTwist1Phase.value = twist1Phase;
      uniforms.uTwist2Phase.value = twist2Phase;

      // Direct audio-reactive twist offset (time-independent)
      uniforms.uTwistReact.value = smoothedMids * 3.0 + smoothedBass * 1.5;

      // scale: map to core radius around the base value
      const scaleClamped = Math.max(0.5, Math.min(3.0, s.scale));
      uniforms.uCoreRadius.value = BASE_CORE_RADIUS * scaleClamped;

      // bass -> L1 thickness pulse
      uniforms.uL1Thickness.value = BASE_L1_THICKNESS + smoothedBass * 0.08;

      // highs -> L2 detail/thickness
      uniforms.uL2Thickness.value = BASE_L2_THICKNESS + smoothedHighs * 0.06;

      // hueShift: offset hue of all three base colors
      const hueDelta = s.hueShift / 360;
      tmpColor.setHSL((hsl1.h + hueDelta + 1) % 1, hsl1.s, hsl1.l);
      uniforms.uColor1.value.set(tmpColor.r, tmpColor.g, tmpColor.b);
      tmpColor.setHSL((hsl2.h + hueDelta + 1) % 1, hsl2.s, hsl2.l);
      uniforms.uColor2.value.set(tmpColor.r, tmpColor.g, tmpColor.b);
      tmpColor.setHSL((hsl3.h + hueDelta + 1) % 1, hsl3.s, hsl3.l);
      uniforms.uColor3.value.set(tmpColor.r, tmpColor.g, tmpColor.b);

      renderer.render(scene, camera);
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      uniforms.uResolution.value.set(width * DPR, height * DPR);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
