/**
 * Main-thread fallback host for contexts without AudioWorklet (AudioWorklet requires a
 * secure context, e.g. Sendspin over plain http on a LAN). Uses the same AnalysisCore; the
 * ScriptProcessorNode delivers every sample, so the analysis is identical, only on the
 * main thread.
 */
import { AnalysisCore } from './analysisCore';
import type { EngineToHost, HostToEngine } from './protocol';

export interface AnalysisHost {
  readonly kind: 'worklet' | 'scriptprocessor';
  readonly input: AudioNode;
  send(m: EngineToHost): void;
  dispose(): void;
}

export function createScriptProcessorHost(ctx: AudioContext, neural: boolean, onMessage: (m: HostToEngine) => void): AnalysisHost {
  const node = ctx.createScriptProcessor(1024, 2, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination); // must be pulled to run
  const core = new AnalysisCore(ctx.sampleRate, m => queueMicrotask(() => onMessage(m)), neural);
  const channels: Float32Array[] = [];
  node.onaudioprocess = e => {
    channels.length = 0;
    for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) channels.push(e.inputBuffer.getChannelData(c));
    core.process(channels, e.inputBuffer.length, e.playbackTime);
  };
  return {
    kind: 'scriptprocessor',
    input: node,
    send: m => core.onMessage(m),
    dispose: () => {
      node.onaudioprocess = null;
      node.disconnect();
      sink.disconnect();
    },
  };
}

export async function createWorkletHost(ctx: AudioContext, moduleUrl: string, neural: boolean, onMessage: (m: HostToEngine) => void): Promise<AnalysisHost> {
  await ctx.audioWorklet.addModule(moduleUrl);
  const node = new AudioWorkletNode(ctx, 'voltviz-analysis', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { neural },
  });
  node.port.onmessage = (e: MessageEvent<HostToEngine>) => onMessage(e.data);
  node.onprocessorerror = () => onMessage({ type: 'error', message: 'analysis worklet crashed' });
  return {
    kind: 'worklet',
    input: node,
    send: m => node.port.postMessage(m),
    dispose: () => {
      node.port.onmessage = null;
      node.disconnect();
    },
  };
}
