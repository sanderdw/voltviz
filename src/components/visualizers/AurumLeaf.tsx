import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const TENTACLE_COUNT = 8;
const CORE_LINES_PER_TENTACLE = 5;
const GLOW_LINES_PER_TENTACLE = 45;
const POINTS_PER_LINE = 150;
const PARTICLE_COUNT = 3100;

const BASE_CAPSULE_RADIUS = 5.418;
const BASE_CAPSULE_LENGTH = 10.0;
const BASE_CAPSULE_OPACITY = 0.0415;
const BASE_GROUP_SPACING = 4.0;
const BASE_SPREAD = 0.6223;
const BASE_TAPER = 4.248;
const BASE_CURL = 0.2625;
const BASE_WAVE_SPEED = 1.4;
const BASE_WRITHE_AMP = 1.4;
const BASE_PARTICLE_SPEED = 0.735;
const BASE_PARTICLE_ORBIT = 0.33;
const BASE_PARTICLE_SIZE = 0.04802;
const BASE_BLOOM_STRENGTH = 0.264;
const BASE_BLOOM_RADIUS = 0.516;
const BASE_BLOOM_THRESHOLD = 0.2;

const KICK_BLOOM_PEAK = 1.4;
const KICK_PARTICLE_PEAK = 2.5;
const KICK_BLOOM_TAU = 0.18;
const KICK_PARTICLE_TAU = 0.30;
const KICK_COOLDOWN = 120;
const FLUX_HISTORY_SIZE = 60;

type TentacleBase = {
  baseX: number;
  baseZ: number;
  phaseX: number;
  phaseY: number;
  phaseZ: number;
};

type StrandData = {
  line: THREE.Line;
  tentacleIndex: number;
  localOffsetX: number;
  localOffsetZ: number;
  microPhase: number;
};

type ParticleData = {
  tentacleIndex: number;
  t: number;
  speed: number;
  angle: number;
  radiusBase: number;
  orbitSpeed: number;
};

