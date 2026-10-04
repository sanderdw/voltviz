/**
 * All user-facing app state that lives in the URL (identical parameter semantics to the
 * previous App.tsx, plus `agc`, `aibeat` and `style`): read once on load, written back with
 * history.replaceState whenever it changes.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_STYLE, isStyleId, type StyleId } from '../audio/core/styles';
import { skins, type SkinType } from '../skins';
import { resolveVisualizer, type VisualizerType } from '../visualizers/registry';
import type { VisualizerSettings } from '../types';
import { TRANSITION_MODES, type TransitionMode } from './VisualizerStage';

export const SHUFFLE_PRESETS: { value: number; label: string }[] = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
];
export const SHUFFLE_DEFAULT = 60;

export const DEFAULT_SETTINGS: VisualizerSettings = { sensitivity: 1.0, speed: 1.0, hueShift: 0, scale: 1.0 };

const params = () => new URLSearchParams(window.location.search);

export function useAppState() {
  const [activeVisualizer, setActiveVisualizer] = useState<VisualizerType>(() => {
    return resolveVisualizer(params().get('viz')) ?? 'halftonepulse';
  });
  const [shuffleEnabled, setShuffleEnabled] = useState(() => params().get('shuffle') === '1');
  const [shuffleInterval, setShuffleInterval] = useState<number>(() => {
    const v = parseInt(params().get('shuffleTime') ?? '', 10);
    return SHUFFLE_PRESETS.some(p => p.value === v) ? v : SHUFFLE_DEFAULT;
  });
  const [shufflePool, setShufflePool] = useState<VisualizerType[]>(() => [...new Set(
    (params().get('shufflePool') ?? '').split(',').map(resolveVisualizer).filter(v => v !== null)
  )]);
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(() => {
    const t = params().get('transition');
    return t && (TRANSITION_MODES as readonly string[]).includes(t) ? (t as TransitionMode) : 'crossfade';
  });
  const [settings, setSettings] = useState<VisualizerSettings>(() => {
    const p = params();
    const num = (key: string, def: number) => {
      const v = p.get(key);
      if (v === null) return def;
      const n = parseFloat(v);
      return isNaN(n) ? def : n;
    };
    return {
      sensitivity: num('sensitivity', DEFAULT_SETTINGS.sensitivity),
      speed: num('speed', DEFAULT_SETTINGS.speed),
      hueShift: num('hueShift', DEFAULT_SETTINGS.hueShift),
      scale: num('scale', DEFAULT_SETTINGS.scale),
    };
  });
  const [activeSkin, setActiveSkin] = useState<SkinType>(() => {
    const s = params().get('skin');
    return s && s in skins ? (s as SkinType) : 'modern';
  });
  const [autoGain, setAutoGain] = useState(() => params().get('agc') === '1');
  const [aiBeat, setAiBeat] = useState(() => params().get('aibeat') === '1');
  const [musicStyle, setMusicStyle] = useState<StyleId>(() => {
    const s = params().get('style');
    return isStyleId(s) ? s : DEFAULT_STYLE;
  });

  useEffect(() => {
    const p = params();
    p.set('viz', activeVisualizer);
    const setOrDelete = (key: string, value: number, defaultValue: number) => {
      if (value !== defaultValue) p.set(key, value.toString());
      else p.delete(key);
    };
    setOrDelete('sensitivity', settings.sensitivity, 1.0);
    setOrDelete('speed', settings.speed, 1.0);
    setOrDelete('hueShift', settings.hueShift, 0);
    setOrDelete('scale', settings.scale, 1.0);
    if (activeSkin !== 'modern') p.set('skin', activeSkin);
    else p.delete('skin');
    if (shuffleEnabled) p.set('shuffle', '1');
    else p.delete('shuffle');
    if (shuffleEnabled && shuffleInterval !== SHUFFLE_DEFAULT) p.set('shuffleTime', String(shuffleInterval));
    else p.delete('shuffleTime');
    if (shufflePool.length > 0) p.set('shufflePool', shufflePool.join(','));
    else p.delete('shufflePool');
    if (transitionMode !== 'crossfade') p.set('transition', transitionMode);
    else p.delete('transition');
    if (autoGain) p.set('agc', '1');
    else p.delete('agc');
    if (aiBeat) p.set('aibeat', '1');
    else p.delete('aibeat');
    if (musicStyle !== DEFAULT_STYLE) p.set('style', musicStyle);
    else p.delete('style');
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeVisualizer, settings, activeSkin, shuffleEnabled, shuffleInterval, shufflePool, transitionMode, autoGain, aiBeat, musicStyle]);

  return {
    activeVisualizer, setActiveVisualizer,
    shuffleEnabled, setShuffleEnabled,
    shuffleInterval, setShuffleInterval,
    shufflePool, setShufflePool,
    transitionMode, setTransitionMode,
    settings, setSettings,
    activeSkin, setActiveSkin,
    autoGain, setAutoGain,
    aiBeat, setAiBeat,
    musicStyle, setMusicStyle,
  };
}

/** Remove a single parameter from the URL (e.g. `sendspin` after disconnecting). */
export function removeUrlParam(key: string): void {
  const p = params();
  if (!p.has(key)) return;
  p.delete(key);
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}
