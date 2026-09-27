/**
 * Parity check of the TypeScript neural front end + ONNX model against beat_this in Python.
 *   node scripts/eval/neural-parity.ts <wav> <python dump prefix> <onnx model>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { MelFrontend, N_MELS } from '../../src/audio/neural/melFrontend.ts';
import { streamMono } from './lib/stream.ts';

const [wav, prefix, model, outJson] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`${prefix}.json`, 'utf8'));
const f32 = (path: string) => { const b = readFileSync(path); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const pyMel = f32(`${prefix}.logmel.f32`);
const pyBeat = f32(`${prefix}.beat.f32`);
const seconds = meta.frames / 50;

const fe = new MelFrontend(44100, meta.frames + 10);
await streamMono(wav, { sampleRate: 44100, seconds: seconds + 0.2 }, b => fe.push(b));
const n = Math.min(meta.frames, fe.frames);
const tsMel = new Float32Array(n * N_MELS);
const all = new Float32Array(fe.frames * N_MELS);
fe.latest(fe.frames, all);
tsMel.set(all.subarray(0, n * N_MELS));

let sumAbs = 0, maxAbs = 0, sumRef = 0, count = 0;
for (let f = 20; f < n - 20; f++) {
  for (let m = 0; m < N_MELS; m++) {
    const d = Math.abs(tsMel[f * N_MELS + m] - pyMel[f * N_MELS + m]);
    sumAbs += d; sumRef += Math.abs(pyMel[f * N_MELS + m]); count++;
    if (d > maxAbs) maxAbs = d;
  }
}
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
const win = tsMel.subarray((meta.frames - 500) * N_MELS, meta.frames * N_MELS);
const out = await session.run({ spect: new ort.Tensor('float32', Float32Array.from(win), [1, 500, N_MELS]) });
const tsBeat = out.beat.data as Float32Array;
let maxAct = 0;
for (let i = 0; i < 500; i++) maxAct = Math.max(maxAct, Math.abs(tsBeat[i] - pyBeat[i]));
const peaks = (a: Float32Array) => { const p: number[] = []; for (let i = 1; i < a.length - 1; i++) if (a[i] > 0.5 && a[i] >= a[i - 1] && a[i] >= a[i + 1]) p.push(i); return p; };
const pp = peaks(pyBeat), tp = peaks(tsBeat);
const matched = pp.filter(p => tp.some(t => Math.abs(t - p) <= 1)).length;
const result = {
  frames: n, melMeanAbsDiff: sumAbs / count, melMeanAbsRef: sumRef / count, melMaxAbsDiff: maxAbs,
  activationMaxAbsDiff: maxAct, pythonPeaks: pp.length, tsPeaks: tp.length, peaksMatchedWithin1Frame: matched,
};
console.log(result);
// per-mel-band mean difference, to locate systematic deviations
const band: number[] = [];
for (let m = 0; m < N_MELS; m += 16) { let s = 0, c = 0; for (let f = 20; f < n - 20; f++) { s += tsMel[f * N_MELS + m] - pyMel[f * N_MELS + m]; c++; } band.push(+(s / c).toFixed(3)); }
console.log('mean signed diff per 16th mel band (ts - py):', band.join(' '));
let lagBest = 0, lagErr = Infinity;
for (let lag = -3; lag <= 3; lag++) { let s = 0, c = 0; for (let f = 30; f < n - 30; f++) for (let m = 0; m < N_MELS; m++) { s += Math.abs(tsMel[(f + lag) * N_MELS + m] - pyMel[f * N_MELS + m]); c++; } if (s / c < lagErr) { lagErr = s / c; lagBest = lag; } }
console.log('best frame lag', lagBest, 'err', lagErr.toFixed(4));
if (outJson) writeFileSync(outJson, JSON.stringify(result));
