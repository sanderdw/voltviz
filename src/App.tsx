import React, { useState, useEffect } from 'react';
import { Mic, MonitorUp, Square, Settings2, X, Maximize, Minimize, ChevronDown } from 'lucide-react';
import githubIcon from './images/GitHub_Invertocat_White.svg';
import Circular from './components/visualizers/Circular';
import CyberMatrix from './components/visualizers/CyberMatrix';
import CyberGridCanvas from './components/visualizers/CyberGridCanvas';
import SheetMusic from './components/visualizers/SheetMusic';
import Bars from './components/visualizers/Bars';
import Tunnel from './components/visualizers/Tunnel';
import MusicGrid from './components/visualizers/MusicGrid';
import NeonWave from './components/visualizers/NeonWave';
import PolySphere from './components/visualizers/PolySphere';
import PsychedelicSkull from './components/visualizers/PsychedelicSkull';
import GhostRainbow from './components/visualizers/GhostRainbow';
import NeonHexTunnel from './components/visualizers/NeonHexTunnel';
import FluidSmoke from './components/visualizers/FluidSmoke';
import WebGLParticles from './components/visualizers/WebGLParticles';
import ThreeDEqualizer from './components/visualizers/ThreeDEqualizer';
import WebGLMusicGrid from './components/visualizers/WebGLMusicGrid';
import FestivalStage from './components/visualizers/FestivalStage';
import MegaFestivalStage from './components/visualizers/MegaFestivalStage';
import DisneyDroneShow from './components/visualizers/DisneyDroneShow';
import FireworksShow from './components/visualizers/FireworksShow';
import PerlinSphere from './components/visualizers/PerlinSphere';
import CRTTerminal from './components/visualizers/CRTTerminal';
import DataDashboard from './components/visualizers/DataDashboard';
import YourLogo from './components/visualizers/YourLogo';
import Vinyl from './components/visualizers/Vinyl';
import Background from './components/visualizers/Background';
import BlurVisualizer from './components/visualizers/BlurVisualizer';
import GlitchVisualizer from './components/visualizers/GlitchVisualizer';
import GlitchVisualizer2 from './components/visualizers/GlitchVisualizer2';
import { VisualizerSettings } from './types';

type VisualizerType = 'circular' | 'blur' | 'glitch' | 'glitch2' | 'Vinyl' | 'Background' | 'yourlogo' | 'cybermatrix' | 'cybergridcanvas' | 'sheet' | 'bars' | 'tunnel' | 'grid' | 'neon' | 'sphere' | 'skull' | 'ghost' | 'hextunnel' | 'fluidsmoke' | 'webgl' | 'webglgrid' | 'webglmusicgrid' | 'festival' | 'megafestival' | 'droneshow' | 'fireworks' | 'cyberpunk' | 'cyberpunkstreet' | 'globe' | 'perlin' | 'crtterminal' | 'datadashboard';

