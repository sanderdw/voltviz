import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uMaxSteps;
  uniform int uFoldSteps;
  uniform float uKifsScale;
  uniform float uKifsOffset;
  uniform float uTextureScale;
  uniform float uBrightness;
  uniform float uSphereRadius;
  uniform float uInnerRadius;
  uniform vec3 uSphereCenter;
  uniform vec3 uBaseColor;
  uniform float uLightSpeed;
  uniform float uAutoRotationSpeed;
  uniform float uZoom;

  mat2 rotate2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  vec2 intersectSphere(vec3 rayOrigin, vec3 rayDir, vec3 center, float radius) {
    vec3 oc = rayOrigin - center;
    float b = dot(oc, rayDir);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    vec2 uvCenter = (2.0 * gl_FragCoord.xy - uResolution.xy) / uResolution.y;

    vec3 rayOriginWorld = vec3(0.0, 0.0, 0.0);
    vec3 rayDirectionWorld = normalize(vec3(uvCenter * uZoom, -1.0));

    vec3 localRayOrigin = rayOriginWorld - uSphereCenter;
    vec3 localRayDirection = rayDirectionWorld;

    vec2 hitOuter = intersectSphere(localRayOrigin, localRayDirection, vec3(0.0), uSphereRadius);

    if (hitOuter.x < 0.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    float tStart = max(0.0, hitOuter.x);
    float tEnd = hitOuter.y;

    float stepSize = (tEnd - tStart) / float(uMaxSteps);
    float currentDistance = tStart;

    vec4 accumulatedColor = vec4(0.0);

    for (int i = 0; i < 250; i++) {
      if (i >= uMaxSteps) break;

      vec3 localPos = localRayOrigin + localRayDirection * currentDistance;
      float distFromCenter = length(localPos);

      float wallMask = smoothstep(uInnerRadius, uInnerRadius + 1.0, distFromCenter)
                     * smoothstep(uSphereRadius, uSphereRadius - 0.2, distFromCenter);

      if (wallMask > 0.01) {
        vec3 currentPos = localPos * uTextureScale;

        currentPos.xy *= rotate2D(uTime * 0.15 * uAutoRotationSpeed);
        currentPos.xz *= rotate2D(uTime * 0.10 * uAutoRotationSpeed);

        currentPos = abs(currentPos);

        float timeVal = 2.6 + float(i) * 0.356;
        vec3 reflectionAxis = normalize(tan(timeVal + vec3(2.5, 1.0, 0.0)));
        currentPos = reflect(-currentPos, reflectionAxis) - vec3(-2.6, -1.0, 0.2);

        float accumulatedScale = 0.1;

        if (currentPos.x < currentPos.z) {
          currentPos = currentPos.zyx;
        }

        for (int k = 0; k < 16; k++) {
          if (k >= uFoldSteps) break;
          currentPos *= uKifsScale;
          accumulatedScale *= uKifsScale;
          currentPos.y += uKifsOffset;

          if (currentPos.y > currentPos.z) currentPos = currentPos.xzy;

          currentPos *= uKifsScale;
          accumulatedScale *= uKifsScale;
          currentPos.y += uKifsOffset;

          if (currentPos.x < currentPos.y) currentPos = currentPos.yxz;
        }

        float currentDensity = max(length(currentPos.xz) / accumulatedScale, 0.001);

        vec3 spatialPhase = currentPos.xyz;
        vec3 lightIntensity = exp(sin(uTime * uLightSpeed + spatialPhase)) / currentDensity;

        accumulatedColor.rgb += uBaseColor * lightIntensity * stepSize * uBrightness * wallMask;
      }

      currentDistance += stepSize;
    }

    gl_FragColor.rgb = tanh(accumulatedColor.rgb);
    gl_FragColor.a = 1.0;

    vec3 localHitPoint = localRayOrigin + localRayDirection * hitOuter.x;
    vec3 surfaceNormalLocal = normalize(localHitPoint);
    float edgeHighlight = 0.7 - max(dot(-localRayDirection, surfaceNormalLocal), 0.5);
    gl_FragColor.rgb += uBaseColor * 0.08 * pow(edgeHighlight, 4.0);
  }
`;

export default function AnunakiSphere({ stream, settings }: Props) {
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

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;

    const kickAnalyser = audioCtx.createAnalyser();
    kickAnalyser.fftSize = 4096;
    kickAnalyser.smoothingTimeConstant = 0.2;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(kickAnalyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    const kickBins = kickAnalyser.frequencyBinCount;
    const kickFreqData = new Uint8Array(kickBins);
    const prevKickFreqData = new Float32Array(kickBins);
    let lastKickTime = 0;
    const fluxHistory: number[] = [];
    const KICK_COOLDOWN = 120;
    const FLUX_HISTORY_SIZE = 60;

    const DPR = Math.min(window.devicePixelRatio, 1.0) * 0.8;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(DPR);
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const BASE_KIFS_SCALE = 1.26;
    const BASE_KIFS_OFFSET = 8.9;
    const BASE_TEXTURE_SCALE = 1.45;
    const BASE_BRIGHTNESS = 1.423;
    const BASE_LIGHT_SPEED = 5.5;
    const BASE_AUTO_SPIN = 1.0;
    const BASE_COLOR_BOOST = 3.0;
    const MAX_STEPS = 148;
    const FOLD_STEPS = 6;
    const SPHERE_RADIUS = 15.0;
    const INNER_RADIUS = 14.0;
    const SPHERE_CENTER_Z = -25.0;

    const baseColor = new THREE.Color('#7780ff');
    const baseHSL = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(baseHSL);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(w * DPR, h * DPR) },
      uTime: { value: 0.0 },
      uMaxSteps: { value: MAX_STEPS },
      uFoldSteps: { value: FOLD_STEPS },
      uKifsScale: { value: BASE_KIFS_SCALE },
      uKifsOffset: { value: BASE_KIFS_OFFSET },
      uTextureScale: { value: BASE_TEXTURE_SCALE },
      uBrightness: { value: BASE_BRIGHTNESS },
      uSphereRadius: { value: SPHERE_RADIUS },
      uInnerRadius: { value: INNER_RADIUS },
      uSphereCenter: { value: new THREE.Vector3(0.0, 0.0, SPHERE_CENTER_Z) },
      uBaseColor: { value: new THREE.Vector3() },
      uLightSpeed: { value: BASE_LIGHT_SPEED },
      uAutoRotationSpeed: { value: BASE_AUTO_SPIN },
      uZoom: { value: 1.0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const tmpColor = new THREE.Color();
    const clock = new THREE.Clock();
    let smoothedBass = 0;
    let smoothedMids = 0;
    let smoothedHighs = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const now = performance.now();

      analyser.getByteFrequencyData(freqData);
      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      const subBassEnd = Math.min(Math.floor(60 / binHz), freqBins);
      const bassEnd = Math.min(Math.floor(250 / binHz), freqBins);
      const midEnd = Math.min(Math.floor(2000 / binHz), freqBins);
      const highMidEnd = Math.min(Math.floor(6000 / binHz), freqBins);

      const bandEnergy = (start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += freqData[i];
        return end > start ? sum / ((end - start) * 255) : 0;
      };

      const subBass = bandEnergy(0, subBassEnd) * s.sensitivity;
      const bass = bandEnergy(subBassEnd, bassEnd) * s.sensitivity;
      const mids = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highMids = bandEnergy(midEnd, highMidEnd) * s.sensitivity;
      const highs = bandEnergy(highMidEnd, freqBins) * s.sensitivity;

      smoothedBass += ((subBass + bass) * 0.5 - smoothedBass) * 0.2;
      smoothedMids += (mids - smoothedMids) * 0.15;
      smoothedHighs += ((highMids + highs) * 0.5 - smoothedHighs) * 0.15;

      kickAnalyser.getByteFrequencyData(kickFreqData);
      const kickBinHz = sampleRate / kickAnalyser.fftSize;
      const kickSubBassStart = Math.max(1, Math.floor(20 / kickBinHz));
      const kickSubBassEnd = Math.min(Math.floor(60 / kickBinHz), kickBins);
      const kickSubBassBins = Math.max(1, kickSubBassEnd - kickSubBassStart);

      let flux = 0;
      for (let i = kickSubBassStart; i < kickSubBassEnd; i++) {
        const diff = kickFreqData[i] - prevKickFreqData[i];
        if (diff > 0) flux += diff;
      }
      flux /= kickSubBassBins * 255;

      let kickSubBassEnergy = 0;
      for (let i = kickSubBassStart; i < kickSubBassEnd; i++) {
        kickSubBassEnergy += kickFreqData[i];
      }
      kickSubBassEnergy /= kickSubBassBins * 255;

      for (let i = 0; i < kickBins; i++) prevKickFreqData[i] = kickFreqData[i];

      fluxHistory.push(flux);
      if (fluxHistory.length > FLUX_HISTORY_SIZE) fluxHistory.shift();
      const meanFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
      const stdFlux = Math.sqrt(
        fluxHistory.reduce((a, b) => a + (b - meanFlux) ** 2, 0) / fluxHistory.length
      );
      const sortedFlux = [...fluxHistory].sort((a, b) => a - b);
      const medianFlux = sortedFlux[Math.floor(sortedFlux.length / 2)] || 0;
      const kickThreshold = medianFlux + stdFlux * 1.2 + 0.02;

      const SUB_BASS_GATE = 0.10;
      const isKick =
        flux > kickThreshold &&
        kickSubBassEnergy > SUB_BASS_GATE &&
        now - lastKickTime > KICK_COOLDOWN;
      if (isKick) lastKickTime = now;
      const kickFlash = Math.max(0, 1 - (now - lastKickTime) / 200);

      const delta = clock.getDelta();

      uniforms.uTime.value += delta * s.speed;
      uniforms.uAutoRotationSpeed.value = BASE_AUTO_SPIN * s.speed * (1.0 + smoothedMids * 0.3);
      uniforms.uLightSpeed.value = BASE_LIGHT_SPEED * s.speed * (1.0 + smoothedMids * 0.5);
      uniforms.uKifsScale.value = BASE_KIFS_SCALE + smoothedBass * 0.04 + kickFlash * 0.03;
      uniforms.uTextureScale.value = BASE_TEXTURE_SCALE + smoothedHighs * 0.25;
      uniforms.uBrightness.value = BASE_BRIGHTNESS * (1.0 + smoothedBass * 0.6) + kickFlash * 1.2;

      const scaleClamped = Math.max(0.5, Math.min(3.0, s.scale));
      uniforms.uZoom.value = 1.0 / scaleClamped;

      const hueDelta = s.hueShift / 360;
      tmpColor.setHSL((baseHSL.h + hueDelta + 1) % 1, baseHSL.s, baseHSL.l);
      uniforms.uBaseColor.value.set(
        tmpColor.r * BASE_COLOR_BOOST,
        tmpColor.g * BASE_COLOR_BOOST,
        tmpColor.b * BASE_COLOR_BOOST
      );

      renderer.render(scene, camera);
    };

    draw();

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      uniforms.uResolution.value.set(width * DPR, height * DPR);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      kickAnalyser.disconnect();
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
