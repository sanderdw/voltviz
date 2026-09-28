import { describe, expect, it } from 'vitest';
import { Analyzer, type AnalyzerEvent } from '../../src/audio/core/Analyzer';
import { foldPeriod, PulseSelector, type PulseMode } from '../../src/audio/core/beatTracker';
import type { StyleId } from '../../src/audio/core/styles';
import type { AudioFrame } from '../../src/audio/types';
import { beatHit } from '../../src/visualizers/lib/audio';
import { amlt, fMeasure, median, offsetsMs } from '../../scripts/eval/lib/metrics';
import { synth, type Section } from './synth';

function run(sections: Section[], style: StyleId, opts: { sampleRate?: number; switchTo?: { at: number; style: StyleId } } = {}) {
  const sampleRate = opts.sampleRate ?? 44100;
  const s = synth(sections, sampleRate);
  const a = new Analyzer(sampleRate, { style });
  const events: AnalyzerEvent[] = [];
  const timeline: { t: number; bpm: number; div: number }[] = [];
  let switched = false;
  for (let i = 0; i < s.samples.length; i += 128) {
    if (opts.switchTo && !switched && a.state.time >= opts.switchTo.at) {
      a.setStyle(opts.switchTo.style);
      switched = true;
    }
    a.process(s.samples.subarray(i, i + 128));
    events.push(...a.drainEvents());
    if (i % 4410 < 128) timeline.push({ t: a.state.time, bpm: a.state.bpm, div: a.state.pulseDivisor });
  }
  const confident = events.filter((e): e is Extract<AnalyzerEvent, { type: 'beat' }> => e.type === 'beat' && e.confidence >= 0.3);
  return {
    s, a, events, timeline,
    beats: confident.map(e => e.time),
    pulses: confident.filter(e => e.pulse).map(e => e.time),
    pulseBpm: a.state.bpm / a.state.pulseDivisor,
  };
}

const after = (xs: number[], t0: number, t1 = Infinity) => xs.filter(x => x >= t0 && x < t1);
const near = (x: number, target: number, tol = 0.02) => Math.abs(x / target - 1) < tol;

describe('half-time pulse', () => {
  for (const style of ['bass', 'auto'] as const) {
    it(`half-time drums at 140 BPM flash on kick and snare, a 70 BPM pulse (${style})`, () => {
      const r = run([{ seconds: 30, bpm: 140, halftime: true }], style);
      expect(near(r.pulseBpm, 70)).toBe(true);
      expect(fMeasure(after(r.s.pulses, 12), after(r.pulses, 12))).toBeGreaterThan(0.9);
      expect(Math.abs(median(offsetsMs(after(r.s.pulses, 12), after(r.pulses, 12))))).toBeLessThan(15);
    });
    it(`half-time drums with off-beat hi-hats keep the kick/snare pulse (${style})`, () => {
      const r = run([{ seconds: 30, bpm: 140, halftime: true, hats: 'offbeat', brightHats: true }], style);
      expect(near(r.pulseBpm, 70)).toBe(true);
      expect(fMeasure(after(r.s.pulses, 12), after(r.pulses, 12))).toBeGreaterThan(0.9);
    });
  }

  it('four-on-the-floor with claps on 2 and 4 keeps every beat (auto)', () => {
    const r = run([{ seconds: 30, bpm: 140, kick: true, clap: true, hats: 'offbeat' }], 'auto');
    expect(r.a.state.pulseDivisor).toBe(1);
    expect(after(r.pulses, 6).length).toBe(after(r.beats, 6).length);
    expect(fMeasure(after(r.s.beats, 6), after(r.pulses, 6))).toBeGreaterThan(0.95);
  });

  it('bass style: half-time drums with sixteenth hi-hats flash on kick and snare only', () => {
    const r = run([{ seconds: 30, bpm: 140, halftime: true, hats: 'sixteenths', brightHats: true }], 'bass');
    expect(near(r.pulseBpm, 70)).toBe(true);
    expect(fMeasure(after(r.s.pulses, 14), after(r.pulses, 14))).toBeGreaterThan(0.9);
  });

  it('a short half-time build-up in four-on-the-floor keeps every beat (auto)', () => {
    const groove: Section = { seconds: 16, bpm: 140, kick: true, clap: true, hats: 'offbeat' };
    const r = run([groove, { seconds: 5, bpm: 140, halftime: true, hats: 'offbeat' }, groove], 'auto');
    expect(Math.max(...r.timeline.map(p => p.div))).toBe(1);
  });

  it('four-on-the-floor with a rolling bassline keeps every beat (auto)', () => {
    const r = run([{ seconds: 30, bpm: 132, kick: true, rollingBass: true, hats: 'offbeat', clap: true }], 'auto');
    expect(Math.max(...r.timeline.filter(p => p.t > 6).map(p => p.div))).toBe(1);
  });

  it('kick on 1 and snare on 3 at 150 BPM: a 75 BPM pulse with the band style', () => {
    const r = run([{ seconds: 30, bpm: 150, halftime: true, hats: 'offbeat', brightHats: true }], 'band');
    expect(near(r.pulseBpm, 75)).toBe(true);
    expect(fMeasure(after(r.s.pulses, 12), after(r.pulses, 12))).toBeGreaterThan(0.9);
  });

  it('a rock backbeat at 120 BPM fires every beat (band, auto)', () => {
    for (const style of ['band', 'auto'] as const) {
      const r = run([{ seconds: 30, bpm: 120, backbeat: true, hats: 'offbeat' }], style);
      expect(near(r.pulseBpm, 120)).toBe(true);
      expect(fMeasure(after(r.s.beats, 8), after(r.pulses, 8))).toBeGreaterThan(0.95);
    }
  });
});

