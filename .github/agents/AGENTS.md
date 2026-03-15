# AGENTS.md

## 1. Overview

GridAmp is a browser-based music visualizer that captures audio from a microphone or system audio and renders it as real-time animations, offering a library of Canvas 2D and WebGL/Three.js visualizer effects selectable at runtime.

## 2. Folder Structure

- `src/`: application source root.
    - `App.tsx`: single top-level component; owns all runtime state (active stream, active visualizer, settings) and renders the control UI and the selected visualizer.
    - `types.ts`: shared TypeScript types; currently exports `VisualizerSettings` — the single props contract shared by every visualizer.
    - `index.css`: global CSS and Tailwind base styles.
    - `main.tsx`: React DOM entry point.
    - `components/visualizers/`: one file per visualizer effect; each file is a self-contained component that handles its own audio pipeline and rendering loop. Canvas 2D and WebGL/Three.js implementations coexist here.
    - `data/`: static data assets (e.g., `Netherlands_gemeentes.json` used by geo-based visualizers).
- `nginx/`: Nginx configuration for serving the production build inside Docker.
- `.github/skills/`: agent skill definitions; do not modify unless updating agent tooling.
- `index.html`: Vite HTML entry point.
- `vite.config.ts`: Vite build configuration.
- `tsconfig.json`: TypeScript compiler configuration.
- `Dockerfile`: multi-stage build producing an Nginx-served production image.

## 3. Core Behaviors & Patterns

### Audio Pipeline Initialization

Every visualizer sets up the same Web Audio API chain inside a `useEffect([stream])`:

```ts
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 512;
analyser.smoothingTimeConstant = 0.8; // ~0.85 for Canvas components
const source = audioCtx.createMediaStreamSource(stream);
source.connect(analyser);
const dataArray = new Uint8Array(analyser.frequencyBinCount);
```

Use `analyser.getByteFrequencyData(dataArray)` inside the animation loop to obtain per-frame frequency data.

Use Canvas 2D unless specified explicitly to use WebGL/Three.js

### Settings Ref Pattern

Settings props must never retrigger the `[stream]` effect. All visualizers store settings in a ref for use inside the animation loop:

```ts
const settingsRef = useRef(settings);
useEffect(() => { settingsRef.current = settings; }, [settings]); // shallow sync
useEffect(() => { /* audio + render init, reads settingsRef.current */ }, [stream]);
```

Do not read `settings` directly inside the animation loop — always read `settingsRef.current`.

### Animation Loop & Cleanup

Canvas 2D visualizers:

```ts
const draw = () => {
  animationRef.current = requestAnimationFrame(draw);
  analyser.getByteFrequencyData(dataArray);
  // ... render ...
};
draw();

return () => {
  if (animationRef.current) cancelAnimationFrame(animationRef.current);
  if (sourceRef.current) sourceRef.current.disconnect();
  if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
};
```

Three.js visualizers additionally dispose geometry, material, and renderer in the cleanup. Always remove `resize` event listeners on cleanup.

### Canvas Sizing

Canvas 2D components use a `containerRef` div and a `resize()` function that sets `canvas.width/height` from `container.clientWidth/Height`. Wire it with:

```ts
window.addEventListener('resize', resize);
resize(); // initial size
```

### Three.js / WebGL Setup

WebGL visualizers append `renderer.domElement` directly to `containerRef.current`. To handle React StrictMode double-mount, clear existing children first:

```ts
while (container.firstChild) container.removeChild(container.firstChild);
container.appendChild(renderer.domElement);
```

Cap pixel ratio: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.

### Settings Semantics

| Setting | Effect |
|---|---|
| `sensitivity` | Scales frequency bar/shape amplitude |
| `speed` | Multiplies time-based animation rate (e.g. hue rotation) |
| `hueShift` | Offset added to computed hue values |
| `scale` | Physical size multiplier for drawn elements |

### Visualizer Registration

Adding a new visualizer requires three changes in `App.tsx`:

1. Add a new string literal to the `VisualizerType` union.
2. Add a `case` in `renderVisualizer()`.
3. Add an `<option>` in the `<select>` dropdown.

## 4. Conventions

### File & Component Naming

- Visualizer files are PascalCase and match the exported component name exactly: `Bars.tsx` → `export default function Bars(...)`.
- The string key used in `VisualizerType` and `renderVisualizer` is lowercase/no-separator (e.g. `'bars'`, `'webglmusicgrid'`, `'perlin'`). It does not need to match the file name exactly.

### Component Structure

Each visualizer component follows this top-down order:

1. Imports (`React`, `useRef`, `useEffect`, `VisualizerSettings`, and rendering libs)
2. `interface Props { stream: MediaStream; settings: VisualizerSettings; }`
3. Default-exported function component
4. All `useRef` declarations
5. Settings sync `useEffect`
6. Main `useEffect([stream])` with audio + render init and cleanup return
7. JSX: `<div ref={containerRef}>` wrapping `<canvas ref={canvasRef}>` (Canvas) or empty (Three.js)

### Ref Declarations

Group all refs at the top of the component, before any `useEffect`. Use typed refs:

```ts
const canvasRef = useRef<HTMLCanvasElement>(null);
const audioCtxRef = useRef<AudioContext>();
const analyserRef = useRef<AnalyserNode>();
const sourceRef = useRef<MediaStreamAudioSourceNode>();
const animationRef = useRef<number>();
const settingsRef = useRef(settings);
```

### Styling

Components use Tailwind utility classes applied via `className`. The app theme is dark (black background). Avoid inline `style` objects unless required for dynamic values that cannot be expressed with utilities.

### TypeScript

- Strict ES2022 target with `noEmit`; type-check via `tsc --noEmit` (aliased as `npm run lint`).
- `(window as any).webkitAudioContext` is the only acceptable `any` cast — for cross-browser AudioContext compatibility.
- Avoid `any` elsewhere; use proper types from `@types/three` and `@types/d3-geo`.

### Exports

All visualizer components use `export default`. `types.ts` uses named exports. `App.tsx` uses `export default`.

## 5. Working Agreements

- Respond in the user's preferred language; if unspecified, infer from codebase (keep tech terms in English, never translate code blocks).
- Create tests or lint tasks only when explicitly requested.
- Before editing, search for other usages of the same function, ref pattern, or effect structure across the visualizer files to understand the established pattern.
- Prefer simple solutions matching the user's request; do not add extra abstraction unless requested.
- Ask for clarification when requirements are ambiguous.
- Minimal changes; preserve `VisualizerSettings` public API and `Props` interface unless asked to change them; call out any behavior changes.
- Run type-check after code changes: `tsc --noEmit` (or `npm run lint`).
- New visualizers should be single-purpose, self-contained in one file under `src/components/visualizers/`, and follow the audio pipeline and settings ref patterns described above.
- External dependencies: only when necessary, explain why.
