/**
 * Thin wrapper around an ONNX Runtime session for the beat model (beat_this small0, exported
 * with a fixed 500-frame input). The runtime module is injected so the same code serves the
 * browser Worker (onnxruntime-web/wasm) and Node (offline evaluation).
 */
import { N_MELS } from './melFrontend.ts';

export const MODEL_FRAMES = 500;

/** The subset of the onnxruntime-web API that is used. */
export interface OrtLike {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(model: string | Uint8Array, options?: Record<string, unknown>): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
      release?(): Promise<void>;
    }>;
  };
}

export interface BeatModel {
  /** Beat probabilities (500 values) for 500 x 128 log-mel frames. */
  run(frames: Float32Array): Promise<Float32Array>;
  release(): Promise<void>;
}

export async function createBeatModel(ort: OrtLike, model: string | Uint8Array): Promise<BeatModel> {
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return {
    async run(frames: Float32Array): Promise<Float32Array> {
      if (frames.length !== MODEL_FRAMES * N_MELS) throw new Error(`expected ${MODEL_FRAMES}x${N_MELS} frames`);
      const out = await session.run({ spect: new ort.Tensor('float32', frames, [1, MODEL_FRAMES, N_MELS]) });
      return Float32Array.from(out.beat.data as Float32Array);
    },
    async release() {
      await session.release?.();
    },
  };
}
