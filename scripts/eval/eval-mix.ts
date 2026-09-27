/**
 * Offline evaluation of the audio engine against the independent reference beats, on every
 * excerpt in scripts/eval/excerpts.json (the tuning excerpt and the held-out ones).
 *
 *   node scripts/eval/eval-mix.ts [--only <excerpt id>] [--out path] [--rates 44100,48000]
 *
 * The excerpt is streamed from ffmpeg in 128-sample blocks (exactly the AudioWorklet render
 * quantum) through the causal Analyzer, so the numbers are what the live engine produces.
 * The pre-rewrite detectors are replayed on the same audio as the baseline.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as ort from 'onnxruntime-web';
import { Analyzer, type AnalyzerEvent } from '../../src/audio/core/Analyzer.ts';
import { createBeatModel, type BeatModel } from '../../src/audio/neural/beatModel.ts';
import { BaselineRunner, type BaselineResult } from './lib/baselines.ts';
import { amlt, classifyTempo, cmlt, fMeasure, lockTime, median, offsetsMs, within } from './lib/metrics.ts';
import { streamMono } from './lib/stream.ts';
import { compactReport } from './lib/compact.ts';
import { excerptPath, manifest } from './prepare-audio.ts';

/** Beats below this confidence are not surfaced to visualizers as `isBeat`. */
export const BEAT_CONFIDENCE_MIN = 0.3;
const WARMUP_S = 5;

const GATES = {
  fMeasure: 0.8,
  amlt: 0.9,
  tempoAccuracy: 0.9,
  medianOffsetMs: 20,
};

