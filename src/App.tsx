import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Mic, MonitorUp, Square, Settings2, X, Maximize, Minimize, ChevronDown, Radio, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX } from 'lucide-react';
import { SendspinPlayer } from '@sendspin/sendspin-js';
import type { ServerStateMetadata, ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import githubIcon from './images/GitHub_Invertocat_White.svg';
import { VisualizerSettings } from './types';

type VisualizerType =
  | 'circular'
  | 'blurimage'
  | 'glitchbackground'
  | 'glitchdatabend'
  | 'yourlogo'
  | 'cybermatrix'
  | 'cybergridcanvas'
  | 'sheetmusic'
  | 'bars'
  | 'tunnel'
  | 'dutchgrid'
  | 'neonwave'
  | 'polysphere'
  | 'psychedelicskull'
  | 'ghostrainbow'
  | 'neonhextunnel'
  | 'fluidsmoke'
  | 'cosmicparticles'
  | 'dutchgridwebgl'
  | 'festivalstage'
  | 'defqonmainstage'
  | 'disneydroneshow'
  | 'fireworksshow'
  | 'glowsphere'
  | 'crtterminal'
  | 'datadashboard'
  | 'vinyl'
  | 'backgroundimage'
  | '3dequalizer'
  | 'flame'
  | 'vumeter'
  | 'vinylsendspin'
  | 'glitchbackgroundsendspin'
  | 'backgroundimagesendspin';

type VisualizerProps = {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
};

const visualizerComponents: Record<VisualizerType, React.LazyExoticComponent<React.ComponentType<VisualizerProps>>> = {
  circular: lazy(() => import('./components/visualizers/Circular')),
  blurimage: lazy(() => import('./components/visualizers/BlurVisualizer')),
  glitchbackground: lazy(() => import('./components/visualizers/GlitchVisualizer')),
  glitchdatabend: lazy(() => import('./components/visualizers/GlitchVisualizer2')),
  yourlogo: lazy(() => import('./components/visualizers/YourLogo')),
  cybermatrix: lazy(() => import('./components/visualizers/CyberMatrix')),
  cybergridcanvas: lazy(() => import('./components/visualizers/CyberGridCanvas')),
  sheetmusic: lazy(() => import('./components/visualizers/SheetMusic')),
  bars: lazy(() => import('./components/visualizers/Bars')),
  tunnel: lazy(() => import('./components/visualizers/Tunnel')),
  dutchgrid: lazy(() => import('./components/visualizers/MusicGrid')),
  neonwave: lazy(() => import('./components/visualizers/NeonWave')),
  polysphere: lazy(() => import('./components/visualizers/PolySphere')),
  psychedelicskull: lazy(() => import('./components/visualizers/PsychedelicSkull')),
  ghostrainbow: lazy(() => import('./components/visualizers/GhostRainbow')),
  neonhextunnel: lazy(() => import('./components/visualizers/NeonHexTunnel')),
  fluidsmoke: lazy(() => import('./components/visualizers/FluidSmoke')),
  cosmicparticles: lazy(() => import('./components/visualizers/WebGLParticles')),
  dutchgridwebgl: lazy(() => import('./components/visualizers/WebGLMusicGrid')),
  festivalstage: lazy(() => import('./components/visualizers/FestivalStage')),
  defqonmainstage: lazy(() => import('./components/visualizers/MegaFestivalStage')),
  disneydroneshow: lazy(() => import('./components/visualizers/DisneyDroneShow')),
  fireworksshow: lazy(() => import('./components/visualizers/FireworksShow')),
  glowsphere: lazy(() => import('./components/visualizers/PerlinSphere')),
  crtterminal: lazy(() => import('./components/visualizers/CRTTerminal')),
  datadashboard: lazy(() => import('./components/visualizers/DataDashboard')),
  vinyl: lazy(() => import('./components/visualizers/Vinyl')),
  backgroundimage: lazy(() => import('./components/visualizers/Background')),
  '3dequalizer': lazy(() => import('./components/visualizers/ThreeDEqualizer')),
  flame: lazy(() => import('./components/visualizers/FlameVisualizer')),
  vumeter: lazy(() => import('./components/visualizers/VUMeter')),
  vinylsendspin: lazy(() => import('./components/visualizers/VinylPlayer')),
  glitchbackgroundsendspin: lazy(() => import('./components/visualizers/GlitchPlayer')),
  backgroundimagesendspin: lazy(() => import('./components/visualizers/BackgroundPlayer')),
};

export default function App() {
  const appVersion = __APP_VERSION__;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVisualizer, setActiveVisualizer] = useState<VisualizerType>(() => {
    const viz = new URLSearchParams(window.location.search).get('viz');
    return viz && viz in visualizerComponents ? (viz as VisualizerType) : 'polysphere';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [settings, setSettings] = useState<VisualizerSettings>(() => {
    const params = new URLSearchParams(window.location.search);
    const num = (key: string, def: number) => {
      const v = params.get(key);
      if (v === null) return def;
      const n = parseFloat(v);
      return isNaN(n) ? def : n;
    };
    return {
      sensitivity: num('sensitivity', 1.0),
      speed: num('speed', 1.0),
      hueShift: num('hueShift', 0),
      scale: num('scale', 1.0),
    };
  });
  const [showSendspinDialog, setShowSendspinDialog] = useState(false);
  const [sendspinUrl, setSendspinUrl] = useState('');
  const sendspinPlayerRef = useRef<SendspinPlayer | null>(null);
  const sendspinAudioRef = useRef<HTMLAudioElement | null>(null);
  const [sendspinActive, setSendspinActive] = useState(false);
  const [sendspinPlaying, setSendspinPlaying] = useState(false);
  const [sendspinMetadata, setSendspinMetadata] = useState<ServerStateMetadata | null>(null);
  const [sendspinSupportedCmds, setSendspinSupportedCmds] = useState<string[]>([]);
  const [sendspinVolume, setSendspinVolume] = useState(100);
  const [sendspinMuted, setSendspinMuted] = useState(false);

  useEffect(() => {
    (window as any)._paq?.push(['trackEvent', 'Visualizer', 'Initial', activeVisualizer]);

    const params = new URLSearchParams(window.location.search);
    const sendspinParam = params.get('sendspin');
    if (sendspinParam) {
      setSendspinUrl(sendspinParam);
      setShowSendspinDialog(true);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('viz', activeVisualizer);
    const setOrDelete = (key: string, value: number, defaultValue: number) => {
      if (value !== defaultValue) params.set(key, value.toString());
      else params.delete(key);
    };
    setOrDelete('sensitivity', settings.sensitivity, 1.0);
    setOrDelete('speed', settings.speed, 1.0);
    setOrDelete('hueShift', settings.hueShift, 0);
    setOrDelete('scale', settings.scale, 1.0);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeVisualizer, settings]);

  useEffect(() => {
    // Allow layout to settle, then notify visualizers of the size change
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [showControls]);

  const startMicrophone = async () => {
    cleanupSendspin();
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false
        }
      });
      setStream(audioStream);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to access microphone');
    }
  };

  const startSystemAudio = async () => {
    cleanupSendspin();
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false
        }
      });

      if (displayStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach(track => track.stop());
        throw new Error('No audio found. Please make sure to check "Share audio" when selecting the screen/tab.');
      }

      setStream(displayStream);
      setError(null);

      displayStream.getVideoTracks()[0].onended = () => {
        stopStream(displayStream);
      };
    } catch (err: any) {
      setError(err.message || 'Failed to access system audio');
    }
  };

  const cleanupSendspin = () => {
    if (sendspinPlayerRef.current) {
      sendspinPlayerRef.current.disconnect('user_request');
      sendspinPlayerRef.current = null;
    }
    if (sendspinAudioRef.current) {
      sendspinAudioRef.current.pause();
      sendspinAudioRef.current.srcObject = null;
      sendspinAudioRef.current = null;
    }
    setSendspinActive(false);
    setSendspinPlaying(false);
    setSendspinMetadata(null);
    setSendspinSupportedCmds([]);
    setSendspinVolume(100);
    setSendspinMuted(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has('sendspin')) {
      params.delete('sendspin');
      const qs = params.toString();
      window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  };

  const startSendspin = async (url?: string) => {
    const serverUrl = url || sendspinUrl;
    try {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      sendspinAudioRef.current = audioEl;

      audioEl.addEventListener('playing', () => {
        if (audioEl.srcObject instanceof MediaStream) {
          setStream(audioEl.srcObject);
        }
      });

      const player = new SendspinPlayer({
        playerId: 'VoltViz',
        baseUrl: serverUrl,
        audioElement: audioEl,
        clientName: 'VoltViz',
        correctionMode: 'sync',
        onStateChange: (state) => {
          setSendspinPlaying(state.isPlaying);
          if (state.serverState?.metadata) {
            setSendspinMetadata(state.serverState.metadata);
          }
          if (state.serverState?.controller?.supported_commands) {
            setSendspinSupportedCmds(state.serverState.controller.supported_commands);
          }
          if (state.serverState?.controller?.volume !== undefined) {
            setSendspinVolume(state.serverState.controller.volume);
          }
          if (state.serverState?.controller?.muted !== undefined) {
            setSendspinMuted(state.serverState.controller.muted);
          }
          if (state.isPlaying && audioEl.srcObject instanceof MediaStream) {
            setStream(audioEl.srcObject);
          }
        }
      });

      sendspinPlayerRef.current = player;
      await player.connect();

      setError(null);
      setSendspinActive(true);
      setShowSendspinDialog(false);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Sendspin server');
      cleanupSendspin();
    }
  };

  const sendspinCommand = <T extends ControllerCommand>(command: T, params?: ControllerCommands[T]) => {
    if (sendspinPlayerRef.current) {
      sendspinPlayerRef.current.sendCommand(command, params as never);
    }
  };

  const stopStream = (currentStream: MediaStream | null = stream) => {
    cleanupSendspin();
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const renderVisualizer = () => {
    if (!stream) return null;
    const Visualizer = visualizerComponents[activeVisualizer];
    if (!Visualizer) return null;

    return (
      <Suspense fallback={<div className="w-full h-full" />}>
        <Visualizer stream={stream} settings={settings} sendspinMetadata={sendspinMetadata} />
      </Suspense>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans relative overflow-hidden">
      {/* Mobile hint */}
      <div className="md:hidden flex items-center justify-center gap-2 bg-white/5 border-b border-white/10 px-4 py-2 text-xs text-white/40 tracking-wide">
        <MonitorUp size={12} />
        <span>Best experienced on a desktop browser</span>
      </div>

      {/* Atmospheric background */}
      {!stream && (
        <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '4s' }}></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '7s' }}></div>
        </div>
      )}

      <div className="relative z-10 flex-1 flex flex-col">
        {showControls && (
          <header className="p-6 flex justify-between items-center bg-black/20 backdrop-blur-md border-b border-white/10 transition-all duration-300">
            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                <h1 className="text-2xl font-light tracking-widest uppercase">VoltViz<span className="font-bold text-green-400">Music Visualizer</span></h1>
                <p className="mt-1 text-xs tracking-[0.2em] text-white/60">inspired by winamp & sonique - created by sanderdw</p>
              </div>

              {stream && (
                <div className="relative">
                  <select
                    value={activeVisualizer}
                    onChange={(e) => {
                      const value = e.target.value as VisualizerType;
                      setActiveVisualizer(value);
                      (window as any)._paq?.push(['trackEvent', 'Visualizer', 'Select', value]);
                    }}
                    className="appearance-none bg-white/10 hover:bg-white/20 border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer transition-colors"
                  >
                    <option value="dutchgrid" className="bg-gray-900">Dutch Grid</option>
                    <option value="dutchgridwebgl" className="bg-gray-900">Dutch Grid (WebGL)</option>
                    <option value="glitchbackground" className="bg-gray-900">Glitch Background</option>
                    <option value="glitchdatabend" className="bg-gray-900">Glitch Databend</option>
                    <option value="yourlogo" className="bg-gray-900">Your Logo</option>
                    <option value="glowsphere" className="bg-gray-900">Glow Sphere</option>
                    <option value="crtterminal" className="bg-gray-900">CRT Terminal</option>
                    <option value="cosmicparticles" className="bg-gray-900">Cosmic Particles</option>
                    <option value="neonwave" className="bg-gray-900">Neon Wave</option>
                    <option value="sheetmusic" className="bg-gray-900">Sheet Music</option>
                    <option value="tunnel" className="bg-gray-900">Tunnel</option>
                    <option value="circular" className="bg-gray-900">Circular</option>
                    <option value="cybermatrix" className="bg-gray-900">Cyber Matrix</option>
                    <option value="cybergridcanvas" className="bg-gray-900">Cyber Grid Canvas</option>
                    <option value="bars" className="bg-gray-900">Bars</option>
                    <option value="polysphere" className="bg-gray-900">Poly Sphere</option>
                    <option value="psychedelicskull" className="bg-gray-900">Psychedelic Skull</option>
                    <option value="ghostrainbow" className="bg-gray-900">Ghost Rainbow</option>
                    <option value="neonhextunnel" className="bg-gray-900">Neon Hex Tunnel</option>
                    <option value="fluidsmoke" className="bg-gray-900">Fluid Smoke</option>
                    <option value="3dequalizer" className="bg-gray-900">3D Equalizer</option>
                    <option value="festivalstage" className="bg-gray-900">Festival Stage</option>
                    <option value="defqonmainstage" className="bg-gray-900">Defqon Mainstage</option>
                    <option value="disneydroneshow" className="bg-gray-900">Disney Drone Show</option>
                    <option value="fireworksshow" className="bg-gray-900">Fireworks Show</option>
                    <option value="datadashboard" className="bg-gray-900">Data Dashboard</option>
                    <option value="vinyl" className="bg-gray-900">Vinyl</option>
                    <option value="backgroundimage" className="bg-gray-900">Background Image</option>
                    <option value="blurimage" className="bg-gray-900">Blur Image</option>
                    <option value="flame" className="bg-gray-900">Flame</option>
                    <option value="vumeter" className="bg-gray-900">VU Meter</option>
                    <option value="vinylsendspin" className="bg-gray-900">Vinyl (Sendspin)</option>
                    <option value="glitchbackgroundsendspin" className="bg-gray-900">Glitch Background (Sendspin)</option>
                    <option value="backgroundimagesendspin" className="bg-gray-900">Background Image (Sendspin)</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                </div>
              )}
            </div>

            <div className="flex gap-4 items-center">
              <a
                href="https://github.com/sanderdw/voltviz"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 text-white/70 hover:text-white"
                title="GitHub"
                aria-label="Open GitHub profile"
              >
                <img src={githubIcon} alt="GitHub" width={20} height={20} />
              </a>
              {!stream ? (
                <>
                  <button
                    onClick={startMicrophone}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/5 text-sm cursor-pointer"
                  >
                    <Mic size={16} />
                    <span>Microphone</span>
                  </button>
                  <button
                    onClick={startSystemAudio}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-purple-600/80 hover:bg-purple-500 transition-colors border border-purple-400/30 text-sm shadow-[0_0_15px_rgba(147,51,234,0.3)] cursor-pointer"
                  >
                    <MonitorUp size={16} />
                    <span>System Audio</span>
                  </button>
                  <button
                    onClick={() => setShowSendspinDialog(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/5 text-sm cursor-pointer"
                  >
                    <Radio size={16} />
                    <span>Sendspin</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowControls(false)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 text-white/70 hover:text-white text-sm cursor-pointer"
                  >
                    <Maximize size={16} />
                    <span>Hide UI</span>
                  </button>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors border text-sm cursor-pointer ${showSettings ? 'bg-white/20 border-white/20 text-white' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'}`}
                  >
                    <Settings2 size={16} />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => stopStream()}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors border border-red-500/30 text-sm cursor-pointer"
                  >
                    <Square size={16} />
                    <span>Stop</span>
                  </button>
                </>
              )}
            </div>
          </header>
        )}

        <main className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
          {error && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/50 text-red-200 px-6 py-3 rounded-xl backdrop-blur-md z-50">
              {error}
            </div>
          )}

          {!stream ? (
            <div className="text-center max-w-md space-y-6 animate-in fade-in zoom-in duration-700 p-6">
              <div className="w-24 h-24 mx-auto border border-white/10 rounded-full flex items-center justify-center bg-white/5 backdrop-blur-sm">
                <MonitorUp size={40} className="text-purple-400 opacity-80" />
              </div>
              <h2 className="text-3xl font-light">Visualize Your Sound</h2>
              <p className="text-white/50 font-light leading-relaxed">
                Select an audio source above to begin. For system audio, choose "Share Tab" or "Share Screen" and ensure <strong className="text-white/80">Share audio</strong> is checked.
              </p>
            </div>
          ) : (
            <div className="w-full h-full absolute inset-0">
               {renderVisualizer()}
            </div>
          )}

          {!showControls && stream && (
            <button
              onClick={() => setShowControls(true)}
              className="absolute top-6 right-6 p-3 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 text-white/50 hover:text-white transition-all cursor-pointer z-50 group"
              title="Show UI"
            >
              <Minimize size={20} className="group-hover:scale-90 transition-transform" />
            </button>
          )}

          {/* Settings Panel */}
          <div className={`absolute top-0 right-0 bottom-0 w-80 bg-black/80 backdrop-blur-xl border-l border-white/10 p-6 transform transition-transform duration-300 z-50 ${showSettings && showControls ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-light">Settings</h3>
              <button onClick={() => setShowSettings(false)} className="text-white/50 hover:text-white transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-8">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-white/70">Sensitivity</label>
                  <span className="text-sm text-purple-400">{settings.sensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={settings.sensitivity}
                  onChange={e => setSettings({...settings, sensitivity: parseFloat(e.target.value)})}
                  className="w-full accent-purple-500"
                />
                <p className="text-xs text-white/40 mt-2">Adjusts how strongly the visualizer reacts to volume.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-white/70">Speed</label>
                  <span className="text-sm text-purple-400">{settings.speed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={settings.speed}
                  onChange={e => setSettings({...settings, speed: parseFloat(e.target.value)})}
                  className="w-full accent-purple-500"
                />
                <p className="text-xs text-white/40 mt-2">Controls the animation and movement speed.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-white/70">Scale</label>
                  <span className="text-sm text-purple-400">{settings.scale.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={settings.scale}
                  onChange={e => setSettings({...settings, scale: parseFloat(e.target.value)})}
                  className="w-full accent-purple-500"
                />
                <p className="text-xs text-white/40 mt-2">Scales the visualizer elements to fit the screen.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-white/70">Color Shift</label>
                  <span className="text-sm text-purple-400">{settings.hueShift}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={settings.hueShift}
                  onChange={e => setSettings({...settings, hueShift: parseInt(e.target.value)})}
                  className="w-full accent-purple-500"
                />
                <p className="text-xs text-white/40 mt-2">Shifts the base colors across the spectrum.</p>
              </div>

              <button
                onClick={() => setSettings({ sensitivity: 1.0, speed: 1.0, hueShift: 0, scale: 1.0 })}
                className="w-full py-2 mt-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors cursor-pointer"
              >
                Reset to Defaults
              </button>
            </div>
          </div>

          <div className="absolute bottom-3 left-4 text-[10px] tracking-[0.18em] uppercase text-white/25 pointer-events-none select-none z-40">
            v{appVersion}
          </div>
        </main>
      </div>

      {sendspinActive && showControls && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-black/70 backdrop-blur-xl border border-white/10 rounded-t-2xl px-6 py-3 flex items-center gap-4" data-testid="sendspin-controls">
            {/* Track info */}
            {sendspinMetadata?.title && (
              <div className="flex items-center gap-3 mr-2 min-w-0">
                {sendspinMetadata.artwork_url && (
                  <img src={sendspinMetadata.artwork_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm text-white truncate max-w-[200px]">{sendspinMetadata.title}</div>
                  {sendspinMetadata.artist && (
                    <div className="text-xs text-white/50 truncate max-w-[200px]">{sendspinMetadata.artist}</div>
                  )}
                </div>
              </div>
            )}

            {/* Playback controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => sendspinCommand('previous')}
                disabled={!sendspinSupportedCmds.includes('previous')}
                className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous"
                data-testid="sendspin-previous"
              >
                <SkipBack size={18} />
              </button>
              {sendspinPlaying ? (
                <button
                  onClick={() => sendspinCommand('pause')}
                  disabled={!sendspinSupportedCmds.includes('pause')}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Pause"
                  data-testid="sendspin-pause"
                >
                  <Pause size={20} />
                </button>
              ) : (
                <button
                  onClick={() => sendspinCommand('play')}
                  disabled={!sendspinSupportedCmds.includes('play')}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Play"
                  data-testid="sendspin-play"
                >
                  <Play size={20} />
                </button>
              )}
              <button
                onClick={() => sendspinCommand('stop')}
                disabled={!sendspinSupportedCmds.includes('stop')}
                className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Stop"
                data-testid="sendspin-stop"
              >
                <Square size={16} />
              </button>
              <button
                onClick={() => sendspinCommand('next')}
                disabled={!sendspinSupportedCmds.includes('next')}
                className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next"
                data-testid="sendspin-next"
              >
                <SkipForward size={18} />
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-white/10" />

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => sendspinCommand('mute', { mute: !sendspinMuted })}
                disabled={!sendspinSupportedCmds.includes('mute')}
                className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${sendspinMuted ? 'text-red-400' : 'text-white/70 hover:text-white'}`}
                title={sendspinMuted ? 'Unmute' : 'Mute'}
                data-testid="sendspin-mute"
              >
                {sendspinMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={sendspinMuted ? 0 : sendspinVolume}
                onChange={e => {
                  const vol = parseInt(e.target.value);
                  sendspinCommand('volume', { volume: vol });
                  setSendspinVolume(vol);
                  if (sendspinMuted && vol > 0) {
                    sendspinCommand('mute', { mute: false });
                    setSendspinMuted(false);
                  }
                }}
                disabled={!sendspinSupportedCmds.includes('volume')}
                className="w-20 accent-purple-500 disabled:opacity-30"
                title={`Volume: ${sendspinVolume}%`}
                data-testid="sendspin-volume"
              />
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-white/10" />

            {/* Shuffle & Repeat */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => sendspinCommand(sendspinMetadata?.shuffle ? 'unshuffle' : 'shuffle')}
                disabled={sendspinMetadata?.shuffle ? !sendspinSupportedCmds.includes('unshuffle') : !sendspinSupportedCmds.includes('shuffle')}
                className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${sendspinMetadata?.shuffle ? 'text-purple-400' : 'text-white/70 hover:text-white'}`}
                title={sendspinMetadata?.shuffle ? 'Unshuffle' : 'Shuffle'}
                data-testid="sendspin-shuffle"
              >
                <Shuffle size={16} />
              </button>
              <button
                onClick={() => {
                  const current = sendspinMetadata?.repeat ?? 'off';
                  const next: ControllerCommand = current === 'off' ? 'repeat_all' : current === 'all' ? 'repeat_one' : 'repeat_off';
                  sendspinCommand(next);
                }}
                disabled={!sendspinSupportedCmds.includes('repeat_off')}
                className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${sendspinMetadata?.repeat && sendspinMetadata.repeat !== 'off' ? 'text-purple-400' : 'text-white/70 hover:text-white'}`}
                title={`Repeat: ${sendspinMetadata?.repeat ?? 'off'}`}
                data-testid="sendspin-repeat"
              >
                {sendspinMetadata?.repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendspinDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4 mx-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-light">Connect to Sendspin</h3>
              <button onClick={() => setShowSendspinDialog(false)} className="text-white/50 hover:text-white transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <p className="text-white/50 text-sm">Enter the URL of your Sendspin server to stream synchronized audio.</p>
            <input
              type="url"
              value={sendspinUrl}
              onChange={e => setSendspinUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && sendspinUrl) startSendspin(); }}
              placeholder="http://homeassistant.local:8927"
              className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSendspinDialog(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => startSendspin()}
                disabled={!sendspinUrl}
                className="px-4 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-500 border border-purple-400/30 text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
