import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const BASE = {
  timeScale: 0.5,
  waveSpeed: 1.0,
  waveHeight: 1.0,
  wave1Freq: 4.8,
  wave1Amp: 0.038,
  wave2Freq: 0.3,
  wave2Amp: -0.09,
  wave3FreqX: -0.6,
  wave3FreqZ: -0.7,
  wave3Amp: 0.12,
  noiseAmount: 0.004,
  foldingOffset: 9.291,
  stepBase: 0.146,
  glowIntensity: 0.0085,
  glowSpread: 5.1,
};

export default function AuroraWaves({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
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

    // --- Audio ---
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    // Smoothed audio bands
    let sBass = 0;
    let sMid = 0;
    let sTreble = 0;
    let sEnergy = 0;

    // --- Three.js ---
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      iTime: { value: 0.0 },
      iResolution: { value: new THREE.Vector3(w * dpr, h * dpr, 1) },
      uTimeScale: { value: BASE.timeScale },
      uWaveSpeed: { value: BASE.waveSpeed },
      uWaveHeight: { value: BASE.waveHeight },
      uWave1Freq: { value: BASE.wave1Freq },
      uWave1Amp: { value: BASE.wave1Amp },
      uWave2Freq: { value: BASE.wave2Freq },
      uWave2Amp: { value: BASE.wave2Amp },
      uWave3FreqX: { value: BASE.wave3FreqX },
      uWave3FreqZ: { value: BASE.wave3FreqZ },
      uWave3Amp: { value: BASE.wave3Amp },
      uNoiseAmount: { value: BASE.noiseAmount },
      uFoldingOffset: { value: BASE.foldingOffset },
      uStepBase: { value: BASE.stepBase },
      uGlowIntensity: { value: BASE.glowIntensity },
      uGlowSpread: { value: BASE.glowSpread },
      uHue: { value: 0.0 },
    };

    const vertexShader = `
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 iResolution;
      uniform float iTime;

      uniform float uTimeScale;
      uniform float uWaveSpeed;
      uniform float uWaveHeight;

      uniform float uWave1Freq;
      uniform float uWave1Amp;
      uniform float uWave2Freq;
      uniform float uWave2Amp;
      uniform float uWave3FreqX;
      uniform float uWave3FreqZ;
      uniform float uWave3Amp;

      uniform float uNoiseAmount;
      uniform float uFoldingOffset;
      uniform float uStepBase;
      uniform float uGlowIntensity;
      uniform float uGlowSpread;
      uniform float uHue;

      float generateFineNoise(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 8.6231);
        p3 += dot(p3, p3.yzx + 67.92);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 hueRotate(vec3 c, float a) {
        float ca = cos(a);
        float sa = sin(a);
        mat3 m = mat3(
          0.299 + 0.701 * ca + 0.168 * sa, 0.587 - 0.587 * ca + 0.330 * sa, 0.114 - 0.114 * ca - 0.497 * sa,
          0.299 - 0.299 * ca - 0.328 * sa, 0.587 + 0.413 * ca + 0.035 * sa, 0.114 - 0.114 * ca + 0.292 * sa,
          0.299 - 0.300 * ca + 1.250 * sa, 0.587 - 0.588 * ca - 1.050 * sa, 0.114 + 0.886 * ca - 0.203 * sa
        );
        return clamp(m * c, 0.0, 100.0);
      }

      void main() {
        vec2 fragCoord = gl_FragCoord.xy;
        vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;

        vec3 rayDir = normalize(vec3(uv, 1.0));

        vec4 finalColor = vec4(0.0);
        float totalDistance = 0.0;
        float timeElapsed = iTime * uTimeScale;

        float pixelNoise = generateFineNoise(fragCoord) * uNoiseAmount;

        for (int i = 0; i < 38; i++) {
          vec3 currentPos = rayDir * totalDistance;
          currentPos.z -= 2.0;

          float wTime = timeElapsed * uWaveSpeed;
          float waveHeight = (sin(currentPos.x * uWave1Freq + wTime) * uWave1Amp +
                              sin(currentPos.z * uWave2Freq - wTime * 0.6) * uWave2Amp +
                              sin((currentPos.x * uWave3FreqX) - (currentPos.z * uWave3FreqZ) + (wTime * 1.6)) * uWave3Amp) * uWaveHeight;

          float distToWave = abs(currentPos.y - waveHeight);

          currentPos /= uFoldingOffset;

          float stepSize = min(distToWave - 0.080, pixelNoise) + uStepBase;
          totalDistance += stepSize;

          float patternX = sin(currentPos.x + cos(currentPos.y) * cos(currentPos.z));
          float patternY = sin(currentPos.z + sin(currentPos.y) * cos(currentPos.x + timeElapsed));
          float basePattern = smoothstep(0.5, 0.7, patternX * patternY);

          float blendFactor = 0.15 / (distToWave * distToWave + 0.01);
          float mixedPattern = mix(basePattern, 1.0, blendFactor);

          float glow = uGlowIntensity / (uGlowSpread + stepSize);
          float distanceFade = smoothstep(36.5, 7.3, totalDistance);
          vec3 paletteColor = 1.0 + cos(totalDistance * 3.0 + vec3(0.0, 1.0, 2.0));

          finalColor.rgb += glow * mixedPattern * distanceFade * paletteColor;
        }

        if (uHue != 0.0) {
          finalColor.rgb = hueRotate(finalColor.rgb, uHue);
        }

        float dither = (generateFineNoise(fragCoord + vec2(12.34, 56.78)) - 0.5) / 128.0;
        finalColor.rgb += vec3(dither);

        gl_FragColor = vec4(finalColor.rgb, 1.0);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let time = 0;
    let lastTime = performance.now();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const cur = settingsRef.current;
      time += dt * cur.speed;

      analyser.getByteFrequencyData(freqData);

      // Audio bands: bass (low), mid, treble (high)
      const bassEnd = Math.floor(freqBins * 0.06);
      const midEnd = Math.floor(freqBins * 0.25);
      const trebleEnd = Math.floor(freqBins * 0.6);

      let bass = 0;
      for (let i = 2; i < bassEnd; i++) bass += freqData[i];
      bass = bass / Math.max(1, bassEnd - 2) / 255;

      let mid = 0;
      for (let i = bassEnd; i < midEnd; i++) mid += freqData[i];
      mid = mid / Math.max(1, midEnd - bassEnd) / 255;

      let treble = 0;
      for (let i = midEnd; i < trebleEnd; i++) treble += freqData[i];
      treble = treble / Math.max(1, trebleEnd - midEnd) / 255;

      const energy = bass * 0.55 + mid * 0.3 + treble * 0.15;

      // Smooth bands so the visual breathes rather than flickers
      sBass = sBass * 0.78 + bass * 0.22;
      sMid = sMid * 0.82 + mid * 0.18;
      sTreble = sTreble * 0.74 + treble * 0.26;
      sEnergy = sEnergy * 0.8 + energy * 0.2;

      const sens = cur.sensitivity;
      const aBass = sBass * sens;
      const aMid = sMid * sens;
      const aTreble = sTreble * sens;
      const aEnergy = sEnergy * sens;

      uniforms.iTime.value = time;

      // Audio-reactive uniform modulation around the original Shadertoy defaults
      uniforms.uTimeScale.value = BASE.timeScale * (1.0 + aEnergy * 0.35);
      uniforms.uWaveSpeed.value = BASE.waveSpeed * (1.0 + aMid * 0.55);
      uniforms.uWaveHeight.value = BASE.waveHeight * cur.scale * (1.0 + aBass * 0.7);
      uniforms.uWave1Amp.value = BASE.wave1Amp * (1.0 + aBass * 0.9);
      uniforms.uWave2Amp.value = BASE.wave2Amp * (1.0 + aMid * 0.6);
      uniforms.uWave3Amp.value = BASE.wave3Amp * (1.0 + aBass * 0.5 + aMid * 0.3);
      uniforms.uGlowIntensity.value = BASE.glowIntensity * (1.0 + aTreble * 1.6 + aEnergy * 0.4);
      uniforms.uGlowSpread.value = BASE.glowSpread / Math.max(0.4, cur.scale);

      uniforms.uHue.value = (cur.hueShift / 360) * Math.PI * 2;

      renderer.render(scene, camera);
    };

    const onResize = () => {
      if (!containerRef.current) return;
      const nw = containerRef.current.clientWidth;
      const nh = containerRef.current.clientHeight;
      renderer.setSize(nw, nh);
      const pr = renderer.getPixelRatio();
      uniforms.iResolution.value.set(nw * pr, nh * pr, 1);
    };
    window.addEventListener('resize', onResize);

    draw();

    return () => {
      window.removeEventListener('resize', onResize);
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

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
