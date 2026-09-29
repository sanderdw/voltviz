/**
 * React side of the Music Assistant API: its connection status, the queue that plays on the
 * VoltViz player, the upcoming items and the favorite state of the current track.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { maApi, type MaMediaItem, type MaPlayerQueue, type MaQueueItem, type MaStatus, type MusicAssistantApi } from '../audio/sources/musicAssistant';

const noSubscription = () => () => {};

export function useMaStatus(ma: MusicAssistantApi | null): MaStatus {
  const subscribe = useCallback((onChange: () => void) => (ma ? ma.onStatus(onChange) : noSubscription()), [ma]);
  return useSyncExternalStore(subscribe, () => ma?.status ?? 'unavailable');
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The player's active queue. Fetched on connect, on every track change and on group changes,
 * then kept current by queue_updated events; polled while `poll` is set in case events are missed.
 */
export function useMaQueue(ma: MusicAssistantApi | null, playerId: string | null, { refreshKey, poll }: { refreshKey: string; poll: boolean }) {
  const status = useMaStatus(ma);
  const ready = status === 'connected' && ma !== null && playerId !== null;
  const [queue, setQueue] = useState<MaPlayerQueue | null>(null);
  const queueId = useRef<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!ma || !playerId || ma.status !== 'connected') return;
    const n = ++seq.current;
    maApi.activeQueue(ma, playerId)
      .then(q => {
        if (n !== seq.current) return;
        queueId.current = q?.queue_id ?? null;
        setQueue(q ?? null);
      })
      .catch(err => console.warn('VoltViz: could not load the Music Assistant queue', err));
  }, [ma, playerId]);

  useEffect(() => {
    if (ready) refresh();
    else setQueue(null);
  }, [ready, refresh, refreshKey]);

  useEffect(() => {
    if (!ready || !ma) return;
    return ma.onEvent(event => {
      // Every client gets every event: only take this player's queue. queue_time_updated
      // (every second while playing) is left out on purpose.
      if (event.event !== 'queue_updated' && event.event !== 'queue_added') return;
      if (!event.object_id || (event.object_id !== queueId.current && event.object_id !== playerId)) return;
      if (!event.data || typeof event.data !== 'object') return;
      seq.current++;
      queueId.current = (event.data as MaPlayerQueue).queue_id ?? queueId.current;
      setQueue(event.data as MaPlayerQueue);
    });
  }, [ready, ma, playerId]);

  useEffect(() => {
    if (!ready || !poll) return;
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [ready, poll, refresh]);

  return { queue: ready ? queue : null, ready };
}

/** The current and upcoming queue items, while `open`. */
export function useMaQueueItems(ma: MusicAssistantApi | null, queue: MaPlayerQueue | null, open: boolean) {
  const [items, setItems] = useState<MaQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queueId = queue?.queue_id ?? null;
  const offset = Math.max(0, queue?.current_index ?? 0);
  const count = queue?.items ?? 0;
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!ma || !queueId || ma.status !== 'connected') return;
    const n = ++seq.current;
    maApi.queueItems(ma, queueId, offset, 50)
      .then(result => {
        if (n !== seq.current) return;
        setItems(result ?? []);
        setError(null);
      })
      .catch(err => {
        if (n === seq.current) setError(errorText(err));
      });
  }, [ma, queueId, offset]);

  useEffect(() => {
    if (open) load();
  }, [open, load, count]);

  useEffect(() => {
    if (!open || !ma || !queueId) return;
    return ma.onEvent(event => {
      if (event.event === 'queue_items_updated' && event.object_id === queueId) load();
    });
  }, [open, ma, queueId, load]);

  useEffect(() => {
    if (!queueId) setItems(null);
  }, [queueId]);

  return { items: open && queueId ? items : null, error };
}

const FAVORITABLE = new Set(['track', 'radio']);

type FavoriteState = { uri: string; favorite: boolean; libraryItemId: string | null };

async function resolveFavorite(ma: MusicAssistantApi, item: MaMediaItem): Promise<FavoriteState> {
  if (item.provider === 'library') return { uri: item.uri, favorite: !!item.favorite, libraryItemId: item.item_id };
  try {
    const libraryItem = await maApi.libraryItem(ma, item.media_type, item.item_id, item.provider);
    return { uri: item.uri, favorite: !!libraryItem?.favorite, libraryItemId: libraryItem?.item_id ?? null };
  } catch {
    // Not in the library (yet): adding it as a favorite puts it there
    return { uri: item.uri, favorite: false, libraryItemId: null };
  }
}

/** Favorite state of the current track or radio station, with an optimistic toggle. */
export function useFavorite(ma: MusicAssistantApi | null, item: MaMediaItem | null | undefined) {
  const [state, setState] = useState<FavoriteState | null>(null);
  const [busy, setBusy] = useState(false);
  /** Items the toggle failed for (e.g. a user without library write access): hide the heart. */
  const [failed, setFailed] = useState<string | null>(null);
  const itemRef = useRef(item);
  itemRef.current = item;
  const uri = item && FAVORITABLE.has(item.media_type) ? item.uri : null;

  useEffect(() => {
    setState(prev => (prev?.uri === uri ? prev : null));
    const current = itemRef.current;
    if (!ma || !uri || !current) return;
    let cancelled = false;
    resolveFavorite(ma, current).then(s => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [ma, uri]);

  const toggle = async () => {
    const current = itemRef.current;
    if (!ma || !current || !state || state.uri !== current.uri || busy) return;
    const previous = state;
    setState({ ...state, favorite: !state.favorite });
    setBusy(true);
    try {
      if (!previous.favorite) {
        await maApi.addFavorite(ma, current.uri);
        const libraryItemId = current.provider === 'library'
          ? current.item_id
          : (await maApi.libraryItem(ma, current.media_type, current.item_id, current.provider).catch(() => null))?.item_id ?? null;
        setState({ uri: current.uri, favorite: true, libraryItemId });
      } else {
        if (!previous.libraryItemId) throw new Error('Not in the library');
        await maApi.removeFavorite(ma, current.media_type, previous.libraryItemId);
      }
    } catch (err) {
      console.warn('VoltViz: could not change the favorite', err);
      setState(previous);
      setFailed(current.uri);
    } finally {
      setBusy(false);
    }
  };

  const available = state !== null && uri !== null && state.uri === uri && failed !== uri;
  return { available, favorite: available && state.favorite, busy, toggle };
}
