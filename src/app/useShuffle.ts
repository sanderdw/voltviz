import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { visualizerIds, type VisualizerType } from '../visualizers/registry';

/** While enabled and audio is running, switches to a random other visualizer every `intervalS` seconds. */
export function useShuffle({ enabled, intervalS, pool, running, setActiveVisualizer }: {
  enabled: boolean;
  intervalS: number;
  /** The visualizers to choose from; empty means all of them. */
  pool: readonly VisualizerType[];
  running: boolean;
  setActiveVisualizer: Dispatch<SetStateAction<VisualizerType>>;
}): void {
  useEffect(() => {
    if (!enabled || !running) return;
    const id = window.setInterval(() => {
      setActiveVisualizer(current => {
        const others = (pool.length ? pool : visualizerIds).filter(v => v !== current);
        if (!others.length) return current;
        const next = others[Math.floor(Math.random() * others.length)];
        return next;
      });
    }, intervalS * 1000);
    return () => window.clearInterval(id);
  }, [enabled, intervalS, running, pool, setActiveVisualizer]);
}
