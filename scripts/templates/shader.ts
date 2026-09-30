/**
 * __NAME__ — a full-screen shader visualizer. Created with `npm run new:viz`; see
 * .github/skills/adding-visualizer/SKILL.md for the contract and the quality steps.
 */
import * as THREE from 'three';
import { beatHit, beatStrength } from '../../src/visualizers/lib/audio'; // BEAT
import { createRenderer, disposeObject, disposeRenderer } from '../../src/visualizers/lib/three';
import type { VisualizerFactory } from '../../src/visualizers/runtime/types';

const fragmentShader = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uPhase;   // accumulated on the CPU: audio changes the rate, never uTime * audio
  uniform float uLevel;   // smoothed bass, 0..1
  uniform float uBeat;    // 1 on a beat, decaying
  uniform float uHue;     // settings.hueShift / 360
  uniform float uScale;
  varying vec2 vUv;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) / uScale;
    float r = length(p);
    float rings = sin(r * 18.0 - uPhase * 4.0) * 0.5 + 0.5;
    float glow = smoothstep(0.6 + 0.3 * uLevel, 0.0, r);
    vec3 col = hsl2rgb(vec3(fract(uHue + r * 0.3 + uPhase * 0.02), 0.8, 0.5)) * rings * glow;
    col += uBeat * 0.25 * glow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TemplateShader: VisualizerFactory = ({ container, width, height, dpr }) => {
  const renderer = createRenderer(container, width, height, dpr, { antialias: false });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uResolution: { value: new THREE.Vector2(width, height) },
    uPhase: { value: 0 },
    uLevel: { value: 0 },
    uBeat: { value: 0 },
    uHue: { value: 0 },
    uScale: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  let phase = 0;
  let level = 0;
  // BEAT:BEGIN
  let beat = 0;
  // BEAT:END

  return {
    resize(w, h, d) {
      renderer.setPixelRatio(d);
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
    },

    frame({ audio, settings, dt }) {
      const bass = Math.min(1, audio.bands.bass * settings.sensitivity);
      level += (bass - level) * Math.min(1, dt * 8);
      phase += dt * settings.speed * (0.4 + level);
      // BEAT:BEGIN
      if (beatHit(audio)) beat = beatStrength(audio);
      beat *= Math.exp(-dt / 0.15);
      uniforms.uBeat.value = beat;
      // BEAT:END
      uniforms.uPhase.value = phase;
      uniforms.uLevel.value = level;
      uniforms.uHue.value = settings.hueShift / 360;
      uniforms.uScale.value = settings.scale;
      renderer.render(scene, camera);
    },

    dispose() {
      disposeObject(scene);
      disposeRenderer(renderer);
    },
  };
};

export default TemplateShader;
