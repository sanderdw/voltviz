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

export default function FireworksShow({ stream, settings }: Props) {
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
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000002);
    scene.fog = new THREE.FogExp2(0x000002, 0.002);

    // Camera looking up at the sky
    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 2000);
    camera.position.set(0, 5, 120);
    camera.lookAt(0, 60, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // --- Environment ---
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x010102 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1000 * 3);
    for(let i=0; i<1000; i++) {
      starPos[i*3] = (Math.random() - 0.5) * 1000;
      starPos[i*3+1] = Math.random() * 500;
      starPos[i*3+2] = -200 - Math.random() * 500;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.0, transparent: true, opacity: 0.3 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // --- Particle System (Fireworks) ---
    const MAX_PARTICLES = 30000;
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);

    // Physics state (not sent to GPU)
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const lifetimes = new Float32Array(MAX_PARTICLES);
    const types = new Float32Array(MAX_PARTICLES); // 0: dead, 1: rocket, 2: explosion, 3: trail

    let pIndex = 0;

    function spawnParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, life: number, type: number, size: number) {
      const i = pIndex;
      positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;
      velocities[i*3] = vx; velocities[i*3+1] = vy; velocities[i*3+2] = vz;
      colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
      lifetimes[i] = life;
      types[i] = type;
      sizes[i] = size;

      pIndex = (pIndex + 1) % MAX_PARTICLES;
    }

    function explode(x: number, y: number, z: number, r: number, g: number, b: number, count: number, isHuge: boolean) {
      for(let i=0; i<count; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);

        // Massive speed increase for larger explosions
        const speed = (Math.random() * 120 + 40) * (isHuge ? 2.5 : 1.5);

        const vx = speed * Math.sin(phi) * Math.cos(theta);
        const vy = speed * Math.sin(phi) * Math.sin(theta);
        const vz = speed * Math.cos(phi);

        // Slight color variation
        const cr = Math.min(1, r + (Math.random()-0.5)*0.3);
        const cg = Math.min(1, g + (Math.random()-0.5)*0.3);
        const cb = Math.min(1, b + (Math.random()-0.5)*0.3);

        // Longer lifetime so they can fly off screen
        spawnParticle(x, y, z, vx, vy, vz, cr, cg, cb, 3.0 + Math.random() * 3.0, 2, isHuge ? 12.0 : 6.0);
      }
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    particleGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const particleMat = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: createGlowTexture() }
      },
      vertexShader: `
        attribute float size;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    });

    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

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

    let lastTime = performance.now();
    let beatTimer = 0;
    let autoSpawnTimer = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1); // Cap dt to prevent huge jumps
      lastTime = now;

      const currentSettings = settingsRef.current;
      if (beatTimer > 0) beatTimer -= dt;
      autoSpawnTimer -= dt;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      const mid = dataArray.slice(6, 40).reduce((a, b) => a + b, 0) / 34;
      const treble = dataArray.slice(40, 150).reduce((a, b) => a + b, 0) / 110;

      const bassNorm = bass / 255;
      const midNorm = mid / 255;
      const trebleNorm = treble / 255;

      // --- Spawning Logic ---
      // Spawn on heavy bass beats
      if (bassNorm > 0.8 * (1.5 - currentSettings.sensitivity) && beatTimer <= 0) {
        beatTimer = 0.4; // Cooldown

        const numRockets = Math.random() > 0.6 ? 3 : 1;
        const isHuge = bassNorm > 0.95;

        for(let i=0; i<numRockets; i++) {
          const startX = (Math.random() - 0.5) * 160;
          const startZ = (Math.random() - 0.5) * 80 - 40;
          const targetY = 60 + Math.random() * 80;

          // Calculate vy to reach targetY (v^2 = u^2 + 2as -> u = sqrt(-2as))
          const gravity = -40;
          const vy = Math.sqrt(-2 * gravity * targetY);
          const vx = (Math.random() - 0.5) * 15;
          const vz = (Math.random() - 0.5) * 15;

          // Color based on settings hue + random variation
          const hue = (currentSettings.hueShift / 360 + Math.random() * 0.2) % 1.0;
          const color = new THREE.Color().setHSL(hue, 1.0, 0.6);

          // life = time to reach apex = vy / |g|
          const life = vy / Math.abs(gravity);

          spawnParticle(startX, 0, startZ, vx, vy, vz, color.r, color.g, color.b, life, 1, isHuge ? 8.0 : 5.0);
        }
      }

      // Auto spawn smaller fireworks if the music is continuous but lacking heavy drops
      if (midNorm > 0.4 && autoSpawnTimer <= 0) {
        autoSpawnTimer = 0.5 + Math.random() * 1.0;
        const startX = (Math.random() - 0.5) * 120;
        const startZ = (Math.random() - 0.5) * 60 - 30;
        const targetY = 40 + Math.random() * 40;
        const vy = Math.sqrt(2 * 40 * targetY);
        const hue = Math.random();
        const color = new THREE.Color().setHSL(hue, 1.0, 0.6);
        spawnParticle(startX, 0, startZ, (Math.random()-0.5)*10, vy, (Math.random()-0.5)*10, color.r, color.g, color.b, vy/40, 1, 4.0);
      }

      // --- Physics Loop ---
      const posAttr = particleGeo.attributes.position.array as Float32Array;
      const colAttr = particleGeo.attributes.aColor.array as Float32Array;
      const sizeAttr = particleGeo.attributes.size.array as Float32Array;

      const timeScale = currentSettings.speed;

      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (lifetimes[i] > 0) {
          lifetimes[i] -= dt * timeScale;

          if (lifetimes[i] <= 0) {
            if (types[i] === 1) {
              // Rocket died -> explode
              const isHuge = sizes[i] > 6.0;
              // Increase particle count for denser explosions
              const count = Math.floor((isHuge ? 600 : 250) * currentSettings.scale * (0.5 + midNorm));
              explode(positions[i*3], positions[i*3+1], positions[i*3+2], colors[i*3], colors[i*3+1], colors[i*3+2], count, isHuge);
            }
            types[i] = 0; // Dead
            colAttr[i*3] = colAttr[i*3+1] = colAttr[i*3+2] = 0; // Hide
            continue;
          }

          // Move
          positions[i*3] += velocities[i*3] * dt * timeScale;
          positions[i*3+1] += velocities[i*3+1] * dt * timeScale;
          positions[i*3+2] += velocities[i*3+2] * dt * timeScale;

          if (types[i] === 1) {
            // Rocket
            velocities[i*3+1] -= 40 * dt * timeScale; // Gravity

            // Spawn trail
            if (Math.random() < 0.4) {
               spawnParticle(positions[i*3], positions[i*3+1], positions[i*3+2], velocities[i*3]*0.1, velocities[i*3+1]*0.1, velocities[i*3+2]*0.1, 1, 0.8, 0.5, 0.4 + Math.random()*0.3, 3, 2.0);
            }
          } else if (types[i] === 2) {
            // Explosion Particle
            velocities[i*3+1] -= 15 * dt * timeScale; // Slightly less gravity so they fly further out
            velocities[i*3] *= 0.99; // Much less air drag so they keep flying
            velocities[i*3+2] *= 0.99;

            // Fade out much slower
            colors[i*3] *= 0.99;
            colors[i*3+1] *= 0.99;
            colors[i*3+2] *= 0.99;

            // Flash white on heavy treble (crackle effect)
            if (trebleNorm > 0.8 && Math.random() > 0.95) {
              colAttr[i*3] = 1; colAttr[i*3+1] = 1; colAttr[i*3+2] = 1;
              sizeAttr[i] = sizes[i] * 2.0;
            } else {
              colAttr[i*3] = colors[i*3];
              colAttr[i*3+1] = colors[i*3+1];
              colAttr[i*3+2] = colors[i*3+2];
              sizeAttr[i] = sizes[i];
            }
          } else if (types[i] === 3) {
            // Trail Particle
            colors[i*3] *= 0.9;
            colors[i*3+1] *= 0.9;
            colors[i*3+2] *= 0.9;
            colAttr[i*3] = colors[i*3];
            colAttr[i*3+1] = colors[i*3+1];
            colAttr[i*3+2] = colors[i*3+2];
          }

          // Update position buffer
          posAttr[i*3] = positions[i*3];
          posAttr[i*3+1] = positions[i*3+1];
          posAttr[i*3+2] = positions[i*3+2];
        }
      }

      particleGeo.attributes.position.needsUpdate = true;
      particleGeo.attributes.aColor.needsUpdate = true;
      particleGeo.attributes.size.needsUpdate = true;

      // Slight camera drift for immersion
      camera.position.x = Math.sin(now * 0.0005) * 10;
      camera.lookAt(0, 60, 0);

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
      groundGeo.dispose();
      groundMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      renderer.dispose();

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#000002]" />
  );
}
