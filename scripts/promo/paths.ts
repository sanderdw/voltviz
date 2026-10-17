// Where the promo pipeline reads and writes. Intermediates live in the gitignored .cache/;
// only the README poster, banner and default artwork land in images/. The videos stay in
// .cache/promo/out/: they are not committed and not built into the app or its Docker image.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'promo');

export const PATHS = {
  /** Served by the dev server's testAudio() plugin at /__testaudio/promo-track.wav */
  trackWav: join(ROOT, '.cache', 'test-audio', 'promo-track.wav'),
  trackUrl: '/__testaudio/promo-track.wav',
  trackJson: join(CACHE, 'track.json'),
  clips: join(CACHE, 'clips'),
  overlays: join(CACHE, 'overlays'),
  stills: join(CACHE, 'stills'),
  work: join(CACHE, 'work'),
  out: join(CACHE, 'out'),
  montage: join(CACHE, 'out', 'voltviz-promo-1080p.mp4'),
  /** The same edit upscaled from the 1080p recordings, with the cards and labels rendered at 4K */
  montage4k: join(CACHE, 'out', 'voltviz-promo-4k.mp4'),
  showcase: join(CACHE, 'out', 'voltviz-showcase.webp'),
  loopDir: join(CACHE, 'out'),
  poster: join(ROOT, 'images', 'voltviz-poster.png'),
  banner: join(ROOT, 'images', 'banner.png'),
  dummyCover: join(ROOT, 'images', 'dummycover.jpg'),
};
