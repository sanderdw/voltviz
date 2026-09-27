---
name: adding-visualizer
description: 'Add or update VoltViz visualizers on the renderer-module architecture: scaffold with `npm run new:viz`, react to the shared AudioFrame (beats, onsets, bands, spectrum), map the four settings, and prove it works on real music with `npm run eval:live`. Use when creating a new visualizer or changing how an existing one looks or reacts to audio.'
argument-hint: '[what the visualizer should look like / react to]'
---

# Adding a visualizer

A visualizer is a **plain TypeScript module** in `src/visualizers/impl/` — no React, no
Web Audio. The app gives it a container to draw into and, every animation frame, one shared
`AudioFrame` (beats, onsets, bands, spectrum, waveform) plus the user's settings. The audio
engine, the render loop, resizing, DPR, crossfades and error isolation are all handled for you.

## 1. Scaffold (1 minute)

```bash
npm run new:viz -- <id> "<Display Name>" [--template canvas2d|three|shader] [--beat]
# e.g.
npm run new:viz -- starfield "Star Field" --template three --beat
```

- `canvas2d` (default) — Canvas 2D; simplest, preferred unless you need 3D or shaders.
- `three` — three.js scene with a mesh; `shader` — full-screen fragment shader (three.js).
- `--beat` — include the beat-reactive parts (a pulse on every beat).

This creates `src/visualizers/impl/<Module>.ts` and appends
`{ id, name, module }` to `src/visualizers/registry.ts` (the single source of truth for ids,
names and picker order). The generated file compiles and runs as-is. Open
`http://localhost:3000/?viz=<id>` (`npm run dev`), start an audio source, and iterate.

## 2. The contract

```ts
import type { VisualizerFactory } from '../runtime/types';

const MyViz: VisualizerFactory = ({ container, width, height, dpr, settings, metadata }) => {
  // one-time setup: create your canvas / renderer inside `container`
  return {
    resize(w, h, dpr) {},               // CSS size + DPR (capped at 2); also called right after mount
    frame({ audio, settings, dt, time, width, height, dpr, metadata }) {}, // draw one frame
    dispose() {},                       // free everything you created (GPU!), remove DOM you added
    metadata?(m) {},                    // optional: Sendspin track metadata changed
    api?: { setImage(url: string) {} }, // optional: methods for an Overlay
  };
};
export default MyViz;
export function Overlay({ api }: OverlayProps) { /* optional React UI (uploads), file becomes .tsx */ }
```

- The factory may be `async` (e.g. to load data); state lives in the closure.
- Never call `requestAnimationFrame`, never add `resize` listeners, never create an
  `AudioContext` — the host does all of that once for every layer.
- Helpers: `lib/canvas2d.ts` (`mountCanvas2D`), `lib/three.ts` (`createRenderer`,
  `disposeObject`, `disposeRenderer`), `lib/audio.ts` (`avg`, `ema`, `binFor`, `beatHit`).

## 3. Which audio field for which effect

| You want… | Use | Notes |
|---|---|---|
| a flash / burst / cut **on the beat** | `beatHit(audio)` (lib/audio) | predicted beat, fires in the frame the beat is **heard**; falls back to a raw kick when there is no confident tempo |
| something that **grows and decays** with each beat | `audio.beat.sinceBeat` → `Math.exp(-sinceBeat / 0.15)` | or keep your own `pulse` set to 1 on `beatHit` and decayed by `dt` |
| motion **locked to the tempo** (swing, bounce, strobe per bar) | `audio.beat.phase` (0→1 between beats), `audio.beat.barBeat` (0–3), `audio.beat.bpm` | continuous; no jumps |
| kick / snare / hi-hat hits | `audio.onsets.kick/snare/hat` → `.hit`, `.envelope` (decays, τ 150 ms), `.strength` | detected onsets, ~10 ms after they happen |
| overall loudness | `audio.level.rms` / `.peak` | display path (after Auto Gain) |
| bass / mids / highs | `audio.bands.sub, bass, lowMid, mid, highMid, treble` (0..1) | means of the 2048/0.8 spectrum per Hz range |
| bars / a spectrum | `audio.spectrum({ fftSize, smoothing })` → `Uint8Array` (fftSize/2) | shared analysers, read once per frame; any fftSize 32…32768 |
| an oscilloscope | `audio.waveform({ fftSize })` (bytes, 128 = 0) / `waveformFloat()` | |
| stereo (VU, Lissajous) | `audio.stereo()` → `{ left, right }` | right === left for mono sources |
| a quiet passage / pause | `audio.silent`, `audio.beat.confidence` | fade out effects when `confidence < 0.3` |

