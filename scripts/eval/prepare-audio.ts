/**
 * Downloads the test mix (if missing) and cuts the evaluation excerpts listed in
 * scripts/eval/excerpts.json to 44.1 kHz stereo WAV files in .cache/test-audio/ (gitignored).
 *
 *   node scripts/eval/prepare-audio.ts
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

interface Manifest {
  source: { url: string; file: string };
  excerpts: { id: string; start: number; seconds: number; role: string; note: string }[];
}

export const manifest: Manifest = JSON.parse(readFileSync(new URL('./excerpts.json', import.meta.url), 'utf8'));
export const excerptPath = (id: string) => `.cache/test-audio/${id}.wav`;

async function main() {
  mkdirSync('.cache/test-audio', { recursive: true });
  const src = manifest.source.file;
  if (!existsSync(src)) {
    console.log(`downloading ${manifest.source.url}`);
    const res = await fetch(manifest.source.url);
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${src}.part`));
    renameSync(`${src}.part`, src);
  }
  for (const e of manifest.excerpts) {
    const out = excerptPath(e.id);
    if (existsSync(out)) continue;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(e.start), '-t', String(e.seconds), '-i', src,
      '-ar', '44100', '-c:a', 'pcm_s16le', out]);
    console.log(`cut ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
