import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function DataCloud({ stream, settings }: Props) {
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
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a'); // slate-900

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    camera.position.set(0, 0, 40);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 20);
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
    backLight.position.set(-10, -20, -20);
    scene.add(backLight);

    // Cloud Group
    const cloudGroup = new THREE.Group();
    scene.add(cloudGroup);

    const colorsList = [
      new THREE.Color('#a3e635'), // lime
      new THREE.Color('#4ade80'), // green
      new THREE.Color('#3b82f6'), // blue
      new THREE.Color('#1d4ed8'), // dark blue
      new THREE.Color('#1e3a8a'), // darker blue
      new THREE.Color('#ea580c'), // orange
    ];

    const meshes: { mesh: THREE.Mesh, origPos: Float32Array }[] = [];

    const addCloudPart = (x: number, y: number, z: number, radius: number, detail: number) => {
      const baseGeo = new THREE.IcosahedronGeometry(radius, detail);

      // Randomize vertices slightly for a more organic low-poly look
      const posAttr = baseGeo.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);
        posAttr.setXYZ(
          i,
          vx + (Math.random() - 0.5) * radius * 0.2,
          vy + (Math.random() - 0.5) * radius * 0.2,
          vz + (Math.random() - 0.5) * radius * 0.2
        );
      }
      baseGeo.computeVertexNormals();

      const geo = baseGeo.toNonIndexed();
      const pos = geo.getAttribute('position');
      const colors = [];

      for (let i = 0; i < pos.count; i += 3) {
        const rand = Math.random();
        let c;
        if (rand < 0.05) c = colorsList[5]; // orange
        else if (rand < 0.25) c = colorsList[4];
        else if (rand < 0.50) c = colorsList[3];
        else if (rand < 0.70) c = colorsList[2];
        else if (rand < 0.85) c = colorsList[1];
        else c = colorsList[0];

        colors.push(c.r, c.g, c.b);
        colors.push(c.r, c.g, c.b);
        colors.push(c.r, c.g, c.b);
      }

      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);

      cloudGroup.add(mesh);
      meshes.push({
        mesh,
        origPos: pos.array.slice() as Float32Array
      });
    };

    // Construct the cloud shape
    addCloudPart(0, 2, 0, 10, 1);      // Center top
    addCloudPart(-8, -4, 2, 8, 1);     // Bottom left
    addCloudPart(8, -4, -2, 8, 1);     // Bottom right
    addCloudPart(-14, -6, -1, 6, 0);   // Far left
    addCloudPart(14, -5, 3, 7, 0);     // Far right

    // Center the group
    const box = new THREE.Box3().setFromObject(cloudGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    cloudGroup.position.sub(center);

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

      analyser.getByteFrequencyData(dataArray);

      // Rotate cloud slowly
      cloudGroup.rotation.y = Math.sin(time * 0.5) * 0.3;
      cloudGroup.rotation.x = Math.cos(time * 0.3) * 0.1;

      // Hover effect (add to the centered position)
      cloudGroup.position.y = -center.y + Math.sin(time * 1.5) * 1.5;

      // Audio reactive triangles
      meshes.forEach(({ mesh, origPos }, meshIndex) => {
        const pos = mesh.geometry.getAttribute('position');

        for (let i = 0; i < pos.count; i += 3) {
          // Map triangle index to frequency bin
          const bin = Math.floor(((i + meshIndex * 10) / pos.count) * (bufferLength * 0.5));
          const safeBin = Math.min(Math.max(bin, 0), bufferLength - 1);
          const audioVal = dataArray[safeBin] / 255.0;

          const v1 = new THREE.Vector3(origPos[i*3], origPos[i*3+1], origPos[i*3+2]);
          const v2 = new THREE.Vector3(origPos[(i+1)*3], origPos[(i+1)*3+1], origPos[(i+1)*3+2]);
          const v3 = new THREE.Vector3(origPos[(i+2)*3], origPos[(i+2)*3+1], origPos[(i+2)*3+2]);

          const centroid = new THREE.Vector3().add(v1).add(v2).add(v3).divideScalar(3);
          const normal = centroid.clone().normalize();

          // Explode outward based on audio
          const offset = normal.multiplyScalar(audioVal * 4.0 * currentSettings.sensitivity * currentSettings.scale);

          // Scale the triangle slightly based on audio
          const scale = 1.0 - (audioVal * 0.3);
          v1.sub(centroid).multiplyScalar(scale).add(centroid);
          v2.sub(centroid).multiplyScalar(scale).add(centroid);
          v3.sub(centroid).multiplyScalar(scale).add(centroid);

          pos.setXYZ(i, v1.x + offset.x, v1.y + offset.y, v1.z + offset.z);
          pos.setXYZ(i+1, v2.x + offset.x, v2.y + offset.y, v2.z + offset.z);
          pos.setXYZ(i+2, v3.x + offset.x, v3.y + offset.y, v3.z + offset.z);
        }
        pos.needsUpdate = true;
      });

      // Apply global scale
      const globalScale = currentSettings.scale * (1 + (dataArray[5] / 255.0) * 0.1 * currentSettings.sensitivity);
      cloudGroup.scale.set(globalScale, globalScale, globalScale);

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

      meshes.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-900" />
  );
}
