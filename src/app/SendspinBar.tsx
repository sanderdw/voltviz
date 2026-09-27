import { Square, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX } from 'lucide-react';
import type { ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import type { SkinDefinition } from '../skins';
import type { SendspinState } from '../audio/sources/sendspin';

interface SendspinBarProps {
  skin: SkinDefinition;
  sendspin: SendspinState;
  sendspinCommand: <T extends ControllerCommand>(command: T, params?: ControllerCommands[T]) => void;
  updateSendspin: (patch: Partial<SendspinState>) => void;
}

export default function SendspinBar({ skin, sendspin, sendspinCommand, updateSendspin }: SendspinBarProps) {
  const repeat = sendspin.metadata?.repeat ?? 'off';
  const nextRepeat: ControllerCommand = repeat === 'off' ? 'repeat_all' : repeat === 'all' ? 'repeat_one' : 'repeat_off';
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className={skin.sendspinBar} data-testid="sendspin-controls">
        {/* Track info */}
        {sendspin.metadata?.title && (
          <div className="flex items-center gap-3 mr-2 min-w-0 max-sm:basis-full max-sm:justify-center max-sm:mr-0">
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
            onClick={() => sendspinCommand(nextRepeat)}
            disabled={!sendspin.supportedCmds.includes(nextRepeat)}
            className={`${skin.sendspinButton} ${sendspin.metadata?.repeat && sendspin.metadata.repeat !== 'off' ? skin.sendspinButtonActive : ''}`}
            title={`Repeat: ${sendspin.metadata?.repeat ?? 'off'}`}
            data-testid="sendspin-repeat"
          >
            {sendspin.metadata?.repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
