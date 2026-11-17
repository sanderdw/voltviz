/** User-adjustable settings shared by all visualizers (Settings panel / URL parameters). */
export interface VisualizerSettings {
  sensitivity: number;
  speed: number;
  hueShift: number;
  scale: number;
}

/**
 * The track that is playing, when the audio source knows it (Sendspin). The fields follow the
 * Sendspin metadata, so its metadata can be passed as is.
 */
export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork_url?: string;
}
