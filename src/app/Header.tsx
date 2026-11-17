import { Mic, MonitorUp, Square, Settings2, Maximize, ChevronDown, LayoutGrid, Radio } from 'lucide-react';
import githubIcon from '../images/GitHub_Invertocat_White.svg';
import type { SkinDefinition } from '../skins';
import { visualizerNames, type VisualizerType } from '../visualizers/registry';

interface HeaderProps {
  skin: SkinDefinition;
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

// Below lg the header buttons collapse to icons (aria-label keeps their accessible name).
const LABEL = 'hidden lg:inline';
const ICON_ONLY = 'justify-center max-lg:px-2.5 pointer-coarse:min-h-10 pointer-coarse:min-w-10';
const GITHUB_LINK = 'shrink-0 inline-flex items-center justify-center pointer-coarse:min-h-10 pointer-coarse:min-w-10';

export default function Header({ skin, stream, activeVisualizer, showSettings, setShowPicker, setShowSettings,
  setShowControls, setShowSendspinDialog, startMicrophone, startSystemAudio, stopStream }: HeaderProps) {
  return (
    <header className={skin.header}>
      <div className="flex flex-col min-w-0 max-sm:basis-0 max-sm:grow sm:shrink-0">
        <h1 className={skin.title}>VoltViz<span className={`hidden xl:inline ${skin.titleAccent}`}> Music Visualizer</span></h1>
        <p className={`hidden lg:block ${skin.subtitle}`}>inspired by winamp - created by <a href="https://github.com/sanderdw/voltviz" target="_blank" rel="noopener noreferrer" className={skin.link}>sanderdw</a></p>
      </div>

      {stream && (
        <button
          onClick={() => setShowPicker(true)}
          className={`${skin.pickerButton} order-last basis-full min-w-0 sm:order-none sm:basis-auto sm:ml-4`}
          data-testid="visualizer-picker-open"
          aria-haspopup="dialog"
        >
          <LayoutGrid size={16} className="shrink-0" />
          <span className="truncate min-w-0 max-sm:flex-1 text-left">{visualizerNames[activeVisualizer]}</span>
          <ChevronDown size={14} className="shrink-0" />
        </button>
      )}

      <div className="ml-auto flex gap-2 md:gap-4 items-center shrink-0">
        <a
          href="https://github.com/sanderdw/voltviz"
          target="_blank"
          rel="noopener noreferrer"
          className={`${GITHUB_LINK} ${skin.githubLink}`}
          title="GitHub"
          aria-label="Open GitHub profile"
        >
          <img src={githubIcon} alt="GitHub" width={20} height={20} className={skin.githubIcon} />
        </a>
        {!stream ? (
          <>
            <button
              onClick={startMicrophone}
              className={`${skin.buttonSecondary} ${ICON_ONLY}`}
              aria-label="Microphone"
              title="Microphone"
            >
              <Mic size={16} />
              <span className={LABEL}>Microphone</span>
            </button>
            <button
              onClick={startSystemAudio}
              className={`${skin.buttonPrimary} ${ICON_ONLY}`}
              aria-label="System Audio"
              title="System Audio"
            >
              <MonitorUp size={16} />
              <span className={LABEL}>System Audio</span>
            </button>
            <button
              onClick={() => setShowSendspinDialog(true)}
              className={`${skin.buttonSecondary} ${ICON_ONLY}`}
              aria-label="Sendspin"
              title="Sendspin"
            >
              <Radio size={16} />
              <span className={LABEL}>Sendspin</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowControls(false)}
              className={`${skin.buttonGhost} ${ICON_ONLY}`}
              aria-label="Hide UI"
              title="Hide UI"
            >
              <Maximize size={16} />
              <span className={LABEL}>Hide UI</span>
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`${skin.buttonGhost} ${ICON_ONLY}`}
              aria-label="Settings"
              title="Settings"
            >
              <Settings2 size={16} />
              <span className={LABEL}>Settings</span>
            </button>
            <button
              onClick={() => stopStream()}
              className={`${skin.buttonDanger} ${ICON_ONLY}`}
              aria-label="Stop"
              title="Stop"
            >
              <Square size={16} />
              <span className={LABEL}>Stop</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
