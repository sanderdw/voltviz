/**
 * Cuts the evaluation excerpts of a manifest to 44.1 kHz stereo WAV files in .cache/test-audio/
 * (gitignored).
 *
 *   node scripts/eval/prepare-audio.ts [--manifest scripts/eval/library2025.json]
 *
 * The manifests (default scripts/eval/genres.json) cut local files from the user's music
 * library: `file` is relative to the manifest's `musicDir` (overridable with the environment
 * variable named in `musicDirEnv`), or to VOLTVIZ_MUSIC_DIR (default ~/Music); missing files are
 * skipped.
 *
 * A song-change excerpt has `parts` instead of `file`/`start`: the end of one song followed by
 * the start of the next, joined by a hard cut, a gap of silence or a crossfade (`transition`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Excerpt {
  id: string;
  start: number;
  seconds: number;
  role: string;
  note: string;
  /** Source file relative to the music directory (absent for song-change excerpts, see `parts`). */
  file?: string;
  genre?: string;
  /** The Music style this excerpt belongs to. */
  style?: string;
  /** The pulse beat effects should follow (null: either metrical level). */
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
  /** Base directory of `file` paths (default: VOLTVIZ_MUSIC_DIR or ~/Music). */
  musicDir?: string;
  /** Environment variable that overrides `musicDir`. */
  musicDirEnv?: string;
  excerpts: Excerpt[];
}

/** The manifests name songs from the user's own library, so they are local only (gitignored). */
export const DEFAULT_MANIFEST = 'scripts/eval/genres.json';
export function loadManifest(path: string | URL): Manifest {
  if (!existsSync(path)) throw new Error(`${path} not found: the evaluation manifests are local only (gitignored); create one that lists songs from your music library`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
export const excerptPath = (id: string) => `.cache/test-audio/${id}.wav`;
export const musicDir = () => process.env.VOLTVIZ_MUSIC_DIR ?? join(homedir(), 'Music');
const baseDir = (m: Manifest) => (m.musicDir ? (m.musicDirEnv && process.env[m.musicDirEnv]) || m.musicDir : musicDir());

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
  const m = loadManifest(i >= 0 ? process.argv[i + 1] : DEFAULT_MANIFEST);
  mkdirSync('.cache/test-audio', { recursive: true });
  for (const e of m.excerpts) {
    const out = excerptPath(e.id);
    if (existsSync(out)) continue;
    const files = (e.parts ?? [e as { file: string }]).map(p => join(baseDir(m), p.file));
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
