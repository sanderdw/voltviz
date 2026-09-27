import { useEffect } from 'react';
import { X, Shuffle, Gauge, BrainCircuit } from 'lucide-react';
import type { SkinDefinition, SkinType } from '../skins';
import type { VisualizerSettings } from '../types';
import { visualizers, type VisualizerType } from '../visualizers/registry';
import { DEFAULT_SETTINGS, SHUFFLE_PRESETS } from './useAppState';
import type { TransitionMode } from './VisualizerStage';

interface SettingsPanelProps {
  skin: SkinDefinition;
  activeSkin: SkinType;
  showSettings: boolean;
  showControls: boolean;
  setShowSettings: (v: boolean) => void;
  settings: VisualizerSettings;
  setSettings: (s: VisualizerSettings) => void;
  shuffleEnabled: boolean;
  setShuffleEnabled: (v: boolean) => void;
  shuffleInterval: number;
  setShuffleInterval: (v: number) => void;
  shufflePool: VisualizerType[];
  transitionMode: TransitionMode;
  setTransitionMode: (m: TransitionMode) => void;
  autoGain: boolean;
  setAutoGain: (v: boolean) => void;
  aiBeat: boolean;
  setAiBeat: (v: boolean) => void;
  /** Leave room at the bottom for the fixed Sendspin bar. */
  bottomInset: boolean;
}

