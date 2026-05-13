import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

// Adapted from https://github.com/ledhieu/imoss (MIT) — shaders kept as-is,
// host code rewritten to plain Three.js with audio-reactive uniforms.

const vertexShader = `
  uniform float uTime;
  uniform float uWindSpeed;
  uniform float uWindAmplitude;
  uniform float uLengthMultiplier;
  uniform float uClumpStrength;
  uniform float uMotionClumpBoost;

  attribute vec3 aBasePos;
  attribute vec3 aNormal;
  attribute vec3 aTangent;
  attribute vec3 aBitangent;
  attribute vec2 aBendState;
  attribute float aHeightScale;
  attribute float aLengthScale;

  varying float vHeight;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vLengthScale;

  void main() {
    vec3 pos = position;
    float t = uv.y;
    vHeight = t;

    float taper = 1.0 - t * 0.82;
    pos.x *= taper;
    pos.z *= taper;

    pos.y *= aHeightScale * aLengthScale * uLengthMultiplier;

    float strandThin = 0.5 - smoothstep(1.5, 3.5, aLengthScale * uLengthMultiplier) * 0.7;
    pos.x *= strandThin;
    pos.z *= strandThin;

    float w1 = sin(aBasePos.x * 2.0 + aBasePos.y * 1.5 + uTime * uWindSpeed);
    float w2 = cos(aBasePos.z * 1.8 + uTime * uWindSpeed * 0.7);
    float windX = (w1 + w2) * uWindAmplitude * 0.5;
    float windZ = (w1 - w2) * uWindAmplitude * 0.3;

    float bendFactor = pow(t, 1.8);

    float totalClump = uClumpStrength + uMotionClumpBoost;
    float clumpX = sin(aBasePos.x * 4.0 + aBasePos.z * 2.0) * totalClump;
    float clumpZ = cos(aBasePos.z * 4.0 + aBasePos.x * 2.0) * totalClump;

    float dx = (aBendState.x + windX + clumpX) * bendFactor;
    float dz = (aBendState.y + windZ + clumpZ) * bendFactor;

    float origLenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
    float newX = pos.x + dx;
    float newZ = pos.z + dz;
    float newLenSq = newX * newX + pos.y * pos.y + newZ * newZ;
    float lenScale = sqrt(origLenSq / max(newLenSq, 0.0001));
    pos.x = newX * lenScale;
    pos.y = pos.y * lenScale;
    pos.z = newZ * lenScale;

    vec3 orientedPos = aTangent * pos.x + aNormal * pos.y + aBitangent * pos.z;
    vec3 worldPos = aBasePos + orientedPos;
    vWorldPos = worldPos;
    vNormal = normalize((modelMatrix * vec4(aNormal, 0.0)).xyz);
    vLengthScale = aLengthScale;

    vec4 viewPos = modelViewMatrix * vec4(worldPos, 1.0);
    vViewPos = viewPos.xyz;
    gl_Position = projectionMatrix * viewPos;
  }
`;

