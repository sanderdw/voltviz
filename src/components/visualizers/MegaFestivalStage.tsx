import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function MegaFestivalStage({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
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
    analyser.smoothingTimeConstant = 0.6; // Faster response for hardstyle/EDM
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010102, 0.004);

    // Camera positioned low in the crowd, looking up at the massive stage
    const camera = new THREE.PerspectiveCamera(70, w / h, 1, 3000);
    camera.position.set(0, 8, 160);
    camera.lookAt(0, 50, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    // --- Stage Architecture (Defqon / Tomorrowland style) ---
    
    // 1. The Central Idol (Massive glowing diamond/crystal)
    const idolGeo = new THREE.OctahedronGeometry(30, 0);
    const idolMat = new THREE.MeshStandardMaterial({ 
      color: 0x222222, 
      emissive: 0x000000,
      roughness: 0.2,
      metalness: 0.8,
      wireframe: true
    });
    const idol = new THREE.Mesh(idolGeo, idolMat);
    idol.position.set(0, 60, -20);
    stageGroup.add(idol);

    const idolInnerGeo = new THREE.OctahedronGeometry(28, 0);
    const idolInnerMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const idolInner = new THREE.Mesh(idolInnerGeo, idolInnerMat);
    idol.add(idolInner);

    // 2. The Wings / Pillars
    const pillarCount = 12;
    const pillars: THREE.Mesh[] = [];
    const pillarGeo = new THREE.BoxGeometry(4, 100, 4);
    
    for (let i = 0; i < pillarCount; i++) {
      const isLeft = i < pillarCount / 2;
      const index = i % (pillarCount / 2);
      
      const pMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000 });
      const pillar = new THREE.Mesh(pillarGeo, pMat);
      
      // Curve them outwards and forwards like wings
      const xOffset = (isLeft ? -1 : 1) * (40 + index * 15);
      const zOffset = -20 + index * 10;
      const height = 80 - index * 10;
      
      pillar.scale.y = height / 100;
      pillar.position.set(xOffset, height / 2, zOffset);
      
      // Tilt them slightly outward
      pillar.rotation.z = (isLeft ? 1 : -1) * 0.1 * index;
      
      stageGroup.add(pillar);
      pillars.push(pillar);
    }

    // --- The Crowd (Shader-based for jumping animation) ---
    const crowdCount = 6000;
    const crowdGeo = new THREE.BufferGeometry();
    const crowdPos = new Float32Array(crowdCount * 3);
    const crowdRandom = new Float32Array(crowdCount);
    
    for (let i = 0; i < crowdCount; i++) {
      crowdPos[i * 3] = (Math.random() - 0.5) * 300; // x
      crowdPos[i * 3 + 1] = 0; // y (base)
      crowdPos[i * 3 + 2] = 20 + Math.random() * 200; // z (depth into camera)
      crowdRandom[i] = Math.random();
    }
    
    crowdGeo.setAttribute('position', new THREE.BufferAttribute(crowdPos, 3));
    crowdGeo.setAttribute('aRandom', new THREE.BufferAttribute(crowdRandom, 1));

    const crowdMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uColor: { value: new THREE.Color(0x111111) }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uBass;
        attribute float aRandom;
        
        void main() {
          vec3 pos = position;
          // Make the crowd jump to the bass
          float jump = max(0.0, sin(uTime * 15.0 + aRandom * 6.28)) * uBass * 4.0;
          pos.y += jump + aRandom * 2.0; // Base height + jump
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = (4.0 + aRandom * 3.0) * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          vec2 xy = gl_PointCoord.xy - vec2(0.5);
          if (length(xy) > 0.5) discard;
          gl_FragColor = vec4(uColor, 1.0);
        }
      `
    });
    const crowd = new THREE.Points(crowdGeo, crowdMat);
    stageGroup.add(crowd);

    // --- Lasers (Massive Banks) ---
    const laserCount = 400;
    const laserGeo = new THREE.CylinderGeometry(0.2, 0.8, 1000, 4);
    laserGeo.translate(0, 500, 0);
    laserGeo.rotateX(Math.PI / 2);

    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const laserMesh = new THREE.InstancedMesh(laserGeo, laserMat, laserCount);
    stageGroup.add(laserMesh);

    const laserData: { pos: THREE.Vector3, baseRot: THREE.Euler, speed: number, phase: number, bank: number }[] = [];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < laserCount; i++) {
      let x, y, z, rx, ry, rz, bank;
      
      if (i < 100) {
        // Center Idol Lasers (shooting out in a starburst)
        x = 0; y = 60; z = -20;
        rx = (Math.random() - 0.5) * Math.PI;
        ry = (Math.random() - 0.5) * Math.PI;
        rz = 0;
        bank = 0;
      } else if (i < 250) {
        // Left Wing Lasers (Fan)
        x = -60 - Math.random() * 40; y = 10 + Math.random() * 60; z = -10;
        rx = -0.2 + (Math.random() - 0.5) * 0.4;
        ry = Math.PI / 4 + (Math.random() - 0.5) * 0.8;
        rz = 0;
        bank = 1;
      } else {
        // Right Wing Lasers (Fan)
        x = 60 + Math.random() * 40; y = 10 + Math.random() * 60; z = -10;
        rx = -0.2 + (Math.random() - 0.5) * 0.4;
        ry = -Math.PI / 4 + (Math.random() - 0.5) * 0.8;
        rz = 0;
        bank = 2;
      }

      laserData.push({
        pos: new THREE.Vector3(x, y, z),
        baseRot: new THREE.Euler(rx, ry, rz),
        speed: 0.2 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        bank
      });
    }

    // --- Pyrotechnics (Fire Jets) ---
    const fireCount = 20;
    const fireGeo = new THREE.CylinderGeometry(1, 3, 40, 8);
    fireGeo.translate(0, 20, 0);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const fireMesh = new THREE.InstancedMesh(fireGeo, fireMat, fireCount);
    stageGroup.add(fireMesh);
    
    const fireData: { x: number, z: number, active: number }[] = [];
    for (let i = 0; i < fireCount; i++) {
      fireData.push({
        x: (i - fireCount/2) * 12,
        z: 10 + Math.random() * 10,
        active: 0
      });
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x111111);
    scene.add(ambientLight);

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
    let beatTimer = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      
      const currentSettings = settingsRef.current;
      time += dt * currentSettings.speed;
      if (beatTimer > 0) beatTimer -= dt;

      analyser.getByteFrequencyData(dataArray);

      // Hardstyle/EDM frequency bands
      const bass = dataArray.slice(0, 6).reduce((a, b) => a + b, 0) / 6; // Kicks
      const mid = dataArray.slice(6, 40).reduce((a, b) => a + b, 0) / 34; // Synths/Vocals
      const treble = dataArray.slice(40, 150).reduce((a, b) => a + b, 0) / 110; // Hats/Cymbals

      const bassNorm = bass / 255;
      const midNorm = mid / 255;
      const trebleNorm = treble / 255;

      // 1. Camera Shake (Heavy impact on kicks)
      if (bassNorm > 0.85 * (1.5 - currentSettings.sensitivity)) {
        const shakeAmt = (bassNorm - 0.8) * 10;
        camera.position.x = (Math.random() - 0.5) * shakeAmt;
        camera.position.y = 8 + (Math.random() - 0.5) * shakeAmt;
      } else {
        camera.position.x += (0 - camera.position.x) * 0.1;
        camera.position.y += (8 - camera.position.y) * 0.1;
      }

      // 2. The Idol (Pulsing and Rotating)
      idol.rotation.y = time * 0.5;
      idol.rotation.z = Math.sin(time * 0.2) * 0.2;
      const idolScale = 1 + Math.pow(bassNorm, 3) * 0.5 * currentSettings.scale;
      idol.scale.setScalar(idolScale);
      
      const mainHue = (time * 0.1 + currentSettings.hueShift / 360) % 1.0;
      idolInnerMat.color.setHSL(mainHue, 1.0, bassNorm * 0.5);
      idolMat.emissive.setHSL(mainHue, 1.0, bassNorm * 0.8);

      // 3. Pillars (LED Strips effect)
      pillars.forEach((pillar, i) => {
        const pMat = pillar.material as THREE.MeshStandardMaterial;
        if (trebleNorm > 0.5 && i % 2 === Math.floor(time * 10) % 2) {
          pMat.emissive.setHSL((mainHue + i * 0.05) % 1.0, 1.0, trebleNorm);
        } else {
          pMat.emissive.setHex(0x000000);
        }
      });

      // 4. Crowd Jumping
      crowdMat.uniforms.uTime.value = time;
      crowdMat.uniforms.uBass.value = Math.pow(bassNorm, 4) * currentSettings.sensitivity;
      // Crowd gets lit up by the stage
      crowdMat.uniforms.uColor.value.setHSL(mainHue, 0.5, 0.1 + midNorm * 0.3);

      // 5. Lasers
      for (let i = 0; i < laserCount; i++) {
        const lData = laserData[i];
        
        dummy.position.copy(lData.pos);
        dummy.rotation.copy(lData.baseRot);
        
        // Aggressive sweeping motion
        const sweep = Math.sin(time * lData.speed * 2.0 + lData.phase) * 1.2 * midNorm * currentSettings.sensitivity;
        
        if (lData.bank === 0) {
          // Center bursts outward
          dummy.rotation.x += sweep * 0.5;
          dummy.rotation.y += sweep * 0.5;
        } else if (lData.bank === 1) {
          dummy.rotation.y += sweep; // Left wing sweeps right
        } else {
          dummy.rotation.y -= sweep; // Right wing sweeps left
        }

        // Length pulses with audio
        const laserLength = 0.1 + Math.pow(midNorm, 2) * 3.0 * currentSettings.scale;
        dummy.scale.set(1, 1, laserLength);
        
        dummy.updateMatrix();
        laserMesh.setMatrixAt(i, dummy.matrix);

        // Colors: Defqon style (Lots of Red/Orange/Yellow, mixed with user hue)
        let lHue = mainHue;
        if (lData.bank === 1) lHue = (mainHue - 0.1 + 1.0) % 1.0;
        if (lData.bank === 2) lHue = (mainHue + 0.1) % 1.0;
        
        // Flash to white on heavy treble
        const isStrobe = trebleNorm > 0.8 && Math.random() > 0.8;
        if (isStrobe) {
          color.setHSL(0, 0, 1);
        } else {
          const lLightness = 0.1 + Math.pow(midNorm, 2) * 0.9;
          color.setHSL(lHue, 1.0, lLightness);
        }
        laserMesh.setColorAt(i, color);
      }
      laserMesh.instanceMatrix.needsUpdate = true;
      if (laserMesh.instanceColor) laserMesh.instanceColor.needsUpdate = true;

      // 6. Pyrotechnics (Fire Jets)
      // Trigger fire on massive bass drops
      if (bassNorm > 0.9 * (1.5 - currentSettings.sensitivity) && beatTimer <= 0) {
        beatTimer = 0.4; // Cooldown
        // Ignite random jets
        fireData.forEach(f => {
          if (Math.random() > 0.5) f.active = 1.0;
        });
      }

      for (let i = 0; i < fireCount; i++) {
        const f = fireData[i];
        if (f.active > 0) {
          f.active -= dt * 2.0; // Fade out quickly
          if (f.active < 0) f.active = 0;
        }

        dummy.position.set(f.x, 0, f.z);
        // Fire shoots up
        dummy.scale.set(1 + f.active, f.active * 1.5 * currentSettings.scale, 1 + f.active);
        dummy.updateMatrix();
        fireMesh.setMatrixAt(i, dummy.matrix);
        
        // Fire color (Yellow to Red to Black)
        color.setHSL(0.05 + f.active * 0.1, 1.0, f.active * 0.6);
        fireMesh.setColorAt(i, color);
      }
      fireMesh.instanceMatrix.needsUpdate = true;
      if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

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
      idolGeo.dispose();
      idolMat.dispose();
      idolInnerGeo.dispose();
      idolInnerMat.dispose();
      pillarGeo.dispose();
      crowdGeo.dispose();
      crowdMat.dispose();
      laserGeo.dispose();
      laserMat.dispose();
      fireGeo.dispose();
      fireMat.dispose();
      renderer.dispose();
      
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#010102]" />
  );
}
