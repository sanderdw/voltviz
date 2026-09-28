/**
 * Messages between an analysis host (AudioWorklet or ScriptProcessor fallback) and the
 * main-thread AudioEngine. Times inside `state`/`events` are stream seconds; add
 * `ctxOffset` to get AudioContext time.
 */
import type { AnalyzerEvent, AnalyzerState } from '../core/Analyzer';
import type { StyleId } from '../core/styles';

export interface AnalysisMessage {
  type: 'analysis';
  ctxOffset: number;
  state: AnalyzerState;
  events: AnalyzerEvent[];
  /** Per-hop values since the previous message (for diagnostics plots). */
  phase: Float32Array;
  kick: Float32Array;
  threshold: Float32Array;
}

export interface NeuralRequestMessage {
  type: 'neuralRequest';
  t0: number;
  validFrom: number;
  frames: Float32Array;
}

export type HostToEngine = AnalysisMessage | NeuralRequestMessage | { type: 'error'; message: string };

export type EngineToHost =
  | { type: 'neuralResult'; t0: number; validFrom: number; activation: Float32Array }
  | { type: 'neuralActive'; active: boolean }
  | { type: 'style'; style: StyleId };

/** Hops between analysis messages (~11.6 ms). */
export const HOPS_PER_MESSAGE = 2;
