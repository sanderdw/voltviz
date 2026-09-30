# Audio Reactivity Patterns for Visualizers

How to make visuals react to music so that they look right on real tracks, for the whole
session. All examples use the `AudioFrame` that every visualizer receives in `frame()` (see
`.github/skills/adding-visualizer/SKILL.md` for the full API).

## 1. Beats: use the engine, not a bass threshold

The engine runs a predictive beat tracker (DSP beat clock + optional neural phase arbiter) on
the audio thread. `audio.beat.isBeat` is true in the frame in which a beat becomes *audible*,
so effects land exactly on the beat instead of one detection delay late.

```ts
import { beatHit, beatStrength } from '../lib/audio';
if (beatHit(audio)) pulse = beatStrength(audio); // heard beat, or a weaker accent without a tempo
pulse *= Math.exp(-dt / 0.15);                   // frame-rate independent decay
```

Why not `if (bass > threshold)`? On real dance music the loudest low-frequency events are often
*not* the beat: rolling basslines fill the off-beats, pickups sit 75 ms before the beat, and
the kick body peaks ~50 ms after its attack. The old per-visualizer detectors fired on those
(beat F-measure 0.3–0.65 on dance music); see `docs/reports/audio-engine-report.html`.

Without a confident tempo (soft or non-4/4 music), `beatHit` falls back to `audio.beat.accent`:
a kick (or a snare, for styles without a steady kick) that stands out from the recent onsets,
at most one per 0.4 s and at most 0.45 strong. The onset detectors are scale-free, so firing on
every raw onset would flash a piano ballad harder than a club track. Scale effects by
`beatStrength(audio)`, which returns the accent's strength, and calm music stays calm.

For motion that should follow the tempo continuously, use `audio.beat.phase` (0 → 1 between
beats) and `audio.beat.barBeat` (0–3).

## 2. The core problem of continuous reactivity: audio × time drift

When audio-modulated values are **multiplied by elapsed time**, the visual impact of the same
audio input grows unboundedly as the session continues.

```glsl
// BAD: audio-modulated speed × growing time = drift
float t = uTime * uSpeed;          // uTime grows forever
rotation = rot(t * uTwistSpeed);   // same fluctuation has a bigger effect at t=600s than at t=10s
```

### The fix: phase accumulators

Accumulate phase on the JS side. Audio modulates the **rate of change per frame**, not a
multiplier on total elapsed time.

```ts
phase += dt * settings.speed * (0.3 + level);   // only this frame's contribution
uniforms.uPhase.value = phase;
```

A bass hit at t=10s and t=600s both add the same `dt * boost` increment — the visual effect is
identical regardless of session duration.

### Direct audio-reactive offsets (time-independent)

For instant "punch", add a **bounded direct offset** that maps audio to a visual parameter
without any time multiplication:

```ts
uniforms.uTwistReact.value = level * 3.0 + pulse * 1.5;
```

## Safe vs unsafe modulation targets

| Target | Safe pattern | Unsafe pattern |
|--------|-------------|----------------|
| Rotation / twist angles | Phase accumulator (`+= dt * rate`) | `elapsedTime * audioSpeed` |
| Object size / radius | Additive offset (`base + level * scale`) | — |
| Flashes / bursts | `beatHit(audio)` + decay | bass threshold + cooldown |
| Particle spawn | `beatHit` / onset `.hit`, or a rate from `bands` | per-frame `if (bass > x)` spam |
| Color shift | Direct mapping | — |
| Animation speed | Drives the phase accumulation rate | Multiplied by growing time |

## Smoothing

Use `dt` so smoothing does not depend on the frame rate:

```ts
level += (audio.bands.bass - level) * Math.min(1, dt * 10);   // ~100 ms response
```

`audio.spectrum({ fftSize, smoothing })` additionally applies the AnalyserNode's own smoothing
(`smoothing` 0.8 is a good default; 0.2–0.5 for snappy spectra).

## Sensitivity and Auto Gain

- `settings.sensitivity` scales audio amplitudes (bands, spectrum values, pulse sizes) — apply
  it once, then clamp.
- **Auto Gain** (a Settings toggle, off by default) normalizes the input level in the engine's
  display path so a quiet microphone and loud system audio look alike. Visualizers must not add
  their own gain normalization.

## Checklist for new visualizers

1. Beat effects via `beatHit(audio)` / `audio.beat` / `audio.onsets` — never a bass threshold.
2. Never multiply audio-modulated values by elapsed time — use phase accumulators.
3. Use `dt` for smoothing and decays.
4. Keep offsets bounded (bands are 0–1 at sensitivity 1).
5. Prove it: `npm run eval:live -- --ids <id>` must PASS (beat response / level coupling on a
   genre excerpt, no errors).

## Known offenders (kept unchanged in the rewrite to preserve their look)

AnunakiSphere (rotation/light speed × uTime), AuroraWaves (timeScale/waveSpeed), Shambhala
(u_speed) and HexGlobe (cloud rotation `t * cloudSpeed`) still multiply
audio-modulated speeds by elapsed time. Fix them with phase accumulators if they are revisited.
