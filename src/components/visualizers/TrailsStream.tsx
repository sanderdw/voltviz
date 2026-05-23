import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const LINES_COUNT = 100;
const TUBE_TUBULAR_SEGMENTS = 200;
const TUBE_RADIAL_SEGMENTS = 8;

const BASE_EXPOSURE = 3.6505;
const BASE_BRIGHTNESS = 4.0131;
const BASE_BLOOM_STRENGTH = 0.20;
const MAX_BLOOM_STRENGTH = 0.40;
const BASE_BLOOM_RADIUS = 0.294;
const BASE_BLOOM_THRESHOLD = 0.0;
const BASE_BLUR_STRENGTH = 3.5;
const BASE_GLOBAL_SPEED = 0.1;

const DOT_DENSITY = 70;
const DOT_SIZE = 0.25;
const DOT_SPEED = 1.5;

const ARC_RADIUS = 10.0;
const BEND_START_Z = -150.0;
const FLOOR_LENGTH = 132.75;
const WALL_HEIGHT = 200.0;

const BASE_CAM_Z = 140;
const BASE_CAM_Y = 20;

const PALETTE = ['#004c94', '#2e89ff', '#003994', '#004bad', '#ff5900'];

class CycCurve extends THREE.Curve<THREE.Vector3> {
  x: number;
  zStart: number;
  zBend: number;
  radius: number;
  yEnd: number;
  L_flat: number;
  L_arc: number;
  L_up: number;
  totalLength: number;

  constructor(x: number, zStart: number, zBend: number, radius: number, yEnd: number) {
    super();
    this.x = x;
    this.zStart = zStart;
    this.zBend = zBend;
    this.radius = radius;
    this.yEnd = yEnd;
    this.L_flat = Math.abs(zStart - (zBend + radius));
    this.L_arc = (Math.PI * radius) * 0.5;
    this.L_up = Math.max(0.1, yEnd - radius);
    this.totalLength = this.L_flat + this.L_arc + this.L_up;
  }

  getPoint(t: number, optionalTarget: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const d = t * this.totalLength;
    let py = 0;
    let pz = 0;
    if (d <= this.L_flat) {
      pz = this.zStart - d;
    } else if (d <= this.L_flat + this.L_arc) {
      const norm = (d - this.L_flat) / this.L_arc;
      const eased = norm * norm * (3.0 - 2.0 * norm);
      const angle = (norm * 0.4 + eased * 0.6) * (Math.PI * 0.5);
      py = this.radius * (1.0 - Math.cos(angle));
      pz = (this.zBend + this.radius) - Math.sin(angle) * this.radius;
    } else {
      py = this.radius + (d - (this.L_flat + this.L_arc));
      pz = this.zBend;
    }
    return optionalTarget.set(this.x, py, pz);
  }
}

const trailVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vUv = uv;
    vNormal = normalMatrix * normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const trailFragmentShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSpeed;
  uniform float uOffset;
  uniform float uTailLength;
  uniform float uIntensityMultiplier;
  uniform float uBendUv;
  uniform float uIsReflection;
  uniform float uDotDensity;
  uniform float uDotSize;
  uniform float uDotSpeed;
  uniform float uBrightness;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    float t = fract(uTime * uSpeed + uOffset);
    float dist = fract(t - vUv.x + 1.0);

    float baseAlpha = smoothstep(uTailLength, 0.0, dist);
    baseAlpha = pow(max(0.0, baseAlpha), 1.2);

    vec3 viewDir = normalize(vViewPosition);
    float fresnel = abs(dot(normalize(vNormal), viewDir));
    float edgeSoftness = smoothstep(0.0, 0.02, fresnel);
    baseAlpha *= edgeSoftness;

    float core = pow(max(0.0, baseAlpha), 3.0) * 1.5;

    float movingUV = vUv.x - (uTime * uSpeed * uDotSpeed) - uOffset;
    float signalPos = movingUV * uDotDensity;
    float dotId = floor(signalPos);
    float dotLocal = fract(signalPos);

    float distToCenter = length(vec2((dotLocal - 0.5) * 2.0, (fract(vUv.y + 0.5) - 0.5) * 6.0));
    float dotShape = 1.0 - smoothstep(0.0, max(0.001, uDotSize), distToCenter);
    float dotFinal = dotShape * step(0.6, hash(vec2(dotId, uOffset))) * (sin(uTime * 4.0 + hash(vec2(dotId)) * 6.28) * 0.3 + 0.7) * baseAlpha;

    if (uIsReflection > 0.5) {
      float refFade = 1.0 - smoothstep(uBendUv - 0.015, uBendUv, vUv.x);
      baseAlpha *= refFade;
      core *= refFade;
      dotFinal *= refFade * 0.1;
      baseAlpha = pow(max(0.0, baseAlpha), 0.5) * (0.7 + hash(vUv * 300.0 + uTime * 0.05) * 0.3);
      core *= 0.3;
    }

    vec3 trailColor = uColor * (baseAlpha + core * 1.5) * uIntensityMultiplier * uBrightness;
    vec3 rgb = trailColor / max(1.0 - clamp(dotFinal * 1.8, 0.0, 0.95), 0.001) + uColor * dotFinal * 2.5 * uIntensityMultiplier * uBrightness;

    gl_FragColor = vec4(rgb, (baseAlpha + dotFinal) * uIntensityMultiplier);
  }
