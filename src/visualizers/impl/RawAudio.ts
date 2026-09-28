/**
 * Raw Audio — an inspector for the audio engine. One tile per row of the "Which audio field for
 * which effect" table in .github/skills/adding-visualizer/SKILL.md: the field's exact API, its
 * live value and a small demo of the effect it is meant for. Values are shown raw, so the four
 * user settings are deliberately not applied. The shared arrays are only read, never written.
 */
import type { AudioFrame } from '../../audio/types';
import { beatHit, beatStrength, STRONG_BEAT } from '../lib/audio';
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// voltviz.com palette (Tailwind): gray-900 tiles, white/10 rules, green hits, purple beat.
const TILE = '#111827';
const RULE = 'rgba(255,255,255,0.1)';
const TRACK = 'rgba(255,255,255,0.08)';
const INK = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.6)';
const FAINT = 'rgba(255,255,255,0.35)';
const GREEN = '#4ADE80';
const PURPLE = '#A855F7';
const PURPLE_TEXT = '#C084FC';
const BLUE = '#60A5FA';
const ORANGE = '#FB923C';
const RED = '#F87171';
const AMBER = '#FBBF24';

const BAND_KEYS = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble'] as const;
const BAND_COLORS = [RED, ORANGE, AMBER, GREEN, BLUE, PURPLE];
const ONSET_KEYS = ['kick', 'snare', 'hat'] as const;
const SPECTRUM_BARS = 64;

interface Rect { x: number; y: number; w: number; h: number }

