/**
 * Cuts the evaluation excerpts of a manifest to 44.1 kHz stereo WAV files in .cache/test-audio/
 * (gitignored).
 *
 *   node scripts/eval/prepare-audio.ts [--manifest scripts/eval/genres.json]
 *
 * The default manifest (scripts/eval/excerpts.json) cuts the test mix, downloading it first if
 * missing. The genre manifest (scripts/eval/genres.json) cuts local files from the user's music
 * library: `file` is relative to VOLTVIZ_MUSIC_DIR (default ~/Music); missing files are skipped.
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface Excerpt {
  id: string;
  start: number;
  seconds: number;
  role: string;
  note: string;
  /** Genre manifest only: source file relative to the music directory. */
  file?: string;
  genre?: string;
  /** Genre manifest only: the Music style this excerpt belongs to. */
  style?: string;
  /** Genre manifest only: the pulse beat effects should follow (null: either metrical level). */
  expectedPulseBpm?: number | null;
}

export interface Manifest {
  source?: { name?: string; url: string; file: string };
  excerpts: Excerpt[];
}

export const DEFAULT_MANIFEST = 'scripts/eval/excerpts.json';
export const loadManifest = (path: string | URL): Manifest => JSON.parse(readFileSync(path, 'utf8'));
export const manifest: Manifest = loadManifest(new URL('./excerpts.json', import.meta.url));
export const excerptPath = (id: string) => `.cache/test-audio/${id}.wav`;
export const musicDir = () => process.env.VOLTVIZ_MUSIC_DIR ?? join(homedir(), 'Music');

/** The full-length file an excerpt is cut from. */
export function sourceFile(m: Manifest, e: Excerpt): string {
  if (e.file) return join(musicDir(), e.file);
  if (!m.source) throw new Error(`excerpt ${e.id} has no file and the manifest no source`);
  return m.source.file;
}

async function main() {
  const i = process.argv.indexOf('--manifest');
  const m = i >= 0 ? loadManifest(process.argv[i + 1]) : manifest;
  mkdirSync('.cache/test-audio', { recursive: true });
  if (m.source && !existsSync(m.source.file)) {
    console.log(`downloading ${m.source.url}`);
    const res = await fetch(m.source.url);
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${m.source.file}.part`));
    renameSync(`${m.source.file}.part`, m.source.file);
  }
  for (const e of m.excerpts) {
    const out = excerptPath(e.id);
    if (existsSync(out)) continue;
    const src = sourceFile(m, e);
    if (!existsSync(src)) {
      console.warn(`skip ${e.id}: ${src} not found`);
      continue;
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(e.start), '-t', String(e.seconds), '-i', src,
      '-ar', '44100', '-c:a', 'pcm_s16le', out]);
    console.log(`cut ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
