import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import { visualizers } from '../visualizers';
import type { VisualizerType } from '../visualizers';
import type { VisualizerProps, VisualizerSettings } from '../types';

const visualizerComponents = Object.fromEntries(
  visualizers.map(v => [v.id, lazy(v.load)])
) as Record<VisualizerType, React.LazyExoticComponent<React.ComponentType<VisualizerProps>>>;

// New layers warm up invisibly for WARMUP_MS (first frames, shader compile)
// before the FADE_MS opacity transition starts. FADE_MS must match duration-700.
const WARMUP_MS = 400;
const FADE_MS = 700;

export const TRANSITION_MODES = ['crossfade', 'quickcut', 'instant'] as const;
// crossfade: old runs until new warmed up, then opacity blend (~1.1s overlap)
// quickcut:  old runs until new warmed up, then hard cut (~0.4s overlap)
// instant:   old unmounts immediately; brief black while the new one loads
export type TransitionMode = (typeof TRANSITION_MODES)[number];

// Mounts only once its sibling visualizer has resolved through Suspense, so its
// effect firing means the new layer is committed and rendering.
function LayerReady({ onReady }: { onReady: () => void }) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current();
  }, []);
  return null;
}

interface Layer {
  id: VisualizerType;
  key: number;
  visible: boolean;
}

interface VisualizerStageProps {
  stream: MediaStream;
  visualizer: VisualizerType;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
  transition: TransitionMode;
}

export default function VisualizerStage({ stream, visualizer, settings, sendspinMetadata, transition }: VisualizerStageProps) {
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

  return (
    <>
      {layers.map(l => {
        const Visualizer = visualizerComponents[l.id];
        return (
          <div
            key={l.key}
            data-testid="viz-layer"
            className={`absolute inset-0 ${transition === 'crossfade' ? 'transition-opacity duration-700' : ''} ${l.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <Suspense fallback={null}>
              {!l.visible && <LayerReady onReady={() => beginFade(l.key)} />}
              <Visualizer stream={stream} settings={settings} sendspinMetadata={sendspinMetadata} />
            </Suspense>
          </div>
        );
      })}
    </>
  );
}
