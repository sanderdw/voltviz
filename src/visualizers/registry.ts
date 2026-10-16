interface VisualizerEntry {
  readonly id: string;
  readonly name: string;
  /** Module file in ./impl (without extension). */
  readonly module: string;
}


// Single source of truth for all visualizers: the id union, the module map and
// the picker labels/order are all derived from this list (newest first).
export const visualizers = [
  { id: 'pulsar', name: 'Pulsar (WebGPU)', module: 'Pulsar' },
  { id: 'oscilloscope', name: 'Oscilloscope (WebGPU)', module: 'Oscilloscope' },
  { id: 'daybreak', name: 'Daybreak (WebGPU)', module: 'Daybreak' },
  { id: 'blobtracker', name: 'Blob Tracker (WebGPU)', module: 'BlobTracker' },
  { id: 'kaleidoscope', name: 'Kaleidoscope', module: 'Kaleidoscope' },
  { id: 'lasershow', name: 'Laser Show', module: 'LaserShow' },
  { id: 'halftonepulse', name: 'Halftone Pulse', module: 'HalftonePulse' },
  { id: 'sungalizer', name: 'Sungalizer', module: 'Sungalizer' },
  { id: 'insidequantum', name: 'Inside Quantum', module: 'InsideQuantum' },
  { id: 'holoblinds', name: 'Holo Blinds', module: 'HoloBlinds' },
  { id: 'shambhala', name: 'Shambhala', module: 'Shambhala' },
  { id: 'trailsstream', name: 'Trails Stream', module: 'TrailsStream' },
  { id: 'anunakisphere', name: 'Anunaki Sphere', module: 'AnunakiSphere' },
  { id: 'aurumleaf', name: 'Aurum Leaf', module: 'AurumLeaf' },
  { id: 'rawaudio', name: 'Raw Audio', module: 'RawAudio' },
  { id: 'cybercity', name: 'Cyber City', module: 'CyberCity' },
  { id: 'razor1911', name: 'Razor 1911', module: 'Razor1911' },
  { id: 'mossball', name: 'Moss Ball', module: 'MossBall' },
  { id: 'fractalorb', name: 'Fractal Orb', module: 'FractalOrb' },
  { id: 'msdefrag', name: 'MS Defrag', module: 'MsDefrag' },
  { id: 'aurorawaves', name: 'Aurora Waves', module: 'AuroraWaves' },
  { id: 'milkdropwarp', name: 'MilkDrop Warp', module: 'MilkDropWarp' },
  { id: 'milkdrop', name: 'MilkDrop', module: 'MilkDrop' },
  { id: 'hexglobe', name: 'Hex Globe', module: 'HexGlobe' },
  { id: 'vumeter', name: 'VU Meter', module: 'VUMeter' },
  { id: 'flame', name: 'Flame', module: 'Flame' },
  { id: 'blurimage', name: 'Blur Image', module: 'BlurImage' },
  { id: 'backgroundimagesendspin', name: 'Background Image', module: 'BackgroundImageSendspin' },
  { id: 'vinylsendspin', name: 'Vinyl', module: 'VinylSendspin' },
  { id: 'datadashboard', name: 'Data Dashboard', module: 'DataDashboard' },
  { id: 'fireworksshow', name: 'Fireworks Show', module: 'FireworksShow' },
  { id: 'disneydroneshow', name: 'Disney Drone Show', module: 'DisneyDroneShow' },
  { id: 'defqonmainstage', name: 'Defqon Mainstage', module: 'DefqonMainstage' },
  { id: '3dequalizer', name: '3D Equalizer', module: 'ThreeDEqualizer' },
  { id: 'fluidsmoke', name: 'Fluid Smoke', module: 'FluidSmoke' },
  { id: 'psychedelicskull', name: 'Psychedelic Skull', module: 'PsychedelicSkull' },
  { id: 'polysphere', name: 'Poly Sphere', module: 'PolySphere' },
  { id: 'bars', name: 'Bars', module: 'Bars' },
  { id: 'cybergridcanvas', name: 'Cyber Grid Canvas', module: 'CyberGridCanvas' },
  { id: 'cybermatrix', name: 'Cyber Matrix', module: 'CyberMatrix' },
  { id: 'circular', name: 'Circular', module: 'Circular' },
  { id: 'particlesstream', name: 'Particles Stream', module: 'ParticlesStream' },
  { id: 'tunnel', name: 'Tunnel', module: 'Tunnel' },
  { id: 'sheetmusic', name: 'Sheet Music', module: 'SheetMusic' },
  { id: 'neonwave', name: 'Neon Wave', module: 'NeonWave' },
  { id: 'cosmicparticles', name: 'Cosmic Particles', module: 'CosmicParticles' },
  { id: 'crtterminal', name: 'CRT Terminal', module: 'CRTTerminal' },
  { id: 'glowsphere', name: 'Glow Sphere', module: 'GlowSphere' },
  { id: 'icons', name: 'Icons', module: 'Icons' },
  { id: 'yourlogo', name: 'Your Logo', module: 'YourLogo' },
  { id: 'glitchdatabend', name: 'Glitch Databend', module: 'GlitchDatabend' },
  { id: 'glitchbackgroundsendspin', name: 'Glitch Background', module: 'GlitchBackgroundSendspin' },
  { id: 'dutchgridwebgl', name: 'Dutch Grid (WebGL)', module: 'DutchGridWebGL' },
  { id: 'dutchgrid', name: 'Dutch Grid', module: 'DutchGrid' },
] as const satisfies readonly VisualizerEntry[];

export type VisualizerType = (typeof visualizers)[number]['id'];

export const visualizerIds = visualizers.map(v => v.id) as readonly VisualizerType[];

export const visualizerNames = Object.fromEntries(
  visualizers.map(v => [v.id, v.name])
) as Record<VisualizerType, string>;

export function isVisualizerType(value: string | null | undefined): value is VisualizerType {
  return !!value && (visualizerIds as readonly string[]).includes(value);
}

/** Ids of removed visualizers that live on in another one (old links keep working). */
const aliases: Record<string, VisualizerType> = {
  vinyl: 'vinylsendspin',
  glitchbackground: 'glitchbackgroundsendspin',
  backgroundimage: 'backgroundimagesendspin',
};

/** The visualizer an id (from a URL) stands for, following aliases; null when unknown. */
export function resolveVisualizer(value: string | null | undefined): VisualizerType | null {
  if (isVisualizerType(value)) return value;
  return (value && aliases[value]) || null;
}
