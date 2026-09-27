import type { ComponentType } from 'react';
import type { VisualizerProps } from './types';

interface VisualizerEntry {
  readonly id: string;
  readonly name: string;
  readonly load: () => Promise<{ default: ComponentType<VisualizerProps> }>;
}

// Single source of truth for all visualizers: the id union, the lazy component
// map and the picker labels/order are all derived from this list.
export const visualizers = [
  { id: 'dutchgrid', name: 'Dutch Grid', load: () => import('./components/visualizers/DutchGrid') },
  { id: 'dutchgridwebgl', name: 'Dutch Grid (WebGL)', load: () => import('./components/visualizers/DutchGridWebGL') },
  { id: 'glitchbackground', name: 'Glitch Background', load: () => import('./components/visualizers/GlitchBackground') },
  { id: 'glitchdatabend', name: 'Glitch Databend', load: () => import('./components/visualizers/GlitchDatabend') },
  { id: 'yourlogo', name: 'Your Logo', load: () => import('./components/visualizers/YourLogo') },
  { id: 'icons', name: 'Icons', load: () => import('./components/visualizers/Icons') },
  { id: 'glowsphere', name: 'Glow Sphere', load: () => import('./components/visualizers/GlowSphere') },
  { id: 'crtterminal', name: 'CRT Terminal', load: () => import('./components/visualizers/CRTTerminal') },
  { id: 'cosmicparticles', name: 'Cosmic Particles', load: () => import('./components/visualizers/CosmicParticles') },
  { id: 'neonwave', name: 'Neon Wave', load: () => import('./components/visualizers/NeonWave') },
  { id: 'sheetmusic', name: 'Sheet Music', load: () => import('./components/visualizers/SheetMusic') },
  { id: 'tunnel', name: 'Tunnel', load: () => import('./components/visualizers/Tunnel') },
  { id: 'particlesstream', name: 'Particles Stream', load: () => import('./components/visualizers/ParticlesStream') },
  { id: 'circular', name: 'Circular', load: () => import('./components/visualizers/Circular') },
  { id: 'cybermatrix', name: 'Cyber Matrix', load: () => import('./components/visualizers/CyberMatrix') },
  { id: 'cybergridcanvas', name: 'Cyber Grid Canvas', load: () => import('./components/visualizers/CyberGridCanvas') },
  { id: 'bars', name: 'Bars', load: () => import('./components/visualizers/Bars') },
  { id: 'polysphere', name: 'Poly Sphere', load: () => import('./components/visualizers/PolySphere') },
  { id: 'psychedelicskull', name: 'Psychedelic Skull', load: () => import('./components/visualizers/PsychedelicSkull') },
  { id: 'ghostrainbow', name: 'Ghost Rainbow', load: () => import('./components/visualizers/GhostRainbow') },
  { id: 'neonhextunnel', name: 'Neon Hex Tunnel', load: () => import('./components/visualizers/NeonHexTunnel') },
  { id: 'fluidsmoke', name: 'Fluid Smoke', load: () => import('./components/visualizers/FluidSmoke') },
  { id: '3dequalizer', name: '3D Equalizer', load: () => import('./components/visualizers/ThreeDEqualizer') },
  { id: 'festivalstage', name: 'Festival Stage', load: () => import('./components/visualizers/FestivalStage') },
  { id: 'defqonmainstage', name: 'Defqon Mainstage', load: () => import('./components/visualizers/DefqonMainstage') },
  { id: 'disneydroneshow', name: 'Disney Drone Show', load: () => import('./components/visualizers/DisneyDroneShow') },
  { id: 'fireworksshow', name: 'Fireworks Show', load: () => import('./components/visualizers/FireworksShow') },
  { id: 'datadashboard', name: 'Data Dashboard', load: () => import('./components/visualizers/DataDashboard') },
  { id: 'vinyl', name: 'Vinyl', load: () => import('./components/visualizers/Vinyl') },
  { id: 'backgroundimage', name: 'Background Image', load: () => import('./components/visualizers/BackgroundImage') },
  { id: 'blurimage', name: 'Blur Image', load: () => import('./components/visualizers/BlurImage') },
  { id: 'flame', name: 'Flame', load: () => import('./components/visualizers/Flame') },
  { id: 'vumeter', name: 'VU Meter', load: () => import('./components/visualizers/VUMeter') },
  { id: 'hexglobe', name: 'Hex Globe', load: () => import('./components/visualizers/HexGlobe') },
  { id: 'milkdrop', name: 'MilkDrop', load: () => import('./components/visualizers/MilkDrop') },
  { id: 'milkdropwarp', name: 'MilkDrop Warp', load: () => import('./components/visualizers/MilkDropWarp') },
  { id: 'aurorawaves', name: 'Aurora Waves', load: () => import('./components/visualizers/AuroraWaves') },
  { id: 'msdefrag', name: 'MS Defrag', load: () => import('./components/visualizers/MsDefrag') },
  { id: 'fractalorb', name: 'Fractal Orb', load: () => import('./components/visualizers/FractalOrb') },
  { id: 'mossball', name: 'Moss Ball', load: () => import('./components/visualizers/MossBall') },
  { id: 'razor1911', name: 'Razor 1911', load: () => import('./components/visualizers/Razor1911') },
  { id: 'ascii', name: 'ASCII', load: () => import('./components/visualizers/Ascii') },
  { id: 'cybercity', name: 'Cyber City', load: () => import('./components/visualizers/CyberCity') },
  { id: 'audiodebug', name: 'Audio Debug', load: () => import('./components/visualizers/AudioDebug') },
  { id: 'aurumleaf', name: 'Aurum Leaf', load: () => import('./components/visualizers/AurumLeaf') },
  { id: 'anunakisphere', name: 'Anunaki Sphere', load: () => import('./components/visualizers/AnunakiSphere') },
  { id: 'trailsstream', name: 'Trails Stream', load: () => import('./components/visualizers/TrailsStream') },
  { id: 'shambhala', name: 'Shambhala', load: () => import('./components/visualizers/Shambhala') },
  { id: 'holoblinds', name: 'Holo Blinds', load: () => import('./components/visualizers/HoloBlinds') },
  { id: 'insidequantum', name: 'Inside Quantum', load: () => import('./components/visualizers/InsideQuantum') },
  { id: 'sungalizer', name: 'Sungalizer', load: () => import('./components/visualizers/Sungalizer') },
  { id: 'vinylsendspin', name: 'Vinyl (Sendspin)', load: () => import('./components/visualizers/VinylSendspin') },
  { id: 'glitchbackgroundsendspin', name: 'Glitch Background (Sendspin)', load: () => import('./components/visualizers/GlitchBackgroundSendspin') },
  { id: 'backgroundimagesendspin', name: 'Background Image (Sendspin)', load: () => import('./components/visualizers/BackgroundImageSendspin') },
] as const satisfies readonly VisualizerEntry[];

export type VisualizerType = (typeof visualizers)[number]['id'];

export const visualizerIds = visualizers.map(v => v.id) as readonly VisualizerType[];

export const visualizerNames = Object.fromEntries(
  visualizers.map(v => [v.id, v.name])
) as Record<VisualizerType, string>;

export function isVisualizerType(value: string | null | undefined): value is VisualizerType {
  return !!value && (visualizerIds as readonly string[]).includes(value);
}
