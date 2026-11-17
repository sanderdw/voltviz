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
const SHUFFLE_DEFAULT = 60;

export const DEFAULT_SETTINGS: VisualizerSettings = { sensitivity: 1.0, speed: 1.0, hueShift: 0, scale: 1.0 };

const DEFAULT_VISUALIZER: VisualizerType = 'halftonepulse';
const DEFAULT_SKIN: SkinType = 'modern';
const DEFAULT_TRANSITION: TransitionMode = 'crossfade';
const SETTING_KEYS = ['sensitivity', 'speed', 'hueShift', 'scale'] as const satisfies readonly (keyof VisualizerSettings)[];

const params = () => new URLSearchParams(window.location.search);

/** Replace the query string of the current URL (no history entry). */
function replaceQuery(p: URLSearchParams): void {
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

/** Set a parameter, or remove it when it has its default value, so links stay short. */
function setOrDelete(p: URLSearchParams, key: string, value: string | number, defaultValue: string | number): void {
  if (value !== defaultValue) p.set(key, String(value));
  else p.delete(key);
}

export function useAppState() {
  const [activeVisualizer, setActiveVisualizer] = useState<VisualizerType>(() => {
    return resolveVisualizer(params().get('viz')) ?? DEFAULT_VISUALIZER;
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
    return t && (TRANSITION_MODES as readonly string[]).includes(t) ? (t as TransitionMode) : DEFAULT_TRANSITION;
  });
  const [settings, setSettings] = useState<VisualizerSettings>(() => {
    const p = params();
    const num = (key: keyof VisualizerSettings) => {
      const n = parseFloat(p.get(key) ?? '');
      return isNaN(n) ? DEFAULT_SETTINGS[key] : n;
    };
    return { sensitivity: num('sensitivity'), speed: num('speed'), hueShift: num('hueShift'), scale: num('scale') };
  });
  const [activeSkin, setActiveSkin] = useState<SkinType>(() => {
    const s = params().get('skin');
    return s && s in skins ? (s as SkinType) : DEFAULT_SKIN;
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
    for (const key of SETTING_KEYS) setOrDelete(p, key, settings[key], DEFAULT_SETTINGS[key]);
    setOrDelete(p, 'skin', activeSkin, DEFAULT_SKIN);
    setOrDelete(p, 'shuffle', shuffleEnabled ? '1' : '', '');
    setOrDelete(p, 'shuffleTime', shuffleEnabled ? shuffleInterval : SHUFFLE_DEFAULT, SHUFFLE_DEFAULT);
    setOrDelete(p, 'shufflePool', shufflePool.join(','), '');
    setOrDelete(p, 'transition', transitionMode, DEFAULT_TRANSITION);
    setOrDelete(p, 'agc', autoGain ? '1' : '', '');
    setOrDelete(p, 'aibeat', aiBeat ? '1' : '', '');
    setOrDelete(p, 'style', musicStyle, DEFAULT_STYLE);
    replaceQuery(p);
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
  replaceQuery(p);
}
