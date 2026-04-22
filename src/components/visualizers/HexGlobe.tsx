import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

/* ── Noise helpers ───────────────────────────────────────────── */
function hash(n: number) {
  return Math.abs((Math.sin(n) * 43758.5453123) % 1);
}

function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash(a + b * 57 + c * 113);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), ux), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), ux), uy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), ux), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), ux), uy),
    uz
  );
}

function fbm(x: number, y: number, z: number, oct = 3) {
  let v = 0, a = 0.35, f = 1.5;
  for (let i = 0; i < oct; i++) {
    v += (noise3(x * f, y * f, z * f) * 2 - 1) * a;
    a *= 0.5;
    f *= 2;
  }
  return v;
}

/* ── Cell generation (icosahedron dual → hex grid) ───────────── */
type Cell = { center: THREE.Vector3; verts2d: [number, number][] };

const _wup = new THREE.Vector3(0, 1, 0);

function tangentFrame(center: THREE.Vector3) {
  const outward = center.clone();
  const north = _wup.clone().sub(outward.clone().multiplyScalar(_wup.dot(outward)));
  if (north.lengthSq() < 1e-6) north.set(1, 0, 0);
  north.normalize();
  const east = north.clone().cross(outward).normalize();
  return { outward, north, east };
}

function buildCells(detail: number): Cell[] {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const N = pos.count;

  const tv = Array.from({ length: N }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(pos, i).normalize());

  const fc: THREE.Vector3[] = [];
  for (let i = 0; i < N; i += 3)
    fc.push(tv[i].clone().add(tv[i + 1]).add(tv[i + 2]).divideScalar(3).normalize());

  const keyMap = new Map<string, number>();
  const uv: THREE.Vector3[] = [];
  const ui: number[] = [];
  for (let i = 0; i < N; i++) {
    const v = tv[i];
    const k = `${(v.x * 1e5 + 0.5 | 0)},${(v.y * 1e5 + 0.5 | 0)},${(v.z * 1e5 + 0.5 | 0)}`;
    let idx = keyMap.get(k);
    if (idx === undefined) { idx = uv.length; uv.push(v.clone()); keyMap.set(k, idx); }
    ui[i] = idx;
  }

  const vf: Set<number>[] = uv.map(() => new Set());
  for (let i = 0; i < N; i++) vf[ui[i]].add(i / 3 | 0);

  const cells: Cell[] = [];
  for (let vi = 0; vi < uv.length; vi++) {
    const center = uv[vi];
    const fis = Array.from(vf[vi]);
    if (fis.length < 3) continue;
    const { north, east } = tangentFrame(center);
    const pts = fis.map(fi => fc[fi]);
    pts.sort((a, b) => {
      const da = a.clone().sub(center), db = b.clone().sub(center);
      return Math.atan2(da.dot(north), da.dot(east)) - Math.atan2(db.dot(north), db.dot(east));
    });
    const verts2d: [number, number][] = pts.map(p => {
      const d = p.clone().sub(center);
      return [d.dot(east), d.dot(north)];
    });
    cells.push({ center, verts2d });
  }

  geo.dispose();
  return cells;
}

/* ── Biome helpers ───────────────────────────────────────────── */
const TERRAIN_H: [number, number] = [0.001, 0.130];
const OCEAN_H: [number, number] = [0.010, 0.018];

function isOcean(v: THREE.Vector3): boolean {
  return fbm(v.x * 2.1, v.y * 2.1, v.z * 2.1) <= 0.08;
}

function rnd(a: number, b: number) { return a + Math.random() * (b - a); }

/* ── Constants ───────────────────────────────────────────────── */
const SEA_RADIUS = 0.99;
const RADIUS = 1.0;
const CLOUD_RADIUS = 1.09;
const CLOUD_H = 0.020;
const CLOUD_THRESHOLD = 0.18;

/** Map scale slider (0.5–3.0) to icosahedron detail (12–32). */
function scaleToDetail(scale: number): number {
  return Math.round(12 + (Math.max(0.5, Math.min(3.0, scale)) - 0.5) * 8);
}

type CloudEntry = { mesh: THREE.Mesh; nx: number; ny: number; nz: number };

