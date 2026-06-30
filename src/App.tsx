import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MonitorUp, Square, Settings2, X, Maximize, Minimize, ChevronDown, Radio, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX } from 'lucide-react';
import { SendspinPlayer } from '@sendspin/sendspin-js';
import type { ServerStateMetadata, ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import githubIcon from './images/GitHub_Invertocat_White.svg';
import { VisualizerSettings } from './types';
import { skins, SkinType } from './skins';

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
  | 'hexglobe'
  | 'vinylsendspin'
  | 'glitchbackgroundsendspin'
  | 'backgroundimagesendspin'
  | 'icons'
  | 'milkdrop'
  | 'milkdropwarp'
  | 'aurorawaves'
  | 'msdefrag'
  | 'fractalorb'
  | 'mossball'
  | 'razor1911'
  | 'ascii'
  | 'cybercity'
  | 'audiodebug'
  | 'aurumleaf'
  | 'anunakisphere'
  | 'trailsstream'
  | 'shambhala'
  | 'holoblinds'
  | 'insidequantum'
  | 'particlesstream';

type VisualizerProps = {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
};

type SendspinState = {
  active: boolean;
  playing: boolean;
  metadata: ServerStateMetadata | null;
  supportedCmds: string[];
  volume: number;
  muted: boolean;
};

const initialSendspinState: SendspinState = {
  active: false,
  playing: false,
  metadata: null,
  supportedCmds: [],
  volume: 100,
  muted: false,
};

const visualizerComponents: Record<VisualizerType, React.LazyExoticComponent<React.ComponentType<VisualizerProps>>> = {
  circular: lazy(() => import('./components/visualizers/Circular')),
  blurimage: lazy(() => import('./components/visualizers/BlurImage')),
  glitchbackground: lazy(() => import('./components/visualizers/GlitchBackground')),
  glitchdatabend: lazy(() => import('./components/visualizers/GlitchDatabend')),
  yourlogo: lazy(() => import('./components/visualizers/YourLogo')),
  cybermatrix: lazy(() => import('./components/visualizers/CyberMatrix')),
  cybergridcanvas: lazy(() => import('./components/visualizers/CyberGridCanvas')),
  sheetmusic: lazy(() => import('./components/visualizers/SheetMusic')),
  bars: lazy(() => import('./components/visualizers/Bars')),
  tunnel: lazy(() => import('./components/visualizers/Tunnel')),
  dutchgrid: lazy(() => import('./components/visualizers/DutchGrid')),
  neonwave: lazy(() => import('./components/visualizers/NeonWave')),
  polysphere: lazy(() => import('./components/visualizers/PolySphere')),
  psychedelicskull: lazy(() => import('./components/visualizers/PsychedelicSkull')),
  ghostrainbow: lazy(() => import('./components/visualizers/GhostRainbow')),
  neonhextunnel: lazy(() => import('./components/visualizers/NeonHexTunnel')),
  fluidsmoke: lazy(() => import('./components/visualizers/FluidSmoke')),
  cosmicparticles: lazy(() => import('./components/visualizers/CosmicParticles')),
  dutchgridwebgl: lazy(() => import('./components/visualizers/DutchGridWebGL')),
  festivalstage: lazy(() => import('./components/visualizers/FestivalStage')),
  defqonmainstage: lazy(() => import('./components/visualizers/DefqonMainstage')),
  disneydroneshow: lazy(() => import('./components/visualizers/DisneyDroneShow')),
  fireworksshow: lazy(() => import('./components/visualizers/FireworksShow')),
  glowsphere: lazy(() => import('./components/visualizers/GlowSphere')),
  crtterminal: lazy(() => import('./components/visualizers/CRTTerminal')),
  datadashboard: lazy(() => import('./components/visualizers/DataDashboard')),
  vinyl: lazy(() => import('./components/visualizers/Vinyl')),
  backgroundimage: lazy(() => import('./components/visualizers/BackgroundImage')),
  '3dequalizer': lazy(() => import('./components/visualizers/ThreeDEqualizer')),
  flame: lazy(() => import('./components/visualizers/Flame')),
  vumeter: lazy(() => import('./components/visualizers/VUMeter')),
  hexglobe: lazy(() => import('./components/visualizers/HexGlobe')),
  vinylsendspin: lazy(() => import('./components/visualizers/VinylSendspin')),
  glitchbackgroundsendspin: lazy(() => import('./components/visualizers/GlitchBackgroundSendspin')),
  backgroundimagesendspin: lazy(() => import('./components/visualizers/BackgroundImageSendspin')),
  icons: lazy(() => import('./components/visualizers/Icons')),
  milkdrop: lazy(() => import('./components/visualizers/MilkDrop')),
  milkdropwarp: lazy(() => import('./components/visualizers/MilkDropWarp')),
  aurorawaves: lazy(() => import('./components/visualizers/AuroraWaves')),
  msdefrag: lazy(() => import('./components/visualizers/MsDefrag')),
  fractalorb: lazy(() => import('./components/visualizers/FractalOrb')),
  mossball: lazy(() => import('./components/visualizers/MossBall')),
  razor1911: lazy(() => import('./components/visualizers/Razor1911')),
  ascii: lazy(() => import('./components/visualizers/Ascii')),
  cybercity: lazy(() => import('./components/visualizers/CyberCity')),
  audiodebug: lazy(() => import('./components/visualizers/AudioDebug')),
  aurumleaf: lazy(() => import('./components/visualizers/AurumLeaf')),
  anunakisphere: lazy(() => import('./components/visualizers/AnunakiSphere')),
  trailsstream: lazy(() => import('./components/visualizers/TrailsStream')),
  shambhala: lazy(() => import('./components/visualizers/Shambhala')),
  holoblinds: lazy(() => import('./components/visualizers/HoloBlinds')),
  insidequantum: lazy(() => import('./components/visualizers/InsideQuantum')),
  particlesstream: lazy(() => import('./components/visualizers/ParticlesStream')),
};

export default function App() {
  const appVersion = __APP_VERSION__;
  const sendspinClientIdRef = useRef(
    `VoltViz-${typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)}`
  );
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
  const [activeSkin, setActiveSkin] = useState<SkinType>(() => {
    const s = new URLSearchParams(window.location.search).get('skin');
    return s && s in skins ? (s as SkinType) : 'modern';
  });
  const skin = skins[activeSkin];
  const [showSendspinDialog, setShowSendspinDialog] = useState(false);
  const [sendspinUrl, setSendspinUrl] = useState('');
  const sendspinPlayerRef = useRef<SendspinPlayer | null>(null);
  const sendspinAudioRef = useRef<HTMLAudioElement | null>(null);
  const [sendspin, setSendspin] = useState<SendspinState>(initialSendspinState);
  const updateSendspin = (patch: Partial<SendspinState>) => setSendspin(prev => ({ ...prev, ...patch }));

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
    if (activeSkin !== 'modern') params.set('skin', activeSkin);
    else params.delete('skin');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeVisualizer, settings, activeSkin]);

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
    setSendspin(initialSendspinState);
    const params = new URLSearchParams(window.location.search);
    if (params.has('sendspin')) {
      params.delete('sendspin');
      const qs = params.toString();
      window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  };

  const unhidePlayerInMA = async (playerId: string) => {
    try {
      const configResp = await fetch(new URL('ma-config.json', window.location.href).href);
      if (!configResp.ok) return;
      const { ingress_entry } = await configResp.json();
      if (!ingress_entry) return;

      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ingressPath = ingress_entry.endsWith('/') ? ingress_entry : ingress_entry + '/';
      const ws = new WebSocket(`${wsProto}//${window.location.host}${ingressPath}ws`);
      let commandSent = false;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (!commandSent && msg.server_version) {
          commandSent = true;
          const msgId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          ws.send(JSON.stringify({
            message_id: msgId,
            command: 'config/players/save',
            args: { player_id: playerId, values: { hide_in_ui: false } }
          }));
          setTimeout(() => ws.close(), 2000);
        }
      };
      ws.onerror = () => ws.close();
    } catch { /* not running in HA add-on context */ }
  };

  const startSendspin = async (url?: string) => {
    const serverUrl = url || sendspinUrl;
    try {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      sendspinAudioRef.current = audioEl;

      audioEl.addEventListener('playing', () => {
        if (audioEl.srcObject instanceof MediaStream) {
          setStream(audioEl.srcObject);
        }
      });

      const player = new SendspinPlayer({
        playerId: sendspinClientIdRef.current,
        baseUrl: serverUrl,
        audioElement: audioEl,
        clientName: 'VoltViz',
        correctionMode: 'quality-local',
        onStateChange: (state) => {
          const patch: Partial<SendspinState> = { playing: state.isPlaying };
          if (state.serverState?.metadata) {
            patch.metadata = state.serverState.metadata;
          }
          if (state.serverState?.controller?.supported_commands) {
            patch.supportedCmds = state.serverState.controller.supported_commands;
          }
          if (state.serverState?.controller?.volume !== undefined) {
            patch.volume = state.serverState.controller.volume;
          }
          if (state.serverState?.controller?.muted !== undefined) {
            patch.muted = state.serverState.controller.muted;
          }
          updateSendspin(patch);
          if (state.isPlaying && audioEl.srcObject instanceof MediaStream) {
            setStream(audioEl.srcObject);
            // Ensure playback on mobile where autoplay may be blocked
            if (audioEl.paused) {
              audioEl.play().catch(() => {});
            }
          }
        }
      });

      sendspinPlayerRef.current = player;
      await player.connect();
      // Kick-start playback on mobile where autoplay may be blocked
      audioEl.play().catch(() => {});

      unhidePlayerInMA(sendspinClientIdRef.current);

      setError(null);
      updateSendspin({ active: true });
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

  const visualizerElement = useMemo(() => {
    if (!stream) return null;
    const Visualizer = visualizerComponents[activeVisualizer];
    if (!Visualizer) return null;

    return (
      <Suspense fallback={<div className="w-full h-full" />}>
        <Visualizer stream={stream} settings={settings} sendspinMetadata={sendspin.metadata} />
      </Suspense>
    );
  }, [stream, activeVisualizer, settings, sendspin.metadata]);

  return (
    <div className={skin.root}>
      {/* Mobile hint */}
      <div className={skin.mobileHint}>
        <MonitorUp size={12} />
        <span>Small screens are not supported, use "Desktopsite"</span>
      </div>

      {/* Atmospheric background */}
      {!stream && skin.atmosphericBg && (
        <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '4s' }}></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '7s' }}></div>
        </div>
      )}

      <div className="relative z-10 flex-1 flex flex-col">
        {showControls && (
          <header className={skin.header}>
            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                <h1 className={skin.title}>VoltViz<span className={activeSkin === 'modern' ? 'font-bold text-green-400' : activeSkin === 'winamp' ? 'font-bold text-[#00ff00]' : activeSkin === 'crt' ? 'font-bold text-[#00ff00]' : 'font-bold text-[#008000]'}> Music Visualizer</span></h1>
                <p className={skin.subtitle}>inspired by winamp - created by <a href="https://github.com/sanderdw/voltviz" target="_blank" rel="noopener noreferrer" className={activeSkin === 'win95' ? 'text-[#000080] underline' : activeSkin === 'winamp' ? 'text-[#00ff00]/80 hover:text-[#00ff00]' : activeSkin === 'crt' ? 'text-[#00ff00]/70 hover:text-[#00ff00]' : 'text-white/80 hover:text-white transition-colors'}>sanderdw</a></p>
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
                    className={skin.select}
                  >
                    <option value="dutchgrid" className={skin.selectOption}>Dutch Grid</option>
                    <option value="dutchgridwebgl" className={skin.selectOption}>Dutch Grid (WebGL)</option>
                    <option value="glitchbackground" className={skin.selectOption}>Glitch Background</option>
                    <option value="glitchdatabend" className={skin.selectOption}>Glitch Databend</option>
                    <option value="yourlogo" className={skin.selectOption}>Your Logo</option>
                    <option value="icons" className={skin.selectOption}>Icons</option>
                    <option value="glowsphere" className={skin.selectOption}>Glow Sphere</option>
                    <option value="crtterminal" className={skin.selectOption}>CRT Terminal</option>
                    <option value="cosmicparticles" className={skin.selectOption}>Cosmic Particles</option>
                    <option value="neonwave" className={skin.selectOption}>Neon Wave</option>
                    <option value="sheetmusic" className={skin.selectOption}>Sheet Music</option>
                    <option value="tunnel" className={skin.selectOption}>Tunnel</option>
                    <option value="particlesstream" className={skin.selectOption}>Particles Stream</option>
                    <option value="circular" className={skin.selectOption}>Circular</option>
                    <option value="cybermatrix" className={skin.selectOption}>Cyber Matrix</option>
                    <option value="cybergridcanvas" className={skin.selectOption}>Cyber Grid Canvas</option>
                    <option value="bars" className={skin.selectOption}>Bars</option>
                    <option value="polysphere" className={skin.selectOption}>Poly Sphere</option>
                    <option value="psychedelicskull" className={skin.selectOption}>Psychedelic Skull</option>
                    <option value="ghostrainbow" className={skin.selectOption}>Ghost Rainbow</option>
                    <option value="neonhextunnel" className={skin.selectOption}>Neon Hex Tunnel</option>
                    <option value="fluidsmoke" className={skin.selectOption}>Fluid Smoke</option>
                    <option value="3dequalizer" className={skin.selectOption}>3D Equalizer</option>
                    <option value="festivalstage" className={skin.selectOption}>Festival Stage</option>
                    <option value="defqonmainstage" className={skin.selectOption}>Defqon Mainstage</option>
                    <option value="disneydroneshow" className={skin.selectOption}>Disney Drone Show</option>
                    <option value="fireworksshow" className={skin.selectOption}>Fireworks Show</option>
                    <option value="datadashboard" className={skin.selectOption}>Data Dashboard</option>
                    <option value="vinyl" className={skin.selectOption}>Vinyl</option>
                    <option value="backgroundimage" className={skin.selectOption}>Background Image</option>
                    <option value="blurimage" className={skin.selectOption}>Blur Image</option>
                    <option value="flame" className={skin.selectOption}>Flame</option>
                    <option value="vumeter" className={skin.selectOption}>VU Meter</option>
                    <option value="hexglobe" className={skin.selectOption}>Hex Globe</option>
                    <option value="milkdrop" className={skin.selectOption}>MilkDrop</option>
                    <option value="milkdropwarp" className={skin.selectOption}>MilkDrop Warp</option>
                    <option value="aurorawaves" className={skin.selectOption}>Aurora Waves</option>
                    <option value="msdefrag" className={skin.selectOption}>MS Defrag</option>
                    <option value="fractalorb" className={skin.selectOption}>Fractal Orb</option>
                    <option value="mossball" className={skin.selectOption}>Moss Ball</option>
                    <option value="razor1911" className={skin.selectOption}>Razor 1911</option>
                    <option value="ascii" className={skin.selectOption}>ASCII</option>
                    <option value="cybercity" className={skin.selectOption}>Cyber City</option>
                    <option value="audiodebug" className={skin.selectOption}>Audio Debug</option>
                    <option value="aurumleaf" className={skin.selectOption}>Aurum Leaf</option>
                    <option value="anunakisphere" className={skin.selectOption}>Anunaki Sphere</option>
                    <option value="trailsstream" className={skin.selectOption}>Trails Stream</option>
                    <option value="shambhala" className={skin.selectOption}>Shambhala</option>
                    <option value="holoblinds" className={skin.selectOption}>Holo Blinds</option>
                    <option value="insidequantum" className={skin.selectOption}>Inside Quantum</option>
                    <option value="vinylsendspin" className={skin.selectOption}>Vinyl (Sendspin)</option>
                    <option value="glitchbackgroundsendspin" className={skin.selectOption}>Glitch Background (Sendspin)</option>
                    <option value="backgroundimagesendspin" className={skin.selectOption}>Background Image (Sendspin)</option>
                  </select>
                  <ChevronDown size={16} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${activeSkin === 'win95' ? 'text-black' : activeSkin === 'winamp' ? 'text-[#00ff00]/50' : activeSkin === 'crt' ? 'text-[#00ff00]/50' : 'text-white/50'}`} />
                </div>
              )}
            </div>

            <div className="flex gap-4 items-center">
              <a
                href="https://github.com/sanderdw/voltviz"
                target="_blank"
                rel="noopener noreferrer"
                className={activeSkin === 'win95' ? 'p-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080]' : activeSkin === 'winamp' ? 'p-1 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a]' : activeSkin === 'crt' ? 'p-1.5 border border-[#00ff00]/30 hover:border-[#00ff00]/60 hover:shadow-[0_0_8px_rgba(0,255,0,0.2)]' : 'p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 text-white/70 hover:text-white'}
                title="GitHub"
                aria-label="Open GitHub profile"
              >
                <img src={githubIcon} alt="GitHub" width={20} height={20} className={activeSkin === 'win95' ? 'invert' : ''} />
              </a>
              {!stream ? (
                <>
                  <button
                    onClick={startMicrophone}
                    className={skin.buttonSecondary}
                  >
                    <Mic size={16} />
                    <span>Microphone</span>
                  </button>
                  <button
                    onClick={startSystemAudio}
                    className={skin.buttonPrimary}
                  >
                    <MonitorUp size={16} />
                    <span>System Audio</span>
                  </button>
                  <button
                    onClick={() => setShowSendspinDialog(true)}
                    className={skin.buttonSecondary}
                  >
                    <Radio size={16} />
                    <span>Sendspin</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowControls(false)}
                    className={skin.buttonGhost}
                  >
                    <Maximize size={16} />
                    <span>Hide UI</span>
                  </button>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={skin.buttonGhost}
                  >
                    <Settings2 size={16} />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => stopStream()}
                    className={skin.buttonDanger}
                  >
                    <Square size={16} />
                    <span>Stop</span>
                  </button>
                </>
              )}
            </div>
          </header>
        )}

        <main className={skin.body}>
          {!stream ? (
            <div className="text-center max-w-md space-y-6 animate-in fade-in zoom-in duration-700 p-6">
              <div className={skin.heroIcon}>
                <MonitorUp size={40} className={activeSkin === 'modern' ? 'text-purple-400 opacity-80' : activeSkin === 'winamp' ? 'text-[#00ff00]' : activeSkin === 'crt' ? 'text-[#00ff00]' : 'text-[#000080]'} />
              </div>
              <h2 className={skin.heroTitle}>Visualize Your Sound</h2>
              <p className={skin.heroText}>
                Select an audio source above to begin. For system audio, choose "Share Tab" or "Share Screen" and ensure <strong className={activeSkin === 'modern' ? 'text-white/80' : activeSkin === 'winamp' ? 'text-[#00ff00]' : activeSkin === 'crt' ? 'text-[#00ff00]' : 'font-bold'}>Share audio</strong> is checked.
              </p>
            </div>
          ) : (
            <div className="w-full h-full absolute inset-0">
               {visualizerElement}
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
          <div className={`${skin.settingsPanel} ${showSettings && showControls ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex justify-between items-center mb-8">
              <h3 className={activeSkin === 'modern' ? 'text-xl font-light' : activeSkin === 'winamp' ? 'text-lg font-bold text-[#00ff00] uppercase tracking-wider' : activeSkin === 'crt' ? 'text-sm font-bold text-[#00ff00] uppercase tracking-[0.3em]' : 'text-lg font-bold text-[#000080]'}>Settings</h3>
              <button onClick={() => setShowSettings(false)} className={activeSkin === 'modern' ? 'text-white/50 hover:text-white transition-colors cursor-pointer' : activeSkin === 'winamp' ? 'cursor-pointer text-[#a0a0a0] hover:text-[#d0d0d0]' : activeSkin === 'crt' ? 'cursor-pointer text-[#00ff00]/50 hover:text-[#00ff00]' : 'cursor-pointer text-black'}>
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

              <button
                onClick={() => setSettings({ sensitivity: 1.0, speed: 1.0, hueShift: 0, scale: 1.0 })}
                className={skin.settingsButton}
              >
                Reset to Defaults
              </button>
            </div>
          </div>

          <div className={skin.versionLabel}>
            v{appVersion}
          </div>
        </main>
      </div>

      {sendspin.active && showControls && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className={skin.sendspinBar} data-testid="sendspin-controls">
            {/* Track info */}
            {sendspin.metadata?.title && (
              <div className="flex items-center gap-3 mr-2 min-w-0">
                {sendspin.metadata.artwork_url && (
                  <img src={sendspin.metadata.artwork_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className={skin.sendspinTrackTitle}>{sendspin.metadata.title}</div>
                  {sendspin.metadata.artist && (
                    <div className={skin.sendspinTrackArtist}>{sendspin.metadata.artist}</div>
                  )}
                </div>
              </div>
            )}

            {/* Playback controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => sendspinCommand('previous')}
                disabled={!sendspin.supportedCmds.includes('previous')}
                className={skin.sendspinButton}
                title="Previous"
                data-testid="sendspin-previous"
              >
                <SkipBack size={18} />
              </button>
              {sendspin.playing ? (
                <button
                  onClick={() => sendspinCommand('pause')}
                  disabled={!sendspin.supportedCmds.includes('pause')}
                  className={skin.sendspinPlayButton}
                  title="Pause"
                  data-testid="sendspin-pause"
                >
                  <Pause size={20} />
                </button>
              ) : (
                <button
                  onClick={() => sendspinCommand('play')}
                  disabled={!sendspin.supportedCmds.includes('play')}
                  className={skin.sendspinPlayButton}
                  title="Play"
                  data-testid="sendspin-play"
                >
                  <Play size={20} />
                </button>
              )}
              <button
                onClick={() => sendspinCommand('stop')}
                disabled={!sendspin.supportedCmds.includes('stop')}
                className={skin.sendspinButton}
                title="Stop"
                data-testid="sendspin-stop"
              >
                <Square size={16} />
              </button>
              <button
                onClick={() => sendspinCommand('next')}
                disabled={!sendspin.supportedCmds.includes('next')}
                className={skin.sendspinButton}
                title="Next"
                data-testid="sendspin-next"
              >
                <SkipForward size={18} />
              </button>
            </div>

            {/* Divider */}
            <div className={skin.sendspinDivider} />

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => sendspinCommand('mute', { mute: !sendspin.muted })}
                disabled={!sendspin.supportedCmds.includes('mute')}
                className={`${skin.sendspinButton} ${sendspin.muted ? 'text-red-400' : ''}`}
                title={sendspin.muted ? 'Unmute' : 'Mute'}
                data-testid="sendspin-mute"
              >
                {sendspin.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={sendspin.muted ? 0 : sendspin.volume}
                onChange={e => {
                  const vol = parseInt(e.target.value);
                  sendspinCommand('volume', { volume: vol });
                  updateSendspin({ volume: vol });
                  if (sendspin.muted && vol > 0) {
                    sendspinCommand('mute', { mute: false });
                    updateSendspin({ muted: false });
                  }
                }}
                disabled={!sendspin.supportedCmds.includes('volume')}
                className={skin.sendspinVolumeSlider}
                title={`Volume: ${sendspin.volume}%`}
                data-testid="sendspin-volume"
              />
            </div>

            {/* Divider */}
            <div className={skin.sendspinDivider} />

            {/* Shuffle & Repeat */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => sendspinCommand(sendspin.metadata?.shuffle ? 'unshuffle' : 'shuffle')}
                disabled={sendspin.metadata?.shuffle ? !sendspin.supportedCmds.includes('unshuffle') : !sendspin.supportedCmds.includes('shuffle')}
                className={`${skin.sendspinButton} ${sendspin.metadata?.shuffle ? skin.sendspinButtonActive : ''}`}
                title={sendspin.metadata?.shuffle ? 'Unshuffle' : 'Shuffle'}
                data-testid="sendspin-shuffle"
              >
                <Shuffle size={16} />
              </button>
              <button
                onClick={() => {
                  const current = sendspin.metadata?.repeat ?? 'off';
                  const next: ControllerCommand = current === 'off' ? 'repeat_all' : current === 'all' ? 'repeat_one' : 'repeat_off';
                  sendspinCommand(next);
                }}
                disabled={!sendspin.supportedCmds.includes('repeat_off')}
                className={`${skin.sendspinButton} ${sendspin.metadata?.repeat && sendspin.metadata.repeat !== 'off' ? skin.sendspinButtonActive : ''}`}
                title={`Repeat: ${sendspin.metadata?.repeat ?? 'off'}`}
                data-testid="sendspin-repeat"
              >
                {sendspin.metadata?.repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className={skin.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-white transition-colors cursor-pointer flex-shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      {showSendspinDialog && (
        <div className={skin.dialogOverlay}>
          <div className={skin.dialog}>
            {activeSkin === 'win95' && (
              <div className="bg-[#000080] px-2 py-1 flex justify-between items-center -mx-1 -mt-1 mb-2">
                <span className="text-white text-sm font-bold">Connect to Sendspin</span>
                <button onClick={() => setShowSendspinDialog(false)} className="bg-[#c0c0c0] border border-t-white border-l-white border-b-[#808080] border-r-[#808080] px-1.5 text-black text-xs font-bold cursor-pointer">X</button>
              </div>
            )}
            {activeSkin === 'winamp' && (
              <div className="flex justify-between items-center bg-[#2a2a3a] border-b border-[#1a1a2a] -mx-5 -mt-5 mb-3 px-4 py-2">
                <h3 className="text-sm font-bold text-[#d0d0d0] uppercase tracking-wider">Connect to Sendspin</h3>
                <button onClick={() => setShowSendspinDialog(false)} className="text-[#a0a0a0] hover:text-[#d0d0d0] cursor-pointer">
                  <X size={18} />
                </button>
              </div>
            )}
            {activeSkin === 'crt' && (
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-[#00ff00] uppercase tracking-[0.3em]">Connect to Sendspin</h3>
                <button onClick={() => setShowSendspinDialog(false)} className="text-[#00ff00]/50 hover:text-[#00ff00] cursor-pointer">
                  <X size={18} />
                </button>
              </div>
            )}
            {activeSkin === 'modern' && (
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-light">Connect to Sendspin</h3>
                <button onClick={() => setShowSendspinDialog(false)} className="text-white/50 hover:text-white transition-colors cursor-pointer">
                  <X size={20} />
                </button>
              </div>
            )}
            <p className={activeSkin === 'modern' ? 'text-white/50 text-sm' : activeSkin === 'winamp' ? 'text-[#00ff00]/60 text-sm' : activeSkin === 'crt' ? 'text-[#00ff00]/50 text-xs tracking-wide' : 'text-black text-sm'}>Enter the URL of your Sendspin server to stream synchronized audio.</p>
            <input
              type="url"
              value={sendspinUrl}
              onChange={e => setSendspinUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && sendspinUrl) startSendspin(); }}
              placeholder="http://homeassistant.local:8927"
              className={skin.dialogInput}
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSendspinDialog(false)}
                className={skin.dialogButtonSecondary}
              >
                Cancel
              </button>
              <button
                onClick={() => startSendspin()}
                disabled={!sendspinUrl}
                className={skin.dialogButtonPrimary}
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
