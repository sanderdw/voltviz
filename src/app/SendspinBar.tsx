import { useEffect, useState } from 'react';
import { Square, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Heart, ListMusic, ListPlus, Music, ChevronDown } from 'lucide-react';
import type { ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import type { SkinDefinition } from '../skins';
import { hasTrack, trackKey, type SendspinState, type TrackProgress } from '../audio/sources/sendspinState';
import { maApi, type MusicAssistantApi } from '../audio/sources/musicAssistant';
import { deriveBarStatus, seekMode, statusLabel } from './sendspinView';
import { useFavorite, useMaQueue } from './useMusicAssistant';
import { usePlaybackModes } from './usePlaybackModes';
import SendspinProgress from './SendspinProgress';
import SendspinQueuePanel from './SendspinQueuePanel';
import SendspinMediaPicker from './SendspinMediaPicker';

// Whether the bar is slid down stays with this browser. Storage can be unavailable (private
// mode, blocked site data): then the bar just starts shown.
const HIDDEN_KEY = 'voltviz:sendspinBarHidden';

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, '1');
    else window.localStorage.removeItem(HIDDEN_KEY);
  } catch { /* not remembered */ }
}

interface SendspinBarProps {
  skin: SkinDefinition;
  sendspin: SendspinState;
  sendspinCommand: <T extends ControllerCommand>(command: T, params?: ControllerCommands[T]) => boolean;
  sendspinSeek: (positionMs: number) => boolean;
  getProgress: () => TrackProgress | null;
  updateSendspin: (patch: Partial<SendspinState>) => void;
  /** Music Assistant's API, inside the Home Assistant add-on only. */
  ma: MusicAssistantApi | null;
}

type Panel = 'queue' | 'picker' | null;

