/**
 * Music Assistant's own API, used next to Sendspin for what the Sendspin protocol has no
 * commands for: the queue, the library and favorites. Only reachable inside the Home Assistant
 * add-on: run.sh publishes MA's ingress entry as ma-config.json, and when VoltViz itself is
 * opened through Home Assistant ingress, the ingress session authenticates the WebSocket.
 */
import type { RepeatMode } from './sendspinState';

export type MaStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'closed';

export interface MaImage {
  type?: string;
  path: string;
  provider?: string;
  remotely_accessible?: boolean;
  proxy_id?: string | null;
}

/** Anything that may carry an image: media items, item mappings and queue items. */
export interface MaImageSource {
  image?: MaImage | null;
  metadata?: { images?: MaImage[] | null } | null;
  media_item?: MaImageSource | null;
}

export interface MaMediaItem extends MaImageSource {
  item_id: string;
  provider: string;
  name: string;
  uri: string;
  media_type: string;
  version?: string;
  favorite?: boolean;
  artists?: { name: string }[];
  duration?: number | null;
}

export interface MaQueueItem extends MaImageSource {
  queue_id: string;
  queue_item_id: string;
  name: string;
  /** Seconds. */
  duration?: number | null;
  media_item?: MaMediaItem | null;
  available?: boolean;
}

export interface MaPlayerQueue {
  queue_id: string;
  active: boolean;
  display_name?: string;
  /** The number of items in the queue (not the items themselves). */
  items: number;
  shuffle_enabled?: boolean;
  repeat_mode?: string;
  /** A smart mix Music Assistant keeps filling; shuffle and repeat are locked. */
  is_dynamic?: boolean;
  current_index?: number | null;
  /** Seconds. */
  elapsed_time?: number;
  state?: 'idle' | 'paused' | 'playing' | 'unknown' | string;
  current_item?: MaQueueItem | null;
  next_item?: MaQueueItem | null;
}

export interface MaSearchResults {
  artists?: MaMediaItem[];
  albums?: MaMediaItem[];
  tracks?: MaMediaItem[];
  playlists?: MaMediaItem[];
  radio?: MaMediaItem[];
}

export interface MaEvent {
  event: string;
  object_id?: string | null;
  data?: unknown;
}

export type MaQueueOption = 'play' | 'replace' | 'next' | 'replace_next' | 'add';

export class MaError extends Error {
  readonly code: number | 'timeout' | 'disconnected' | 'unavailable';

  constructor(code: MaError['code'], message: string) {
    super(message);
    this.name = 'MaError';
    this.code = code;
  }
}

/** What the UI uses, so the development fake can stand in for the real client. */
export interface MusicAssistantApi {
  readonly status: MaStatus;
  request<T = unknown>(command: string, args?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>;
  onEvent(listener: (event: MaEvent) => void): () => void;
  onStatus(listener: (status: MaStatus) => void): () => void;
  /** URL for an image, resized by Music Assistant where possible, or null. */
  imageUrl(image: MaImage | null | undefined, size: number): string | null;
  close(): void;
}

export type MaEndpoint = { wsUrl: string; httpBase: string };

const INGRESS_PREFIX = '/api/hassio_ingress/';

type PageLocation = Pick<Location, 'href' | 'pathname' | 'protocol' | 'host'>;

/**
 * Finds Music Assistant's WebSocket, or null outside the add-on's ingress. The add-on's direct
 * port also serves ma-config.json, but MA's ingress path only exists on Home Assistant itself.
 */
export async function discoverMusicAssistant(loc: PageLocation = window.location, fetchImpl: typeof fetch = fetch): Promise<MaEndpoint | null> {
  if (!loc.pathname.startsWith(INGRESS_PREFIX)) return null;
  try {
    const resp = await fetchImpl(new URL('ma-config.json', loc.href).href, { cache: 'no-store' });
    if (!resp.ok) return null;
    // Without the file the SPA fallback answers with index.html: json() throws
    const { ingress_entry } = (await resp.json()) as { ingress_entry?: unknown };
    if (typeof ingress_entry !== 'string' || !ingress_entry.startsWith(INGRESS_PREFIX)) return null;
    const httpBase = ingress_entry.endsWith('/') ? ingress_entry : ingress_entry + '/';
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return { wsUrl: `${wsProto}//${loc.host}${httpBase}ws`, httpBase };
  } catch {
    return null;
  }
}

type Pending = {
  payload: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  chunks: unknown[] | null;
  sent: boolean;
  sentAt: number;
  /** The client's `received` count when it was sent. */
  receivedBefore: number;
};

/** Answered at once, without arguments or permissions: asks a silent server whether it is there. */
const PROBE_COMMAND = 'time';

export type MusicAssistantClientOptions = MaEndpoint & {
  WebSocketImpl?: typeof WebSocket;
  requestTimeoutMs?: number;
  /** How long a request may go without anything from the server before the socket is probed, and the probe too. */
  livenessMs?: number;
  maxBackoffMs?: number;
  /** Give up (status 'unavailable') after this many attempts that never reached the server. */
  maxInitialFailures?: number;
  /** The page's protocol, to avoid loading http images into an https page. */
  pageProtocol?: string;
};

export class MusicAssistantClient implements MusicAssistantApi {
  private ws: WebSocket | null = null;
  private _status: MaStatus = 'connecting';
  private everConnected = false;
  private failures = 0;
  private backoffMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly idPrefix = Math.random().toString(36).slice(2, 8);
  private readonly pending = new Map<string, Pending>();
  /** Requests made before the handshake, sent once the server has answered. */
  private outbox: string[] = [];
  /** Messages received from the server so far, to tell whether anything came since a send. */
  private received = 0;
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  /** `received` when the liveness probe went out, while it waits for anything to come back. */
  private probeMark: number | null = null;
  private readonly eventListeners = new Set<(event: MaEvent) => void>();
  private readonly statusListeners = new Set<(status: MaStatus) => void>();
  private readonly opts: MusicAssistantClientOptions;
  serverVersion: string | null = null;

