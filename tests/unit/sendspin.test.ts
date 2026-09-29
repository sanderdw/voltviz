import { describe, expect, it } from 'vitest';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import { hasTrack, mapSdkState, trackKey } from '../../src/audio/sources/sendspinState';
import { asRepeatMode, deriveBarStatus, favoritesFirst, formatTime, nextRepeatMode, playOption, seekMode, statusLabel, withPending, type PendingChange } from '../../src/app/sendspinView';
import type { MaMediaItem, MaPlayerQueue } from '../../src/audio/sources/musicAssistant';

const track: ServerStateMetadata = {
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  progress: { track_progress: 61000, track_duration: 185000, playback_speed: 1000 },
};

describe('mapSdkState', () => {
  it('maps metadata, controller and group state', () => {
    const patch = mapSdkState({
      isPlaying: true,
      serverState: { metadata: track, controller: { supported_commands: ['play', 'seek'], volume: 40, muted: true, seek_max_ms: 180000 } as never },
      groupState: { playback_state: 'playing', group_name: 'Living room' },
    });
    expect(patch).toEqual({
      playing: true,
      metadata: track,
      supportedCmds: ['play', 'seek'],
      seekMaxMs: 180000,
      volume: 40,
      muted: true,
      repeat: null,
      shuffle: null,
      groupPlayback: 'playing',
      groupName: 'Living room',
    });
  });

  it('takes repeat and shuffle from the controller, or from the metadata of an older server', () => {
    const older = mapSdkState({ isPlaying: true, serverState: { metadata: { ...track, repeat: 'one', shuffle: true } } });
    expect([older.repeat, older.shuffle]).toEqual(['one', true]);
    const current = mapSdkState({
      isPlaying: true,
      serverState: { metadata: { ...track, repeat: 'one', shuffle: true }, controller: { repeat: 'all', shuffle: false } as never },
    });
    expect([current.repeat, current.shuffle]).toEqual(['all', false]);
  });

  it('clears the track when the server removed the metadata', () => {
    // The SDK deletes keys the server sets to null, so metadata is simply gone
    const patch = mapSdkState({ isPlaying: false, serverState: { controller: { supported_commands: ['play'] } }, groupState: {} });
    expect(patch.metadata).toBeNull();
    expect(patch.groupPlayback).toBeNull();
  });

  it('treats a metadata object without title and artist as no track', () => {
    const patch = mapSdkState({ isPlaying: false, serverState: { metadata: { album: null, repeat: 'off' } } });
    expect(hasTrack(patch.metadata)).toBe(false);
    expect(trackKey(patch.metadata)).toBeNull();
  });

  it('has no supported commands, volume or mute without controller state', () => {
    const patch = mapSdkState({ isPlaying: false, serverState: {} });
    expect(patch.supportedCmds).toEqual([]);
    expect(patch.seekMaxMs).toBeNull();
    expect('volume' in patch).toBe(false);
    expect('muted' in patch).toBe(false);
  });
});

describe('trackKey', () => {
  it('identifies a track by artist and title', () => {
    expect(trackKey(track)).toBe('Artist\u0000Song');
    expect(trackKey({ title: 'Radio 1' })).toBe('\u0000Radio 1');
    expect(trackKey(null)).toBeNull();
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [61000, '1:01'],
    [185000, '3:05'],
    [3679000, '1:01:19'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
  ])('%s ms -> %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text);
  });
});

