/**
 * Offline evaluation of the audio engine against the independent reference beats, on every
 * excerpt of a manifest: scripts/eval/excerpts.json (the DJ mix, default) or
 * scripts/eval/genres.json (the genre excerpts from the user's local music library).
 *
 *   node scripts/eval/eval-mix.ts [--manifest path] [--styles auto,matching] [--only <id,id...>]
 *     [--roles tuning] [--out path] [--rates 44100,48000] [--modes dsp,hybrid]
 *
 * The excerpt is streamed from ffmpeg in 128-sample blocks (exactly the AudioWorklet render
 * quantum) through the causal Analyzer, so the numbers are what the live engine produces.
 * On the mix, the pre-rewrite detectors are replayed on the same audio as the baseline.
 *
 * `--styles` runs every excerpt with each Music style (`matching` = the excerpt's own style from
 * the manifest); the first one is the primary result that the gates are reported for.
 * Beats are scored as fired: only *pulse* beats (the half-time pulse fires every other tracked
 * beat) with confidence >= 0.3 reach the visualizers.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as ort from 'onnxruntime-web';
import { Analyzer, type AnalyzerEvent } from '../../src/audio/core/Analyzer.ts';
import { createBeatModel, type BeatModel } from '../../src/audio/neural/beatModel.ts';
import { BaselineRunner, type BaselineResult } from './lib/baselines.ts';
import { amlt, classifyTempo, cmlt, fMeasure, lockTime, median, offsetsMs, within } from './lib/metrics.ts';
import { bpmOf, buildPulseRefs, pulseFromRule, type PulseRef } from './lib/pulse.ts';
import { streamMono } from './lib/stream.ts';
import { compactReport } from './lib/compact.ts';
import { DEFAULT_MANIFEST, excerptPath, loadManifest, type Excerpt } from './prepare-audio.ts';

/** Beats below this confidence are not surfaced to visualizers as `isBeat`. */
export const BEAT_CONFIDENCE_MIN = 0.3;
const WARMUP_S = 5;

const GATES = {
  fMeasure: 0.8,
  amlt: 0.9,
  tempoAccuracy: 0.9,
  medianOffsetMs: 20,
};
/** Genre excerpts: pulse F at the expected pulse, tracking continuity, stability. */
const GENRE_GATES = {
  pulseF: 0.8,
  pulseFChill: 0.7,
  amlt: 0.9,
  medianOffsetMs: 20,
  /** Tempo/pulse level changes allowed after the first 15 s. */
  levelChanges: 1,
  /** Song-change clips: seconds from the new song's established beat until four of its beats are matched. */
  recoveryS: 6,
};