const fragmentShader = `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform vec3 uFogColor;
  uniform float uFogStart;
  uniform float uFogEnd;

  varying float vHeight;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vLengthScale;

  void main() {
    float t = vHeight;
    float shade = smoothstep(0.0, 0.85, t);
    vec3 color = mix(uBaseColor, uTipColor, shade);

    float longFactor = smoothstep(1.0, 3.5, vLengthScale);
    color *= 1.0 + longFactor * 0.35;

    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    vec3 topLightDir = normalize(vec3(0.0, 1.0, -0.35));
    float topDiff = dot(normal, topLightDir) * 0.5 + 0.5;
    vec3 topLight = vec3(1.0, 0.92, 0.72) * topDiff * 1.15;

    float backDiff = (-normal.z) * 0.5 + 0.5;
    vec3 backLight = vec3(0.88, 0.80, 0.60) * backDiff * 1.20;

    float rim = 1.0 - abs(dot(normal, viewDir));
    vec3 rimLight = vec3(0.75, 0.68, 0.50) * pow(rim, 3.0) * 1.20;

    float rawLight = topDiff * 1.15 + backDiff * 0.90 + pow(rim, 3.0) * 0.70;
    float lightLevel = rawLight / 2.75;
    vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(color, gray * 0.18, smoothstep(0.5, 0.0, lightLevel) * 0.75);
    color = mix(color, vec3(1.0, 0.88, 0.22), smoothstep(0.20, 0.75, lightLevel) * 0.30);
    float backLit = smoothstep(0.55, 0.95, backDiff) * smoothstep(0.2, 0.7, rim);
    color = mix(color, vec3(1.0, 0.78, 0.12), backLit * 0.45);

    float frontFacing = normal.z * 0.5 + 0.5;
    float noBackLight = 1.0 - smoothstep(0.0, 0.5, backDiff);
    color *= mix(1.0, 0.35, frontFacing * noBackLight * 0.15);

    float isLong = step(1.0, vLengthScale);
    float radialDist = length(vWorldPos);
    float centerMask = (1.0 - smoothstep(2.5, 6.0, radialDist)) * (1.0 - isLong);
    color *= mix(1.0, 0.82, centerMask);
    vec3 lum = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(lum, color, 1.0 + centerMask * 0.2);

    vec3 ambient = vec3(0.08);
    vec3 lighting = ambient + topLight + backLight + rimLight;

    vec3 litColor = color * lighting;

    float glow = smoothstep(0.55, 0.95, lightLevel);
    float multiplier = 1.5;
    vec3 subsurface = vec3(1.0, 0.78, 0.3) * glow * multiplier;
    litColor += subsurface;

    litColor *= 1.0 + longFactor * 0.6;

    float dist = length(vViewPos);
    float fogFactor = smoothstep(uFogStart, uFogEnd, dist);
    litColor = mix(litColor, uFogColor, fogFactor);

    float alpha = step(0.03, t);
    gl_FragColor = vec4(litColor, alpha);
  }
`;

const BLADE_COUNT = 50000;
const SPHERE_RADIUS = 3;
const BG_COLOR = 0x050810;

function createBladeGeometry() {
  const segs = 6;
  const W = 0.1;
  const H = 0.4;
  const verts: number[] = [];
  const norms: number[] = [];
  const uvArr: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * H;
    const hw = W * 0.5 * (1.0 - t * 0.82);
    verts.push(-hw, y, 0, hw, y, 0);
    norms.push(0, 0, 1, 0, 0, 1);
    uvArr.push(0, t, 1, t);
  }
  for (let i = 0; i < segs; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  geo.setIndex(idx);
  return geo;
}

function noise3D(x: number, y: number, z: number) {
  return (
    Math.sin(x * 1.7 + y * 0.3) * Math.cos(y * 1.3 + z * 0.7) * 0.5 +
    Math.sin(z * 0.9 + x * 1.1) * 0.3
  ) + 0.5;
}

