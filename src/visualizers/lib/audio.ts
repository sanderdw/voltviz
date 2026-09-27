import type { AudioFrame } from '../../audio/types';

/**
 * Small audio helpers for visualizers (all pure, frame-rate aware where it matters).
 */

/** Mean of `data[from..to)` (clamped), as 0..255. */
export function avg(data: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(data.length, to);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += data[i];
  return s / (b - a);
}

/** Exponential moving average step with a per-frame (60 fps) coefficient, frame-rate independent. */
export function ema(prev: number, value: number, coefAt60: number, dt: number): number {
  const k = 1 - Math.pow(1 - coefAt60, dt * 60);
  return prev + (value - prev) * k;
}

/** Bin index for a frequency in a byte spectrum of `bins` bins. */
export function binFor(hz: number, sampleRate: number, bins: number): number {
  return Math.round((hz / (sampleRate / 2)) * bins);
}


/**
 * The trigger for beat-driven effects: a confident (predicted, on-time) beat, or – when the
 * beat tracker has no confidence (e.g. non-4/4 material) – a raw kick onset.
 */
export function beatHit(audio: AudioFrame): boolean {
  return audio.beat.isBeat || (audio.beat.confidence < 0.3 && audio.onsets.kick.hit);
}
