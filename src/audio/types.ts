/**
 * Public types of the audio engine. Visualizers only ever see {@link AudioFrame}: they never
 * touch Web Audio themselves.
 */
import type { AnalyzerState } from './core/Analyzer';

export type FftSize = 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 | 32768;

export interface SpectrumOptions {
  /** FFT size of the (shared, pooled) analyser. Default 2048. */
  fftSize?: FftSize;
  /** AnalyserNode.smoothingTimeConstant. Default 0.8. */
  smoothing?: number;
}

export interface BeatInfo {
  /** True in exactly the frame in which a (confident) beat lands. */
  isBeat: boolean;
  /** Running count of fired beats. */
  count: number;
  /** Position within the bar (0-3), counting fired beats. */
  barBeat: number;
  bpm: number;
  /** 0..1; beats below 0.3 are not fired. */
  confidence: number;
  /** 0..1 progress from the previous to the next predicted beat (continuous, for smooth motion). */
  phase: number;
  /** Seconds since the last fired beat. */
  sinceBeat: number;
  /** Beat period in seconds (0 when unknown). */
  period: number;
}

export interface OnsetInfo {
  /** True in the frame in which an onset of this kind lands. */
  hit: boolean;
  /** Seconds since the last onset of this kind. */
  since: number;
  /** 1 at the onset, decaying exponentially (tau 150 ms). */
  envelope: number;
  /** Strength of the last onset (relative to its adaptive threshold, typically 0.2..3). */
  strength: number;
}

/** Named frequency bands, each the mean of the 2048/0.8 byte spectrum in that range, 0..1. */
export interface Bands {
  sub: number; // 20-60 Hz
  bass: number; // 60-250 Hz
  lowMid: number; // 250-500 Hz
  mid: number; // 500-2000 Hz
  highMid: number; // 2-6 kHz
  treble: number; // 6-16 kHz
}

export interface AudioFrame {
  /** Seconds since the engine started (monotonic, frame clock). */
  time: number;
  /** Seconds since the previous frame (clamped to 0.1). */
  dt: number;
  sampleRate: number;
  /** Byte frequency data (0-255) of a shared analyser, read at most once per frame. */
  spectrum(options?: SpectrumOptions): Uint8Array;
  /** Byte time-domain data (128 = 0), length fftSize. */
  waveform(options?: SpectrumOptions): Uint8Array;
  /** Float time-domain data (-1..1), length fftSize. */
  waveformFloat(options?: SpectrumOptions): Float32Array;
  /** Per-channel float time-domain data (2048 samples each); right equals left for mono. */
  stereo(): { left: Float32Array; right: Float32Array };
  bands: Bands;
  /** RMS and peak of the display path (after Auto Gain). */
  level: { rms: number; peak: number };
  beat: BeatInfo;
  onsets: { kick: OnsetInfo; snare: OnsetInfo; hat: OnsetInfo };
  silent: boolean;
  /** Current Auto Gain factor applied to the display path (1 when Auto Gain is off). */
  gain: number;
  autoGain: boolean;
  /** Raw analysis state, for diagnostics (Audio Debug). */
  analysis: AnalyzerState;
  /** Engine-level diagnostics. */
  engine: EngineDiagnostics;
}

export interface EngineDiagnostics {
  host: 'worklet' | 'scriptprocessor';
  /** Beat model status. */
  neural: 'off' | 'loading' | 'ready' | 'error' | 'unsupported';
  neuralMs: number;
  /** Seconds between an analysis message's audio and its arrival (0 when unknown). */
  latency: number;
  /** Recent onset-function history for plots (newest last). */
  history: { phase: Float32Array; kick: Float32Array; threshold: Float32Array; beats: Uint8Array };
}

/** Anything that can feed the engine. */
export type AudioInput =
  | { kind: 'stream'; stream: MediaStream }
  | { kind: 'element'; element: HTMLMediaElement };

export interface EngineOptions {
  autoGain: boolean;
  /** AI beat tracking (neural phase arbitration). */
  neural: boolean;
}