describe('PulseSelector', () => {
  const P = 74; // frames per beat (~140 BPM)
  /** Feed n beats; even beats get `even`, odd beats `odd` evidence. */
  const feed = (mode: PulseMode, even: { strength: number; kick: boolean; supported?: boolean }, odd: typeof even, n = 40) => {
    const p = new PulseSelector();
    p.mode = mode;
    for (let i = 0; i < n; i++) {
      const e = i % 2 === 0 ? even : odd;
      p.observe(1000 + i * P, { supported: e.supported ?? true, strength: e.strength, kick: e.kick }, P, true);
    }
    return p;
  };
  const kickSnare = { strength: 6, kick: true };
  const wobble = { strength: 5, kick: true }; // dubstep: onsets and bass rises on the in-between beats too

  it('half: always half-time, on the parity with the stronger accents', () => {
    const p = feed('half', kickSnare, wobble);
    expect(p.divisor).toBe(2);
    expect(p.isPulse(1000 + 40 * P, P)).toBe(true); // an even beat
    expect(p.isPulse(1000 + 41 * P, P)).toBe(false);
  });
  it('evidence (Auto): a kick on every beat keeps every beat, even with strong clap accents', () => {
    expect(feed('evidence', { strength: 9, kick: true }, { strength: 3, kick: true }).divisor).toBe(1);
  });
  it('evidence (Auto): nothing and no kick on the in-between beats goes half-time', () => {
    expect(feed('evidence', kickSnare, { strength: 0.5, kick: false, supported: false }).divisor).toBe(2);
  });
  it('lean: half-time when the accents alternate, not when they are even', () => {
    expect(feed('lean', kickSnare, { strength: 3, kick: false }).divisor).toBe(2);
    expect(feed('lean', kickSnare, { strength: 5.8, kick: true }).divisor).toBe(1);
  });
  it('every: never half-time', () => {
    expect(feed('every', kickSnare, { strength: 0.5, kick: false, supported: false }).divisor).toBe(1);
  });
  it('the parity only flips on clear, lasting evidence', () => {
    const p = feed('half', kickSnare, wobble);
    // accents swap sides for a few beats only: keep the parity
    for (let i = 40; i < 44; i++) p.observe(1000 + i * P, { supported: true, strength: i % 2 ? 6 : 5, kick: true }, P, true);
    expect(p.isPulse(1000 + 44 * P, P)).toBe(true);
  });
});

