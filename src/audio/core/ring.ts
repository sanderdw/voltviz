/** Fixed-capacity history addressed by absolute frame index (older frames read as 0). */
export class FrameHistory {
  private readonly data: Float64Array;
  private readonly capacity: number;
  /** Absolute index of the next frame to be written. */
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float64Array(capacity);
  }

  push(v: number): void {
    this.data[this.count % this.capacity] = v;
    this.count++;
  }

  /** Value at absolute frame index `i`, or 0 when outside the retained window. */
  at(i: number): number {
    if (i < 0 || i >= this.count || i < this.count - this.capacity) return 0;
    return this.data[i % this.capacity];
  }

  /** Linear interpolation at a fractional absolute frame index. */
  interp(x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    return this.at(i) * (1 - f) + this.at(i + 1) * f;
  }

  /** Copy the most recent `n` frames (oldest first) into `out`. */
  latest(n: number, out: Float64Array): void {
    const start = this.count - n;
    for (let k = 0; k < n; k++) out[k] = this.at(start + k);
  }
}
