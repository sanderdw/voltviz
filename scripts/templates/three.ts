/**
 * __NAME__ — a three.js visualizer. Created with `npm run new:viz`; see
 * .github/skills/adding-visualizer/SKILL.md for the contract and the quality steps.
 */
import * as THREE from 'three';
import { beatHit } from '../../src/visualizers/lib/audio'; // BEAT
import { createRenderer, disposeObject, disposeRenderer } from '../../src/visualizers/lib/three';
import type { VisualizerFactory } from '../../src/visualizers/runtime/types';

const TemplateThree: VisualizerFactory = ({ container, width, height, dpr }) => {
  const renderer = createRenderer(container, width, height, dpr);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  camera.position.z = 4;

  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), material);
  scene.add(mesh);

  let phase = 0; // phase accumulator: audio drives the rate, not time × audio
  let level = 0;
  // BEAT:BEGIN
  let pulse = 0;
  // BEAT:END

  return {
    resize(w, h, d) {
      renderer.setPixelRatio(d);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    frame({ audio, settings, dt }) {
      const bass = Math.min(1, audio.bands.bass * settings.sensitivity);
      const mids = Math.min(1, audio.bands.mid * settings.sensitivity);
      level += (bass - level) * Math.min(1, dt * 8);
      phase += dt * settings.speed * (0.2 + 0.8 * mids);
      // BEAT:BEGIN
      if (beatHit(audio)) pulse = 1;
      pulse *= Math.exp(-dt / 0.2);
      // BEAT:END

      let s = settings.scale * (1 + 0.35 * level);
      // BEAT:BEGIN
      s *= 1 + 0.15 * pulse;
      // BEAT:END
      mesh.scale.setScalar(s);
      mesh.rotation.set(phase * 0.7, phase, 0);
      material.color.setHSL(((settings.hueShift / 360) + 0.1 * level) % 1, 0.8, 0.55);
      renderer.render(scene, camera);
    },

    dispose() {
      disposeObject(scene);
      disposeRenderer(renderer);
    },
  };
};

export default TemplateThree;
