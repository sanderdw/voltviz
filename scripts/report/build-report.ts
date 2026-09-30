/**
 * Builds the self-contained HTML evidence report docs/reports/audio-engine-report-<version>.html
 * (the version in package.json) from the committed evaluation data (docs/reports/data/*.json)
 * and assets. Reports of earlier versions stay next to it; the 0.23.0 report is
 * docs/reports/audio-engine-report.html.
 *
 *   npm run report
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { STYLE_PROFILES, type StyleId } from '../../src/audio/core/styles.ts';

type Json = Record<string, any>;
const DATA = 'docs/reports/data';
const load = (f: string): Json | null => (existsSync(`${DATA}/${f}`) ? JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8')) : null);
function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(3));
const f2 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(2));
const f0 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(0));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const badge = (ok: boolean, yes = 'pass', no = 'fail') =>
  `<span class="badge ${ok ? 'good' : 'bad'}" role="img" aria-label="${ok ? yes : no}">${ok ? '✓' : '✕'} ${ok ? yes : no}</span>`;

const parity = load('neural-parity.json');
const liveAll = load('live-all.json');
const liveDeep = load('live-deep.json');
const beforeAfter = load('before-after.json');
const agc = load('agc.json');
const skillProof = load('skill-proof.json');
const genres = load('eval-genres.json');
const genres023 = load('eval-genres-v0.23.json');
// live checks on genre excerpts: docs/reports/data/live-genre-<excerpt>.json (scripts/eval/live.ts --excerpt --style)
const liveGenres: Json[] = existsSync(DATA) ? readdirSync(DATA).filter(f => /^live-genre-.*\.json$/.test(f)).sort().map(f => load(f)!).filter(Boolean) : [];
const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const OUT = `docs/reports/audio-engine-report-${version}.html`;
const PREVIOUS = [
  { version: '0.30.0', file: 'audio-engine-report-0.30.0.html', note: 'the Music style setting' },
  { version: '0.23.0', file: 'audio-engine-report.html', note: 'the rewrite, measured on the DJ mix' },
];
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }

// ---------------------------------------------------------------------------------------
// SVG chart helpers (thin marks, hairline grid, hover tooltips via data-tip)
// ---------------------------------------------------------------------------------------
interface Series { name: string; cls: string; values: (number | null)[] }

function groupedBars(cats: string[], series: Series[], opts: { yMax: number; yTicks: number[]; height?: number; fmt?: (v: number) => string; title: string }): string {
  const W = 880, H = opts.height ?? 260, L = 44, R = 12, T = 12, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const gw = pw / cats.length;
  const bw = Math.min(16, (gw - 10) / series.length - 2);
  const y = (v: number) => T + ph - (v / opts.yMax) * ph;
  const fmt = opts.fmt ?? f3;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title)}">`;
  for (const t of opts.yTicks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>`;
  cats.forEach((c, i) => {
    const gx = L + i * gw + (gw - series.length * (bw + 2)) / 2;
    series.forEach((ser, k) => {
      const v = ser.values[i];
      if (v === null || Number.isNaN(v)) return;
      const x = gx + k * (bw + 2);
      const top = y(Math.max(0, v));
      const h = Math.max(1, T + ph - top);
      s += `<path class="mark ${ser.cls}" d="M${x},${T + ph} V${top + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${T + ph} Z" data-tip="${esc(`${c} · ${ser.name}: ${fmt(v)}`)}"/>`;
      if (h < 2) s += '';
    });
    s += `<text class="tick" x="${L + i * gw + gw / 2}" y="${T + ph + 16}" text-anchor="middle">${esc(c)}</text>`;
  });
  s += '</svg>';
  return s + legend(series);
}

function legend(series: { name: string; cls: string }[]): string {
  return `<div class="legend">${series.map(s => `<span><i class="key ${s.cls}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function lineChart(opts: { xs: number[][]; ys: number[][]; series: { name: string; cls: string; dots?: boolean }[]; xMin: number; xMax: number; yMin: number; yMax: number;
  yTicks: number[]; xTicks: number[]; xLabel: string; title: string; height?: number; fmtX?: (v: number) => string; fmtY?: (v: number) => string; zeroLine?: number }): string {
  const W = 880, H = opts.height ?? 240, L = 48, R = 12, T = 12, B = 36;
  const pw = W - L - R, ph = H - T - B;
  const x = (v: number) => L + ((v - opts.xMin) / (opts.xMax - opts.xMin)) * pw;
  const y = (v: number) => T + ph - ((v - opts.yMin) / (opts.yMax - opts.yMin)) * ph;
  const fx = opts.fmtX ?? ((v: number) => v.toFixed(1));
  const fy = opts.fmtY ?? ((v: number) => v.toFixed(2));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title)}">`;
  for (const t of opts.yTicks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  for (const t of opts.xTicks) s += `<text class="tick" x="${x(t)}" y="${T + ph + 16}" text-anchor="middle">${fx(t)}</text>`;
  s += `<text class="tick" x="${L + pw / 2}" y="${H - 4}" text-anchor="middle">${esc(opts.xLabel)}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>`;
  if (opts.zeroLine !== undefined) s += `<line class="axis" x1="${x(opts.zeroLine)}" x2="${x(opts.zeroLine)}" y1="${T}" y2="${T + ph}"/>`;
  opts.series.forEach((ser, k) => {
    const xs = opts.xs[k], ys = opts.ys[k];
    if (ser.dots) {
      xs.forEach((xv, i) => { if (Number.isFinite(ys[i])) s += `<circle class="dot ${ser.cls}" cx="${x(xv)}" cy="${y(ys[i])}" r="4"/>`; });
    } else {
      let d = '';
      xs.forEach((xv, i) => { if (Number.isFinite(ys[i])) d += `${d ? 'L' : 'M'}${x(xv).toFixed(1)},${y(Math.min(opts.yMax, Math.max(opts.yMin, ys[i]))).toFixed(1)}`; });
      s += `<path class="line ${ser.cls}" d="${d}"/>`;
    }
  });
  // hover bins: one invisible column per x of the first series carrying all values
  const xs0 = opts.xs[0];
  const step = xs0.length > 1 ? (x(xs0[1]) - x(xs0[0])) : pw;
  xs0.forEach((xv, i) => {
    const tip = `${fx(xv)} · ` + opts.series.map((ser, k) => {
      const j = opts.xs[k].findIndex(v => Math.abs(v - xv) < 1e-9);
      return `${ser.name}: ${j >= 0 && Number.isFinite(opts.ys[k][j]) ? fy(opts.ys[k][j]) : '–'}`;
    }).join(' · ');
    s += `<rect class="hit" x="${x(xv) - step / 2}" y="${T}" width="${Math.max(1, step)}" height="${ph}" data-tip="${esc(tip)}"/>`;
  });
  s += '</svg>';
  return s + (opts.series.length > 1 ? legend(opts.series) : '');
}

// ---------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------
// Genres (scripts/eval/genres.json; audio stays local, see the manifest)
const genreExcerpts: Json[] = genres?.excerpts ?? [];
const gRes = (set: Json | null, id: string, style: string, mode: string, sr = 44100) =>
  set?.excerpts.find((e: Json) => e.id === id)?.results.find((r: Json) => r.mode === mode && r.sampleRate === sr && r.style === style);
const g023 = (id: string, mode: string) => gRes(genres023, id, 'default', mode);
const gAuto = (id: string, mode: string) => gRes(genres, id, 'auto', mode);
const gStyle = (e: Json, mode: string) => gRes(genres, e.id, e.style, mode);
const pulseF = (r: Json | undefined) => r?.pulse?.fMeasure ?? null;
const gLabel = (e: Json) => `${e.id.replace(/^genre-/, '').replace(/-a$/, ' A').replace(/-b$/, ' B')}`;
const styleLabel = (id: string) => STYLE_PROFILES[id as StyleId]?.label ?? id;
const meanOf = (xs: (number | null)[]) => mean(xs.filter((v): v is number => v !== null && Number.isFinite(v)));
const genreRole = (role: string) => genreExcerpts.filter(e => e.role === role);
const genreSongs = new Set(genreExcerpts.map(e => e.file ?? e.id.replace(/-[ab]$/, ''))).size;
const styleAiF = meanOf(genreExcerpts.map(e => pulseF(gStyle(e, 'hybrid'))));
const styleDspF = meanOf(genreExcerpts.map(e => pulseF(gStyle(e, 'dsp'))));
const autoAiF = meanOf(genreExcerpts.map(e => pulseF(gAuto(e.id, 'hybrid'))));
const old023AiF = meanOf(genreExcerpts.map(e => pulseF(g023(e.id, 'hybrid'))));
const gatesPassed = genreExcerpts.filter(e => { const g = Object.values(e.gatesByStyle?.matching?.hybrid ?? {}); return g.length > 0 && g.every((v: any) => v.pass); }).length;

// Live QA (scripts/eval/live.ts): one excerpt, one segment per visualizer
const liveResults: Json[] = liveAll?.results ?? [];
const liveExcerpt = liveAll?.excerpt ? `the ${gLabel({ id: liveAll.excerpt })} excerpt` : 'a test excerpt';
const liveSeg = liveResults.find(r => r.segment);
const livePass = liveResults.filter(r => r.pass).length;
const liveFirstPass = liveResults.filter(r => (r.rerun ? r.rerun.firstRun?.pass : r.pass)).length;
const liveOffsets = liveResults.map(r => r.beat?.medianOffsetMs).filter((v: number) => Number.isFinite(v));
const liveOffsetMedian = liveOffsets.length ? [...liveOffsets].sort((a, b) => a - b)[liveOffsets.length >> 1] : NaN;

function tiles(): string {
  const t = (value: string, label: string, sub: string) => `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div><div class="tile-sub">${sub}</div></div>`;
  return `<div class="tiles">
    ${t(f3(styleAiF), 'Pulse F-measure, matching style', `AI on · ${genreExcerpts.length} genre excerpts · gates passed on ${gatesPassed}/${genreExcerpts.length}`)}
    ${t(f3(autoAiF), 'Pulse F-measure, Auto', 'AI on · same excerpts, default setting')}
    ${t(f3(old023AiF), '0.23 engine', 'AI on · same excerpts')}
    ${t(liveResults.length ? `${livePass}/${liveResults.length}` : '–', 'Visualizers pass live QA', liveResults.length ? `real app, real GPU, ${esc(liveExcerpt)} · first run ${liveFirstPass}/${liveResults.length}` : 'not run')}
    ${t(Number.isFinite(liveOffsetMedian) ? `${f0(liveOffsetMedian)} ms` : '–', 'Live beat timing', 'median offset of fired beats vs reference')}
  </div>`;
}

function architecture(): string {
  return `<svg viewBox="0 0 880 330" class="diagram" role="img" aria-label="Architecture: sources feed one AudioEngine; the analysis runs in an AudioWorklet with an optional neural worker; visualizers receive one AudioFrame per animation frame from the VisualizerHost.">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>
  <g class="box"><rect x="10" y="20" width="150" height="120" rx="8"/><text x="85" y="42" class="bt">Sources</text>
    <text x="85" y="64">Microphone</text><text x="85" y="82">System audio</text><text x="85" y="100">Sendspin</text><text x="85" y="118" class="muted">?testAudio (dev)</text></g>
  <g class="box engine"><rect x="200" y="10" width="420" height="190" rx="8"/><text x="410" y="32" class="bt">AudioEngine · one AudioContext</text></g>
  <g class="box"><rect x="215" y="45" width="190" height="140" rx="6"/><text x="310" y="65" class="bt">AudioWorklet</text>
    <text x="310" y="86">onset functions</text><text x="310" y="104">tempo (ACF + prior)</text><text x="310" y="122">predictive beat clock</text><text x="310" y="140">onsets · loudness</text><text x="310" y="158">log-mel frames</text><text x="310" y="176" class="muted">ScriptProcessor fallback</text></g>
  <g class="box"><rect x="425" y="45" width="180" height="60" rx="6"/><text x="515" y="68" class="bt">Neural Worker</text><text x="515" y="88">beat_this small0 (ONNX)</text></g>
  <g class="box"><rect x="425" y="120" width="180" height="65" rx="6"/><text x="515" y="142" class="bt">Display path</text><text x="515" y="160">Auto Gain → analyser pool</text><text x="515" y="176" class="muted">(fftSize, smoothing)</text></g>
  <g class="box"><rect x="660" y="20" width="210" height="160" rx="8"/><text x="765" y="42" class="bt">VisualizerHost</text>
    <text x="765" y="64">one rAF loop</text><text x="765" y="82">resize · DPR · errors</text><text x="765" y="100">AudioFrame per frame</text><text x="765" y="118">beat · onsets · bands</text><text x="765" y="136">spectrum · waveform</text><text x="765" y="160" class="muted">dev probe (QA)</text></g>
  <g class="box"><rect x="660" y="220" width="210" height="95" rx="8"/><text x="765" y="242" class="bt">56 renderer modules</text><text x="765" y="264">frame(audio, settings)</text><text x="765" y="282">resize · dispose</text><text x="765" y="300" class="muted">+ optional React overlay</text></g>
  <g class="box"><rect x="200" y="235" width="420" height="80" rx="8"/><text x="410" y="257" class="bt">React shell</text><text x="410" y="279">Header · Settings (Music style, Auto Gain, AI) · Sendspin bar</text><text x="410" y="297">picker · shuffle · crossfade stage · URL state</text></g>
  <path class="flow" d="M160,80 H213" marker-end="url(#arr)"/>
  <path class="flow" d="M405,75 H423" marker-end="url(#arr)"/><path class="flow" d="M425,95 H407" marker-end="url(#arr)"/>
  <path class="flow" d="M620,110 H658" marker-end="url(#arr)"/>
  <path class="flow" d="M765,180 V218" marker-end="url(#arr)"/>
  <path class="flow" d="M620,275 H658" marker-end="url(#arr)"/>
</svg>`;
}


function offsetHistogram(): string {
  const counts: number[] = [];
  let lo = -70, width = 5;
  for (const e of genreExcerpts) {
    const hist = gStyle(e, 'hybrid')?.pulse?.offsetHistogram;
    if (!hist) continue;
    lo = hist.lo; width = hist.width;
    hist.counts.forEach((c: number, i: number) => { counts[i] = (counts[i] ?? 0) + c; });
  }
  if (!counts.length) return '<p class="muted">Offset histogram not available.</p>';
  const cats = counts.map((_, i) => `${lo + i * width}`);
  const max = Math.max(...counts);
  const top = Math.max(10, Math.ceil(max / 10) * 10);
  return groupedBars(cats.map(c => (Number(c) % 20 === 0 ? c : '')), [{ name: 'Beats', cls: 's1', values: counts }],
    { yMax: top, yTicks: [0, top / 2, top], height: 200, fmt: v => `${v} beats`, title: 'Distribution of beat offsets (ms) relative to the reference' })
    .replace(/<div class="legend">.*<\/div>$/, '');
}

function neuralSection(): string {
  const runs = genreExcerpts.map(e => gStyle(e, 'hybrid')).filter((r): r is Json => !!r?.neural);
  if (!runs.length) return '<p class="muted">AI beat tracking evaluation not run.</p>';
  const dec: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.neural?.decisions ?? {})) dec[k] = (dec[k] ?? 0) + (v as number);
  const ms = mean(runs.map(r => r.neural?.avgMs).filter((v: number) => v > 0));
  return `<p>Every ~5 s (2.5 s while settling) the network looks at the last 10 s and the arbiter decides:
    <b>${dec.confirm ?? 0}</b> confirms (clock on the beat; the DSP may not jump phase for 12 s), <b>${dec.shift ?? 0}</b> metrical phase shifts,
    <b>${dec.retime ?? 0}</b> octave re-timings and <b>${dec.none ?? 0}</b> abstentions (too few or inconsistent beats) over ${runs.length} genre excerpt runs (matching Music style, 44.1 kHz).
    Inference averaged <b>${f0(ms)} ms</b> per 10 s window (WebAssembly, one thread, in Node; about 1 s in Chrome on this machine), in a Worker off the audio and render threads.</p>
    ${parity ? `<p>Front-end parity with beat_this in Python (same audio, same model): log-mel mean absolute difference <b>${f3(parity.melMeanAbsDiff)}</b>
    (mean level ${f2(parity.melMeanAbsRef)}), frame lag 0, and <b>${parity.peaksMatchedWithin1Frame}/${parity.pythonPeaks}</b> beat peaks identical within one 20 ms frame.</p>` : ''}`;
}

function genreChart(mode: string, title: string): string {
  return groupedBars(genreExcerpts.map(gLabel), [
    { name: '0.23 engine', cls: 's3', values: genreExcerpts.map(e => pulseF(g023(e.id, mode))) },
    { name: 'Auto', cls: 's2', values: genreExcerpts.map(e => pulseF(gAuto(e.id, mode))) },
    { name: 'The matching Music style', cls: 's1', values: genreExcerpts.map(e => pulseF(gStyle(e, mode))) },
  ], { yMax: 1, yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], title });
}

function genreTable(): string {
  const rows = genreExcerpts.map(e => {
    const g = e.gatesByStyle?.matching?.hybrid ?? {};
    const fails = Object.entries(g).filter(([, v]: [string, any]) => !v.pass).map(([k]) => k);
    const lv = (r: Json | undefined) => (r ? Math.max(r.levelChanges?.tempo ?? 0, r.levelChanges?.pulse ?? 0) : null);
    return `<tr><td>${esc(gLabel(e))}</td><td>${esc(e.role)}</td><td>${esc(styleLabel(e.style))}</td><td class="num">${e.expectedPulseBpm ?? 'either'}</td>
      <td class="num">${f3(pulseF(g023(e.id, 'dsp')))}</td><td class="num">${f3(pulseF(g023(e.id, 'hybrid')))}</td>
      <td class="num">${f3(pulseF(gAuto(e.id, 'dsp')))}</td><td class="num">${f3(pulseF(gAuto(e.id, 'hybrid')))}</td>
      <td class="num">${f3(pulseF(gStyle(e, 'dsp')))}</td><td class="num strong">${f3(pulseF(gStyle(e, 'hybrid')))}</td>
      <td class="num">${f3(gStyle(e, 'hybrid')?.trackingAmlt)}</td><td class="num">${lv(g023(e.id, 'hybrid')) ?? '–'} → ${lv(gStyle(e, 'hybrid')) ?? '–'}</td>
      <td>${badge(!fails.length)}${fails.length ? ` <span class="muted small">${esc(fails.join(', '))}</span>` : ''}</td></tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr><th>Excerpt</th><th>Role</th><th>Music style</th><th class="num">Pulse BPM</th>
    <th class="num">0.23 DSP</th><th class="num">0.23 AI</th><th class="num">Auto DSP</th><th class="num">Auto AI</th><th class="num">Style DSP</th><th class="num">Style AI</th>
    <th class="num">Style AI AMLt</th><th class="num">Level changes (AI)</th><th>Gates (style, AI)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function liveGenreTable(): string {
  if (!liveGenres.length) return '<p class="muted">Not run.</p>';
  const rows = liveGenres.flatMap(run => (run.results ?? []).map((r: Json) => `<tr><td>${esc(gLabel({ id: run.excerpt }))}</td><td>${esc(styleLabel(run.style))}</td><td>${esc(r.id)}</td>
    <td>${badge(!!r.pass)}</td><td>${esc(r.why ?? (r.error ? 'error' : ''))}</td><td class="num">${f2(r.beat?.fMeasure)}</td><td class="num">${f0(r.beat?.medianOffsetMs)}</td>
    <td class="num">${f0(r.fpsClean)}</td><td class="num">${r.errors?.length ?? '–'}</td></tr>`)).join('');
  return `<div class="scroll"><table class="compact"><thead><tr><th>Excerpt</th><th>Music style</th><th>Visualizer</th><th>Result</th><th>Because</th>
    <th class="num">Fired-beat F</th><th class="num">Offset ms</th><th class="num">FPS</th><th class="num">Errors</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted">Same harness and rules as the live check above, AI on, ${liveGenres[0].seconds ?? 20} s after an ${liveGenres[0].warmup ?? 8} s warm-up; the fired beats are scored against the expected pulse (the half-time pulse for dubstep).</p>`;
}

function liveTable(): string {
  if (!liveResults.length) return '<p class="muted">Live evaluation not run.</p>';
  const lockCell = (l: Json) => (l ? `${f2(l.ratio)}${l.p < 0.05 ? '*' : ''}` : '–');
  const rows = liveResults.map(r => `<tr><td>${esc(r.id)}</td><td>${r.beatDriven ? 'beat' : 'continuous'}</td><td>${badge(!!r.pass)}</td><td>${esc(r.why ?? (r.error ? 'error' : ''))}${r.rerun ? `<br><span class="muted small">${r.rerun.seconds} s re-run · first ${r.rerun.firstRun?.seconds ?? 20} s: ${r.rerun.firstRun?.pass ? 'pass' : 'fail'}</span>` : ''}</td>
    <td class="num">${lockCell(r.lockMotion)}</td><td class="num">${lockCell(r.lockLum)}</td>
    <td class="num">${f2(r.coupling?.r)}${r.coupling?.p < 0.05 ? '*' : ''}</td><td>${esc(r.coupling?.which ?? '')}</td>
    <td class="num">${f2(r.beat?.fMeasure)}</td><td class="num">${f0(r.fpsClean)}</td><td class="num">${r.errors?.length ?? '–'}</td></tr>`).join('');
  return `<div class="scroll"><table class="compact"><thead><tr><th>Visualizer</th><th>Kind</th><th>Result</th><th>Because</th>
    <th class="num">Beat lock (motion) ×</th><th class="num">Beat lock (lum) ×</th><th class="num">Audio r</th><th>Strongest pair</th><th class="num">Fired-beat F</th><th class="num">FPS</th><th class="num">Errors</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted"><b>Beat lock</b>: modulation depth of the frame motion (or luminance) folded onto the reference beat grid, relative to grids in which every beat is independently jittered by up to half a period (1.00 = no locking; * = p &lt; 0.05, 200 draws). Phase-agnostic, so a smoothed or delayed reaction still counts.
    <b>Audio r</b>: strongest correlation between a visual feature (luminance, motion) and an audio feature (level, bass, lit spectrum, kick envelope) in 250 ms bins; * = significant under a circular-shift permutation test that takes the same maximum over all 8 pairs.
    Rules: beat-driven visualizers need beat lock ≥ 1.3×; continuous ones beat lock ≥ 1.1× or |r| ≥ 0.25 (both significant); all must render, move and log no errors.
    <b>Fired-beat F</b> scores the frames in which the visualizer received <code>isBeat</code> against the reference (±70 ms); at low frame rates a frame simply lasts longer than the tolerance.
    ${liveResults.some(r => r.rerun) ? 'Visualizers that failed the first run were measured again over a longer stretch of the same excerpt; both verdicts are shown.' : ''}
    FPS measured with the probe's canvas read-back switched off. Renderer: ${esc(liveResults.find(r => r.renderer)?.renderer ?? 'n/a')}.</p>`;
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

function deepSection(): string {
  const res: Json[] = liveDeep?.results ?? [];
  if (!res.length) return '<p class="muted">Deep evaluation not run.</p>';
  const ids = [...new Set(res.map(r => r.id))];
  const segs = [...new Set(res.map(r => r.segment))];
  const clsFor = (seg: string) => ['s1', 's2', 's3'][segs.indexOf(seg)] ?? 's1';
  return `<div class="legend">${segs.map(s => `<span><i class="key ${clsFor(s)}"></i>${esc(s)}</span>`).join('')}</div><div class="multiples">${ids.map(id => {
    const rs = res.filter(r => r.id === id && r.lockMotion);
    if (!rs.length) return '';
    const n = rs[0].lockMotion.profile.length;
    const xs = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    const norm = (p: number[]) => { const m = p.filter(Number.isFinite).reduce((a, b) => a + b, 0) / p.length; return p.map(v => v / m); };
    const ys = rs.map(r => norm(r.lockMotion.profile));
    const all = ys.flat().filter(Number.isFinite);
    const yMax = Math.max(1.2, Math.ceil(Math.max(...all) * 10) / 10);
    const yMin = Math.min(0.8, Math.floor(Math.min(...all) * 10) / 10);
    const chart = lineChart({ xs: rs.map(() => xs), ys, series: rs.map(r => ({ name: r.segment, cls: clsFor(r.segment) })),
      xMin: 0, xMax: 1, yMin, yMax, yTicks: [yMin, 1, yMax], xTicks: [0, 0.25, 0.5, 0.75, 1], xLabel: 'position within the beat (0 = beat)', title: `${id}: frame motion across the beat`, height: 170,
      fmtX: v => v.toFixed(2), fmtY: v => `×${v.toFixed(2)}` }).replace(/<div class="legend">.*<\/div>$/, '');
    const shots = rs.find(r => r.shots?.length)?.shots ?? [];
    const beat = shots.find((s: Json) => s.kind === 'beat'), off = shots.find((s: Json) => s.kind === 'offbeat');
    const stats = rs.map(r => `${esc(r.segment)}: beat lock ×${f2(r.lock)} · fired-beat F ${f2(r.beat?.fMeasure)} · ${f0(r.fpsClean)} fps`).join('<br>');
    return `<figure class="multiple"><figcaption><b>${esc(id)}</b> ${badge(rs.every(r => r.pass), 'pass', 'fail')}</figcaption>${chart}
      ${beat && off ? `<div class="pair"><div><img class="thumb" alt="${esc(id)} on the beat" src="${beat.dataUrl}"><span>on the beat</span></div><div><img class="thumb" alt="${esc(id)} half-way between beats" src="${off.dataUrl}"><span>half-way between beats</span></div></div>` : ''}
      <p class="muted small">${stats}</p></figure>`;
  }).join('')}</div>`;
}

function dumbbell(ids: string[], before: (number | null)[], after: (number | null)[], title: string): string {
  const rowH = 22, L = 150, R = 20, T = 20, W = 880;
  const H = T + ids.length * rowH + 30;
  const vals = [...before, ...after].filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = 0.9, hi = Math.max(1.5, Math.ceil(Math.max(...vals) * 10) / 10);
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(title)}">`;
  for (let t = 1; t <= hi + 1e-9; t += 0.25) s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - 26}"/><text class="tick" x="${x(t)}" y="${H - 10}" text-anchor="middle">×${t.toFixed(2)}</text>`;
  ids.forEach((id, i) => {
    const y = T + i * rowH + rowH / 2;
    const b = before[i], a = after[i];
    s += `<text class="tick" x="${L - 10}" y="${y + 4}" text-anchor="end">${esc(id)}</text>`;
    if (b !== null && a !== null) s += `<line class="axis" x1="${x(b)}" x2="${x(a)}" y1="${y}" y2="${y}"/>`;
    if (b !== null) s += `<circle class="dot s3" cx="${x(b)}" cy="${y}" r="5" data-tip="${esc(`${id} · before: ×${f2(b)}`)}"/>`;
    if (a !== null) s += `<circle class="dot s1" cx="${x(a)}" cy="${y}" r="5" data-tip="${esc(`${id} · after: ×${f2(a)}`)}"/>`;
  });
  return s + '</svg>' + legend([{ name: 'Before (main)', cls: 's3' }, { name: 'After (this branch)', cls: 's1' }]);
}

function beforeAfterSection(): string {
  const res: Json[] = beforeAfter?.results ?? [];
  if (!res.length) return '<p class="muted">Before/after comparison not run.</p>';
  const slices = [...new Set(res.map(r => r.slice))];
  return slices.map(sl => {
    const rs = res.filter(r => r.slice === sl);
    const ids = [...new Set(rs.map(r => r.id))];
    const get = (id: string, app: string) => rs.find(r => r.id === id && r.app === app);
    const chart = dumbbell(ids, ids.map(id => get(id, 'before')?.peak ?? null), ids.map(id => get(id, 'after')?.peak ?? null), `Beat-aligned visual response, ${sl}`);
    const cell = (r: Json | undefined) => (r ? `×${f2(r.peak)} @ ${r.lagMs} ms` : '–');
    const rows = ids.map(id => { const b = get(id, 'before'), a = get(id, 'after');
      return `<tr><td>${esc(id)}</td><td class="num">${cell(b)}</td><td class="num">${cell(a)}</td><td class="num">${f2(b?.coupling?.lum)} / ${f2(a?.coupling?.lum)}</td><td class="num">${f0(b?.fps)} / ${f0(a?.fps)}</td></tr>`; }).join('');
    return `<h4>${esc(sl)}</h4>${chart}<details><summary>Table</summary><div class="scroll"><table><thead><tr><th>Visualizer</th><th class="num">Before: peak @ lag</th><th class="num">After: peak @ lag</th><th class="num">r(lum, level) before / after</th><th class="num">FPS before / after</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join('');
}

function agcSection(): string {
  if (!agc) return '<p class="muted">Auto Gain comparison not run.</p>';
  const rows = agc.results.map((r: Json) => `<tr><td>${esc(r.label)}</td><td class="num">${f3(r.meanLevel)}</td><td class="num">${f3(r.meanBass)}</td><td class="num">${f3(r.meanLum)}</td><td class="num">${f2(r.gainDb)}</td></tr>`).join('');
  return `<table><thead><tr><th>Condition</th><th class="num">Mean level (rms)</th><th class="num">Mean bass band</th><th class="num">Bars luminance</th><th class="num">Auto Gain (dB)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const css = `
:root{color-scheme:dark;--surface:#111827;--page:#000;--ink:#fff;--ink2:#d1d5db;--muted:#9ca3af;--grid:#1f2937;--axis:#374151;--ring:rgba(255,255,255,.10);
--s1:#a855f7;--s2:#fb923c;--s3:#6b7280;--good:#4ade80;--bad:#f87171;--code:#1f2937}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
background:radial-gradient(900px 520px at 12% -8%,rgba(147,51,234,.28),transparent 70%) no-repeat,radial-gradient(800px 480px at 96% 2%,rgba(37,99,235,.2),transparent 70%) no-repeat,var(--page)}
main{max-width:980px;margin:0 auto;padding:40px 16px 80px}.wordmark{margin:0 0 12px;font-size:14px;font-weight:300;letter-spacing:.2em;text-transform:uppercase;color:var(--ink)}.wordmark span{font-weight:700;color:#4ade80}
h1{font-size:32px;font-weight:300;line-height:1.2;margin:0 0 4px}h2{font-size:21px;font-weight:400;margin:48px 0 8px;padding-top:8px;border-top:1px solid var(--grid)}h3{font-size:17px;font-weight:500;margin:28px 0 6px}h4{font-size:15px;font-weight:500;margin:22px 0 4px}
p{margin:8px 0;color:var(--ink2)}b,strong{color:var(--ink)}.muted{color:var(--muted)}.small{font-size:12.5px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;background:var(--code);padding:1px 6px;border-radius:6px;font-size:12.5px}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:16px;margin:12px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:18px 0}.tile{background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:14px}
.tile-value{font-size:30px;font-weight:300;letter-spacing:-.5px}.tile-label{font-weight:600;font-size:13.5px;margin-top:2px}.tile-sub{font-size:12px;color:var(--muted)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{padding:6px 8px;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}th{color:var(--ink2);font-weight:600;white-space:nowrap}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.strong{font-weight:650}table.compact td,table.compact th{padding:4px 6px;font-size:12.5px}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid currentColor}.badge.good{color:var(--good)}.badge.bad{color:var(--bad)}
.chart,.diagram{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}.tick,.chart text{fill:var(--muted);font-size:11px}
.mark{stroke:var(--surface);stroke-width:2}.mark.s1{fill:var(--s1)}.mark.s2{fill:var(--s2)}.mark.s3{fill:var(--s3)}.mark:hover{opacity:.8}
.line{fill:none;stroke-width:2;stroke-linejoin:round}.line.s1{stroke:var(--s1)}.line.s2{stroke:var(--s2)}.line.s3{stroke:var(--s3)}
.dot{stroke:var(--surface);stroke-width:2}.dot.s1{fill:var(--s1)}.dot.s2{fill:var(--s2)}.dot.s3{fill:var(--s3)}.hit{fill:transparent}.hit:hover{fill:var(--grid);opacity:.35}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--ink2);margin:6px 0 2px}.key{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}.key.s1{background:var(--s1)}.key.s2{background:var(--s2)}.key.s3{background:var(--s3)}
.diagram .box rect{fill:var(--surface);stroke:var(--axis)}.diagram .engine rect{fill:none;stroke-dasharray:none}.diagram text{fill:var(--ink2);font-size:12px;text-anchor:middle}.diagram .bt{fill:var(--ink);font-weight:650;font-size:13px}.diagram .muted{fill:var(--muted)}.diagram .flow{stroke:var(--s1);stroke-width:2;fill:none}.diagram .arrowhead{fill:var(--s1)}
.multiples{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.multiple{margin:0;background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:10px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:6px}.pair span{display:block;font-size:11.5px;color:var(--muted);text-align:center}.thumb{width:100%;border-radius:6px;display:block;background:#000}
details summary{cursor:pointer;color:var(--ink2);font-size:13px;margin:6px 0}#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);border-radius:6px;padding:4px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;z-index:10;max-width:320px}
ul{color:var(--ink2);padding-left:20px}li{margin:4px 0}
@media (max-width:640px){.tile-value{font-size:24px}}`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>VoltViz Audio Engine Report</title><style>${css}</style></head><body>
<main>
<p class="wordmark">VoltViz<span> Music Visualizer</span></p>
<h1>Audio engine — evidence report, version ${esc(version)}</h1>
<p class="muted">Earlier reports: ${PREVIOUS.map(p => `<a href="${p.file}">${p.version}</a> (${esc(p.note)})`).join(' · ')}.</p>
<p class="muted">Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, built on commit <code>${commit}</code> · test material: ${genreExcerpts.length ? `${genreExcerpts.length} excerpts of ${genreSongs} songs` : 'excerpts of songs'} from the user's own music library across several genres (the audio is never committed; the manifest and the reference beats are) · rebuild with <code>npm run report</code>.</p>
${tiles()}
<div class="card"><p><b>Verdict.</b> ${genreExcerpts.length ? `With the matching Music style and AI beat tracking on, the engine follows the expected pulse with a mean F-measure of
<b>${f3(styleAiF)}</b> over ${genreExcerpts.length} genre excerpts (Auto ${f3(autoAiF)}, the 0.23 engine ${f3(old023AiF)}; AI off ${f3(styleDspF)}). It passed every gate on ${gatesPassed} of ${genreExcerpts.length} excerpts; failures are listed below, not hidden.` : 'The offline beat evaluation has not been run.'}
${liveResults.length ? `Live in the app on ${esc(liveExcerpt)}, fired beats land a median <b>${f0(liveOffsetMedian)} ms</b> from the reference and ${livePass} of ${liveResults.length} visualizers passed the live quality check${liveResults.some(r => r.rerun) ? ` (${liveFirstPass} in the first run; re-runs are marked in the table)` : ''}.` : ''}</p></div>

<h2>1. Architecture</h2>
<p>The audio engine and the visuals are now separate systems. Visualizers never touch Web Audio: they are plain renderer modules that receive one shared <code>AudioFrame</code> per animation frame (beats, onsets, bands, spectra, waveforms). The engine owns one AudioContext per session; the complete beat analysis runs on the audio thread at a fixed hop, independent of the render frame rate.</p>
<div class="card">${architecture()}</div>
<ul><li><b>Before:</b> 56 components each created their own AudioContext and analysers (two during a crossfade), with six different ad-hoc kick/beat detectors and no tempo tracking.</li>
<li><b>After:</b> one engine, one analysis, predicted beats that fire in the frame they become audible, shared analysers keyed by FFT size/smoothing so every visualizer still reads exactly the data it was tuned on, Auto Gain and AI beat tracking as user toggles.</li></ul>

<h2>2. Ground truth</h2>
<p>Reference beats come from two independent state-of-the-art offline trackers with unrelated architectures: <b>madmom</b> (RNN + DBN, primary) and <b>beat_this</b> (transformer, ISMIR 2024, cross-check). A 10-second window is scored only when both agree (F ≥ 0.9 at ±70 ms) <i>at any metrical level</i> (they disagree on 77 vs 154 BPM for parts of the rock song and on 70 vs 140 for parts of the dubstep). librosa was tried and rejected: it lost the beat after ~30 s.</p>
<p>Each excerpt is streamed causally in 128-sample blocks — exactly as the AudioWorklet receives audio — at 44.1 and 48 kHz; scores cover the unambiguous windows after a ${genres?.warmupS ?? 5} s warm-up. F = F-measure at ±70 ms; AMLt = continuity allowing off-beat/double/half metrical levels.
Kick-driven music has the hard cases: pickup hits just before the beat, rolling basslines that fill the off-beats and loud off-beat hats. Low-frequency onsets are fooled by the pickups and the band above 6 kHz by the hats; that is why the engine takes its beat phase from the 150 Hz – 6 kHz band.</p>

<h2>3. Beat accuracy across genres: the Music style setting</h2>
<p>The 0.23 engine was tuned on four-on-the-floor dance music (130–147 BPM, tempo-synced). On other music it made two kinds of mistakes: <b>wrong speed</b> (a 3:2 or 4:3 relative of the tempo, double/half flapping between the AI and the DSP clock, or flashing at 140 on dubstep that is felt at 70) and <b>lost beats</b> (confidence gates tuned on dance music that reject the beat of dense or soft music). The fix is a <b>Music style</b> setting, Auto by default, plus engine changes that help every style.</p>
<ul>
<li><b>Music style</b> (Settings, <code>?style=</code>): Auto · ${Object.values(STYLE_PROFILES).filter(p => p.id !== 'auto').map(p => esc(p.label)).join(' · ')}. A style sets the tempo range and prior (which metrical level wins a tie) and when effects follow the <b>half-time pulse</b>. Settings shows what the engine follows right now.</li>
<li><b>Half-time pulse</b>: the tracker keeps its steadiest level (140 for dubstep) and fires every other beat, on the parity with the stronger accents (kick on 1, snare on 3). The Dubstep, drum &amp; bass, trap style always does this above 110 BPM; the rock style when the accents alternate; Auto and the hip-hop style only on unmistakable evidence (nothing, and no kick, on every other beat for ~7 s), so a DJ's half-time build-up still flashes on every beat.</li>
<li><b>Tempo</b>: a beat period must repeat by itself (half-time drums are tracked at the rate of their hits); 4:3 jumps away from a tempo followed with confidence need the same evidence as 3:2 jumps; returning to a recently confident tempo is always allowed; a clock that its own estimate out-votes for 6 s without confidence may re-time.</li>
<li><b>AI beat tracking</b>: after a confirm or re-time the DSP may not make a metrical tempo jump (octave, 3:2, 4:3) for 30 s (the phase lock stays 12 s) — this ended the 154 ↔ 77 BPM flapping on the rock song; the network may also re-time a clock stuck on a 4:3 relative or wandering without confidence, but only when the DSP's own tempo estimate does not back the clock (the network makes 4:3 errors too).</li>
<li><b>Confidence</b>: for Auto and the genre styles the periodicity gates start lower (vocals and melody dilute the periodicity of an audible beat); the House, techno, trance style keeps the 0.23 gates. When no beat is confident, effects fall back to kick hits and, except for the dance styles, also to snare/strum hits.</li>
</ul>
<p><b>Test material.</b> ${genreExcerpts.length ? `${genreSongs} songs from the user's library (dubstep, hardcore, Dutch rap, two relaxing songs, a rock song), each split into a first half used for tuning and a second half evaluated afterwards (“weak check”: not independent, the same song). The audio is not distributed; the manifest and the reference beats are in the repository.` : 'not evaluated.'} References as in section 2. The expected pulse per excerpt is part of the manifest: the user's choice for dubstep is the half-time pulse (bar beats 1 and 3 from madmom's downbeats); for rap either level counts. Gates: pulse F ≥ 0.80 (0.70 for the ballads), continuity AMLt ≥ 0.90, |median offset| ≤ 20 ms, at most one tempo/pulse level change after 15 s.</p>
${genreExcerpts.length ? `<div class="card"><h4>AI beat tracking on (hybrid)</h4>${genreChart('hybrid', 'Pulse F-measure per genre excerpt, AI on')}
<h4>AI beat tracking off (DSP only)</h4>${genreChart('dsp', 'Pulse F-measure per genre excerpt, AI off')}</div>
<details open><summary>Table</summary>${genreTable()}</details>
<p class="muted">Dubstep B (the second half of the dubstep song) is not half-time: measured on the audio, its kick stays on bar beat 1 but the snare moves to beats 2 and 4. The half-time reference (bar beats 1 and 3, fixed in the manifest before this half was looked at) therefore does not apply there; with the Dubstep style the engine follows the snares on 2 and 4 (pulse F ${f3(gStyle(genreExcerpts.find(e => e.id === 'genre-dubstep-b') ?? {}, 'dsp')?.pulse?.alternatives?.find((a: Json) => a.name.includes('2+4'))?.fMeasure)} against that parity, AI off). The number is left as measured.</p>
<p>Means over the tuning halves, AI on: 0.23 <b>${f3(meanOf(genreRole('tuning').map(e => pulseF(g023(e.id, 'hybrid')))))}</b>, Auto <b>${f3(meanOf(genreRole('tuning').map(e => pulseF(gAuto(e.id, 'hybrid')))))}</b>, matching style <b>${f3(meanOf(genreRole('tuning').map(e => pulseF(gStyle(e, 'hybrid')))))}</b>; weak-check halves: 0.23 <b>${f3(meanOf(genreRole('weak check').map(e => pulseF(g023(e.id, 'hybrid')))))}</b>, Auto <b>${f3(meanOf(genreRole('weak check').map(e => pulseF(gAuto(e.id, 'hybrid')))))}</b>, matching style <b>${f3(meanOf(genreRole('weak check').map(e => pulseF(gStyle(e, 'hybrid')))))}</b>.
AI off: 0.23 ${f3(meanOf(genreExcerpts.map(e => pulseF(g023(e.id, 'dsp')))))}, Auto ${f3(meanOf(genreExcerpts.map(e => pulseF(gAuto(e.id, 'dsp')))))}, matching style ${f3(styleDspF)} (all excerpts).</p>` : '<p class="muted">Genre evaluation not run.</p>'}

<h3>Timing of detected beats</h3>
<div class="card">${offsetHistogram()}<p class="muted small">Signed offset of matched beats against the expected pulse (matching Music style, AI on, 44.1 kHz, all genre excerpts), 5 ms bins from −70 to +70 ms. The clock is predictive: beats are emitted at the predicted time, not one detection delay later.</p></div>

<h3>AI beat tracking</h3>
${neuralSection()}

<h2>4. Visualizers in the running app</h2>
<p>Each visualizer below was run in the real app (Chrome, real GPU, 1280 × 720) on ${liveSeg ? `the ${esc(liveSeg.segment)} section (from ${liveSeg.start} s) of ` : ''}${esc(liveExcerpt)} via the dev-only test source, with a probe that reads the rendered frame in the same task as the render. Measured: the beats the engine fired on screen against the reference, whether the picture changes on the beat, whether it follows the audio level, frame rate and console errors.</p>
${liveTable()}

<h3>Other genres, with the matching Music style</h3>
<p>Four visualizers (Raw Audio, Dutch Grid, Poly Sphere, Halftone Pulse) played genre excerpts in the real app with the matching Music style.</p>
${liveGenreTable()}

<h3>Deep dive: ${liveDeep?.results?.length ? `${countWord(new Set(liveDeep.results.map((r: Json) => r.id)).size)} beat-heavy visualizers, ${countWord(new Set(liveDeep.results.map((r: Json) => r.segment)).size)} sections of ${liveDeep.excerpt ? `the ${esc(gLabel({ id: liveDeep.excerpt }))} excerpt` : 'the excerpt'}` : 'beat-heavy visualizers'}</h3>
<p>Curves: frame-to-frame motion folded onto the reference beats (0 = the beat, 0.5 = half-way), relative to its mean. A flat line at 1 means the picture ignores the beat; a peak means it moves on the beat. Snapshots were captured in the exact render frame in which a beat fired, and half-way between beats.</p>
${deepSection()}

<h3>Before vs after</h3>
<p>The deep-dive visualizers plus the slow and weakly reacting ones, in the old app (build of <code>main</code>) and the new app, fed the same audio through the Microphone path (Chrome fake capture) and measured by the same injected frame probe. Value: peak of the beat-aligned motion response (best 150 ms window between −100 and +250 ms, relative to the mean; 1.00 = none) and its lag.
The fake-capture start is only known to within some tens of milliseconds, so the lags share an unknown common offset; only the difference between before and after is meaningful.
Frame rates are identical before and after for the slow visualizers (their cost is their own drawing, e.g. large canvas shadow blurs), so low frame rates are not a regression.</p>
${beforeAfterSection()}

<h3>Auto Gain</h3>
<p>Bars on the same excerpt at normal level and attenuated by 18 dB (a quiet microphone), with Auto Gain off and on.</p>
${agcSection()}

<h2>5. The new-visualizer skill</h2>
${skillProof ? `<p>${esc(skillProof.summary).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` : '<p class="muted">Not yet verified.</p>'}

<h2>6. Known limitations</h2>
<ul>
<li>DSP-only mode (AI beat tracking off or unavailable) is clearly weaker (see the DSP columns): it can lock onto the off-beat or a pickup hit; the neural arbiter exists for exactly these cases.</li>
<li>The network runs every ~5 s on a 10 s window; after a start or a hard cut the beat can take several seconds to become confident (the report's live runs start mid-song).</li>
<li>With Auto, slow music (&lt; 90 BPM) may be tracked at double time and half-time dubstep flashes on every 140 BPM beat (dance-music prior; Auto only goes half-time on unmistakable evidence). The Music style setting fixes both: Acoustic, chill, ballads and Dubstep, drum &amp; bass, trap.</li>
<li>Without AI beat tracking, soft and phase-ambiguous songs stay weak: on one relaxing song the two reference trackers themselves sit half a beat apart for the first minute, and the DSP clock follows the other one; the AI resolves it. Rap with sparse drums and dense vocals is the hardest material for both modes (see the table).</li>
<li>The genre evaluation has one or two songs per genre, and its second halves are not independent of the tuning halves; treat the genre numbers as indicative.</li>
<li>Frame rates depend on the GPU. On the integrated GPU used here several visualizers run below 30 fps in both the old and the new app (e.g. Sheet Music ~8, Fractal Orb ~9, Tunnel ~17, Cyber City ~19): their cost is their own drawing (large canvas shadow blurs, raymarched shaders). Replacing canvas <code>shadowBlur</code> with a cheaper glow would help a lot but changes the look, so it was left for a follow-up.</li>
${liveResults.length > livePass ? `<li>${liveResults.length - livePass} visualizers do not meet the live criteria: ${liveResults.filter(r => !r.pass).map(r => esc(r.id)).join(', ')}. They render without errors, but within ${liveAll?.seconds ?? 20} s of music their picture either reacts in ways this measurement cannot resolve (random glitch triggers, slow block-by-block animation, few frames per second) or reacts weakly${beforeAfter ? '; the before/after measurements show the same behaviour in the old app' : ''}.</li>` : ''}
<li>Some visualizers keep pre-existing quirks on purpose (unchanged look), e.g. audio-modulated speeds multiplied by elapsed time in AnunakiSphere, AuroraWaves, CyberCity, Shambhala and HexGlobe clouds.</li>
</ul>

<h2>7. Reproduce</h2>
<p><code>npm run eval:prepare</code> (cuts the genre excerpts from <code>$VOLTVIZ_MUSIC_DIR</code>, default <code>~/Music</code>) · <code>uv run scripts/eval/reference.py …</code> (reference beats) · <code>npm run eval:beats</code> · <code>npm run test:unit</code> · <code>npm test</code> · <code>npm run eval:live</code> (dev server on :3101) · <code>npm run eval:before-after</code> · <code>npm run report</code>. Heavy jobs were run under a memory cap (<code>systemd-run --user --scope -p MemoryMax=…</code>).</p>
</main>
<div id="tip" role="tooltip"></div>
<script>
const tip=document.getElementById('tip');
document.addEventListener('mouseover',e=>{const t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.style.display='none';return;}tip.textContent=t.getAttribute('data-tip');tip.style.display='block';});
document.addEventListener('mousemove',e=>{if(tip.style.display==='block'){tip.style.left=Math.min(innerWidth-330,e.clientX+12)+'px';tip.style.top=(e.clientY+14)+'px';}});
</script>
</body></html>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)`);
