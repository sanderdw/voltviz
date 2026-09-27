/**
 * Main-thread side of the beat model: owns the Worker, loads the model lazily and runs at
 * most one inference at a time. Requests arriving while one is in flight are dropped, so on
 * slow devices the model simply runs less often (graceful degradation).
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

export type NeuralStatus = 'off' | 'loading' | 'ready' | 'error' | 'unsupported';

export class NeuralClient {
  status: NeuralStatus = 'off';
  lastMs = 0;
  error = '';
  private worker: Worker | null = null;
  private busy = false;
  private nextId = 1;
  private pending = new Map<number, (a: Float32Array | null) => void>();

  start(): void {
    if (this.worker || this.status === 'unsupported') return;
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      this.status = 'unsupported';
      return;
    }
    this.status = 'loading';
    const worker = new Worker(new URL('./neural.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'ready') this.status = 'ready';
      else if (m.type === 'result') {
        this.lastMs = m.ms;
        this.busy = false;
        this.pending.get(m.id)?.(m.activation);
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        console.warn('VoltViz: beat model unavailable, falling back to DSP-only beat tracking:', m.message);
        this.error = m.message;
        this.status = 'error';
        this.busy = false;
        for (const cb of this.pending.values()) cb(null);
        this.pending.clear();
      }
    };
    worker.onerror = ev => {
      this.status = 'error';
      this.error = ev.message;
    };
    const modelUrl = new URL('models/beat_this_small0.onnx', document.baseURI).href;
    worker.postMessage({ type: 'init', modelUrl, wasmUrl: new URL(wasmUrl, document.baseURI).href });
  }

  /** Runs the model if ready and idle; resolves null when skipped or failed. */
  run(frames: Float32Array): Promise<Float32Array | null> {
    if (!this.worker || this.status !== 'ready' || this.busy) return Promise.resolve(null);
    this.busy = true;
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ type: 'run', id, frames }, [frames.buffer]);
    });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    for (const cb of this.pending.values()) cb(null);
    this.pending.clear();
    if (this.status !== 'unsupported') this.status = 'off';
  }
}
