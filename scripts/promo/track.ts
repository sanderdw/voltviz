// Generated promo soundtrack: a deterministic 124 BPM house/trance track in A minor, synthesized
// from scratch (no samples), so the promo video can be published without licensing questions.
//
// Writes .cache/test-audio/promo-track.wav (served by the dev server at /__testaudio/) and
// .cache/promo/track.json with the bar grid and section starts every later stage cuts on.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from './paths.ts';

export const BPM = 124;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
const SR = 44100;

export type SectionName = 'intro' | 'build' | 'dropA' | 'breakdown' | 'build2' | 'dropB' | 'outro';
/** Bars per section, in order. */
export const SECTIONS: { name: SectionName; bars: number }[] = [
  { name: 'intro', bars: 4 },
  { name: 'build', bars: 4 },
  { name: 'dropA', bars: 12 },
  { name: 'breakdown', bars: 8 },
  { name: 'build2', bars: 2 },
  { name: 'dropB', bars: 6 },
  { name: 'outro', bars: 4 },
];
export const TOTAL_BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);
/** A short tail after the last bar so the final reverb/fade is not cut off. */
const TAIL = 1.5;

export interface TrackInfo {
  bpm: number;
  bar: number;
  duration: number;
  bars: number[];
  sections: { name: SectionName; bar: number; bars: number; start: number }[];
}

export function trackInfo(): TrackInfo {
  let bar = 0;
  const sections = SECTIONS.map(s => {
    const out = { name: s.name, bar, bars: s.bars, start: bar * BAR };
    bar += s.bars;
    return out;
  });
  return {
    bpm: BPM,
    bar: BAR,
    duration: TOTAL_BARS * BAR + TAIL,
    bars: Array.from({ length: TOTAL_BARS + 1 }, (_, i) => i * BAR),
    sections,
  };
}

function sectionAt(bar: number): { name: SectionName; pos: number; bars: number } {
  let start = 0;
  for (const s of SECTIONS) {
    if (bar < start + s.bars) return { name: s.name, pos: bar - start, bars: s.bars };
    start += s.bars;
  }
  return { name: 'outro', pos: 4, bars: 4 };
}

// ---------------------------------------------------------------------------------------------
// DSP building blocks

