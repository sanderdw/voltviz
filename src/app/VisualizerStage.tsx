import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import { visualizers, type VisualizerType } from '../visualizers/registry';
import { loadVisualizer } from '../visualizers/modules';
import type { VisualizerSettings } from '../types';
import type { VisualizerHost, LayerHandle } from '../visualizers/runtime/VisualizerHost';
import type { OverlayProps, VisualizerModule } from '../visualizers/runtime/types';

// New layers warm up invisibly for WARMUP_MS (first frames, shader compile)
// before the FADE_MS opacity transition starts. FADE_MS must match duration-700.
const WARMUP_MS = 400;
const FADE_MS = 700;

export const TRANSITION_MODES = ['crossfade', 'quickcut', 'instant'] as const;
// crossfade: old runs until new warmed up, then opacity blend (~1.1s overlap)
// quickcut:  old runs until new warmed up, then hard cut (~0.4s overlap)
// instant:   old unmounts immediately; brief black while the new one loads
export type TransitionMode = (typeof TRANSITION_MODES)[number];

const loaders = Object.fromEntries(visualizers.map(v => [v.id, () => loadVisualizer(v)])) as Record<VisualizerType, () => Promise<VisualizerModule>>;

interface LayerProps {
  id: VisualizerType;
  host: VisualizerHost;
  settings: VisualizerSettings;
  metadata: ServerStateMetadata | null;
  onReady: () => void;
  /** The module failed to load or start: nothing to show. */
  onFailed: () => void;
}

/** One visualizer layer: loads the module, mounts it through the host, renders its overlay. */
function VisualizerLayer({ id, host, settings, metadata, onReady, onFailed }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<LayerHandle | null>(null);
  const settingsRef = useRef(settings);
  const metadataRef = useRef(metadata);
  const onReadyRef = useRef(onReady);
  const onFailedRef = useRef(onFailed);
  settingsRef.current = settings;
  metadataRef.current = metadata;
  onReadyRef.current = onReady;
  onFailedRef.current = onFailed;
  const [api, setApi] = useState<OverlayProps['api']>(null);
  const [Overlay, setOverlay] = useState<ComponentType<OverlayProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let handle: LayerHandle | null = null;
    loaders[id]().then(mod => {
      if (cancelled || !ref.current) return;
      if (mod.Overlay) setOverlay(() => mod.Overlay!);
      handle = host.mount(id, ref.current, mod.default, settingsRef.current, metadataRef.current);
      handleRef.current = handle;
      handle.ready.then(inst => {
        if (cancelled) return;
        if (!inst) {
          onFailedRef.current();
          return;
        }
        setApi(inst.api ?? null);
        onReadyRef.current();
      });
    }).catch(err => {
      if (cancelled) return;
      console.error(`VoltViz: failed to load visualizer "${id}"`, err);
      onFailedRef.current();
    });
    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, [id, host]);

  useEffect(() => { handleRef.current?.setSettings(settings); }, [settings]);
  useEffect(() => { handleRef.current?.setMetadata(metadata); }, [metadata]);

  return (
    <>
      <div ref={ref} className="absolute inset-0 overflow-hidden" data-testid="viz-canvas-root" />
      {Overlay && <Overlay api={api} />}
    </>
  );
}

interface Layer {
  id: VisualizerType;
  key: number;
  visible: boolean;
}

interface VisualizerStageProps {
  host: VisualizerHost;
  visualizer: VisualizerType;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
  transition: TransitionMode;
}

export default function VisualizerStage({ host, visualizer, settings, sendspinMetadata, transition }: VisualizerStageProps) {
  const keyCounter = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const transitionRef = useRef(transition);
  transitionRef.current = transition;
  const [layers, setLayers] = useState<Layer[]>([{ id: visualizer, key: 0, visible: true }]);

  useEffect(() => () => timeoutsRef.current.forEach(t => window.clearTimeout(t)), []);

  useEffect(() => {
    setLayers(prev => {
      if (prev[prev.length - 1].id === visualizer) return prev;
      keyCounter.current += 1;
      if (transitionRef.current === 'instant') {
        return [{ id: visualizer, key: keyCounter.current, visible: true }];
      }
      // Cap at 2 layers: on rapid switches the still-fading middle layer is dropped
      return [...prev.slice(-1), { id: visualizer, key: keyCounter.current, visible: false }];
    });
  }, [visualizer]);

  const beginFade = (key: number) => {
    timeoutsRef.current.push(window.setTimeout(() => {
      setLayers(prev => prev.map(l => (l.key === key ? { ...l, visible: true } : l)));
      const cutDelay = transitionRef.current === 'crossfade' ? FADE_MS + 100 : 50;
      timeoutsRef.current.push(window.setTimeout(() => {
        // Drop only layers older than the one that just faded in, in case an even
        // newer (still invisible) layer has been pushed meanwhile
        setLayers(prev => {
          const idx = prev.findIndex(l => l.key === key);
          return idx > 0 ? prev.slice(idx) : prev;
        });
      }, cutDelay));
    }, WARMUP_MS));
  };

  // A layer that failed while fading in is dropped so the previous visualizer stays on screen.
  // A layer that is already visible (the first one, or after an instant switch) has nothing to fall
  // back to and stays; the host has logged the error.
  const dropFailed = (key: number) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.key === key);
      return idx > 0 && !prev[idx].visible ? prev.filter(l => l.key !== key) : prev;
    });
  };

  const metadata = sendspinMetadata ?? null;
  return (
    <>
      {layers.map(l => (
        <div
          key={l.key}
          data-testid="viz-layer"
          data-viz={l.id}
          className={`absolute inset-0 ${transition === 'crossfade' ? 'transition-opacity duration-700' : ''} ${l.visible ? 'opacity-100' : 'opacity-0'}`}
        >
          <VisualizerLayer
            id={l.id}
            host={host}
            settings={settings}
            metadata={metadata}
            onReady={() => { if (!l.visible) beginFade(l.key); }}
            onFailed={() => dropFailed(l.key)}
          />
        </div>
      ))}
    </>
  );
}

