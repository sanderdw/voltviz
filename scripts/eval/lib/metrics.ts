/**
 * Standard beat-tracking evaluation measures (after mir_eval / MIREX conventions).
 * All times in seconds.
 */

export interface Match {
  ref: number;
  est: number;
}

/** Greedy one-to-one matching within +-tol (each ref to its nearest unused estimate). */
export function matchBeats(ref: number[], est: number[], tol = 0.07): Match[] {
  const used = new Uint8Array(est.length);
  const matches: Match[] = [];
  let j0 = 0;
  for (const r of ref) {
    while (j0 < est.length && est[j0] < r - tol) j0++;
    let best = -1;
    let bestD = tol + 1e-9;
    for (let j = j0; j < est.length && est[j] <= r + tol; j++) {
      const d = Math.abs(est[j] - r);
      if (!used[j] && d <= bestD) {
        best = j;
        bestD = d;
      }
    }
    if (best >= 0) {
      used[best] = 1;
      matches.push({ ref: r, est: est[best] });
    }
  }
  return matches;
}

export function fMeasure(ref: number[], est: number[], tol = 0.07): number {
  if (!ref.length && !est.length) return 1;
  if (!ref.length || !est.length) return 0;
  const hits = matchBeats(ref, est, tol).length;
  const p = hits / est.length;
  const r = hits / ref.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** Signed offsets (est - ref) of matched beats, in ms. */
export function offsetsMs(ref: number[], est: number[], tol = 0.07): number[] {
  return matchBeats(ref, est, tol).map(m => (m.est - m.ref) * 1000);
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Continuity-based accuracy (CMLt) of `est` against one reference sequence. */
function continuityTotal(ref: number[], est: number[], phaseTol = 0.175, periodTol = 0.175): number {
  if (ref.length < 2 || est.length < 2) return 0;
  let correct = 0;
  let prevOk = false;
  let prevRef = -1;
  for (let i = 0; i < est.length; i++) {
    // nearest reference beat
    let j = 0;
    let lo = 0, hi = ref.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ref[mid] < est[i]) lo = mid + 1; else hi = mid - 1;
    }
    j = lo;
    if (j > 0 && (j >= ref.length || Math.abs(ref[j - 1] - est[i]) < Math.abs(ref[j] - est[i]))) j--;
    const ibi = j > 0 ? ref[j] - ref[j - 1] : ref[1] - ref[0];
    const phaseOk = Math.abs(est[i] - ref[j]) <= phaseTol * ibi;
    let ok = phaseOk;
    if (ok && i > 0) {
      const estIbi = est[i] - est[i - 1];
      // continuity: correct period, and the previous estimate matched the previous reference beat
      ok = Math.abs(estIbi - ibi) <= periodTol * ibi && prevOk && prevRef === j - 1;
    }
    if (ok) correct++;
    prevOk = phaseOk;
    prevRef = j;
  }
  return correct / Math.max(ref.length, est.length);
}

function variations(ref: number[]): number[][] {
  const mids: number[] = [];
  for (let i = 0; i + 1 < ref.length; i++) mids.push((ref[i] + ref[i + 1]) / 2);
  const double: number[] = [];
  for (let i = 0; i < ref.length; i++) {
    double.push(ref[i]);
    if (i < mids.length) double.push(mids[i]);
  }
  return [
    ref,                                   // original
    mids,                                  // off-beat
    double,                                // double tempo
    ref.filter((_, i) => i % 2 === 0),     // half tempo, odd beats
    ref.filter((_, i) => i % 2 === 1),     // half tempo, even beats
  ];
}

export function cmlt(ref: number[], est: number[]): number {
  return continuityTotal(ref, est);
}

/** Like CMLt but allowing the off-beat, double and half metrical levels. */
export function amlt(ref: number[], est: number[]): number {
  return Math.max(...variations(ref).map(v => continuityTotal(v, est)));
}

export type TempoClass = 'correct' | 'octave' | 'wrong' | 'none';

export function classifyTempo(est: number, ref: number, tol = 0.02): TempoClass {
  if (!est || !isFinite(est)) return 'none';
  const r = est / ref;
  if (Math.abs(r - 1) <= tol) return 'correct';
  if ([2, 0.5, 3, 1 / 3, 1.5, 2 / 3].some(k => Math.abs(r / k - 1) <= tol)) return 'octave';
  return 'wrong';
}

/** First time t >= from at which `n` consecutive reference beats are matched by estimates. */
export function lockTime(ref: number[], est: number[], from: number, n = 4, tol = 0.07): number | null {
  const matched = new Set(matchBeats(ref, est, tol).map(m => m.ref));
  const rs = ref.filter(r => r >= from);
  for (let i = 0; i + n <= rs.length; i++) {
    let ok = true;
    for (let k = 0; k < n; k++) if (!matched.has(rs[i + k])) { ok = false; break; }
    if (ok) return rs[i] - from;
  }
  return null;
}

export function within(xs: number[], ranges: [number, number][]): number[] {
  return xs.filter(x => ranges.some(([a, b]) => x >= a && x < b));
}