/** Mulberry32: tiny seeded PRNG, so the noise (and the file) is identical on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** PolyBLEP correction for a band-limited sawtooth. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

class Saw {
  phase: number;
  constructor(phase = 0) { this.phase = phase; }
  next(freq: number): number {
    const dt = freq / SR;
    const v = 2 * this.phase - 1 - polyBlep(this.phase, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}

/** Topology-preserving-transform state-variable filter (stable under fast cutoff sweeps). */
class Svf {
  ic1 = 0;
  ic2 = 0;
  low = 0;
  band = 0;
  high = 0;
  run(x: number, cutoff: number, q = 0.7): void {
    const g = Math.tan(Math.PI * Math.min(cutoff, SR * 0.45) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + g * a1 * v3;
    const v2 = this.ic2 + g * v1;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - k * v1 - v2;
  }
}

/** Freeverb-style stereo reverb (8 lowpass-feedback combs + 4 allpasses per side). */
class Reverb {
  private combs: { buf: Float32Array; i: number; store: number }[][];
  private aps: { buf: Float32Array; i: number }[][];
  private room = 0.84;
  private damp = 0.3;
  constructor() {
    const combLens = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const apLens = [556, 441, 341, 225];
    const make = (spread: number) => ({
      c: combLens.map(n => ({ buf: new Float32Array(n + spread), i: 0, store: 0 })),
      a: apLens.map(n => ({ buf: new Float32Array(n + spread), i: 0 })),
    });
    const l = make(0), r = make(23);
    this.combs = [l.c, r.c];
    this.aps = [l.a, r.a];
  }
  process(x: number, ch: 0 | 1): number {
    let out = 0;
    for (const c of this.combs[ch]) {
      const y = c.buf[c.i];
      c.store = y * (1 - this.damp) + c.store * this.damp;
      c.buf[c.i] = x + c.store * this.room;
      if (++c.i >= c.buf.length) c.i = 0;
      out += y;
    }
    for (const a of this.aps[ch]) {
      const b = a.buf[a.i];
      a.buf[a.i] = out + b * 0.5;
      out = b - out;
      if (++a.i >= a.buf.length) a.i = 0;
    }
    return out * 0.015;
  }
}

// ---------------------------------------------------------------------------------------------
// Arrangement

/** Am – F – C – G, one chord per bar. */
const CHORDS = [
  { bass: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  { bass: 29, pad: [57, 60, 65], arp: [65, 69, 72, 77] },
  { bass: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] },
  { bass: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
];
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 0, 3, 2, 1, 2, 0, 1, 3, 2];

export function renderTrack(): Float32Array[] {
  const info = trackInfo();
  const n = Math.ceil(info.duration * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const revL = new Float32Array(n), revR = new Float32Array(n); // reverb sends
  const noise = rng(124);

  const add = (buf: Float32Array, i: number, v: number) => { if (i >= 0 && i < n) buf[i] += v; };
  const s = (t: number) => Math.round(t * SR);

  // Which sections have which parts
  const has = {
    kick: new Set<SectionName>(['intro', 'build', 'dropA', 'build2', 'dropB', 'outro']),
    bass: new Set<SectionName>(['dropA', 'dropB']),
    clap: new Set<SectionName>(['dropA', 'dropB']),
    hats: new Set<SectionName>(['intro', 'build', 'dropA', 'dropB', 'outro']),
  };

  // --- kick (and the sidechain envelope it drives) ------------------------------------------
  const duck = new Float32Array(n).fill(1);
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const sec = sectionAt(bar);
    if (!has.kick.has(sec.name)) continue;
    for (let beat = 0; beat < 4; beat++) {
      // Leave the last beat before each drop empty, so the drop lands harder
      const preDrop = (sec.name === 'build' || sec.name === 'build2') && sec.pos === sec.bars - 1 && beat === 3;
      if (preDrop) continue;
      const t0 = bar * BAR + beat * BEAT;
      const gain = sec.name === 'intro' ? 0.5 : 0.72;
      let ph = 0;
      for (let i = 0; i < s(0.45); i++) {
        const t = i / SR;
        const f = 47 + 110 * Math.exp(-t * 32);
        ph += f / SR;
        const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5);
        const click = noise() * Math.exp(-t * 900) * 0.25;
        const v = Math.tanh((body + click) * 1.6) * 0.85 * gain;
        add(L, s(t0) + i, v);
        add(R, s(t0) + i, v);
      }
      const depth = sec.name === 'intro' || sec.name === 'outro' ? 0.4 : 0.7;
      for (let i = 0; i < s(BEAT); i++) {
        const t = i / SR;
        const j = s(t0) + i;
        if (j < n) duck[j] = Math.min(duck[j], 1 - depth * Math.exp(-t / 0.1));
      }
    }
  }

