/**
 * Sendspin playback state as the app sees it, and the mapping from the SDK's state. Kept free of
 * the SDK runtime (type imports only) so the unit tests can load it without a browser.
 */
import type { ControllerCommand, ControllerCommands, GroupUpdatePayload, ServerStateController, ServerStateMetadata, ServerStatePayload } from '@sendspin/sendspin-js';

export type RepeatMode = 'off' | 'one' | 'all';

export type SendspinState = {
  active: boolean;
  /** The local audio stream is running (stream/start … stream/end), not the group's state. */
  playing: boolean;
  metadata: ServerStateMetadata | null;
  supportedCmds: string[];
  volume: number;
  muted: boolean;
  repeat: RepeatMode | null;
  shuffle: boolean | null;
  /** The group's playback state. Sendspin has no "paused": a paused group reports 'stopped'. */
  groupPlayback: 'playing' | 'stopped' | null;
  groupName: string | null;
  /** Reconnect attempt in progress, 0 while connected. */
  reconnectAttempt: number;
  /** Furthest position the server accepts for a seek, when it supports seeking. */
  seekMaxMs: number | null;
  /** The Sendspin client id, which Music Assistant uses as player id and queue id. */
  playerId: string | null;
};

export const initialSendspinState: SendspinState = {
  active: false,
  playing: false,
  metadata: null,
  supportedCmds: [],
  volume: 100,
  muted: false,
  repeat: null,
  shuffle: null,
  groupPlayback: null,
  groupName: null,
  reconnectAttempt: 0,
  seekMaxMs: null,
  playerId: null,
};

export const SENDSPIN_RECONNECT_ATTEMPTS = 10;

export type TrackProgress ={ positionMs: number; durationMs: number; playbackSpeed: number };

/** What the UI drives: the live Sendspin connection, or the development fake. */
export interface SendspinSession {
  /** Returns false when the command could not be sent (unsupported, not connected). */
  command<T extends ControllerCommand>(command: T, params?: ControllerCommands[T]): boolean;
  seek(positionMs: number): boolean;
  /** Real-time position of the current track, or null when unknown. */
  readonly trackProgress: TrackProgress | null;
  cleanup(): void;
}

/** The part of the SDK's onStateChange argument the app uses. */
export type SdkState = {
  isPlaying: boolean;
  serverState?: ServerStatePayload;
  groupState?: GroupUpdatePayload;
};

export function mapSdkState(state: SdkState): Partial<SendspinState> {
  // seek_max_ms, repeat and shuffle are on the controller in the current Sendspin spec (and Music
  // Assistant 2.10) but not yet in the SDK's types. Older servers only put repeat and shuffle on
  // the metadata.
  const controller = state.serverState?.controller as (ServerStateController & {
    seek_max_ms?: number | null;
    repeat?: RepeatMode | null;
    shuffle?: boolean | null;
  }) | undefined;
  // Always take what is there now: the SDK deletes the keys the server clears, so skipping a
  // missing value would keep the previous track on screen after the queue ends.
  const metadata = state.serverState?.metadata ?? null;
  const patch: Partial<SendspinState> = {
    playing: state.isPlaying,
    metadata,
    supportedCmds: controller?.supported_commands ?? [],
    repeat: controller?.repeat ?? metadata?.repeat ?? null,
    shuffle: controller?.shuffle ?? metadata?.shuffle ?? null,
    seekMaxMs: typeof controller?.seek_max_ms === 'number' ? controller.seek_max_ms : null,
    groupPlayback: state.groupState?.playback_state ?? null,
    groupName: state.groupState?.group_name ?? null,
  };
  if (controller?.volume !== undefined) patch.volume = controller.volume;
  if (controller?.muted !== undefined) patch.muted = controller.muted;
  return patch;
}

export const hasTrack = (m: ServerStateMetadata | null | undefined): boolean => !!(m?.title || m?.artist);

/** Identifies the current track, or null when nothing is loaded. */
export const trackKey = (m: ServerStateMetadata | null | undefined): string | null =>
  m && hasTrack(m) ? `${m.artist ?? ''}\u0000${m.title ?? ''}` : null;