const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const RawAudio: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container, { hiDpi: true, alpha: false });
  const ctx = c.ctx;

  // Display-only decays so single-frame events stay visible (the fields themselves are raw).
  let beatFlash = 0;
  let beatSource = '—';
  let hitStrength = 0; // beatStrength(audio) of the last hit
  let strengthFlash = 0;
  let downbeatFlash = 0;
  const onsetFlash = { kick: 0, snare: 0, hat: 0 };
  let fps = 60;
  let stereoScale = 0.05;

  // Type scale, set per frame from the tile size.
  let fsSmall = 11;
  let fsValue = 16;

  function font(size: number, family: string, weight = 400) {
    ctx.font = `${weight} ${size}px ${family}`;
  }

  function text(s: string, x: number, y: number, size: number, color: string, family = MONO, align: CanvasTextAlign = 'left', weight = 400) {
    font(size, family, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }

  function roundRect(r: Rect, radius: number, fill: string, stroke?: string) {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Tile frame with caption and API expression; returns the content area below them. */
  function tile(r: Rect, caption: string, expr: string, flash = 0, flashColor = GREEN): Rect {
    roundRect(r, 12, TILE, RULE);
    if (flash > 0.01) {
      ctx.globalAlpha = 0.28 * flash;
      roundRect(r, 12, flashColor);
      ctx.globalAlpha = 1;
    }
    const pad = Math.max(8, Math.min(14, r.w * 0.05));
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + pad, r.y, r.w - pad * 2, r.h);
    ctx.clip();
    text(caption.toUpperCase(), r.x + pad, r.y + pad + fsSmall, fsSmall, MUTED, SANS, 'left', 600);
    text(expr, r.x + pad, r.y + pad + fsSmall * 2 + 6, fsSmall, PURPLE_TEXT);
    ctx.restore();
    const top = pad + fsSmall * 2 + 14;
    return { x: r.x + pad, y: r.y + top, w: r.w - pad * 2, h: r.h - top - pad };
  }

  function hbar(x: number, y: number, w: number, h: number, v: number, color: string) {
    roundRect({ x, y, w, h }, h / 2, TRACK);
    const fw = w * clamp01(v);
    if (fw > 0.5) roundRect({ x, y, w: Math.max(h, fw), h }, h / 2, color);
  }

  /** "label  value" rows at the bottom of a content area. */
  function readouts(r: Rect, rows: [string, string][], color = INK) {
    const lh = fsSmall + 5;
    let y = r.y + r.h - (rows.length - 1) * lh;
    for (const [k, v] of rows) {
      text(k, r.x, y, fsSmall, FAINT);
      text(v, r.x + r.w, y, fsSmall, color, MONO, 'right');
      y += lh;
    }
    return rows.length * lh + 4;
  }

  // ---------- tiles ----------

  function onTheBeat(r: Rect, a: AudioFrame) {
    const area = tile(r, 'On the beat', 'beatHit(audio)', beatFlash);
    const used = readouts(area, [
      ['beat.isBeat', String(a.beat.isBeat)],
      ['beat.count', String(a.beat.count)],
      ['last hit from', beatSource],
    ]);
    const space = area.h - used;
    const size = Math.min(fsValue * 2.2, space * 0.7);
    if (size >= 10) {
      text('BEAT', area.x + area.w / 2, area.y + space / 2 + size * 0.36, size, beatFlash > 0.05 ? GREEN : FAINT, SANS, 'center', 700);
    }
  }

  function strength(r: Rect, a: AudioFrame) {
    const s = a.beat.strength;
    const area = tile(r, 'Beat strength', 'beatStrength(audio) · beat.strength', strengthFlash);
    const used = readouts(area, [
      ['beat.strength', fmt(s)],
      ['analysis.beatRise', `${fmt(a.analysis.beatRise, 1)} dB`],
      ['last beatStrength()', `${fmt(hitStrength)}${hitStrength >= STRONG_BEAT ? ' · strong' : ''}`],
    ]);
    const h = area.h - used;
    const barH = Math.max(6, Math.min(10, h / 8));
    const y = area.y + Math.max(fsSmall + 4, h / 2 - barH);
    hbar(area.x, y, area.w, barH, s, s >= STRONG_BEAT ? GREEN : AMBER);
    // STRONG_BEAT: one-off beat events (switch a look, spawn something) need at least this
    const mx = area.x + area.w * STRONG_BEAT;
    ctx.fillStyle = INK;
    ctx.fillRect(mx - 1, y - 3, 2, barH + 6);
    if (h >= fsSmall * 5) {
      text('STRONG_BEAT', mx, y - 7, fsSmall * 0.85, MUTED, MONO, 'center');
      text(s >= STRONG_BEAT ? 'full beat effects' : 'a pulse without a hit: soft effects', area.x, y + barH + fsSmall + 8, fsSmall, s >= STRONG_BEAT ? MUTED : AMBER, SANS);
    }
  }

  function growDecay(r: Rect, a: AudioFrame) {
    const pulse = Math.exp(-a.beat.sinceBeat / 0.15);
    const area = tile(r, 'Grow & decay', 'Math.exp(-beat.sinceBeat / 0.15)');
    const used = readouts(area, [
      ['beat.sinceBeat', `${fmt(a.beat.sinceBeat)} s`],
      ['pulse', fmt(pulse)],
    ]);
    const h = area.h - used;
    const rMax = Math.max(4, Math.min(area.w, h) / 2 - 2);
    ctx.beginPath();
    ctx.arc(area.x + area.w / 2, area.y + h / 2, rMax * (0.2 + 0.8 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = PURPLE;
    ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function tempo(r: Rect, a: AudioFrame) {
    const b = a.beat;
    const area = tile(r, 'Locked to tempo', 'beat.phase · barBeat · bpm');
    // phase runs from the last heard beat (0) over one beat period (1) and stays at 1 without beats
    const used = readouts(area, [
      ['beat.bpm', b.divisor > 1 ? `${fmt(b.bpm, 1)} (half-time)` : fmt(b.bpm, 1)],
      ['beat.tempo', fmt(b.tempo, 1)],
      ['period · phase', `${fmt(b.period, 3)} s · ${fmt(b.phase)}`],
      // barKnown: the bar comes from the AI's downbeats, else fired beats are counted in fours
      ['beat.barBeat', `${b.barBeat + 1}/4 · ${b.barKnown ? 'AI' : 'counted'}`],
      ['style', a.style],
    ]);
    const h = area.h - used;
    // Four bar dots, the current one lit; a known "1" (barKnown) is ringed and flashes on `downbeat`
    const dot = Math.max(3, Math.min(area.w / 16, h / 6));
    if (h < dot * 2 + 16) return; // too short for the demo: the numbers above say it all
    for (let i = 0; i < 4; i++) {
      const cx = area.x + dot + i * dot * 3;
      ctx.beginPath();
      ctx.arc(cx, area.y + dot, dot, 0, Math.PI * 2);
      ctx.fillStyle = i === b.barBeat ? PURPLE : TRACK;
      ctx.fill();
      if (i === 0 && b.barKnown) {
        if (downbeatFlash > 0.01) {
          ctx.globalAlpha = downbeatFlash;
          ctx.fillStyle = GREEN;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(cx, area.y + dot, dot + 2, 0, Math.PI * 2);
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // Phase progress bar
    hbar(area.x, area.y + dot * 2 + 8, area.w, Math.max(4, dot * 0.8), b.phase, PURPLE);
    // Pendulum: one swing per beat, direction alternating with the beat count
    const top = area.y + dot * 2 + 8 + dot + 10;
    const len = area.y + h - top - dot * 2;
    if (len < 12) return;
    const angle = Math.cos(Math.PI * (b.phase + (b.count % 2))) * 0.6;
    const px = area.x + area.w / 2;
    const bx = px + Math.sin(angle) * len;
    const by = top + Math.cos(angle) * len;
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(3, dot * 0.9), 0, Math.PI * 2);
    ctx.fillStyle = PURPLE_TEXT;
    ctx.fill();
  }

  function onsets(r: Rect, a: AudioFrame) {
    const area = tile(r, 'Kick / snare / hat', 'onsets.kick|snare|hat');
    const rowH = area.h / 3;
    ONSET_KEYS.forEach((k, i) => {
      const o = a.onsets[k];
      const y = area.y + i * rowH;
      const mid = y + rowH * 0.35;
      const dot = Math.max(3, Math.min(7, rowH * 0.14));
      ctx.beginPath();
      ctx.arc(area.x + dot, mid, dot, 0, Math.PI * 2);
      ctx.fillStyle = onsetFlash[k] > 0.05 ? GREEN : TRACK;
      ctx.globalAlpha = onsetFlash[k] > 0.05 ? 0.4 + 0.6 * onsetFlash[k] : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      text(k, area.x + dot * 3, mid + fsSmall * 0.35, fsSmall, INK);
      const bx = area.x + dot * 3 + fsSmall * 3.6;
      const details = `env ${fmt(o.envelope)}  str ${fmt(o.strength)}  since ${fmt(o.since, 1)} s`;
      if (rowH >= fsSmall * 3.2) {
        hbar(bx, mid - 3, Math.max(10, area.w - (bx - area.x)), 6, o.envelope, ORANGE);
        text(details, area.x, y + rowH * 0.82, fsSmall * 0.9, FAINT);
      } else {
        // Short tile: one line per onset, the envelope as a thin bar under it
        text(`env ${fmt(o.envelope)}  str ${fmt(o.strength)}`, area.x + area.w, mid + fsSmall * 0.35, fsSmall * 0.9, FAINT, MONO, 'right');
        hbar(bx, mid + fsSmall * 0.6, Math.max(10, area.w - (bx - area.x)), 3, o.envelope, ORANGE);
      }
    });
  }

  function loudness(r: Rect, a: AudioFrame) {
    const area = tile(r, 'Loudness', 'level.rms · level.peak');
    const used = readouts(area, [['gain · autoGain', `×${fmt(a.gain)} · ${a.autoGain ? 'on' : 'off'}`]]);
    const h = area.h - used;
    const rows: [string, number][] = [['rms', a.level.rms], ['peak', a.level.peak]];
    const rowH = h / rows.length;
    const barH = Math.max(3, Math.min(6, rowH - fsSmall - 6));
    rows.forEach(([k, v], i) => {
      const base = area.y + i * rowH + fsSmall;
      text(k, area.x, base, fsSmall, INK);
      text(fmt(v, 3), area.x + area.w, base, fsSmall, INK, MONO, 'right');
      hbar(area.x, base + 4, area.w, barH, v, i ? AMBER : GREEN);
    });
  }

  function bands(r: Rect, a: AudioFrame) {
    const area = tile(r, 'Bass / mids / highs', 'bands.sub … treble');
    const n = BAND_KEYS.length;
    const gap = 6;
    const bw = (area.w - gap * (n - 1)) / n;
    const labelH = fsSmall * 2 + 8;
    const h = area.h - labelH;
    BAND_KEYS.forEach((k, i) => {
      const v = a.bands[k];
      const x = area.x + i * (bw + gap);
      roundRect({ x, y: area.y, w: bw, h }, 4, TRACK);
      const bh = h * clamp01(v);
      if (bh > 1) roundRect({ x, y: area.y + h - bh, w: bw, h: bh }, 4, BAND_COLORS[i]);
      text(k, x + bw / 2, area.y + h + fsSmall + 3, fsSmall * 0.85, MUTED, MONO, 'center');
      text(fmt(v), x + bw / 2, area.y + h + fsSmall * 2 + 5, fsSmall * 0.85, INK, MONO, 'center');
    });
  }

  function spectrum(r: Rect, a: AudioFrame) {
    const data = a.spectrum({ fftSize: 2048, smoothing: 0.8 });
    const area = tile(r, 'Spectrum', 'spectrum({ fftSize: 2048, smoothing: 0.8 })');
    const used = readouts(area, [['length', `${data.length} bins · ${fmt(a.sampleRate / 2048, 1)} Hz/bin`]]);
    const h = area.h - used;
    const nyquist = a.sampleRate / 2;
    const bw = area.w / SPECTRUM_BARS;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      // Log-spaced from 20 Hz to 16 kHz; each bar shows the loudest bin in its range
      const f0 = 20 * Math.pow(800, i / SPECTRUM_BARS);
      const f1 = 20 * Math.pow(800, (i + 1) / SPECTRUM_BARS);
      const b0 = Math.min(data.length - 1, Math.floor((f0 / nyquist) * data.length));
      const b1 = Math.min(data.length, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * data.length)));
      let v = 0;
      for (let b = b0; b < b1; b++) v = Math.max(v, data[b]);
      const bh = (v / 255) * h;
      ctx.fillStyle = BAND_COLORS[Math.min(BAND_COLORS.length - 1, Math.floor((i / SPECTRUM_BARS) * BAND_COLORS.length))];
      ctx.fillRect(area.x + i * bw, area.y + h - bh, Math.max(1, bw - 1), bh);
    }
  }

  function oscilloscope(r: Rect, a: AudioFrame) {
    const data = a.waveform({ fftSize: 2048 });
    const area = tile(r, 'Oscilloscope', 'waveform({ fftSize: 2048 })');
    const used = readouts(area, [['bytes', '128 = 0']]);
    const h = area.h - used;
    const mid = area.y + h / 2;
    ctx.strokeStyle = RULE;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(area.x, mid);
    ctx.lineTo(area.x + area.w, mid);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(data.length / area.w));
    for (let i = 0; i < data.length; i += step) {
      const x = area.x + (i / (data.length - 1)) * area.w;
      const y = mid - ((data[i] - 128) / 128) * (h / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function stereo(r: Rect, a: AudioFrame) {
    const { left, right } = a.stereo();
    let mono = left === right;
    if (!mono) {
      mono = true;
      for (let i = 0; i < left.length; i += 16) if (left[i] !== right[i]) { mono = false; break; }
    }
    const area = tile(r, 'Stereo', 'stereo() → { left, right }');
    const used = readouts(area, [['channels', mono ? 'mono (right === left)' : 'stereo']], mono ? AMBER : INK);
    const h = area.h - used;
    const size = Math.min(area.w, h);
    const cx = area.x + area.w / 2;
    const cy = area.y + h / 2;
    ctx.strokeStyle = RULE;
    ctx.beginPath();
    ctx.moveTo(cx - size / 2, cy);
    ctx.lineTo(cx + size / 2, cy);
    ctx.moveTo(cx, cy - size / 2);
    ctx.lineTo(cx, cy + size / 2);
    ctx.stroke();
    // Goniometer: mid (L+R) up, side (L-R) across, auto-scaled to the recent peak
    let peak = 0;
    for (let i = 0; i < left.length; i += 4) peak = Math.max(peak, Math.abs(left[i]) + Math.abs(right[i]));
    stereoScale = Math.max(stereoScale * 0.98, peak, 0.05);
    ctx.fillStyle = BLUE;
    const k = (size * 0.48) / stereoScale;
    for (let i = 0; i < left.length; i += 2) {
      const x = cx + (left[i] - right[i]) * k;
      const y = cy - (left[i] + right[i]) * k;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  function quiet(r: Rect, a: AudioFrame) {
    const conf = a.beat.confidence;
    const area = tile(r, 'Quiet / pause', 'silent · beat.confidence');
    const used = readouts(area, [
      ['silent', String(a.silent)],
      ['beat.confidence', fmt(conf)],
    ], a.silent ? AMBER : INK);
    const h = area.h - used;
    const roomy = h >= fsSmall * 5;
    const barH = roomy ? 10 : 6;
    const y = roomy ? area.y + h / 2 - barH : area.y + (h - barH) / 2;
    hbar(area.x, y, area.w, barH, conf, conf < 0.3 ? AMBER : PURPLE);
    const mx = area.x + area.w * 0.3;
    ctx.fillStyle = INK;
    ctx.fillRect(mx - 1, y - 3, 2, barH + 6);
    if (roomy) {
      text('0.3', mx, y - 7, fsSmall * 0.85, MUTED, MONO, 'center');
      text(conf < 0.3 ? 'no beats: fade effects out' : 'heard hits fire beats', area.x, y + barH + fsSmall + 8, fsSmall, conf < 0.3 ? AMBER : MUTED, SANS);
    }
  }

  function engine(r: Rect, a: AudioFrame) {
    const e = a.engine;
    const s = a.analysis;
    const area = tile(r, 'Engine · frame', 'audio.engine · audio.analysis');
    readouts(area, [
      ['host', e.host],
      // the beat grid: beats fire only on hits heard on it, while it is locked and confident
      ['grid', s.locked ? `locked · ${fmt(s.bpm, 1)} BPM` : 'searching'],
      ['tempo estimate', s.tempoCandidateBpm > 0 ? `${fmt(s.tempoCandidateBpm, 1)} · salience ${fmt(s.tempoSalience)}` : '–'],
      ['neural', e.neural === 'ready' ? `ready · ${fmt(e.neuralMs, 0)} ms · ${s.neural.lastDecision}` : e.neural],
      ['songChanges', s.songChanges > 0 ? `${s.songChanges} · ${fmt(s.time - s.songChangeAt, 0)} s ago` : '0'],
      ['latency', `${fmt(e.latency * 1000, 1)} ms`],
      ['dt · fps', `${fmt(a.dt * 1000, 1)} ms · ${fmt(fps, 0)}`],
      ['time · sampleRate', `${fmt(a.time, 1)} s · ${a.sampleRate} Hz`],
    ], e.neural === 'error' ? RED : INK);
  }

  const TILES = [onTheBeat, strength, tempo, onsets, growDecay, loudness, bands, spectrum, oscilloscope, stereo, quiet, engine];

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),

    frame({ audio, dt }) {
      const w = c.cssWidth;
      const h = c.cssHeight;

      // Display decays (the raw values are shown next to them)
      if (beatHit(audio)) {
        beatFlash = 1;
        beatSource = audio.beat.isBeat ? 'heard beat' : 'onset (no tempo)';
        hitStrength = beatStrength(audio);
        strengthFlash = hitStrength;
      } else {
        beatFlash *= Math.exp(-dt / 0.12);
        strengthFlash *= Math.exp(-dt / 0.12);
      }
      if (audio.beat.downbeat) downbeatFlash = 1;
      else downbeatFlash *= Math.exp(-dt / 0.3);
      for (const k of ONSET_KEYS) {
        if (audio.onsets[k].hit) onsetFlash[k] = 1;
        else onsetFlash[k] *= Math.exp(-dt / 0.12);
      }
      if (dt > 0) fps += (1 / dt - fps) * Math.min(1, dt * 2);

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      const margin = Math.max(8, Math.min(20, w * 0.012));
      const gap = Math.max(6, Math.min(12, w * 0.008));
      const cols = w >= 800 ? 4 : 2;
      const rows = Math.ceil(TILES.length / cols);
      const tw = (w - margin * 2 - gap * (cols - 1)) / cols;
      const th = (h - margin * 2 - gap * (rows - 1)) / rows;
      fsSmall = Math.max(9, Math.min(13, Math.min(tw / 22, th / 11)));
      fsValue = Math.max(12, Math.min(22, th / 9));

      TILES.forEach((draw, i) => {
        const r = {
          x: margin + (i % cols) * (tw + gap),
          y: margin + Math.floor(i / cols) * (th + gap),
          w: tw,
          h: th,
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        draw(r, audio);
        ctx.restore();
      });
    },

    dispose() {
      c.canvas.remove();
    },
  };
};

export default RawAudio;
