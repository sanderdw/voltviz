import { describe, expect, it } from 'vitest';
import { Analyzer, type AnalyzerEvent } from '../../src/audio/core/Analyzer';
import { FFT } from '../../src/audio/core/fft';
import { LevelTracker } from '../../src/audio/core/levels';
import { evaluateWindow, NeuralArbiter } from '../../src/audio/core/neuralArbiter';
import { Resampler } from '../../src/audio/neural/resampler';
import { melFilterbank } from '../../src/audio/neural/melFrontend';
import { amlt, fMeasure, median, offsetsMs } from '../../scripts/eval/lib/metrics';
import { synth, type Section } from './synth';

function run(sections: Section[], sampleRate = 44100, seed = 1) {
  const s = synth(sections, sampleRate, seed);
  const a = new Analyzer(sampleRate);
  const events: AnalyzerEvent[] = [];
  const timeline: { t: number; bpm: number; conf: number; silent: boolean }[] = [];
  for (let i = 0; i < s.samples.length; i += 128) {
    a.process(s.samples.subarray(i, i + 128));
    events.push(...a.drainEvents());
    if (i % 4410 < 128) timeline.push({ t: a.state.time, bpm: a.state.bpm, conf: a.state.confidence, silent: a.state.silent });
  }
  const beats = events.filter(e => e.type === 'beat' && e.confidence >= 0.3).map(e => e.time);
  return { s, a, events, beats, timeline };
}

const after = (xs: number[], t0: number, t1 = Infinity) => xs.filter(x => x >= t0 && x < t1);

describe('FFT', () => {
  it('matches a direct DFT', () => {
    const n = 64;
    const fft = new FFT(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7) + (i % 5) * 0.1);
    x.forEach((v, i) => (re[i] = v));
    fft.transform(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0, j = 0;
      for (let t = 0; t < n; t++) {
        r += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
        j += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(j, 9);
    }
  });
});

describe('beat tracking on synthetic four-on-the-floor patterns', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const bpm of [100, 120, 128, 140, 150, 174]) {
      it(`${bpm} BPM @ ${sampleRate} Hz: tempo within 1% and beats on time`, () => {
        const { s, beats, a } = run([{ seconds: 24, bpm, kick: true, hats: 'offbeat', clap: true }], sampleRate);
        expect(Math.abs(a.state.bpm / bpm - 1)).toBeLessThan(0.01);
        const ref = after(s.beats, 6);
        const est = after(beats, 6);
        expect(fMeasure(ref, est)).toBeGreaterThan(0.95);
        expect(Math.abs(median(offsetsMs(ref, est)))).toBeLessThan(15);
      });
    }
  }

  it('80 BPM: tempo at the beat or double-time level (dance-music prior), beats in time after settling', () => {
    // slow tempi may start at double time and settle once the tempo window is full
    const { s, beats, a } = run([{ seconds: 30, bpm: 80, kick: true, hats: 'offbeat', clap: true }]);
    const r = a.state.bpm / 80;
    expect(Math.min(Math.abs(r - 1), Math.abs(r - 2))).toBeLessThan(0.01);
    expect(amlt(after(s.beats, 15), after(beats, 15))).toBeGreaterThan(0.9);
  });

  it('does not double the tempo on sixteenth-note hats', () => {
    const { a } = run([{ seconds: 24, bpm: 126, kick: true, hats: 'sixteenths' }]);
    expect(Math.abs(a.state.bpm / 126 - 1)).toBeLessThan(0.01);
  });

  it('keeps the phase on the kick with a rolling (K-B-B-B) bassline', () => {
    const { s, beats } = run([{ seconds: 30, bpm: 140, kick: true, rollingBass: true, hats: 'offbeat', clap: true }]);
    expect(fMeasure(after(s.beats, 8), after(beats, 8))).toBeGreaterThan(0.95);
  });

  it('follows a tempo change 124 -> 128 BPM within 4 s', () => {
    const { s, beats } = run([
      { seconds: 20, bpm: 124, kick: true, hats: 'offbeat', clap: true },
      { seconds: 20, bpm: 128, kick: true, hats: 'offbeat', clap: true },
    ]);
    expect(fMeasure(after(s.beats, 24, 40), after(beats, 24, 40))).toBeGreaterThan(0.95);
  });

  it('runs through a 16 s breakdown with decaying confidence and re-locks on the drop', () => {
    const { s, beats, timeline } = run([
      { seconds: 20, bpm: 128, kick: true, hats: 'offbeat', clap: true },
      { seconds: 16, bpm: 128, pad: true },
      { seconds: 20, bpm: 128, kick: true, hats: 'offbeat', clap: true },
    ]);
    const late = timeline.filter(p => p.t > 32 && p.t < 36);
    expect(Math.max(...late.map(p => p.conf))).toBeLessThan(0.5);
    const inBreak = after(beats, 22, 36).length;
    expect(inBreak).toBeLessThan(16); // not confidently beating through the whole break
    expect(fMeasure(after(s.beats, 40), after(beats, 40))).toBeGreaterThan(0.95);
  });

  it('produces no confident beats for silence or white noise', () => {
    const silence = run([{ seconds: 15, bpm: 120 }]);
    expect(silence.beats.length).toBe(0);
    expect(silence.a.state.silent).toBe(true);
    const noise = run([{ seconds: 20, bpm: 120, noise: 0.3 }]);
    expect(after(noise.beats, 5).length).toBeLessThan(4);
  });

  it('emits kick onsets close to the true kick times', () => {
    const { s, events } = run([{ seconds: 20, bpm: 128, kick: true }]);
    const kicks = events.filter(e => e.type === 'kick').map(e => e.time);
    const ref = after(s.beats, 3);
    expect(fMeasure(ref, after(kicks, 3), 0.05)).toBeGreaterThan(0.9);
    expect(Math.abs(median(offsetsMs(ref, after(kicks, 3), 0.05)))).toBeLessThan(15);
  });
});