`;

const foregroundBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    blurStrength: { value: BASE_BLUR_STRENGTH },
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
    uniform vec2 resolution;
    uniform float blurStrength;
    varying vec2 vUv;
    void main() {
      float mask = 1.0 - smoothstep(0.0, 0.35, vUv.y);
      float radius = mask * blurStrength;
      if (radius < 0.1) {
        gl_FragColor = texture2D(tDiffuse, vUv);
      } else {
        vec4 color = vec4(0.0);
        float total = 0.0;
        const float GA = 2.3999632;
        for (int i = 0; i < 32; i++) {
          float f = float(i);
          float r = sqrt(f) * radius;
          float theta = f * GA;
          vec2 offset = vec2(cos(theta), sin(theta)) * (r / resolution);
          color += texture2D(tDiffuse, vUv + offset);
          total += 1.0;
        }
        gl_FragColor = color / total;
      }
    }
  `,
};

type TrailUniforms = {
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uColorIndex: { value: number };
  uSpeed: { value: number };
  uOffset: { value: number };
  uTailLength: { value: number };
  uIntensityMultiplier: { value: number };
  uBendUv: { value: number };
  uIsReflection: { value: number };
  uDotDensity: { value: number };
  uDotSize: { value: number };
  uDotSpeed: { value: number };
  uBrightness: { value: number };
};

