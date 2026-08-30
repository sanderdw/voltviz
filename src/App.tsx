import { useEffect, useRef, useState } from 'react';
import { Mic, MonitorUp, Square, Settings2, X, Maximize, Minimize, ChevronDown, LayoutGrid, Radio, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX } from 'lucide-react';
import { SendspinPlayer } from '@sendspin/sendspin-js';
import type { ServerStateMetadata, ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import githubIcon from './images/GitHub_Invertocat_White.svg';
import { VisualizerSettings } from './types';
import { skins, SkinType } from './skins';
import { visualizers, visualizerIds, visualizerNames, isVisualizerType } from './visualizers';
import type { VisualizerType } from './visualizers';
import VisualizerPicker from './components/VisualizerPicker';
import VisualizerStage, { TRANSITION_MODES } from './components/VisualizerStage';
import type { TransitionMode } from './components/VisualizerStage';

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

const SHUFFLE_PRESETS: { value: number; label: string }[] = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
];
const SHUFFLE_DEFAULT = 60;

export default function App() {
  const appVersion = __APP_VERSION__;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVisualizer, setActiveVisualizer] = useState<VisualizerType>(() => {
    const viz = new URLSearchParams(window.location.search).get('viz');
    return isVisualizerType(viz) ? viz : 'polysphere';
  });
  const [showPicker, setShowPicker] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(() =>
    new URLSearchParams(window.location.search).get('shuffle') === '1');
  const [shuffleInterval, setShuffleInterval] = useState<number>(() => {
    const v = parseInt(new URLSearchParams(window.location.search).get('shuffleTime') ?? '', 10);
    return SHUFFLE_PRESETS.some(p => p.value === v) ? v : SHUFFLE_DEFAULT;
  });
  const [shufflePool, setShufflePool] = useState<VisualizerType[]>(() => [...new Set(
    (new URLSearchParams(window.location.search).get('shufflePool') ?? '')
      .split(',').filter(isVisualizerType)
  )]);
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(() => {
    const t = new URLSearchParams(window.location.search).get('transition');
    return t && (TRANSITION_MODES as readonly string[]).includes(t) ? (t as TransitionMode) : 'crossfade';
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
  const sendspinActivatedRef = useRef(false);
  const sendspinActivationTimeoutRef = useRef<number | null>(null);
  const [sendspinConnecting, setSendspinConnecting] = useState(false);
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
    if (shuffleEnabled) params.set('shuffle', '1');
    else params.delete('shuffle');
    if (shuffleEnabled && shuffleInterval !== SHUFFLE_DEFAULT) params.set('shuffleTime', String(shuffleInterval));
    else params.delete('shuffleTime');
    if (shufflePool.length > 0) params.set('shufflePool', shufflePool.join(','));
    else params.delete('shufflePool');
    if (transitionMode !== 'crossfade') params.set('transition', transitionMode);
    else params.delete('transition');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeVisualizer, settings, activeSkin, shuffleEnabled, shuffleInterval, shufflePool, transitionMode]);

  useEffect(() => {
    if (!shuffleEnabled || !stream) return;
    const id = window.setInterval(() => {
      setActiveVisualizer(current => {
        const pool = shufflePool.length ? shufflePool : visualizerIds;
        const others = pool.filter(v => v !== current);
        if (!others.length) return current;
        const next = others[Math.floor(Math.random() * others.length)];
        (window as any)._paq?.push(['trackEvent', 'Visualizer', 'Shuffle', next]);
        return next;
      });
    }, shuffleInterval * 1000);
    return () => window.clearInterval(id);
  }, [shuffleEnabled, shuffleInterval, stream, shufflePool]);

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
    if (sendspinActivationTimeoutRef.current !== null) {
      window.clearTimeout(sendspinActivationTimeoutRef.current);
      sendspinActivationTimeoutRef.current = null;
    }
    sendspinActivatedRef.current = false;
    setSendspinConnecting(false);
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

  const saveMAPlayerConfig = (wsUrl: string, playerId: string) => new Promise<boolean>(resolve => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), 5000);
    const msgId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    let commandSent = false;

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!commandSent && msg.server_version) {
        commandSent = true;
        ws.send(JSON.stringify({
          message_id: msgId,
          command: 'config/players/save',
          args: { player_id: playerId, values: { hide_in_ui: false, expose_player_to_ha: true } }
        }));
      } else if (msg.message_id === msgId) {
        done(!('error_code' in msg));
      }
    };
    ws.onerror = () => done(false);
    ws.onclose = () => done(false);
  });

  // Music Assistant registers Sendspin web players hidden and not exposed to
  // Home Assistant; flip both so the player is usable as soon as it appears.
  // Only possible inside the HA add-on, where run.sh publishes MA's ingress
  // entry as ma-config.json. MA may not have finished registering the player
  // when the first server state arrives, hence the retries.
  const configurePlayerInMA = async (playerId: string) => {
    let ingressPath: string;
    try {
      const configResp = await fetch(new URL('ma-config.json', window.location.href).href);
      if (!configResp.ok) return;
      const { ingress_entry } = await configResp.json();
      if (!ingress_entry) return;
      ingressPath = ingress_entry.endsWith('/') ? ingress_entry : ingress_entry + '/';
    } catch { /* not running in HA add-on context */
      return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}${ingressPath}ws`;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      if (await saveMAPlayerConfig(wsUrl, playerId)) return;
    }
  };

  const startSendspin = async (url?: string) => {
    const serverUrl = url || sendspinUrl;
    try {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      sendspinAudioRef.current = audioEl;

      audioEl.addEventListener('playing', () => {
        // Don't start the visualizer before the server has activated the
        // player: the element plays the SDK's (still silent) MediaStream as
        // soon as connect() resolves, even when the handshake later fails.
        if (sendspinActivatedRef.current && audioEl.srcObject instanceof MediaStream) {
          setStream(audioEl.srcObject);
        }
      });

      const player = new SendspinPlayer({
        baseUrl: serverUrl,
        audioElement: audioEl,
        clientName: 'VoltViz',
        // Music Assistant only treats a client as a standalone web player when
        // product_name is one of its known web/app values ("Web Browser",
        // "Web Player", "Mobile Application", "PWA"). Anything else is
        // classified as a PROTOCOL endpoint and wrapped in a hidden
        // auto-created "universal player", making VoltViz unusable in MA.
        productName: 'Web Player',
        correctionMode: 'quality-local',
        reconnect: {
          maxAttempts: 10,
          onReconnecting: (attempt) => setError(`Sendspin connection lost — reconnecting (attempt ${attempt}/10)…`),
          onReconnected: () => setError(null),
          onExhausted: () => {
            setError('Sendspin connection lost — could not reconnect');
            cleanupSendspin();
          },
        },
        onStateChange: (state) => {
          // A non-empty serverState is the first proof the player is actually
          // registered: the SDK initializes it to {} and only merges content
          // into it from server/state messages, which the server sends only
          // after activation. The socket opening alone proves nothing.
          if (state.serverState && Object.keys(state.serverState).length > 0 && !sendspinActivatedRef.current) {
            sendspinActivatedRef.current = true;
            if (sendspinActivationTimeoutRef.current !== null) {
              window.clearTimeout(sendspinActivationTimeoutRef.current);
              sendspinActivationTimeoutRef.current = null;
            }
            setSendspinConnecting(false);
            setError(null);
            updateSendspin({ active: true });
            setShowSendspinDialog(false);
            // The audio element usually started playing before activation, so
            // the 'playing' listener has already come and gone — pick up the
            // stream here.
            if (audioEl.srcObject instanceof MediaStream) {
              setStream(audioEl.srcObject);
            }
            configurePlayerInMA(player.clientId);
          }
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
      sendspinActivatedRef.current = false;
      setSendspinConnecting(true);
      await player.unlock();
      await player.connect();
      // Kick-start playback on mobile where autoplay may be blocked
      audioEl.play().catch(() => {});

      setError(null);
      // A handshake failure after the socket opens closes it again without any
      // callback, so give the server a bounded window to activate the player.
      sendspinActivationTimeoutRef.current = window.setTimeout(() => {
        sendspinActivationTimeoutRef.current = null;
        if (!sendspinActivatedRef.current) {
          setError('Connected, but the server never activated the player — check that Music Assistant is 2.10.0b14 or newer and its Sendspin pairing settings.');
          cleanupSendspin();
        }
      }, 10000);
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
                <button
                  onClick={() => setShowPicker(true)}
                  className={skin.pickerButton}
                  data-testid="visualizer-picker-open"
                  aria-haspopup="dialog"
                >
                  <LayoutGrid size={16} />
                  <span>{visualizerNames[activeVisualizer]}</span>
                  <ChevronDown size={14} />
                </button>
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
              <VisualizerStage
                stream={stream}
                visualizer={activeVisualizer}
                settings={settings}
                sendspinMetadata={sendspin.metadata}
                transition={transitionMode}
              />
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

      {showPicker && (
        <VisualizerPicker
          active={activeVisualizer}
          skin={skin}
          shufflePool={shufflePool}
          onTogglePool={(id) => setShufflePool(pool =>
            pool.includes(id) ? pool.filter(p => p !== id) : [...pool, id]
          )}
          onClose={() => setShowPicker(false)}
          onSelect={(id) => {
            setActiveVisualizer(id);
            (window as any)._paq?.push(['trackEvent', 'Visualizer', 'Select', id]);
          }}
        />
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
              onKeyDown={e => { if (e.key === 'Enter' && sendspinUrl && !sendspinConnecting) startSendspin(); }}
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
                disabled={!sendspinUrl || sendspinConnecting}
                className={skin.dialogButtonPrimary}
              >
                {sendspinConnecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
