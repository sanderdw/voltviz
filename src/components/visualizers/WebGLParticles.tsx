import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function WebGLParticles({ stream, settings }: Props) {
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
    audioCtx.resume();
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
    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.z = 120;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance

    // Clear any existing canvases (React StrictMode workaround)
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // Audio Texture (1D array passed as a 2D texture with height 1)
    const dataTexture = new THREE.DataTexture(dataArray, bufferLength, 1, THREE.RedFormat);
    dataTexture.needsUpdate = true;

    // Particles Geometry
    const particleCount = 60000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Create a sphere of particles, biased towards the center
      const r = 20 + Math.pow(Math.random(), 2) * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      randoms[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

    // Custom Shader Material for 100% GPU Acceleration
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: dataTexture },
        uHueShift: { value: 0 },
        uScale: { value: 1 },
        uSensitivity: { value: 1 }
      },
      vertexShader: `
        uniform float uTime;
        uniform sampler2D uAudio;
        uniform float uScale;
        uniform float uSensitivity;

        attribute float aRandom;

        varying float vAudio;
        varying float vRandom;

        void main() {
          vRandom = aRandom;

          // Sample audio based on random value (so different particles react to different frequencies)
          // We sample from the lower half of the frequencies for more impact
          vec4 audioData = texture2D(uAudio, vec2(aRandom * 0.5, 0.5));
          float audioVol = audioData.r;
          vAudio = audioVol;

          vec3 pos = position;
          vec3 dir = normalize(pos);

          // Swirling motion
          float angleX = uTime * (0.1 + aRandom * 0.2);
          float angleY = uTime * (0.15 + aRandom * 0.1);

          mat2 rotX = mat2(cos(angleX), -sin(angleX), sin(angleX), cos(angleX));
          mat2 rotY = mat2(cos(angleY), -sin(angleY), sin(angleY), cos(angleY));

          pos.yz = rotX * pos.yz;
          pos.xz = rotY * pos.xz;

          // Audio displacement (explode outwards)
          pos += dir * (audioVol * 80.0 * uSensitivity * uScale);

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

          // Size attenuation based on depth and audio
          gl_PointSize = (2.0 + audioVol * 6.0) * (150.0 / -mvPosition.z) * uScale;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uHueShift;

        varying float vAudio;
        varying float vRandom;

        vec3 hsl2rgb(vec3 c) {
            vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
            return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
        }

        void main() {
          // Circular particle
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          // Color based on random value, time, and hue shift
          float hue = mod(vRandom * 0.5 + uTime * 0.05 + uHueShift / 360.0, 1.0);

          // Increase lightness and saturation when loud
          float saturation = 0.8 + vAudio * 0.2;
          float lightness = 0.4 + vAudio * 0.4;

          vec3 color = hsl2rgb(vec3(hue, saturation, lightness));

          // Soft glowing edge
          float alpha = smoothstep(0.5, 0.1, dist) * (0.3 + vAudio * 0.7);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

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
      dataTexture.needsUpdate = true;

      // Update uniforms
      material.uniforms.uTime.value = time;
      material.uniforms.uHueShift.value = currentSettings.hueShift;
      material.uniforms.uScale.value = currentSettings.scale;
      material.uniforms.uSensitivity.value = currentSettings.sensitivity;

      // Gentle camera movement
      camera.position.x = Math.sin(time * 0.5) * 30;
      camera.position.y = Math.cos(time * 0.3) * 30;
      camera.lookAt(scene.position);

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

      // Cleanup Three.js resources
      geometry.dispose();
      material.dispose();
      dataTexture.dispose();
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
