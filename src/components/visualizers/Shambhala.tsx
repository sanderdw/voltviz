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
  uniform float iTime;
  uniform vec2 iResolution;
  uniform float u_speed;
  uniform float u_glowIntensity;
  uniform float u_exposure;
  uniform float u_voxelResolution;
  uniform float u_tunnelRadius;
  uniform vec3 u_colorPhasePrimary;
  uniform vec3 u_colorPhaseSecondary;
  uniform vec3 u_foldingAxis;

  #define MAX_RAY_STEPS 110
  #define STEP_MULTIPLIER 0.23

  vec3 custom_tanh(vec3 x) {
    vec3 e = exp(2.0 * x);
    return (e - 1.0) / (e + 1.0);
  }

  vec3 applySpaceReflection(vec3 position, vec3 axis) {
    return 36.4 * dot(axis, position) * axis - position;
  }

  vec3 calculateDisplacement(vec3 pos, float scale) {
    return (1.1 / scale) * sin(pos.zxy * scale + 3.0 * scale);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;

    vec3 rayOrigin = vec3(0.0, 0.0, iTime * u_speed);
    vec3 rayDir = normalize(vec3(uv, 1.0));

    vec3 foldingAxis = normalize(tan(u_foldingAxis));

    float traveledDistance = 0.5;
    vec3 accumulatedColor = vec3(0.0);

    float tRot = iTime * 0.3;
    mat2 timeRotation = mat2(cos(tRot), cos(tRot + 8.0), cos(tRot + 30.0), cos(tRot));

    vec3 precomputedCoreAnim = u_glowIntensity * exp(sin(iTime * 2.0 + u_colorPhaseSecondary));

    vec3 currentPhase = u_colorPhasePrimary;

    for (int stepIndex = 0; stepIndex < MAX_RAY_STEPS; stepIndex++) {
      vec3 currentPos = rayOrigin + rayDir * traveledDistance;

      float tunnelDist = max(abs(currentPos.x), abs(currentPos.y)) - u_tunnelRadius;

      vec3 fractalPos = currentPos;

      fractalPos.z = abs(mod(fractalPos.z, 7.0) - 3.5);
      fractalPos = applySpaceReflection(fractalPos, foldingAxis);

      fractalPos = log(abs(fractalPos) + 1.03);

      fractalPos = ceil(fractalPos * u_voxelResolution) / u_voxelResolution;

      float maxIter = 21.0 - clamp(traveledDistance * 0.7, 0.0, 16.0);

      for (float iter = 2.0; iter <= 20.9; iter += 1.6) {
        if (iter > maxIter) break;
        fractalPos += calculateDisplacement(fractalPos, iter);
      }

      fractalPos.yz *= timeRotation;
      fractalPos += calculateDisplacement(fractalPos, 1.0);

      float localDensity = abs(tunnelDist) + abs(fractalPos.x) * 0.15 + 0.04;

      vec3 primaryEmission = exp(sin(currentPhase)) / localDensity;
      currentPhase += 0.2;

      float sqDistToCenter = dot(currentPos.xy, currentPos.xy);
      vec3 coreEmission = precomputedCoreAnim / (sqDistToCenter + 1.5);

      accumulatedColor += primaryEmission * 0.5 + coreEmission * 0.05;

      traveledDistance += localDensity * STEP_MULTIPLIER;

      if (traveledDistance > 45.0 || max(accumulatedColor.x, max(accumulatedColor.y, accumulatedColor.z)) > 1000.0) {
        break;
      }
    }

    gl_FragColor = vec4(custom_tanh(accumulatedColor / u_exposure), 1.0);
  }
