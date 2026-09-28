/**
 * Deterministic synthetic drum patterns with exactly known beat times, for unit tests.
 */
export interface Section {
  /** Duration (s). */
  seconds: number;
  bpm: number;
  kick?: boolean; // four-on-the-floor kick (pitch sweep + click)
  hats?: 'offbeat' | 'sixteenths' | false;
  clap?: boolean; // beats 2 and 4
  rollingBass?: boolean; // bass notes on the 2nd-4th sixteenth of every beat (K-B-B-B)
  pad?: boolean; // sustained chord (breakdowns)
  noise?: number; // white-noise level
  gain?: number;
  halftime?: boolean; // half-time drums: kick on beat 1, snare on beat 3 of every four (dubstep, trap)
  backbeat?: boolean; // rock/pop drums: kick on beats 1 and 3, snare on 2 and 4
  strum?: boolean; // a strummed guitar-like chord on every beat, no drums
  drift?: number; // relative tempo change over the section (0.03: 3 % faster by its end)
  brightHats?: boolean; // hats high-passed like real hi-hats (little energy below 6 kHz)
}

export interface Synth {
  samples: Float32Array;
  sampleRate: number;
  /** True beat times (s) of sections that have an audible pulse (kick, clap, drums or strums). */
  beats: number[];
  /** The beats beat effects should follow: every other beat (kick + snare) in half-time sections. */
  pulses: number[];
  /** All grid beat times, audible or not. */
  grid: number[];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

export function synth(sections: Section[], sampleRate = 44100, seed = 1): Synth {
  const total = sections.reduce((a, s) => a + s.seconds, 0);
  const n = Math.round(total * sampleRate);
  const x = new Float32Array(n);
  const rand = rng(seed);
  const beats: number[] = [];
  const pulses: number[] = [];
  const grid: number[] = [];

  const add = (t0: number, dur: number, fn: (t: number) => number, gain: number) => {
    const a = Math.round(t0 * sampleRate);
    const b = Math.min(n, a + Math.round(dur * sampleRate));
    for (let i = Math.max(0, a); i < b; i++) x[i] += gain * fn((i - a) / sampleRate);
  };
  const kick = (t: number) => {
    // pitch sweep 160 -> 50 Hz, body decay 150 ms, 2 ms click
    const f0 = 50, f1 = 160, k = 30;
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) / k) * (1 - Math.exp(-k * t)));
    return 0.9 * Math.sin(phase) * Math.exp(-t / 0.15) + (t < 0.002 ? 0.5 * rand() : 0);
  };
  const hat = (t: number) => rand() * Math.exp(-t / 0.02);
  // second difference of white noise: +12 dB/octave, ~-34 dB at 1 kHz relative to the top
  const brightHat = () => {
    let p1 = 0, p2 = 0;
    return (t: number) => {
      const n = rand();
      const y = n - 2 * p1 + p2;
      p2 = p1;
      p1 = n;
      return 0.5 * y * Math.exp(-t / 0.02);
    };
  };
  const clap = (t: number) => rand() * Math.exp(-t / 0.05) * (1 + Math.sin(2 * Math.PI * 1200 * t));
  const bass = (t: number) => Math.sin(2 * Math.PI * 55 * t) * Math.min(1, t / 0.005) * Math.exp(-t / 0.08);
  // six strings, 8 ms apart (a down-strum), plucked-string decay
  const strum = (t: number) => {
    let v = 0;
    const freqs = [82.4, 123.5, 164.8, 207.7, 246.9, 329.6];
    for (let k = 0; k < freqs.length; k++) {
      const u = t - k * 0.008;
      if (u < 0) continue;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * freqs[k] * h * u) * Math.exp(-u / (0.5 / h)) / h;
    }
    return 0.12 * v * Math.min(1, t / 0.002);
  };

  let start = 0;
  let prevEnd = 0;
  for (const s of sections) {
    const g = s.gain ?? 0.5;
    const periodAt = (t: number) => 60 / (s.bpm * (1 + (s.drift ?? 0) * Math.max(0, t - start) / s.seconds));
    // continue the beat grid from the previous section
    let t = start === 0 ? 0 : prevEnd;
    while (t < start) t += periodAt(t);
    let beatNo = 0;
    for (; t < start + s.seconds - 1e-9; t += periodAt(t), beatNo++) {
      const period = periodAt(t);
      grid.push(t);
      const audible = s.kick || s.clap || s.halftime || s.backbeat || s.strum;
      if (audible) beats.push(t);
      if (audible && (!s.halftime || beatNo % 2 === 0)) pulses.push(t);
      if (s.kick) add(t, 0.4, kick, g);
      if (s.clap && beatNo % 2 === 1) add(t, 0.2, clap, g * 0.4);
      if (s.halftime) {
        if (beatNo % 4 === 0) add(t, 0.4, kick, g);
        if (beatNo % 4 === 2) add(t, 0.2, clap, g * 0.6);
      }
      if (s.backbeat) {
        if (beatNo % 2 === 0) add(t, 0.4, kick, g);
        else add(t, 0.2, clap, g * 0.6);
      }
      if (s.strum) add(t, 1.2, strum, g);
      if (s.hats === 'offbeat') add(t + period / 2, 0.1, s.brightHats ? brightHat() : hat, g * 0.3);
      if (s.hats === 'sixteenths') for (let q = 1; q < 4; q++) add(t + (q * period) / 4, 0.06, s.brightHats ? brightHat() : hat, g * 0.2);
      if (s.rollingBass) for (let q = 1; q < 4; q++) add(t + (q * period) / 4, period / 4, bass, g * 0.6);
      prevEnd = t + period;
    }
    if (s.pad) add(start, s.seconds, u => 0.3 * (Math.sin(2 * Math.PI * 220 * u) + Math.sin(2 * Math.PI * 277 * u) + Math.sin(2 * Math.PI * 330 * u)) / 3, g);
    if (s.noise) add(start, s.seconds, () => rand(), s.noise);
    start += s.seconds;
  }
  return { samples: x, sampleRate, beats, pulses, grid };
}