describe('deriveBarStatus', () => {
  const base = { reconnectAttempt: 0, metadata: track, groupPlayback: null, playing: false } as const;
  const paused = { ...track, progress: { track_progress: 61000, track_duration: 185000, playback_speed: 0 } };
  const stopped = { ...track, progress: { track_progress: 0, track_duration: 185000, playback_speed: 0 } };

  it.each([
    ['reconnecting wins', { ...base, reconnectAttempt: 2 }, 'reconnecting'],
    ['no track is idle', { ...base, metadata: null }, 'idle'],
    ['cleared fields are idle', { ...base, metadata: { repeat: 'off' as const } }, 'idle'],
    ['Music Assistant playing', { ...base, metadata: paused, queueState: 'playing' }, 'playing'],
    ['Music Assistant paused', { ...base, queueState: 'paused' }, 'paused'],
    ['Music Assistant idle is stopped', { ...base, queueState: 'idle' }, 'stopped'],
    ['progress running', base, 'playing'],
    ['progress halted mid-track', { ...base, metadata: paused }, 'paused'],
    ['progress halted at the start', { ...base, metadata: stopped }, 'stopped'],
    ['no progress, group playing', { ...base, metadata: { title: 'Song' }, groupPlayback: 'playing' as const }, 'playing'],
    ['no progress, stream playing', { ...base, metadata: { title: 'Song' }, playing: true }, 'playing'],
    ['no progress, nothing playing', { ...base, metadata: { title: 'Song' }, groupPlayback: 'stopped' as const }, 'stopped'],
  ])('%s', (_name, input, status) => {
    expect(deriveBarStatus(input)).toBe(status);
  });

  it('labels the states that need one', () => {
    expect(statusLabel('reconnecting', 3)).toBe('Reconnecting (3/10)…');
    expect(statusLabel('paused', 0)).toBe('Paused');
    expect(statusLabel('stopped', 0)).toBe('Stopped');
    expect(statusLabel('playing', 0)).toBeNull();
    expect(statusLabel('idle', 0)).toBeNull();
  });
});

describe('seekMode', () => {
  it('prefers Sendspin, falls back to the Music Assistant queue, never on live streams', () => {
    expect(seekMode({ supportedCmds: ['seek'], durationMs: 185000, maQueue: true })).toBe('sendspin');
    expect(seekMode({ supportedCmds: ['play'], durationMs: 185000, maQueue: true })).toBe('ma');
    expect(seekMode({ supportedCmds: ['play'], durationMs: 185000, maQueue: false })).toBeNull();
    expect(seekMode({ supportedCmds: ['seek'], durationMs: 0, maQueue: true })).toBeNull();
  });
});

describe('shuffle and repeat', () => {
  it('cycles repeat off → all → one → off', () => {
    expect(nextRepeatMode('off')).toBe('all');
    expect(nextRepeatMode('all')).toBe('one');
    expect(nextRepeatMode('one')).toBe('off');
    expect(asRepeatMode('ALL')).toBe('off');
    expect(asRepeatMode(undefined)).toBe('off');
  });

  it('shows a change until the server sends new state or reports another value', () => {
    const before = { title: 'Song' };
    const pending: PendingChange<boolean> = { value: true, base: false, revision: before };
    // Music Assistant has not sent anything since the click
    expect(withPending(false, before, pending)).toBe(true);
    // The server sent new state: that is what it has now, whatever it is
    expect(withPending(false, { title: 'Next song' }, pending)).toBe(false);
    expect(withPending(true, { title: 'Next song' }, pending)).toBe(true);
    // The server reported a different value on the same state
    const repeat: PendingChange<string> = { value: 'all', base: 'off', revision: before };
    expect(withPending('one', before, repeat)).toBe('one');
    expect(withPending('off', before, null)).toBe('off');
  });
});

describe('playOption', () => {
  const item = { queue_id: 'q', queue_item_id: 'i', name: 'Song' };
  it('replaces an empty or finished queue and otherwise keeps it', () => {
    expect(playOption(null)).toBe('replace');
    expect(playOption({ queue_id: 'q', active: true, items: 0 })).toBe('replace');
    expect(playOption({ queue_id: 'q', active: true, items: 3, current_item: null })).toBe('replace');
    expect(playOption({ queue_id: 'q', active: true, items: 3, current_item: item } as MaPlayerQueue)).toBe('play');
  });
});

describe('favoritesFirst', () => {
  const item = (uri: string): MaMediaItem => ({ item_id: uri, provider: 'library', name: uri, uri, media_type: 'playlist' });
  it('lists favorites first and every item once', () => {
    const result = favoritesFirst([item('b')], [item('a'), item('b'), item('c')]);
    expect(result.map(i => i.uri)).toEqual(['b', 'a', 'c']);
  });
});
