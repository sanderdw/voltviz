import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function WebGLGrid({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
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

    // --- Audio Setup ---
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050014, 0.015);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    camera.position.set(0, 25, 45);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Clear any existing canvases (React StrictMode workaround)
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

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

    const resize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', resize);

    let time = 0;
    let lastTime = performance.now();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const currentSettings = settingsRef.current;
      time += dt * currentSettings.speed;

      // Update audio data
      analyser.getByteFrequencyData(dataArray);

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
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#050014]" />
  );
}
