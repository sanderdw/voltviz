/**
 * Decides in which animation frame a beat fires (`beat.isBeat`). Pure logic, no Web Audio.
 *
 * Two sources, deduplicated by the running beat index:
 *  1. the predicted next pulse beat of the latest analysis state, so a beat fires exactly when
 *     it becomes audible even if the analysis message carrying it is still on its way;
 *  2. beat events the analysis already emitted, fired once they are audible.
 *
 * Only pulse beats fire (every tracked beat, or every other one on a half-time pulse), but every
 * beat advances the fired index: when the pulse divisor or parity changes, a beat that was
 * skipped can never fire late.
 */
export interface PulseClock {
  locked: boolean;
  confidence: number;
  /** Pulse period in seconds (0 when unknown). */
  pulsePeriod: number;
  pulseDivisor: number;
  /** Stream time of the next pulse beat and its running beat index. */
  nextPulseTime: number;
  nextPulseIndex: number;
}

/** A beat event of the analysis that is audible now (`at` in AudioContext time). */
export interface DueBeat {
  at: number;
  index: number;
  pulse: boolean;
  confidence: number;
}

export class BeatFirer {
  /** Number of beats fired so far. */
  count = 0;
  /** AudioContext time of the last fired beat. */
  lastBeatAt = -Infinity;
  private fired = -1;

  constructor(private readonly minConfidence = 0.3) {}

  /**
   * @param now     AudioContext time being heard right now
   * @param maxLate how late (s) a predicted beat may still fire (about a frame)
   * @param clock   latest analysis state, or null before the first message
   * @param offset  stream time -> AudioContext time
   * @param due     queued beat events with `at <= now`, oldest first
   */
  frame(now: number, maxLate: number, clock: PulseClock | null, offset: number, due: readonly DueBeat[]): { isBeat: boolean; confidence: number } {
    let isBeat = false;
    let confidence = clock ? clock.confidence : 0;
    if (clock && clock.locked && clock.pulsePeriod > 0) {
      const nextAt = clock.nextPulseTime + offset;
      const prevIndex = clock.nextPulseIndex - clock.pulseDivisor;
      const prevAt = nextAt - clock.pulsePeriod;
      if (now >= nextAt && clock.nextPulseIndex > this.fired) {
        isBeat = this.fire(clock.nextPulseIndex, nextAt, confidence);
      } else if (now >= prevAt && now - prevAt <= maxLate && prevIndex > this.fired) {
        isBeat = this.fire(prevIndex, prevAt, confidence);
      }
    }
    for (const e of due) {
      if (e.index <= this.fired) continue;
      this.fired = e.index;
      if (e.pulse && e.confidence >= this.minConfidence) {
        isBeat = true;
        this.lastBeatAt = e.at;
        confidence = e.confidence;
      }
    }
    if (isBeat) this.count++;
    return { isBeat, confidence };
  }

  private fire(index: number, at: number, confidence: number): boolean {
    this.fired = index;
    if (confidence < this.minConfidence) return false;
    this.lastBeatAt = at;
    return true;
  }
}
