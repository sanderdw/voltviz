import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function MilkDrop({ stream, settings }: Props) {
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
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;

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

    // Ping-pong render targets for feedback loop
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

    // Feedback warp + composite material
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
          vec2 uv = vUv;
          float ar = uRes.x / uRes.y;
          vec2 p = (uv - 0.5) * vec2(ar, 1.0);
          float t = uTime;

          // --- Audio bands ---
          float bass   = texture2D(uFreq, vec2(0.04, 0.5)).r;
          float mid    = texture2D(uFreq, vec2(0.22, 0.5)).r;
          float treble = texture2D(uFreq, vec2(0.55, 0.5)).r;
          float energy = (bass * 2.0 + mid + treble * 0.5) / 3.5;

          float sB = bass   * uSens;
          float sM = mid    * uSens;
          float sT = treble * uSens;
          float sE = energy * uSens;

          // === MOTION VECTORS (MilkDrop-style per-pixel warp) ===
          float dist = length(p);

          // Zoom: slight pull toward center, bass-reactive
          float zoom = 1.0 - (0.006 + sB * 0.010) * uScale;
          p *= zoom;

          // Rotation: varies with distance for spiral feel
          float rot = (0.003 + sM * 0.007) * uSpeed * (1.0 - dist * 0.4);
          float cs = cos(rot), sn = sin(rot);
          p = mat2(cs, -sn, sn, cs) * p;

          // Per-pixel sinusoidal warp (multiple frequencies for organic motion)
          float wa = (0.003 + sT * 0.007) * uScale;
          float sp = uSpeed;
          p.x += sin(p.y * 7.0 + t * 1.3 * sp) * wa;
          p.y += cos(p.x * 7.0 + t * 1.1 * sp) * wa;
          p.x += sin(p.y * 3.5 - t * 0.7 * sp + sB * 4.0) * wa * 0.4;
          p.y += cos(p.x * 4.5 + t * 0.5 * sp + sM * 3.0) * wa * 0.4;

          // Sample previous frame with warped coordinates
          vec2 wUv = p / vec2(ar, 1.0) + 0.5;
          vec4 prev = texture2D(uPrev, wUv);

          // Decay (slight darkening to prevent saturation)
          prev.rgb *= 0.990 - sE * 0.008;

          // Edge vignette in feedback (creates tunnel/zoom effect)
          float vig = smoothstep(0.7, 0.3, dist);
          prev.rgb *= 0.97 + 0.03 * vig;

          // Hue rotation on existing feedback content
          if (uHue != 0.0) {
            float hr = uHue / 360.0 * 0.04 * TAU;
            float cH = cos(hr), sH = sin(hr);
            vec3 o = prev.rgb;
            prev.r = dot(o, vec3(0.299 + 0.701*cH + 0.168*sH, 0.587 - 0.587*cH + 0.330*sH, 0.114 - 0.114*cH - 0.497*sH));
            prev.g = dot(o, vec3(0.299 - 0.299*cH - 0.328*sH, 0.587 + 0.413*cH + 0.035*sH, 0.114 - 0.114*cH + 0.292*sH));
            prev.b = dot(o, vec3(0.299 - 0.300*cH + 1.250*sH, 0.587 - 0.588*cH - 1.050*sH, 0.114 + 0.886*cH - 0.203*sH));
          }

          // === NEW CONTENT ===
          vec3 nc = vec3(0.0);
          vec2 cp = (uv - 0.5) * vec2(ar, 1.0);
          float cDist = length(cp);
          float cAng = atan(cp.y, cp.x);

          // 1. Waveform circle (inner ring)
          float wn = (cAng + PI) / TAU;
          float wv = texture2D(uWave, vec2(wn, 0.5)).r;
          float wd = (wv - 0.5) * 0.12 * uSens * uScale;
          float rInner = 0.18 * uScale + wd;
          float innerLine = smoothstep(0.005, 0.0, abs(cDist - rInner));
          float h1 = mod(t * 0.12 * uSpeed + uHue / 360.0 + wn * 0.7, 1.0);
          nc += hsl2rgb(h1, 0.95, 0.6) * innerLine * (0.4 + sE * 0.6);

          // 2. Frequency spectrum ring (outer)
          float fv = texture2D(uFreq, vec2(wn * 0.5, 0.5)).r;
          float rOuter = 0.32 * uScale + fv * 0.07 * uSens * uScale;
          float outerLine = smoothstep(0.004, 0.0, abs(cDist - rOuter));
          float h2 = mod(t * 0.09 * uSpeed + uHue / 360.0 + 0.5 + wn * 0.5, 1.0);
          nc += hsl2rgb(h2, 0.85, 0.55) * outerLine * (0.3 + sE * 0.7);

          // 3. Kaleidoscope lines (6-fold symmetry)
          float nSym = 6.0;
          float sa = mod(cAng + t * 0.25 * uSpeed, TAU / nSym) - PI / nSym;
          vec2 sp2 = vec2(cos(sa), sin(sa)) * cDist;
          float symLine = smoothstep(0.003, 0.0, abs(sp2.y));
          symLine *= smoothstep(0.38 * uScale, 0.06, cDist);
          symLine *= sT;
          float h3 = mod(t * 0.14 * uSpeed + uHue / 360.0 + cDist * 2.5, 1.0);
          nc += hsl2rgb(h3, 0.8, 0.5) * symLine * 0.6;

          // 4. Center glow (bass pulse)
          float glow = exp(-cDist * (5.5 / max(uScale, 0.01))) * sE * 0.35;
          float hg = mod(t * 0.07 * uSpeed + uHue / 360.0 + 0.33, 1.0);
          nc += hsl2rgb(hg, 0.75, 0.6) * glow;

          // Combine with soft clamp to prevent harsh clipping
          vec3 col = prev.rgb + nc;
          col = col / (1.0 + col * 0.15);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // Display material (copies feedback buffer to screen)
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
          col = pow(col, vec3(0.95));
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

      // Swap ping-pong targets
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
