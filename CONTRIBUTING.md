# Contributing to VoltViz

Contributions are welcome: new visualizers, performance work, bug fixes and docs.

## Setup

Node.js 22.18 or newer (CI and Docker use Node 26).

```bash
npm install
npm run dev            # http://localhost:3000
npm run test:install   # once: Playwright's Chromium
```

## Before you open a pull request

```bash
npm run lint        # TypeScript
npm run test:unit   # audio engine unit tests (vitest)
npm test            # Playwright e2e tests (starts its own server on port 3100)
npm run build
```

- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything users or contributors notice.
- Keep the change focused; the PR template asks how you verified it.
- New or changed visualizers: follow `.github/skills/adding-visualizer/SKILL.md`
  (`npm run new:viz`, and `npm run eval:live -- --ids <id>` must pass) and
  `.github/docs/audio-reactivity-patterns.md`.

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
