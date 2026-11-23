import { useEffect, useRef, useState } from 'react';
import { MonitorUp, X, Minimize } from 'lucide-react';
import { skins } from '../skins';
import { captureMicrophone, captureSystemAudio } from '../audio/sources/capture';
import { startTestAudio, testAudioParams, type TestAudio } from '../audio/sources/testFile';
import { reportUsage, type AudioSource } from './analytics';
import Header from './Header';
import SendspinBar from './SendspinBar';
import SendspinDialog from './SendspinDialog';
import SettingsPanel from './SettingsPanel';
import VisualizerPicker from './VisualizerPicker';
import VisualizerStage from './VisualizerStage';
import { useAppState } from './useAppState';
import { useAudioEngine } from './useAudioEngine';
import { useSendspin, useTrackChange } from './useSendspin';
import { useShuffle } from './useShuffle';

const errorMessage = (err: unknown, fallback: string): string => (err instanceof Error && err.message) || fallback;

export default function App() {
  const appVersion = __APP_VERSION__;
  const {
    activeVisualizer, setActiveVisualizer, shuffleEnabled, setShuffleEnabled, shuffleInterval, setShuffleInterval,
    shufflePool, setShufflePool, transitionMode, setTransitionMode, settings, setSettings, activeSkin,
    autoGain, setAutoGain, aiBeat, setAiBeat, musicStyle, setMusicStyle,
  } = useAppState();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [testAudio, setTestAudio] = useState<TestAudio | null>(null);
  const running = stream !== null || testAudio !== null;
  // Where the running audio comes from, for reportUsage (set just before the stream is)
  const sourceRef = useRef<AudioSource>('microphone');
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const skin = skins[activeSkin];
  const [showSendspinDialog, setShowSendspinDialog] = useState(false);
  const [sendspinUrl, setSendspinUrl] = useState('');
  const sendspin = useSendspin({
    onStream: s => {
      if (s) sourceRef.current = 'sendspin';
      setStream(s);
    },
    onError: setError,
    onActivated: () => setShowSendspinDialog(false),
  });

  const audio = useAudioEngine(stream ?? testAudio?.stream ?? null, { autoGain, neural: aiBeat, style: musicStyle });

  // Let the beat tracking start over on the new song instead of detecting the change from the audio
  useTrackChange(sendspin.state, () => audio?.engine.notifySongChange());

  useShuffle({ enabled: shuffleEnabled, intervalS: shuffleInterval, pool: shufflePool, running, setActiveVisualizer });

  // One report each time the audio starts; not again when a running source swaps its stream.
  useEffect(() => {
    if (running) reportUsage({ visualizer: activeVisualizer, source: sourceRef.current, trigger: 'start', shuffle: shuffleEnabled });
  }, [running]);

  useEffect(() => {
    const sendspinParam = new URLSearchParams(window.location.search).get('sendspin');
    if (sendspinParam) {
      setSendspinUrl(sendspinParam);
      setShowSendspinDialog(true);
    }
    // development / evaluation only: ?testAudio=<url>[&testAudioStart=<s>]
    const test = testAudioParams();
    if (test) {
      startTestAudio(test.url, test.start)
        .then(t => {
          sourceRef.current = 'test';
          (window as unknown as { __voltvizTestAudio?: HTMLMediaElement }).__voltvizTestAudio = t.element;
          setTestAudio(t);
        })
        .catch(err => setError(errorMessage(err, 'Failed to start the test audio')));
    }
  }, []);

  useEffect(() => {
    // Allow layout to settle, then notify listeners of the size change
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [showControls]);

  const startMicrophone = async () => {
    sendspin.disconnect();
    try {
      const micStream = await captureMicrophone();
      sourceRef.current = 'microphone';
      setStream(micStream);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to access microphone'));
    }
  };

  const startSystemAudio = async () => {
    sendspin.disconnect();
    try {
      let displayStream: MediaStream | null = null;
      displayStream = await captureSystemAudio(() => stopStream(displayStream));
      sourceRef.current = 'system';
      setStream(displayStream);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to access system audio'));
    }
  };

  const stopStream = (currentStream: MediaStream | null = stream) => {
    sendspin.disconnect();
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
                <MonitorUp size={40} className={skin.heroIconColor} />
              </div>
              <h2 className={skin.heroTitle}>Visualize Your Sound</h2>
              <p className={skin.heroText}>
                Select an audio source above to begin. For system audio, choose "Share Tab" or "Share Screen" and ensure <strong className={skin.heroStrong}>Share audio</strong> is checked.
              </p>
            </div>
          ) : (
            <div className="w-full h-full absolute inset-0">
              {audio && (
                <VisualizerStage
                  host={audio.host}
                  visualizer={activeVisualizer}
                  settings={settings}
                  metadata={sendspin.state.metadata}
                  transition={transitionMode}
                  showControls={showControls}
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
            musicStyle={musicStyle}
            setMusicStyle={setMusicStyle}
            engine={audio?.engine ?? null}
            bottomInset={sendspin.state.active}
          />

          <div className={skin.versionLabel}>
            v{appVersion}
          </div>
        </main>
      </div>

      {sendspin.state.active && showControls && (
        <SendspinBar
          skin={skin}
          sendspin={sendspin.state}
          sendspinCommand={sendspin.command}
          sendspinSeek={sendspin.seek}
          getProgress={sendspin.getProgress}
          updateSendspin={sendspin.update}
          ma={sendspin.ma}
        />
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
            if (running && id !== activeVisualizer) {
              reportUsage({ visualizer: id, source: sourceRef.current, trigger: 'select', shuffle: shuffleEnabled });
            }
          }}
        />
      )}

      {showSendspinDialog && (
        <SendspinDialog
          skin={skin}
          setShowSendspinDialog={setShowSendspinDialog}
          sendspinUrl={sendspinUrl}
          setSendspinUrl={setSendspinUrl}
          sendspinConnecting={sendspin.connecting}
          startSendspin={() => sendspin.connect(sendspinUrl)}
        />
      )}
    </div>
  );
}
