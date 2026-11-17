# Contributing to VoltViz

Contributions are welcome: new visualizers, performance work, bug fixes and docs.

## Setup

Node.js 22.18 or newer (CI and Docker use Node 26).

```bash
npm install
npm run dev            # http://localhost:3000
npm run test:install   # once: Playwright's Chromium
```

On Linux, Playwright may also need system libraries: `npx playwright install-deps chromium`.

## Before you open a pull request

```bash
npm run lint        # TypeScript
npm run knip        # unused files, exports and dependencies
npm run test:unit   # audio engine unit tests (vitest)
npm test            # Playwright e2e tests (starts its own server on port 3100)
npm run build
```

- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything users or contributors notice.
- Keep the change focused; the PR template asks how you verified it.
- New or changed visualizers: follow `.github/skills/adding-visualizer/SKILL.md`
  (`npm run new:viz`, and `npm run eval:live -- --ids <id>` must pass) and
  `.github/docs/audio-reactivity-patterns.md`.

## Other scripts

| Command | Description |
|---------|-------------|
| `npm run preview` | Serve the production build locally |
| `npm run clean` | Remove `dist/` |
| `npm run new:viz -- <id> "<Name>"` | Scaffold a new visualizer from `scripts/templates/` |
| `npm run eval:prepare` / `eval:beats` / `eval:live` / `eval:before-after` | Beat-tracking evaluation on the genre excerpts in `scripts/eval/genres.json`. That file is local and gitignored: it lists songs from your own music library in `VOLTVIZ_MUSIC_DIR` (default `~/Music`) |
| `npm run report` | Rebuild the evidence report for the current version, `docs/reports/audio-engine-report-<version>.html`. Earlier reports stay next to it |
| `npm run capture:previews [ids...]` | Regenerate the picker preview thumbnails |
| `npm run make:og-image` | Regenerate the Open Graph image and maskable icon |
| `npm run promo -- [track\|record\|edit\|stills]` | Rebuild the promo video, the README poster and the banner. See `scripts/promo/` |

## Project structure

```
src/
├── audio/                  # Audio engine (no React, no visuals)
│   ├── core/               # Pure DSP: onsets, tempo, beat tracking, heard beats, levels, log-mel front end, neural arbiter
│   ├── neural/             # ONNX beat model (runs in a Web Worker)
│   ├── host/               # AudioWorklet host (ScriptProcessor fallback), shared analyser pool
│   ├── sources/            # Microphone, system audio, Sendspin, dev-only test audio
│   ├── AudioEngine.ts      # One AudioContext per session -> one AudioFrame per animation frame
│   └── types.ts            # AudioFrame: beats, onsets, bands, spectrum, waveform, stereo
├── visualizers/
│   ├── impl/               # The visualizers, as framework-free renderer modules
│   ├── runtime/            # VisualizerHost (single rAF loop, resize, errors), contract, QA probe
│   ├── lib/                # Canvas 2D / three.js / WebGPU / audio helpers
│   └── registry.ts         # Single source of truth: ids, names, picker order
├── app/                    # React shell: header, picker, settings, Sendspin bar/dialog, stage, URL state
├── skins.ts                # Every skin-specific style (the components only name the part)
├── data/                   # Static data (map of the Netherlands for Dutch Grid)
└── images/                 # Picker previews and icons

public/models/              # AI beat-tracking model (beat_this small0, MIT), see NOTICE.md
tests/                      # Playwright e2e tests; tests/unit/ holds the vitest unit tests
scripts/eval/               # Beat-tracking evaluation on genre excerpts (offline, live, before/after)
scripts/report/             # Builds the audio engine report
scripts/promo/              # Builds the promo video and README images
scripts/templates/          # Templates for `npm run new:viz`
docs/reports/               # Audio engine evidence reports (HTML) and their data
docs/presentation/          # Conference talk about the rewrite (HTML slides)
docs/explainer/             # Animated explainer of the audio engine (HTML)
nginx/default.conf          # Nginx configuration of the Docker image
```

The layers import in one direction: `app` → `visualizers` → `audio` (types only). `audio/core` is
pure DSP and imports nothing outside itself. `tests/unit/architecture.test.ts` fails when an import
crosses these lines.

## Docker image and CI

Build and run the production image locally:

```bash
docker build -t voltviz . && docker run --rm -p 8080:80 voltviz   # http://localhost:8080
```

GitHub Actions (`ci.yml`) runs the checks above and, only when they pass, builds the image for
`linux/amd64` and `linux/arm64`:

| Trigger | Result |
|---------|--------|
| Push to `main` | Published to `ghcr.io/sanderdw/voltviz` as `latest`, `main` and `sha-<commit>` |
| Push to `main` with a new `package.json` version | Also published as that version, and a `v<version>` GitHub release is created from `CHANGELOG.md` |
| Push to a release branch (named like `1.2.3`) | Published as `<package.json version>-rc` and `sha-<commit>` |
| Push to any other branch, pull request from a fork | Built, not published |
| Manual run | Same as a push to the selected branch |

A version tag is written once and never moves: it is only published while no `v<version>` git
tag exists. Bump `package.json` to release.

## Third-party code, assets and data

VoltViz is MIT licensed, so everything you add must be compatible with that:

- Only take code, shaders, images or data whose license allows it (MIT, BSD, ISC, Apache-2.0,
  CC BY, CC0, public domain). Name the source and license in a comment at the top of the file
  and add an entry to `THIRD_PARTY_NOTICES.md`.
- **Shadertoy code is CC BY-NC-SA 3.0 unless its author states otherwise**, and CodePen pens
  are MIT only when public. Check before porting; NonCommercial or ShareAlike material needs
  the maintainer's approval and an entry under "Not covered by the MIT license".
- npm dependencies need nothing extra: the build writes their license texts to
  `third-party-notices.txt`.

## Reporting security issues

Please don't open a public issue; see `SECURITY.md`.
