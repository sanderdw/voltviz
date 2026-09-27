/**
 * Lazy loaders for the renderer modules in ./impl (one chunk per visualizer). Kept apart from
 * the registry so the registry stays plain data (it is also imported by Node-side tests).
 */
import type { VisualizerModule } from './runtime/types';

const modules = import.meta.glob<VisualizerModule>('./impl/*.{ts,tsx}');

/** Load the renderer module of a registry entry. */
export function loadVisualizer(entry: { module: string }): Promise<VisualizerModule> {
  const load = modules[`./impl/${entry.module}.ts`] ?? modules[`./impl/${entry.module}.tsx`];
  if (!load) return Promise.reject(new Error(`missing visualizer module ./impl/${entry.module}`));
  return load();
}

/** Module files present in ./impl (for consistency tests). */
export const moduleFiles = Object.keys(modules);
