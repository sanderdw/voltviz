import * as THREE from 'three';
import { createRenderer, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

const ThreeDEqualizer: VisualizerFactory = ({ container, width: w, height: h, dpr }) => {
  // --- Three.js Setup ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050014, 0.015);

  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
  camera.position.set(0, 25, 45);
  camera.lookAt(0, 0, 0);

  const renderer = createRenderer(container, w, h, dpr, { alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.domElement.style.background = '#050014'; // container was bg-[#050014]

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(20, 40, 20);
  scene.add(dirLight);

  const pointLight = new THREE.PointLight(0xaa00ff, 5, 100);
  pointLight.position.set(0, 10, 0);
  scene.add(pointLight);

  // Instanced Mesh for the Grid
  const gridSize = 50; // 50x50 = 2500 cubes
  const count = gridSize * gridSize;

  // Cube geometry with pivot at the bottom
  const geometry = new THREE.BoxGeometry(0.8, 1, 0.8);
  geometry.translate(0, 0.5, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.8,
  });

  const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
  scene.add(instancedMesh);

  // Pre-calculate grid positions
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const centerX = gridSize / 2;
  const centerZ = gridSize / 2;


  let time = 0;

  return {
    resize(width, height, pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    frame({ audio, settings: currentSettings, dt }) {
      time += dt * currentSettings.speed;

      // Update audio data
      const dataArray = audio.spectrum({ fftSize: 256, smoothing: 0.8 });
      const bufferLength = dataArray.length;

      // Update InstancedMesh
      for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
          const i = x * gridSize + z;

          const dx = x - centerX;
          const dz = z - centerZ;
          const dist = Math.sqrt(dx * dx + dz * dz);

          // Map distance from center to audio frequency bin
          // Center = bass (low bins), Edges = treble (high bins)
          const maxDist = Math.sqrt(centerX * centerX + centerZ * centerZ);
          const binIndex = Math.floor((dist / maxDist) * (bufferLength * 0.6)); // Use lower 60% of frequencies
          const safeIndex = Math.min(Math.max(binIndex, 0), bufferLength - 1);

          const audioVal = dataArray[safeIndex] / 255.0;

          // Add a wave effect combined with audio
          const wave = Math.sin(dist * 0.5 - time * 2) * 0.5 + 0.5;

          const height = 0.2 + (audioVal * 15.0 + wave * 2.0) * currentSettings.sensitivity * currentSettings.scale;

          dummy.position.set(dx, 0, dz);
          dummy.scale.set(1, height, 1);
          dummy.updateMatrix();
          instancedMesh.setMatrixAt(i, dummy.matrix);

          // Color based on distance, time, and audio intensity
          const hue = (dist * 0.03 - time * 0.1 + currentSettings.hueShift / 360) % 1.0;
          const saturation = 0.8;
          const lightness = 0.1 + audioVal * 0.6 + wave * 0.1;

          color.setHSL(hue < 0 ? hue + 1 : hue, saturation, lightness);
          instancedMesh.setColorAt(i, color);
        }
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

      // Rotate camera slowly around the grid
      const camRadius = 45 * currentSettings.scale;
      camera.position.x = Math.sin(time * 0.2) * camRadius;
      camera.position.z = Math.cos(time * 0.2) * camRadius;
      camera.position.y = 20 + Math.sin(time * 0.1) * 10;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      instancedMesh.dispose();
      disposeRenderer(renderer);
    },
  };
};

export default ThreeDEqualizer;
