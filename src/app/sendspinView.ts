/**
 * What the Sendspin bar shows, derived from the Sendspin state and (inside the Home Assistant
 * add-on) Music Assistant's queue. Pure, so the unit tests cover it.
 */
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import { hasTrack, SENDSPIN_RECONNECT_ATTEMPTS, type RepeatMode } from '../audio/sources/sendspinState';
import type { MaMediaItem, MaPlayerQueue, MaQueueOption } from '../audio/sources/musicAssistant';

export type BarStatus = 'reconnecting' | 'idle' | 'playing' | 'paused' | 'stopped';

/** m:ss, or h:mm:ss from an hour on. */
export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function deriveBarStatus({ reconnectAttempt, metadata, groupPlayback, playing, queueState }: {
  reconnectAttempt: number;
  metadata: ServerStateMetadata | null;
  groupPlayback: 'playing' | 'stopped' | null;
  playing: boolean;
  /** Music Assistant's queue state, when its API is available. */
  queueState?: string | null;
}): BarStatus {
  if (reconnectAttempt > 0) return 'reconnecting';
  if (!hasTrack(metadata)) return 'idle';
  // Music Assistant knows; Sendspin alone has no "paused" state
  if (queueState === 'playing') return 'playing';
  if (queueState === 'paused') return 'paused';
  if (queueState === 'idle') return 'stopped';
  const progress = metadata?.progress;
  if (progress) {
    if (progress.playback_speed > 0) return 'playing';
    return progress.track_progress > 0 ? 'paused' : 'stopped';
  }
  return groupPlayback === 'playing' || playing ? 'playing' : 'stopped';
}

export function statusLabel(status: BarStatus, reconnectAttempt: number): string | null {
  switch (status) {
    case 'reconnecting': return `Reconnecting (${reconnectAttempt}/${SENDSPIN_RECONNECT_ATTEMPTS})…`;
    case 'paused': return 'Paused';
    case 'stopped': return 'Stopped';
    default: return null;
  }
}

/** How a position can be sought: over Sendspin, through Music Assistant's queue, or not at all. */
export function seekMode({ supportedCmds, durationMs, maQueue }: {
  supportedCmds: string[];
  durationMs: number;
  maQueue: boolean;
}): 'sendspin' | 'ma' | null {
  if (!(durationMs > 0)) return null; // live stream
  if (supportedCmds.includes('seek')) return 'sendspin';
  return maQueue ? 'ma' : null;
}

export const asRepeatMode = (value: unknown): RepeatMode => (value === 'one' || value === 'all' ? value : 'off');

/** off → all → one → off, the order Music Assistant's own player uses. */
export const nextRepeatMode = (mode: RepeatMode): RepeatMode => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');

/**
 * A shuffle or repeat change the server has not reported back yet. `revision` is the server
 * state it was made on: the Music Assistant queue, or the Sendspin metadata.
 */
export type PendingChange<T> = { value: T; base: T; revision: unknown };

/**
 * What to show for a setting with a change pending. Music Assistant 2.10 sends shuffle and
 * repeat over Sendspin only with the next track (or on pause and resume), so the change is
 * shown until the server sends new state or reports a different value itself.
 */
export const withPending = <T>(server: T, revision: unknown, pending: PendingChange<T> | null): T =>
  pending && pending.revision === revision && pending.base === server ? pending.value : server;

/** Replace an empty or finished queue; otherwise play now and keep the rest of the queue. */
export const playOption = (queue: MaPlayerQueue | null | undefined): MaQueueOption =>
  !queue || !queue.items || !queue.current_item ? 'replace' : 'play';

/** Favorites first, each item once. */
export function favoritesFirst(favorites: MaMediaItem[], all: MaMediaItem[]): MaMediaItem[] {
  const seen = new Set<string>();
  return [...favorites, ...all].filter(item => {
    if (seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
}
