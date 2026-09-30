/**
 * Auto Gain evidence: Bars on the same excerpt at normal level and attenuated by 18 dB (a quiet
 * microphone), with Auto Gain off and on. Measures the display-path level, the bass band, the
 * rendered luminance and the applied gain.
 *
 *   node scripts/eval/agc.ts [--base http://127.0.0.1:3101]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const i = process.argv.indexOf('--base');
const BASE = i >= 0 ? process.argv[i + 1] : 'http://127.0.0.1:3101';
const START = 20, WARMUP = 12, SECONDS = 15;
const EXCERPT = 'genre-hardcore-a';
const quiet = `.cache/test-audio/${EXCERPT}_minus18dB.wav`;
if (!existsSync(quiet)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `.cache/test-audio/${EXCERPT}.wav`, '-af', 'volume=-18dB', '-c:a', 'pcm_s16le', quiet]);

const conditions = [
  { label: 'Normal level, Auto Gain off', file: `${EXCERPT}.wav`, agc: false },
  { label: '−18 dB (quiet mic), Auto Gain off', file: `${EXCERPT}_minus18dB.wav`, agc: false },
  { label: '−18 dB (quiet mic), Auto Gain on', file: `${EXCERPT}_minus18dB.wav`, agc: true },
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];
for (const c of conditions) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${BASE}/?viz=bars&testAudio=/__testaudio/${c.file}&testAudioStart=${START}&probe=1${c.agc ? '&agc=1' : ''}`);
  await page.waitForFunction(() => (window as any).__voltviz?.probe?.samples?.length > 5, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Hide UI' }).click().catch(() => {});
  const end = START + WARMUP + SECONDS;
  await page.waitForFunction(e => ((window as any).__voltvizTestAudio?.currentTime ?? 0) >= e, end, { timeout: 90000, polling: 500 });
  const samples: { media: number; level: number; bass: number; lum: number; gain: number }[] = await page.evaluate(() => (window as any).__voltviz.probe.samples);
  await page.close();
  const s = samples.filter(x => x.media >= START + WARMUP && x.media < end);
  const avg = (k: 'level' | 'bass' | 'lum' | 'gain') => s.reduce((a, x) => a + x[k], 0) / s.length;
  const r = { label: c.label, meanLevel: avg('level'), meanBass: avg('bass'), meanLum: avg('lum'), gainDb: 20 * Math.log10(avg('gain')) };
  results.push(r);
  console.log(`${c.label.padEnd(36)} level ${r.meanLevel.toFixed(3)}  bass ${r.meanBass.toFixed(3)}  lum ${r.meanLum.toFixed(3)}  gain ${r.gainDb.toFixed(1)} dB`);
}
await browser.close();
writeFileSync('docs/reports/data/agc.json', JSON.stringify({ generated: new Date().toISOString(), results }));
