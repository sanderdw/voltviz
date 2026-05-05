# Changelog

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