export default function HexGlobe({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);
  const detail = scaleToDetail(settings.scale);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // --- Audio Setup ---
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // --- Three.js Setup ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');

    // --- Starfield background ---
    const starCount = 1500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 30 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.08, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0, 3.4);
    camera.lookAt(0, 0, 0);

    // --- Post Processing ---
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.6, 0.75);
    const outputPass = new OutputPass();

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // --- Lights ---
    const ambient = new THREE.AmbientLight('#ffffff', 0.1);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight('#fffefb', 2.5);
    dirLight.position.set(8, 3, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // --- Build Globe ---
    const group = new THREE.Group();
    scene.add(group);

    const cells = buildCells(detail);
    const seaGeos: THREE.BufferGeometry[] = [];
    const terrainGeos: THREE.BufferGeometry[] = [];
    const cloudMats: THREE.Material[] = [];
    const cloudGeos: THREE.BufferGeometry[] = [];
    const clouds: CloudEntry[] = [];
    const tmp = new THREE.Vector3(1, 1, 1);

    for (const { center, verts2d } of cells) {
      const { outward, north, east } = tangentFrame(center);
      const basis = new THREE.Matrix4().makeBasis(east, north, outward);
      const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

      const makeGeo = (r: number, ht: number) => {
        const shape = new THREE.Shape();
        verts2d.forEach(([x, y], i) => { i === 0 ? shape.moveTo(x * r, y * r) : shape.lineTo(x * r, y * r); });
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: ht, bevelEnabled: false });
        geo.applyMatrix4(new THREE.Matrix4().compose(center.clone().multiplyScalar(r), quat, tmp));
        return geo;
      };

      const ocean = isOcean(center);
      seaGeos.push(makeGeo(SEA_RADIUS, rnd(...OCEAN_H)));

      const fbmScale = 5;
      if (!ocean) {
        const n = fbm(center.x * fbmScale, center.y * fbmScale, center.z * fbmScale, 4);
        const t = (n + 1) * 0.5;
        const ht = TERRAIN_H[0] + t * (TERRAIN_H[1] - TERRAIN_H[0]);
        terrainGeos.push(makeGeo(RADIUS, ht));
      }

      // Clouds: individual meshes for per-hex visibility toggling
      const cmat = new THREE.MeshStandardMaterial({
        color: '#ffffff', metalness: 0.9, roughness: 0.8,
        emissive: '#5f9aff', emissiveIntensity: 0.2
      });
      cloudMats.push(cmat);
      const cgeo = makeGeo(CLOUD_RADIUS, CLOUD_H);
      cloudGeos.push(cgeo);
      const cmesh = new THREE.Mesh(cgeo, cmat);
      cmesh.visible = false;
      cmesh.castShadow = true;
      group.add(cmesh);
      clouds.push({ mesh: cmesh, nx: center.x, ny: center.y, nz: center.z });
    }

    // Sea: single merged mesh with animated shader
    const seaMerged = mergeGeometries(seaGeos);
    seaGeos.forEach(g => g.dispose());
    let seaUniforms: Record<string, { value: number }> | null = null;
    const seaMat = new THREE.MeshLambertMaterial({ emissive: '#004bc5', emissiveIntensity: 0.1 });
    seaMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uAudio = { value: 0 };
      seaUniforms = shader.uniforms as Record<string, { value: number }>;

      shader.vertexShader = 'uniform float uTime;\nuniform float uAudio;\nvarying float vWave;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wave = sin(position.x * 8.0 + uTime * 1.2) * cos(position.z * 8.0 + uTime * 0.9)
                     + sin(position.y * 8.0 + uTime * 0.7) * 0.5;
        vWave = wave;
        transformed += normalize(position) * wave * (0.03 + uAudio * 0.04);`
      );

      shader.fragmentShader = 'varying float vWave;\nuniform float uHueShift;\n' + shader.fragmentShader;
      shader.uniforms.uHueShift = { value: 0 };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float t = clamp(vWave * 0.9 + 0.2, 0.0, 1.0);
        // Convert base colors to HSL-shifted equivalents via hue rotation
        float cs = cos(uHueShift * 6.28318);
        float sn = sin(uHueShift * 6.28318);
        mat3 hueRot = mat3(
          0.299+0.701*cs+0.168*sn, 0.587-0.587*cs+0.330*sn, 0.114-0.114*cs-0.497*sn,
          0.299-0.299*cs-0.328*sn, 0.587+0.413*cs+0.035*sn, 0.114-0.114*cs+0.292*sn,
          0.299-0.300*cs+1.250*sn, 0.587-0.588*cs-1.050*sn, 0.114+0.886*cs-0.203*sn
        );
        vec3 dark  = hueRot * vec3(0.0, 0.106, 0.4);
        vec3 light = hueRot * vec3(0.22, 0.788, 0.769);
        diffuseColor.rgb = mix(dark, light, t);`
      );
    };
    const seaMesh = new THREE.Mesh(seaMerged, seaMat);
    seaMesh.receiveShadow = true;
    group.add(seaMesh);

    // Terrain: single merged mesh with height coloring
    let terrainMerged: THREE.BufferGeometry | null = null;
    const terrainMat = new THREE.MeshPhongMaterial();
    terrainMat.onBeforeCompile = (shader) => {
      const decl = 'varying float vIsTop;\nvarying vec3 vObjPos;\nuniform float uHueShift;\n';
      shader.uniforms.uHueShift = { value: 0 };
      shader.vertexShader = decl + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vIsTop   = step(0.7, dot(normalize(normal), normalize(position)));
        vObjPos  = position;`
      );
      shader.fragmentShader = decl + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float h = clamp((length(vObjPos) - 1.0) / 0.13, 0.0, 1.0);
        h = smoothstep(0.35, 0.75, h);

        float cs = cos(uHueShift * 6.28318);
        float sn = sin(uHueShift * 6.28318);
        mat3 hueRot = mat3(
          0.299+0.701*cs+0.168*sn, 0.587-0.587*cs+0.330*sn, 0.114-0.114*cs-0.497*sn,
          0.299-0.299*cs-0.328*sn, 0.587+0.413*cs+0.035*sn, 0.114-0.114*cs+0.292*sn,
          0.299-0.300*cs+1.250*sn, 0.587-0.588*cs-1.050*sn, 0.114+0.886*cs-0.203*sn
        );

        vec3 c0 = hueRot * vec3(0.737, 0.486, 0.11);
        vec3 c1 = hueRot * vec3(0.086, 0.8, 0.204);
        vec3 c2 = hueRot * vec3(0.1, 0.1, 0.1);
        vec3 c3 = vec3(1.0, 1.0, 1.0);
        float s = h * 3.999;
        vec3 topColor = s < 1.0 ? mix(c0, c1, s)
                      : s < 2.0 ? mix(c1, c2, s - 1.0)
                      :           mix(c2, c3, s - 2.0);
        vec3 sideColor = hueRot * vec3(0.737, 0.486, 0.11);
        diffuseColor.rgb = mix(sideColor, topColor, vIsTop);`
      );
    };
    if (terrainGeos.length > 0) {
      terrainMerged = mergeGeometries(terrainGeos);
      terrainGeos.forEach(g => g.dispose());
      const terrainMesh = new THREE.Mesh(terrainMerged, terrainMat);
      terrainMesh.castShadow = true;
      terrainMesh.receiveShadow = true;
      group.add(terrainMesh);
    }

    // --- Animation loop ---
    const timer = new (THREE as unknown as { Timer: new () => { update(): void; getElapsed(): number } }).Timer();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);
      const binCount = dataArray.length; // 128 bins

      // Split into frequency bands: bass (0-15%), mids (15-55%), highs (55-100%)
      const bassEnd = Math.floor(binCount * 0.15);
      const midsEnd = Math.floor(binCount * 0.55);
      let bassSum = 0, midsSum = 0, highsSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += dataArray[i];
      for (let i = bassEnd; i < midsEnd; i++) midsSum += dataArray[i];
      for (let i = midsEnd; i < binCount; i++) highsSum += dataArray[i];
      const bass = (bassSum / (bassEnd * 255)) * s.sensitivity;
      const mids = (midsSum / ((midsEnd - bassEnd) * 255)) * s.sensitivity;
      const highs = (highsSum / ((binCount - midsEnd) * 255)) * s.sensitivity;

      timer.update();
      const elapsed = timer.getElapsed();
      const t = elapsed * s.speed;

      // Rotate globe – bass drives rotation intensity
      group.rotation.y += 0.15 * s.speed * (1 / 60) * (1 + bass * 2.0);

      // Sea wave uniforms – mids drive wave amplitude
      if (seaUniforms) {
        seaUniforms.uTime.value = t;
        seaUniforms.uAudio.value = mids;
        seaUniforms.uHueShift.value = s.hueShift / 360;
      }

      // Terrain hue shift
      if (terrainMat.userData.shader) {
        terrainMat.userData.shader.uniforms.uHueShift.value = s.hueShift / 360;
      }

      // Cloud animation – mids/highs intensify movement & spread
      const midHighEnergy = (mids + highs) * 0.5;
      const cloudSpeed = (0.04 + midHighEnergy * 0.2) * s.speed;
      const cosD = Math.cos(t * cloudSpeed), sinD = Math.sin(t * (0.03 + midHighEnergy * 0.12));
      const thresholdShift = midHighEnergy * 0.25;
      clouds.forEach(({ mesh, nx, ny, nz }) => {
        const rx = nx * cosD - nz * sinD, rz = nx * sinD + nz * cosD;
        mesh.visible = fbm(rx * 2.4, ny * 2.4, rz * 2.4, 4) > CLOUD_THRESHOLD - thresholdShift;
      });

      composer.render();
    };

    // Store shader reference for terrain uniforms access
    terrainMat.onBeforeCompile = ((origCompile) => {
      return (shader: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
        origCompile(shader, r);
        terrainMat.userData.shader = shader;
      };
    })(terrainMat.onBeforeCompile);

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
      if (audioCtxRef.current) audioCtxRef.current.close();

      seaMerged.dispose();
      seaMat.dispose();
      terrainMerged?.dispose();
      terrainMat.dispose();
      cloudGeos.forEach(g => g.dispose());
      cloudMats.forEach(m => m.dispose());
      starGeo.dispose();
      starMat.dispose();
      group.clear();
      renderer.dispose();
    };
  }, [stream, detail]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