`;

// Rotate a vec3 around the (1,1,1) axis by `angle` radians — used so the
// global hueShift setting can sweep the color-phase vectors through the
// chromatic spectrum without losing their relative offsets.
function rotateAroundAxis(v: THREE.Vector3, angle: number): THREE.Vector3 {
  const axis = new THREE.Vector3(1, 1, 1).normalize();
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  return new THREE.Vector3(
    v.x * cosA + (axis.y * v.z - axis.z * v.y) * sinA + axis.x * dot * (1 - cosA),
    v.y * cosA + (axis.z * v.x - axis.x * v.z) * sinA + axis.y * dot * (1 - cosA),
    v.z * cosA + (axis.x * v.y - axis.y * v.x) * sinA + axis.z * dot * (1 - cosA),
  );
}

export default function Shambhala({ stream, settings }: Props) {
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

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    const DPR = Math.min(window.devicePixelRatio, 1.0) * 0.6;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(DPR);
    renderer.setSize(w, h);
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const BASE_SPEED = 0.3;
    const BASE_GLOW = 15.8;
    const BASE_EXPOSURE = 256.5;
    const BASE_VOXEL = 55.0;
    const BASE_TUNNEL_RADIUS = 3.3;
    const BASE_PRIMARY_PHASE = new THREE.Vector3(0.1, 2.0, 4.0);
    const BASE_SECONDARY_PHASE = new THREE.Vector3(0.0, 1.0, 2.0);
    const BASE_FOLDING = new THREE.Vector3(3.145, 1.79, 7.81);

    const uniforms = {
      iTime: { value: 0.0 },
      iResolution: { value: new THREE.Vector2(w * DPR, h * DPR) },
      u_speed: { value: BASE_SPEED },
      u_glowIntensity: { value: BASE_GLOW },
      u_exposure: { value: BASE_EXPOSURE },
      u_voxelResolution: { value: BASE_VOXEL },
      u_tunnelRadius: { value: BASE_TUNNEL_RADIUS },
      u_colorPhasePrimary: { value: BASE_PRIMARY_PHASE.clone() },
      u_colorPhaseSecondary: { value: BASE_SECONDARY_PHASE.clone() },
      u_foldingAxis: { value: BASE_FOLDING.clone() },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const clock = new THREE.Clock();
    let smoothedSubBass = 0;
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;
    let phaseDrift = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;

      analyser.getByteFrequencyData(freqData);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      const subBassEnd = Math.min(Math.floor(60 / binHz), freqBins);
      const bassEnd = Math.min(Math.floor(250 / binHz), freqBins);
      const midEnd = Math.min(Math.floor(2000 / binHz), freqBins);
      const highMidEnd = Math.min(Math.floor(6000 / binHz), freqBins);

      const bandEnergy = (start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += freqData[i];
        return end > start ? sum / ((end - start) * 255) : 0;
      };

      const subBass = bandEnergy(0, subBassEnd) * s.sensitivity;
      const bass = bandEnergy(subBassEnd, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highMids = bandEnergy(midEnd, highMidEnd) * s.sensitivity;
      const highs = bandEnergy(highMidEnd, freqBins) * s.sensitivity;

      smoothedSubBass += (subBass - smoothedSubBass) * 0.25;
      smoothedBass += (bass - smoothedBass) * 0.2;
      smoothedMids += (mids - smoothedMids) * 0.15;
      smoothedHighs += ((highMids + highs) * 0.5 - smoothedHighs) * 0.15;

      const delta = clock.getDelta();
      phaseDrift += delta * (0.3 + smoothedHighs * 1.5);

      uniforms.iTime.value += delta * s.speed;

      uniforms.u_speed.value = BASE_SPEED * s.speed * (1.0 + smoothedBass * 2.5);
      uniforms.u_glowIntensity.value = BASE_GLOW + smoothedSubBass * 35.0;
      // Lower exposure = brighter image, so highs drive a treble bloom.
      uniforms.u_exposure.value = Math.max(60.0, BASE_EXPOSURE - smoothedHighs * 140.0);
      uniforms.u_voxelResolution.value = BASE_VOXEL + smoothedMids * 40.0;

      // Tunnel expands with bass and grows/shrinks with the scale setting.
      const scaleFactor = Math.max(0.5, Math.min(3.0, s.scale));
      uniforms.u_tunnelRadius.value = (BASE_TUNNEL_RADIUS + smoothedBass * 1.2) * scaleFactor;

      // Folding axes wobble subtly with mids — geometry morphs to melody.
      const wobble = smoothedMids * 0.4;
      uniforms.u_foldingAxis.value.set(
        BASE_FOLDING.x + Math.sin(phaseDrift * 0.7) * wobble,
        BASE_FOLDING.y + Math.cos(phaseDrift * 0.9) * wobble,
        BASE_FOLDING.z + Math.sin(phaseDrift * 1.1) * wobble,
      );

      // Color phases drift over time + nudged by their respective bands.
      const primaryDrift = phaseDrift * 0.5;
      const secondaryDrift = phaseDrift * 0.3 + smoothedBass * 2.0;
      const driftedPrimary = new THREE.Vector3(
        BASE_PRIMARY_PHASE.x + Math.sin(primaryDrift) * 0.6,
        BASE_PRIMARY_PHASE.y + Math.sin(primaryDrift + 2.0) * 0.6,
        BASE_PRIMARY_PHASE.z + Math.sin(primaryDrift + 4.0) * 0.6,
      );
      const driftedSecondary = new THREE.Vector3(
        BASE_SECONDARY_PHASE.x + Math.sin(secondaryDrift) * 0.8,
        BASE_SECONDARY_PHASE.y + Math.sin(secondaryDrift + 1.5) * 0.8,
        BASE_SECONDARY_PHASE.z + Math.sin(secondaryDrift + 3.0) * 0.8,
      );

      // hueShift rotates the phase vectors around the (1,1,1) axis so the
      // perceived palette sweeps through the spectrum.
      const hueRad = (s.hueShift / 360) * Math.PI * 2;
      uniforms.u_colorPhasePrimary.value.copy(rotateAroundAxis(driftedPrimary, hueRad));
      uniforms.u_colorPhaseSecondary.value.copy(rotateAroundAxis(driftedSecondary, hueRad));

      renderer.render(scene, camera);
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      uniforms.iResolution.value.set(width * DPR, height * DPR);
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
