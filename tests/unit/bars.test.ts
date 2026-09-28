import { describe, expect, it } from 'vitest';
import { BarTracker, barScores, type ClockBeat } from '../../src/audio/core/bars';
import { SongChangeDetector } from '../../src/audio/core/songChange';

/** A 10 s downbeat activation (50 fps) with peaks at the given times. */
function act(times: number[], t0 = 0) {
  const a = new Float32Array(500);
  for (const t of times) {
    const i = Math.round((t - t0) * 50);
    if (i >= 0 && i < a.length) a[i] = 0.9;
  }
  return { t0, fps: 50, activation: a };
}
/** Clock beats every 0.5 s from 1 s, running indices from `first`. */
const clockBeats = (first: number): ClockBeat[] => Array.from({ length: 17 }, (_, k) => ({ time: 1 + k * 0.5, index: first + k }));

describe('bar position from downbeats', () => {
  // downbeats on the clock beats whose index is 2 mod 4 (index 102 at 1.0 s, 106 at 3.0 s, ...)
  const downs = [1, 3, 5, 7, 9];

  it('finds which beat index is the "1"', () => {
    const s = barScores(act(downs), clockBeats(102));
    expect(s.mean[2]).toBeGreaterThan(0.8);
    expect(Math.max(s.mean[0], s.mean[1], s.mean[3])).toBeLessThan(0.1);
    const b = new BarTracker();
    b.update(act(downs), clockBeats(102), 0);
    expect(b.phase).toBe(2);
    expect(b.validFor(0)).toBe(true);
    expect(b.validFor(1)).toBe(false); // after a clock jump the position is stale
  });

  it('changes an established position only after two windows agree, but at once after a clock jump', () => {
    const b = new BarTracker();
    b.update(act(downs), clockBeats(102), 0);
    // the downbeats now fall on index 3 mod 4 (one beat later)
    const later = downs.map(t => t + 0.5).filter(t => t < 9.5);
    b.update(act(later), clockBeats(102), 0);
    expect(b.phase).toBe(2);
    b.update(act(later), clockBeats(102), 0);
    expect(b.phase).toBe(3);
    b.update(act(downs), clockBeats(102), 1); // jump: take the new window at once
    expect(b.phase).toBe(2);
  });

  it('keeps the position unknown without clear downbeats', () => {
    const b = new BarTracker();
    b.update(act([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]), clockBeats(0), 0); // a "downbeat" on every beat
    expect(b.phase).toBe(-1);
  });
});

describe('song change detection', () => {
  const fr = 172;
  const bandsA = new Float64Array(30).fill(2);
  const bandsB = Float64Array.from({ length: 30 }, (_, i) => (i < 15 ? 0.5 : 3.5));
  /** Feed `seconds` of frames; returns the times of detected changes. */
  const feed = (d: SongChangeDetector, t0: number, seconds: number, o: { silent?: boolean; bands: Float64Array; raw: number; clock: number }) => {
    const hits: number[] = [];
    for (let i = 0; i < seconds * fr; i++) {
      const t = t0 + i / fr;
      if (d.update(t, !!o.silent, o.bands, o.raw, o.clock)) hits.push(t);
    }
    return hits;
  };

  it('fires after a gap of silence', () => {
    const d = new SongChangeDetector(fr, 30);
    expect(feed(d, 0, 30, { bands: bandsA, raw: 128, clock: 128 })).toEqual([]);
    feed(d, 30, 1, { silent: true, bands: bandsA, raw: 0, clock: 128 });
    const hits = feed(d, 31, 2, { bands: bandsB, raw: 0, clock: 128 });
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeCloseTo(31, 1);
  });

  it('fires on a new sound with a new tempo, not on a new sound at the same tempo (a drop)', () => {
    const d = new SongChangeDetector(fr, 30);
    feed(d, 0, 30, { bands: bandsA, raw: 128, clock: 128 });
    expect(feed(d, 30, 10, { bands: bandsB, raw: 128, clock: 128 })).toEqual([]); // drop: same tempo
    const d2 = new SongChangeDetector(fr, 30);
    feed(d2, 0, 30, { bands: bandsA, raw: 128, clock: 128 });
    expect(feed(d2, 30, 10, { bands: bandsB, raw: 100, clock: 128 }).length).toBe(1);
  });

  it('ignores an octave disagreement and the first 20 s', () => {
    const d = new SongChangeDetector(fr, 30);
    feed(d, 0, 30, { bands: bandsA, raw: 128, clock: 128 });
    expect(feed(d, 30, 10, { bands: bandsB, raw: 64, clock: 128 })).toEqual([]);
    const d2 = new SongChangeDetector(fr, 30);
    feed(d2, 0, 5, { bands: bandsA, raw: 128, clock: 128 });
    expect(feed(d2, 5, 10, { bands: bandsB, raw: 100, clock: 128 })).toEqual([]);
  });
});
