// Posters from the promo stills (.cache/promo/stills/, written by the edit stage):
//   images/voltviz-poster.png  1920x1080: wordmark + a mosaic of all 17 promo visualizers
//   images/banner.png          1087x172: the existing wordmark banner over a strip of stills
// The OG image is `npm run make:og-image`, which prefers these stills too.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENT, BG, FONT_STACK, PURPLE, dataUri } from '../lib/brand.ts';
import { PATHS } from './paths.ts';
import { SHOTS, labelOf } from './shots.ts';

/** The big tile of the poster. */
const HERO = 'lasershow';
/** Stills behind the banner text, left to right. */
const BANNER_IDS = ['pulsar', 'kaleidoscope', 'lasershow', 'milkdrop', 'oscilloscope', 'polysphere', 'sungalizer', 'glitchdatabend'];

const still = (id: string) => {
  const p = join(PATHS.stills, `${id}.png`);
  if (!existsSync(p)) throw new Error(`No still for ${id}: run \`npm run promo -- edit\` first`);
  return dataUri(p, 'image/png');
};

function posterHtml(): string {
  // 5 x 4 grid: the hero spans 2 x 2, the other 16 fill the remaining cells
  const others = SHOTS.map(s => s.id).filter(id => id !== HERO);
  const tile = (id: string, hero = false) => {
    const { name, tag } = labelOf(id);
    return `<div class="tile${hero ? ' hero' : ''}"><img src="${still(id)}" alt="">
      <div class="cap">${name}${tag ? ` <span>${tag}</span>` : ''}</div></div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body { font-family: ${FONT_STACK}; color: #fff; padding: 44px 48px 48px;
    background:
      radial-gradient(ellipse 900px 500px at 12% 0%, rgba(74,222,128,.16), transparent 70%),
      radial-gradient(ellipse 900px 700px at 100% 100%, rgba(168,85,247,.18), transparent 70%),
      ${BG}; }
  header { display: flex; align-items: flex-end; justify-content: space-between; height: 128px; margin-bottom: 22px; }
  .wordmark { font-weight: 900; font-size: 92px; line-height: .9; letter-spacing: -.02em; }
  .wordmark span { color: ${ACCENT}; }
  .sub { margin-top: 12px; font-size: 22px; font-weight: 600; letter-spacing: .32em; text-transform: uppercase; color: #b8bcd0; }
  .right { text-align: right; }
  .claim { font-size: 34px; font-weight: 800; }
  .claim b { color: ${ACCENT}; }
  .url { margin-top: 8px; font-size: 26px; font-weight: 700; color: #d6d9ea; }
  .url span { color: ${ACCENT}; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(4, 1fr); gap: 14px; height: 838px; }
  .tile { position: relative; border-radius: 12px; overflow: hidden; background: #000;
    border: 1px solid rgba(255,255,255,.10); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  .tile.hero { grid-column: span 2; grid-row: span 2; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 26px 14px 10px; font-size: 18px; font-weight: 700;
    background: linear-gradient(transparent, rgba(0,0,0,.75)); text-shadow: 0 1px 6px rgba(0,0,0,.6); }
  .hero .cap { font-size: 28px; padding: 40px 22px 16px; }
  .cap span { margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: .62em; letter-spacing: .1em; vertical-align: 2px;
    text-transform: uppercase; color: #0b0b14; background: ${PURPLE}; text-shadow: none; }
  </style></head><body>
  <header>
    <div><div class="wordmark">VOLT<span>VIZ</span></div><div class="sub">Real-time music visualizer</div></div>
    <div class="right"><div class="claim"><b>50+</b> visualizers · WebGPU · WebGL · Canvas</div>
      <div class="url">Browser · Home Assistant · Music Assistant — <span>voltviz</span>.com</div></div>
  </header>
  <div class="grid">${tile(HERO, true)}${others.map(id => tile(id)).join('')}</div>
  </body></html>`;
}

/** Same text and size as the original banner, now over a darkened strip of visualizers. */
function bannerHtml(): string {
  const strip = BANNER_IDS.map(id => `<img src="${still(id)}" alt="">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1087px; height: 172px; overflow: hidden; background: #000; }
  body { position: relative; font-family: ${FONT_STACK}; color: #fff; }
  .strip { position: absolute; inset: 0; display: flex; }
  .strip img { flex: 1; min-width: 0; height: 100%; object-fit: cover; }
  .shade { position: absolute; inset: 0;
    background: linear-gradient(90deg, rgba(0,0,0,.93) 0%, rgba(0,0,0,.82) 55%, rgba(0,0,0,.55) 100%); }
  .text { position: absolute; left: 30px; top: 30px; }
  .title { font-size: 56px; line-height: 1; letter-spacing: .02em; white-space: nowrap; }
  .title .thin { font-weight: 300; }
  .title .bold { font-weight: 800; color: ${ACCENT}; letter-spacing: .05em; }
  .tag { margin-top: 22px; font-size: 27px; font-weight: 400; letter-spacing: .14em; color: #a9acb8; white-space: nowrap; }
  </style></head><body>
  <div class="strip">${strip}</div><div class="shade"></div>
  <div class="text"><div class="title"><span class="thin">VOLTVIZ</span><span class="bold">MUSIC VISUALIZER</span></div>
    <div class="tag">inspired by winamp &amp; sonique - created by sanderdw</div></div>
  </body></html>`;
}

export async function stills(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.setContent(posterHtml(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: PATHS.poster, type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    console.log(`wrote ${PATHS.poster}`);

    await page.setViewportSize({ width: 1087, height: 172 });
    await page.setContent(bannerHtml(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: PATHS.banner, type: 'png', clip: { x: 0, y: 0, width: 1087, height: 172 } });
    console.log(`wrote ${PATHS.banner}`);
  } finally {
    await browser.close();
  }
}
