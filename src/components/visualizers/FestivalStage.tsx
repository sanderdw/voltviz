import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function FestivalStage({ stream, settings }: Props) {
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
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020205, 0.003);

    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 2000);
    camera.position.set(0, 15, 120);
    camera.lookAt(0, 30, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // --- Stage Elements ---
    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    stageGroup.add(ground);

    // Audience (Silhouettes)
    const audienceGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const audienceMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const audienceMesh = new THREE.InstancedMesh(audienceGeo, audienceMat, 2000);

    const audDummy = new THREE.Object3D();
    for(let i=0; i<2000; i++) {
      audDummy.position.set((Math.random()-0.5)*200, 0.8 + Math.random()*0.5, 30 + Math.random()*150);
      audDummy.updateMatrix();
      audienceMesh.setMatrixAt(i, audDummy.matrix);
    }
    stageGroup.add(audienceMesh);

    // Central Emblem / Screen
    const screenGeo = new THREE.PlaneGeometry(80, 50);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
    //const screen = new THREE.Mesh(screenGeo, screenMat);
    //screen.position.set(0, 35, -20);
    //stageGroup.add(screen);

    // --- Lasers ---
    const laserCount = 150;
    const laserGeo = new THREE.CylinderGeometry(0.15, 0.6, 1000, 8);
    laserGeo.translate(0, 500, 0);
    laserGeo.rotateX(Math.PI / 2); // Point along Z

    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const laserMesh = new THREE.InstancedMesh(laserGeo, laserMat, laserCount);
    stageGroup.add(laserMesh);

    const laserData: { pos: THREE.Vector3, baseRot: THREE.Euler, speed: number, phase: number, color: THREE.Color, bank: number }[] = [];

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Create laser banks
    for (let i = 0; i < laserCount; i++) {
      let x, y, z;
      let rx, ry, rz;
      let bank;

      if (i < 50) {
        // Left bank (bottom)
        x = -40 - Math.random() * 20; y = 5 + Math.random() * 15; z = -10;
        rx = (Math.random() - 0.5) * 0.2;
        ry = Math.PI / 3 + (Math.random() - 0.5) * 0.4;
        rz = 0;
        bank = 0;
      } else if (i < 100) {
        // Right bank (bottom)
        x = 40 + Math.random() * 20; y = 5 + Math.random() * 15; z = -10;
        rx = (Math.random() - 0.5) * 0.2;
        ry = -Math.PI / 3 + (Math.random() - 0.5) * 0.4;
        rz = 0;
        bank = 1;
      } else {
        // Center/Top bank
        x = (Math.random() - 0.5) * 60; y = 50 + Math.random() * 20; z = -15;
        rx = Math.PI / 8 + (Math.random() - 0.5) * 0.3;
        ry = (Math.random() - 0.5) * 1.2;
        rz = 0;
        bank = 2;
      }

      laserData.push({
        pos: new THREE.Vector3(x, y, z),
        baseRot: new THREE.Euler(rx, ry, rz),
        speed: 0.5 + Math.random() * 2.0,
        phase: Math.random() * Math.PI * 2,
        color: new THREE.Color(),
        bank
      });
    }

    // --- Particles (Fireworks/Pyro) ---
    const maxParticles = 8000;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(maxParticles * 3);
    const particleColors = new Float32Array(maxParticles * 3);
    const particleSizes = new Float32Array(maxParticles);

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
    particleGeo.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

    const particleShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 xy = gl_PointCoord.xy - vec2(0.5);
          float ll = length(xy);
          if (ll > 0.5) discard;
          float alpha = (0.5 - ll) * 2.0;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particleSystem = new THREE.Points(particleGeo, particleShaderMat);
    stageGroup.add(particleSystem);

    const particles: { pos: THREE.Vector3, vel: THREE.Vector3, life: number, maxLife: number, color: THREE.Color, size: number }[] = [];

    // --- Spotlights / Strobes ---
    const strobes: THREE.PointLight[] = [];
    for (let i = 0; i < 8; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 300);
      light.position.set((i - 3.5) * 15, 10, -5);
      stageGroup.add(light);
      strobes.push(light);
    }

    scene.add(new THREE.AmbientLight(0x111122, 0.5));

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
    let beatCooldown = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const currentSettings = settingsRef.current;
      time += dt * currentSettings.speed;
      if (beatCooldown > 0) beatCooldown -= dt;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const mid = dataArray.slice(4, 30).reduce((a, b) => a + b, 0) / 26;
      const treble = dataArray.slice(30, 100).reduce((a, b) => a + b, 0) / 70;

      const bassNorm = bass / 255;
      const midNorm = mid / 255;
      const trebleNorm = treble / 255;

      // Camera shake on heavy bass
      if (bassNorm > 0.85 * (1.5 - currentSettings.sensitivity)) {
        camera.position.x = (Math.random() - 0.5) * 3 * bassNorm;
        camera.position.y = 15 + (Math.random() - 0.5) * 3 * bassNorm;
      } else {
        camera.position.x += (0 - camera.position.x) * 0.1;
        camera.position.y += (15 - camera.position.y) * 0.1;
      }

      // Update Screen
      const screenHue = (time * 0.1 + currentSettings.hueShift / 360) % 1.0;
      screenMat.color.setHSL(screenHue, 0.8, midNorm * 0.6);

      // Update Strobes
      strobes.forEach((strobe, i) => {
        if (trebleNorm > 0.65 && Math.random() > 0.7) {
          strobe.intensity = 10 * trebleNorm * currentSettings.sensitivity;
          strobe.color.setHSL((screenHue + i * 0.1) % 1.0, 1.0, 0.6);
        } else {
          strobe.intensity *= 0.8; // Fade out
        }
      });

      // Update Lasers
      for (let i = 0; i < laserCount; i++) {
        const lData = laserData[i];

        // Movement sweep
        const sweep = Math.sin(time * lData.speed + lData.phase) * 0.8 * midNorm * currentSettings.sensitivity;

        dummy.position.copy(lData.pos);
        dummy.rotation.copy(lData.baseRot);

        if (lData.bank === 0) dummy.rotation.y += sweep;
        else if (lData.bank === 1) dummy.rotation.y -= sweep;
        else dummy.rotation.x += sweep;

        // Scale based on audio (lasers shoot out on beat)
        const laserLength = 0.1 + midNorm * 2.0 * currentSettings.scale;
        dummy.scale.set(1, 1, laserLength);

        dummy.updateMatrix();
        laserMesh.setMatrixAt(i, dummy.matrix);

        // Color (Green for left, Blue for right, Mix for center)
        let lHue;
        if (lData.bank === 0) lHue = 120 / 360; // Green
        else if (lData.bank === 1) lHue = 240 / 360; // Blue
        else lHue = (Math.random() > 0.5 ? 120 : 240) / 360; // Mix

        lHue = (lHue + currentSettings.hueShift / 360) % 1.0;

        const lLightness = 0.1 + Math.pow(midNorm, 2) * 0.8;
        color.setHSL(lHue, 1.0, lLightness);
        laserMesh.setColorAt(i, color);
      }
      laserMesh.instanceMatrix.needsUpdate = true;
      if (laserMesh.instanceColor) laserMesh.instanceColor.needsUpdate = true;

      // Spawn Pyro/Fireworks on Bass
      if (bassNorm > 0.8 * (1.5 - currentSettings.sensitivity) && beatCooldown <= 0) {
        beatCooldown = 0.2; // Prevent spawning every frame

        const numSparks = 100 + Math.random() * 150;
        const spawnPoints = [-30, -15, 0, 15, 30];
        const originX = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

        for (let i = 0; i < numSparks; i++) {
          if (particles.length >= maxParticles) break;

          const angleX = (Math.random() - 0.5) * 0.6; // Mostly up
          const angleZ = (Math.random() - 0.5) * 0.6;
          const speed = 50 + Math.random() * 70;

          particles.push({
            pos: new THREE.Vector3(originX + (Math.random()-0.5)*3, 5, -5 + (Math.random()-0.5)*3),
            vel: new THREE.Vector3(angleX * speed, speed, angleZ * speed),
            life: 0,
            maxLife: 1.0 + Math.random() * 1.5,
            color: new THREE.Color().setHSL((screenHue + Math.random() * 0.2) % 1.0, 1.0, 0.7),
            size: 4 + Math.random() * 6
          });
        }
      }

      // Update Particles
      let pCount = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        // Gravity
        p.vel.y -= 50 * dt;
        // Drag
        p.vel.multiplyScalar(0.98);

        p.pos.addScaledVector(p.vel, dt);

        particlePositions[pCount * 3] = p.pos.x;
        particlePositions[pCount * 3 + 1] = p.pos.y;
        particlePositions[pCount * 3 + 2] = p.pos.z;

        const lifeRatio = p.life / p.maxLife;
        // Fade out
        const alpha = 1.0 - Math.pow(lifeRatio, 2);

        particleColors[pCount * 3] = p.color.r * alpha;
        particleColors[pCount * 3 + 1] = p.color.g * alpha;
        particleColors[pCount * 3 + 2] = p.color.b * alpha;

        particleSizes[pCount] = p.size * (1.0 - lifeRatio * 0.5) * currentSettings.scale;

        pCount++;
      }

      particleGeo.setDrawRange(0, pCount);
      particleGeo.attributes.position.needsUpdate = true;
      particleGeo.attributes.color.needsUpdate = true;
      particleGeo.attributes.size.needsUpdate = true;

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
      audienceGeo.dispose();
      audienceMat.dispose();
      screenGeo.dispose();
      screenMat.dispose();
      laserGeo.dispose();
      laserMat.dispose();
      particleGeo.dispose();
      particleShaderMat.dispose();
      renderer.dispose();

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#020205]" />
  );
}
