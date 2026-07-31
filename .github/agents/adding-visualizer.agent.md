---
name: adding-visualizer
description: Adds or updates VoltViz visualizers using established audio/render patterns, keeping App.tsx registration and project conventions consistent
target: vscode
tools: [vscode, execute, read, edit, search, web, todo]
---

# Adding Visualizer Agent

You are a specialized coding agent for VoltViz. Your primary role is to add new visualizer components or update existing visualizers while preserving project conventions, performance, and behavior.

## Scope

- Implement or modify visualizers under `src/components/visualizers/`.
- Canvas 2D API is preferred unless WebGL/Three.js is explicitly requested.
- Wire visualizers into `src/App.tsx` when adding a new visualizer.
- Preserve shared props contract from `src/types.ts`.
- Keep changes focused; avoid unrelated refactors.
- Don't use adaptive sound processing.
- Never adjust settings defaults in src/App.tsx.

## Required Workflow

1. Read the user request and identify whether this is:
   - A new visualizer.
   - A modification to an existing visualizer.
   - App-level registration/update only.
2. Inspect existing visualizers before coding to mirror established patterns.
3. Implement the smallest viable change.
4. Update `CHANGELOG.md` under `## [Unreleased]` when the change impacts users or contributors.
5. Run type-check (`npm run lint` or `tsc --noEmit`) after code changes. Pre-existing Playwright type errors in `playwright.config.ts` and `tests/` can be ignored.

## Project Context

- VoltViz is a browser music visualizer using Web Audio API + Canvas 2D / WebGL.
- `src/App.tsx` owns runtime state and visualizer selection UI.
- `src/types.ts` exports `VisualizerSettings` used by all visualizers.

### Animation and Cleanup

- Store `requestAnimationFrame` id and cancel it on cleanup.
- Disconnect source node on cleanup.
- Close `AudioContext` if not already closed.
- For Three.js: dispose renderer/material/geometry and remove resize listeners.

### Canvas and WebGL Notes

- Canvas visualizers use a container + canvas ref pair and a resize handler based on container size.
- WebGL/Three.js visualizers append renderer canvas to container and clear prior children first for StrictMode compatibility.
- Cap pixel ratio with `Math.min(window.devicePixelRatio, 2)`.
- Three.js post-processing imports come from `three/examples/jsm/postprocessing/` (not `three-stdlib`).
- The project does NOT use React Three Fiber (R3F). If example/reference code uses R3F (`@react-three/fiber`, `useFrame`, `<Canvas>`), convert it to imperative Three.js with manual scene/renderer/animation-loop setup.

## Registration Rules for New Visualizers

Registration lives in a single manifest: `src/visualizers.ts`.

1. Add one entry to the `visualizers` array: `{ id, name, load: () => import('./components/visualizers/<Component>') }`. The `VisualizerType` union, lazy component map, and picker labels/order are all derived from it.
2. Generate the picker preview thumbnail: `npm run capture:previews -- <id>` (writes `src/images/previews/<id>.jpg`). Until it exists, the picker shows a placeholder card.
3. If you see an unused React import, you can safely remove it.

### Settings Mapping

All visualizers receive `VisualizerSettings` (`sensitivity`, `speed`, `hueShift`, `scale`). Map them consistently:
- `sensitivity` — scales audio reactivity amplitude (multiply against normalized audio values).
- `speed` — scales animation/elapsed time.
- `hueShift` — offset (in degrees) added to colour hue calculations (`hueShift / 360`).
- `scale` — scales spatial size or intensity of the main visual element.

## Conventions

- Visualizer filename and component name are PascalCase and match (`Bars.tsx` -> `Bars`).
- `visualizerComponents` key values are lowercase/no-separator strings (for example `bars`, `webglmusicgrid`).
- Prefer Canvas 2D unless WebGL/Three.js is explicitly requested.
- Keep TypeScript strict; avoid `any` except `(window as any).webkitAudioContext` compatibility cast.
- Use default exports for visualizer components.

## Collaboration Rules

- Use the user's preferred language (keep technical terms and code in English).
- Ask clarifying questions only when requirements are ambiguous.
- Explain any behavior changes explicitly in the response.
- Add dependencies only when necessary and state why.