describe('style tempo ranges', () => {
  for (const style of ['hard', 'auto'] as const) {
    it(`hardcore kicks at 172 BPM are tracked at 172 (${style})`, () => {
      const r = run([{ seconds: 24, bpm: 172, kick: true, hats: 'offbeat' }], style);
      expect(near(r.a.state.bpm, 172, 0.01)).toBe(true);
      expect(fMeasure(after(r.s.beats, 8), after(r.pulses, 8))).toBeGreaterThan(0.95);
    });
  }

  it('210 BPM kicks are tracked at 210 with the hard style', () => {
    const r = run([{ seconds: 24, bpm: 210, kick: true, hats: 'offbeat' }], 'hard');
    expect(near(r.a.state.bpm, 210, 0.01)).toBe(true);
    expect(fMeasure(after(r.s.beats, 8), after(r.pulses, 8))).toBeGreaterThan(0.95);
  });

  it('electronic is the 0.23 engine: 80 BPM may run at double time, beats in time', () => {
    const r = run([{ seconds: 30, bpm: 80, kick: true, hats: 'offbeat', clap: true }], 'electronic');
    const ratio = r.a.state.bpm / 80;
    expect(Math.min(Math.abs(ratio - 1), Math.abs(ratio - 2))).toBeLessThan(0.01);
    expect(amlt(after(r.s.beats, 15), after(r.pulses, 15))).toBeGreaterThan(0.9);
  });

  it('a strummed ballad at 84 BPM is tracked at 84 with the chill style', () => {
    const r = run([{ seconds: 30, bpm: 84, strum: true }], 'chill');
    expect(near(r.a.state.bpm, 84)).toBe(true);
    expect(fMeasure(after(r.s.beats, 12), after(r.pulses, 12))).toBeGreaterThan(0.9);
  });

  it('follows a live-band tempo drift of +3 % over 30 s (band)', () => {
    const r = run([{ seconds: 30, bpm: 118, backbeat: true, hats: 'offbeat', drift: 0.03 }], 'band');
    expect(fMeasure(after(r.s.beats, 8), after(r.pulses, 8))).toBeGreaterThan(0.9);
  });

  it('switching the style at runtime folds the tempo and keeps beating (150 BPM -> chill: 75)', () => {
    const r = run([{ seconds: 30, bpm: 150, kick: true, hats: 'offbeat', clap: true }], 'auto', { switchTo: { at: 12, style: 'chill' } });
    expect(r.a.state.style).toBe('chill');
    expect(near(r.a.state.bpm, 75)).toBe(true);
    expect(amlt(after(r.s.beats, 16), after(r.pulses, 16))).toBeGreaterThan(0.9);
  });

  it('foldPeriod keeps an in-range tempo and picks the closest octave otherwise', () => {
    const fr = 172.265625;
    const bpm = (p: number) => (60 * fr) / p;
    const period = (b: number) => (60 * fr) / b;
    expect(bpm(foldPeriod(period(140), fr, 60, 200))).toBeCloseTo(140, 6);
    expect(bpm(foldPeriod(period(150), fr, 50, 140))).toBeCloseTo(75, 6);
    expect(bpm(foldPeriod(period(85), fr, 130, 230))).toBeCloseTo(170, 6);
    expect(bpm(foldPeriod(period(128), fr, 130, 230))).toBeCloseTo(128, 6); // no octave fits: 128 is closest
  });
});

describe('beatHit fallback', () => {
  const frame = (style: StyleId, kick: boolean, snare: boolean) => ({
    style,
    beat: { isBeat: false, confidence: 0 },
    onsets: { kick: { hit: kick }, snare: { hit: snare }, hat: { hit: false } },
  }) as unknown as AudioFrame;

  it('falls back to kick onsets for every style and to snare onsets for accent styles only', () => {
    expect(beatHit(frame('electronic', true, false))).toBe(true);
    expect(beatHit(frame('electronic', false, true))).toBe(false);
    expect(beatHit(frame('auto', false, true))).toBe(true);
    expect(beatHit(frame('chill', false, true))).toBe(true);
  });
});
