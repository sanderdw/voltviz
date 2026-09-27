/**
 * Loudness tracking and the Auto Gain suggestion.
 *
 * The analysis itself never depends on this (onset functions are log-domain and therefore
 * level-invariant). The suggested gain is only applied to the *display* analysers, and only
 * when the user enables Auto Gain, so visuals react alike for quiet microphones and loud
 * system audio.
 */
export interface LevelOptions {
  frameRate: number;
  /** Loudness the display path is normalized to (RMS dBFS; typical mastered music). */
  targetDb?: number;
  minGainDb?: number;
  maxGainDb?: number;
  /** Below this RMS level the input counts as silence and the gain is frozen. */
  silenceDb?: number;
}

const toDb = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));

export class LevelTracker {
  /** Smoothed loudness (RMS dBFS). */
  loudnessDb = -100;
  /** Suggested display gain (linear). */
  gain = 1;
  silent = true;
  rms = 0;
  peak = 0;

  private readonly attack: number;
  private readonly release: number;
  private readonly gainCoef: number;
  private readonly peakDecay: number;
  private readonly targetDb: number;
  private readonly minGainDb: number;
  private readonly maxGainDb: number;
  private readonly silenceDb: number;
  private started = false;
  private quietFrames = 0;
  private readonly silentAfter: number;

  constructor(o: LevelOptions) {
    const coef = (seconds: number) => 1 - Math.exp(-1 / (seconds * o.frameRate));
    this.attack = coef(0.4);
    this.release = coef(3);
    this.gainCoef = coef(1.5);
    this.peakDecay = Math.exp(-1 / (0.3 * o.frameRate));
    this.targetDb = o.targetDb ?? -14;
    this.minGainDb = o.minGainDb ?? -6;
    this.maxGainDb = o.maxGainDb ?? 24;
    this.silenceDb = o.silenceDb ?? -60;
    this.silentAfter = Math.round(0.3 * o.frameRate);
  }

  update(rms: number, peak: number): void {
    this.rms = rms;
    this.peak = Math.max(peak, this.peak * this.peakDecay);
    const db = toDb(rms);
    if (db <= this.silenceDb) {
      // Pause / silence: freeze loudness and gain (never amplify noise floors or pauses),
      // and report silence after a short hold.
      this.quietFrames++;
      this.silent = this.quietFrames >= this.silentAfter;
      return;
    }
    this.quietFrames = 0;
    this.silent = false;
    if (!this.started) {
      this.started = true;
      this.loudnessDb = db;
    }
    const c = db > this.loudnessDb ? this.attack : this.release;
    this.loudnessDb += (db - this.loudnessDb) * c;
    const wantDb = Math.min(this.maxGainDb, Math.max(this.minGainDb, this.targetDb - this.loudnessDb));
    const curDb = toDb(this.gain);
    this.gain = Math.pow(10, (curDb + (wantDb - curDb) * this.gainCoef) / 20);
  }
}