export default function MossBall({ stream, settings }: Props) {
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
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);

    // Base/tip colors → HSL so we can hue-shift live
    const baseColor = new THREE.Color('#1a5a0e');
    const tipColor = new THREE.Color('#8fcc4f');
    const baseHSL = { h: 0, s: 0, l: 0 };
    const tipHSL = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(baseHSL);
    tipColor.getHSL(tipHSL);

    const uniforms = {
      uTime: { value: 0 },
      uWindSpeed: { value: 1.2 },
      uWindAmplitude: { value: 0.25 },
      uLengthMultiplier: { value: 1.2 },
      uClumpStrength: { value: 0.4 },
      uMotionClumpBoost: { value: 0.0 },
      uBaseColor: { value: baseColor.clone() },
      uTipColor: { value: tipColor.clone() },
      uFogColor: { value: new THREE.Color(BG_COLOR) },
      uFogStart: { value: 15.0 },
      uFogEnd: { value: 40.0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      alphaTest: 0.05,
      uniforms,
    });

    const bladeGeo = createBladeGeometry();
    const mesh = new THREE.InstancedMesh(bladeGeo, material, BLADE_COUNT);
    mesh.frustumCulled = false;

    // Per-blade attributes
    const basePosArr = new Float32Array(BLADE_COUNT * 3);
    const normalArr = new Float32Array(BLADE_COUNT * 3);
    const tangentArr = new Float32Array(BLADE_COUNT * 3);
    const bitangentArr = new Float32Array(BLADE_COUNT * 3);
    const bendStateArr = new Float32Array(BLADE_COUNT * 2);
    const heightScaleArr = new Float32Array(BLADE_COUNT);
    const lengthScaleArr = new Float32Array(BLADE_COUNT);

    for (let i = 0; i < BLADE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      let x = SPHERE_RADIUS * sinPhi * Math.cos(theta);
      let y = SPHERE_RADIUS * sinPhi * Math.sin(theta);
      let z = SPHERE_RADIUS * cosPhi;

      const flowAngle = noise3D(x * 0.22 + 100, y * 0.22 + 200, z * 0.22 + 300) * Math.PI * 2;
      const lockStrengthNoise = noise3D(x * 0.55 + 400, y * 0.45 + 500, z * 0.65 + 600);
      const lockStrength = Math.max(0, (lockStrengthNoise - 0.22) * 2.2);
      const detailAngle = noise3D(x * 0.9 + 700, y * 0.9 + 800, z * 0.9 + 900) * Math.PI * 2;
      const detailStrength = Math.max(0, (noise3D(x * 0.9 + 1000, y * 0.9 + 1100, z * 0.9 + 1200) - 0.4) * 1.3);
      const finalFlowAngle = flowAngle + detailAngle * detailStrength * 0.4;
      const randomRot = Math.random() * Math.PI * 2;
      const blend = lockStrength * 0.78;
      let rotAngle = randomRot * (1 - blend) + finalFlowAngle * blend;
      rotAngle += (Math.random() - 0.5) * 0.30 * (1 - lockStrength);

      const jitter = 0.08 * lockStrength;
      if (jitter > 0.002) {
        x += (Math.random() - 0.5) * jitter;
        y += (Math.random() - 0.5) * jitter;
        z += (Math.random() - 0.5) * jitter;
        const len = Math.sqrt(x * x + y * y + z * z);
        x = (x / len) * SPHERE_RADIUS;
        y = (y / len) * SPHERE_RADIUS;
        z = (z / len) * SPHERE_RADIUS;
      }

      const idx3 = i * 3;
      basePosArr[idx3] = x;
      basePosArr[idx3 + 1] = y;
      basePosArr[idx3 + 2] = z;

      const normal = new THREE.Vector3(x, y, z).normalize();
      normalArr[idx3] = normal.x;
      normalArr[idx3 + 1] = normal.y;
      normalArr[idx3 + 2] = normal.z;

      const arbitrary = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const tangentBase = new THREE.Vector3().crossVectors(arbitrary, normal).normalize();
      const bitangentBase = new THREE.Vector3().crossVectors(normal, tangentBase);
      const cosR = Math.cos(rotAngle);
      const sinR = Math.sin(rotAngle);
      const tangent = new THREE.Vector3()
        .addScaledVector(tangentBase, cosR)
        .addScaledVector(bitangentBase, sinR)
        .normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

      tangentArr[idx3] = tangent.x;
      tangentArr[idx3 + 1] = tangent.y;
      tangentArr[idx3 + 2] = tangent.z;
      bitangentArr[idx3] = bitangent.x;
      bitangentArr[idx3 + 1] = bitangent.y;
      bitangentArr[idx3 + 2] = bitangent.z;

      const equatorFactor = sinPhi;
      const heightVar = 1.2 + Math.random() * 1.3;
      heightScaleArr[i] = heightVar * (0.4 + 0.6 * equatorFactor);

      const isLongStrand = Math.random() < 0.0008;
      lengthScaleArr[i] = isLongStrand ? 1 + Math.random() * 1.2 : 0.5 + Math.random() * 0.5;
    }

    bladeGeo.setAttribute('aBasePos', new THREE.InstancedBufferAttribute(basePosArr, 3));
    bladeGeo.setAttribute('aNormal', new THREE.InstancedBufferAttribute(normalArr, 3));
    bladeGeo.setAttribute('aTangent', new THREE.InstancedBufferAttribute(tangentArr, 3));
    bladeGeo.setAttribute('aBitangent', new THREE.InstancedBufferAttribute(bitangentArr, 3));
    bladeGeo.setAttribute('aBendState', new THREE.InstancedBufferAttribute(bendStateArr, 2));
    bladeGeo.setAttribute('aHeightScale', new THREE.InstancedBufferAttribute(heightScaleArr, 1));
    bladeGeo.setAttribute('aLengthScale', new THREE.InstancedBufferAttribute(lengthScaleArr, 1));

    const dummy = new THREE.Object3D();
    for (let i = 0; i < BLADE_COUNT; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;

    // Inner dark sphere fills any gaps between blades
    const darkGeo = new THREE.SphereGeometry(SPHERE_RADIUS - 0.05, 64, 64);
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x0a1a06 });
    const darkSphere = new THREE.Mesh(darkGeo, darkMat);

    const ballGroup = new THREE.Group();
    ballGroup.add(mesh);
    ballGroup.add(darkSphere);
    scene.add(ballGroup);

    const tmpBase = new THREE.Color();
    const tmpTip = new THREE.Color();
    const clock = new THREE.Clock();
    let smoothedAmp = 0;
    let bassPrev = 0;
    let windGust = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const delta = clock.getDelta();

      // Audio bands
      analyser.getByteFrequencyData(dataArray);
      const binCount = dataArray.length;
      const bassEnd = Math.floor(binCount * 0.15);
      const midsEnd = Math.floor(binCount * 0.55);
      let bassSum = 0, midsSum = 0, highsSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += dataArray[i];
      for (let i = bassEnd; i < midsEnd; i++) midsSum += dataArray[i];
      for (let i = midsEnd; i < binCount; i++) highsSum += dataArray[i];
      const bass = (bassSum / (bassEnd * 255)) * s.sensitivity;
      const mids = (midsSum / ((midsEnd - bassEnd) * 255)) * s.sensitivity;
      const highs = (highsSum / ((binCount - midsEnd) * 255)) * s.sensitivity;
      const amp = (bass + mids + highs) / 3;
      smoothedAmp += (amp - smoothedAmp) * 0.15;
      const bassKick = Math.max(0, bass - bassPrev);
      bassPrev = bass;

      // Wind gust on bass kicks, decays over ~0.4s
      windGust += bassKick * 1.6;
      windGust *= Math.exp(-3.0 * delta);

      uniforms.uTime.value += delta * (1.0 + smoothedAmp * 0.4) * s.speed;
      uniforms.uWindSpeed.value = 1.2 + mids * 1.4;
      uniforms.uWindAmplitude.value = 0.25 + bass * 0.55 + windGust;
      uniforms.uLengthMultiplier.value = 1.2 + smoothedAmp * 0.35;
      uniforms.uMotionClumpBoost.value = highs * 0.8;

      // Hue-shift base/tip colors
      const hueDelta = s.hueShift / 360;
      tmpBase.setHSL((baseHSL.h + hueDelta + 1) % 1, baseHSL.s, baseHSL.l);
      tmpTip.setHSL((tipHSL.h + hueDelta + 1) % 1, tipHSL.s, tipHSL.l);
      uniforms.uBaseColor.value.copy(tmpBase);
      uniforms.uTipColor.value.copy(tmpTip);

      // Auto-rotate, audio-boosted
      const rotSpeed = (0.15 + smoothedAmp * 0.6) * s.speed;
      ballGroup.rotation.y += delta * rotSpeed;
      ballGroup.rotation.x += delta * rotSpeed * 0.25;

      // Scale → camera distance (closer = larger ball)
      const targetZ = 20 / Math.max(0.5, Math.min(3.0, s.scale));
      camera.position.z += (targetZ - camera.position.z) * 0.08;

      renderer.render(scene, camera);
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
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
      bladeGeo.dispose();
      material.dispose();
      darkGeo.dispose();
      darkMat.dispose();
      renderer.dispose();
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
