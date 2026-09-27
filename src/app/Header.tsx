import { Mic, MonitorUp, Square, Settings2, Maximize, ChevronDown, LayoutGrid, Radio } from 'lucide-react';
import githubIcon from '../images/GitHub_Invertocat_White.svg';
import type { SkinDefinition, SkinType } from '../skins';
import { visualizerNames, type VisualizerType } from '../visualizers/registry';

interface HeaderProps {
  skin: SkinDefinition;
  activeSkin: SkinType;
  /** True while an audio source is running. */
  stream: boolean;
  activeVisualizer: VisualizerType;
  showSettings: boolean;
  setShowPicker: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowControls: (v: boolean) => void;
  setShowSendspinDialog: (v: boolean) => void;
  startMicrophone: () => void;
  startSystemAudio: () => void;
  stopStream: () => void;
}

export default function Header({ skin, activeSkin, stream, activeVisualizer, showSettings, setShowPicker, setShowSettings,
  setShowControls, setShowSendspinDialog, startMicrophone, startSystemAudio, stopStream }: HeaderProps) {
  return (
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
  );
}
