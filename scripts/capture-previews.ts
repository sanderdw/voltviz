// Generates the preview thumbnails shown in the visualizer picker.
//
//   npm run capture:previews            # all visualizers
//   npm run capture:previews -- bars    # only the given ids
//
// Requires no running server (spawns `vite` if port 3000 is free) and no real
// audio hardware: Chromium's fake-media flags feed a generated WAV into
// getUserMedia so every visualizer has a lively signal to react to.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { visualizers } from '../src/visualizers.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'images', 'previews');
const BASE_URL = process.env.PREVIEW_BASE_URL ?? 'http://localhost:3000';
const WARMUP_MS = 3500;

// Extra query params for visualizers that need tweaking to screenshot well.
// cybermatrix: its bloom pass saturates to white under headless software GL;
// minimal sensitivity keeps the capture recognizable.
const CAPTURE_PARAMS: Record<string, string> = {
  cybermatrix: '&sensitivity=0.01',
};

function writeFakeAudioWav(path: string): void {
  const sampleRate = 44100;
  const seconds = 30;
  const total = sampleRate * seconds;
  const samples = new Int16Array(total);
  const bpm = 120;
  const beatLen = (60 / bpm) * sampleRate;
  // Mid-range arpeggio notes (A minor-ish) cycled per half beat
  const notes = [220, 261.63, 329.63, 440, 329.63, 261.63];
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const beatPos = (i % beatLen) / beatLen;
    // Decaying 55 Hz kick on every beat
    const kick = Math.sin(2 * Math.PI * 55 * beatPos * (60 / bpm)) * Math.exp(-beatPos * 10);
    // Arpeggio with a soft attack/decay envelope per half beat
    const noteIdx = Math.floor(i / (beatLen / 2)) % notes.length;
    const notePos = (i % (beatLen / 2)) / (beatLen / 2);
    const arp = Math.sin(2 * Math.PI * notes[noteIdx] * t) * Math.exp(-notePos * 4) * 0.4;
    // Hi-hat noise burst on off-beats
    const hatPos = ((i + beatLen / 2) % beatLen) / beatLen;
    const hat = (Math.random() * 2 - 1) * Math.exp(-hatPos * 30) * 0.25;
    const v = kick * 0.8 + arp + hat;
    samples[i] = Math.max(-1, Math.min(1, v)) * 0x5fff;
  }
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buf, 44);
  writeFileSync(path, buf);
}

async function serverIsUp(): Promise<boolean> {
  try {
    await fetch(BASE_URL);
    return true;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<() => void> {
  if (await serverIsUp()) return () => {};
  const child: ChildProcess = spawn('npx', ['vite', '--port', '3000'], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await serverIsUp()) return () => child.kill();
  }
  child.kill();
  throw new Error(`Dev server did not become reachable at ${BASE_URL}`);
}

const only = process.argv.slice(2);
const unknown = only.filter(id => !visualizers.some(v => v.id === id));
if (unknown.length) {
  console.error(`Unknown visualizer id(s): ${unknown.join(', ')}`);
  process.exit(1);
}

const wavPath = join(tmpdir(), 'voltviz-fake-audio.wav');
writeFakeAudioWav(wavPath);
mkdirSync(OUT_DIR, { recursive: true });

const stopServer = await ensureServer();
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });

  const captureOnce = async (id: string): Promise<boolean> => {
    await page.goto(`${BASE_URL}/?viz=${id}${CAPTURE_PARAMS[id] ?? ''}`);
    await page.getByRole('button', { name: 'Microphone' }).click();
    await page.getByRole('button', { name: 'Hide UI' }).click();
    // Keep the floating "Show UI" toggle and version label out of the shot
    await page.addStyleTag({ content: 'button[title="Show UI"]{display:none !important}' });
    await page.evaluate(() => {
      document.querySelectorAll('div').forEach(el => {
        if (/^v\d+\./.test(el.textContent?.trim() ?? '') && el.childElementCount === 0) {
          (el as HTMLElement).style.display = 'none';
        }
      });
    });
    await page.waitForTimeout(WARMUP_MS);
    // Guard against audio-capture flakes that bounce the app back to the landing page
    const heroVisible = await page.getByRole('heading', { name: 'Visualize Your Sound' })
      .isVisible().catch(() => false);
    if (heroVisible) return false;
    await page.screenshot({ path: join(OUT_DIR, `${id}.jpg`), type: 'jpeg', quality: 70 });
    return true;
  };

  const failed: string[] = [];
  for (const { id } of visualizers) {
    if (only.length && !only.includes(id)) continue;
    if (await captureOnce(id) || await captureOnce(id)) {
      console.log(`captured ${id}`);
    } else {
      failed.push(id);
      console.error(`FAILED ${id}: app fell back to the landing page twice`);
    }
  }
  if (failed.length) {
    process.exitCode = 1;
    console.error(`\n${failed.length} capture(s) failed: ${failed.join(', ')}`);
  }
} finally {
  await browser.close();
  stopServer();
}
