/**
 * Streaming band-limited resampler (Kaiser-windowed sinc, table-driven). Used to bring the
 * input to the 22.05 kHz the beat model was trained on. Pure TypeScript; runs in the
 * AudioWorklet and in Node.
 */
const HALF_TAPS = 24; // zero crossings on each side, in units of the (lower) output rate
const TABLE_RES = 256; // table entries per zero crossing

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

export class Resampler {
  readonly inRate: number;
  readonly outRate: number;
  private readonly step: number; // input samples per output sample
  private readonly cutoff: number; // cycles per input sample
  private readonly half: number; // half filter length in input samples
  private readonly table: Float64Array;
  private readonly buf: Float64Array;
  private readonly mask: number;
  private written = 0; // input samples written
  private nextOut = 0; // position (input samples) of the next output sample

  constructor(inRate: number, outRate: number) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.step = inRate / outRate;
    const ratio = Math.min(1, outRate / inRate);
    this.cutoff = 0.5 * ratio * 0.94;
    this.half = Math.ceil(HALF_TAPS / ratio);
    // h(u) for u in [0, half], sampled at TABLE_RES per input sample
    const n = this.half * TABLE_RES + 2;
    this.table = new Float64Array(n);
    const beta = 8.6;
    const i0b = besselI0(beta);
    for (let i = 0; i < n; i++) {
      const u = i / TABLE_RES;
      const x = 2 * this.cutoff * u;
      const sinc = u === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = u / this.half;
      const w = r >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      this.table[i] = 2 * this.cutoff * sinc * w;
    }
    let size = 1;
    while (size < 4 * this.half + 4096) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
  }

  private h(u: number): number {
    const a = Math.abs(u) * TABLE_RES;
    const i = Math.floor(a);
    if (i + 1 >= this.table.length) return 0;
    const f = a - i;
    return this.table[i] * (1 - f) + this.table[i + 1] * f;
  }

  /**
   * Push input samples; calls `emit` for every output sample whose filter support is
   * complete (latency: `half` input samples).
   */
  push(input: ArrayLike<number>, length: number, emit: (v: number) => void): void {
    for (let i = 0; i < length; i++) {
      this.buf[this.written & this.mask] = input[i];
      this.written++;
      while (this.nextOut + this.half < this.written) {
        const t = this.nextOut;
        const k0 = Math.floor(t) - this.half + 1;
        const k1 = Math.floor(t) + this.half;
        let acc = 0;
        for (let k = Math.max(0, k0); k <= k1; k++) acc += this.buf[k & this.mask] * this.h(t - k);
        emit(acc);
        this.nextOut += this.step;
      }
    }
  }
}