export default function SendspinBar({ skin, sendspin, sendspinCommand, sendspinSeek, getProgress, updateSendspin, ma }: SendspinBarProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [hidden, setHidden] = useState(readHidden);
  const metadata = sendspin.metadata;
  const idle = !hasTrack(metadata);
  const { queue, ready: maReady } = useMaQueue(ma, sendspin.playerId, {
    refreshKey: `${trackKey(metadata) ?? ''}\u0000${sendspin.groupName ?? ''}`,
    poll: panel !== null,
  });
  const favorite = useFavorite(maReady ? ma : null, queue?.current_item?.media_item);
  const modes = usePlaybackModes({ sendspin, command: sendspinCommand, ma: maReady ? ma : null, queue });

  const status = deriveBarStatus({
    reconnectAttempt: sendspin.reconnectAttempt,
    metadata,
    groupPlayback: sendspin.groupPlayback,
    playing: sendspin.playing,
    queueState: queue?.state,
  });
  const label = statusLabel(status, sendspin.reconnectAttempt);
  const reconnecting = status === 'reconnecting';
  const can = (command: string) => !reconnecting && sendspin.supportedCmds.includes(command);
  // Play on an empty queue does nothing: offer something to play instead
  const emptyQueue = maReady && queue !== null && queue.items === 0;

  const mode = seekMode({ supportedCmds: sendspin.supportedCmds, durationMs: metadata?.progress?.track_duration ?? 0, maQueue: maReady && queue !== null });
  const onSeek = reconnecting ? null
    : mode === 'sendspin' ? sendspinSeek
      : mode === 'ma' && ma && queue ? (positionMs: number) => {
        maApi.seek(ma, queue.queue_id, positionMs / 1000).catch(err => console.warn('VoltViz: seek failed', err));
        return true;
      } : null;

  useEffect(() => {
    if (!maReady) setPanel(null);
  }, [maReady]);

  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel]);

  const toggleHidden = () => {
    const next = !hidden;
    if (next) setPanel(null);
    setHidden(next);
    storeHidden(next);
  };

  const statusChip = (
    <span className={label ? skin.sendspinStatus : 'sr-only'} aria-live="polite" data-testid="sendspin-status">{label}</span>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center pointer-events-none">
      {panel === 'queue' && ma && (
        <SendspinQueuePanel skin={skin} ma={ma} queue={queue} onAddMusic={() => setPanel('picker')} onClose={() => setPanel(null)} />
      )}
      {panel === 'picker' && ma && sendspin.playerId && (
        <SendspinMediaPicker skin={skin} ma={ma} queue={queue} playerId={sendspin.playerId} onClose={() => setPanel(null)} />
      )}

      {/* A drawer: hidden, it slides down until only its handle (h-7) is left on screen */}
      <div
        className={`flex flex-col items-center max-w-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${hidden ? 'translate-y-[calc(100%-1.75rem)]' : ''}`}
        data-testid="sendspin-drawer"
      >
        <button
          onClick={toggleHidden}
          // Above the bar, so the tab covers the bar's top border and looks attached
          className={`${skin.sendspinHandle} relative z-10 h-7`}
          title={hidden ? 'Show player' : 'Hide player'}
          aria-label={hidden ? 'Show player' : 'Hide player'}
          aria-expanded={!hidden}
          aria-controls="sendspin-controls"
          data-testid="sendspin-toggle"
        >
          <ChevronDown size={14} className={`flex-shrink-0 transition-transform duration-500 motion-reduce:transition-none ${hidden ? 'rotate-180' : ''}`} />
          {/* What is playing, while the bar is down */}
          <span
            className={`overflow-hidden transition-[max-width,opacity] duration-500 motion-reduce:transition-none ${hidden && !idle ? 'max-w-[60vw] sm:max-w-80 opacity-100' : 'max-w-0 opacity-0'}`}
            aria-hidden="true"
          >
            <span className="block pl-1.5 truncate">{metadata?.title || metadata?.artist}</span>
          </span>
        </button>

        <div
          id="sendspin-controls"
          className={`${skin.sendspinBar} transition-opacity duration-500 motion-reduce:transition-none ${hidden ? 'opacity-0' : ''}`}
          inert={hidden}
          data-testid="sendspin-controls"
        >
          <div className={skin.sendspinBarRow}>
            {idle ? (
              <div className="flex items-center gap-3 mr-2 min-w-0 max-sm:basis-full max-sm:justify-center max-sm:mr-0" data-testid="sendspin-idle">
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 opacity-50">
                  <Music size={20} />
                </div>
                <div className="min-w-0">
                  <div className={skin.sendspinTrackTitle}>Nothing playing</div>
                  <div className={skin.sendspinTrackArtist}>
                    {maReady ? 'Pick something to start' : `Start music in Music Assistant on “${sendspin.groupName ?? 'VoltViz'}”`}
                  </div>
                </div>
                {statusChip}
                {maReady && sendspin.playerId && (
                  <button
                    onClick={() => setPanel('picker')}
                    className={`${skin.sendspinPlayButton} flex items-center gap-1.5 px-3 text-xs whitespace-nowrap`}
                    title="Start something"
                    data-testid="sendspin-start"
                  >
                    <ListPlus size={16} /> Start
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 mr-2 min-w-0 max-sm:basis-full max-sm:justify-center max-sm:mr-0" data-testid="sendspin-track">
                {metadata?.artwork_url && (
                  <img src={metadata.artwork_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className={skin.sendspinTrackTitle}>{metadata?.title || metadata?.artist}</div>
                  {metadata?.title && metadata.artist && (
                    <div className={skin.sendspinTrackArtist}>{metadata.artist}</div>
                  )}
                  {metadata?.album && (
                    <div className={skin.sendspinTrackAlbum} data-testid="sendspin-album">{metadata.album}</div>
                  )}
                </div>
                {statusChip}
                {favorite.available && (
                  <button
                    onClick={favorite.toggle}
                    disabled={favorite.busy}
                    className={favorite.favorite ? skin.sendspinButtonOn : skin.sendspinButton}
                    title={favorite.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={favorite.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={favorite.favorite}
                    data-testid="sendspin-favorite"
                  >
                    <Heart size={16} fill={favorite.favorite ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            )}

            {/* Playback controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => sendspinCommand('previous')}
                disabled={!can('previous')}
                className={skin.sendspinButton}
                title="Previous"
                aria-label="Previous"
                data-testid="sendspin-previous"
              >
                <SkipBack size={18} />
              </button>
              {status === 'playing' ? (
                <button
                  onClick={() => sendspinCommand('pause')}
                  disabled={!can('pause')}
                  className={skin.sendspinPlayButton}
                  title="Pause"
                  aria-label="Pause"
                  data-testid="sendspin-pause"
                >
                  <Pause size={20} />
                </button>
              ) : (
                <button
                  onClick={() => (emptyQueue ? setPanel('picker') : sendspinCommand('play'))}
                  disabled={emptyQueue ? reconnecting : !can('play')}
                  className={skin.sendspinPlayButton}
                  title="Play"
                  aria-label="Play"
                  data-testid="sendspin-play"
                >
                  <Play size={20} />
                </button>
              )}
              <button
                onClick={() => sendspinCommand('stop')}
                disabled={!can('stop')}
                className={skin.sendspinButton}
                title="Stop"
                aria-label="Stop"
                data-testid="sendspin-stop"
              >
                <Square size={16} />
              </button>
              <button
                onClick={() => sendspinCommand('next')}
                disabled={!can('next')}
                className={skin.sendspinButton}
                title="Next"
                aria-label="Next"
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
                disabled={!can('mute')}
                className={`${skin.sendspinButton} ${sendspin.muted ? 'text-red-400' : ''}`}
                title={sendspin.muted ? 'Unmute' : 'Mute'}
                aria-label={sendspin.muted ? 'Unmute' : 'Mute'}
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
                  if (sendspinCommand('volume', { volume: vol })) updateSendspin({ volume: vol });
                  if (sendspin.muted && vol > 0 && sendspin.supportedCmds.includes('mute') && sendspinCommand('mute', { mute: false })) {
                    updateSendspin({ muted: false });
                  }
                }}
                disabled={!can('volume')}
                className={skin.sendspinVolumeSlider}
                title={`Volume: ${sendspin.volume}%`}
                aria-label="Volume"
                data-testid="sendspin-volume"
              />
            </div>

            {/* Divider */}
            <div className={skin.sendspinDivider} />

            {/* Shuffle, repeat & queue */}
            <div className="flex items-center gap-1">
              <button
                onClick={modes.toggleShuffle}
                disabled={reconnecting || !modes.canShuffle}
                className={modes.shuffle ? skin.sendspinButtonOn : skin.sendspinButton}
                aria-pressed={modes.shuffle}
                title={modes.shuffle ? 'Shuffle: on' : 'Shuffle: off'}
                aria-label="Shuffle"
                data-testid="sendspin-shuffle"
              >
                <Shuffle size={16} />
              </button>
              <button
                onClick={modes.cycleRepeat}
                disabled={reconnecting || !modes.canRepeat}
                className={modes.repeat !== 'off' ? skin.sendspinButtonOn : skin.sendspinButton}
                title={`Repeat: ${modes.repeat}`}
                aria-label={`Repeat: ${modes.repeat}`}
                data-testid="sendspin-repeat"
              >
                {modes.repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
              {maReady && (
                <button
                  onClick={() => setPanel(p => (p === 'queue' ? null : 'queue'))}
                  className={panel === 'queue' ? skin.sendspinButtonOn : skin.sendspinButton}
                  title="Queue"
                  aria-label="Queue"
                  aria-pressed={panel === 'queue'}
                  data-testid="sendspin-queue"
                >
                  <ListMusic size={16} />
                </button>
              )}
            </div>
          </div>

          {!idle && (
            <SendspinProgress key={trackKey(metadata)} skin={skin} getProgress={getProgress} onSeek={onSeek} seekMaxMs={sendspin.seekMaxMs} />
          )}
        </div>
      </div>
    </div>
  );
}