export default function AurumLeaf({ stream, settings }: Props) {
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
    if (w === 0 || h === 0) return;

    // ---- Audio ----
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;

    const kickAnalyser = audioCtx.createAnalyser();
    kickAnalyser.fftSize = 1024;
    kickAnalyser.smoothingTimeConstant = 0.2;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(kickAnalyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    const kickBins = kickAnalyser.frequencyBinCount;
    const kickFreqData = new Uint8Array(kickBins);
    const prevKickFreqData = new Float32Array(kickBins);
    const fluxHistory: number[] = [];
    let lastKickTime = 0;
    let bassSmoothed = 0;
    let bloomImpulse = 0;
    let particleImpulse = 0;

    // ---- Renderer ----
    const DPR = Math.min(window.devicePixelRatio, 1.0) * 0.8;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(DPR);
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    // ---- Scene ----
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.set(0, 0, 25);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // ---- Post-processing ----
    const renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      BASE_BLOOM_STRENGTH,
      BASE_BLOOM_RADIUS,
      BASE_BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // ---- Colors (base HSL cached for hue shifting) ----
    const baseCoreColor = new THREE.Color('#ffd500');
    const baseGlowColor = new THREE.Color('#ffbf52');
    const coreHSL = { h: 0, s: 0, l: 0 };
    const glowHSL = { h: 0, s: 0, l: 0 };
    baseCoreColor.getHSL(coreHSL);
    baseGlowColor.getHSL(glowHSL);
    const tmpCore = new THREE.Color();
    const tmpGlow = new THREE.Color();

    // ---- Materials ----
    const coreLineMaterial = new THREE.LineBasicMaterial({
      color: baseCoreColor.clone(),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowLineMaterial = new THREE.LineBasicMaterial({
      color: baseGlowColor.clone(),
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particleMaterial = new THREE.PointsMaterial({
      color: baseCoreColor.clone(),
      size: BASE_PARTICLE_SIZE,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // ---- Capsule ----
    const capsuleGeometry = new THREE.CapsuleGeometry(
      BASE_CAPSULE_RADIUS,
      BASE_CAPSULE_LENGTH,
      16,
      32,
    );
    const capsuleMaterial = new THREE.MeshPhysicalMaterial({
      color: baseGlowColor.clone(),
      transparent: true,
      opacity: BASE_CAPSULE_OPACITY,
      roughness: 0.15,
      metalness: 1.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
      specularIntensity: 0.0,
      envMapIntensity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const capsuleMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
    masterGroup.add(capsuleMesh);

    // ---- Tentacles ----
    const tentaclesBaseData: TentacleBase[] = [];
    const linesData: StrandData[] = [];
    const linesGroup = new THREE.Group();
    masterGroup.add(linesGroup);

    const createStrand = (tentacleIndex: number, spread: number, material: THREE.LineBasicMaterial) => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(POINTS_PER_LINE * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, material);
      linesGroup.add(line);
      linesData.push({
        line,
        tentacleIndex,
        localOffsetX: (Math.random() - 0.5) * spread,
        localOffsetZ: (Math.random() - 0.5) * spread,
        microPhase: Math.random() * 0.5,
      });
    };

    for (let r = 0; r < TENTACLE_COUNT; r++) {
      tentaclesBaseData.push({
        baseX: (Math.random() - 0.5) * BASE_GROUP_SPACING,
        baseZ: (Math.random() - 0.5) * BASE_GROUP_SPACING,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        phaseZ: Math.random() * Math.PI * 2,
      });
      for (let c = 0; c < CORE_LINES_PER_TENTACLE; c++) createStrand(r, 0.2, coreLineMaterial);
      for (let l = 0; l < GLOW_LINES_PER_TENTACLE; l++) createStrand(r, BASE_SPREAD, glowLineMaterial);
    }

    // ---- Particles ----
    const particlesData: ParticleData[] = [];
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particlesData.push({
        tentacleIndex: Math.floor(Math.random() * TENTACLE_COUNT),
        t: Math.random(),
        speed: (Math.random() * 0.8 + 0.2) * 0.002,
        angle: Math.random() * Math.PI * 2,
        radiusBase: Math.random(),
        orbitSpeed: (Math.random() - 0.5) * 2.0,
      });
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    masterGroup.add(particles);

    // ---- Tentacle position helper ----
    const totalHeight = BASE_CAPSULE_LENGTH + BASE_CAPSULE_RADIUS * 2;
    const startY = -totalHeight / 2 + 0.5;
    const endY = totalHeight / 2 - 0.5;
    const lineLength = endY - startY;

    const getTentaclePosition = (
      tentacleIndex: number,
      t: number,
      time: number,
      microPhase: number,
      writheAmp: number,
      waveSpeed: number,
      out: { x: number; y: number; z: number },
    ) => {
      const base = tentaclesBaseData[tentacleIndex];
      const y = startY + t * lineLength;
      const activePhase = microPhase * Math.min(t * 5.0, 1.0);
      const timePhase = (time + activePhase) * waveSpeed;
      const curl = y * BASE_CURL;
      const yEnvelope = Math.sin(t * Math.PI);

      const xOffset =
        Math.sin(curl + timePhase + base.phaseX) * writheAmp +
        Math.sin(curl * 0.5 - timePhase * 0.7 + base.phaseY) * (writheAmp * 0.5);
      const zOffset =
        Math.cos(curl * 0.8 + timePhase * 1.1 + base.phaseZ) * writheAmp +
        Math.cos(curl * 0.4 - timePhase * 0.5 + base.phaseX) * (writheAmp * 0.5);

      out.x = (base.baseX + xOffset) * yEnvelope;
      out.y = y;
      out.z = (base.baseZ + zOffset) * yEnvelope;
    };

    // ---- Animation loop ----
    const clock = new THREE.Clock();
    let elapsed = 0;
    const posOut = { x: 0, y: 0, z: 0 };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const now = performance.now();
      const dt = Math.min(clock.getDelta(), 0.1);
      elapsed += dt;

      // --- Audio: bass band (60-250Hz) ---
      analyser.getByteFrequencyData(freqData);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;
      const bassLo = Math.max(1, Math.floor(60 / binHz));
      const bassHi = Math.min(Math.ceil(250 / binHz), freqBins);
      let bassSum = 0;
      for (let i = bassLo; i < bassHi; i++) bassSum += freqData[i];
      const bassRaw = bassHi > bassLo ? bassSum / ((bassHi - bassLo) * 255) : 0;
      bassSmoothed += (bassRaw - bassSmoothed) * 0.15;

      // --- Audio: spectral-flux kick detection over bass range ---
      kickAnalyser.getByteFrequencyData(kickFreqData);
      const kickBinHz = sampleRate / kickAnalyser.fftSize;
      const kickLo = Math.max(1, Math.floor(60 / kickBinHz));
      const kickHi = Math.min(Math.ceil(250 / kickBinHz), kickBins);
      const kickRange = Math.max(1, kickHi - kickLo);
      let flux = 0;
      for (let i = kickLo; i < kickHi; i++) {
        const diff = kickFreqData[i] - prevKickFreqData[i];
        if (diff > 0) flux += diff;
      }
      flux /= kickRange * 255;
      for (let i = 0; i < kickBins; i++) prevKickFreqData[i] = kickFreqData[i];

      fluxHistory.push(flux);
      if (fluxHistory.length > FLUX_HISTORY_SIZE) fluxHistory.shift();
      const meanFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
      const stdFlux = Math.sqrt(
        fluxHistory.reduce((a, b) => a + (b - meanFlux) ** 2, 0) / fluxHistory.length,
      );
      const sortedFlux = [...fluxHistory].sort((a, b) => a - b);
      const medianFlux = sortedFlux[Math.floor(sortedFlux.length / 2)] || 0;
      const kickThreshold = medianFlux + stdFlux * 1.2 + 0.02;

      const isKick = flux > kickThreshold && now - lastKickTime > KICK_COOLDOWN;
      if (isKick) {
        lastKickTime = now;
        bloomImpulse = KICK_BLOOM_PEAK - BASE_BLOOM_STRENGTH;
        particleImpulse = KICK_PARTICLE_PEAK - BASE_PARTICLE_SPEED;
      }
      bloomImpulse *= Math.exp(-dt / KICK_BLOOM_TAU);
      particleImpulse *= Math.exp(-dt / KICK_PARTICLE_TAU);

      // --- Effective parameters ---
      const effectiveWriteAmp = BASE_WRITHE_AMP + bassSmoothed * s.sensitivity * 3.5;
      const effectiveWaveSpeed = BASE_WAVE_SPEED * s.speed;
      const effectiveParticleSpeed =
        (BASE_PARTICLE_SPEED + particleImpulse * s.sensitivity) * s.speed;
      bloomPass.strength = BASE_BLOOM_STRENGTH + bloomImpulse * s.sensitivity;

      // --- Hue shift (reset-and-rotate to avoid offsetHSL compounding) ---
      const hueDelta = s.hueShift / 360;
      tmpCore.setHSL(((coreHSL.h + hueDelta) % 1 + 1) % 1, coreHSL.s, coreHSL.l);
      tmpGlow.setHSL(((glowHSL.h + hueDelta) % 1 + 1) % 1, glowHSL.s, glowHSL.l);
      coreLineMaterial.color.copy(tmpCore);
      particleMaterial.color.copy(tmpCore);
      glowLineMaterial.color.copy(tmpGlow);
      capsuleMaterial.color.copy(tmpGlow);

      // --- Scale & auto-rotate ---
      masterGroup.scale.setScalar(s.scale);
      masterGroup.rotation.y += dt * 0.14;

      // --- Update lines ---
      for (let d = 0; d < linesData.length; d++) {
        const data = linesData[d];
        const positions = (data.line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        for (let i = 0; i < POINTS_PER_LINE; i++) {
          const t = i / (POINTS_PER_LINE - 1);
          getTentaclePosition(
            data.tentacleIndex,
            t,
            elapsed,
            data.microPhase,
            effectiveWriteAmp,
            effectiveWaveSpeed,
            posOut,
          );
          const bottomTaper = Math.min(Math.pow(t * BASE_TAPER, 2.0), 1.0);
          const topTaper = Math.min(Math.pow((1.0 - t) * BASE_TAPER, 2.0), 1.0);
          const groupTaper = bottomTaper * topTaper;
          positions[i * 3] = posOut.x + data.localOffsetX * groupTaper;
          positions[i * 3 + 1] = posOut.y;
          positions[i * 3 + 2] = posOut.z + data.localOffsetZ * groupTaper;
        }
        data.line.geometry.attributes.position.needsUpdate = true;
      }

      // --- Update particles ---
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particlesData[i];
        p.t -= p.speed * effectiveParticleSpeed;
        if (p.t < 0.0) {
          p.t = 1.0;
          p.tentacleIndex = Math.floor(Math.random() * TENTACLE_COUNT);
        }
        getTentaclePosition(
          p.tentacleIndex,
          p.t,
          elapsed,
          0,
          effectiveWriteAmp,
          effectiveWaveSpeed,
          posOut,
        );
        p.angle += p.orbitSpeed * 0.02;
        const bottomTaper = Math.min(Math.pow(p.t * BASE_TAPER, 2.0), 1.0);
        const topTaper = Math.min(Math.pow((1.0 - p.t) * BASE_TAPER, 2.0), 1.0);
        const groupTaper = bottomTaper * topTaper;
        const yEnvelope = Math.sin(p.t * Math.PI);
        const currentRadius = p.radiusBase * BASE_PARTICLE_ORBIT * yEnvelope * groupTaper;
        particlePositions[i * 3] = posOut.x + Math.sin(p.angle) * currentRadius;
        particlePositions[i * 3 + 1] = posOut.y;
        particlePositions[i * 3 + 2] = posOut.z + Math.cos(p.angle) * currentRadius;
      }
      particleGeometry.attributes.position.needsUpdate = true;

      composer.render();
    };
    draw();

    // ---- Resize ----
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // ---- Cleanup ----
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      if (sourceRef.current) sourceRef.current.disconnect();
      kickAnalyser.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      capsuleGeometry.dispose();
      capsuleMaterial.dispose();
      for (const data of linesData) data.line.geometry.dispose();
      coreLineMaterial.dispose();
      glowLineMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      bloomPass.dispose();
      composer.dispose();
      renderTarget.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