export default function SettingsPanel({ skin, activeSkin, showSettings, showControls, setShowSettings, settings, setSettings,
  shuffleEnabled, setShuffleEnabled, shuffleInterval, setShuffleInterval, shufflePool, transitionMode, setTransitionMode,
  autoGain, setAutoGain, aiBeat, setAiBeat, bottomInset }: SettingsPanelProps) {
  const open = showSettings && showControls;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setShowSettings]);

  return (
    <div className={`${skin.settingsPanel} ${open ? 'translate-x-0' : 'translate-x-full'} ${bottomInset ? 'pb-28' : ''}`}>
      <div className="flex justify-between items-center mb-8">
        <h3 className={activeSkin === 'modern' ? 'text-xl font-light' : activeSkin === 'winamp' ? 'text-lg font-bold text-[#00ff00] uppercase tracking-wider' : activeSkin === 'crt' ? 'text-sm font-bold text-[#00ff00] uppercase tracking-[0.3em]' : 'text-lg font-bold text-[#000080]'}>Settings</h3>
        <button onClick={() => setShowSettings(false)} aria-label="Close panel" className={`p-2 -m-2 ${activeSkin === 'modern' ? 'text-white/50 hover:text-white transition-colors cursor-pointer' : activeSkin === 'winamp' ? 'cursor-pointer text-[#a0a0a0] hover:text-[#d0d0d0]' : activeSkin === 'crt' ? 'cursor-pointer text-[#00ff00]/50 hover:text-[#00ff00]' : 'cursor-pointer text-black'}`}>
          <X size={20} />
        </button>
      </div>

      <div className="space-y-8">
        <div>
          <div className="flex justify-between mb-2">
            <label className={skin.settingsLabel}>Sensitivity</label>
            <span className={skin.settingsValue}>{settings.sensitivity.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={settings.sensitivity}
            onChange={e => setSettings({...settings, sensitivity: parseFloat(e.target.value)})}
            className={skin.settingsSlider}
          />
          <p className={skin.settingsDescription}>Adjusts how strongly the visualizer reacts to volume.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <label className={skin.settingsLabel}>Speed</label>
            <span className={skin.settingsValue}>{settings.speed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={settings.speed}
            onChange={e => setSettings({...settings, speed: parseFloat(e.target.value)})}
            className={skin.settingsSlider}
          />
          <p className={skin.settingsDescription}>Controls the animation and movement speed.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <label className={skin.settingsLabel}>Scale</label>
            <span className={skin.settingsValue}>{settings.scale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={settings.scale}
            onChange={e => setSettings({...settings, scale: parseFloat(e.target.value)})}
            className={skin.settingsSlider}
          />
          <p className={skin.settingsDescription}>Scales the visualizer elements to fit the screen.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <label className={skin.settingsLabel}>Color Shift</label>
            <span className={skin.settingsValue}>{settings.hueShift}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={settings.hueShift}
            onChange={e => setSettings({...settings, hueShift: parseInt(e.target.value)})}
            className={skin.settingsSlider}
          />
          <p className={skin.settingsDescription}>Shifts the base colors across the spectrum.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2 items-center">
            <label className={skin.settingsLabel}>Shuffle</label>
            <button
              onClick={() => setShuffleEnabled(!shuffleEnabled)}
              className={`${skin.buttonGhost} ${shuffleEnabled ? skin.sendspinButtonActive : ''}`}
              aria-pressed={shuffleEnabled}
              data-testid="viz-shuffle-toggle"
            >
              <Shuffle size={14} />
              <span>{shuffleEnabled ? 'On' : 'Off'}</span>
            </button>
          </div>
          <select
            value={shuffleInterval}
            onChange={e => setShuffleInterval(parseInt(e.target.value, 10))}
            disabled={!shuffleEnabled}
            className={`${skin.select} w-full disabled:opacity-40 disabled:cursor-not-allowed`}
            data-testid="viz-shuffle-interval"
          >
            {SHUFFLE_PRESETS.map(p => (
              <option key={p.value} value={p.value} className={skin.selectOption}>{p.label}</option>
            ))}
          </select>
          <p className={skin.settingsDescription}>
            {shufflePool.length
              ? `Shuffling ${shufflePool.length} of ${visualizers.length} visualizers — edit the selection in the gallery.`
              : 'Automatically switch to a random visualizer at this interval.'}
          </p>
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <label className={skin.settingsLabel}>Transition</label>
          </div>
          <select
            value={transitionMode}
            onChange={e => setTransitionMode(e.target.value as TransitionMode)}
            className={`${skin.select} w-full`}
            data-testid="viz-transition"
          >
            <option value="crossfade" className={skin.selectOption}>Crossfade</option>
            <option value="quickcut" className={skin.selectOption}>Quick cut</option>
            <option value="instant" className={skin.selectOption}>Instant</option>
          </select>
          <p className={skin.settingsDescription}>How visualizer switches blend. Crossfade is smoothest; Quick cut and Instant use less GPU on weak hardware.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2 items-center">
            <label className={skin.settingsLabel}>Auto Gain</label>
            <button
              onClick={() => setAutoGain(!autoGain)}
              className={`${skin.buttonGhost} ${autoGain ? skin.sendspinButtonActive : ''}`}
              aria-pressed={autoGain}
              data-testid="viz-autogain-toggle"
            >
              <Gauge size={14} />
              <span>{autoGain ? 'On' : 'Off'}</span>
            </button>
          </div>
          <p className={skin.settingsDescription}>Normalizes the input level so quiet sources (e.g. a microphone) react as strongly as loud ones.</p>
        </div>

        <div>
          <div className="flex justify-between mb-2 items-center">
            <label className={skin.settingsLabel}>AI Beat Tracking</label>
            <button
              onClick={() => setAiBeat(!aiBeat)}
              className={`${skin.buttonGhost} ${aiBeat ? skin.sendspinButtonActive : ''}`}
              aria-pressed={aiBeat}
              data-testid="viz-aibeat-toggle"
            >
              <BrainCircuit size={14} />
              <span>{aiBeat ? 'On' : 'Off'}</span>
            </button>
          </div>
          <p className={skin.settingsDescription}>A small neural network keeps beat effects on the beat (not the off-beat). Uses extra CPU; turn off on slow devices.</p>
        </div>

        <button
          onClick={() => { setSettings(DEFAULT_SETTINGS); setAutoGain(false); setAiBeat(false); }}
          className={skin.settingsButton}
        >
          Reset to Defaults
        </button>
      </div>
          </div>
  );
}
