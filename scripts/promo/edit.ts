// Cuts the recorded clips to the bar grid and assembles:
//   - the montage (.cache/promo/out/voltviz-promo-1080p.mp4): every shot with its label, title
//     card over the intro, a flash into each drop, end card over the outro, the track muxed in;
//   - the same montage in 4K (voltviz-promo-4k.mp4): the 1080p recordings upscaled (the Windows
//     screen has no room for a 3840x2160 tab), with sharp cards and labels rendered at 2x;
//   - the animated WebP showcase and the silent loop (MP4 + WebM), all in .cache/promo/out/;
//   - one full-resolution still per visualizer (.cache/promo/stills/) for the posters.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { endCard, labelPath, renderCards, titleCard } from './cards.ts';
import { PATHS } from './paths.ts';
import type { ClipMeta } from './record.ts';
import { LOOP_BARS, LOOP_IDS, SHOTS, STILL_AT_BAR, endOf, startOf, type Shot } from './shots.ts';
import { BAR, BEAT, TOTAL_BARS, trackInfo } from './track.ts';

const FPS = 60;
/** Seconds the end card holds after the last bar (the track's reverb tail). */
const HOLD = 1.2;
/** Seconds to shift the picture against the track; measured ≈0 (visuals react within a frame). */
const SYNC = 0;
/** Showcase budget: GitHub renders larger images, but slowly. */
const SHOWCASE_MAX_BYTES = 6 * 1024 * 1024;

interface Format {
  /** Suffix of the intermediates in .cache/promo/work/ */
  suffix: string;
  width: number;
  height: number;
  /** Render scale of the cards and labels */
  scale: number;
  file: string;
  /** x264 preset of the final encode (4K on `slow` takes too long for what it adds) */
  preset: string;
}
const FORMATS: Record<'montage' | 'montage4k', Format> = {
  montage: { suffix: '', width: 1920, height: 1080, scale: 1, file: PATHS.montage, preset: 'slow' },
  montage4k: { suffix: '-4k', width: 3840, height: 2160, scale: 2, file: PATHS.montage4k, preset: 'medium' },
};

