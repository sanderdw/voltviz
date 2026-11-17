/**
 * The Sendspin connection as the app uses it: the session and its state, the Music Assistant
 * API that comes with it inside the Home Assistant add-on, and the commands of the Sendspin bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SendspinController } from '../audio/sources/sendspin';
import { initialSendspinState, trackKey, type ControllerCommand, type ControllerCommands, type SendspinSession, type SendspinState } from '../audio/sources/sendspinState';
import type { MusicAssistantApi } from '../audio/sources/musicAssistant';
import { removeUrlParam } from './useAppState';
import { useMaStatus } from './useMusicAssistant';

interface SendspinEvents {
  /** The audio to visualize; null when the connection is gone for good. */
  onStream(stream: MediaStream | null): void;
  onError(message: string | null): void;
  /** The server activated the player: the connect dialog can close. */
  onActivated(): void;
}

export function useSendspin(events: SendspinEvents) {
  const [state, setState] = useState<SendspinState>(initialSendspinState);
  const [connecting, setConnecting] = useState(false);
  // Music Assistant's API, only inside the Home Assistant add-on
  const [ma, setMa] = useState<MusicAssistantApi | null>(null);
  const maStatus = useMaStatus(ma);
  const sessionRef = useRef<SendspinSession | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const update = useCallback((patch: Partial<SendspinState>) => setState(prev => ({ ...prev, ...patch })), []);

  // development / tests only: window.__voltvizSendspin drives the Sendspin bar without a server
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    import('./sendspinDev').then(m => {
      if (!cancelled) dispose = m.installSendspinDevApi({ sendspinRef: sessionRef, setSendspin: setState, setMa });
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const reset = () => {
    setConnecting(false);
    setState(initialSendspinState);
    setMa(null);
    removeUrlParam('sendspin');
  };

  /** Disconnect (idempotent). The stream that was being visualized is left to the caller. */
  const disconnect = () => {
    sessionRef.current?.cleanup();
    sessionRef.current = null;
    reset();
  };

  const connect = async (serverUrl: string) => {
    const controller = new SendspinController({
      onStream: stream => eventsRef.current.onStream(stream),
      onState: update,
      onError: message => eventsRef.current.onError(message),
      onConnecting: setConnecting,
      onActivated: () => eventsRef.current.onActivated(),
      onClosed: () => {
        // A newer source (or controller) has already taken over: leave its stream alone
        if (sessionRef.current !== controller) return;
        sessionRef.current = null;
        reset();
        // The connection is gone for good: back to the source selection instead of a dead stream
        eventsRef.current.onStream(null);
      },
      onMusicAssistant: client => {
        if (sessionRef.current === controller) setMa(client);
      },
    });
    sessionRef.current = controller;
    await controller.connect(serverUrl);
  };

  const command = <T extends ControllerCommand>(name: T, params?: ControllerCommands[T]) =>
    sessionRef.current?.command(name, params) ?? false;
  const seek = (positionMs: number) => sessionRef.current?.seek(positionMs) ?? false;
  // Stable, so the progress bar's timer isn't restarted on every render
  const getProgress = useCallback(() => sessionRef.current?.trackProgress ?? null, []);

  // Music Assistant's artwork URLs point at its own port (http://<host>:8095), which an https://
  // page can't load and a phone away from home can't reach: through ingress when available.
  // Memoized, so the metadata only changes when the server sends new metadata.
  const metadata = useMemo(() => {
    const artwork = state.metadata?.artwork_url;
    if (!state.metadata || !artwork || !ma) return state.metadata;
    const local = ma.localImageUrl(artwork);
    return local === artwork ? state.metadata : { ...state.metadata, artwork_url: local };
    // maStatus: the rewrite needs Music Assistant's base_url from its handshake
  }, [state.metadata, ma, maStatus]);
  const shown = useMemo(() => (metadata === state.metadata ? state : { ...state, metadata }), [state, metadata]);

  return { state: shown, connecting, ma, connect, disconnect, command, seek, getProgress, update };
}

/**
 * Calls `onChange` when Sendspin (Music Assistant) reports another track, which is exact where
 * detecting the change from the audio is not. A cleared track (queue ended, stopped) is not a
 * change: A → nothing → B counts once.
 */
export function useTrackChange(state: SendspinState, onChange: () => void): void {
  const track = trackKey(state.metadata);
  const lastTrack = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!state.active) {
      lastTrack.current = null;
      return;
    }
    if (!track) return;
    if (lastTrack.current !== null && track !== lastTrack.current) onChangeRef.current();
    lastTrack.current = track;
  }, [track, state.active]);
}