interface Reference {
  duration: number;
  excerpt: { start: number; seconds: number };
  beats: number[];
  windows: { start: number; end: number; bpm: number | null; agree: boolean; rmsDb: number }[];
  grid: { bpm: number };
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const outPath = arg('out', 'docs/reports/data/eval-mix.json');
const rates = arg('rates', '44100,48000').split(',').map(Number);
const only = arg('only', '');
const modes = arg('modes', 'dsp,hybrid').split(',') as ('dsp' | 'hybrid')[];
const modelPath = arg('model', 'public/models/beat_this_small0.onnx');
/** Stream seconds between a neural request and applying its result (models async inference). */
const NEURAL_LATENCY_S = 1.0;
ort.env.wasm.numThreads = 1;
let model: BeatModel | null = null;

// Per-excerpt context (set by runExcerpt)
let audioPath = '';
let ref: Reference;
let gated: [number, number][] = [];
let refGated: number[] = [];

function scoreBeats(est: number[]) {
  const e = within(est, gated);
  const off = offsetsMs(refGated, e);
  return {
    count: e.length,
    fMeasure: fMeasure(refGated, e),
    cmlt: cmlt(refGated, e),
    amlt: amlt(refGated, e),
    medianOffsetMs: median(off),
    offsetsMs: off.map(x => Math.round(x * 10) / 10),
  };
}

function perWindow(est: number[], bpmAt: (t: number) => number) {
  return ref.windows.map(w => {
    const r = ref.beats.filter(b => b >= w.start && b < w.end);
    const e = est.filter(b => b >= w.start && b < w.end);
    const bpm = bpmAt(w.end - 0.01);
    return {
      start: w.start, end: w.end, agree: w.agree, refBpm: w.bpm, bpm,
      tempo: w.bpm ? classifyTempo(bpm, w.bpm) : 'none',
      fMeasure: fMeasure(r, e),
    };
  });
}

async function evaluate(sampleRate: number, mode: 'dsp' | 'hybrid') {
  const neural = mode === 'hybrid';
  if (neural && !model) model = await createBeatModel(ort as never, new Uint8Array(readFileSync(modelPath)));
  const analyzer = new Analyzer(sampleRate, { neural });
  const baseline = sampleRate === 44100 && (mode === 'dsp' || !modes.includes('dsp')) ? new BaselineRunner(sampleRate) : null;
  const pendingNeural: { applyAt: number; t0: number; validFrom: number; act: Float32Array }[] = [];
  const decisions: { t: number; kind: string }[] = [];
  let neuralMs = 0;
  let neuralRuns = 0;
  const events: AnalyzerEvent[] = [];
  const timeline: { t: number; bpm: number; conf: number; locked: boolean; salience: number }[] = [];
  let nextSample = 0;
  const started = performance.now();
  const duration = await streamMono(audioPath, { sampleRate, block: 128 }, async block => {
    analyzer.process(block);
    if (neural) {
      const req = analyzer.takeNeuralRequest();
      if (req && model) {
        const t = performance.now();
        const act = await model.run(req.frames);
        neuralMs += performance.now() - t;
        neuralRuns++;
        pendingNeural.push({ applyAt: analyzer.state.time + NEURAL_LATENCY_S, t0: req.t0, validFrom: req.validFrom, act });
      }
      while (pendingNeural.length && pendingNeural[0].applyAt <= analyzer.state.time) {
        const p = pendingNeural.shift()!;
        const d = analyzer.applyNeural(p.t0, p.act, p.validFrom);
        if (d) decisions.push({ t: +analyzer.state.time.toFixed(2), kind: d.kind });
      }
    }
    for (const ev of analyzer.drainEvents()) events.push(ev);
    baseline?.process(block);
    const st = analyzer.state;
    if (st.time >= nextSample) {
      nextSample += 0.1;
      timeline.push({ t: +st.time.toFixed(2), bpm: +st.bpm.toFixed(2), conf: +st.confidence.toFixed(3), locked: st.locked, salience: +st.tempoSalience.toFixed(3) });
    }
  });
  const cpuMs = performance.now() - started;

  const beats = events.filter(e => e.type === 'beat');
  const allBeats = beats.map(b => b.time);
  const confident = beats.filter(b => b.confidence >= BEAT_CONFIDENCE_MIN).map(b => b.time);
  const bpmAt = (t: number) => {
    let v = 0;
    for (const p of timeline) { if (p.t <= t) v = p.bpm; else break; }
    return v;
  };
  const windows = perWindow(confident, bpmAt);
  const tempoWindows = windows.filter(w => w.agree && w.refBpm);
  const tempoAccuracy = tempoWindows.filter(w => w.tempo === 'correct').length / Math.max(1, tempoWindows.length);

  // Break -> drop: the quietest agreed-or-not window after 60 s marks the break.
  const breakWin = ref.windows.filter(w => w.start >= 60).reduce((a, b) => (b.rmsDb < a.rmsDb ? b : a));

  const result = {
    sampleRate,
    mode,
    neural: neural ? { runs: neuralRuns, avgMs: neuralRuns ? neuralMs / neuralRuns : 0, decisions } : null,
    duration,
    realtimeFactor: duration / (cpuMs / 1000),
    beats: { all: scoreBeats(allBeats), confident: scoreBeats(confident) },
    tempoAccuracy,
    lockTimeStart: lockTime(ref.beats, confident, 0),
    lockTimeAfterBreak: lockTime(ref.beats, confident, breakWin.end),
    windows,
    timeline,
    beatTimes: beats.map(b => ({ t: +b.time.toFixed(4), c: +b.confidence.toFixed(3) })),
    onsets: {
      kick: events.filter(e => e.type === 'kick').map(e => +e.time.toFixed(4)),
      snare: events.filter(e => e.type === 'snare').map(e => +e.time.toFixed(4)),
      hat: events.filter(e => e.type === 'hat').map(e => +e.time.toFixed(4)),
    },
    baselines: baseline?.results().map((b: BaselineResult) => ({
      name: b.name,
      description: b.description,
      ...scoreBeats(b.events),
      events: b.events.map(t => +t.toFixed(4)),
      bpmFinal: b.bpm?.length ? b.bpm[b.bpm.length - 1].bpm : null,
      bpmTimeline: b.bpm?.filter((_, i) => i % 6 === 0).map(p => ({ t: +p.time.toFixed(2), bpm: +p.bpm.toFixed(2) })),
    })),
  };
  return result;
}

function gatesFor(results: Awaited<ReturnType<typeof evaluate>>[], baselineBest: number) {
  const primary = results[0];
  const c = primary.beats.confident;
  return {
    fMeasure: { value: c.fMeasure, min: GATES.fMeasure, pass: c.fMeasure >= GATES.fMeasure },
    amlt: { value: c.amlt, min: GATES.amlt, pass: c.amlt >= GATES.amlt },
    tempoAccuracy: { value: primary.tempoAccuracy, min: GATES.tempoAccuracy, pass: primary.tempoAccuracy >= GATES.tempoAccuracy },
    medianOffsetMs: { value: c.medianOffsetMs, max: GATES.medianOffsetMs, pass: Math.abs(c.medianOffsetMs) <= GATES.medianOffsetMs },
    beatsBaseline: { value: c.fMeasure, baselineBest, pass: c.fMeasure > baselineBest + 0.2 },
    allRates: {
      values: results.map(r => ({ sampleRate: r.sampleRate, fMeasure: r.beats.confident.fMeasure })),
      pass: results.every(r => r.beats.confident.fMeasure >= GATES.fMeasure),
    },
  };
}

const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d));
const excerpts = [];
for (const ex of manifest.excerpts) {
  if (only && ex.id !== only) continue;
  audioPath = excerptPath(ex.id);
  ref = JSON.parse(readFileSync(`tests/fixtures/${ex.id}.reference.json`, 'utf8'));
  const agreed: [number, number][] = ref.windows.filter(w => w.agree).map(w => [w.start, w.end]);
  gated = agreed.map(([a, b]) => [Math.max(a, WARMUP_S), b] as [number, number]).filter(([a, b]) => b > a);
  refGated = within(ref.beats, gated);
  const results = [];
  const gatesByMode: Record<string, ReturnType<typeof gatesFor>> = {};
  for (const mode of modes) {
    const rs = [];
    for (const sr of rates) rs.push(await evaluate(sr, mode));
    results.push(...rs);
  }
  const withBaseline = results.find(r => r.baselines?.length);
  const baselineBest = withBaseline ? Math.max(...withBaseline.baselines!.map(b => b.fMeasure)) : NaN;
  for (const mode of modes) gatesByMode[mode] = gatesFor(results.filter(r => r.mode === mode), baselineBest);
  const gates = gatesByMode[modes.includes('hybrid') ? 'hybrid' : modes[0]];
  excerpts.push({ ...ex, refGridBpm: ref.grid.bpm, gatedRanges: gated, gates, gatesByMode, results });

  console.log(`\n=== ${ex.id} (${ex.role}) reference ~${ref.grid.bpm.toFixed(1)} BPM`);
  for (const r of results) {
    const a = r.beats.all, k = r.beats.confident;
    console.log(`[${r.mode} ${r.sampleRate} Hz]  ${fmt(r.realtimeFactor, 0)}x realtime${r.neural ? `  neural ${r.neural.runs} runs, ${fmt(r.neural.avgMs, 0)} ms avg, decisions ${r.neural.decisions.map(d => d.kind[0]).join('')}` : ''}`);
    console.log(`  all beats      F=${fmt(a.fMeasure)} CMLt=${fmt(a.cmlt)} AMLt=${fmt(a.amlt)} offset=${fmt(a.medianOffsetMs, 1)}ms n=${a.count}`);
    console.log(`  confident      F=${fmt(k.fMeasure)} CMLt=${fmt(k.cmlt)} AMLt=${fmt(k.amlt)} offset=${fmt(k.medianOffsetMs, 1)}ms n=${k.count}`);
    console.log(`  tempo windows  ${fmt(r.tempoAccuracy)}  lock@start=${fmt(r.lockTimeStart, 2)}s lock@afterBreak=${fmt(r.lockTimeAfterBreak, 2)}s`);
    console.log(`  windows: ${r.windows.map(w => `${w.start}:${w.bpm.toFixed(1)}/${(w.refBpm ?? 0).toFixed(1)}/${w.fMeasure.toFixed(2)}${w.agree ? '' : '*'}`).join(' ')}`);
    for (const b of r.baselines ?? []) {
      console.log(`  baseline ${b.name.padEnd(28)} F=${fmt(b.fMeasure)} AMLt=${fmt(b.amlt)} n=${b.count}${b.bpmFinal ? ` bpm=${b.bpmFinal.toFixed(1)}` : ''}`);
    }
  }
  for (const [k, g] of Object.entries(gates)) console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${k}  ${JSON.stringify(g)}`);
}

const report = { generated: new Date().toISOString(), warmupS: WARMUP_S, confidenceMin: BEAT_CONFIDENCE_MIN,
  gateThresholds: GATES, neuralLatencyS: NEURAL_LATENCY_S, excerpts };
mkdirSync(dirname(outPath), { recursive: true });
mkdirSync('.cache/eval', { recursive: true });
// full per-beat data stays local; the committed file is compact
writeFileSync(`.cache/eval/${outPath.split('/').pop()!.replace('.json', '')}-full.json`, JSON.stringify(report));
writeFileSync(outPath, JSON.stringify(compactReport(report)));
const allPass = excerpts.every(e => Object.values(e.gates).every(g => g.pass));
console.log(`\n${allPass ? 'ALL GATES PASS' : 'SOME GATES FAIL'} (${excerpts.length} excerpts)`);
process.exitCode = allPass ? 0 : 1;
