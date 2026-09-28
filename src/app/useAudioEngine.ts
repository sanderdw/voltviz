/**
 * Creates the AudioEngine (and the VisualizerHost that draws with it) for the current audio
 * input, and tears both down when the input changes or goes away.
 */
import { useEffect, useMemo, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import type { AudioInput, EngineOptions } from '../audio/types';
import { VisualizerHost } from '../visualizers/runtime/VisualizerHost';

export function useAudioEngine(stream: MediaStream | null, options: EngineOptions) {
  const input = useMemo<AudioInput | null>(() => (stream ? { kind: 'stream', stream } : null), [stream]);
  const [pair, setPair] = useState<{ engine: AudioEngine; host: VisualizerHost } | null>(null);
  const [initialOptions] = useState(options);
  const latestOptions = useLatest(options);

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    let created: { engine: AudioEngine; host: VisualizerHost } | null = null;
    AudioEngine.create(input, { ...initialOptions, ...latestOptions.current }).then(engine => {
      if (cancelled) {
        engine.dispose();
        return;
      }
      created = { engine, host: new VisualizerHost(engine) };
      if (import.meta.env.DEV) {
        const g = window as unknown as { __voltviz?: Record<string, unknown> };
        g.__voltviz = { ...(g.__voltviz ?? {}), engine, host: created.host };
      }
      setPair(created);
    }).catch(err => console.error('VoltViz: audio engine failed to start', err));
    return () => {
      cancelled = true;
      if (created) {
        created.host.dispose();
        created.engine.dispose();
      }
      setPair(null);
    };
  }, [input, initialOptions]);

  useEffect(() => {
    pair?.engine.setOptions(options);
  }, [pair, options.autoGain, options.neural, options.style]);

  return pair;
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
