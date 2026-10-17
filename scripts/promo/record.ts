// Records one clip per shot in a real (GPU) Chrome over CDP: the app plays the generated track
// via ?testAudio=, and the page records its own tab with getDisplayMedia + MediaRecorder, so DOM
// overlays are captured along with the canvas. Each clip starts PREROLL seconds before its shot
// (the engine settles) and stores the track time of its first frame for the edit.
//
// Needs a Chrome started with
//   chrome.exe --remote-debugging-port=9222 --user-data-dir=<dir> --force-device-scale-factor=1 \
//     --autoplay-policy=no-user-gesture-required --auto-accept-this-tab-capture
// (scale factor 1: on a scaled display the tab surface is not 1920x1080 and the capture is
// rescaled to odd sizes) and the dev server: DISABLE_HMR=true npx vite --port 3101 --strictPort.
// Leave the Chrome window uncovered while it records.
//
// Starting the capture opens Chrome's "Sharing this tab" infobar, which takes ~40 px off the page.
// Tab capture still delivers 1920x1080 frames, but fills the missing rows by repeating the last
// one (a smear along the bottom edge), so the window is re-fitted once the infobar is up and a take
// fails if the page area changes while it records.
import { execFileSync } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hideAppUi } from '../lib/hideAppUi.ts';
import { PATHS } from './paths.ts';
import { SHOTS, endOf, startOf, type Shot } from './shots.ts';

const CDP = process.env.PROMO_CDP ?? 'http://127.0.0.1:9222';
const BASE = process.env.PROMO_BASE_URL ?? 'http://127.0.0.1:3101';
const WIDTH = 1920;
const HEIGHT = 1080;
/** Seconds of audio before the shot, so beat tracking and smoothing have settled at the cut. */
const PREROLL = 5;
const TAIL = 0.6;
/**
 * Hardware H.264 keeps up with 1080p60 where software VP9 drops to ~30 fps; VP8 is the fallback
 * when a take does not decode cleanly.
 */
const RECORDER_MIMES = ['video/mp4;codecs=avc1.640033', 'video/webm;codecs=vp8'];

export interface ClipMeta {
  id: string;
  /** Track time (s) at the first recorded frame. */
  trackStart: number;
  duration: number;
  width: number;
  height: number;
  file: string;
  /** The visualizer's own frame rate at the end of the clip, if the app reports it. */
  renderFps?: number;
  /** Frame rate of the recording itself. */
  captureFps: number;
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function recordShot(browser: Browser, shot: Shot, mime: string, minFps: number): Promise<ClipMeta> {
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const audioStart = Math.max(0, startOf(shot) - PREROLL);
  const stopAt = endOf(shot) + TAIL;
  // The real window, not an emulated viewport: Chrome scales an emulated viewport that does not
  // fit the window, and tab capture records the window's surface
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  try {
    await page.addInitScript(seed => {
      // A connected Chrome would play the track out loud; captureStream() still carries the
      // audio of a muted element, so the visualizers react as usual.
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { this.muted = true; return play.call(this); };
      // Seeded Math.random, so a re-recording picks the same scenes, palettes and shots.
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, [...shot.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
    const url = `${BASE}/?viz=${shot.id}${shot.params ?? ''}&transition=instant` +
      `&testAudio=${PATHS.trackUrl}&testAudioStart=${audioStart.toFixed(3)}`;
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: WIDTH + 40, height: HEIGHT + 120 } });
    // Size the window so its page area is exactly WIDTH x HEIGHT
    const fitWindow = async () => {
      const frame = await page.evaluate(() => ({ w: outerWidth - innerWidth, h: outerHeight - innerHeight }));
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: WIDTH + frame.w, height: HEIGHT + frame.h } });
      await page.waitForFunction(({ w, h }) => innerWidth === w && innerHeight === h, { w: WIDTH, h: HEIGHT }, { timeout: 2000 })
        .catch(() => {});
      const inner = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      if (inner[0] !== WIDTH || inner[1] !== HEIGHT || inner[2] !== 1) {
        throw new Error(`page area is ${inner[0]}x${inner[1]} @${inner[2]}x, want ${WIDTH}x${HEIGHT} @1x: ` +
          'start Chrome with --force-device-scale-factor=1 on a screen with room for the window');
      }
    };
    await fitWindow();
    await page.goto(url);
    await page.bringToFront();
    await page.waitForFunction(() => ((window as any).__voltvizTestAudio?.currentTime ?? 0) > 0, null, { timeout: 30000 });
    await hideAppUi(page);
    await page.mouse.move(WIDTH - 1, HEIGHT - 1);

    // A shot at the very start of the track has no room for a preroll: hold the track at 0:00,
    // start recording, then play, so the clip covers the first beat too.
    const hold = startOf(shot) - PREROLL < 0;
    if (hold) {
      await page.evaluate(() => { const el = (window as any).__voltvizTestAudio; el.pause(); el.currentTime = 0; });
      await page.waitForTimeout(1500);
    }

    // Share the tab, then win back the rows the sharing infobar took before anything is recorded
    await page.evaluate(async ({ w, h }) => {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60, max: 60 }, cursor: 'never' } as MediaTrackConstraints,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);
      (window as any).__promo = { stream };
      // the infobar shows up a moment after the stream starts
      await new Promise(r => setTimeout(r, 500));
    }, { w: WIDTH, h: HEIGHT });
    await fitWindow();
    await page.waitForTimeout(500);
    await page.mouse.move(WIDTH - 1, HEIGHT - 1);

    // Start recording; the track time at the recorder's start is the sync point.
    await page.evaluate(async ({ MIME, hold }) => {
      const g = window as any;
      const stream: MediaStream = g.__promo.stream;
      const rec = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 40_000_000 });
      const chunks: Blob[] = [];
      const sizes = new Set([`${innerWidth}x${innerHeight}`]);
      addEventListener('resize', () => sizes.add(`${innerWidth}x${innerHeight}`));
      g.__promo = { rec, stream, chunks, sizes, trackStart: -1, settings: stream.getVideoTracks()[0].getSettings() };
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const el: HTMLAudioElement = g.__voltvizTestAudio;
      const recStart = await new Promise<number>(resolve => {
        rec.onstart = () => { g.__promo.trackStart = el.currentTime; resolve(performance.now()); };
        rec.start(1000);
      });
      if (hold) {
        // The track starts after the recording: its first frame is before track time 0
        await new Promise(r => setTimeout(r, 1000));
        await new Promise<void>(resolve => {
          el.addEventListener('playing', () => {
            g.__promo.trackStart = el.currentTime - (performance.now() - recStart) / 1000;
            resolve();
          }, { once: true });
          el.play();
        });
      }
    }, { MIME: mime, hold });

    await page.waitForFunction(t => (window as any).__voltvizTestAudio.currentTime >= t, stopAt,
      { timeout: (stopAt - audioStart + 30) * 1000, polling: 100 });

    const meta = await page.evaluate(async () => {
      const p = (window as any).__promo;
      await new Promise<void>(resolve => { p.rec.onstop = () => resolve(); p.rec.stop(); });
      p.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      p.blob = new Blob(p.chunks, { type: p.rec.mimeType });
      const stat = (window as any).__voltviz?.host?.stats?.()?.[0];
      return { trackStart: p.trackStart as number, size: p.blob.size as number, settings: p.settings, fps: stat?.fps as number | undefined,
        sizes: [...p.sizes] as string[] };
    });
    if (meta.sizes.length !== 1 || meta.sizes[0] !== `${WIDTH}x${HEIGHT}`) {
      throw new Error(`page area changed while recording (${meta.sizes.join(', ')}): the bottom edge would smear`);
    }
    // Pull the blob over in base64 slices (one CDP message per slice)
    const parts: Buffer[] = [];
    const SLICE = 8 * 1024 * 1024;
    for (let off = 0; off < meta.size; off += SLICE) {
      const b64 = await page.evaluate(async ({ off, len }) => {
        const buf = new Uint8Array(await (window as any).__promo.blob.slice(off, off + len).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      }, { off, len: SLICE });
      parts.push(Buffer.from(b64, 'base64'));
    }
    const file = join(PATHS.clips, `${shot.id}.${ext}`);
    writeFileSync(file, Buffer.concat(parts));
    const fps = checkClip(file, minFps);
    const clip: ClipMeta = {
      id: shot.id,
      trackStart: meta.trackStart,
      duration: stopAt - meta.trackStart,
      width: meta.settings.width,
      height: meta.settings.height,
      file: `${shot.id}.${ext}`,
      renderFps: meta.fps,
      captureFps: fps,
    };
    writeFileSync(join(PATHS.clips, `${shot.id}.json`), JSON.stringify(clip, null, 2));
    return clip;
  } finally {
    // never leave a page running: an abandoned page keeps playing and rendering
    await context.close().catch(() => {});
  }
}

