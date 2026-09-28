/**
 * Reduces a full evaluation result (per-beat arrays, 10 Hz timelines) to what the report
 * needs, so the committed data stays small. The full data is kept in .cache/eval/.
 */
type Json = Record<string, any>;

function histogram(values: number[], lo = -70, hi = 70, width = 5): { lo: number; width: number; counts: number[] } {
  const counts = new Array(Math.round((hi - lo) / width)).fill(0);
  for (const v of values) {
    const i = Math.floor((v - lo) / width);
    if (i >= 0 && i < counts.length) counts[i]++;
  }
  return { lo, width, counts };
}

function compactBeats(b: Json): Json {
  const { offsetsMs, ...rest } = b;
  return { ...rest, offsetHistogram: histogram(offsetsMs ?? []) };
}

export function compactResult(r: Json): Json {
  const decisions: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  for (const d of r.neural?.decisions ?? []) {
    decisions[d.kind] = (decisions[d.kind] ?? 0) + 1;
    if (d.reason) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  }
  return {
    sampleRate: r.sampleRate,
    mode: r.mode,
    style: r.style,
    duration: r.duration,
    realtimeFactor: r.realtimeFactor,
    neural: r.neural ? { runs: r.neural.runs, avgMs: r.neural.avgMs, decisions, reasons } : null,
    beats: { all: compactBeats(r.beats.all), confident: compactBeats(r.beats.confident) },
    pulse: r.pulse ? compactBeats(r.pulse) : null,
    trackingAmlt: r.trackingAmlt,
    pulseShare: r.pulseShare,
    downbeats: r.downbeats,
    recovery: r.recovery,
    levelChanges: r.levelChanges,
    tempoAccuracy: r.tempoAccuracy,
    lockTimeStart: r.lockTimeStart,
    lockTimeAfterBreak: r.lockTimeAfterBreak,
    windows: r.windows,
    timeline: (r.timeline ?? []).filter((_: Json, i: number) => i % 10 === 0),
    baselines: r.baselines?.map((b: Json) => ({
      name: b.name, description: b.description, count: b.count, fMeasure: b.fMeasure, cmlt: b.cmlt, amlt: b.amlt,
      medianOffsetMs: b.medianOffsetMs, bpmFinal: b.bpmFinal,
      bpmTimeline: (b.bpmTimeline ?? []).filter((_: Json, i: number) => i % 4 === 0),
    })),
  };
}

export function compactReport(full: Json): Json {
  return { ...full, excerpts: full.excerpts.map((e: Json) => ({ ...e, results: e.results.map(compactResult) })) };
}
