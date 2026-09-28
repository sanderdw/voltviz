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
}

export const bpmOf = (xs: number[]) => (xs.length >= 3 ? 60 / median(xs.slice(1).map((t, i) => t - xs[i])) : 0);

export function buildPulseRefs(r: PulseReferenceSource, expected: number | null | undefined): PulseRef[] {
  const out: PulseRef[] = [{ name: 'madmom', beats: r.beats, bpm: bpmOf(r.beats) }];
  if (r.crossCheckBeats?.length) out.push({ name: 'beat_this', beats: r.crossCheckBeats, bpm: bpmOf(r.crossCheckBeats) });
  const downs = r.downbeats ?? [];
  if (downs.length >= 2) {
    const barPos = (b: number) => {
      let d = -1;
      for (const x of downs) { if (x <= b + 0.035) d = x; else break; }
      if (d < 0) return -1;
      return r.beats.filter(x => x >= d - 0.035 && x < b - 0.035).length;
    };
    const pos = r.beats.map(barPos);
    const h13 = r.beats.filter((_, i) => pos[i] >= 0 && pos[i] % 2 === 0);
    const h24 = r.beats.filter((_, i) => pos[i] >= 0 && pos[i] % 2 === 1);
    out.push({ name: 'madmom half (bar beats 1+3)', beats: h13, bpm: bpmOf(h13) });
    out.push({ name: 'madmom half (bar beats 2+4)', beats: h24, bpm: bpmOf(h24) });
  }
  if (!expected) return out;
  return out.filter(p => Math.abs(p.bpm / expected - 1) < 0.1);
}
