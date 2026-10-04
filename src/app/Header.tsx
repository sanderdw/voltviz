import { Mic, MonitorUp, Square, Settings2, Maximize, ChevronDown, LayoutGrid, Radio, Cast } from 'lucide-react';
import githubIcon from '../images/GitHub_Invertocat_White.svg';
import type { CastControl } from '../cast/useCast';
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
  cast: CastControl;
}

// Below lg the header buttons collapse to icons (aria-label keeps their accessible name).
const LABEL = 'hidden lg:inline';
const ICON_ONLY = 'justify-center max-lg:px-2.5 pointer-coarse:min-h-10 pointer-coarse:min-w-10';
const GITHUB_LINK = 'shrink-0 inline-flex items-center justify-center pointer-coarse:min-h-10 pointer-coarse:min-w-10';

export default function Header({ skin, activeSkin, stream, activeVisualizer, showSettings, setShowPicker, setShowSettings,
  setShowControls, setShowSendspinDialog, startMicrophone, startSystemAudio, stopStream, cast }: HeaderProps) {
  const casting = cast.status !== 'idle';
  const castLabel = cast.status === 'connected' ? 'Casting' : cast.status === 'connecting' ? 'Connecting…'
    : cast.status === 'failed' ? 'Cast failed' : 'Cast';
  const castTitle = casting ? `${castLabel}${cast.deviceName ? ` to ${cast.deviceName}` : ''} (click to stop)` : 'Cast to TV';
  return (
    <header className={skin.header}>
      <div className="flex flex-col min-w-0 max-sm:basis-0 max-sm:grow sm:shrink-0">
        <h1 className={skin.title}>VoltViz<span className={`hidden xl:inline ${activeSkin === 'modern' ? 'font-bold text-green-400' : activeSkin === 'winamp' ? 'font-bold text-[#00ff00]' : activeSkin === 'crt' ? 'font-bold text-[#00ff00]' : 'font-bold text-[#008000]'}`}> Music Visualizer</span></h1>
        <p className={`hidden lg:block ${skin.subtitle}`}>inspired by winamp - created by <a href="https://github.com/sanderdw/voltviz" target="_blank" rel="noopener noreferrer" className={activeSkin === 'win95' ? 'text-[#000080] underline' : activeSkin === 'winamp' ? 'text-[#00ff00]/80 hover:text-[#00ff00]' : activeSkin === 'crt' ? 'text-[#00ff00]/70 hover:text-[#00ff00]' : 'text-white/80 hover:text-white transition-colors'}>sanderdw</a></p>
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
          className={`${GITHUB_LINK} ${activeSkin === 'win95' ? 'p-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080]' : activeSkin === 'winamp' ? 'p-1 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a]' : activeSkin === 'crt' ? 'p-1.5 border border-[#00ff00]/30 hover:border-[#00ff00]/60 hover:shadow-[0_0_8px_rgba(0,255,0,0.2)]' : 'p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 text-white/70 hover:text-white'}`}
          title="GitHub"
          aria-label="Open GitHub profile"
        >
          <img src={githubIcon} alt="GitHub" width={20} height={20} className={activeSkin === 'win95' ? 'invert' : ''} />
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
            {cast.available && (
              <button
                onClick={cast.toggle}
                className={`${casting ? skin.buttonPrimary : skin.buttonGhost} ${ICON_ONLY}`}
                aria-label={castTitle}
                aria-pressed={casting}
                title={castTitle}
                data-testid="cast-button"
              >
                <Cast size={16} />
                <span className={LABEL}>{castLabel}</span>
              </button>
            )}
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