The arrays returned by `spectrum()`/`waveform()` are shared between visualizers: read them,
never write into them.

## 4. Rules that keep it looking right on real music

1. **Never multiply an audio-modulated value by elapsed time.** Use a phase accumulator:
   `phase += dt * speed * (0.3 + level)` — the same kick has the same effect after 10 s and
   after 10 minutes (see `.github/docs/audio-reactivity-patterns.md`).
2. **Use `dt`** for smoothing and decays (`x += (target - x) * Math.min(1, dt * 10)`,
   `pulse *= Math.exp(-dt / 0.15)`) so the look does not depend on the frame rate.
3. **Trigger beat effects with `beatHit(audio)`**, not with your own threshold on the bass —
   bass thresholds fire on rolling basslines and off-beats (the engine's report shows why).
4. **Bound everything**: band values are 0..1 at sensitivity 1; clamp after multiplying.
5. **Dispose** geometries, materials, textures, render targets, composer passes and call
   `disposeRenderer(renderer)`; remove any listener or DOM node you added.

## 5. Settings mapping (all visualizers)

| Setting | Range | Map it to |
|---|---|---|
| `sensitivity` | 0.1–3, default 1 | multiply audio amplitudes (bands, spectrum values, pulse sizes) |
| `speed` | 0.1–3, default 1 | the rate of phase accumulators / animation speed |
| `hueShift` | 0–360° | add to every hue (`(hue + hueShift) % 360`, or `/360` in shaders) |
| `scale` | 0.5–3, default 1 | the size of the main element |

**Auto Gain** (Settings, off by default) normalizes the input level for the display path, so
`spectrum`, `bands` and `level` are comparable between a quiet microphone and loud system
audio. You don't need to do anything for it — just don't add your own gain normalization.
**AI Beat Tracking** (on by default) only affects how reliable `audio.beat` is.

## 6. Prove it works (required before you're done)

```bash
npm run lint                      # type-check the whole project
npm run test:unit                 # engine unit tests
npm run eval:prepare              # once: downloads the test mix, cuts excerpts (.cache/, gitignored)
DISABLE_HMR=true npx vite --port 3101 --strictPort &   # dev server for the harness
npm run eval:live -- --ids <id>   # plays the test mix through the real app and measures it
```

`eval:live` must print **PASS** for your id:
- it renders, moves, and logs no console errors;
- **beat-driven** visualizers (`--beat`) must visibly move with the beat: the frame motion (or
  luminance) folded onto the reference beats must be modulated ≥ 1.3× more than on randomly
  jittered beat grids (p < 0.05). The test is phase-agnostic, so a smoothed reaction counts;
- continuous visualizers need beat locking ≥ 1.1× **or** a significant correlation (|r| ≥ 0.25)
  between what they draw and the audio (level, bass, lit spectrum or kick envelope).

If it fails, the printed values tell you why (`lock m×1.02` = the beat is invisible: make the
pulse bigger or trigger it with `beatHit`; `r=0.05` = the picture ignores the music).
The raw per-frame data is kept in `.cache/eval/live-raw/`, and `--reanalyze` recomputes the
verdict without a browser.

Then:
- `npx playwright test tests/all-visualizers.spec.ts -g <id>` (mounts without errors);
- `npm run capture:previews -- <id>` to create the picker thumbnail
  (`src/images/previews/<id>.jpg`; until then the picker shows a placeholder);
- add a line under `## [Unreleased]` in `CHANGELOG.md`.

## Modifying an existing visualizer

Same contract and rules. Keep its `fftSize`/`smoothing` in `audio.spectrum(...)` unless you
intend to change its look, run `npm run eval:live -- --ids <id>` before and after, and
re-capture the preview if the look changed.
