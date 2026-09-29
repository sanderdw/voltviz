import { useEffect, useState } from 'react';
import { Square, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Heart, ListMusic, ListPlus, Music } from 'lucide-react';
import type { ControllerCommand, ControllerCommands } from '@sendspin/sendspin-js';
import type { SkinDefinition } from '../skins';
import { hasTrack, trackKey, type SendspinState, type TrackProgress } from '../audio/sources/sendspinState';
import { maApi, type MusicAssistantApi } from '../audio/sources/musicAssistant';
import { deriveBarStatus, seekMode, statusLabel } from './sendspinView';
import { useFavorite, useMaQueue } from './useMusicAssistant';
import SendspinProgress from './SendspinProgress';
import SendspinQueuePanel from './SendspinQueuePanel';
import SendspinMediaPicker from './SendspinMediaPicker';

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
  const metadata = sendspin.metadata;
  const idle = !hasTrack(metadata);
  const { queue, ready: maReady } = useMaQueue(ma, sendspin.playerId, {
    refreshKey: `${trackKey(metadata) ?? ''}\u0000${sendspin.groupName ?? ''}`,
    poll: panel !== null,
  });
  const favorite = useFavorite(maReady ? ma : null, queue?.current_item?.media_item);

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

  const repeat = metadata?.repeat ?? 'off';
  const nextRepeat: ControllerCommand = repeat === 'off' ? 'repeat_all' : repeat === 'all' ? 'repeat_one' : 'repeat_off';
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

      <div className={skin.sendspinBar} data-testid="sendspin-controls">
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
              onClick={() => sendspinCommand(metadata?.shuffle ? 'unshuffle' : 'shuffle')}
              disabled={!can(metadata?.shuffle ? 'unshuffle' : 'shuffle')}
              className={metadata?.shuffle ? skin.sendspinButtonOn : skin.sendspinButton}
              aria-pressed={!!metadata?.shuffle}
              title={metadata?.shuffle ? 'Unshuffle' : 'Shuffle'}
              aria-label={metadata?.shuffle ? 'Unshuffle' : 'Shuffle'}
              data-testid="sendspin-shuffle"
            >
              <Shuffle size={16} />
            </button>
            <button
              onClick={() => sendspinCommand(nextRepeat)}
              disabled={!can(nextRepeat)}
              className={repeat !== 'off' ? skin.sendspinButtonOn : skin.sendspinButton}
              title={`Repeat: ${repeat}`}
              aria-label={`Repeat: ${repeat}`}
              data-testid="sendspin-repeat"
            >
              {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
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
  );
}
