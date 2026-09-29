import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePlayerInMA, discoverMusicAssistant, MaError, maApi, MusicAssistantClient, pickImage } from '../../src/audio/sources/musicAssistant';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  sent: any[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
  }

  /** A message from the server. */
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  hello() {
    this.receive({ server_id: 'x', server_version: '2.10.4', schema_version: 65 });
  }

  drop() {
    this.onclose?.();
  }

  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
}

const endpoint = { wsUrl: 'wss://ha.local/api/hassio_ingress/abc/ws', httpBase: '/api/hassio_ingress/abc/' };
const client = (options = {}) =>
  new MusicAssistantClient({ ...endpoint, WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, pageProtocol: 'https:', ...options });
/** The error a request is expected to fail with. */
const failure = (request: Promise<unknown>): Promise<MaError> =>
  request.then(() => { throw new Error('expected the request to fail'); }, (err: MaError) => err);

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MusicAssistantClient', () => {
  it('holds requests until the server introduced itself, then resolves them by message id', async () => {
    const ma = client();
    ma.connect();
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(endpoint.wsUrl);
    const queue = maApi.activeQueue(ma, 'player-1');
    expect(ws.sent).toEqual([]);

    ws.hello();
    expect(ma.status).toBe('connected');
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({ command: 'player_queues/get_active_queue', args: { player_id: 'player-1' } });

    ws.receive({ message_id: ws.sent[0].message_id, result: { queue_id: 'q1', items: 0 } });
    await expect(queue).resolves.toEqual({ queue_id: 'q1', items: 0 });
  });

  it('rejects with the error code of an error result', async () => {
    const ma = client();
    ma.connect();
    FakeWebSocket.last.hello();
    const result = maApi.addFavorite(ma, 'library://track/1');
    const ws = FakeWebSocket.last;
    ws.receive({ message_id: ws.sent[0].message_id, error_code: 3, details: 'Not allowed' });
    const err = await failure(result);
    expect(err).toBeInstanceOf(MaError);
    expect(err.code).toBe(3);
    expect(err.message).toBe('Not allowed');
  });

  it('joins chunked results', async () => {
    const ma = client();
    ma.connect();
    FakeWebSocket.last.hello();
    const result = maApi.playlists(ma);
    const ws = FakeWebSocket.last;
    const id = ws.sent[0].message_id;
    ws.receive({ message_id: id, result: [1, 2], partial: true });
    ws.receive({ message_id: id, result: [3], partial: true });
    ws.receive({ message_id: id, result: [4] });
    await expect(result).resolves.toEqual([1, 2, 3, 4]);
  });

  it('times out unanswered requests', async () => {
    const ma = client({ requestTimeoutMs: 1000 });
    ma.connect();
    FakeWebSocket.last.hello();
    const result = failure(ma.request('music/search'));
    vi.advanceTimersByTime(1001);
    expect((await result).code).toBe('timeout');
    // a late answer is ignored
    FakeWebSocket.last.receive({ message_id: FakeWebSocket.last.sent[0].message_id, result: [] });
  });

  it('replaces a socket that went silent and sends the request again', async () => {
    const ma = client({ livenessMs: 3000 });
    ma.connect();
    const dead = FakeWebSocket.last;
    dead.hello();
    const playlists = maApi.playlists(ma);
    vi.advanceTimersByTime(3000);
    // Nothing came back: the server is asked the time
    expect(dead.sent.map(m => m.command)).toEqual(['music/playlists/library_items', 'time']);
    vi.advanceTimersByTime(3000);
    // Not even that: a new socket, and the request goes out again after its handshake
    expect(dead.closed).toBe(true);
    expect(ma.status).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    const fresh = FakeWebSocket.last;
    expect(fresh).not.toBe(dead);
    fresh.hello();
    expect(fresh.sent.map(m => m.command)).toEqual(['music/playlists/library_items']);
    fresh.receive({ message_id: fresh.sent[0].message_id, result: [] });
    await expect(playlists).resolves.toEqual([]);
  });

  it('keeps a socket that answers the probe or sends anything else', async () => {
    const ma = client({ livenessMs: 3000, requestTimeoutMs: 60000 });
    ma.connect();
    const ws = FakeWebSocket.last;
    ws.hello();
    const search = ma.request('music/search');
    vi.advanceTimersByTime(3000);
    const probe = ws.sent.find(m => m.command === 'time');
    ws.receive({ message_id: probe.message_id, result: 1 });
    vi.advanceTimersByTime(3000);
    // A slow search on a busy server: events prove it is there
    ws.receive({ event: 'player_updated', object_id: 'p1', data: {} });
    vi.advanceTimersByTime(9000);
    expect(ws.closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent.filter(m => m.command === 'time')).toHaveLength(1);
    ws.receive({ message_id: ws.sent[0].message_id, result: { tracks: [] } });
    await expect(search).resolves.toEqual({ tracks: [] });
  });

  it('passes events to the listeners', () => {
    const ma = client();
    ma.connect();
    const events: unknown[] = [];
    ma.onEvent(e => events.push(e));
    FakeWebSocket.last.receive({ event: 'queue_updated', object_id: 'q1', data: { queue_id: 'q1' } }); // before the handshake: ignored
    FakeWebSocket.last.hello();
    FakeWebSocket.last.receive({ event: 'queue_updated', object_id: 'q1', data: { queue_id: 'q1' } });
    expect(events).toEqual([{ event: 'queue_updated', object_id: 'q1', data: { queue_id: 'q1' } }]);
  });

  it('reconnects with a growing delay after losing the connection', async () => {
    const ma = client();
    const statuses: string[] = [];
    ma.onStatus(s => statuses.push(s));
    ma.connect();
    FakeWebSocket.last.hello();
    const lost = failure(ma.request('player_queues/items'));
    FakeWebSocket.last.drop();
    expect((await lost).code).toBe('disconnected');
    expect(ma.status).toBe('reconnecting');

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.last.hello();
    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
  });

  it('gives up when the server was never reached', async () => {
    const ma = client({ maxInitialFailures: 3 });
    ma.connect();
    const waiting = failure(ma.request('player_queues/get_active_queue'));
    FakeWebSocket.last.drop();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last.drop();
    vi.advanceTimersByTime(2000);
    FakeWebSocket.last.drop();
    expect(ma.status).toBe('unavailable');
    expect((await waiting).code).toBe('unavailable');
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await expect(ma.request('music/search')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('stops for good on close()', async () => {
    const ma = client();
    ma.connect();
    FakeWebSocket.last.hello();
    const pending = failure(ma.request('music/search'));
    ma.close();
    expect(FakeWebSocket.last.closed).toBe(true);
    expect(ma.status).toBe('closed');
    expect((await pending).code).toBe('disconnected');
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('builds image URLs through the image proxy, or uses safe remote ones', () => {
    const ma = client();
    expect(ma.imageUrl({ path: '/music/cover.jpg', provider: 'filesystem', proxy_id: 'abc123' }, 80))
      .toBe('/api/hassio_ingress/abc/imageproxy/abc123?size=80');
    expect(ma.imageUrl({ path: 'https://i.scdn.co/image/1', remotely_accessible: true }, 80)).toBe('https://i.scdn.co/image/1');
    expect(ma.imageUrl({ path: 'http://cdn.example/1.jpg', remotely_accessible: true }, 80)).toBeNull();
    expect(client({ pageProtocol: 'http:' }).imageUrl({ path: 'http://cdn.example/1.jpg', remotely_accessible: true }, 80)).toBe('http://cdn.example/1.jpg');
    expect(ma.imageUrl({ path: '/music/cover.jpg' }, 80)).toBeNull();
    expect(ma.imageUrl(null, 80)).toBeNull();
  });

  it('saves the player config, retrying while Music Assistant has not registered the player', async () => {
    const ma = client();
    ma.connect();
    FakeWebSocket.last.hello();
    const ws = FakeWebSocket.last;
    const done = configurePlayerInMA(ma, 'player-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent[0]).toMatchObject({ command: 'config/players/save', args: { player_id: 'player-1', values: { hide_in_ui: false, expose_player_to_ha: true } } });
    ws.receive({ message_id: ws.sent[0].message_id, error_code: 999, details: 'Player not found' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.sent).toHaveLength(2);
    ws.receive({ message_id: ws.sent[1].message_id, result: {} });
    await expect(done).resolves.toBe(true);
  });
});

describe('pickImage', () => {
  it('takes the own image, then a metadata thumbnail, then the media item', () => {
    const own = { path: 'own' };
    const thumb = { path: 'thumb', type: 'thumb' };
    expect(pickImage({ image: own, metadata: { images: [thumb] } })).toBe(own);
    expect(pickImage({ metadata: { images: [{ path: 'fanart', type: 'fanart' }, thumb] } })).toBe(thumb);
    expect(pickImage({ image: null, media_item: { image: own } })).toBe(own);
    expect(pickImage(null)).toBeNull();
  });
});

describe('discoverMusicAssistant', () => {
  const ingressPage = { href: 'https://ha.local/api/hassio_ingress/voltviz/', pathname: '/api/hassio_ingress/voltviz/', protocol: 'https:', host: 'ha.local' };
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));

  it('does not look outside Home Assistant ingress', async () => {
    const fetchImpl = vi.fn();
    const page = { href: 'http://192.168.1.2:8099/', pathname: '/', protocol: 'http:', host: '192.168.1.2:8099' };
    await expect(discoverMusicAssistant(page, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('finds the WebSocket from ma-config.json', async () => {
    const fetchImpl = vi.fn(() => json({ ingress_entry: '/api/hassio_ingress/music' }));
    await expect(discoverMusicAssistant(ingressPage, fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      wsUrl: 'wss://ha.local/api/hassio_ingress/music/ws',
      httpBase: '/api/hassio_ingress/music/',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://ha.local/api/hassio_ingress/voltviz/ma-config.json', { cache: 'no-store' });
  });

  it('ignores the SPA fallback page and unexpected entries', async () => {
    const html = vi.fn(() => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })));
    await expect(discoverMusicAssistant(ingressPage, html as unknown as typeof fetch)).resolves.toBeNull();
    const foreign = vi.fn(() => json({ ingress_entry: 'https://elsewhere.example/' }));
    await expect(discoverMusicAssistant(ingressPage, foreign as unknown as typeof fetch)).resolves.toBeNull();
  });
});
