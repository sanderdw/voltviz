import type { PulseMode, TrackerTuning } from './beatTracker.ts';

/**
 * Music styles: what the engine may assume about the music. A style sets the tempo range and
 * prior (which metrical level is "the beat" when the onsets are ambiguous, e.g. 70 vs 140 BPM)
 * and when beat effects follow the half-time pulse instead of every tracked beat.
 *
 * `auto` makes no genre assumption beyond today's defaults: it keeps the dance-music prior and
 * decides the half-time pulse from the audio (see PulseSelector in beatTracker.ts). The other
 * styles pin a range and prior for listeners who know what is playing.
 */
export type StyleId = 'auto' | 'electronic' | 'hard' | 'bass' | 'hiphop' | 'band' | 'chill';

export interface StyleProfile {
  id: StyleId;
  /** Settings label. */
  label: string;
  /** One-line description for Settings. */
  description: string;
  tempo: {
    minBpm: number;
    maxBpm: number;
    /** Centre of the log-Gaussian tempo prior. */
    priorBpm: number;
    /** Width of the prior in octaves. */
    priorOctaves: number;
  };
  /**
   * When beat effects follow the half-time pulse (every other tracked beat) instead of every
   * tracked beat, for tracked tempi above `maxBpm` (see PulseMode in beatTracker.ts).
   */
  pulse: { mode: PulseMode; maxBpm: number };
  /** What beat effects fall back to when no beat is confident: kick onsets, or any accent (kick or snare). */
  fallback: 'kick' | 'accent';
  /** Beat tracker overrides, only where the genre evaluation showed they help (see the report). */
  tracker?: Partial<TrackerTuning>;
}

/**
 * Confidence gates for music whose beat is audible but whose periodicity is diluted by vocals,
 * melody or dense percussion (rap, hardcore melodies, ballads). Measured on the genre
 * excerpts; on the DJ mix they also raise DSP F (0.818 -> 0.840), and in its quiet sections
 * they fire only where the reference trackers hear beats. `electronic` keeps the 0.23 gates.
 */
const DENSE_MUSIC_GATES = { recentFloor: 1.05, recentFull: 1.4, salienceFloor: 0.03, salienceFull: 0.15 };

export const STYLE_PROFILES: Record<StyleId, StyleProfile> = {
  auto: {
    id: 'auto',
    label: 'Auto',
    description: 'Adapts to the music. Pick a style if the beat effects run at double or half the speed you feel.',
    tempo: { minBpm: 60, maxBpm: 200, priorBpm: 128, priorOctaves: 0.7 },
    pulse: { mode: 'evidence', maxBpm: 110 },
    fallback: 'accent',
    tracker: DENSE_MUSIC_GATES,
  },
  electronic: {
    id: 'electronic',
    label: 'House, techno, trance',
    description: 'Four-on-the-floor dance music, 115–150 BPM. Every beat flashes.',
    tempo: { minBpm: 60, maxBpm: 200, priorBpm: 128, priorOctaves: 0.7 },
    pulse: { mode: 'every', maxBpm: Infinity },
    fallback: 'kick',
  },
  hard: {
    id: 'hard',
    label: 'Hardstyle, hardcore',
    description: 'Fast kicks, 140–230 BPM. Every kick is a beat.',
    tempo: { minBpm: 130, maxBpm: 230, priorBpm: 170, priorOctaves: 0.5 },
    pulse: { mode: 'every', maxBpm: Infinity },
    fallback: 'kick',
    tracker: DENSE_MUSIC_GATES,
  },
  bass: {
    id: 'bass',
    label: 'Dubstep, drum & bass, trap',
    description: 'Half-time beats: effects follow the kick and snare (70 at 140 BPM).',
    tempo: { minBpm: 60, maxBpm: 190, priorBpm: 140, priorOctaves: 0.6 },
    pulse: { mode: 'half', maxBpm: 110 },
    fallback: 'kick',
    tracker: DENSE_MUSIC_GATES,
  },
  hiphop: {
    id: 'hiphop',
    label: 'Hip-hop, rap, R&B',
    description: 'Rap and R&B: every beat flashes. For the half-time feel of trap, pick Dubstep, drum & bass, trap.',
    tempo: { minBpm: 60, maxBpm: 180, priorBpm: 120, priorOctaves: 0.9 },
    // cautious like Auto: on the rap test song a half-time pulse landed on inconsistent beats
    // (see the 0.30.0 report); trap listeners get the half-time pulse from the `bass` style
    pulse: { mode: 'evidence', maxBpm: 110 },
    fallback: 'accent',
    tracker: DENSE_MUSIC_GATES,
  },
  band: {
    id: 'band',
    label: 'Rock, pop, live band',
    description: 'Played drums: kick and snare backbeat, tempo may drift.',
    tempo: { minBpm: 60, maxBpm: 200, priorBpm: 115, priorOctaves: 0.9 },
    pulse: { mode: 'lean', maxBpm: 140 },
    fallback: 'accent',
    tracker: DENSE_MUSIC_GATES,
  },
  chill: {
    id: 'chill',
    label: 'Acoustic, chill, ballads',
    description: 'Slow and soft music; also reacts to strums and piano hits.',
    tempo: { minBpm: 50, maxBpm: 140, priorBpm: 85, priorOctaves: 0.7 },
    pulse: { mode: 'every', maxBpm: Infinity },
    fallback: 'accent',
    tracker: DENSE_MUSIC_GATES,
  },
};

export const STYLE_IDS = Object.keys(STYLE_PROFILES) as StyleId[];
export const DEFAULT_STYLE: StyleId = 'auto';

export function isStyleId(s: unknown): s is StyleId {
  return typeof s === 'string' && s in STYLE_PROFILES;
}
