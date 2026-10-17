// HTML → PNG graphics for the promo: the made-up album cover (the app's default image), the title and
// end cards, and one lower-third label per shot (transparent, overlaid by ffmpeg). Rendered by a
// local headless Chromium; nothing here needs a GPU.
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENT, BG, FONT_STACK, PURPLE } from '../lib/brand.ts';
import { PATHS } from './paths.ts';
import { SHOTS, labelOf } from './shots.ts';

const W = 1920;
const H = 1080;

/** Cards and labels are laid out at 1920x1080 and rendered at `scale` (2 for the 4K montage). */
const overlayDir = (scale: number) => scale === 1 ? PATHS.overlays : join(PATHS.overlays, `${scale}x`);
export const titleCard = (scale = 1) => join(overlayDir(scale), 'title.png');
export const endCard = (scale = 1) => join(overlayDir(scale), 'end.png');
export const labelPath = (id: string, scale = 1) => join(overlayDir(scale), `label-${id}.png`);

const base = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { overflow: hidden; background: transparent; font-family: ${FONT_STACK}; color: #fff; }
`;
const wordmark = (size: number) => `
  <div style="font-weight:900;font-size:${size}px;line-height:.95;letter-spacing:-.02em">VOLT<span style="color:${ACCENT}">VIZ</span></div>`;

/**
 * An original, made-up record sleeve ("Afterglow" by "Voltviz Sessions"): no real artist or art.
 * The sleeve is designed as a 1000x1000 square, scaled to the image height and centred; at a
 * wider aspect the sky, haze and grid floor run on to the sides, so a centre-square crop (Vinyl)
 * and a full-screen background both show the whole sleeve.
 */
function coverHtml(width: number, height: number): string {
  const k = height / 1000;
  const ext = (width / k - 1000) / 2; // square-space units beyond each side of the sleeve
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  html, body { width: ${width}px; height: ${height}px; background: #07060f; }
  .sleeve { position: absolute; left: ${(width - 1000 * k) / 2}px; top: 0; width: 1000px; height: 1000px;
    transform: scale(${k}); transform-origin: 0 0; }
  .sky { position: absolute; top: 0; bottom: 0; left: ${-ext}px; right: ${-ext}px;
    background: radial-gradient(${1000 + 2 * ext}px 1000px at 50% 118%, #ff7a3d 0%, #e0306f 22%, #5b1a8f 48%, #160b33 72%, #07060f 100%); }
  .sun { position: absolute; left: 50%; top: 255px; width: 520px; height: 520px; margin-left: -260px; border-radius: 50%;
    background: linear-gradient(180deg, #ffe68a 0%, #ffab4a 38%, #ff4f7b 70%, #c02ad6 100%);
    -webkit-mask: repeating-linear-gradient(180deg, #000 0 34px, transparent 34px 46px);
    box-shadow: 0 0 120px 20px rgba(255, 110, 120, .35); }
  .glow { position: absolute; left: 50%; top: 200px; width: 760px; height: 760px; margin-left: -380px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,140,120,.35), transparent 62%); }
  .floor { position: absolute; left: ${-ext - 500}px; right: ${-ext - 500}px; bottom: -40px; height: 380px;
    background:
      repeating-linear-gradient(90deg, rgba(74,222,128,.75) 0 2px, transparent 2px 64px),
      repeating-linear-gradient(180deg, rgba(74,222,128,.75) 0 2px, transparent 2px 46px),
      linear-gradient(180deg, #12062a, #05040c);
    background-position: ${(ext + 500) % 64}px 0, 0 0, 0 0;
    transform: perspective(380px) rotateX(62deg); transform-origin: 50% 0; }
  .haze { position: absolute; left: ${-ext}px; right: ${-ext}px; top: 600px; height: 120px;
    background: linear-gradient(180deg, transparent, rgba(255,80,140,.45) 55%, transparent); }
  .grain { position: absolute; inset: 0; opacity: .22; mix-blend-mode: overlay; }
  .top { position: absolute; left: 64px; right: 64px; top: 56px; display: flex; justify-content: space-between;
    font-size: 26px; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: rgba(255,255,255,.85); }
  .title { position: absolute; left: 0; right: 0; top: 128px; text-align: center; font-size: 100px; font-weight: 900;
    letter-spacing: .12em; padding-left: .12em; color: #fff; text-shadow: 0 6px 40px rgba(255,80,160,.55); }
  .side { position: absolute; right: 64px; bottom: 52px; font-size: 22px; font-weight: 700; letter-spacing: .3em; color: rgba(255,255,255,.7); }
  </style></head><body><div class="sleeve">
    <div class="sky"></div><div class="glow"></div><div class="sun"></div><div class="haze"></div><div class="floor"></div>
    <div class="top"><span>Voltviz Sessions</span><span>Vol. 01</span></div>
    <div class="title">AFTERGLOW</div>
    <div class="side">124 BPM · SIDE A</div>
  </div>
  <svg class="grain" width="${width}" height="${height}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
  </body></html>`;
}

function titleHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  html, body { width: ${W}px; height: ${H}px; }
  body { display: grid; place-items: center;
    background: radial-gradient(ellipse 900px 520px at 50% 50%, rgba(5,5,12,.72), rgba(5,5,12,.25) 70%, transparent); }
  .box { text-align: center; }
  .sub { margin-top: 28px; font-size: 34px; font-weight: 600; letter-spacing: .5em; padding-left: .5em; text-transform: uppercase; color: #d6d9ea; }
  </style></head><body><div class="box">${wordmark(210)}<div class="sub">Music Visualizer</div></div></body></html>`;
}

function endHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  html, body { width: ${W}px; height: ${H}px; }
  body { display: grid; place-items: center;
    background:
      radial-gradient(ellipse 1100px 700px at 30% 40%, rgba(74,222,128,.14), transparent 70%),
      radial-gradient(ellipse 900px 900px at 85% 85%, rgba(168,85,247,.18), transparent 70%),
      rgba(15,15,26,.82); }
  .box { text-align: center; }
  .claim { margin-top: 36px; font-size: 46px; font-weight: 800; letter-spacing: .01em; }
  .claim b { color: ${ACCENT}; }
  .where { margin-top: 18px; font-size: 28px; font-weight: 600; letter-spacing: .28em; text-transform: uppercase; color: #b8bcd0; }
  .url { margin-top: 64px; display: inline-block; padding: 18px 44px; border-radius: 999px; font-size: 44px; font-weight: 800;
    border: 2px solid rgba(74,222,128,.6); background: rgba(74,222,128,.08); }
  .url span { color: ${ACCENT}; }
  </style></head><body><div class="box">${wordmark(170)}
    <div class="claim"><b>50+</b> real-time music visualizers</div>
    <div class="where">Browser · Home Assistant · Music Assistant</div>
    <div class="url"><span>voltviz</span>.com</div>
  </div></body></html>`;
}

function labelHtml(index: number, total: number, name: string, tag?: string): string {
  const n = (i: number) => String(i).padStart(2, '0');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  html, body { width: ${W}px; height: ${H}px; }
  body { background: radial-gradient(ellipse 900px 260px at 0% 100%, rgba(0,0,0,.6), transparent 70%); }
  .label { position: absolute; left: 88px; bottom: 84px; display: flex; align-items: center; gap: 22px;
    text-shadow: 0 2px 18px rgba(0,0,0,.65); }
  .bar { width: 6px; height: 74px; border-radius: 3px; background: ${ACCENT}; box-shadow: 0 0 18px rgba(74,222,128,.7); }
  .count { font-size: 20px; font-weight: 700; letter-spacing: .2em; color: rgba(255,255,255,.65); font-variant-numeric: tabular-nums; }
  .name { font-size: 54px; font-weight: 800; letter-spacing: -.01em; line-height: 1; margin-top: 6px; }
  .tag { margin-left: 4px; align-self: flex-end; margin-bottom: 4px; padding: 6px 14px; border-radius: 999px; font-size: 20px; font-weight: 800;
    letter-spacing: .14em; text-transform: uppercase; color: #0b0b14; background: ${PURPLE}; text-shadow: none; }
  </style></head><body><div class="label"><div class="bar"></div>
    <div><div class="count">${n(index)} / ${n(total)}</div><div class="name">${name}</div></div>
    ${tag ? `<div class="tag">${tag}</div>` : ''}
  </div></body></html>`;
}

async function shoot(page: Page, html: string, path: string, width: number, height: number, transparent: boolean) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const clip = { x: 0, y: 0, width, height };
  const img = path.endsWith('.jpg')
    ? await page.screenshot({ type: 'jpeg', quality: 90, clip })
    : await page.screenshot({ type: 'png', omitBackground: transparent, clip });
  // Rewrite only on change: the edit re-cuts a segment when its label is newer
  if (!existsSync(path) || !readFileSync(path).equals(img)) writeFileSync(path, img);
}

/**
 * images/dummycover.jpg (JPEG: the film grain makes a PNG 8x larger): the default image of the visualizers that show a picture (Vinyl, Background
 * Image, Blur Image, Glitch Background, Particles Stream) until a track's artwork or an upload.
 */
export async function renderCover(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await shoot(page, coverHtml(W, H), PATHS.dummyCover, W, H, false);
    console.log(`wrote ${PATHS.dummyCover}`);
  } finally {
    await browser.close();
  }
}

export async function renderCards(scale = 1): Promise<void> {
  mkdirSync(overlayDir(scale), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: scale });
    await shoot(page, titleHtml(), titleCard(scale), W, H, true);
    await shoot(page, endHtml(), endCard(scale), W, H, true);
    for (const [i, shot] of SHOTS.entries()) {
      const { name, tag } = labelOf(shot.id);
      await shoot(page, labelHtml(i + 1, SHOTS.length, name, tag), labelPath(shot.id, scale), W, H, true);
    }
  } finally {
    await browser.close();
  }
}
