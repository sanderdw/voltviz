/**
 * Faithful re-implementations of the beat/kick detectors the visualizers used before the
 * audio-engine rewrite, driven by an emulated Web Audio AnalyserNode at 60 fps (the
 * requestAnimationFrame rate they were polled at). Used only as the "before" baseline.
 */
import { FFT, blackmanWindow } from '../../../src/audio/core/fft.ts';

/** AnalyserNode.getByteFrequencyData per the Web Audio spec (Blackman, 1/N, smoothing, -100..-30 dB). */
export class AnalyserEmu {
  readonly fftSize: number;
  readonly bins: number;
  private readonly smoothing: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly smoothed: Float64Array;

  constructor(fftSize: number, smoothing: number) {
    this.fftSize = fftSize;
    this.bins = fftSize / 2;
    this.smoothing = smoothing;
    this.fft = new FFT(fftSize);
    this.win = blackmanWindow(fftSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.smoothed = new Float64Array(fftSize / 2);
  }

  /** `latest(i)` returns the i-th of the most recent fftSize samples (oldest first). */
  getByteFrequencyData(latest: (i: number) => number, out: Uint8Array): void {
    const n = this.fftSize;
    for (let i = 0; i < n; i++) {
      this.re[i] = latest(i) * this.win[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    const t = this.smoothing;
    for (let k = 0; k < this.bins; k++) {
      const mag = Math.hypot(this.re[k], this.im[k]) / n;
      this.smoothed[k] = t * this.smoothed[k] + (1 - t) * mag;
      const db = 20 * Math.log10(this.smoothed[k] || 1e-20);
      out[k] = Math.max(0, Math.min(255, Math.floor((255 / 70) * (db + 100))));
    }
  }
}

export interface BaselineResult {
  name: string;
  description: string;
  /** Times (s) the visualizer would have fired its beat/kick effect. */
  events: number[];
  /** BPM estimate over time (only AudioDebug had one). */
  bpm?: { time: number; bpm: number }[];
}

interface Detector {
  name: string;
  description: string;
  analyser: AnalyserEmu;
  data: Uint8Array;
  events: number[];
  bpm?: { time: number; bpm: number }[];
  step(now: number): void;
}

function fluxDetector(name: string, description: string, fftSize: number, sampleRate: number,
  loHz: number, hiHz: number, gate: number | null, withBpm: boolean): Detector {
  const analyser = new AnalyserEmu(fftSize, 0.2);
  const data = new Uint8Array(analyser.bins);
  const prev = new Float32Array(analyser.bins);
  const hist: number[] = [];
  const binHz = sampleRate / fftSize;
  const start = loHz <= 0 ? 1 : Math.max(1, Math.floor(loHz / binHz));
  const end = Math.min(Math.floor(hiHz / binHz), analyser.bins);
  const count = loHz <= 0 ? end : Math.max(1, end - start); // AudioDebug divides by kickBassEnd
  let lastKick = -1e9;
  const kickTimes: number[] = [];
  const d: Detector = {
    name, description, analyser, data, events: [], bpm: withBpm ? [] : undefined,
    step(now: number) {
      let flux = 0;
      for (let i = start; i < end; i++) {
        const diff = data[i] - prev[i];
        if (diff > 0) flux += diff;
      }
      flux /= count * 255;
      let energy = 0;
      for (let i = start; i < end; i++) energy += data[i];
      energy /= Math.max(1, end - start) * 255;
      for (let i = 0; i < data.length; i++) prev[i] = data[i];
      hist.push(flux);
      if (hist.length > 60) hist.shift();
      const sorted = [...hist].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)] || 0;
      const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
      const std = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
      const thr = med + std * 1.2 + 0.02;
      const nowMs = now * 1000;
      if (flux > thr && (gate === null || energy > gate) && nowMs - lastKick > 120) {
        lastKick = nowMs;
        d.events.push(now);
        kickTimes.push(nowMs);
        while (kickTimes.length && nowMs - kickTimes[0] > 30000) kickTimes.shift();
      }
      if (d.bpm && kickTimes.length >= 4) {
        const iv: number[] = [];
        for (let i = 1; i < kickTimes.length; i++) iv.push(kickTimes[i] - kickTimes[i - 1]);
        const valid = iv.filter(v => v >= 300 && v <= 1000);
        if (valid.length >= 3) {
          d.bpm.push({ time: now, bpm: 60000 / (valid.reduce((a, b) => a + b, 0) / valid.length) });
        }
      }
    },
  };
  return d;
}

export function createBaselines(sampleRate: number): Detector[] {
  const iconsAnalyser = new AnalyserEmu(512, 0.8);
  const iconsData = new Uint8Array(iconsAnalyser.bins);
  let lastBass = 0;
  const icons: Detector = {
    name: 'Icons/YourLogo',
    description: 'bass (bins 0-9 of 512/0.8) > 180 and rising > 10 per frame',
    analyser: iconsAnalyser, data: iconsData, events: [],
    step(now) {
      let s = 0;
      for (let i = 0; i < 10; i++) s += iconsData[i];
      const bass = s / 10;
      if (bass > 180 && bass > lastBass + 10) icons.events.push(now);
      lastBass = bass;
    },
  };

  const fwAnalyser = new AnalyserEmu(512, 0.7);
  const fwData = new Uint8Array(fwAnalyser.bins);
  let beatTimer = 0;
  let lastNow = 0;
  const fireworks: Detector = {
    name: 'FireworksShow',
    description: 'bass (bins 0-5 of 512/0.7) / 255 > 0.8 x (1.5 - sensitivity) with 0.4 s cooldown',
    analyser: fwAnalyser, data: fwData, events: [],
    step(now) {
      const dt = Math.min(now - lastNow, 0.1);
      lastNow = now;
      if (beatTimer > 0) beatTimer -= dt;
      let s = 0;
      for (let i = 0; i < 6; i++) s += fwData[i];
      if (s / 6 / 255 > 0.8 * (1.5 - 1) && beatTimer <= 0) {
        beatTimer = 0.4;
        fireworks.events.push(now);
      }
    },
  };

  return [
    fluxDetector('AudioDebug/FractalOrb', 'spectral flux 0-150 Hz (1024/0.2), median + 1.2 sd + 0.02, 120 ms cooldown',
      1024, sampleRate, 0, 150, null, true),
    fluxDetector('CyberCity/AnunakiSphere', 'spectral flux 20-60 Hz (4096/0.2) + sub-bass gate 0.10, 120 ms cooldown',
      4096, sampleRate, 20, 60, 0.1, false),
    icons,
    fireworks,
  ];
}

/** Runs all baseline detectors over a mono stream at 60 fps. */
export class BaselineRunner {
  private readonly detectors: Detector[];
  private readonly ring = new Float64Array(8192);
  private written = 0;
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private nextFrameAt: number;

  constructor(sampleRate: number, fps = 60) {
    this.sampleRate = sampleRate;
    this.detectors = createBaselines(sampleRate);
    this.frameSamples = sampleRate / fps;
    this.nextFrameAt = this.frameSamples;
  }

  process(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.written % this.ring.length] = samples[i];
      this.written++;
      if (this.written >= this.nextFrameAt) {
        this.nextFrameAt += this.frameSamples;
        const now = this.written / this.sampleRate;
        for (const d of this.detectors) {
          const n = d.analyser.fftSize;
          const base = this.written - n;
          d.analyser.getByteFrequencyData(k => (base + k >= 0 ? this.ring[(base + k) % this.ring.length] : 0), d.data);
          d.step(now);
        }
      }
    }
  }

  results(): BaselineResult[] {
    return this.detectors.map(d => ({ name: d.name, description: d.description, events: d.events, bpm: d.bpm }));
  }
}
