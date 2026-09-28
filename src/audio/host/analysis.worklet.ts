/// <reference lib="webworker" />
/**
 * AudioWorklet host of the analysis core. Runs the complete DSP analysis on the audio
 * thread, independent of the render frame rate, and posts compact results to the engine.
 */
import type { StyleId } from '../core/styles';
import { AnalysisCore } from './analysisCore';
import type { EngineToHost } from './protocol';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

class VoltvizAnalysisProcessor extends AudioWorkletProcessor {
  private readonly core: AnalysisCore;

  constructor(options: { processorOptions?: { neural?: boolean; style?: StyleId } }) {
    super(options);
    this.core = new AnalysisCore(
      sampleRate,
      (m, transfer) => this.port.postMessage(m, transfer ?? []),
      !!options.processorOptions?.neural,
      options.processorOptions?.style,
    );
    this.port.onmessage = (e: MessageEvent<EngineToHost>) => this.core.onMessage(e.data);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length && input[0].length) this.core.process(input, input[0].length, currentTime);
    return true;
  }
}

registerProcessor('voltviz-analysis', VoltvizAnalysisProcessor);
