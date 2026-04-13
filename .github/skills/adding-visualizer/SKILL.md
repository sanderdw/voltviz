---
name: adding-visualizer
description: 'Add or update VoltViz visualizers with project conventions. Use when creating a new visualizer, modifying an existing visualizer, wiring App.tsx registration, preserving VisualizerSettings mapping, and running lint/type checks.'
argument-hint: '[request summary]'
---

# Adding Visualizer

## What This Skill Produces
- A focused change set for a visualizer task in VoltViz.
- Correct registration updates in App.tsx when a new visualizer is introduced.
- Safe animation/audio cleanup behavior to avoid leaks.
- Post-change validation via lint/type check.

## When To Use
- Add a brand-new visualizer component.
- Modify behavior or rendering of an existing visualizer.
- Update only App.tsx registration for visualizer availability.
- Apply consistent mapping for sensitivity, speed, hueShift, and scale.

## Inputs
- User request describing desired visual behavior.
- Optional constraints (Canvas-only, WebGL/Three.js-specific, no dependencies, etc.).

## Decision Flow
1. Classify task:
- New visualizer.
- Existing visualizer modification.
- App-level registration/update only.
2. Choose rendering approach:
- Default to Canvas 2D.
- Use WebGL/Three.js only when explicitly requested.
3. Determine change footprint:
- Minimal edits only; no unrelated refactors.

## Procedure
1. Inspect current patterns in src/components/visualizers and App.tsx.
2. Implement smallest viable change for requested behavior.
3. If adding a new visualizer, update App.tsx in all required spots:
- Add literal to VisualizerType union.
- Add lazy import entry in visualizerComponents.
- Add selector option in the visualizer select.
4. Keep VisualizerSettings mapping consistent:
- sensitivity scales reactivity amplitude.
- speed scales animation rate / elapsed-time effects.
- hueShift offsets hue calculations with hueShift / 360.
- scale changes size/intensity of the primary visual form.
5. Enforce runtime safety and cleanup:
- Track and cancel requestAnimationFrame.
- Disconnect audio source node.
- Close AudioContext when applicable.
- For Three.js: dispose renderer/material/geometry and remove resize listeners.
6. Preserve conventions:
- File and component names are matching PascalCase.
- Default export for visualizer component.
- Avoid adaptive sound processing.
- Do not change settings defaults in App.tsx.
7. Update CHANGELOG.md under Unreleased for user-facing or contributor-impacting changes.
8. Run npm run lint (or tsc --noEmit) when practical as a recommended validation step.
- Ignore pre-existing Playwright typing issues in playwright.config.ts and tests.

## Quality Gates
- Validation is attempted (lint/type-check) when practical for the current task.
- No leaked animation loops or audio resources.
- New visualizer appears in selector and renders.
- Existing visualizer modifications preserve expected controls behavior.

## Completion Checklist
- Requirement implemented exactly once (no duplicate feature paths).
- Registration complete if new visualizer.
- Cleanup logic confirmed.
- Changelog updated when relevant.
- Validation command executed.
