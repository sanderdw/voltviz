import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function CyberMatrix({ stream, settings }: Props) {
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

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // --- Three.js Setup ---
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.03);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    camera.position.set(0, 0, 30);

    // --- Post Processing ---
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.1);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // --- Generate Matrix Data ---
    const particleCount = 20000;
    const lineCount = 10000;
    const size = 60;
    const gridSize = 1.5;

    // Particles
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const particleSizes = new Float32Array(particleCount);

    const colorCyan = new THREE.Color(0x00ffff);
    const colorRed = new THREE.Color(0xff0033);

    for (let i = 0; i < particleCount; i++) {
      const x = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;
      const y = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;
      const z = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;

      particlePos[i * 3] = x;
      particlePos[i * 3 + 1] = y;
      particlePos[i * 3 + 2] = z;

      // Color based on position (cyan left/top, red right/bottom)
      const mixRatio = Math.max(0, Math.min(1, (x - y) / size + 0.5));
      const c = new THREE.Color().lerpColors(colorCyan, colorRed, mixRatio);

      particleColors[i * 3] = c.r;
      particleColors[i * 3 + 1] = c.g;
      particleColors[i * 3 + 2] = c.b;

      particleSizes[i] = Math.random() * 2;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
    particleGeo.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

    const particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uHueShift: { value: 0 }
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        uniform float uAudio;

        void main() {
          vColor = color;
          vec3 pos = position;

          // Slight jitter based on audio
          pos.x += sin(uTime * 2.0 + pos.y) * 0.2 * uAudio;
          pos.y += cos(uTime * 2.0 + pos.x) * 0.2 * uAudio;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + uAudio * 1.5);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uHueShift;

        vec3 hueShift(vec3 color, float hue) {
            const vec3 k = vec3(0.57735, 0.57735, 0.57735);
            float cosAngle = cos(hue);
            return vec3(color * cosAngle + cross(k, color) * sin(hue) + k * dot(k, color) * (1.0 - cosAngle));
        }

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          vec3 shiftedColor = hueShift(vColor, uHueShift);
          float alpha = smoothstep(0.5, 0.1, dist);
          gl_FragColor = vec4(shiftedColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Lines
    const lineGeo = new THREE.BufferGeometry();
    const linePos = new Float32Array(lineCount * 2 * 3);
    const lineColors = new Float32Array(lineCount * 2 * 3);

    for (let i = 0; i < lineCount; i++) {
      const x = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;
      const y = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;
      const z = Math.round((Math.random() - 0.5) * size / gridSize) * gridSize;

      const isHorizontal = Math.random() > 0.5;
      const isDepth = Math.random() > 0.8;
      const length = (Math.floor(Math.random() * 4) + 1) * gridSize;

      let x2 = x;
      let y2 = y;
      let z2 = z;

      if (isDepth) {
        z2 += length;
      } else if (isHorizontal) {
        x2 += length;
      } else {
        y2 += length;
      }

      linePos[i * 6] = x;
      linePos[i * 6 + 1] = y;
      linePos[i * 6 + 2] = z;
      linePos[i * 6 + 3] = x2;
      linePos[i * 6 + 4] = y2;
      linePos[i * 6 + 5] = z2;

      const mixRatio = Math.max(0, Math.min(1, (x - y) / size + 0.5));
      const c = new THREE.Color().lerpColors(colorCyan, colorRed, mixRatio);

      lineColors[i * 6] = c.r;
      lineColors[i * 6 + 1] = c.g;
      lineColors[i * 6 + 2] = c.b;
      lineColors[i * 6 + 3] = c.r;
      lineColors[i * 6 + 4] = c.g;
      lineColors[i * 6 + 5] = c.b;
    }

    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.ShaderMaterial({
      uniforms: {
        uHueShift: { value: 0 },
        uOpacity: { value: 0.3 }
      },
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uHueShift;
        uniform float uOpacity;

        vec3 hueShift(vec3 color, float hue) {
            const vec3 k = vec3(0.57735, 0.57735, 0.57735);
            float cosAngle = cos(hue);
            return vec3(color * cosAngle + cross(k, color) * sin(hue) + k * dot(k, color) * (1.0 - cosAngle));
        }

        void main() {
          vec3 shiftedColor = hueShift(vColor, uHueShift);
          gl_FragColor = vec4(shiftedColor, uOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    // Mouse interaction
    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e: MouseEvent) => {
      const windowHalfX = window.innerWidth / 2;
      const windowHalfY = window.innerHeight / 2;
      mouseX = (e.clientX - windowHalfX) / 100;
      mouseY = (e.clientY - windowHalfY) / 100;
    };
    window.addEventListener('mousemove', onMouseMove);

    const clock = new THREE.Clock();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const currentSettings = settingsRef.current;
      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10 / 255;
      const mid = dataArray.slice(10, 100).reduce((a, b) => a + b, 0) / 90 / 255;
      const treble = dataArray.slice(100, 200).reduce((a, b) => a + b, 0) / 100 / 255;

      const elapsedTime = clock.getElapsedTime() * currentSettings.speed;

      // Update uniforms
      particleMat.uniforms.uTime.value = elapsedTime;
      particleMat.uniforms.uAudio.value = bass * currentSettings.sensitivity;
      particleMat.uniforms.uHueShift.value = (currentSettings.hueShift * Math.PI) / 180;

      lineMat.uniforms.uHueShift.value = (currentSettings.hueShift * Math.PI) / 180;
      lineMat.uniforms.uOpacity.value = 0.1 + treble * 0.4 * currentSettings.sensitivity;

      // Camera movement
      camera.position.x += (mouseX * 15 - camera.position.x) * 0.05;
      camera.position.y += (-mouseY * 15 - camera.position.y) * 0.05;
      camera.lookAt(scene.position);

      // Rotate scene slightly based on audio
      scene.rotation.y = elapsedTime * 0.05 + mid * 0.1 * currentSettings.sensitivity;
      scene.rotation.x = elapsedTime * 0.02;

      // Bloom intensity based on bass
      bloomPass.strength = 1.0 + bass * 2.5 * currentSettings.sensitivity;

      // Scale based on settings
      scene.scale.setScalar(currentSettings.scale);

      composer.render();
    };

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
      window.removeEventListener('mousemove', onMouseMove);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current) audioCtxRef.current.close();

      particleGeo.dispose();
      particleMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-black" />
  );
}
