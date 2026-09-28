import * as THREE from 'three';
import { beatHit, beatStrength } from '../lib/audio';
import { createRenderer, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_flightSpeed;
  uniform float u_camPosY;
  uniform float u_camPitch;
  uniform vec3 u_dotColor;
  uniform vec3 u_scanColor;
  uniform vec3 u_buildingColor;
  uniform float u_dotDensity;
  uniform float u_fogDensity;
  uniform float u_scanPhase;
  uniform float u_scanPulse;
  uniform float u_lightFlash;
  uniform float u_planeFlash;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float map(vec3 p) {
    vec2 id = floor(p.xz);
    vec2 f = fract(p.xz) - 0.5;

    float d = p.y;

    for(int j = -1; j <= 1; j++) {
      for(int i = -1; i <= 1; i++) {
        vec2 offset = vec2(float(i), float(j));
        vec2 nId = id + offset;
        vec2 nF = f - offset;

        float height = hash(nId) * 4.0 + 1.0;

        vec3 q = vec3(nF.x, p.y - height * 0.5, nF.y);
        vec3 boxSize = vec3(0.35, height * 0.5, 0.35);

        vec3 distVec = abs(q) - boxSize;
        float boxDist = length(max(distVec, 0.0)) + min(max(distVec.x, max(distVec.y, distVec.z)), 0.0);

        d = min(d, boxDist);
      }
    }

    return d;
  }

  vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.005, 0.0);
    return normalize(vec3(
      map(p + e.xyy) - map(p - e.xyy),
      map(p + e.yxy) - map(p - e.yxy),
      map(p + e.yyx) - map(p - e.yyx)
    ));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

    vec3 rayOrigin = vec3(0.0, u_camPosY, u_time * u_flightSpeed);
    vec3 rayDir = normalize(vec3(uv.x, uv.y - u_camPitch, 1.0));

    float distance = 0.0;
    vec3 p;

    for (int i = 0; i < 150; i++) {
      p = rayOrigin + rayDir * distance;
      float d = map(p);

      if (abs(d) < 0.001 || distance > 100.0) break;
      distance += d * 0.75;
    }

    vec3 fogColor = u_dotColor * 0.7;
    vec3 color = fogColor - uv.y * 0.2;

    float cycle = u_scanPhase;
    float scanY = (cycle < 4.0) ? (6.0 - cycle * 1.75) : -100.0;
    float scanEnvelope = smoothstep(0.0, 0.5, cycle) * smoothstep(4.0, 3.5, cycle);
    scanEnvelope *= u_scanPulse;

    if (distance < 100.0) {
      for(int j = 0; j < 3; j++) {
        distance += map(rayOrigin + rayDir * distance);
      }
      p = rayOrigin + rayDir * distance;

      vec3 normal = getNormal(p);
      vec3 absN = abs(normal);

      vec2 surfaceUV;
      if (absN.y > 0.5) {
        surfaceUV = p.xz;
      } else if (absN.z > 0.5) {
        surfaceUV = p.xy;
      } else {
        surfaceUV = p.zy;
      }

      float dotDensity = u_dotDensity;
      vec2 scaledUV = surfaceUV * dotDensity;
      vec2 gridUV = fract(scaledUV) - 0.5;

      float pixelSizeWorld = distance / u_resolution.y;
      float viewAngle = max(abs(dot(normal, rayDir)), 0.05);
      float pixelSizeUV = pixelSizeWorld / viewAngle;
      float pixelSizeTex = pixelSizeUV * dotDensity;

      float radius = 0.2;
      float distFromCenter = length(gridUV);
      float blur = max(pixelSizeTex * 0.8, 0.01);

      float dotPattern = smoothstep(radius + blur, radius - blur, distFromCenter);

      float fadeToAverage = smoothstep(0.15, 0.6, pixelSizeTex);
      dotPattern = mix(dotPattern, 0.125, fadeToAverage);

      float moireFade = smoothstep(25.0, 50.0, distance);
      dotPattern = mix(dotPattern, 0.125, moireFade);

      float distToScanner = abs(p.y - scanY);
      float scanCore = smoothstep(0.1, 0.0, distToScanner);
      float scanGlow = smoothstep(1.5, 0.0, distToScanner);

      // Window lights flash on the beat; each building gets its own weight so some light up more
      vec2 buildingId = floor(p.xz - normal.xz * 0.01);
      float lit = step(0.35, hash(buildingId + 7.0));
      vec3 dotBaseColor = u_dotColor * dotPattern * (1.0 + u_lightFlash * (0.6 + 2.4 * lit));
      vec3 materialColor = u_buildingColor + dotBaseColor;

      materialColor += u_scanColor * scanCore * 4.0 * scanEnvelope;
      materialColor += u_scanColor * scanGlow * dotPattern * 2.5 * scanEnvelope;

      vec3 lightDir = normalize(vec3(0.8, 0.6, -0.4));
      float diff = max(dot(normal, lightDir), 0.0);

      color = materialColor * diff + (materialColor * 0.3);
      color = mix(color, fogColor, 1.0 - exp(-u_fogDensity * distance));
    }

    float tPlane = (scanY - rayOrigin.y) / rayDir.y;

    if (tPlane > 0.0 && tPlane < min(distance, 100.0)) {
      vec3 planeHit = rayOrigin + rayDir * tPlane;

      // On the beat the grid lines thicken and burn hot, and the whole plate lights up
      float lineStart = 0.8 - 0.15 * u_planeFlash;
      float gridX = smoothstep(lineStart, 1.0, fract(planeHit.x * 2.0));
      float gridZ = smoothstep(lineStart, 1.0, fract(planeHit.z * 2.0));
      float planeGrid = max(gridX, gridZ);

      vec3 planeLayerColor = u_scanColor * (0.1 + planeGrid * 0.9 + u_planeFlash * 0.25)
        + vec3(planeGrid * u_planeFlash * 0.5);
      float planeAlpha = smoothstep(100.0, 0.0, tPlane) * (0.5 + u_planeFlash * 1.0) * scanEnvelope;

      color += planeLayerColor * planeAlpha;
    }

    color *= 1.0 - dot(uv, uv) * 0.5;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const CyberCity: VisualizerFactory = ({ container, width: w, height: h, dpr }) => {
  let lastKickTime = 0;
  let kickAmp = 1;

  let DPR = Math.min(dpr, 1.0) * 0.8;

  const renderer = createRenderer(container, w, h, DPR, { antialias: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const baseDot = new THREE.Color('#436e84');
  const baseScan = new THREE.Color('#00ccff');
  const baseBuilding = new THREE.Color('#1b202d');
  const dotHSL = { h: 0, s: 0, l: 0 };
  const scanHSL = { h: 0, s: 0, l: 0 };
  baseDot.getHSL(dotHSL);
  baseScan.getHSL(scanHSL);

  const BASE_FLIGHT = 0.5;
  const BASE_FOG = 0.03;
  const BASE_SCAN_SPEED = 0.7;
  const BASE_DOT_DENSITY = 12.0;
  const BASE_CAM_Y = 10.0;
  const BASE_CAM_PITCH = 0.6;

  const uniforms = {
    u_time: { value: 0.0 },
    u_resolution: { value: new THREE.Vector2(w * DPR, h * DPR) },
    u_flightSpeed: { value: BASE_FLIGHT },
    u_camPosY: { value: BASE_CAM_Y },
    u_camPitch: { value: BASE_CAM_PITCH },
    u_dotColor: { value: baseDot.clone() },
    u_scanColor: { value: baseScan.clone() },
    u_buildingColor: { value: baseBuilding.clone() },
    u_dotDensity: { value: BASE_DOT_DENSITY },
    u_fogDensity: { value: BASE_FOG },
    u_scanPhase: { value: 0.0 },
    u_scanPulse: { value: 1.0 },
    u_lightFlash: { value: 0.0 },
    u_planeFlash: { value: 0.0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  const tmpDot = new THREE.Color();
  const tmpScan = new THREE.Color();

  let smoothedBass = 0;
  let smoothedMids = 0;
  let smoothedHighs = 0;
  let scanPhase = 0;
  let planeFlash = 0;

  return {
    resize(width, height, d) {
      DPR = Math.min(d, 1.0) * 0.8;
      renderer.setPixelRatio(DPR);
      renderer.setSize(width, height);
      uniforms.u_resolution.value.set(width * DPR, height * DPR);
    },
    frame({ audio, settings: s, dt }) {
      const now = performance.now();

      const freqData = audio.spectrum({ fftSize: 2048, smoothing: 0.75 });
      const freqBins = freqData.length;
      const sampleRate = audio.sampleRate;
      const binHz = sampleRate / 2048;

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

      // Kick: predicted beats (raw kick onsets as fallback when there is no confident beat)
      const isKick = beatHit(audio);
      if (isKick) {
        lastKickTime = now;
        kickAmp = beatStrength(audio);
      }
      const kickFlash = lastKickTime > 0 ? kickAmp * Math.max(0, 1 - (now - lastKickTime) / 200) : 0;

      const delta = dt;

      uniforms.u_time.value += delta * s.speed;
      uniforms.u_flightSpeed.value = BASE_FLIGHT * s.speed;

      // Scanner cycles faster with mids (phase accumulator, so the sweep never jumps)
      scanPhase = (scanPhase + delta * BASE_SCAN_SPEED * s.speed * (1.0 + smoothedMids * 1.4)) % 6.0;
      uniforms.u_scanPhase.value = scanPhase;

      // Lights react on the beat: the scanner and the window lights flash, the buildings stay put
      uniforms.u_scanPulse.value = 0.85 + kickFlash * 1.4 + smoothedHighs * 0.3;
      uniforms.u_lightFlash.value = kickFlash;
      // The scan plate carries the beat: a hard hit with a slightly longer tail than the windows
      planeFlash = isKick ? Math.max(kickAmp, planeFlash) : planeFlash * Math.exp(-dt / 0.18);
      uniforms.u_planeFlash.value = Math.min(1.5, planeFlash * s.sensitivity);

      // Fog thins with bass to reveal more of the skyline
      uniforms.u_fogDensity.value = Math.max(0.005, BASE_FOG - smoothedBass * 0.018);

      // Dot density tightens with highs (more detail in busy mixes)
      uniforms.u_dotDensity.value = BASE_DOT_DENSITY + smoothedHighs * 6.0;

      uniforms.u_camPosY.value = BASE_CAM_Y;
      uniforms.u_camPitch.value = BASE_CAM_PITCH + smoothedMids * 0.05;

      // Scale: a smaller scale lifts the camera higher; larger drops in close
      const scaleZoom = 1.0 / Math.max(0.5, Math.min(3.0, s.scale));
      uniforms.u_camPosY.value *= scaleZoom;

      // Hue shift the theme colors
      const hueDelta = s.hueShift / 360;
      tmpDot.setHSL((dotHSL.h + hueDelta + 1) % 1, dotHSL.s, dotHSL.l);
      tmpScan.setHSL((scanHSL.h + hueDelta + 1) % 1, scanHSL.s, scanHSL.l);
      uniforms.u_dotColor.value.copy(tmpDot);
      uniforms.u_scanColor.value.copy(tmpScan);

      renderer.render(scene, camera);
    },
    dispose() {
      quad.geometry.dispose();
      material.dispose();
      disposeRenderer(renderer);
    },
  };
};

export default CyberCity;
