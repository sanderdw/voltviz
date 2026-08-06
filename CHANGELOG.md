# Changelog

## [0.21.2] - 2026-08-06

### Fixed
- Sendspin player registration now persists `voltviz_sendspin_client_id` in browser `localStorage` across page reloads and reconnects, ensuring each client re-registers as the same player on the Sendspin / Music Assistant server.
- Fixed TypeScript build errors with `@sendspin/sendspin-js` 4.0.0 by removing deprecated `playerId` from `SendspinPlayerConfig` and using `player.clientId`.
- Added `player.unlock()` call before connecting in `startSendspin()` to satisfy mobile browser autoplay policies and ensure seamless audio playback on mobile devices.

### Changed
- Dependency bumps

## [0.21.1] - 2026-08-01

### Fixed
- Built asset URLs are now relative (Vite `base: './'`), so visualizer preview thumbnails and other bundled assets load correctly when the app is served under a path prefix such as Home Assistant ingress.

## [0.21.0] - 2026-08-01

### Added
- Visualizer gallery picker – the header dropdown is replaced by a modal with preview screenshot cards for every visualizer.
- Shuffle mode – toggle in the settings panel that switches to a random visualizer at a selectable interval (15s–10m), persisted via `shuffle`/`shuffleTime` URL params.
- Seamless crossfade between visualizers – the previous visualizer keeps rendering while the next one loads and warms up, then fades in; applies to shuffle switches and manual selection.
- Transition style setting (Crossfade / Quick cut / Instant) in the settings panel, persisted via the `transition` URL param – lighter modes for low-end hardware.
- Sungalizer visualizer – retro amber-phosphor CRT quad analyzer: 2D spectrum, 3D depth-trace waterfall, scrolling spectrogram, and oscilloscope, plus a hardware-style side panel with reactive VU needle and knobs (Canvas 2D).

### Changed
- Visualizer registration consolidated into a single manifest (`src/visualizers.ts`); new visualizers need just one entry plus a generated thumbnail.
- Dependency bumps

## [0.20.0] - 2026-06-30

### Added
- Particles Stream visualizer – flies a luma-sliced pixel-particle field of the album artwork toward the camera with afterimage motion blur; bass-reactive speed and brightness, with image upload (Three.js/WebGL).

### Changed
- Dependency bumps

## [0.19.1] - 2026-06-15

### Added
- Holo Blinds visualizer – raymarched twisting gyroid confined to a squashed sphere core with audio-reactive brightness, twist speed, and detail (Three.js/WebGL).
- Inside Quantum visualizer – full-screen KIFS fractal with volumetric raymarching, asymmetric folding, domain warping, and accumulated glow (Three.js/WebGL). Audio-reactive warp amplitude, rotation speed, and ray thickness.

### Changed
- Dependency bumps

