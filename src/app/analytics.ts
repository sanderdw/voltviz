/**
 * Usage facts for whoever hosts this build. VoltViz itself never sends anything anywhere: a
 * deployment that wants statistics (voltviz.com) injects its own script that defines
 * `window.voltvizStats`. Without that script (Home Assistant, Docker, development) these calls
 * do nothing.
 *
 * Only moments a person caused are reported: audio actually starting (a permission granted, a
 * Sendspin server connected) and a visualizer picked while it runs. Page loads and shuffle steps
 * are not, so crawlers and link previews never produce a report.
 */
export type AudioSource = 'microphone' | 'system' | 'sendspin' | 'test';

export interface Usage {
  visualizer: string;
  source: AudioSource;
  /** `start`: the audio just started; `select`: picked in the visualizer picker while running. */
  trigger: 'start' | 'select';
  shuffle: boolean;
}

export function reportUsage(usage: Usage): void {
  try {
    (window as unknown as { voltvizStats?: (usage: Usage) => void }).voltvizStats?.(usage);
  } catch {
    // A broken host script must never break the visualizer.
  }
}
