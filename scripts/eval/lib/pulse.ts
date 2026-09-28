/**
 * Reference beats for the *pulse* beat effects should follow (genre evaluation): each reference
 * tracker at its own metrical level, and madmom at half tempo on bar beats 1 & 3 (from its
 * downbeats) or 2 & 4. With an expected pulse (BPM), only candidates within 10 % of it are kept
 * and the first one is primary.
 */
import { median } from './metrics.ts';

export interface PulseRef { name: string; beats: number[]; bpm: number }

export interface PulseReferenceSource {
  beats: number[];
  downbeats?: number[];
  crossCheckBeats?: number[];
  crossCheckDownbeats?: number[];
}

export const bpmOf = (xs: number[]) => (xs.length >= 3 ? 60 / median(xs.slice(1).map((t, i) => t - xs[i])) : 0);

/**
 * The expected pulse (BPM) of a pulse rule, from the reference tempo: `half` folds it below
 * 110 BPM (the half-time pulse), `full` into 90-230 BPM (every beat), `either` gives null.
 */
export function pulseFromRule(rule: 'half' | 'full' | 'either' | undefined, refBpm: number): number | null | undefined {
  if (!rule) return undefined;
  if (rule === 'either' || !(refBpm > 0)) return null;
  let b = refBpm;
  if (rule === 'half') {
    while (b >= 110) b /= 2;
    while (b < 55) b *= 2;
  } else {
    while (b < 90) b *= 2;
    while (b >= 230) b /= 2;
  }
  return b;
}

export function buildPulseRefs(r: PulseReferenceSource, expected: number | null | undefined): PulseRef[] {
  const out: PulseRef[] = [{ name: 'madmom', beats: r.beats, bpm: bpmOf(r.beats) }];
  if (r.crossCheckBeats?.length) out.push({ name: 'beat_this', beats: r.crossCheckBeats, bpm: bpmOf(r.crossCheckBeats) });
  // half tempo on bar beats 1+3 / 2+4, with the bar from each tracker's own downbeats
  const halves = (name: string, beats: number[], downs: number[]) => {
    if (downs.length < 2 || beats.length < 4) return;
    const barPos = (b: number) => {
      let d = -1;
      for (const x of downs) { if (x <= b + 0.035) d = x; else break; }
      if (d < 0) return -1;
      return beats.filter(x => x >= d - 0.035 && x < b - 0.035).length;
    };
    const pos = beats.map(barPos);
    const h13 = beats.filter((_, i) => pos[i] >= 0 && pos[i] % 2 === 0);
    const h24 = beats.filter((_, i) => pos[i] >= 0 && pos[i] % 2 === 1);
    out.push({ name: `${name} half (bar beats 1+3)`, beats: h13, bpm: bpmOf(h13) });
    out.push({ name: `${name} half (bar beats 2+4)`, beats: h24, bpm: bpmOf(h24) });
  };
  halves('madmom', r.beats, r.downbeats ?? []);
  halves('beat_this', r.crossCheckBeats ?? [], r.crossCheckDownbeats ?? []);
  if (!expected) return out;
  return out.filter(p => Math.abs(p.bpm / expected - 1) < 0.1);
}