interface Reference {
  duration: number;
  excerpt: { start: number; seconds: number };
  beats: number[];
  downbeats?: number[];
  crossCheckBeats?: number[];
  crossCheckDownbeats?: number[];
  windows: { start: number; end: number; bpm: number | null; agree: boolean; agreeAnyLevel?: boolean; rmsDb: number }[];
  grid: { bpm: number };
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const manifestPath = arg('manifest', DEFAULT_MANIFEST);
const manifest = loadManifest(manifestPath);
const isGenre = manifest.excerpts.some(e => e.file);
const outPath = arg('out', isGenre ? 'docs/reports/data/eval-genres.json' : 'docs/reports/data/eval-mix.json');
const rates = arg('rates', '44100,48000').split(',').map(Number);
const only = arg('only', '').split(',').filter(Boolean);
const roles = arg('roles', '').split(',').filter(Boolean);
const modes = arg('modes', 'dsp,hybrid').split(',') as ('dsp' | 'hybrid')[];
/** Music styles to run ('' = the Analyzer's default). */
const styles = arg('styles', isGenre ? 'auto,matching' : 'auto').split(',');
const modelPath = arg('model', 'public/models/beat_this_small0.onnx');
/** Experiments only: tracker tuning overrides (JSON), applied on top of every style. */
const tuning = JSON.parse(arg('tuning', '{}'));
/** Withhold the model's downbeats (reproduces the 0.30.0 engine, which ignored them). */
const noDownbeats = process.argv.includes('--no-downbeats');
/** Disable song-change detection (with --no-downbeats: the 0.30.0 engine). */
const noSongChange = process.argv.includes('--no-song-change');
/** Stream seconds between a neural request and applying its result (models async inference). */
const NEURAL_LATENCY_S = 1.0;
ort.env.wasm.numThreads = 1;
let model: BeatModel | null = null;

// Per-excerpt context (set in the main loop)
let excerpt: Excerpt;
let audioPath = '';
let ref: Reference;
let gated: [number, number][] = [];
let refGated: number[] = [];
let pulseRefs: PulseRef[] = [];

function scoreBeats(est: number[], reference = refGated) {
  const e = within(est, gated);
  const off = offsetsMs(reference, e);
  return {
    count: e.length,
    fMeasure: fMeasure(reference, e),
    cmlt: cmlt(reference, e),
    amlt: amlt(reference, e),
    medianOffsetMs: median(off),
    offsetsMs: off.map(x => Math.round(x * 10) / 10),
  };
}

/** The excerpt's expected pulse: given, or resolved from its pulse rule and the reference tempo. */
let expectedPulse: number | null | undefined;
/** Whether madmom's and beat_this's downbeats disagree (F < 0.5) on this excerpt. */
let barsDisagree = false;
/** Song-change clips: when the new song's beat is established (both references agree on 4 beats). */
let beatStartsAt: number | null = null;

/** Pulse score: against the primary expected-pulse reference, or the best level when none is expected. */
function scorePulse(pulses: number[]) {
  const scored = pulseRefs.map(p => ({ name: p.name, bpm: p.bpm, ...scoreBeats(pulses, within(p.beats, gated)) }));
  if (!scored.length) return null;
  // With an expected pulse, the first reference at that pulse is primary - unless the two
  // trackers place the bar differently (madmom's downbeats are unreliable on some songs): then
  // the half-time pulse on bar beats 1+3 of either tracker counts.
  let primary = expectedPulse ? scored[0] : scored.reduce((a, b) => (b.fMeasure > a.fMeasure ? b : a));
  if (expectedPulse && barsDisagree) {
    const h13 = scored.filter(s => s.name.endsWith('(bar beats 1+3)'));
    if (h13.length) primary = h13.reduce((a, b) => (b.fMeasure > a.fMeasure ? b : a));
  }
  return { ...primary, reference: primary.name, alternatives: scored.map(s => ({ name: s.name, bpm: s.bpm, fMeasure: s.fMeasure })) };
}

/**
 * Song-change clips: seconds from the change until four consecutive reference beats of the new
 * song are matched (any metrical level: madmom, beat_this, or madmom at half tempo, either
 * parity), and the confident beats fired in between that match no reference beat.
 */
function scoreRecovery(tracked: number[]) {
  const at = excerpt.changeAt;
  if (at === undefined) return { seconds: null, wrongBeats: null, fromBeatStart: null };
  const after = (xs: number[]) => xs.filter(t => t >= at);
  const levels = [ref.beats, ref.crossCheckBeats ?? [], ref.beats.filter((_, i) => i % 2 === 0), ref.beats.filter((_, i) => i % 2 === 1)]
    .map(after).filter(r => r.length >= 4);
  const locks = levels.map(r => lockTime(r, tracked, at)).filter((v): v is number => v !== null);
  const seconds = locks.length ? Math.min(...locks) : null;
  const until = seconds === null ? Infinity : at + seconds;
  const all = levels.flat();
  const wrongBeats = tracked.filter(t => t >= at && t < until && !all.some(r => Math.abs(r - t) <= 0.07)).length;
  // the same, counted from when the new song's beat is established
  const fromBeatStart = seconds === null || beatStartsAt === null ? null : Math.max(0, at + seconds - beatStartsAt);
  return { seconds, wrongBeats, fromBeatStart, beatStartsAt };
}

/**
 * Downbeats: confident tracked beats on bar position 0 against the reference downbeats (madmom,
 * and beat_this where available), in the gated windows; plus the share of time the bar is known.
 */
function scoreDownbeats(beats: AnalyzerEvent[], timeline: { t: number; bar: number }[]) {
  const known = timeline.filter(p => p.t >= WARMUP_S && within([p.t], gated).length);
  const coverage = known.length ? known.filter(p => p.bar >= 0).length / known.length : 0;
  const est = within(beats.filter(b => (b as { bar?: number }).bar === 0).map(b => b.time), gated);
  if (!ref.downbeats?.length) return { coverage, count: est.length, fMeasure: null, fMeasureCrossCheck: null };
  const f = (r: number[]) => fMeasure(within(r, gated), est);
  return {
    coverage, count: est.length,
    fMeasure: f(ref.downbeats),
    fMeasureCrossCheck: ref.crossCheckDownbeats?.length ? f(ref.crossCheckDownbeats) : null,
  };
}

function perWindow(est: number[], bpmAt: (t: number) => number) {
  return ref.windows.map(w => {
    const r = ref.beats.filter(b => b >= w.start && b < w.end);
    const e = est.filter(b => b >= w.start && b < w.end);
    const bpm = bpmAt(w.end - 0.01);
    return {
      start: w.start, end: w.end, agree: w.agree, agreeAnyLevel: w.agreeAnyLevel ?? w.agree, refBpm: w.bpm, bpm,
      tempo: w.bpm ? classifyTempo(bpm, w.bpm) : 'none',
      fMeasure: fMeasure(r, e),
    };
  });
}

/** Level changes after `from` s: jumps of more than 10 % between consecutive timeline points. */
function levelChanges(values: { t: number; v: number }[], from = 15): number {
  let n = 0;
  let prev = 0;
  for (const p of values) {
    if (p.t < from || !p.v) continue;
    if (prev && Math.abs(p.v / prev - 1) > 0.1) n++;
    prev = p.v;
  }
  return n;
}

async function evaluate(sampleRate: number, mode: 'dsp' | 'hybrid', style: string) {
  const neural = mode === 'hybrid';
  if (neural && !model) model = await createBeatModel(ort as never, new Uint8Array(readFileSync(modelPath)));
  const analyzer = new Analyzer(sampleRate, { neural, tuning, songChange: !noSongChange, ...(style ? { style: style as never } : {}) });
  const baseline = !isGenre && sampleRate === 44100 && (mode === 'dsp' || !modes.includes('dsp')) && style === styles[0]
    ? new BaselineRunner(sampleRate) : null;
  const pendingNeural: { applyAt: number; t0: number; validFrom: number; act: Float32Array; down: Float32Array }[] = [];
  const decisions: { t: number; kind: string; reason?: string; bpm?: number; clockBpm: number }[] = [];
  let neuralMs = 0;
  let neuralRuns = 0;
  const events: AnalyzerEvent[] = [];
  const timeline: { t: number; bpm: number; conf: number; locked: boolean; salience: number; raw: number; div: number; pulseBpm: number; bar: number }[] = [];
  let nextSample = 0;
  const started = performance.now();
  const duration = await streamMono(audioPath, { sampleRate, block: 128 }, async block => {
    analyzer.process(block);
    if (neural) {
      const req = analyzer.takeNeuralRequest();
      if (req && model) {
        const t = performance.now();
        const { beat: act, downbeat: down } = await model.run(req.frames);
        neuralMs += performance.now() - t;
        neuralRuns++;
        pendingNeural.push({ applyAt: analyzer.state.time + NEURAL_LATENCY_S, t0: req.t0, validFrom: req.validFrom, act, down });
      }
      while (pendingNeural.length && pendingNeural[0].applyAt <= analyzer.state.time) {
        const p = pendingNeural.shift()!;
        const d = analyzer.applyNeural(p.t0, p.act, p.validFrom, noDownbeats ? undefined : p.down);
        if (d) decisions.push({
          t: +analyzer.state.time.toFixed(2), kind: d.kind,
          ...(d.kind === 'none' ? { reason: d.reason, ...(d.bpm ? { bpm: +d.bpm.toFixed(1) } : {}) } : {}),
          ...(d.kind === 'retime' ? { bpm: +(60 / d.period).toFixed(1) } : {}),
          clockBpm: +analyzer.state.bpm.toFixed(1),
        });
      }
    }
    for (const ev of analyzer.drainEvents()) events.push(ev);
    baseline?.process(block);
    const st = analyzer.state as typeof analyzer.state & { tempoCandidateBpm?: number; pulseDivisor?: number; pulsePeriod?: number };
    if (st.time >= nextSample) {
      nextSample += 0.1;
      const div = st.pulseDivisor ?? 1;
      timeline.push({
        t: +st.time.toFixed(2), bpm: +st.bpm.toFixed(2), conf: +st.confidence.toFixed(3), locked: st.locked,
        salience: +st.tempoSalience.toFixed(3), raw: +(st.tempoCandidateBpm ?? 0).toFixed(1), div,
        pulseBpm: +(st.bpm / div).toFixed(2),
        bar: (st as { barPhase?: number }).barPhase ?? -1,
      });
    }
  });
  const cpuMs = performance.now() - started;

  const beats = events.filter(e => e.type === 'beat');
  const isPulse = (b: AnalyzerEvent) => (b as { pulse?: boolean }).pulse !== false;
  const allBeats = beats.filter(isPulse).map(b => b.time);
  const confidentBeats = beats.filter(b => b.confidence >= BEAT_CONFIDENCE_MIN);
  const confident = confidentBeats.filter(isPulse).map(b => b.time);
  const trackedConfident = confidentBeats.map(b => b.time);
  const bpmAt = (t: number) => {
    let v = 0;
    for (const p of timeline) { if (p.t <= t) v = p.pulseBpm; else break; }
    return v;
  };
  const windows = perWindow(confident, bpmAt);
  const tempoWindows = windows.filter(w => w.agree && w.refBpm);
  const tempoAccuracy = tempoWindows.filter(w => w.tempo === 'correct').length / Math.max(1, tempoWindows.length);

  // Break -> drop: the quietest agreed-or-not window after 60 s marks the break.
  const late = ref.windows.filter(w => w.start >= 60);
  const breakWin = late.length ? late.reduce((a, b) => (b.rmsDb < a.rmsDb ? b : a)) : null;

  const trackingAmlt = Math.max(amlt(refGated, within(trackedConfident, gated)),
    ref.crossCheckBeats ? amlt(within(ref.crossCheckBeats, gated), within(trackedConfident, gated)) : 0);

  const result = {
    sampleRate,
    mode,
    style: style || 'default',
    neural: neural ? { runs: neuralRuns, avgMs: neuralRuns ? neuralMs / neuralRuns : 0, decisions } : null,
    duration,
    realtimeFactor: duration / (cpuMs / 1000),
    beats: { all: scoreBeats(allBeats), confident: scoreBeats(confident) },
    pulse: isGenre ? scorePulse(confident) : null,
    trackingAmlt,
    pulseShare: trackedConfident.length ? confident.length / trackedConfident.length : 1,
    downbeats: scoreDownbeats(confidentBeats, timeline),
    levelChanges: {
      tempo: levelChanges(timeline.map(p => ({ t: p.t, v: p.bpm }))),
      pulse: levelChanges(timeline.map(p => ({ t: p.t, v: p.pulseBpm }))),
    },
    tempoAccuracy,
    lockTimeStart: lockTime(ref.beats, confident, 0),
    recovery: scoreRecovery(trackedConfident),
    lockTimeAfterBreak: breakWin ? lockTime(ref.beats, confident, breakWin.end) : null,
    windows,
    timeline,
    beatTimes: beats.map(b => ({ t: +b.time.toFixed(4), c: +b.confidence.toFixed(3), p: isPulse(b) ? 1 : 0 })),
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

type Result = Awaited<ReturnType<typeof evaluate>>;

function gatesFor(results: Result[], baselineBest: number) {
  const primary = results[0];
  const c = primary.beats.confident;
  return {
    fMeasure: { value: c.fMeasure, min: GATES.fMeasure, pass: c.fMeasure >= GATES.fMeasure },
    amlt: { value: c.amlt, min: GATES.amlt, pass: c.amlt >= GATES.amlt },
    tempoAccuracy: { value: primary.tempoAccuracy, min: GATES.tempoAccuracy, pass: primary.tempoAccuracy >= GATES.tempoAccuracy },
    medianOffsetMs: { value: c.medianOffsetMs, max: GATES.medianOffsetMs, pass: Math.abs(c.medianOffsetMs) <= GATES.medianOffsetMs },
    beatsBaseline: { value: c.fMeasure, baselineBest, pass: !(c.fMeasure <= baselineBest + 0.2) },
    allRates: {
      values: results.map(r => ({ sampleRate: r.sampleRate, fMeasure: r.beats.confident.fMeasure })),
      pass: results.every(r => r.beats.confident.fMeasure >= GATES.fMeasure),
    },
    // the DJ mix is four-on-the-floor: every tracked beat must also fire (no half-time pulse)
    everyBeatFires: { value: Math.min(...results.map(r => r.pulseShare)), min: 0.99, pass: results.every(r => r.pulseShare >= 0.99) },
  };
}

function genreGatesFor(results: Result[]) {
  const primary = results[0];
  const p = primary.pulse;
  if (excerpt.changeAt !== undefined) {
    // song-change clips: how fast the engine finds the new song's beat
    const rec = primary.recovery;
    return {
      recoveryS: { value: rec.fromBeatStart, max: GENRE_GATES.recoveryS, pass: rec.fromBeatStart !== null && rec.fromBeatStart <= GENRE_GATES.recoveryS },
    };
  }
  const pulseMin = excerpt.style === 'chill' ? GENRE_GATES.pulseFChill : GENRE_GATES.pulseF;
  const pulseF = p?.fMeasure ?? 0;
  return {
    pulseF: { value: pulseF, min: pulseMin, reference: p?.reference ?? null, pass: pulseF >= pulseMin },
    amlt: { value: primary.trackingAmlt, min: GENRE_GATES.amlt, pass: primary.trackingAmlt >= GENRE_GATES.amlt },
    medianOffsetMs: { value: p?.medianOffsetMs ?? NaN, max: GENRE_GATES.medianOffsetMs, pass: Math.abs(p?.medianOffsetMs ?? Infinity) <= GENRE_GATES.medianOffsetMs },
    levelChanges: {
      value: Math.max(primary.levelChanges.tempo, primary.levelChanges.pulse), max: GENRE_GATES.levelChanges,
      pass: primary.levelChanges.tempo <= GENRE_GATES.levelChanges && primary.levelChanges.pulse <= GENRE_GATES.levelChanges,
    },
    allRates: {
      values: results.map(r => ({ sampleRate: r.sampleRate, pulseF: r.pulse?.fMeasure ?? 0 })),
      pass: results.every(r => (r.pulse?.fMeasure ?? 0) >= pulseMin),
    },
  };
}

const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d));
const excerpts = [];
for (const ex of manifest.excerpts) {
  if (only.length && !only.includes(ex.id)) continue;
  if (roles.length && !roles.includes(ex.role)) continue;
  excerpt = ex;
  audioPath = excerptPath(ex.id);
  ref = JSON.parse(readFileSync(`tests/fixtures/${ex.id}.reference.json`, 'utf8'));
  // genre excerpts gate on windows where the two references agree at *some* metrical level
  const agreed: [number, number][] = ref.windows.filter(w => (isGenre ? (w.agreeAnyLevel ?? w.agree) : w.agree)).map(w => [w.start, w.end]);
  gated = agreed.map(([a, b]) => [Math.max(a, WARMUP_S), b] as [number, number]).filter(([a, b]) => b > a);
  refGated = within(ref.beats, gated);
  expectedPulse = ex.expectedPulseBpm ?? pulseFromRule(ex.pulseRule,
    bpmOf(ex.changeAt !== undefined ? ref.beats.filter(t => t >= ex.changeAt!) : ref.beats));
  pulseRefs = isGenre ? buildPulseRefs(ref, expectedPulse) : [];
  barsDisagree = !!(ref.downbeats?.length && ref.crossCheckDownbeats?.length) && fMeasure(ref.downbeats!, ref.crossCheckDownbeats!) < 0.5;
  beatStartsAt = null;
  if (ex.changeAt !== undefined) {
    // the new song's beat is established once both references (any metrical level) agree on
    // four consecutive beats; a song may start with a beatless intro
    const bt = ref.crossCheckBeats ?? [];
    const agreeing = ref.beats.filter(b => b >= ex.changeAt! && (bt.some(x => Math.abs(x - b) <= 0.07)));
    for (let i = 0; i + 3 < agreeing.length; i++) {
      const gaps = [1, 2, 3].map(k => agreeing[i + k] - agreeing[i + k - 1]);
      if (Math.max(...gaps) < 1.5 * Math.min(...gaps)) { beatStartsAt = agreeing[i]; break; }
    }
  }
  const results: Result[] = [];
  const gatesByStyle: Record<string, Record<string, ReturnType<typeof gatesFor> | ReturnType<typeof genreGatesFor>>> = {};
  for (const s of styles) {
    const style = s === 'matching' ? (ex.style ?? '') : s;
    for (const mode of modes) {
      for (const sr of rates) results.push(await evaluate(sr, mode, style));
    }
  }
  const withBaseline = results.find(r => r.baselines?.length);
  const baselineBest = withBaseline ? Math.max(...withBaseline.baselines!.map(b => b.fMeasure)) : NaN;
  for (const s of styles) {
    const style = (s === 'matching' ? (ex.style ?? '') : s) || 'default';
    const key = s === 'matching' ? 'matching' : style;
    gatesByStyle[key] = {};
    for (const mode of modes) {
      const rs = results.filter(r => r.mode === mode && r.style === style);
      gatesByStyle[key][mode] = isGenre ? genreGatesFor(rs) : gatesFor(rs, baselineBest);
    }
  }
  const primaryKey = Object.keys(gatesByStyle)[0];
  const gatesByMode = gatesByStyle[primaryKey];
  const gates = gatesByMode[modes.includes('hybrid') ? 'hybrid' : modes[0]];
  excerpts.push({ ...ex, refGridBpm: ref.grid.bpm, gatedRanges: gated, pulseRefs: pulseRefs.map(p => ({ name: p.name, bpm: p.bpm })), gates, gatesByMode, gatesByStyle, results });

  console.log(`\n=== ${ex.id} (${ex.role}) reference ~${ref.grid.bpm.toFixed(1)} BPM${isGenre ? `, expected pulse ${expectedPulse ? expectedPulse.toFixed(0) : 'either'}` : ''}${ex.changeAt !== undefined ? `, song change at ${ex.changeAt} s` : ''}`);
  for (const r of results) {
    const a = r.beats.all, k = r.beats.confident;
    console.log(`[${r.style} ${r.mode} ${r.sampleRate} Hz]  ${fmt(r.realtimeFactor, 0)}x realtime${r.neural ? `  neural ${r.neural.runs} runs, ${fmt(r.neural.avgMs, 0)} ms avg, decisions ${r.neural.decisions.map(d => d.kind[0]).join('')}` : ''}`);
    if (r.pulse) {
      console.log(`  pulse          F=${fmt(r.pulse.fMeasure)} vs ${r.pulse.reference} (${fmt(r.pulse.bpm, 1)} BPM) offset=${fmt(r.pulse.medianOffsetMs, 1)}ms n=${r.pulse.count}  [${r.pulse.alternatives.map(x => `${x.name} ${fmt(x.fMeasure, 2)}`).join(', ')}]`);
      console.log(`  tracking       AMLt=${fmt(r.trackingAmlt)}  level changes tempo=${r.levelChanges.tempo} pulse=${r.levelChanges.pulse}  pulse share=${fmt(r.pulseShare, 2)}`);
    } else {
      console.log(`  all beats      F=${fmt(a.fMeasure)} CMLt=${fmt(a.cmlt)} AMLt=${fmt(a.amlt)} offset=${fmt(a.medianOffsetMs, 1)}ms n=${a.count}`);
      console.log(`  confident      F=${fmt(k.fMeasure)} CMLt=${fmt(k.cmlt)} AMLt=${fmt(k.amlt)} offset=${fmt(k.medianOffsetMs, 1)}ms n=${k.count}`);
      console.log(`  tempo windows  ${fmt(r.tempoAccuracy)}  lock@start=${fmt(r.lockTimeStart, 2)}s lock@afterBreak=${fmt(r.lockTimeAfterBreak, 2)}s  pulse share=${fmt(r.pulseShare, 2)}`);
    }
    if (r.recovery.seconds !== null || excerpt.changeAt !== undefined) console.log(`  recovery       ${fmt(r.recovery.seconds, 1)} s after the change (${fmt(r.recovery.fromBeatStart, 1)} s after the new beat starts at ${fmt(r.recovery.beatStartsAt, 1)} s), ${r.recovery.wrongBeats ?? '-'} wrong beats in between`);
    if (r.mode === 'hybrid') console.log(`  downbeats      F=${fmt(r.downbeats.fMeasure)} (beat_this ${fmt(r.downbeats.fMeasureCrossCheck)}) n=${r.downbeats.count} bar known ${fmt(100 * r.downbeats.coverage, 0)}% of the time`);
    console.log(`  windows: ${r.windows.map(w => `${w.start}:${w.bpm.toFixed(1)}/${(w.refBpm ?? 0).toFixed(1)}/${w.fMeasure.toFixed(2)}${w.agree ? '' : '*'}`).join(' ')}`);
    const reasons = (r.neural?.decisions ?? []).filter(d => d.reason).map(d => `${d.t}:${d.reason}`);
    if (reasons.length) console.log(`  abstentions: ${reasons.join(' | ')}`);
    for (const b of r.baselines ?? []) {
      console.log(`  baseline ${b.name.padEnd(28)} F=${fmt(b.fMeasure)} AMLt=${fmt(b.amlt)} n=${b.count}${b.bpmFinal ? ` bpm=${b.bpmFinal.toFixed(1)}` : ''}`);
    }
  }
  for (const [key, byMode] of Object.entries(gatesByStyle)) {
    for (const [mode, g] of Object.entries(byMode)) {
      const fails = Object.entries(g).filter(([, v]) => !v.pass).map(([n]) => n);
      console.log(`  ${fails.length ? 'FAIL' : 'PASS'}  ${key}/${mode}${fails.length ? `  (${fails.join(', ')})` : ''}`);
    }
  }
}

const report = { generated: new Date().toISOString(), manifest: manifestPath, styles, warmupS: WARMUP_S, confidenceMin: BEAT_CONFIDENCE_MIN,
  gateThresholds: isGenre ? GENRE_GATES : GATES, neuralLatencyS: NEURAL_LATENCY_S, excerpts };
mkdirSync(dirname(outPath), { recursive: true });
mkdirSync('.cache/eval', { recursive: true });
// full per-beat data stays local; the committed file is compact
writeFileSync(`.cache/eval/${outPath.split('/').pop()!.replace('.json', '')}-full.json`, JSON.stringify(report));
writeFileSync(outPath, JSON.stringify(compactReport(report)));
const allPass = excerpts.every(e => Object.values(e.gates).every(g => g.pass));
console.log(`\n${allPass ? 'ALL GATES PASS' : 'SOME GATES FAIL'} (${excerpts.length} excerpts, primary style ${styles[0]})`);
process.exitCode = allPass ? 0 : 1;
