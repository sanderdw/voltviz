/**
 * Google Cast for the visualizer picture (no audio): loads the Cast sender framework while a
 * source is running, and for every Cast session streams the composited stage to the VoltViz
 * receiver over WebRTC. The compositor follows the current VisualizerHost, which is recreated on
 * every source change; with no host the TV shows black.
 */
import { useCallback, useEffect, useState } from 'react';
import type { VisualizerHost } from '../visualizers/runtime/VisualizerHost';
import { loadCastContext } from './castSdk';
import { CastCompositor } from './CastCompositor';
import { CastStreamer, type StreamState } from './CastStreamer';

export type CastStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export interface CastControl {
  /** A Cast device is reachable (and this browser can cast). */
  available: boolean;
  status: CastStatus;
  deviceName: string | null;
  /** Opens the browser's device picker, or ends the current session. */
  toggle: () => void;
}

export function useCast(host: VisualizerHost | null, enabled: boolean): CastControl {
  const [context, setContext] = useState<cast.framework.CastContext | null>(null);
  const [castState, setCastState] = useState<string>('NO_DEVICES_AVAILABLE');
  const [session, setSession] = useState<cast.framework.CastSession | null>(null);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [compositor, setCompositor] = useState<CastCompositor | null>(null);

  // Load the framework the first time a source runs (no Google script for visitors who never start one)
  useEffect(() => {
    if (!enabled || context) return;
    let cancelled = false;
    loadCastContext().then(ctx => { if (!cancelled) setContext(ctx); });
    return () => { cancelled = true; };
  }, [enabled, context]);

  useEffect(() => {
    if (!context) return;
    const { CastContextEventType, SessionState } = cast.framework;
    const onCastState = (e: cast.framework.CastStateEventData) => setCastState(e.castState);
    const onSessionState = (e: cast.framework.SessionStateEventData) => {
      if (e.sessionState === SessionState.SESSION_STARTED || e.sessionState === SessionState.SESSION_RESUMED) {
        setSession(e.session);
      } else if (e.sessionState === SessionState.SESSION_ENDED || e.sessionState === SessionState.SESSION_START_FAILED) {
        setSession(null);
      }
    };
    setCastState(context.getCastState());
    setSession(context.getCurrentSession());
    context.addEventListener(CastContextEventType.CAST_STATE_CHANGED, onCastState);
    context.addEventListener(CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
    return () => {
      context.removeEventListener(CastContextEventType.CAST_STATE_CHANGED, onCastState);
      context.removeEventListener(CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
    };
  }, [context]);

  // One compositor + WebRTC stream per Cast session
  useEffect(() => {
    if (!session) return;
    const comp = new CastCompositor();
    const streamer = new CastStreamer(session, comp.track, setStreamState);
    setCompositor(comp);
    streamer.start();
    return () => {
      streamer.close();
      comp.dispose();
      setCompositor(null);
      setStreamState('connecting');
    };
  }, [session]);

  // Feed the compositor from whatever host is drawing now
  useEffect(() => {
    if (!compositor) return;
    if (!host) {
      compositor.clear();
      return;
    }
    host.setAfterFrame(compositor.onFrame);
    return () => host.setAfterFrame(null);
  }, [host, compositor]);

  const toggle = useCallback(() => {
    if (!context) return;
    if (context.getCurrentSession()) context.endCurrentSession(true);
    // Rejects when the picker is dismissed; nothing to do then
    else context.requestSession().catch(() => {});
  }, [context]);

  const status: CastStatus = session
    ? streamState
    : castState === 'CONNECTING' ? 'connecting' : 'idle';

  return {
    available: Boolean(context) && (castState !== 'NO_DEVICES_AVAILABLE' || Boolean(session)),
    status,
    deviceName: session?.getCastDevice().friendlyName ?? null,
    toggle,
  };
}