  constructor(options: MusicAssistantClientOptions) {
    this.opts = options;
  }

  get status(): MaStatus {
    return this._status;
  }

  connect(): void {
    if (this.ws || this.reconnectTimer || this._status === 'closed' || this._status === 'unavailable') return;
    this.open();
  }

  request<T = unknown>(command: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<T> {
    if (this._status === 'closed' || this._status === 'unavailable') {
      return Promise.reject(new MaError('unavailable', 'Music Assistant is not available'));
    }
    const id = `${this.idPrefix}-${++this.seq}`;
    const payload = JSON.stringify({ message_id: id, command, args });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.outbox = this.outbox.filter(o => o !== id);
        reject(new MaError('timeout', `Music Assistant did not answer ${command}`));
      }, options.timeoutMs ?? this.opts.requestTimeoutMs ?? 15000);
      const entry: Pending = { payload, resolve: resolve as (value: unknown) => void, reject, timer, chunks: null, sent: false, sentAt: 0, receivedBefore: 0 };
      this.pending.set(id, entry);
      if (this._status === 'connected' && this.ws) this.transmit(entry);
      else this.outbox.push(id);
    });
  }

  onEvent(listener: (event: MaEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: MaStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  imageUrl(image: MaImage | null | undefined, size: number): string | null {
    if (!image) return null;
    // The proxy resizes (and caches) on the server and is same-origin under ingress
    if (image.proxy_id) return `${this.opts.httpBase}imageproxy/${encodeURIComponent(image.proxy_id)}?size=${size}`;
    if (!image.remotely_accessible) return null;
    const secure = (this.opts.pageProtocol ?? globalThis.location?.protocol) === 'https:';
    if (image.path.startsWith('https://') || (!secure && image.path.startsWith('http://'))) return image.path;
    return null;
  }

  close(): void {
    if (this._status === 'closed') return;
    this.setStatus('closed');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopLivenessCheck();
    this.rejectPending(() => true, 'disconnected');
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  private open(): void {
    const WebSocketImpl = this.opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new WebSocketImpl(this.opts.wsUrl);
    } catch {
      this.handleClose();
      return;
    }
    this.ws = ws;
    ws.onmessage = event => {
      if (this.ws === ws) this.handleMessage(event.data);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.handleClose();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private handleMessage(raw: unknown): void {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    this.received++;

    if (this._status !== 'connected') {
      // The server introduces itself first; only then does it take commands
      if (typeof msg.server_version === 'string') {
        this.serverVersion = msg.server_version;
        this.everConnected = true;
        this.failures = 0;
        this.backoffMs = 1000;
        this.setStatus('connected');
        const outbox = this.outbox;
        this.outbox = [];
        for (const id of outbox) {
          const entry = this.pending.get(id);
          if (entry) this.transmit(entry);
        }
      }
      return;
    }

    if (typeof msg.event === 'string') {
      for (const listener of this.eventListeners) {
        try {
          listener(msg as MaEvent);
        } catch (err) {
          console.error('VoltViz: Music Assistant event listener failed', err);
        }
      }
      return;
    }

    if (msg.message_id === undefined) return;
    const id = String(msg.message_id);
    const entry = this.pending.get(id);
    if (!entry) return;
    if ('error_code' in msg) {
      this.settle(id);
      entry.reject(new MaError(msg.error_code, msg.details ? String(msg.details) : `Music Assistant error ${msg.error_code}`));
      return;
    }
    // Long results arrive in chunks; the last one closes the list
    const result = msg.result;
    if (msg.partial === true || msg.is_last_chunk === false) {
      entry.chunks = [...(entry.chunks ?? []), ...(Array.isArray(result) ? result : [result])];
      return;
    }
    this.settle(id);
    if (entry.chunks) {
      entry.resolve([...entry.chunks, ...(Array.isArray(result) ? result : result == null ? [] : [result])]);
    } else {
      entry.resolve(result);
    }
  }

  private transmit(entry: Pending): void {
    entry.sent = true;
    entry.sentAt = Date.now();
    entry.receivedBefore = this.received;
    this.ws?.send(entry.payload);
    this.livenessTimer ??= setTimeout(this.checkLiveness, this.opts.livenessMs ?? 3000);
  }

  /**
   * A socket can die without closing (a phone that slept, a network change), and requests then
   * go nowhere. When the server sent nothing at all since a request went out, ask it the time;
   * when that brings nothing either, open a new socket and send the requests again.
   */
  private readonly checkLiveness = (): void => {
    this.livenessTimer = null;
    const ws = this.ws;
    if (this._status !== 'connected' || !ws) return;
    if (this.probeMark !== null) {
      const silent = this.received === this.probeMark;
      this.probeMark = null;
      if (silent) {
        this.dropDeadSocket(ws);
        return;
      }
    }
    const waiting = [...this.pending.values()].filter(entry => entry.sent);
    if (waiting.length === 0) return;
    const limit = this.opts.livenessMs ?? 3000;
    const now = Date.now();
    if (waiting.some(entry => entry.receivedBefore === this.received && now - entry.sentAt >= limit)) {
      this.probeMark = this.received;
      ws.send(JSON.stringify({ message_id: `${this.idPrefix}-probe`, command: PROBE_COMMAND, args: {} }));
    }
    this.livenessTimer = setTimeout(this.checkLiveness, limit);
  };

  private dropDeadSocket(ws: WebSocket): void {
    // Nothing came back over this socket, so these most likely never reached the server either
    for (const [id, entry] of this.pending) {
      if (!entry.sent) continue;
      entry.sent = false;
      this.outbox.push(id);
    }
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
    this.handleClose();
  }

  private stopLivenessCheck(): void {
    if (this.livenessTimer) clearTimeout(this.livenessTimer);
    this.livenessTimer = null;
    this.probeMark = null;
  }

  private handleClose(): void {
    this.ws = null;
    this.stopLivenessCheck();
    if (this._status === 'closed') return;
    // Requests already on the wire are lost; ones still waiting for the handshake can go out
    // on the next connection
    this.rejectPending(entry => entry.sent, 'disconnected');
    if (!this.everConnected && ++this.failures >= (this.opts.maxInitialFailures ?? 3)) {
      this.setStatus('unavailable');
      this.outbox = [];
      this.rejectPending(() => true, 'unavailable');
      return;
    }
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private settle(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
  }

  private rejectPending(match: (entry: Pending) => boolean, code: 'disconnected' | 'unavailable'): void {
    for (const [id, entry] of [...this.pending]) {
      if (!match(entry)) continue;
      this.settle(id);
      this.outbox = this.outbox.filter(o => o !== id);
      entry.reject(new MaError(code, code === 'unavailable' ? 'Music Assistant is not available' : 'Music Assistant connection lost'));
    }
  }

  private setStatus(status: MaStatus): void {
    if (status === this._status) return;
    this._status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

/** The best image of an item: its own, a thumbnail from its metadata, or its media item's. */
export function pickImage(item: MaImageSource | null | undefined): MaImage | null {
  if (!item) return null;
  if (item.image) return item.image;
  const images = item.metadata?.images ?? [];
  return images.find(i => i.type === 'thumb') ?? images[0] ?? pickImage(item.media_item);
}

export const artistNames = (item: MaMediaItem | null | undefined): string =>
  (item?.artists ?? []).map(a => a.name).filter(Boolean).join(', ');

/** Every Music Assistant command VoltViz sends. */
export const maApi = {
  /** The queue that plays on the player: its own, or its group leader's. */
  activeQueue: (ma: MusicAssistantApi, playerId: string) =>
    ma.request<MaPlayerQueue | null>('player_queues/get_active_queue', { player_id: playerId }),
  queueItems: (ma: MusicAssistantApi, queueId: string, offset = 0, limit = 50) =>
    ma.request<MaQueueItem[]>('player_queues/items', { queue_id: queueId, limit, offset }),
  /** By queue item id: a position shifts with shuffle and queue changes, the id does not. */
  playIndex: (ma: MusicAssistantApi, queueId: string, queueItemId: string) =>
    ma.request<null>('player_queues/play_index', { queue_id: queueId, index: queueItemId }),
  playMedia: (ma: MusicAssistantApi, queueId: string, uri: string, option: MaQueueOption) =>
    ma.request<null>('player_queues/play_media', { queue_id: queueId, media: uri, option }),
  seek: (ma: MusicAssistantApi, queueId: string, seconds: number) =>
    ma.request<null>('player_queues/seek', { queue_id: queueId, position: Math.max(0, Math.round(seconds)) }),
  setShuffle: (ma: MusicAssistantApi, queueId: string, enabled: boolean) =>
    ma.request<null>('player_queues/shuffle', { queue_id: queueId, shuffle_enabled: enabled }),
  setRepeat: (ma: MusicAssistantApi, queueId: string, mode: RepeatMode) =>
    ma.request<null>('player_queues/repeat', { queue_id: queueId, repeat_mode: mode }),
  playlists: (ma: MusicAssistantApi, favorite?: boolean) =>
    ma.request<MaMediaItem[]>('music/playlists/library_items', { favorite, limit: 100, order_by: 'sort_name' }),
  radios: (ma: MusicAssistantApi) =>
    ma.request<MaMediaItem[]>('music/radios/library_items', { limit: 50, order_by: 'sort_name' }),
  recentlyPlayed: (ma: MusicAssistantApi) =>
    ma.request<MaMediaItem[]>('music/recently_played_items', { limit: 20 }),
  search: (ma: MusicAssistantApi, query: string) =>
    ma.request<MaSearchResults>('music/search', { search_query: query, media_types: ['playlist', 'album', 'artist', 'track', 'radio'], limit: 8 }),
  /** The library version of a provider item, if it is in the library. */
  libraryItem: (ma: MusicAssistantApi, mediaType: string, itemId: string, provider: string) =>
    ma.request<MaMediaItem | null>('music/get_library_item', { media_type: mediaType, item_id: itemId, provider_instance_id_or_domain: provider }),
  addFavorite: (ma: MusicAssistantApi, uri: string) =>
    ma.request<null>('music/favorites/add_item', { item: uri }),
  removeFavorite: (ma: MusicAssistantApi, mediaType: string, libraryItemId: string) =>
    ma.request<null>('music/favorites/remove_item', { media_type: mediaType, library_item_id: libraryItemId }),
  savePlayerConfig: (ma: MusicAssistantApi, playerId: string) =>
    ma.request<unknown>('config/players/save', { player_id: playerId, values: { hide_in_ui: false, expose_player_to_ha: true } }),
};

// Music Assistant registers Sendspin web players hidden and not exposed to
// Home Assistant; flip both so the player is usable as soon as it appears.
// MA may not have finished registering the player when the first server state
// arrives, hence the retries.
export async function configurePlayerInMA(ma: MusicAssistantApi, playerId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    if (ma.status === 'unavailable' || ma.status === 'closed') return false;
    try {
      await maApi.savePlayerConfig(ma, playerId);
      return true;
    } catch { /* not registered yet, or the connection is still coming up */ }
  }
  return false;
}
