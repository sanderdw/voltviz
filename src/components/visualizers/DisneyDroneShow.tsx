import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

// Helper to shuffle arrays for chaotic drone transitions
function shuffleArray(array: number[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export default function DisneyDroneShow({ stream, settings }: Props) {
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
    scene.background = new THREE.Color(0x010105); // Deep night sky
    scene.fog = new THREE.FogExp2(0x010105, 0.002);

    // Audience perspective: low to the ground, looking up
    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 2000);
    camera.position.set(0, -20, 120);
    camera.lookAt(0, 20, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // --- Environment ---
    // Background Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1000 * 3);
    for(let i=0; i<1000; i++) {
      starPos[i*3] = (Math.random() - 0.5) * 1000;
      starPos[i*3+1] = Math.random() * 500;
      starPos[i*3+2] = -200 - Math.random() * 500;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0.4 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // --- Drones Setup ---
    const droneCount = 2500;

    // Generate Shapes
    const shapes: THREE.Vector3[][] = [];

    // 0. Mickey Head
    const mickey = [];
    for(let i=0; i<droneCount; i++) {
      const r = Math.random();
      let center, radius;
      if (r < 0.5) { center = new THREE.Vector3(0, 15, 0); radius = 20; }
      else if (r < 0.75) { center = new THREE.Vector3(-22, 37, 0); radius = 10; }
      else { center = new THREE.Vector3(22, 37, 0); radius = 10; }

      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const rCube = Math.cbrt(Math.random()) * radius;

      mickey.push(new THREE.Vector3(
        center.x + rCube * Math.sin(phi) * Math.cos(theta),
        center.y + rCube * Math.sin(phi) * Math.sin(theta),
        center.z + rCube * Math.cos(phi)
      ));
    }
    shapes.push(mickey);

    // 1. Magic Castle
    const castle = [];
    for(let i=0; i<droneCount; i++) {
      let x, y, z = (Math.random()-0.5)*10;
      const part = Math.random();
      if (part < 0.4) { // Base
        x = (Math.random() - 0.5) * 50;
        y = (Math.random() * 20) - 20;
      } else if (part < 0.6) { // Center Tower
        x = (Math.random() - 0.5) * 12;
        y = Math.random() * 25;
      } else if (part < 0.75) { // Left Tower
        x = -18 + (Math.random() - 0.5) * 8;
        y = Math.random() * 15;
      } else if (part < 0.9) { // Right Tower
        x = 18 + (Math.random() - 0.5) * 8;
        y = Math.random() * 15;
      } else { // Roofs
        const roofPart = Math.random();
        if (roofPart < 0.33) { // Center roof
          const h = Math.random();
          x = (Math.random() - 0.5) * 12 * (1 - h);
          y = 25 + h * 20;
        } else if (roofPart < 0.66) { // Left roof
          const h = Math.random();
          x = -18 + (Math.random() - 0.5) * 8 * (1 - h);
          y = 15 + h * 15;
        } else { // Right roof
          const h = Math.random();
          x = 18 + (Math.random() - 0.5) * 8 * (1 - h);
          y = 15 + h * 15;
        }
      }
      castle.push(new THREE.Vector3(x, y + 10, z)); // Shift up slightly
    }
    shapes.push(castle);

    // 2. Heart
    const heart = [];
    for(let i=0; i<droneCount; i++) {
      const t = Math.random() * Math.PI * 2;
      const r = Math.random() * 3;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
      heart.push(new THREE.Vector3(x * 1.8 + (Math.random()-0.5)*r, y * 1.8 + 25 + (Math.random()-0.5)*r, (Math.random()-0.5)*15));
    }
    shapes.push(heart);

    // 3. Fairy Dust / Spiral
    const spiral = [];
    for(let i=0; i<droneCount; i++) {
      const angle = Math.random() * Math.PI * 12;
      const radius = angle * 2.0;
      const spread = (Math.random() - 0.5) * 15;
      spiral.push(new THREE.Vector3(
        Math.cos(angle) * radius + spread,
        (Math.random() - 0.5) * 40 + 10,
        Math.sin(angle) * radius + spread
      ));
    }
    shapes.push(spiral);

    // Drone State
    const currentPositions = new Float32Array(droneCount * 3);
    const targetPositions = new Float32Array(droneCount * 3);
    const displayPositions = new Float32Array(droneCount * 3);
    const currentColors = new Float32Array(droneCount * 3);
    const targetColors = new Float32Array(droneCount * 3);
    const displayColors = new Float32Array(droneCount * 3);
    const droneOffsets = new Float32Array(droneCount); // For twinkling/hovering

    // Initialize with Shape 0
    const shapeColors = [
      new THREE.Color().setHSL(0.12, 1.0, 0.7), // Mickey: Gold/White
      new THREE.Color().setHSL(0.6, 1.0, 0.7),  // Castle: Cyan/Blue
      new THREE.Color().setHSL(0.95, 1.0, 0.6), // Heart: Red/Pink
      new THREE.Color().setHSL(0.8, 1.0, 0.7),  // Spiral: Purple/Magenta
    ];

    for(let i=0; i<droneCount; i++) {
      const p = shapes[0][i];
      currentPositions[i*3] = p.x;
      currentPositions[i*3+1] = p.y;
      currentPositions[i*3+2] = p.z;

      targetPositions[i*3] = p.x;
      targetPositions[i*3+1] = p.y;
      targetPositions[i*3+2] = p.z;

      displayPositions[i*3] = p.x;
      displayPositions[i*3+1] = p.y;
      displayPositions[i*3+2] = p.z;

      const c = shapeColors[0];
      currentColors[i*3] = c.r;
      currentColors[i*3+1] = c.g;
      currentColors[i*3+2] = c.b;

      targetColors[i*3] = c.r;
      targetColors[i*3+1] = c.g;
      targetColors[i*3+2] = c.b;

      displayColors[i*3] = c.r;
      displayColors[i*3+1] = c.g;
      displayColors[i*3+2] = c.b;

      droneOffsets[i] = Math.random() * Math.PI * 2;
    }

    const droneGeo = new THREE.BufferGeometry();
    droneGeo.setAttribute('position', new THREE.BufferAttribute(displayPositions, 3));
    droneGeo.setAttribute('color', new THREE.BufferAttribute(displayColors, 3));

    const droneMat = new THREE.PointsMaterial({
      size: 4,
      vertexColors: true,
      map: createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9
    });

    const droneSystem = new THREE.Points(droneGeo, droneMat);
    scene.add(droneSystem);

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
    let currentShapeIndex = 0;
    let timeSinceLastShape = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const currentSettings = settingsRef.current;
      time += dt * currentSettings.speed;
      timeSinceLastShape += dt;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const mid = dataArray.slice(8, 60).reduce((a, b) => a + b, 0) / 52;
      const treble = dataArray.slice(60, 200).reduce((a, b) => a + b, 0) / 140;

      const bassNorm = bass / 255;
      const midNorm = mid / 255;
      const trebleNorm = treble / 255;

      // Shape Transition Logic (Every 12 seconds, or on a massive drop after 8 seconds)
      if (timeSinceLastShape > 12 || (timeSinceLastShape > 8 && bassNorm > 0.9)) {
        timeSinceLastShape = 0;
        currentShapeIndex = (currentShapeIndex + 1) % shapes.length;

        // Shuffle indices so drones cross paths chaotically
        const indices = Array.from({length: droneCount}, (_, i) => i);
        shuffleArray(indices);

        const nextShape = shapes[currentShapeIndex];
        const nextColor = shapeColors[currentShapeIndex];

        for(let i=0; i<droneCount; i++) {
          const targetIdx = indices[i];
          const p = nextShape[targetIdx];

          targetPositions[i*3] = p.x;
          targetPositions[i*3+1] = p.y;
          targetPositions[i*3+2] = p.z;

          // Add some random variation to the color
          const colorVariation = (Math.random() - 0.5) * 0.2;
          const finalColor = nextColor.clone().offsetHSL(colorVariation, 0, colorVariation);

          targetColors[i*3] = finalColor.r;
          targetColors[i*3+1] = finalColor.g;
          targetColors[i*3+2] = finalColor.b;
        }
      }

      // Update Drones
      const positions = droneGeo.attributes.position.array as Float32Array;
      const colors = droneGeo.attributes.color.array as Float32Array;

      // Lerp speed based on music
      const lerpFactor = Math.min(1.0, dt * (1.0 + midNorm * 2.0) * currentSettings.speed);

      // Global scale pulse on bass (more aggressive)
      const globalScale = 1.0 + Math.pow(bassNorm, 3) * 0.4 * currentSettings.scale;

      // Explosion force for drones flying outward on beats
      const explosionForce = Math.pow(bassNorm, 4) * 40.0 * currentSettings.sensitivity;
      const scatterForce = Math.pow(bassNorm, 5) * 20.0 * currentSettings.sensitivity;

      for(let i=0; i<droneCount; i++) {
        // Lerp Positions
        currentPositions[i*3] += (targetPositions[i*3] - currentPositions[i*3]) * lerpFactor;
        currentPositions[i*3+1] += (targetPositions[i*3+1] - currentPositions[i*3+1]) * lerpFactor;
        currentPositions[i*3+2] += (targetPositions[i*3+2] - currentPositions[i*3+2]) * lerpFactor;

        // Calculate distance and direction from center for explosion effect
        const cx = currentPositions[i*3];
        const cy = currentPositions[i*3+1] - 20; // Offset Y center slightly so they fly up/out
        const cz = currentPositions[i*3+2];
        const dist = Math.sqrt(cx*cx + cy*cy + cz*cz) || 1;
        const dirX = cx / dist;
        const dirY = cy / dist;
        const dirZ = cz / dist;

        // Add hover/wind jitter based on treble
        const jitter = trebleNorm * 1.5 * currentSettings.sensitivity;
        const hoverX = Math.sin(time * 2 + droneOffsets[i]) * jitter;
        const hoverY = Math.cos(time * 2.5 + droneOffsets[i]) * jitter;
        const hoverZ = Math.sin(time * 1.5 + droneOffsets[i]) * jitter;

        // Scatter effect (chaotic movement on heavy beats)
        const scatterX = Math.sin(droneOffsets[i] * 13.0) * scatterForce;
        const scatterY = Math.cos(droneOffsets[i] * 17.0) * scatterForce;
        const scatterZ = Math.sin(droneOffsets[i] * 19.0) * scatterForce;

        // Apply all transformations to display positions
        positions[i*3] = currentPositions[i*3] * globalScale + dirX * explosionForce + scatterX + hoverX;
        positions[i*3+1] = currentPositions[i*3+1] * globalScale + dirY * explosionForce + scatterY + hoverY;
        positions[i*3+2] = currentPositions[i*3+2] * globalScale + dirZ * explosionForce + scatterZ + hoverZ;

        // Lerp Colors
        currentColors[i*3] += (targetColors[i*3] - currentColors[i*3]) * lerpFactor;
        currentColors[i*3+1] += (targetColors[i*3+1] - currentColors[i*3+1]) * lerpFactor;
        currentColors[i*3+2] += (targetColors[i*3+2] - currentColors[i*3+2]) * lerpFactor;

        // Brightness pulse (much brighter on beats)
        const brightness = 0.4 + Math.pow(bassNorm, 2) * 1.5 + Math.sin(time * 5 + droneOffsets[i]) * 0.3 * trebleNorm;

        colors[i*3] = Math.min(1, currentColors[i*3] * brightness);
        colors[i*3+1] = Math.min(1, currentColors[i*3+1] * brightness);
        colors[i*3+2] = Math.min(1, currentColors[i*3+2] * brightness);
      }

      droneGeo.attributes.position.needsUpdate = true;
      droneGeo.attributes.color.needsUpdate = true;

      // Slowly rotate the entire drone swarm
      droneSystem.rotation.y = Math.sin(time * 0.2) * 0.5;

      // Pulse drone size
      droneMat.size = (3 + Math.pow(bassNorm, 3) * 8) * currentSettings.scale;

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

      // Cleanup
      starGeo.dispose();
      starMat.dispose();
      droneGeo.dispose();
      droneMat.dispose();
      renderer.dispose();

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#010105]" />
  );
}