export default function TrailsStream({ stream, settings }: Props) {
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
    analyser.smoothingTimeConstant = 0.75;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    let smoothedSubBass = 0;
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;

    // ---- Renderer ----
    const DPR = 1.6;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = BASE_EXPOSURE;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    // ---- Scene & camera ----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(55, w / h, 1, 2000);
    camera.position.set(0, BASE_CAM_Y, BASE_CAM_Z);
    camera.lookAt(0, BASE_CAM_Y, -50);

    // ---- Post-processing ----
    const renderTarget = new THREE.WebGLRenderTarget(w * DPR, h * DPR, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.setPixelRatio(DPR);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      BASE_BLOOM_STRENGTH,
      BASE_BLOOM_RADIUS,
      BASE_BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);
    const blurPass = new ShaderPass(foregroundBlurShader);
    blurPass.uniforms.resolution.value.set(w * DPR, h * DPR);
    composer.addPass(blurPass);
    composer.addPass(new OutputPass());

    // ---- Cached base palette HSL for hue rotation ----
    const baseColors = PALETTE.map(hex => new THREE.Color(hex));
    const baseHSL = baseColors.map(c => {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      return hsl;
    });
    const tmpColor = new THREE.Color();

    // ---- Floor (bent plane) ----
    const buildFloorGeometry = () => {
      const floorGeo = new THREE.PlaneGeometry(1000, 1000, 1, 1500);
      floorGeo.rotateX(-Math.PI * 0.5);
      const pos = floorGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 2] < BEND_START_Z) {
          const d = BEND_START_Z - pos[i + 2];
          const maxA = ARC_RADIUS * Math.PI * 0.5;
          if (d < maxA) {
            const n = d / maxA;
            const a = (n * 0.4 + (n * n * (3.0 - 2.0 * n)) * 0.6) * (Math.PI * 0.5);
            pos[i + 1] = ARC_RADIUS * (1.0 - Math.cos(a));
            pos[i + 2] = BEND_START_Z - Math.sin(a) * ARC_RADIUS;
          } else {
            pos[i + 1] = ARC_RADIUS + (d - maxA);
            pos[i + 2] = BEND_START_Z - ARC_RADIUS;
          }
        }
      }
      floorGeo.computeVertexNormals();
      return floorGeo;
    };

    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(buildFloorGeometry(), floorMat);
    floorMesh.position.set(0, -0.5, -0.5);
    floorMesh.renderOrder = 1;
    scene.add(floorMesh);

    // ---- Trails ----
    const trailsGroup = new THREE.Group();
    scene.add(trailsGroup);

    const bendUv =
      Math.abs(FLOOR_LENGTH - BEND_START_Z) /
      (Math.abs(FLOOR_LENGTH - BEND_START_Z) + (Math.PI * ARC_RADIUS) * 0.5 + Math.max(0.1, WALL_HEIGHT - ARC_RADIUS));

    type TrailEntry = {
      mainMat: THREE.ShaderMaterial;
      refMat: THREE.ShaderMaterial;
      mainGeo: THREE.TubeGeometry;
      refGeo: THREE.TubeGeometry;
      colorIdx: number;
      baseTailLength: number;
    };
    const trails: TrailEntry[] = [];

    for (let i = 0; i < LINES_COUNT; i++) {
      const normIdx = (i / (LINES_COUNT - 1)) * 2 - 1;
      const linearPos = normIdx;
      const expPos = Math.sign(normIdx) * Math.pow(Math.abs(normIdx), 1.2);
      let startX = (linearPos * 0.5 + expPos * 0.5) * 80;
      startX += (Math.random() - 0.5) * 2.0;

      const thickness = Math.random() * 0.2 + 0.1;
      const colorIdx = Math.floor(Math.random() * PALETTE.length);
      const baseTailLength = Math.random() * 0.4 + 0.3;

      const uniforms: TrailUniforms = {
        uTime: { value: 0 },
        uColor: { value: baseColors[colorIdx].clone() },
        uColorIndex: { value: colorIdx },
        uSpeed: { value: Math.random() * 0.5 + 0.2 },
        uOffset: { value: Math.random() },
        uTailLength: { value: baseTailLength },
        uIntensityMultiplier: { value: 1.0 },
        uBendUv: { value: bendUv },
        uIsReflection: { value: 0.0 },
        uDotDensity: { value: DOT_DENSITY },
        uDotSize: { value: DOT_SIZE },
        uDotSpeed: { value: DOT_SPEED },
        uBrightness: { value: BASE_BRIGHTNESS },
      };

      const material = new THREE.ShaderMaterial({
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        uniforms: uniforms as unknown as { [k: string]: THREE.IUniform },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const path = new CycCurve(startX, FLOOR_LENGTH, BEND_START_Z - ARC_RADIUS, ARC_RADIUS, WALL_HEIGHT);
      const tubeGeo = new THREE.TubeGeometry(path, TUBE_TUBULAR_SEGMENTS, thickness, TUBE_RADIAL_SEGMENTS, false);

      const mesh = new THREE.Mesh(tubeGeo, material);

      const refMaterial = material.clone();
      refMaterial.uniforms.uIntensityMultiplier.value = 0.4;
      refMaterial.uniforms.uIsReflection.value = 1.0;
      const refTubeGeo = new THREE.TubeGeometry(path, TUBE_TUBULAR_SEGMENTS, thickness, TUBE_RADIAL_SEGMENTS, false);
      const refMesh = new THREE.Mesh(refTubeGeo, refMaterial);
      refMesh.scale.y = -1;
      refMesh.position.y = -1.0;

      trailsGroup.add(mesh, refMesh);
      trails.push({
        mainMat: material,
        refMat: refMaterial,
        mainGeo: tubeGeo,
        refGeo: refTubeGeo,
        colorIdx,
        baseTailLength,
      });
    }

    // ---- Animation loop ----
    const clock = new THREE.Clock();
    let globalTime = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const dt = Math.min(clock.getDelta(), 0.1);

      // --- 5-band energies (sensitivity baked at source) ---
      analyser.getByteFrequencyData(freqData);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;
      const subBassEnd = Math.min(Math.floor(60 / binHz), freqBins);
      const bassEnd = Math.min(Math.floor(250 / binHz), freqBins);
      const midEnd = Math.min(Math.floor(2000 / binHz), freqBins);
      const highMidEnd = Math.min(Math.floor(6000 / binHz), freqBins);

      const bandEnergy = (start: number, end: number) => {
        if (end <= start) return 0;
        let sum = 0;
        for (let i = start; i < end; i++) sum += freqData[i];
        return sum / ((end - start) * 255);
      };

      const subBass = bandEnergy(0, subBassEnd) * s.sensitivity;
      const bass = bandEnergy(subBassEnd, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highMids = bandEnergy(midEnd, highMidEnd) * s.sensitivity;
      const highs = bandEnergy(highMidEnd, freqBins) * s.sensitivity;

      smoothedSubBass += (subBass - smoothedSubBass) * 0.25;
      smoothedBass += (bass - smoothedBass) * 0.20;
      smoothedMids += (mids - smoothedMids) * 0.15;
      smoothedHighs += ((highMids + highs) * 0.5 - smoothedHighs) * 0.15;

      // Bass boosts forward flow
      globalTime += dt * BASE_GLOBAL_SPEED * s.speed * (1 + smoothedBass * 2.5);

      // --- Effective values ---
      bloomPass.strength = Math.min(MAX_BLOOM_STRENGTH, BASE_BLOOM_STRENGTH + smoothedSubBass * 0.20);
      const brightness = BASE_BRIGHTNESS * (1 + smoothedSubBass * 0.9);
      const dotSpeed = DOT_SPEED * (1 + smoothedHighs * 2.5);
      const dotSize = DOT_SIZE * (1 + smoothedBass * 0.6);
      const tailLengthMul = 1 + smoothedMids * 0.9;

      // --- Hue-shifted palette this frame ---
      const hueDelta = s.hueShift / 360;
      const shifted: THREE.Color[] = baseHSL.map((hsl) => {
        tmpColor.setHSL(((hsl.h + hueDelta) % 1 + 1) % 1, hsl.s, hsl.l);
        return tmpColor.clone();
      });

      // --- Push to every trail uniform ---
      for (let i = 0; i < trails.length; i++) {
        const t = trails[i];
        const main = t.mainMat.uniforms;
        const ref = t.refMat.uniforms;
        const tailLen = Math.min(0.95, t.baseTailLength * tailLengthMul);
        main.uTime.value = globalTime;
        ref.uTime.value = globalTime;
        main.uBrightness.value = brightness;
        ref.uBrightness.value = brightness;
        main.uDotSpeed.value = dotSpeed;
        ref.uDotSpeed.value = dotSpeed;
        main.uDotSize.value = dotSize;
        ref.uDotSize.value = dotSize;
        main.uTailLength.value = tailLen;
        ref.uTailLength.value = tailLen;
        main.uColor.value.copy(shifted[t.colorIdx]);
        ref.uColor.value.copy(shifted[t.colorIdx]);
      }

      // --- Camera dolly from scale ---
      const clampedScale = Math.max(0.25, Math.min(4.0, s.scale));
      camera.position.z = BASE_CAM_Z / clampedScale;
      camera.lookAt(0, BASE_CAM_Y, -50);

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
      blurPass.uniforms.resolution.value.set(width * DPR, height * DPR);
    };
    window.addEventListener('resize', handleResize);

    // ---- Cleanup ----
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      floorMesh.geometry.dispose();
      floorMat.dispose();
      for (const t of trails) {
        t.mainGeo.dispose();
        t.refGeo.dispose();
        t.mainMat.dispose();
        t.refMat.dispose();
      }
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
