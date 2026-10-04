interface VisualizerEntry {
  readonly id: string;
  readonly name: string;
  /** Module file in ./impl (without extension). */
  readonly module: string;
}


// Single source of truth for all visualizers: the id union, the module map and
// the picker labels/order are all derived from this list.
export const visualizers = [
  { id: 'dutchgrid', name: 'Dutch Grid', module: 'DutchGrid' },
  { id: 'dutchgridwebgl', name: 'Dutch Grid (WebGL)', module: 'DutchGridWebGL' },
  { id: 'glitchbackgroundsendspin', name: 'Glitch Background', module: 'GlitchBackgroundSendspin' },
  { id: 'glitchdatabend', name: 'Glitch Databend', module: 'GlitchDatabend' },
  { id: 'yourlogo', name: 'Your Logo', module: 'YourLogo' },
  { id: 'icons', name: 'Icons', module: 'Icons' },
  { id: 'glowsphere', name: 'Glow Sphere', module: 'GlowSphere' },
  { id: 'crtterminal', name: 'CRT Terminal', module: 'CRTTerminal' },
  { id: 'cosmicparticles', name: 'Cosmic Particles', module: 'CosmicParticles' },
  { id: 'neonwave', name: 'Neon Wave', module: 'NeonWave' },
  { id: 'sheetmusic', name: 'Sheet Music', module: 'SheetMusic' },
  { id: 'tunnel', name: 'Tunnel', module: 'Tunnel' },
  { id: 'particlesstream', name: 'Particles Stream', module: 'ParticlesStream' },
  { id: 'circular', name: 'Circular', module: 'Circular' },
  { id: 'cybermatrix', name: 'Cyber Matrix', module: 'CyberMatrix' },
  { id: 'cybergridcanvas', name: 'Cyber Grid Canvas', module: 'CyberGridCanvas' },
  { id: 'bars', name: 'Bars', module: 'Bars' },
  { id: 'polysphere', name: 'Poly Sphere', module: 'PolySphere' },
  { id: 'psychedelicskull', name: 'Psychedelic Skull', module: 'PsychedelicSkull' },
  { id: 'fluidsmoke', name: 'Fluid Smoke', module: 'FluidSmoke' },
  { id: '3dequalizer', name: '3D Equalizer', module: 'ThreeDEqualizer' },
  { id: 'defqonmainstage', name: 'Defqon Mainstage', module: 'DefqonMainstage' },
  { id: 'disneydroneshow', name: 'Disney Drone Show', module: 'DisneyDroneShow' },
  { id: 'fireworksshow', name: 'Fireworks Show', module: 'FireworksShow' },
  { id: 'datadashboard', name: 'Data Dashboard', module: 'DataDashboard' },
  { id: 'vinylsendspin', name: 'Vinyl', module: 'VinylSendspin' },
  { id: 'backgroundimagesendspin', name: 'Background Image', module: 'BackgroundImageSendspin' },
  { id: 'blurimage', name: 'Blur Image', module: 'BlurImage' },
  { id: 'flame', name: 'Flame', module: 'Flame' },
  { id: 'vumeter', name: 'VU Meter', module: 'VUMeter' },
  { id: 'hexglobe', name: 'Hex Globe', module: 'HexGlobe' },
  { id: 'milkdrop', name: 'MilkDrop', module: 'MilkDrop' },
  { id: 'milkdropwarp', name: 'MilkDrop Warp', module: 'MilkDropWarp' },
  { id: 'aurorawaves', name: 'Aurora Waves', module: 'AuroraWaves' },
  { id: 'msdefrag', name: 'MS Defrag', module: 'MsDefrag' },
  { id: 'fractalorb', name: 'Fractal Orb', module: 'FractalOrb' },
  { id: 'mossball', name: 'Moss Ball', module: 'MossBall' },
  { id: 'razor1911', name: 'Razor 1911', module: 'Razor1911' },
  { id: 'cybercity', name: 'Cyber City', module: 'CyberCity' },
  { id: 'rawaudio', name: 'Raw Audio', module: 'RawAudio' },
  { id: 'aurumleaf', name: 'Aurum Leaf', module: 'AurumLeaf' },
  { id: 'anunakisphere', name: 'Anunaki Sphere', module: 'AnunakiSphere' },
  { id: 'trailsstream', name: 'Trails Stream', module: 'TrailsStream' },
  { id: 'shambhala', name: 'Shambhala', module: 'Shambhala' },
  { id: 'holoblinds', name: 'Holo Blinds', module: 'HoloBlinds' },
  { id: 'insidequantum', name: 'Inside Quantum', module: 'InsideQuantum' },
  { id: 'sungalizer', name: 'Sungalizer', module: 'Sungalizer' },
  { id: 'halftonepulse', name: 'Halftone Pulse', module: 'HalftonePulse' },
  { id: 'lasershow', name: 'Laser Show', module: 'LaserShow' },
  { id: 'kaleidoscope', name: 'Kaleidoscope', module: 'Kaleidoscope' },
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
