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

  it('beat strength: full on kicks, low on a sidechain-pumped pad without a hit, back within beats on the drop', () => {
    const period = 60 / 128;
    const s = synth([
      { seconds: 20, bpm: 128, kick: true, hats: 'offbeat', clap: true },
      { seconds: 16, bpm: 128, pad: true, noise: 0.02 },
      { seconds: 12, bpm: 128, kick: true, hats: 'offbeat', clap: true },
    ]);
    // a build-up: the pad ducks on every beat and swells back (sidechain pumping), no drum hit
    for (let i = Math.round(20 * s.sampleRate); i < 36 * s.sampleRate; i++) {
      const since = (i / s.sampleRate) % period;
      s.samples[i] *= 1 - 0.8 * Math.exp(-since / 0.15);
    }
    const a = new Analyzer(s.sampleRate);
    const beats: { time: number; strength: number }[] = [];
    for (let i = 0; i < s.samples.length; i += 128) {
      a.process(s.samples.subarray(i, i + 128));
      for (const e of a.drainEvents()) if (e.type === 'beat') beats.push(e);
    }
    const strengths = (t0: number, t1: number) => beats.filter(b => b.time >= t0 && b.time < t1).map(b => b.strength);
    expect(median(strengths(8, 20))).toBeGreaterThan(0.8);
    const build = strengths(26, 36);
    expect(build.length).toBeGreaterThan(8); // the clock keeps running through the build-up
    expect(median(build)).toBeLessThan(0.3);
    expect(Math.min(...strengths(36 + 2.5 * period, 48))).toBeGreaterThan(0.7);
  });

  it('hits: fire only on heard kicks on the beat, never between beats, and stop with the drums', () => {
    const s = synth([
      { seconds: 20, bpm: 128, kick: true, hats: 'offbeat', rollingBass: true },
      { seconds: 12, bpm: 128, pad: true },
      { seconds: 12, bpm: 128, kick: true, hats: 'offbeat' },
    ]);
    const a = new Analyzer(s.sampleRate);
    const hits: number[] = [];
    for (let i = 0; i < s.samples.length; i += 128) {
      a.process(s.samples.subarray(i, i + 128));
      for (const e of a.drainEvents()) if (e.type === 'hit') hits.push(e.time);
    }
    // every hit is a real kick (nothing predicted, nothing on the rolling bass between the kicks)
    const kicks = s.beats;
    for (const t of hits) expect(Math.min(...kicks.map(k => Math.abs(k - t)))).toBeLessThan(0.03);
    expect(fMeasure(after(kicks, 8, 20), after(hits, 8, 20))).toBeGreaterThan(0.95);
    // the pad breakdown has no hit, so no beat: not even the first beat after the drums stop
    expect(after(hits, 20.05, 32)).toHaveLength(0);
    // and the beats come back with the kicks
    expect(fMeasure(after(kicks, 36), after(hits, 36))).toBeGreaterThan(0.9);
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

  it('searches the phase again after a song change (same tempo, half a beat later)', () => {
    const p = 60 / 128;
    const a1 = synth([{ seconds: 42.5 * p, bpm: 128, kick: true, hats: 'offbeat', clap: true }]);
    const a2 = synth([{ seconds: 16, bpm: 128, kick: true, clap: true }], 44100, 2);
    const cut = a1.samples.length / 44100;
    const x = new Float32Array(a1.samples.length + a2.samples.length);
    x.set(a1.samples);
    x.set(a2.samples, a1.samples.length);
    const a = new Analyzer(44100);
    const beats: number[] = [];
    let told = false;
    for (let i = 0; i < x.length; i += 128) {
      a.process(x.subarray(i, i + 128));
      for (const e of a.drainEvents()) if (e.type === 'beat' && e.confidence >= 0.3) beats.push(e.time);
      if (!told && a.state.time >= cut) {
        a.songChanged(); // e.g. the Sendspin track changed
        told = true;
      }
    }
    // without the song change the clock stays on the old phase for ~6 s (relock votes)
    const ref = a2.beats.map(b => b + cut);
    expect(fMeasure(after(ref, cut + 3, cut + 10), after(beats, cut + 3, cut + 10))).toBeGreaterThan(0.9);
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
  it('retimes a clock stuck on a 4:3 relative, but not one its own estimate backs', () => {
    // clock at 103 BPM (0.582 s) while the DSP estimate says 154 and the network 77: stuck
    const w = act(beatsAt(0.779, 0.1));
    expect(evaluateWindow(w, { period: 0.582, nextBeatTime: 10.2, confidence: 0.9, estimatePeriod: 0.39 }).kind).toBe('retime');
    // clock and DSP estimate agree on 133: the network's 4:3 tempo is the network's error
    expect(evaluateWindow(act(beatsAt(0.6, 0.1)), { period: 0.451, nextBeatTime: 10.2, confidence: 0.2, estimatePeriod: 0.451 }).kind).toBe('none');
  });
  it('follows gradual tempo changes itself, unless the clock is lost and unbacked', () => {
    const w = act(beatsAt(0.5, 0.1));
    // 10 % apart and not metrical: a confident clock keeps its tempo (DSP follows tempo changes) ...
    expect(evaluateWindow(w, { period: 0.55, nextBeatTime: 10.1, confidence: 0.9, estimatePeriod: 0.7 }).kind).toBe('none');
    // ... a lost clock its own estimate does not back is retimed to the network's consistent tempo
    expect(evaluateWindow(w, { period: 0.55, nextBeatTime: 10.1, confidence: 0.1, estimatePeriod: 0.7 }).kind).toBe('retime');
  });
  it('a confirm locks the phase for 12 s and the tempo octave for 30 s; reset clears both', () => {
    const arb = new NeuralArbiter();
    expect(arb.decide(act(beatsAt(0.5, 0.1)), { period: 0.5, nextBeatTime: 10.1 }, 10).kind).toBe('confirm');
    expect(arb.lockUntil).toBeCloseTo(22, 6);
    expect(arb.octaveLockUntil).toBeCloseTo(40, 6);
    arb.reset();
    expect(arb.lockUntil).toBeLessThan(0);
    expect(arb.octaveLockUntil).toBeLessThan(0);
  });
  it('shifts on one clear window, but needs two to undo the phase the previous window confirmed', () => {
    const offBeat = act(beatsAt(0.5, 0.1));
    const clock = { period: 0.5, nextBeatTime: 10.35 };
    expect(new NeuralArbiter().decide(offBeat, clock, 10).kind).toBe('shift');
    const arb = new NeuralArbiter();
    expect(arb.decide(act(beatsAt(0.5, 0.35)), clock, 10).kind).toBe('confirm');
    expect(arb.decide(offBeat, clock, 15).kind).toBe('none');
    expect(arb.decide(offBeat, clock, 20).kind).toBe('shift');
  });
  it('ignores the old song in a window requested before a song change', () => {
    const s = synth([{ seconds: 20, bpm: 120, kick: true, hats: 'offbeat', clap: true }]);
    const decide = (songChange: boolean) => {
      const a = new Analyzer(44100, { neural: true });
      for (let i = 0; i < s.samples.length; i += 128) a.process(s.samples.subarray(i, i + 128));
      const t0 = a.state.time - 10;
      const w = act(s.beats.filter(b => b >= t0), t0);
      if (songChange) a.songChanged();
      return a.applyNeural(w.t0, w.activation, t0)?.kind;
    };
    expect(decide(false)).toBe('confirm');
    expect(decide(true)).toBe('none'); // nothing of the new song in the window yet
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
