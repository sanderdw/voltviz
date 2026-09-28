/// <reference lib="webworker" />
/**
 * Web Worker that runs the beat model (beat_this small0, ONNX, WebAssembly backend) off the
 * main thread. Messages: init -> ready|error, run -> result|error.
 */
import { createBeatModel, type BeatModel } from './beatModel';

type In =
  | { type: 'init'; modelUrl: string; wasmUrl: string }
  | { type: 'run'; id: number; frames: Float32Array };

let model: BeatModel | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1; // no SharedArrayBuffer without cross-origin isolation
      ort.env.wasm.wasmPaths = { wasm: m.wasmUrl };
      const res = await fetch(m.modelUrl);
      if (!res.ok) throw new Error(`model download failed: ${res.status}`);
      model = await createBeatModel(ort as never, new Uint8Array(await res.arrayBuffer()));
      (self as unknown as Worker).postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      if (!model) throw new Error('model not loaded');
      const t = performance.now();
      const { beat, downbeat } = await model.run(m.frames);
      (self as unknown as Worker).postMessage({ type: 'result', id: m.id, activation: beat, downbeat, ms: performance.now() - t }, [beat.buffer, downbeat.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
