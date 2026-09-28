/**
 * Cuts the evaluation excerpts of a manifest to 44.1 kHz stereo WAV files in .cache/test-audio/
 * (gitignored).
 *
 *   node scripts/eval/prepare-audio.ts [--manifest scripts/eval/genres.json]
 *
 * The default manifest (scripts/eval/excerpts.json) cuts the test mix, downloading it first if
 * missing. The other manifests cut local files from the user's music library: `file` is relative
 * to the manifest's `musicDir` (overridable with the environment variable named in
 * `musicDirEnv`), or to VOLTVIZ_MUSIC_DIR (default ~/Music); missing files are skipped.
 *
 * A song-change excerpt has `parts` instead of `file`/`start`: the end of one song followed by
 * the start of the next, joined by a hard cut, a gap of silence or a crossfade (`transition`).
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
  /** Genre manifests only: source file relative to the music directory. */
  file?: string;
  genre?: string;
  /** Genre manifests only: the Music style this excerpt belongs to. */
  style?: string;
  /** Genre manifests only: the pulse beat effects should follow (null: either metrical level). */
  expectedPulseBpm?: number | null;
  /**
   * Library manifest: the expected pulse as a rule, resolved against the reference tempo:
   * `half` = the half-time pulse (the reference tempo folded below 110 BPM), `full` = every beat
   * (folded to 90-230 BPM), `either` = any metrical level.
   */
  pulseRule?: 'half' | 'full' | 'either';
  /** Song-change excerpts: the two songs, joined by `transition`; the change happens at `changeAt` s. */
  parts?: { file: string; start: number; seconds: number; style?: string; expectedPulseBpm?: number | null }[];
  transition?: { kind: 'cut' | 'gap' | 'crossfade'; seconds: number };
  changeAt?: number;
}

export interface Manifest {
  source?: { name?: string; url: string; file: string };
  /** Base directory of `file` paths (default: VOLTVIZ_MUSIC_DIR or ~/Music). */
  musicDir?: string;
  /** Environment variable that overrides `musicDir`. */
  musicDirEnv?: string;
  excerpts: Excerpt[];
}

export const DEFAULT_MANIFEST = 'scripts/eval/excerpts.json';
export const loadManifest = (path: string | URL): Manifest => JSON.parse(readFileSync(path, 'utf8'));
export const manifest: Manifest = loadManifest(new URL('./excerpts.json', import.meta.url));
export const excerptPath = (id: string) => `.cache/test-audio/${id}.wav`;
export const musicDir = () => process.env.VOLTVIZ_MUSIC_DIR ?? join(homedir(), 'Music');
const baseDir = (m: Manifest) => (m.musicDir ? (m.musicDirEnv && process.env[m.musicDirEnv]) || m.musicDir : musicDir());

/** The full-length file an excerpt is cut from. */
export function sourceFile(m: Manifest, e: Excerpt): string {
  if (e.file) return join(baseDir(m), e.file);
  if (!m.source) throw new Error(`excerpt ${e.id} has no file and the manifest no source`);
  return m.source.file;
}

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);

/** Two song parts joined by a cut, a gap or a crossfade, as one 44.1 kHz stereo WAV. */
function composeChange(m: Manifest, e: Excerpt, out: string): void {
  const [a, b] = e.parts!;
  const t = e.transition ?? { kind: 'cut', seconds: 0 };
  const inputs = [a, b].flatMap(p => ['-ss', String(p.start), '-t', String(p.seconds), '-i', join(baseDir(m), p.file)]);
  const norm = '[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[b]';
  const join2 = t.kind === 'crossfade'
    ? `[a][b]acrossfade=d=${t.seconds}:c1=tri:c2=tri[o]`
    : t.kind === 'gap'
      ? `[b]adelay=${Math.round(t.seconds * 1000)}:all=1[bd];[a][bd]concat=n=2:v=0:a=1[o]`
      : '[a][b]concat=n=2:v=0:a=1[o]';
  ffmpeg([...inputs, '-filter_complex', `${norm};${join2}`, '-map', '[o]', '-ar', '44100', '-c:a', 'pcm_s16le', out]);
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
    const files = e.parts ? e.parts.map(p => join(baseDir(m), p.file)) : [sourceFile(m, e)];
    const missing = files.find(f => !existsSync(f));
    if (missing) {
      console.warn(`skip ${e.id}: ${missing} not found`);
      continue;
    }
    if (e.parts) composeChange(m, e, out);
    else ffmpeg(['-ss', String(e.start), '-t', String(e.seconds), '-i', files[0], '-ar', '44100', '-c:a', 'pcm_s16le', out]);
    console.log(`cut ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