### Acknowledgments
- Shoutout to [@sabosugi](https://x.com/sabosugi) for the nice visuals.

## [0.18.0] - 2026-05-23

### Added
- Skins system – switch the entire UI between **Modern**, **Win95**, **Winamp**, and **CRT** themes. Selectable via the `?skin=` URL parameter (e.g. `?skin=winamp`); the active skin is persisted to the URL alongside the other settings.
- ASCII visualizer – Canvas 2D audio-reactive ASCII art renderer.
- Cyber City visualizer – raymarched neon-grid cityscape flythrough with audio-driven scan pulses, fog, and dot density (Three.js/WebGL).
- Audio Debug visualizer – diagnostic view with waveform, FFT spectrum, kick detection, plus stereo correlation meter and rolling spectrogram (Canvas 2D).
- Aurum Leaf visualizer – tentacled energy bloom with particles, kick-reactive bloom bursts, and UnrealBloom post-processing (Three.js/WebGL).
- Anunaki Sphere visualizer – raymarched KIFS-folded sphere with auto-rotation and audio-reactive brightness/zoom (Three.js/WebGL).
- Trails Stream visualizer – bending tube-trail stream with blur, bloom, and audio-reactive exposure (Three.js/WebGL).
- Shambhala visualizer – voxel tunnel raymarcher with space-folding, glow, and audio-reactive exposure (Three.js/WebGL).

### Changed
- FractalOrb: refactored audio analysis and visual response for tighter reactivity.
- Vite: raised `chunkSizeWarningLimit` from 550 to 600 to accommodate the new shader-heavy visualizers.
- Dependency bumps

## [0.17.0] - 2026-05-13

### Added
- Music Assistant player visibility: Sendspin player is now automatically unhidden in Music Assistant after connecting, so it is visible in the UI.
- Moss Ball visualizer.
- Razor 1911 visualizer.

### Changed
- Updated Sendspin correction mode from `sync` to `quality-local`.
- Dependency bumps

## [0.16.0] - 2026-05-05

### Added
- Aurora Waves visualizer – raymarched fractal wave field with glowing volumetric accumulation, audio-reactive wave amplitudes, glow, and time scaling (Three.js/WebGL).
- MS Defrag visualizer – nostalgic Microsoft Defragmenter screen with cluster grid, audio-driven reading/writing/optimizing events, progress bar, and elapsed clock (Canvas 2D).
- Fractal Orb visualizer – raymarched fractal energy sphere with audio-reactive density, internal animation speed, glow, chromatic aberration, and pulsing scale (Three.js/WebGL).
- Dependency bumps

## [0.15.0] - 2026-04-23

### Added
- MilkDrop Warp visualizer – deep-tunnel feedback variant with vortex spiral warp, radial frequency bars, waveform spirals, concentric depth rings, and cross-shaped energy flare (Three.js/WebGL).
- MilkDrop visualizer – audio-reactive feedback-warp visualizer with ping-pong framebuffers, per-pixel motion vectors, kaleidoscopic symmetry, and psychedelic color cycling (Three.js/WebGL).
- Dependency bumps

## [0.14.0] - 2026-04-22

### Added
- Hex Globe visualizer – audio-reactive hexagonal globe inspired by https://github.com/wehwayne2/x-challenge-geo (Three.js/WebGL).

## [0.13.4] - 2026-04-20

### Fixed
- Fixed error messages being hidden behind the Sendspin connect dialog by rendering the error toast at the root level with a higher z-index.
- Reduced MusicGrid internal sensitivity by 0.8× damping factor to lower over-reactivity to audio.
- Dependency bumps

## [0.13.2] - 2026-04-14

### Changed
- Refactored Sendspin UI state in `src/App.tsx` into a single typed state object to simplify updates and reduce scattered state handling.
- Optimized visualizer rendering with memoization in `src/App.tsx` so the active visualizer element is only recreated when relevant inputs change.
- Improved error UX by adding a dismiss action to the in-app error banner.
- Using unique playerId

### Fixed
- Fixed Sendspin playback startup on phones/smaller screens by improving mobile autoplay handling so visualizations reliably start after connecting.

## [0.13.1] - 2026-04-14

### Added
- Added URL parameter support for visualizer selection and settings: navigate to `/?viz=tunnel&sensitivity=1.5&hueShift=180` to deep-link a specific visualizer with custom settings.
- URL is automatically updated when changing the visualizer or adjusting settings in the UI.
- Only non-default settings are included in the URL to keep it clean.

## [0.13.1] - 2026-04-14

### Added
- Added URL parameter support for visualizer selection and settings: navigate to `/?viz=tunnel&sensitivity=1.5&hueShift=180` to deep-link a specific visualizer with custom settings.
- URL is automatically updated when changing the visualizer or adjusting settings in the UI.
- Only non-default settings are included in the URL to keep it clean.

## [0.13.0] - 2026-04-13

### Added
- Added URL parameter support for direct Sendspin connection: navigate to `/?sendspin=<url>` to pre-fill the server URL and auto-open the connect dialog.
- Added Vinyl Player visualizer that displays Sendspin artwork, song title, and artist name.
- Added Glitch Player visualizer that applies audio-reactive glitch effects to Sendspin artwork.
- Added Background Player visualizer that uses Sendspin artwork as background behind the frequency bars.

## [0.12.0] - 2026-04-13

### Added
- Added [Music Assistant](https://music-assistant.io) support with [Sendspin](https://www.sendspin-audio.com) as a third audio source alongside Microphone and System Audio, enabling visualization of audio streams.

## [0.11.0] - 2026-04-08

### Added
- Added an analog VU Meter visualizer with dual L/R meters, authentic dB/percentage scales, ballistic needle smoothing, and vintage styling.

## [0.10.0] - 2026-03-25

### Added
- Added a new Flame visualizer with an audio-reactive shader effect using Three.js.

### Changed
- Registered the Flame visualizer in the visualizer selector and render mapping in `src/App.tsx`.
- Bumped project version in `package.json` from `0.9.0` to `0.10.0`.
- Reduced CyberMatrix default brightness: lowered bloom strength, particle audio reactivity, and line opacity multipliers so the visualizer no longer requires low sensitivity to look good.
- Added more swing to CyberMatrix: sinusoidal camera orbit, pendulum scene sway, and increased rotation amplitude for a more dynamic feel.

## [0.9.0] - 2026-03-24

### Added
- Initial public release of VoltViz
- 30+ visualization styles:
  - Particle Effects: WebGL Particles, Data Cloud, Fireworks
  - Abstract Patterns: CyberMatrix, Neon Hex Tunnel, Neon Wave
  - 3D Visualizations: Poly Sphere, Perlin Sphere, 3D Equalizer
  - Retro Styles: CRT Terminal, Vinyl Record, Glitch Effects
  - Festival Vibes: Festival Stage, Mega Festival Stage, Disney Drone Show
  - Organic Effects: Fluid Smoke, Ghost Rainbow, Psychedelic Skull
  - Data Driven: Music Grid, WebGL Music Grid, Data Dashboard
  - And more: Bars, Circular, Tunnel, Wave Terrain, Blur Visualizer
- Real-time audio input from microphone or system audio
- High-performance GPU-accelerated rendering with Three.js and WebGL
- Interactive controls: pause, resume, visualization switching
- Responsive design for desktop and tablet devices
- Docker deployment with Nginx
- GitHub Actions CI/CD pipeline for automatic Docker image building and publishing to GHCR
- Issue and pull request templates for bug reports, feature requests, and new visualization ideas
- MIT License for open-source distribution
- Professional README with quick start guides and feature documentation
- TypeScript support for type-safe development
- Tailwind CSS for modern styling

---

## How to Contribute

We welcome contributions through issues and pull requests. Use the templates in `.github/` and keep `CHANGELOG.md` updated for contributor-facing changes.

## Support

For bugs, feature requests, or questions:
- Open an [Issue](https://github.com/sanderdw/voltviz/issues)
- Check existing [Issues](https://github.com/sanderdw/voltviz/issues) first
