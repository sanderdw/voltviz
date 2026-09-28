/**
 * Detects a change of song so the beat tracking can start over quickly instead of dragging the
 * old song's tempo, bar and AI locks into the new one. Two triggers:
 *  - a gap: at least GAP_S of silence, then sound again;
 *  - a new sound *and* a new tempo: the timbre (log band spectrum, fast vs slow average) moves
 *    far from its recent past while the raw tempo estimate disagrees with the beat clock for
 *    TEMPO_S. A tempo-synced DJ transition, a drop or a breakdown keeps the tempo and does not
 *    trigger, so a DJ mix is left alone.
 * Pure logic, fed once per analysis frame.
 */
const GAP_S = 0.5;
const FAST_TAU_S = 2;
const SLOW_TAU_S = 12;
/**
 * Mean absolute difference (log units) of the fast and slow band averages that counts as a new
 * sound. Drops and breakdowns reach 0.4-0.9 as well; with the tempo condition, 0.6 gave no
 * false triggers on the library development set (a lower value did, and still missed cuts).
 */
const NOVELTY = 0.6;
/** Relative tempo disagreement (not an octave) and how long it must last. */
const TEMPO_DIFF = 0.04;
const TEMPO_S = 2;
/**
 * A large tempo change the tracker accepted (see NEW_SONG_TEMPO_CHANGE in beatTracker.ts) counts
 * as a song change only with at least this much timbre novelty: within a song the tracker also
 * stumbles to another tempo now and then, but the sound stays the same (novelty ~0.2).
 */
const LEAP_NOVELTY = 0.35;
/** No second trigger within this time (s). */
const REFRACTORY_S = 15;
/** No timbre/tempo trigger before this much listening (s): the tempo is still settling then. */
const WARMUP_S = 20;

export class SongChangeDetector {
  /** Latest timbre novelty (diagnostics). */
  novelty = 0;
  /** Number of changes detected. */
  count = 0;
  private readonly frameRate: number;
  private readonly fast: Float64Array;
  private readonly slow: Float64Array;
  private readonly fastCoef: number;
  private readonly slowCoef: number;
  private started = false;
  private silentFor = 0;
  private tempoOffFor = 0;
  private last = -Infinity;
  private startedAt = -1;

  constructor(frameRate: number, bands: number) {
    this.frameRate = frameRate;
    this.fast = new Float64Array(bands);
    this.slow = new Float64Array(bands);
    this.fastCoef = 1 - Math.exp(-1 / (FAST_TAU_S * frameRate));
    this.slowCoef = 1 - Math.exp(-1 / (SLOW_TAU_S * frameRate));
  }

  /** The tracker accepted a large non-octave tempo change: a song change if the sound changed too. */
  tempoLeap(t: number): boolean {
    if (this.novelty < LEAP_NOVELTY || t - this.last < REFRACTORY_S || !this.started || t - this.startedAt < WARMUP_S) return false;
    this.last = t;
    this.count++;
    this.tempoOffFor = 0;
    return true;
  }

  /**
   * Feed one frame; returns true when a song change is detected at this frame.
   * @param t          stream time (s)
   * @param silent     the level tracker's silence flag
   * @param bands      log band magnitudes of this frame
   * @param rawBpm     latest raw tempo estimate (0 when none)
   * @param clockBpm   the beat clock's tempo (0 when none)
   */
  update(t: number, silent: boolean, bands: ArrayLike<number>, rawBpm: number, clockBpm: number): boolean {
    const dt = 1 / this.frameRate;
    if (silent) {
      this.silentFor += dt;
      return false;
    }
    const afterGap = this.silentFor >= GAP_S && this.started;
    this.silentFor = 0;
    let nov = 0;
    for (let i = 0; i < this.fast.length; i++) {
      const v = bands[i];
      if (!this.started) {
        this.fast[i] = v;
        this.slow[i] = v;
      }
      this.fast[i] += (v - this.fast[i]) * this.fastCoef;
      this.slow[i] += (v - this.slow[i]) * this.slowCoef;
      nov += Math.abs(this.fast[i] - this.slow[i]);
    }
    if (!this.started) this.startedAt = t;
    this.started = true;
    this.novelty = nov / this.fast.length;
    const ratio = rawBpm > 0 && clockBpm > 0 ? rawBpm / clockBpm : 1;
    const sameTempo = [1, 2, 0.5].some(r => Math.abs(ratio / r - 1) < TEMPO_DIFF);
    this.tempoOffFor = sameTempo ? 0 : this.tempoOffFor + dt;
    const newSong = this.novelty >= NOVELTY && this.tempoOffFor >= TEMPO_S && t - this.startedAt >= WARMUP_S;
    if ((afterGap || newSong) && t - this.last >= REFRACTORY_S) {
      this.last = t;
      this.count++;
      this.tempoOffFor = 0;
      if (afterGap) {
        // a new song after a gap: the old timbre averages mean nothing any more
        this.slow.set(bands);
        this.fast.set(bands);
      }
      return true;
    }
    return false;
  }
}
