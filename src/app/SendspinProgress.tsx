import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkinDefinition } from '../skins';
import type { TrackProgress } from '../audio/sources/sendspinState';
import { formatTime } from './sendspinView';

interface SendspinProgressProps {
  skin: SkinDefinition;
  getProgress: () => TrackProgress | null;
  /** Seeks to a position (returns whether it was sent), or null when the track can't be sought. */
  onSeek: ((positionMs: number) => boolean) | null;
  seekMaxMs: number | null;
}

const sameDisplay = (a: TrackProgress | null, b: TrackProgress | null) =>
  a === b || (a !== null && b !== null
    && Math.floor(a.positionMs / 1000) === Math.floor(b.positionMs / 1000)
    && a.durationMs === b.durationMs
    && (a.playbackSpeed > 0) === (b.playbackSpeed > 0));

/**
 * Elapsed / total time of the current track. Reads the position itself a few times a second and
 * only re-renders when the shown second changes, so the rest of the app doesn't tick along.
 */
export default function SendspinProgress({ skin, getProgress, onSeek, seekMaxMs }: SendspinProgressProps) {
  const [progress, setProgress] = useState<TrackProgress | null>(getProgress);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [pending, setPending] = useState<{ ms: number; until: number } | null>(null);

  useEffect(() => {
    const tick = () => {
      const next = getProgress();
      setProgress(prev => (sameDisplay(prev, next) ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [getProgress]);

  // The server takes a moment to report the new position: hold the thumb at the target meanwhile
  useEffect(() => {
    if (!pending) return;
    if (progress && Math.abs(progress.positionMs - pending.ms) < 2500) {
      setPending(null);
      return;
    }
    const id = window.setTimeout(() => setPending(null), Math.max(0, pending.until - Date.now()));
    return () => window.clearTimeout(id);
  }, [pending, progress]);

  const commit = useRef<(ms: number) => void>(() => {});
  commit.current = (ms: number) => {
    setDragMs(null);
    if (!onSeek || !progress) return;
    const target = Math.max(0, Math.min(ms, seekMaxMs ?? progress.durationMs));
    if (onSeek(target)) setPending({ ms: target, until: Date.now() + 3000 });
  };
  // React's onChange fires on every move; the native change event once the drag or key press is done
  const sliderRef = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    const onChange = () => commit.current(Number(el.value));
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  if (!progress) return null;
  const live = progress.durationMs <= 0;
  const shown = dragMs ?? pending?.ms ?? progress.positionMs;
  const percent = live ? 0 : Math.min(100, (shown / progress.durationMs) * 100);

  return (
    <div className="flex items-center gap-2 w-full min-w-0" data-testid="sendspin-progress">
      <span className={skin.sendspinProgressTime} data-testid="sendspin-elapsed">{formatTime(shown)}</span>
      {onSeek && !live ? (
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={progress.durationMs}
          step={1000}
          value={Math.min(shown, progress.durationMs)}
          onChange={e => setDragMs(Number(e.target.value))}
          className={skin.sendspinSeekSlider}
          aria-label="Seek"
          aria-valuetext={`${formatTime(shown)} of ${formatTime(progress.durationMs)}`}
          data-testid="sendspin-seek"
        />
      ) : (
        <div
          className={skin.sendspinProgressTrack}
          role="progressbar"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={live ? undefined : Math.round(progress.durationMs / 1000)}
          aria-valuenow={live ? undefined : Math.round(shown / 1000)}
        >
          {!live && (
            <div
              className={skin.sendspinProgressFill}
              style={{ width: `${percent}%`, transition: progress.playbackSpeed > 0 ? 'width 1s linear' : 'none' }}
            />
          )}
        </div>
      )}
      <span className={skin.sendspinProgressTime} data-testid="sendspin-duration">{live ? 'LIVE' : formatTime(progress.durationMs)}</span>
    </div>
  );
}
