import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function MilkDropWarp({ stream, settings }: Props) {
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
    analyser.smoothingTimeConstant = 0.78;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);
    const waveData = new Uint8Array(analyser.fftSize);

    // --- Three.js ---
    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(1);
    renderer.autoClear = false;

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Ping-pong render targets
    const rtOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    };
    let rtA = new THREE.WebGLRenderTarget(w, h, rtOpts);
    let rtB = new THREE.WebGLRenderTarget(w, h, rtOpts);

    // Audio data textures
    const freqTex = new THREE.DataTexture(freqData, freqBins, 1, THREE.RedFormat);
    freqTex.needsUpdate = true;
    const waveTex = new THREE.DataTexture(waveData, analyser.fftSize, 1, THREE.RedFormat);
    waveTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(2, 2);

    // Feedback warp material – deep tunnel / fractal aesthetic
    const feedbackMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: rtA.texture },
        uFreq: { value: freqTex },
        uWave: { value: waveTex },
        uTime: { value: 0 },
        uSens: { value: 1.0 },
        uSpeed: { value: 1.0 },
        uHue: { value: 0 },
        uScale: { value: 1.0 },
        uRes: { value: new THREE.Vector2(w, h) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;

        uniform sampler2D uPrev;
        uniform sampler2D uFreq;
        uniform sampler2D uWave;
        uniform float uTime;
        uniform float uSens;
        uniform float uSpeed;
        uniform float uHue;
        uniform float uScale;
        uniform vec2 uRes;

        #define PI  3.14159265
        #define TAU 6.28318530

        vec3 hsl2rgb(float h, float s, float l) {
          vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }

        void main() {
          float ar = uRes.x / uRes.y;
          vec2 p = (vUv - 0.5) * vec2(ar, 1.0);
          float t = uTime;

          // --- Audio bands ---
          float bass   = texture2D(uFreq, vec2(0.03, 0.5)).r;
          float mid    = texture2D(uFreq, vec2(0.18, 0.5)).r;
          float treble = texture2D(uFreq, vec2(0.50, 0.5)).r;
          float energy = (bass * 2.0 + mid + treble) / 4.0;

          float sB = bass   * uSens;
          float sM = mid    * uSens;
          float sT = treble * uSens;
          float sE = energy * uSens;

          // === DEEP TUNNEL WARP ===
          float dist = length(p);
          float ang  = atan(p.y, p.x);

          // Strong inward zoom – bass kicks pull you deeper
          float zoom = 1.0 - (0.012 + sB * 0.018) * uScale;
          p *= zoom;

          // Spiral rotation – accelerates toward center for vortex feel
          float spiral = (0.008 + sM * 0.014) * uSpeed / (0.3 + dist);
          float cs = cos(spiral), sn = sin(spiral);
          p = mat2(cs, -sn, sn, cs) * p;

          // Radial breathing (expand/contract with mid)
          float breath = 1.0 + sin(t * 2.2 * uSpeed) * sM * 0.008 * uScale;
          p *= breath;

          // Hyperbolic warp – creates star/diamond distortion patterns
          float hStrength = (0.004 + sT * 0.008) * uScale;
          float hAng = ang * 4.0 + t * 0.6 * uSpeed;
          p += vec2(cos(hAng), sin(hAng)) * hStrength * (0.5 - dist);

          // Domain-warped displacement for organic complexity
          float wStr = (0.002 + sE * 0.005) * uScale;
          float wx = sin(p.y * 11.0 + t * 1.7 * uSpeed + sB * 5.0);
          float wy = cos(p.x * 13.0 - t * 1.3 * uSpeed + sM * 4.0);
          p.x += wx * wStr;
          p.y += wy * wStr;

          // Sample feedback
          vec2 wUv = p / vec2(ar, 1.0) + 0.5;
          vec4 prev = texture2D(uPrev, wUv);

          // Decay with color channel separation for chromatic drift
          float decayBase = 0.375 - sE * 0.010;
          prev.r *= decayBase + 0.002;
          prev.g *= decayBase;
          prev.b *= decayBase + 0.004;

          // Tunnel vignette: darken edges, preserve center depth
          float vig = smoothstep(0.75, 0.15, dist);
          prev.rgb *= 0.95 + 0.05 * vig;

          // Gradual hue rotation on feedback
          if (uHue != 0.0) {
            float hr = uHue / 360.0 * 0.06 * TAU;
            float cH = cos(hr), sH = sin(hr);
            vec3 o = prev.rgb;
            prev.r = dot(o, vec3(0.299 + 0.701*cH + 0.168*sH, 0.587 - 0.587*cH + 0.330*sH, 0.114 - 0.114*cH - 0.497*sH));
            prev.g = dot(o, vec3(0.299 - 0.299*cH - 0.328*sH, 0.587 + 0.413*cH + 0.035*sH, 0.114 - 0.114*cH + 0.292*sH));
            prev.b = dot(o, vec3(0.299 - 0.300*cH + 1.250*sH, 0.587 - 0.588*cH - 1.050*sH, 0.114 + 0.886*cH - 0.203*sH));
          }

          // === NEW CONTENT ===
          vec3 nc = vec3(0.0);
          vec2 cp = (vUv - 0.5) * vec2(ar, 1.0);
          float cDist = length(cp);
          float cAng = atan(cp.y, cp.x);

          // 1. Radial frequency bars – spectrum mapped around the center
          float nBars = 48.0;
          float barAng = mod(cAng + PI, TAU) / TAU;
          float barIdx = floor(barAng * nBars) / nBars;
          float barFrac = fract(barAng * nBars);
          float barGap = smoothstep(0.0, 0.08, barFrac) * smoothstep(1.0, 0.92, barFrac);
          float freqVal = texture2D(uFreq, vec2(barIdx * 0.6, 0.5)).r * uSens;
          float barLen = 0.08 + freqVal * 0.28 * uScale;
          float barStart = 0.06 * uScale;
          float barMask = step(barStart, cDist) * step(cDist, barStart + barLen) * barGap;
          float bH = mod(barIdx + t * 0.08 * uSpeed + uHue / 360.0, 1.0);
          nc += hsl2rgb(bH, 0.9, 0.45) * barMask * (0.3 + freqVal * 0.4);

          // 2. Waveform spiral – time-domain data drawn as a rotating spiral
          float spiralArms = 3.0;
          float spiralAng = mod(cAng + t * 0.4 * uSpeed, TAU);
          float armPhase = mod(spiralAng * spiralArms / TAU, 1.0);
          float wIdx = mod(armPhase + cDist * 2.0, 1.0);
          float wVal = texture2D(uWave, vec2(wIdx, 0.5)).r;
          float wDev = (wVal - 0.5) * 0.06 * uSens * uScale;
          float spiralR = 0.12 * uScale + cDist * 0.15 + wDev;
          float spiralLine = smoothstep(0.006, 0.0, abs(fract(spiralAng * spiralArms / TAU) - 0.5) - 0.46);
          spiralLine *= smoothstep(0.45 * uScale, 0.08, cDist) * smoothstep(0.04, 0.08, cDist);
          float sH = mod(cDist * 3.0 + t * 0.1 * uSpeed + uHue / 360.0 + 0.5, 1.0);
          nc += hsl2rgb(sH, 0.85, 0.4) * spiralLine * (0.2 + sE * 0.45);

          // 3. Pulsing concentric rings – tunnel depth markers
          float ringSpace = 0.09 * uScale;
          float ringPhase = mod(cDist - t * 0.15 * uSpeed * uScale, ringSpace);
          float ringLine = smoothstep(0.003, 0.0, abs(ringPhase - ringSpace * 0.5) - ringSpace * 0.45);
          float ringBrightness = (0.08 + sB * 0.14) * smoothstep(0.55 * uScale, 0.05, cDist);
          float rH = mod(cDist * 2.0 + t * 0.06 * uSpeed + uHue / 360.0 + 0.25, 1.0);
          nc += hsl2rgb(rH, 0.7, 0.45) * ringLine * ringBrightness;

          // 4. Center flare – energy burst
          float flare = exp(-cDist * (8.0 / max(uScale, 0.01))) * sE * 0.28;
          // Cross-shaped flare spikes
          float spike = max(
            exp(-abs(cp.x) * 40.0) * exp(-abs(cp.y) * 8.0),
            exp(-abs(cp.y) * 40.0) * exp(-abs(cp.x) * 8.0)
          ) * sE * 0.15;
          float fH = mod(t * 0.05 * uSpeed + uHue / 360.0, 1.0);
          nc += hsl2rgb(fH, 0.8, 0.55) * (flare + spike);

          // Combine
          vec3 col = prev.rgb + nc;
          col = col / (1.0 + col * 0.22);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // Display pass material
    const displayMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: rtB.texture },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        void main() {
          vec3 col = texture2D(uTex, vUv).rgb;
          col = pow(col, vec3(1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(geo, feedbackMat);
    scene.add(quad);

    let time = 0;
    let lastTime = performance.now();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const cur = settingsRef.current;
      time += dt * cur.speed;

      // Update audio data
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(waveData);
      freqTex.needsUpdate = true;
      waveTex.needsUpdate = true;

      // Feedback pass: read rtA → render to rtB
      feedbackMat.uniforms.uPrev.value = rtA.texture;
      feedbackMat.uniforms.uTime.value = time;
      feedbackMat.uniforms.uSens.value = cur.sensitivity;
      feedbackMat.uniforms.uSpeed.value = cur.speed;
      feedbackMat.uniforms.uHue.value = cur.hueShift;
      feedbackMat.uniforms.uScale.value = cur.scale;

      quad.material = feedbackMat;
      renderer.setRenderTarget(rtB);
      renderer.clear();
      renderer.render(scene, camera);

      // Display pass: copy rtB to screen
      displayMat.uniforms.uTex.value = rtB.texture;
      quad.material = displayMat;
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);

      // Swap
      const tmp = rtA;
      rtA = rtB;
      rtB = tmp;
    };

    const onResize = () => {
      if (!containerRef.current) return;
      const nw = containerRef.current.clientWidth;
      const nh = containerRef.current.clientHeight;
      renderer.setSize(nw, nh);
      feedbackMat.uniforms.uRes.value.set(nw, nh);
      rtA.setSize(nw, nh);
      rtB.setSize(nw, nh);
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
      geo.dispose();
      feedbackMat.dispose();
      displayMat.dispose();
      rtA.dispose();
      rtB.dispose();
      freqTex.dispose();
      waveTex.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream]);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
}
