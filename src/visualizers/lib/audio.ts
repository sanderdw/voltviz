import { STYLE_PROFILES } from '../../audio/core/styles';
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
 * The trigger for beat-driven effects: a confident (predicted, on-time) pulse beat, or – when
 * the beat tracker has no confidence (e.g. non-4/4 material) – a raw onset: a kick, or for
 * Music styles without a steady kick (Auto, hip-hop, band, chill) also a snare/mid-band hit,
 * so acoustic music still pulses on strums and piano chords.
 */
export function beatHit(audio: AudioFrame): boolean {
  if (audio.beat.isBeat) return true;
  if (audio.beat.confidence >= 0.3) return false;
  if (audio.onsets.kick.hit) return true;
  return STYLE_PROFILES[audio.style]?.fallback === 'accent' && audio.onsets.snare.hit;
}

/**
 * How hard the {@link beatHit} of this frame should hit, 0..1 (0 when there is none): the beat
 * strength on a tracked beat (low in a build-up without a drum hit), 1 on a raw onset hit.
 * Multiply beat effects by it.
 */
export function beatStrength(audio: AudioFrame): number {
  if (audio.beat.isBeat) return audio.beat.strength;
  return beatHit(audio) ? 1 : 0;
}

/**
 * Minimum {@link beatStrength} for one-off beat events that cannot be made weaker (switching a
 * look or an icon, spawning rockets): a build-up without a drum hit does not trigger them.
 */
export const STRONG_BEAT = 0.5;