export default function App() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVisualizer, setActiveVisualizer] = useState<VisualizerType>('grid');
  const [showSettings, setShowSettings] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [settings, setSettings] = useState<VisualizerSettings>({
    sensitivity: 1.0,
    speed: 1.0,
    hueShift: 0,
    scale: 1.0,
  });

  useEffect(() => {
    // Allow layout to settle, then notify visualizers of the size change
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [showControls]);

  const startMicrophone = async () => {
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

  const stopStream = (currentStream: MediaStream | null = stream) => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const renderVisualizer = () => {
    if (!stream) return null;
    switch (activeVisualizer) {
      case 'circular': return <Circular stream={stream} settings={settings} />;
      case 'cybermatrix': return <CyberMatrix stream={stream} settings={settings} />;
      case 'cybergridcanvas': return <CyberGridCanvas stream={stream} settings={settings} />;
      case 'sheet': return <SheetMusic stream={stream} settings={settings} />;
      case 'bars': return <Bars stream={stream} settings={settings} />;
      case 'tunnel': return <Tunnel stream={stream} settings={settings} />;
      case 'grid': return <MusicGrid stream={stream} settings={settings} />;
      case 'neon': return <NeonWave stream={stream} settings={settings} />;
      case 'sphere': return <PolySphere stream={stream} settings={settings} />;
      case 'skull': return <PsychedelicSkull stream={stream} settings={settings} />;
      case 'ghost': return <GhostRainbow stream={stream} settings={settings} />;
      case 'hextunnel': return <NeonHexTunnel stream={stream} settings={settings} />;
      case 'fluidsmoke': return <FluidSmoke stream={stream} settings={settings} />;
      case 'webgl': return <WebGLParticles stream={stream} settings={settings} />;
      case '3dequalizer': return <ThreeDEqualizer stream={stream} settings={settings} />;
      case 'webglmusicgrid': return <WebGLMusicGrid stream={stream} settings={settings} />;
      case 'festival': return <FestivalStage stream={stream} settings={settings} />;
      case 'megafestival': return <MegaFestivalStage stream={stream} settings={settings} />;
      case 'droneshow': return <DisneyDroneShow stream={stream} settings={settings} />;
      case 'fireworks': return <FireworksShow stream={stream} settings={settings} />;
      case 'perlin': return <PerlinSphere stream={stream} settings={settings} />;
      case 'crtterminal': return <CRTTerminal stream={stream} settings={settings} />;
      case 'datadashboard': return <DataDashboard stream={stream} settings={settings} />;
      case 'yourlogo': return <YourLogo stream={stream} settings={settings} />;
      case 'vinyl': return <Vinyl stream={stream} settings={settings} />;
      case 'background': return <Background stream={stream} settings={settings} />;
      case 'blur': return <BlurVisualizer stream={stream} settings={settings} />;
      case 'glitch': return <GlitchVisualizer stream={stream} settings={settings} />;
      case 'glitch2': return <GlitchVisualizer2 stream={stream} settings={settings} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans relative overflow-hidden">
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
                    onChange={(e) => setActiveVisualizer(e.target.value as VisualizerType)}
                    className="appearance-none bg-white/10 hover:bg-white/20 border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer transition-colors"
                  >
                    <option value="grid" className="bg-gray-900">Dutch Grid</option>
                    <option value="webglmusicgrid" className="bg-gray-900">Dutch Grid (WebGL)</option>
                    <option value="glitch" className="bg-gray-900">Glitch</option>
                    <option value="glitch2" className="bg-gray-900">Glitch Databend</option>
                    <option value="yourlogo" className="bg-gray-900">Your Logo</option>
                    <option value="perlin" className="bg-gray-900">Glow Sphere</option>
                    <option value="crtterminal" className="bg-gray-900">CRT Terminal</option>
                    <option value="webgl" className="bg-gray-900">Cosmic Particles</option>
                    <option value="neon" className="bg-gray-900">Neon Wave</option>
                    <option value="sheet" className="bg-gray-900">Sheet Music</option>
                    <option value="tunnel" className="bg-gray-900">Tunnel</option>
                    <option value="circular" className="bg-gray-900">Circular</option>
                    <option value="cybermatrix" className="bg-gray-900">Cyber Matrix</option>
                    <option value="cybergridcanvas" className="bg-gray-900">Cyber Grid Canvas</option>
                    <option value="bars" className="bg-gray-900">Bars</option>
                    <option value="sphere" className="bg-gray-900">Poly Sphere</option>
                    <option value="skull" className="bg-gray-900">Psychedelic Skull</option>
                    <option value="ghost" className="bg-gray-900">Ghost Rainbow</option>
                    <option value="hextunnel" className="bg-gray-900">Neon Hex Tunnel</option>
                    <option value="fluidsmoke" className="bg-gray-900">Fluid Smoke</option>
                    <option value="3dequalizer" className="bg-gray-900">3D Equalizer</option>
                    <option value="festival" className="bg-gray-900">Festival Stage</option>
                    <option value="megafestival" className="bg-gray-900">Defqon Mainstage</option>
                    <option value="droneshow" className="bg-gray-900">Disney Drone Show</option>
                    <option value="fireworks" className="bg-gray-900">Fireworks Show</option>
                    <option value="datadashboard" className="bg-gray-900">Data Dashboard</option>
                    <option value="vinyl" className="bg-gray-900">Vinyl</option>
                    <option value="background" className="bg-gray-900">Background</option>
                    <option value="blur" className="bg-gray-900">Blur</option>

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
        </main>
      </div>
    </div>
  );
}