/** Throws unless the clip decodes cleanly at WIDTH x HEIGHT and at least minFps; returns its fps. */
function checkClip(file: string, minFps: number): number {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  if (w !== WIDTH || h !== HEIGHT) throw new Error(`clip is ${w}x${h}`);
  const decode = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (decode.trim()) throw new Error(`clip does not decode cleanly: ${decode.split('\n')[0]}`);
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }).trim().split('\n').map(Number).sort((a, b) => a - b);
  // Skip the first second: capture startup can stall once
  const steady = pts.filter(t => t > pts[0] + 1);
  const fps = (steady.length - 1) / (steady.at(-1)! - steady[0]);
  if (fps < minFps) throw new Error(`clip runs at ${fps.toFixed(0)} fps`);
  return fps;
}

export async function record(only: string[] = []): Promise<void> {
  if (!existsSync(PATHS.trackWav)) throw new Error('No promo track yet: run `npm run promo -- track` first');
  if (!await reachable(`${CDP}/json/version`)) {
    throw new Error(`No Chrome at ${CDP}. Start one with --remote-debugging-port=9222 --auto-accept-this-tab-capture ` +
      '--autoplay-policy=no-user-gesture-required (see scripts/promo/record.ts)');
  }
  if (!await reachable(BASE)) throw new Error(`No dev server at ${BASE}: DISABLE_HMR=true npx vite --port 3101 --strictPort`);
  mkdirSync(PATHS.clips, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  try {
    for (const shot of SHOTS) {
      if (only.length && !only.includes(shot.id)) continue;
      const t = Date.now();
      let clip: ClipMeta | null = null;
      for (let attempt = 0; attempt < 3 && !clip; attempt++) {
        try {
          // Heavy DOM visualizers (Dutch Grid) do not composite at 60 fps; take them as they are on the last try
          clip = await recordShot(browser, shot, RECORDER_MIMES[Math.min(attempt, RECORDER_MIMES.length - 1)], attempt < 2 ? 55 : 30);
        } catch (err) {
          console.error(`  ${shot.id} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
        }
      }
      if (!clip) throw new Error(`Could not record ${shot.id}`);
      console.log(`recorded ${shot.id.padEnd(16)} ${clip.width}x${clip.height} from track ${clip.trackStart.toFixed(3)} s ` +
        `render ${clip.renderFps?.toFixed(0) ?? '?'} fps, capture ${clip.captureFps.toFixed(0)} fps (${((Date.now() - t) / 1000).toFixed(0)} s)`);
    }
  } finally {
    // connectOverCDP: close() only disconnects, the user's Chrome keeps running
    await browser.close();
  }
}
