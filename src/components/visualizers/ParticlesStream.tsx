import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { VisualizerSettings } from '../../types';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';
import dummyCover from '../../../images/dummycover.png';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
}

// Hardcoded constants (formerly the lil-gui `params` from the source demo).
const BLUR_AMOUNT = 0.86;        // AfterimagePass damp
const NUM_LAYERS = 5;
const STATIC_DARK_LAYERS = 1;
const EDGE_SMOOTHING = 0.897;
const GROUP_DEPTH = 600;
const BASE_IMAGE_OPACITY = 0.40;
const BASE_SPEED = 2.0;
const PARTICLE_COUNT = 80000;    // capped from the original 500000 for smooth embedded playback
const PARTICLE_SIZE = 1.5;
const PARTICLE_BRIGHTNESS = 1.0;
const FADE_START_DISTANCE = -902;
const BASS_SPEED_BOOST = 4.0;    // K: how strongly bass accelerates the fly-through

export default function ParticlesStream({ stream, settings, sendspinMetadata }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const imageSrc = uploadedImage ?? sendspinMetadata?.artwork_url ?? dummyCover;

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setUploadedImage(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!containerRef.current || !mountRef.current) return;
    const container = containerRef.current;
    const mount = mountRef.current;

    // --- Audio setup ---
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // --- Three.js setup ---
    const scene = new THREE.Scene();
    const getSize = () => ({
      w: container.clientWidth || 1,
      h: container.clientHeight || 1,
    });
    let { w: viewW, h: viewH } = getSize();

    const camera = new THREE.PerspectiveCamera(75, viewW / viewH, 0.1, 3000);
    camera.position.z = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewW, viewH);
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const afterimagePass = new AfterimagePass();
    afterimagePass.uniforms['damp'].value = BLUR_AMOUNT;
    composer.addPass(afterimagePass);

    // --- Scene state ---
    let movingMeshes: THREE.Mesh[] = [];
    let baseMesh: THREE.Mesh | null = null;
    let baseTexture: THREE.CanvasTexture | null = null;
    let currentTextures: THREE.CanvasTexture[] = [];
    let currentImageAspect = 1;
    let particleSystem: THREE.Points | null = null;
    let startupFade = 0.0;

    const tintColor = new THREE.Color();
    const tmpColor = new THREE.Color();

    function removeParticles() {
      if (particleSystem) {
        scene.remove(particleSystem);
        particleSystem.geometry.dispose();
        (particleSystem.material as THREE.Material).dispose();
        particleSystem = null;
      }
    }

    function createParticles(baseData: ImageData, w: number, h: number) {
      removeParticles();

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(PARTICLE_COUNT * 3);
      const colors = new Float32Array(PARTICLE_COUNT * 4); // RGBA: alpha drives per-particle fade

      const loopDepth = GROUP_DEPTH * 3;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const x = Math.floor(Math.random() * w);
        const y = Math.floor(Math.random() * h);
        const index = (y * w + x) * 4;

        tmpColor.setRGB(
          baseData.data[index] / 255,
          baseData.data[index + 1] / 255,
          baseData.data[index + 2] / 255
        );
        tmpColor.convertSRGBToLinear();
        tmpColor.multiplyScalar(PARTICLE_BRIGHTNESS);

        colors[i * 4] = tmpColor.r;
        colors[i * 4 + 1] = tmpColor.g;
        colors[i * 4 + 2] = tmpColor.b;
        colors[i * 4 + 3] = 0.0;

        positions[i * 3] = (x / w) - 0.5;
        positions[i * 3 + 1] = 0.5 - (y / h);
        positions[i * 3 + 2] = Math.random() * -loopDepth;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

      const material = new THREE.PointsMaterial({
        size: PARTICLE_SIZE,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        sizeAttenuation: false,
      });

      particleSystem = new THREE.Points(geometry, material);
      scene.add(particleSystem);
    }

    // Split the image into luma-based cross-faded depth layers (artifact-free edges).
    function processImageIntoLayers(img: HTMLImageElement) {
      currentImageAspect = img.width / img.height;

      currentTextures.forEach((tex) => tex.dispose());
      currentTextures = [];

      const canvas = document.createElement('canvas');
      const maxSize = 1024;
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.floor(w * ratio);
        h = Math.floor(h * ratio);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);

      if (baseTexture) baseTexture.dispose();
      baseTexture = new THREE.CanvasTexture(canvas);
      baseTexture.colorSpace = THREE.SRGBColorSpace;
      baseTexture.matrixAutoUpdate = false;

      let baseData: ImageData;
      try {
        baseData = ctx.getImageData(0, 0, w, h);
      } catch {
        // Remote artwork tainted the canvas (CORS). Fall back to the bundled cover.
        if (imageSrc !== dummyCover) setUploadedImage(null);
        return;
      }
      const totalPixels = baseData.data.length;

      createParticles(baseData, w, h);

      // Pre-calculate smooth layer index per luma value to avoid banding artifacts.
      const steppedXArray = new Float32Array(256);
      const edgeWidth = EDGE_SMOOTHING;
      const minEdge = 0.5 - (edgeWidth / 2);
      const maxEdge = 0.5 + (edgeWidth / 2);

      for (let l = 0; l < 256; l++) {
        const x = (l / 255) * (NUM_LAYERS - 1);
        const floorX = Math.floor(x);
        const f = x - floorX;
        let smoothedF = f;
        if (edgeWidth < 1.0) {
          if (edgeWidth <= 0.001) {
            smoothedF = f < 0.5 ? 0.0 : 1.0;
          } else if (f <= minEdge) {
            smoothedF = 0.0;
          } else if (f >= maxEdge) {
            smoothedF = 1.0;
          } else {
            const t = (f - minEdge) / (maxEdge - minEdge);
            smoothedF = t * t * (3 - 2 * t);
          }
        }
        steppedXArray[l] = floorX + smoothedF;
      }

      for (let i = 0; i < NUM_LAYERS; i++) {
        const lCanvas = document.createElement('canvas');
        lCanvas.width = w;
        lCanvas.height = h;
        const lCtx = lCanvas.getContext('2d')!;
        const lData = lCtx.createImageData(w, h);

        for (let j = 0; j < totalPixels; j += 4) {
          const r = baseData.data[j];
          const g = baseData.data[j + 1];
          const b = baseData.data[j + 2];
          const a = baseData.data[j + 3];

          const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          const clampedLuma = Math.max(0, Math.min(255, luma));
          const steppedX = steppedXArray[clampedLuma];
          const weight = Math.max(0, 1.0 - Math.abs(steppedX - i));

          if (weight > 0) {
            lData.data[j] = r;
            lData.data[j + 1] = g;
            lData.data[j + 2] = b;
            lData.data[j + 3] = a * weight;
          }
        }

        lCtx.putImageData(lData, 0, 0);
        const tex = new THREE.CanvasTexture(lCanvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.matrixAutoUpdate = false;
        currentTextures.push(tex);
      }

      startupFade = 0.0;
      buildScene();
    }

    function buildScene() {
      movingMeshes.forEach((mesh) => {
        scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      });
      movingMeshes = [];
      if (baseMesh) {
        scene.remove(baseMesh);
        (baseMesh.material as THREE.Material).dispose();
        baseMesh = null;
      }

      const geometry = new THREE.PlaneGeometry(1, 1);

      // Static full background image.
      const baseMat = new THREE.MeshBasicMaterial({
        map: baseTexture,
        depthWrite: false,
        transparent: true,
        opacity: 0.0,
      });
      baseMesh = new THREE.Mesh(geometry, baseMat);
      baseMesh.position.z = -GROUP_DEPTH * 3;
      // Faint full-image backdrop behind the particle field (opacity set in the loop).
      scene.add(baseMesh);

      // Partial luma layers (static + moving). Hidden by default since particles render.
      currentTextures.forEach((tex, i) => {
        const isStatic = i < STATIC_DARK_LAYERS;
        const instanceCount = isStatic ? 1 : 3;

        for (let g = 0; g < instanceCount; g++) {
          const material = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            opacity: 0.0,
          });

          const mesh = new THREE.Mesh(geometry, material);

          if (isStatic) {
            mesh.position.z = -GROUP_DEPTH * 2.5 + (i * 10);
            mesh.userData = { isStatic: true };
          } else {
            const depthRatio = 1.0 - (i / currentTextures.length);
            const localZ = -depthRatio * GROUP_DEPTH;
            const groupZ = -g * GROUP_DEPTH;
            mesh.position.z = localZ + groupZ;
            mesh.userData = { isStatic: false };
          }

          mesh.visible = false; // particles enabled
          scene.add(mesh);
          movingMeshes.push(mesh);
        }
      });

      updateCoverUVs();
    }

    function updateCoverUVs() {
      const { w, h } = getSize();
      const screenAspect = w / h;

      const backgroundDepth = Math.abs(-GROUP_DEPTH * 3);
      const vFOV = camera.fov * Math.PI / 180;
      const visibleHeight = 2 * Math.tan(vFOV / 2) * backgroundDepth;
      const visibleWidth = visibleHeight * screenAspect;

      if (baseMesh) baseMesh.scale.set(visibleWidth, visibleHeight, 1);
      movingMeshes.forEach((mesh) => mesh.scale.set(visibleWidth, visibleHeight, 1));
      if (particleSystem) particleSystem.scale.set(visibleWidth, visibleHeight, 1);

      const texturesToUpdate: THREE.Texture[] = [...currentTextures];
      if (baseTexture) texturesToUpdate.push(baseTexture);

      texturesToUpdate.forEach((tex) => {
        let scaleX = 1;
        let scaleY = 1;
        if (screenAspect > currentImageAspect) {
          scaleY = currentImageAspect / screenAspect;
        } else {
          scaleX = screenAspect / currentImageAspect;
        }
        tex.matrix.setUvTransform(0.0, 0.0, scaleX, scaleY, 0, 0.5, 0.5);
      });
    }

    // --- Load the image, then build the scene ---
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => processImageIntoLayers(img);
    img.onerror = () => {
      if (imageSrc !== dummyCover) setUploadedImage(null);
    };
    img.src = imageSrc;

    // --- Resize ---
    const handleResize = () => {
      const next = getSize();
      viewW = next.w;
      viewH = next.h;
      camera.aspect = viewW / viewH;
      camera.updateProjectionMatrix();
      renderer.setSize(viewW, viewH);
      composer.setSize(viewW, viewH);
      updateCoverUVs();
    };
    window.addEventListener('resize', handleResize);

    // --- Animation loop ---
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      const s = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);
      let bassSum = 0;
      const bassBins = Math.min(16, dataArray.length);
      for (let i = 0; i < bassBins; i++) bassSum += dataArray[i];
      const bass = bassSum / bassBins / 255;
      const bassBoost = bass * s.sensitivity;

      if (startupFade < 1.0) {
        startupFade = Math.min(1.0, startupFade + 0.01);
      }

      const speed = BASE_SPEED * s.speed * (1 + bassBoost * BASS_SPEED_BOOST);
      const loopDepth = GROUP_DEPTH * 3;
      const maxVisibleZ = 100;
      const spawnZ = maxVisibleZ - loopDepth;
      const fadeInDistance = GROUP_DEPTH * 0.8;
      const fadeSpan = maxVisibleZ - FADE_START_DISTANCE;

      if (baseMesh && baseMesh.visible) {
        (baseMesh.material as THREE.MeshBasicMaterial).opacity = startupFade * BASE_IMAGE_OPACITY;
      }

      // Brightness pulse + hue tint via material.color (multiplied by vertex colors).
      const brightness = Math.min(2.5, PARTICLE_BRIGHTNESS * (1 + bassBoost));
      if (s.hueShift === 0) {
        tintColor.setRGB(brightness, brightness, brightness);
      } else {
        // Tint the whole field toward the chosen hue, scaled by the brightness pulse.
        tintColor.setHSL((s.hueShift % 360) / 360, 0.6, 0.5);
        tintColor.multiplyScalar(brightness * 2);
      }

      movingMeshes.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mesh.userData.isStatic) {
          mat.opacity = startupFade;
          return;
        }

        mesh.position.z += speed;

        let targetOpacity = 1.0;
        if (mesh.position.z > FADE_START_DISTANCE) {
          targetOpacity = 1.0 - (mesh.position.z - FADE_START_DISTANCE) / fadeSpan;
        }
        if (mesh.position.z < spawnZ + fadeInDistance) {
          const spawnOpacity = (mesh.position.z - spawnZ) / fadeInDistance;
          targetOpacity = Math.min(targetOpacity, spawnOpacity);
        }
        mat.opacity = Math.max(0, Math.min(1, targetOpacity)) * startupFade;

        if (mesh.position.z > maxVisibleZ) {
          mesh.position.z -= loopDepth;
        }
      });

      if (particleSystem) {
        const pMat = particleSystem.material as THREE.PointsMaterial;
        pMat.size = PARTICLE_SIZE * s.scale;
        pMat.color.copy(tintColor);

        const positions = particleSystem.geometry.attributes.position.array as Float32Array;
        const colors = particleSystem.geometry.attributes.color.array as Float32Array;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          let z = positions[i * 3 + 2] + speed;
          if (z > maxVisibleZ) z -= loopDepth;
          positions[i * 3 + 2] = z;

          let targetOpacity = 1.0;
          if (z > FADE_START_DISTANCE) {
            targetOpacity = 1.0 - (z - FADE_START_DISTANCE) / fadeSpan;
          }
          if (z < spawnZ + fadeInDistance) {
            const spawnOpacity = (z - spawnZ) / fadeInDistance;
            targetOpacity = Math.min(targetOpacity, spawnOpacity);
          }
          colors[i * 4 + 3] = Math.max(0, Math.min(1, targetOpacity)) * startupFade;
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
        particleSystem.geometry.attributes.color.needsUpdate = true;
      }

      composer.render();
    };
    animate();

    // --- Cleanup ---
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      img.onload = null;
      img.onerror = null;
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      removeParticles();
      movingMeshes.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      if (baseMesh) (baseMesh.material as THREE.Material).dispose();
      currentTextures.forEach((tex) => tex.dispose());
      if (baseTexture) baseTexture.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [stream, imageSrc]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute bottom-6 right-6 flex items-center gap-3 z-20">
        {showUI && (
          <label className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors">
            <ImagePlus className="w-4 h-4" />
            {uploadedImage ? 'Change Image' : 'Upload Image'}
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
        )}
        <button
          onClick={() => setShowUI(!showUI)}
          className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors cursor-pointer"
          title={showUI ? 'Hide UI' : 'Show UI'}
        >
          {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
