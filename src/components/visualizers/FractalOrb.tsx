import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const vertexShader = `
  varying vec3 vLocalPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vLocalPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec3 uLocalCamPos;
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform float uDensity;
  uniform float uFractalIters;
  uniform float uFractalScale;
  uniform float uFractalDecay;
  uniform float uInternalAnim;
  uniform float uSmoothness;
  uniform float uAsymmetry;

  varying vec3 vLocalPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  float evaluateStructure(vec3 pos) {
    float densityAcc = 0.0;
    vec3 anchor = pos;

    float animTime = uTime * uInternalAnim;
    float s = sin(animTime);
    float c = cos(animTime);
    mat2 rotAnim = mat2(c, s, -s, c);

    float a = 0.5 * uAsymmetry;
    mat2 rotAsym1 = mat2(cos(a), sin(a), -sin(a), cos(a));
    float b = 0.3 * uAsymmetry;
    mat2 rotAsym2 = mat2(cos(b), sin(b), -sin(b), cos(b));

    for (int step = 0; step < 8; ++step) {
      if (float(step) >= uFractalIters) break;

      pos.xy *= rotAnim;
      pos.yz *= rotAnim;
      pos.xz *= rotAsym1;
      pos.yz *= rotAsym2;
      pos += vec3(0.05, -0.02, 0.03) * uAsymmetry;

      vec3 foldedPos = sqrt(pos * pos + uSmoothness);
      float magnitudeSq = dot(foldedPos, foldedPos);
      magnitudeSq = max(magnitudeSq, 0.00001);

      pos = (uFractalScale * foldedPos / magnitudeSq) - uFractalScale;

      float ySq = pos.y * pos.y;
      float zSq = pos.z * pos.z;
      float yz2 = 2.0 * pos.y * pos.z;
      pos.yz = vec2(ySq - zSq, yz2);

      pos = vec3(pos.z, pos.x, pos.y);

      densityAcc += exp(uFractalDecay * abs(dot(pos, anchor)));
    }

    return densityAcc * 0.5;
  }

  vec2 getVolumeBounds(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float discriminant = b * b - c;
    if (discriminant < 0.0) return vec2(-1.0);
    float root = sqrt(discriminant);
    return vec2(-b - root, -b + root);
  }

  vec3 traceEnergy(vec3 origin, vec3 dir, vec2 limits) {
    float currentDepth = limits.x;
    float marchStep = 0.02;
    vec3 finalEnergy = vec3(0.0);
    float fieldVal = 0.0;

    for (int i = 0; i < 48; i++) {
      currentDepth += marchStep * exp(-2.0 * fieldVal);
      if (currentDepth > limits.y) break;

      vec3 samplePoint = origin + currentDepth * dir;
      fieldVal = evaluateStructure(samplePoint);

      float vSq = fieldVal * fieldVal;
      float gradientBlend = smoothstep(0.0, 0.4, fieldVal);
      vec3 currentGradient = mix(uSecondaryColor, uPrimaryColor, gradientBlend);
      vec3 emission = currentGradient * (fieldVal * 1.8 + vSq * 1.0);
      finalEnergy = 0.99 * finalEnergy + (0.08 * uDensity) * emission;
    }

    return finalEnergy;
  }

  void main() {
    vec3 rayOrig = uLocalCamPos;
    vec3 rayDir = normalize(vLocalPosition - uLocalCamPos);

    float t = uTime * 0.1;
    float s = sin(t);
    float c = cos(t);
    mat2 rotXZ = mat2(c, s, -s, c);
    rayOrig.xz *= rotXZ;
    rayDir.xz *= rotXZ;

    vec2 limits = getVolumeBounds(rayOrig, rayDir, 2.0);
    if (limits.x < 0.0) discard;

    vec3 volumeColor = traceEnergy(rayOrig, rayDir, limits);

    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float facingRatio = max(dot(normal, viewDir), 0.0);
    float edgeAA = smoothstep(0.0, 0.05, facingRatio);

    vec3 finalColor = 0.5 * log(1.0 + volumeColor);
    finalColor = clamp(finalColor, 0.0, 1.0);
    finalColor *= edgeAA;

    float maxLuma = max(finalColor.r, max(finalColor.g, finalColor.b));
    float alpha = clamp(maxLuma * 1.5, 0.0, 1.0) * edgeAA;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const atmosphereFragmentShader = `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uLevel;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float vdn = max(dot(normal, viewDir), 0.0);
    float edgeFade = smoothstep(0.0, 0.15, vdn);
    float innerFadePoint = clamp(1.0 - uLevel, 0.0, 0.99);
    float centerFade = smoothstep(1.0, innerFadePoint, vdn);
    float alpha = edgeFade * centerFade * uGlow;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.025 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    varying vec2 vUv;
    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);
      float luma = max(baseColor.r, max(baseColor.g, baseColor.b));
      float mask = smoothstep(0.01, 0.1, luma);
      vec2 offset = (vUv - 0.5) * uAmount;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 aberratedColor = vec3(r, g, b);
      gl_FragColor = vec4(mix(baseColor.rgb, aberratedColor, mask), 1.0);
    }
  `,
};

export default function FractalOrb({ stream, settings }: Props) {
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

    // Audio
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    // Main analyser for smooth visual response
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;

    // Separate analyser for kick detection (minimal smoothing for transient response)
    const kickAnalyser = audioCtx.createAnalyser();
    kickAnalyser.fftSize = 1024;
    kickAnalyser.smoothingTimeConstant = 0.2;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(kickAnalyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Kick detection state
    const kickBufferLength = kickAnalyser.frequencyBinCount;
    const kickFreqData = new Uint8Array(kickBufferLength);
    const prevKickFreqData = new Float32Array(kickBufferLength);
    let lastKickTime = 0;
    let fluxHistory: number[] = [];
    let kickEnergy = 0;
    const KICK_COOLDOWN = 120;
    const FLUX_HISTORY_SIZE = 60;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0, 6);

    // Base colors (Default preset). We re-derive HSL each frame and apply hueShift.
    const basePrimary = new THREE.Color('#00b3ff');
    const baseSecondary = new THREE.Color('#2e9aff');
    const basePrimaryHSL = { h: 0, s: 0, l: 0 };
    const baseSecondaryHSL = { h: 0, s: 0, l: 0 };
    basePrimary.getHSL(basePrimaryHSL);
    baseSecondary.getHSL(baseSecondaryHSL);

    const BASE_DENSITY = 3.0;
    const BASE_GLOW = 0.15;
    const BASE_INTERNAL_ANIM = 0.43;
    const BASE_CA = 0.025;
    const BASE_ROTATION = 0.89;

    const orbUniforms = {
      uTime: { value: 0 },
      uLocalCamPos: { value: new THREE.Vector3() },
      uPrimaryColor: { value: basePrimary.clone() },
      uSecondaryColor: { value: baseSecondary.clone() },
      uDensity: { value: BASE_DENSITY },
      uFractalIters: { value: 4 },
      uFractalScale: { value: 0.97 },
      uFractalDecay: { value: -16.7 },
      uInternalAnim: { value: BASE_INTERNAL_ANIM },
      uSmoothness: { value: 0.031 },
      uAsymmetry: { value: 0.55 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: orbUniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const atmosphereUniforms = {
      uColor: { value: basePrimary.clone() },
      uGlow: { value: BASE_GLOW },
      uLevel: { value: 1.0 },
    };

    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: atmosphereUniforms,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const geometry = new THREE.SphereGeometry(2.0, 64, 64);
    const orb = new THREE.Mesh(geometry, material);
    scene.add(orb);

    const atmosphereMesh = new THREE.Mesh(geometry, atmosphereMaterial);
    atmosphereMesh.scale.set(1.03, 1.03, 1.03);
    orb.add(atmosphereMesh);

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    const caPass = new ShaderPass(ChromaticAberrationShader);
    caPass.uniforms.uAmount.value = BASE_CA;
    composer.addPass(caPass);

    const clock = new THREE.Clock();
    const localCam = new THREE.Vector3();
    const tmpPrimary = new THREE.Color();
    const tmpSecondary = new THREE.Color();
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const now = performance.now();

      // Frequency band analysis (matching AudioDebug Hz-based boundaries)
      analyser.getByteFrequencyData(dataArray);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      const subBassEnd = Math.min(Math.floor(60 / binHz), bufferLength);
      const bassEnd = Math.min(Math.floor(250 / binHz), bufferLength);
      const midEnd = Math.min(Math.floor(2000 / binHz), bufferLength);
      const highMidEnd = Math.min(Math.floor(6000 / binHz), bufferLength);

      const bandEnergy = (start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += dataArray[i];
        return end > start ? (sum / ((end - start) * 255)) : 0;
      };

      const subBass = bandEnergy(0, subBassEnd) * s.sensitivity;
      const bass = bandEnergy(subBassEnd, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highMids = bandEnergy(midEnd, highMidEnd) * s.sensitivity;
      const highs = bandEnergy(highMidEnd, bufferLength) * s.sensitivity;

      // Smooth the values for visual response
      smoothedBass += ((subBass + bass) * 0.5 - smoothedBass) * 0.2;
      smoothedMids += (mids - smoothedMids) * 0.15;
      smoothedHighs += ((highMids + highs) * 0.5 - smoothedHighs) * 0.15;

      // Kick detection using spectral flux (matching AudioDebug algorithm)
      kickAnalyser.getByteFrequencyData(kickFreqData);
      const kickBinHz = sampleRate / kickAnalyser.fftSize;
      const kickBassEnd2 = Math.min(Math.floor(150 / kickBinHz), kickBufferLength);

      let flux = 0;
      for (let i = 1; i < kickBassEnd2; i++) {
        const diff = kickFreqData[i] - prevKickFreqData[i];
        if (diff > 0) flux += diff;
      }
      flux /= kickBassEnd2 * 255;

      for (let i = 0; i < kickBufferLength; i++) {
        prevKickFreqData[i] = kickFreqData[i];
      }

      fluxHistory.push(flux);
      if (fluxHistory.length > FLUX_HISTORY_SIZE) fluxHistory.shift();

      // Adaptive threshold: median + factor * stddev + floor
      const sortedFlux = [...fluxHistory].sort((a, b) => a - b);
      const medianFlux = sortedFlux[Math.floor(sortedFlux.length / 2)] || 0;
      const meanFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
      const stdFlux = Math.sqrt(fluxHistory.reduce((a, b) => a + (b - meanFlux) ** 2, 0) / fluxHistory.length);
      const kickThreshold = medianFlux + stdFlux * 1.2 + 0.02;

      const isKick = flux > kickThreshold && (now - lastKickTime) > KICK_COOLDOWN;
      if (isKick) {
        lastKickTime = now;
        kickEnergy = 1.0;
      }
      // Decay kick energy for visual response
      kickEnergy *= 0.88;

      const delta = clock.getDelta();
      orbUniforms.uTime.value += delta * (0.5 + smoothedMids * 0.6) * s.speed;
      orbUniforms.uDensity.value = BASE_DENSITY * (1.0 + smoothedBass * 0.8 + kickEnergy * 1.5);
      orbUniforms.uInternalAnim.value = BASE_INTERNAL_ANIM * (1.0 + smoothedMids * 1.2);
      atmosphereUniforms.uGlow.value = BASE_GLOW + smoothedBass * 0.6 + kickEnergy * 0.8;
      caPass.uniforms.uAmount.value = BASE_CA + smoothedHighs * 0.04 + kickEnergy * 0.06;

      // Hue shift the base colors
      const hueDelta = s.hueShift / 360;
      tmpPrimary.setHSL((basePrimaryHSL.h + hueDelta) % 1, basePrimaryHSL.s, basePrimaryHSL.l);
      tmpSecondary.setHSL((baseSecondaryHSL.h + hueDelta) % 1, baseSecondaryHSL.s, baseSecondaryHSL.l);
      orbUniforms.uPrimaryColor.value.copy(tmpPrimary);
      orbUniforms.uSecondaryColor.value.copy(tmpSecondary);
      atmosphereUniforms.uColor.value.copy(tmpPrimary);

      // Pulse + scale — kicks cause a visible pop
      const targetScale = s.scale * (1.0 + smoothedBass * 0.08 + kickEnergy * 0.15);
      orb.scale.setScalar(targetScale);

      // Auto-rotation
      const rotSpeed = BASE_ROTATION * s.speed;
      orb.rotation.y += delta * rotSpeed;
      orb.rotation.x += delta * rotSpeed * 0.5;

      orb.updateMatrixWorld();
      localCam.copy(camera.position);
      orb.worldToLocal(localCam);
      orbUniforms.uLocalCamPos.value.copy(localCam);

      composer.render();
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
      atmosphereMaterial.dispose();
      composer.dispose();
      renderer.dispose();
      kickAnalyser.disconnect();
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
