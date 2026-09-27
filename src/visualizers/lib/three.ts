/**
 * three.js helpers: renderer creation (pixel ratio capped at 2 by the host) and thorough
 * disposal of scenes, materials, textures and render targets.
 */
import * as THREE from 'three';

export function createRenderer(container: HTMLElement, width: number, height: number, dpr: number,
  params: THREE.WebGLRendererParameters = {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, ...params });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);
  return renderer;
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const val of Object.values(u)) if (val?.value instanceof THREE.Texture) val.value.dispose();
      m.dispose();
    }
  });
}

export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}
