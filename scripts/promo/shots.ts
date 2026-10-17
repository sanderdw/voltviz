// The promo shot list: which visualizer plays over which bars of the generated track. Calm
// visualizers sit in the breakdown, high-energy ones on the drops; every cut lands on a downbeat.
import { visualizers } from '../../src/visualizers/registry.ts';
import { BAR, trackInfo, type SectionName } from './track.ts';

export interface Shot {
  id: string;
  /** Extra query params (with a leading &) to show the visualizer at its best. */
  params?: string;
  /** First bar of the shot in the track. */
  bar: number;
  bars: number;
}

/** Ordered and contiguous: each shot starts where the previous one ends. */
export const SHOTS: Shot[] = [
  { id: 'halftonepulse', bar: 0, bars: 4 },                                   // intro (title card)
  { id: 'bars', bar: 4, bars: 2 },                                            // build
  { id: 'oscilloscope', params: '&mode=vector&shape=cube', bar: 6, bars: 2 },
  { id: 'pulsar', params: '&shot=pulsar&palette=magnetar', bar: 8, bars: 2 }, // drop A
  { id: 'lasershow', bar: 10, bars: 2 },
  { id: 'kaleidoscope', bar: 12, bars: 2 },
  { id: 'milkdrop', bar: 14, bars: 2 },
  { id: 'blobtracker', params: '&scene=drift', bar: 16, bars: 2 },
  { id: 'glitchdatabend', bar: 18, bars: 2 },
  { id: 'aurorawaves', bar: 20, bars: 2 },                                    // breakdown
  { id: 'vinylsendspin', bar: 22, bars: 2 },
  { id: 'vumeter', bar: 24, bars: 2 },
  { id: 'crtterminal', bar: 26, bars: 2 },
  { id: 'rawaudio', bar: 28, bars: 2 },                                       // build 2
  { id: 'sungalizer', bar: 30, bars: 2 },                                     // drop B
  { id: 'dutchgrid', bar: 32, bars: 2 },
  { id: 'polysphere', bar: 34, bars: 6 },                                     // drop B + outro (end card)
];

/** The showcase/silent loop: the first LOOP_BARS of these shots, in this order. */
export const LOOP_IDS = ['pulsar', 'lasershow', 'kaleidoscope', 'milkdrop', 'oscilloscope', 'glitchdatabend', 'sungalizer', 'polysphere'];
export const LOOP_BARS = 1;

/** Bars after the shot start where the still for the poster is taken (a hit, not a cut). */
export const STILL_AT_BAR = 1;

export const startOf = (shot: Shot) => shot.bar * BAR;
export const endOf = (shot: Shot) => (shot.bar + shot.bars) * BAR;

export function sectionOf(shot: Shot): SectionName {
  return trackInfo().sections.filter(sec => sec.bar <= shot.bar).at(-1)!.name;
}

/** Display name and tag for the label: "Pulsar (WebGPU)" → { name: "Pulsar", tag: "WebGPU" }. */
export function labelOf(id: string): { name: string; tag?: string } {
  const v = visualizers.find(x => x.id === id);
  if (!v) throw new Error(`Unknown visualizer id: ${id}`);
  const m = /^(.*?)\s*\((.+)\)$/.exec(v.name);
  return m ? { name: m[1], tag: m[2] } : { name: v.name };
}

export function validateShots(): void {
  let bar = 0;
  for (const shot of SHOTS) {
    labelOf(shot.id);
    if (shot.bar !== bar) throw new Error(`Shot ${shot.id} starts at bar ${shot.bar}, expected ${bar}`);
    bar += shot.bars;
  }
  if (bar !== trackInfo().bars.length - 1) throw new Error(`Shots cover ${bar} bars, the track has ${trackInfo().bars.length - 1}`);
  for (const id of LOOP_IDS) if (!SHOTS.some(s => s.id === id)) throw new Error(`Loop id ${id} is not a shot`);
}
