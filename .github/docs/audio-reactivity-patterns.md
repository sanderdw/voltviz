# Audio Reactivity Patterns for Visualizers

Lessons learned from fixing time-dependent audio drift in shader-based visualizers.

## The Core Problem: Audio × Time Drift

When audio-modulated values are **multiplied by elapsed time**, the visual impact of the same audio input grows unboundedly as the session continues.

```glsl
// BAD: audio-modulated speed × growing time = drift
float t = uTime * uSpeed;          // uTime grows forever
rotation = rot(t * uTwistSpeed);   // same audio fluctuation has bigger effect at t=600s vs t=10s
```

## The Fix: Phase Accumulators

Accumulate phase on the JS side. Audio modulates the **rate of change per frame**, not a multiplier on total elapsed time.

```typescript
// GOOD: accumulate phase incrementally
globalPhase += delta * currentSpeed;  // only this frame's contribution
twistPhase += delta * currentSpeed * twistRate * audioBoost;

uniforms.uPhase.value = globalPhase;
uniforms.uTwistPhase.value = twistPhase;
```

```glsl
// Shader uses pre-accumulated phase directly
rotation = rot(uPhase * rotationFactor);
twist = rot(vertexY * twistAmount + uTwistPhase);
```

**Why this works:** A bass hit at t=10s and t=600s both add the same `delta * boost` increment — the visual effect is identical regardless of session duration.

## Direct Audio-Reactive Offsets (Time-Independent)

For instant "punch" response to audio, add a **direct offset** uniform that maps audio energy to a visual parameter without any time multiplication:

```typescript
// Direct offset: audio -> visual, no time involved
uniforms.uTwistReact.value = smoothedMids * 3.0 + smoothedBass * 1.5;
```

```glsl
// Added directly to rotation angles
q.xz *= rot(q.y * uTwist + uTwistPhase + uTwistReact);
```

This provides immediate, bounded reactivity that stays constant over time.

## Safe vs Unsafe Audio Modulation Targets

| Target | Safe Pattern | Unsafe Pattern |
|--------|-------------|----------------|
| Rotation/twist angles | Phase accumulator (`+= delta * rate`) | `elapsedTime * audioSpeed` |
| Object size/radius | Additive offset (`base + audio * scale`) | — |
| Thickness/detail | Additive offset (`base + audio * scale`) | — |
| Particle spawn rate | Direct threshold check | — |
| Color shift | Direct mapping | — |
| Animation speed | Drives phase accumulation rate | Multiplied by growing time |

**Rule of thumb:** If a parameter is multiplied by something that grows monotonically (time, frame count), it must NOT be audio-modulated directly. Instead, audio should modulate the *rate of growth* via a phase accumulator.

## PolySphere as Reference Implementation

`PolySphere.tsx` naturally avoids this bug because:
- `time += 0.01 * speed` — speed is user-controlled, not audio-modulated
- Audio only affects additive properties: radius pulse, face detach offset, particle spawn
- None of these are multiplied by the growing `time` variable

## Smoothing Best Practices

```typescript
// Exponential smoothing (EMA) — good defaults
smoothedBass += (bass - smoothedBass) * 0.15;   // fast response
smoothedMids += (mids - smoothedMids) * 0.12;   // medium
smoothedHighs += (highs - smoothedHighs) * 0.10; // slower (less jitter)
```

- Higher alpha = faster response, more jitter
- Lower alpha = smoother, more latency
- `analyser.smoothingTimeConstant = 0.8` provides additional FFT-level smoothing

## Checklist for New Visualizers

1. **Never multiply audio-modulated values by elapsed time** — use phase accumulators
2. **Add direct audio offsets** for instant reactivity (twist, scale, glow)
3. **Keep offsets bounded** — `smoothedValue` is already 0–1 range (with sensitivity=1)
4. **Test at 5+ minutes** — compare visual intensity to the first 10 seconds
5. **Sensitivity slider** scales raw band energy before smoothing — works naturally with both patterns
