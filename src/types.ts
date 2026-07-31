import type { ServerStateMetadata } from '@sendspin/sendspin-js';

export interface VisualizerSettings {
  sensitivity: number;
  speed: number;
  hueShift: number;
  scale: number;
}

export interface VisualizerProps {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
}