  // --- bass: off-beat saw, filtered, sidechained --------------------------------------------
  {
    const osc1 = new Saw(), osc2 = new Saw(0.3), f = new Svf();
    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      const sec = sectionAt(bar);
      if (!has.bass.has(sec.name)) continue;
      const chord = CHORDS[bar % 4];
      for (let beat = 0; beat < 4; beat++) {
        for (const off of [0.5, 0.75]) {
          const t0 = bar * BAR + (beat + off) * BEAT;
          const len = BEAT * 0.22;
          const freq = mtof(chord.bass + (off === 0.75 ? 12 : 0));
          for (let i = 0; i < s(len); i++) {
            const t = i / SR;
            const env = Math.min(1, t / 0.004) * Math.exp(-t * 9);
            f.run(osc1.next(freq) + osc2.next(freq * 1.005), 180 + 1800 * Math.exp(-t * 25), 1.1);
            const v = f.low * env * 0.5;
            add(L, s(t0) + i, v);
            add(R, s(t0) + i, v);
          }
        }
      }
    }
  }

  // --- supersaw pad ---------------------------------------------------------------------------
  {
    const detune = [-0.11, -0.06, -0.02, 0, 0.02, 0.06, 0.11];
    const voices = [0, 1, 2].map(() => detune.map((_, k) => new Saw((k * 0.137) % 1)));
    const fl = new Svf(), fr = new Svf();
    for (let i = 0; i < s(TOTAL_BARS * BAR + 0.8); i++) {
      const t = i / SR;
      const barF = t / BAR;
      const bar = Math.min(TOTAL_BARS - 1, Math.floor(barF));
      const sec = sectionAt(bar);
      const notes = CHORDS[bar % 4].pad;
      let l = 0, r = 0;
      for (let v = 0; v < 3; v++) {
        const base = mtof(notes[v]);
        for (let k = 0; k < detune.length; k++) {
          const x = voices[v][k].next(base * 2 ** (detune[k] / 12));
          const pan = k / (detune.length - 1);
          l += x * (1 - pan);
          r += x * pan;
        }
      }
      // Filter: closed in the intro, opening through builds, wide open on drops
      const p = (sec.pos + (barF - bar)) / sec.bars;
      const cutoff = {
        intro: 500 + 900 * p,
        build: 1400 + 3000 * p * p,
        dropA: 4200,
        breakdown: 1800 + 600 * Math.sin(Math.PI * p),
        build2: 1800 + 3000 * p,
        dropB: 5000,
        outro: 3200 * (1 - p) + 400,
      }[sec.name];
      fl.run(l, cutoff, 0.8);
      fr.run(r, cutoff, 0.8);
      let gain = { intro: 0.8, build: 0.75, dropA: 0.7, breakdown: 1.0, build2: 0.9, dropB: 0.75, outro: 0.7 }[sec.name];
      if (t > TOTAL_BARS * BAR - 2 * BAR) gain *= Math.max(0, (TOTAL_BARS * BAR + 0.8 - t) / (2 * BAR + 0.8));
      const g = gain * duck[i] * 0.028;
      L[i] += fl.low * g;
      R[i] += fr.low * g;
      revL[i] += fl.low * g * 0.6;
      revR[i] += fr.low * g * 0.6;
    }
  }

  // --- arp / plucks with a ping-pong dotted-eighth delay -------------------------------------
  {
    const dry = new Float32Array(n);
    const osc = new Saw(), osc2 = new Saw(0.5), f = new Svf();
    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      const sec = sectionAt(bar);
      const chord = CHORDS[bar % 4];
      // Breakdown: slower plucks; everything else: sixteenths
      const step = sec.name === 'breakdown' ? 2 : 1;
      for (let k = 0; k < 16; k += step) {
        const t0 = bar * BAR + k * (BEAT / 4);
        const note = chord.arp[ARP_PATTERN[k]] + (sec.name === 'breakdown' ? -12 : 0);
        const freq = mtof(note);
        const p = (sec.pos + k / 16) / sec.bars;
        const open = {
          intro: 900 + 1500 * p,
          build: 2000 + 5000 * p,
          dropA: 5500,
          breakdown: 2600,
          build2: 3000 + 4000 * p,
          dropB: 6500,
          outro: 4000 * (1 - p) + 600,
        }[sec.name];
        const len = sec.name === 'breakdown' ? 0.5 : 0.16;
        const decay = sec.name === 'breakdown' ? 6 : 22;
        const gain = sec.name === 'breakdown' ? 0.3 : (k % 4 === 0 ? 0.24 : 0.18);
        for (let i = 0; i < s(len); i++) {
          const t = i / SR;
          const env = Math.min(1, t / 0.002) * Math.exp(-t * decay);
          f.run(osc.next(freq) + 0.5 * osc2.next(freq * 2.003), 300 + open * Math.exp(-t * 18), 1.4);
          add(dry, s(t0) + i, f.low * env * gain);
        }
      }
    }
    const d = s(BEAT * 0.75);
    const bufL = new Float32Array(n), bufR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = dry[i];
      // ping-pong: the left echo feeds the right line and vice versa
      const outL = i >= d ? bufL[i - d] : 0;
      const outR = i >= d ? bufR[i - d] : 0;
      bufL[i] = x + outR * 0.45;
      bufR[i] = outL;
      const g = duck[i];
      L[i] += (x + outL * 0.35) * g;
      R[i] += (x + outR * 0.35) * g;
      revL[i] += x * 0.35;
      revR[i] += x * 0.35;
    }
  }

  // --- clap on 2 and 4 -----------------------------------------------------------------------
  {
    const f = new Svf();
    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      if (!has.clap.has(sectionAt(bar).name)) continue;
      for (const beat of [1, 3]) {
        const t0 = bar * BAR + beat * BEAT;
        for (let i = 0; i < s(0.3); i++) {
          const t = i / SR;
          // three quick bursts, then the tail
          const env = t < 0.025 ? Math.exp(-((t % 0.0085) * 400)) : Math.exp(-(t - 0.025) * 18);
          f.run(noise(), 1300, 1.2);
          const v = f.band * env * 0.55;
          add(L, s(t0) + i, v * 0.95);
          add(R, s(t0) + i, v);
          add(revL, s(t0) + i, v * 0.5);
          add(revR, s(t0) + i, v * 0.5);
        }
      }
    }
  }

  // --- hats: off-beat closed hats; sixteenth ticks and open hats on drop B -----------------------
  {
    const f = new Svf();
    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      const sec = sectionAt(bar);
      if (!has.hats.has(sec.name)) continue;
      if (sec.name === 'intro' && sec.pos < 2) continue;
      for (let k = 0; k < 16; k++) {
        const offBeat = k % 4 === 2;
        const ticks = (sec.name === 'dropA' || sec.name === 'dropB') && k % 2 === 1;
        if (!offBeat && !ticks) continue;
        const open = sec.name === 'dropB' && offBeat;
        const t0 = bar * BAR + k * (BEAT / 4);
        const len = open ? 0.22 : 0.05;
        const gain = offBeat ? 0.22 : 0.08;
        const pan = offBeat ? 0.5 : (k % 4 === 1 ? 0.3 : 0.7);
        for (let i = 0; i < s(len); i++) {
          const t = i / SR;
          f.run(noise(), 8000, 0.9);
          const v = f.high * Math.exp(-t * (open ? 14 : 70)) * gain;
          add(L, s(t0) + i, v * (1 - pan) * 2);
          add(R, s(t0) + i, v * pan * 2);
        }
      }
    }
  }

  // --- builds: snare roll + noise riser; crash + sub drop on each drop --------------------------
  for (const sec of info.sections) {
    if (sec.name === 'build' || sec.name === 'build2') {
      const len = sec.bars * BAR;
      const fs = new Svf(), fr = new Svf();
      // snare roll: quarters → eighths → sixteenths → thirty-seconds over the build
      for (let b = 0; b < sec.bars; b++) {
        const div = [4, 8, 16, 32].slice(4 - sec.bars)[b];
        for (let k = 0; k < div; k++) {
          const t0 = sec.start + b * BAR + k * (BAR / div);
          if (t0 >= sec.start + len - BEAT) break;
          const gain = 0.12 + 0.3 * ((t0 - sec.start) / len);
          for (let i = 0; i < s(0.12); i++) {
            const t = i / SR;
            fs.run(noise(), 2500, 0.8);
            const v = (fs.band * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 30) * gain;
            add(L, s(t0) + i, v);
            add(R, s(t0) + i, v);
            add(revL, s(t0) + i, v * 0.3);
            add(revR, s(t0) + i, v * 0.3);
          }
        }
      }
      for (let i = 0; i < s(len); i++) {
        const p = i / s(len);
        fr.run(noise(), 300 * (8000 / 300) ** p, 2);
        const v = fr.band * p * p * 0.5;
        add(L, s(sec.start) + i, v);
        add(R, s(sec.start) + i, v * 0.9);
        add(revL, s(sec.start) + i, v * 0.4);
        add(revR, s(sec.start) + i, v * 0.4);
      }
    }
    if (sec.name === 'dropA' || sec.name === 'dropB') {
      const f = new Svf();
      for (let i = 0; i < s(2.5); i++) {
        const t = i / SR;
        f.run(noise(), 6000, 0.6);
        const crash = f.high * Math.exp(-t * 1.8) * 0.3;
        const sub = Math.sin(2 * Math.PI * (40 + 30 * Math.exp(-t * 6)) * t) * Math.exp(-t * 2.2) * 0.35;
        add(L, s(sec.start) + i, crash + sub);
        add(R, s(sec.start) + i, crash * 0.9 + sub);
        add(revL, s(sec.start) + i, crash * 0.5);
        add(revR, s(sec.start) + i, crash * 0.5);
      }
    }
  }

  // --- reverb, master bus -----------------------------------------------------------------------
  const rev = new Reverb();
  for (let i = 0; i < n; i++) {
    L[i] += rev.process(revL[i], 0);
    R[i] += rev.process(revR[i], 1);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * 1.1);
    R[i] = Math.tanh(R[i] * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  // Peak target that lands the track near -14 LUFS integrated (streaming loudness), so it is
  // no louder than normalized music
  const norm = 0.69 / peak;
  const fadeIn = s(0.01);
  for (let i = 0; i < n; i++) {
    const f = i < fadeIn ? i / fadeIn : 1;
    L[i] *= norm * f;
    R[i] *= norm * f;
  }
  return [L, R];
}

function wav([L, R]: Float32Array[]): Buffer {
  const frames = L.length;
  const dataSize = frames * 4;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(2, 22);           // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  return buf;
}

export function writeTrack(): TrackInfo {
  const info = trackInfo();
  mkdirSync(dirname(PATHS.trackWav), { recursive: true });
  mkdirSync(dirname(PATHS.trackJson), { recursive: true });
  writeFileSync(PATHS.trackWav, wav(renderTrack()));
  writeFileSync(PATHS.trackJson, JSON.stringify(info, null, 2));
  console.log(`wrote ${PATHS.trackWav} (${info.duration.toFixed(1)} s, ${TOTAL_BARS} bars @ ${BPM} BPM)`);
  return info;
}