function ff(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

function clipOf(shot: Shot): { meta: ClipMeta; path: string } {
  const json = join(PATHS.clips, `${shot.id}.json`);
  if (!existsSync(json)) throw new Error(`No clip for ${shot.id}: run \`npm run promo -- record ${shot.id}\``);
  const meta: ClipMeta = JSON.parse(readFileSync(json, 'utf8'));
  return { meta, path: join(PATHS.clips, meta.file) };
}

const segPath = (shot: Shot, f: Format) => join(PATHS.work, `seg-${shot.id}${f.suffix}.mp4`);
/** True if target is missing or older than any source. */
const stale = (target: string, ...sources: string[]) =>
  !existsSync(target) || sources.some(src => statSync(src).mtimeMs > statSync(target).mtimeMs);
const isLast = (shot: Shot) => shot === SHOTS.at(-1);
const fmt = (t: number) => t.toFixed(4);

/**
 * One shot cut to its bars at a constant 60 fps, with its label faded in and out. The intro
 * label waits for the title card; the last shot's label leaves before the end card.
 */
function cutSegment(shot: Shot, f: Format): void {
  const { meta, path } = clipOf(shot);
  const offset = startOf(shot) - meta.trackStart + SYNC;
  // Frame-exact on the global 60 fps grid, so 17 cuts do not drift against the track
  const frames = Math.round((endOf(shot) + (isLast(shot) ? HOLD : 0)) * FPS) - Math.round(startOf(shot) * FPS);
  const dur = frames / FPS;
  if (offset < 0) throw new Error(`Clip ${shot.id} starts ${(-offset).toFixed(2)} s after its shot: re-record it`);
  const available = meta.duration - offset;
  const labelIn = shot.bar === 0 ? 4.6 : 0.3;
  const labelOut = isLast(shot) ? 2 * BAR - 0.6 : dur - 0.55;
  const video = [
    `fps=${FPS}`,
    `trim=start=${fmt(offset)}:duration=${fmt(Math.min(dur, available))}`,
    'setpts=PTS-STARTPTS',
    // the last shot runs past its recording into the end card: hold its final frame
    ...(available < dur ? [`tpad=stop_mode=clone:stop_duration=${fmt(dur - available + 0.1)}`, `trim=duration=${fmt(dur)}`] : []),
    `scale=${f.width}:${f.height}:flags=lanczos`,
    'setsar=1',
  ].join(',');
  ff([
    '-i', path,
    '-loop', '1', '-framerate', String(FPS), '-t', fmt(dur), '-i', labelPath(shot.id, f.scale),
    '-filter_complex',
    `[0:v]${video}[v];` +
    `[1:v]format=rgba,fade=t=in:st=${fmt(labelIn)}:d=0.3:alpha=1,fade=t=out:st=${fmt(labelOut)}:d=0.3:alpha=1[l];` +
    '[v][l]overlay=format=auto:shortest=1,format=yuv420p[out]',
    '-map', '[out]', '-an', '-r', String(FPS), '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-g', String(FPS),
    segPath(shot, f),
  ]);
}

function montage(f: Format): void {
  const info = trackInfo();
  const list = join(PATHS.work, `segments${f.suffix}.txt`);
  writeFileSync(list, SHOTS.map(s => `file '${segPath(s, f)}'`).join('\n'));
  const body = join(PATHS.work, `body${f.suffix}.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', body]);

  const total = Math.round((TOTAL_BARS * BAR + HOLD) * FPS) / FPS;
  const drops = info.sections.filter(s => s.name === 'dropA' || s.name === 'dropB').map(s => s.start);
  const outro = info.sections.find(s => s.name === 'outro')!.start;
  // White flash into each drop, stepping down over ~0.25 s (timed fills: no extra inputs)
  const flash = drops.flatMap(t => [[0, 0.05, 0.75], [0.05, 0.12, 0.45], [0.12, 0.25, 0.18]].map(([a, b, alpha]) =>
    `drawbox=x=0:y=0:w=iw:h=ih:color=white@${alpha}:t=fill:enable='between(t,${fmt(t + a)},${fmt(t + b)})'`)).join(',');
  const graph =
    `[1:v]format=rgba,fade=t=in:st=0.15:d=0.5:alpha=1,fade=t=out:st=${fmt(2 * BAR + 0.2)}:d=0.7:alpha=1[title];` +
    `[2:v]format=rgba,fade=t=in:st=${fmt(outro)}:d=0.6:alpha=1[end];` +
    '[0:v][title]overlay=format=auto:shortest=1[v0];' +
    `[v0]${flash}[v1];` +
    '[v1][end]overlay=format=auto:shortest=1,format=yuv420p[vout]';

  // The cards run the full length (faded out, they are transparent): an overlay input that
  // ends early deadlocks ffmpeg 8 at the end of the encode
  const picture = join(PATHS.work, `picture${f.suffix}.mp4`);
  ff([
    '-i', body,
    '-loop', '1', '-framerate', String(FPS), '-t', fmt(total), '-i', titleCard(f.scale),
    '-loop', '1', '-framerate', String(FPS), '-t', fmt(total), '-i', endCard(f.scale),
    '-filter_complex', graph,
    '-map', '[vout]', '-an',
    '-c:v', 'libx264', '-preset', f.preset, '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-frames:v', String(Math.round(total * FPS)),
    picture,
  ]);
  mkdirSync(PATHS.out, { recursive: true });
  ff([
    '-i', picture, '-i', PATHS.trackWav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', `atrim=duration=${fmt(total)},afade=t=out:st=${fmt(total - 2)}:d=2`,
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
    f.file,
  ]);
  console.log(`wrote ${f.file} (${total.toFixed(1)} s)`);
}

/** The first LOOP_BARS of each loop shot, without labels; cut on the beat so it loops cleanly. */
function loops(): void {
  const parts = LOOP_IDS.map(id => SHOTS.find(s => s.id === id)!);
  const len = LOOP_BARS * BAR;
  const raw = join(PATHS.work, 'loop-raw.mp4');
  const graph = parts.map((s, i) => {
    const { meta } = clipOf(s);
    const offset = startOf(s) - meta.trackStart + SYNC;
    return `[${i}:v]fps=${FPS},trim=start=${fmt(offset)}:duration=${fmt(len)},setpts=PTS-STARTPTS,scale=1920:1080,setsar=1[p${i}]`;
  }).join(';') + `;${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[out]`;
  ff([...parts.flatMap(s => ['-i', clipOf(s).path]), '-filter_complex', graph, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', raw]);

  mkdirSync(PATHS.loopDir, { recursive: true });
  const mp4 = join(PATHS.loopDir, 'voltviz-loop.mp4');
  const webm = join(PATHS.loopDir, 'voltviz-loop.webm');
  ff(['-i', raw, '-vf', 'fps=30,scale=1280:720:flags=lanczos', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  ff(['-i', raw, '-vf', 'fps=30,scale=1280:720:flags=lanczos', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '46',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', webm]);

  // Showcase: animated WebP (GitHub renders it; a GIF of these particles and gradients is 3-4x
  // larger at a third of the resolution). Step the quality down until it fits the budget.
  for (const quality of [72, 62, 52]) {
    ff(['-i', raw, '-vf', 'fps=15,scale=960:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', String(quality),
      '-compression_level', '6', '-loop', '0', PATHS.showcase]);
    const size = statSync(PATHS.showcase).size;
    console.log(`wrote ${PATHS.showcase} (quality ${quality}, ${(size / 1024 / 1024).toFixed(1)} MB)`);
    if (size <= SHOWCASE_MAX_BYTES) break;
  }
  console.log(`wrote ${mp4}, ${webm}`);
}

/** A 1920x1080 still per visualizer, one bar into its shot (on a downbeat hit), without label. */
function stills(): void {
  mkdirSync(PATHS.stills, { recursive: true });
  for (const shot of SHOTS) {
    const { meta, path } = clipOf(shot);
    // the intro is under the title card for its first bars: take its still later
    const at = startOf(shot) + (shot.bar === 0 ? 2 : STILL_AT_BAR) * BAR + BEAT * 0.1 - meta.trackStart + SYNC;
    ff(['-ss', fmt(at), '-i', path, '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', join(PATHS.stills, `${shot.id}.png`)]);
  }
  console.log(`wrote ${SHOTS.length} stills to ${PATHS.stills}`);
}

/** `parts`: any of montage, montage4k, loops, stills (default all). */
export async function edit(parts: string[] = []): Promise<void> {
  const run = (part: string) => !parts.length || parts.includes(part);
  mkdirSync(PATHS.work, { recursive: true });
  for (const [part, f] of Object.entries(FORMATS)) {
    if (!run(part)) continue;
    await renderCards(f.scale);
    for (const shot of SHOTS) {
      const { path } = clipOf(shot);
      if (stale(segPath(shot, f), path, join(PATHS.clips, `${shot.id}.json`), labelPath(shot.id, f.scale))) cutSegment(shot, f);
    }
    montage(f);
  }
  if (run('loops')) loops();
  if (run('stills')) stills();
}
