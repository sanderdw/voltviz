/**
 * Development and tests only (loaded behind import.meta.env.DEV): window.__voltvizSendspin
 * shows the Sendspin bar without a Sendspin server, optionally with a fake Music Assistant API
 * that answers from fixtures. Every command sent is recorded in calls().
 */
import type { Dispatch, SetStateAction } from 'react';
import { initialSendspinState, type SendspinSession, type SendspinState, type TrackProgress } from '../audio/sources/sendspinState';
import type { MaEvent, MaMediaItem, MaPlayerQueue, MaQueueItem, MaSearchResults, MaStatus, MusicAssistantApi } from '../audio/sources/musicAssistant';

export type FakeMaFixtures = {
  queue?: MaPlayerQueue | null;
  queueItems?: MaQueueItem[];
  playlists?: MaMediaItem[];
  favoritePlaylists?: MaMediaItem[];
  radios?: MaMediaItem[];
  recent?: MaMediaItem[];
  search?: MaSearchResults;
  /** Commands that answer with an error. */
  failing?: string[];
};

type Call = { command: string; args?: unknown };

const ALL_COMMANDS = ['play', 'pause', 'stop', 'next', 'previous', 'volume', 'mute', 'repeat_off', 'repeat_one', 'repeat_all', 'shuffle', 'unshuffle'];

class FakeMusicAssistant implements MusicAssistantApi {
  status: MaStatus = 'connected';
  private readonly eventListeners = new Set<(event: MaEvent) => void>();
  private readonly statusListeners = new Set<(status: MaStatus) => void>();
  private readonly fixtures: FakeMaFixtures;
  private readonly calls: Call[];

  constructor(fixtures: FakeMaFixtures, calls: Call[]) {
    this.fixtures = { ...fixtures };
    this.calls = calls;
  }

  async request<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ command, args });
    const f = this.fixtures;
    if (f.failing?.includes(command)) throw new Error(`${command} failed`);
    switch (command) {
      case 'player_queues/get_active_queue': return (f.queue ?? null) as T;
      case 'player_queues/items': return (f.queueItems ?? []) as T;
      case 'music/playlists/library_items': return (args.favorite ? f.favoritePlaylists ?? [] : f.playlists ?? []) as T;
      case 'music/radios/library_items': return (f.radios ?? []) as T;
      case 'music/recently_played_items': return (f.recent ?? []) as T;
      case 'music/search': return (f.search ?? {}) as T;
      default: return null as T;
    }
  }

  onEvent(listener: (event: MaEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: MaStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  imageUrl(): string | null {
    return null;
  }

  close(): void {
    this.setStatus('closed');
  }

  emit(event: MaEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  setStatus(status: MaStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  update(fixtures: Partial<FakeMaFixtures>): void {
    Object.assign(this.fixtures, fixtures);
  }
}

export function installSendspinDevApi({ sendspinRef, setSendspin, setMa }: {
  sendspinRef: { current: SendspinSession | null };
  setSendspin: Dispatch<SetStateAction<SendspinState>>;
  setMa: Dispatch<SetStateAction<MusicAssistantApi | null>>;
}): () => void {
  const calls = { sendspin: [] as Call[], ma: [] as Call[] };
  let progress: TrackProgress | null = null;
  let fakeMa: FakeMusicAssistant | null = null;

  const session: SendspinSession = {
    command: (command, params) => {
      calls.sendspin.push({ command, args: params });
      return true;
    },
    seek: positionMs => {
      calls.sendspin.push({ command: 'seek', args: { position_ms: positionMs } });
      return true;
    },
    get trackProgress() {
      return progress;
    },
    cleanup: () => {},
  };

  const api = {
    inject({ state, progress: p = null, ma = null }: { state?: Partial<SendspinState>; progress?: TrackProgress | null; ma?: FakeMaFixtures | null } = {}) {
      progress = p;
      sendspinRef.current = session;
      setSendspin({ ...initialSendspinState, active: true, playerId: 'test-player', supportedCmds: ALL_COMMANDS, ...state });
      fakeMa?.close();
      fakeMa = ma ? new FakeMusicAssistant(ma, calls.ma) : null;
      setMa(fakeMa);
    },
    setState(patch: Partial<SendspinState>) {
      setSendspin(prev => ({ ...prev, ...patch }));
    },
    setProgress(p: TrackProgress | null) {
      progress = p;
    },
    updateMa(fixtures: Partial<FakeMaFixtures>) {
      fakeMa?.update(fixtures);
    },
    emitMaEvent(event: MaEvent) {
      fakeMa?.emit(event);
    },
    setMaStatus(status: MaStatus) {
      fakeMa?.setStatus(status);
    },
    calls: () => JSON.parse(JSON.stringify(calls)) as typeof calls,
  };

  const g = window as unknown as { __voltvizSendspin?: typeof api };
  g.__voltvizSendspin = api;
  return () => {
    if (g.__voltvizSendspin === api) delete g.__voltvizSendspin;
    fakeMa?.close();
  };
}