describe('Auto Gain (level tracker)', () => {
  it('converges towards the target, respects the bounds and freezes on silence', () => {
    const fr = 172;
    const lt = new LevelTracker({ frameRate: fr, targetDb: -14, minGainDb: -6, maxGainDb: 24 });
    const quiet = Math.pow(10, -34 / 20);
    for (let i = 0; i < fr * 15; i++) lt.update(quiet, quiet * 1.4);
    expect(20 * Math.log10(lt.gain)).toBeGreaterThan(18);
    expect(20 * Math.log10(lt.gain)).toBeLessThanOrEqual(20.01);
    const g = lt.gain;
    for (let i = 0; i < fr * 10; i++) lt.update(0, 0);
    expect(lt.silent).toBe(true);
    expect(lt.gain).toBeCloseTo(g, 6);
    const tiny = Math.pow(10, -55 / 20);
    const lt2 = new LevelTracker({ frameRate: fr, maxGainDb: 24 });
    for (let i = 0; i < fr * 30; i++) lt2.update(tiny, tiny);
    expect(20 * Math.log10(lt2.gain)).toBeLessThanOrEqual(24.001);
  });
});

describe('neural arbiter', () => {
  const act = (beatTimes: number[], t0 = 0, seconds = 10) => {
    const a = new Float32Array(seconds * 50);
    for (const b of beatTimes) {
      const i = Math.round((b - t0) * 50);
      if (i >= 0 && i < a.length) { a[i] = 0.95; if (i > 0) a[i - 1] = 0.3; if (i + 1 < a.length) a[i + 1] = 0.3; }
    }
    return { t0, fps: 50, activation: a };
  };
  const beatsAt = (period: number, phase: number) => Array.from({ length: 40 }, (_, k) => phase + k * period).filter(t => t < 10);

  it('confirms a clock that is on the beat', () => {
    const d = evaluateWindow(act(beatsAt(0.5, 0.1)), { period: 0.5, nextBeatTime: 10.1 });
    expect(d.kind).toBe('confirm');
  });
  it('detects an off-beat clock and asks for a half-period shift', () => {
    const d = evaluateWindow(act(beatsAt(0.5, 0.1)), { period: 0.5, nextBeatTime: 10.35 });
    expect(d.kind).toBe('shift');
    if (d.kind === 'shift') expect(Math.abs(Math.abs(d.shiftSeconds) - 0.25)).toBeLessThan(0.02);
  });
  it('ignores small timing offsets (the DSP loop owns fine timing)', () => {
    const d = evaluateWindow(act(beatsAt(0.5, 0.1)), { period: 0.5, nextBeatTime: 10.14 });
    expect(d.kind).toBe('confirm');
  });
  it('retimes an octave error only after two agreeing windows', () => {
    const arb = new NeuralArbiter();
    const w = act(beatsAt(0.46, 0.0));
    const clock = { period: 0.92, nextBeatTime: 10.12 };
    expect(arb.decide(w, clock, 10).kind).toBe('none');
    expect(arb.decide(w, clock, 12.5).kind).toBe('none'); // overlapping window: not independent evidence
    expect(arb.decide(w, clock, 15).kind).toBe('retime');
  });
});

describe('neural front end', () => {
  it('resampler preserves DC and a 1 kHz sine amplitude (44.1 -> 22.05 kHz)', () => {
    const r = new Resampler(44100, 22050);
    const out: number[] = [];
    const x = Float64Array.from({ length: 44100 }, (_, i) => 0.25 + 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 44100));
    r.push(x, x.length, v => out.push(v));
    const tail = out.slice(2000, 20000);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const amp = Math.max(...tail.map(v => Math.abs(v - mean)));
    expect(mean).toBeCloseTo(0.25, 3);
    expect(amp).toBeCloseTo(0.5, 2);
  });
  it('mel filterbank has 128 triangular filters covering 30 Hz - 11 kHz', () => {
    const fb = melFilterbank();
    expect(fb.weights.length).toBe(128);
    for (const w of fb.weights) expect(Math.max(...w)).toBeGreaterThan(0.2);
    expect(fb.start[0]).toBeGreaterThanOrEqual(1);
    expect(fb.start[127] + fb.weights[127].length).toBeLessThanOrEqual(513);
  });
});
