import { spawn } from 'node:child_process';

export interface StreamOptions {
  sampleRate: number;
  start?: number;
  seconds?: number;
  /** Block size handed to the callback (the AudioWorklet render quantum is 128). */
  block?: number;
}

/**
 * Decodes an audio file with ffmpeg and streams mono float blocks to `onBlock` without ever
 * holding the whole decoded file in memory (constant memory regardless of file length).
 */
export async function streamMono(path: string, o: StreamOptions, onBlock: (block: Float32Array) => void | Promise<void>): Promise<number> {
  const block = o.block ?? 128;
  const args = ['-v', 'error'];
  if (o.start) args.push('-ss', String(o.start));
  if (o.seconds) args.push('-t', String(o.seconds));
  // Downmix as the engine does in the browser: the mean of L and R (ffmpeg's plain `-ac 1`
  // would sum at -3 dB each, i.e. sqrt(2) x the mean).
  args.push('-i', path, '-af', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1',
    '-ar', String(o.sampleRate), '-f', 'f32le', '-');
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const pending = new Float32Array(block);
  let fill = 0;
  let total = 0;
  let carry: Buffer | null = null;
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    let buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    const usable: number = buf.length - (buf.length % 4);
    carry = usable < buf.length ? buf.subarray(usable) : null;
    buf = buf.subarray(0, usable);
    for (let off = 0; off < buf.length; off += 4) {
      pending[fill++] = buf.readFloatLE(off);
      if (fill === block) {
        const r = onBlock(pending);
        if (r) await r;
        total += block;
        fill = 0;
      }
    }
  }
  if (fill > 0) {
    await onBlock(pending.subarray(0, fill));
    total += fill;
  }
  await new Promise<void>((resolve, reject) => {
    if (ff.exitCode !== null) return ff.exitCode === 0 ? resolve() : reject(new Error(`ffmpeg exited ${ff.exitCode}`));
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  return total / o.sampleRate;
}
