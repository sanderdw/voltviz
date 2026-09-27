import { useEffect, useRef, useState } from 'react';
import { MonitorUp, X, Minimize } from 'lucide-react';
import type { ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import { skins } from '../skins';
import { visualizerIds } from '../visualizers/registry';
import VisualizerPicker from '../components/VisualizerPicker';
import { captureMicrophone, captureSystemAudio } from '../audio/sources/capture';
import { SendspinController, initialSendspinState, type SendspinState } from '../audio/sources/sendspin';
import { startTestAudio, testAudioParams, type TestAudio } from '../audio/sources/testFile';
import Header from './Header';
import SendspinBar from './SendspinBar';
import SendspinDialog from './SendspinDialog';
import SettingsPanel from './SettingsPanel';
import VisualizerStage from './VisualizerStage';
import { removeUrlParam, useAppState } from './useAppState';
import { useAudioEngine } from './useAudioEngine';

export default function App() {
  const appVersion = __APP_VERSION__;
  const {
    activeVisualizer, setActiveVisualizer, shuffleEnabled, setShuffleEnabled, shuffleInterval, setShuffleInterval,
    shufflePool, setShufflePool, transitionMode, setTransitionMode, settings, setSettings, activeSkin,
    autoGain, setAutoGain, aiBeat, setAiBeat,
  } = useAppState();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [testAudio, setTestAudio] = useState<TestAudio | null>(null);
  const running = stream !== null || testAudio !== null;
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const skin = skins[activeSkin];
  const [showSendspinDialog, setShowSendspinDialog] = useState(false);
  const [sendspinUrl, setSendspinUrl] = useState('');
  const [sendspinConnecting, setSendspinConnecting] = useState(false);
  const [sendspin, setSendspin] = useState<SendspinState>(initialSendspinState);
  const updateSendspin = (patch: Partial<SendspinState>) => setSendspin(prev => ({ ...prev, ...patch }));
  const sendspinRef = useRef<SendspinController | null>(null);

  const audio = useAudioEngine(stream ?? testAudio?.stream ?? null, { autoGain, neural: aiBeat });

  useEffect(() => {
    (window as any)._paq?.push(['trackEvent', 'Visualizer', 'Initial', activeVisualizer]);

    const params = new URLSearchParams(window.location.search);
    const sendspinParam = params.get('sendspin');
    if (sendspinParam) {
      setSendspinUrl(sendspinParam);
      setShowSendspinDialog(true);
    }
    // development / evaluation only: ?testAudio=<url>[&testAudioStart=<s>]
    const test = testAudioParams();
    if (test) {
      startTestAudio(test.url, test.start)
        .then(t => {
          (window as unknown as { __voltvizTestAudio?: HTMLMediaElement }).__voltvizTestAudio = t.element;
          setTestAudio(t);
        })
        .catch(err => setError(err.message));
    }
  }, []);

  useEffect(() => {
    if (!shuffleEnabled || !running) return;
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
  }, [shuffleEnabled, shuffleInterval, running, shufflePool]);

  useEffect(() => {
    // Allow layout to settle, then notify listeners of the size change
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [showControls]);

  const cleanupSendspin = () => {
    setSendspinConnecting(false);
    if (sendspinRef.current) {
      sendspinRef.current.cleanup();
      sendspinRef.current = null;
    }
    setSendspin(initialSendspinState);
    removeUrlParam('sendspin');
  };

  const startMicrophone = async () => {
    cleanupSendspin();
    try {
      const audioStream = await captureMicrophone();
      setStream(audioStream);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to access microphone');
    }
  };

  const startSystemAudio = async () => {
    cleanupSendspin();
    try {
      let displayStream: MediaStream | null = null;
      displayStream = await captureSystemAudio(() => stopStream(displayStream));
      setStream(displayStream);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to access system audio');
    }
  };

  const startSendspin = async (url?: string) => {
    const serverUrl = url || sendspinUrl;
    const controller = new SendspinController({
      onStream: s => setStream(s),
      onState: updateSendspin,
      onError: setError,
      onConnecting: setSendspinConnecting,
      onActivated: () => setShowSendspinDialog(false),
      onClosed: () => {
        if (sendspinRef.current === controller) sendspinRef.current = null;
        removeUrlParam('sendspin');
      },
    });
    sendspinRef.current = controller;
    await controller.connect(serverUrl);
  };

  const sendspinCommand = <T extends ControllerCommand>(command: T, params?: ControllerCommands[T]) => {
    sendspinRef.current?.command(command, params);
  };

  const stopStream = (currentStream: MediaStream | null = stream) => {
    cleanupSendspin();
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (testAudio) {
      testAudio.stop();
      setTestAudio(null);
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
      {!running && skin.atmosphericBg && (
        <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '4s' }}></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600 rounded-full mix-blend-screen filter blur-[128px] animate-pulse" style={{ animationDuration: '7s' }}></div>
        </div>
      )}

      <div className="relative z-10 flex-1 flex flex-col">
        {showControls && (
          <Header
            skin={skin}
            activeSkin={activeSkin}
            stream={running}
            activeVisualizer={activeVisualizer}
            showSettings={showSettings}
            setShowPicker={setShowPicker}
            setShowSettings={setShowSettings}
            setShowControls={setShowControls}
            setShowSendspinDialog={setShowSendspinDialog}
            startMicrophone={startMicrophone}
            startSystemAudio={startSystemAudio}
            stopStream={() => stopStream()}
          />
        )}

        <main className={skin.body}>
          {!running ? (
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
              {audio && (
                <VisualizerStage
                  host={audio.host}
                  visualizer={activeVisualizer}
                  settings={settings}
                  sendspinMetadata={sendspin.metadata}
                  transition={transitionMode}
                />
              )}
            </div>
          )}

          {!showControls && running && (
            <button
              onClick={() => setShowControls(true)}
              className="absolute top-3 right-3 md:top-6 md:right-6 p-3 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 text-white/50 hover:text-white transition-all cursor-pointer z-50 group"
              title="Show UI"
            >
              <Minimize size={20} className="group-hover:scale-90 transition-transform" />
            </button>
          )}

          {/* Settings Panel */}
          <SettingsPanel
            skin={skin}
            activeSkin={activeSkin}
            showSettings={showSettings}
            showControls={showControls}
            setShowSettings={setShowSettings}
            settings={settings}
            setSettings={setSettings}
            shuffleEnabled={shuffleEnabled}
            setShuffleEnabled={setShuffleEnabled}
            shuffleInterval={shuffleInterval}
            setShuffleInterval={setShuffleInterval}
            shufflePool={shufflePool}
            transitionMode={transitionMode}
            setTransitionMode={setTransitionMode}
            autoGain={autoGain}
            setAutoGain={setAutoGain}
            aiBeat={aiBeat}
            setAiBeat={setAiBeat}
            bottomInset={sendspin.active}
          />

          <div className={skin.versionLabel}>
            v{appVersion}
          </div>
        </main>
      </div>

      {sendspin.active && showControls && (
        <SendspinBar skin={skin} sendspin={sendspin} sendspinCommand={sendspinCommand} updateSendspin={updateSendspin} />
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
        <SendspinDialog
          skin={skin}
          activeSkin={activeSkin}
          setShowSendspinDialog={setShowSendspinDialog}
          sendspinUrl={sendspinUrl}
          setSendspinUrl={setSendspinUrl}
          sendspinConnecting={sendspinConnecting}
          startSendspin={() => startSendspin()}
        />
      )}
    </div>
  );
}
