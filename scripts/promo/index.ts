// Promo material pipeline: generated soundtrack → GPU tab recordings → ffmpeg edit → posters.
//
//   npm run promo -- track              # .cache/test-audio/promo-track.wav + bar grid
//   npm run promo -- cover              # images/dummycover.jpg, the app's default artwork
//   npm run promo -- record [ids...]    # one clip per shot (Windows Chrome over CDP, see record.ts)
//   npm run promo -- edit [parts...]    # montage MP4 (1080p + 4K), WebP showcase + silent loop, stills (parts: montage montage4k loops stills)
//   npm run promo -- stills             # poster + banner (then `npm run make:og-image`)
//   npm run promo -- all
import { validateShots } from './shots.ts';

const [stage = 'all', ...ids] = process.argv.slice(2);
const STAGES = ['track', 'cover', 'record', 'edit', 'stills'];
if (stage !== 'all' && !STAGES.includes(stage)) {
  console.error(`Unknown stage "${stage}"; use one of ${STAGES.join(', ')} or all`);
  process.exit(1);
}
validateShots();
const run = (s: string) => stage === 'all' || stage === s;

if (run('track')) (await import('./track.ts')).writeTrack();
if (run('cover')) await (await import('./cards.ts')).renderCover();
if (run('record')) await (await import('./record.ts')).record(stage === 'record' ? ids : []);
if (run('edit')) await (await import('./edit.ts')).edit(stage === 'edit' ? ids : []);
if (run('stills')) await (await import('./stills.ts')).stills();
