// Generates the social-preview image and the maskable PWA icon.
//
//   npm run make:og-image
//
// Writes:
//   public/og-image.png          1200x630 Open Graph / Twitter card image
//   public/icon-512-maskable.png 512x512 icon with the maskable safe zone
//
// Needs a Playwright Chromium (`npx playwright install chromium`); no dev
// server or audio hardware. Outputs are committed: the Docker build has no
// browser, and the image must be a stable absolute URL for link previews.
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const PREVIEW_DIR = join(ROOT, 'src', 'images', 'previews');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const BG = '#0f0f1a';
const ACCENT = '#4ade80';

// Preview thumbnails shown in the 2x3 grid, left-to-right, top-to-bottom.
const THUMBNAILS = ['polysphere', 'hexglobe', 'holoblinds', 'psychedelicskull', 'trailsstream', 'festivalstage'];

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

function dataUri(path: string, mime: string): string {
  if (!existsSync(path)) throw new Error(`Missing image: ${path}`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function ogHtml(): string {
  const tiles = THUMBNAILS.map(id => {
    const src = dataUri(join(PREVIEW_DIR, `${id}.jpg`), 'image/jpeg');
    return `<div class="tile"><img src="${src}" alt="" /></div>`;
  }).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; overflow: hidden; }
  body {
    font-family: ${FONT_STACK};
    color: #fff;
    background:
      radial-gradient(ellipse 620px 420px at 22% 38%, rgba(74, 222, 128, 0.16), transparent 70%),
      radial-gradient(ellipse 520px 520px at 88% 80%, rgba(168, 85, 247, 0.16), transparent 70%),
      ${BG};
    display: grid;
    grid-template-columns: 480px 1fr;
    padding: 56px 52px 52px 56px;
    column-gap: 40px;
  }
  .left { display: flex; flex-direction: column; justify-content: space-between; }
  .wordmark { font-weight: 900; font-size: 70px; line-height: 0.98; letter-spacing: -0.02em; }
  .wordmark .accent { color: ${ACCENT}; }
  .tagline { margin-top: 26px; font-size: 22px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #b8bcd0; }
  .site { font-size: 30px; font-weight: 800; letter-spacing: 0.01em; }
  .site .accent { color: ${ACCENT}; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; align-self: center; }
  .tile { aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; border: 1px solid rgba(255, 255, 255, 0.10); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style></head>
<body>
  <div class="left">
    <div>
      <div class="wordmark">VOLTVIZ<br /><span class="accent">MUSIC<br />VISUALIZER</span></div>
      <div class="tagline">50+ real-time visualizations<br />Browser · Home Assistant</div>
    </div>
    <div class="site"><span class="accent">voltviz</span>.com</div>
  </div>
  <div class="grid">${tiles}</div>
</body></html>`;
}

function maskableHtml(): string {
  const src = dataUri(join(PUBLIC_DIR, 'android-chrome-512x512.png'), 'image/png');
  // ~78% keeps the artwork inside the maskable safe zone (inner 80% circle).
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; }
  html, body { width: 512px; height: 512px; overflow: hidden; background: ${BG}; }
  body { display: grid; place-items: center; }
  img { width: 400px; height: 400px; display: block; }
</style></head><body><img src="${src}" alt="" /></body></html>`;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(ogHtml(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const ogPath = join(PUBLIC_DIR, 'og-image.png');
    await page.screenshot({ path: ogPath, type: 'png', clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT } });
    console.log(`wrote ${ogPath}`);

    await page.setViewportSize({ width: 512, height: 512 });
    await page.setContent(maskableHtml(), { waitUntil: 'load' });
    const iconPath = join(PUBLIC_DIR, 'icon-512-maskable.png');
    await page.screenshot({ path: iconPath, type: 'png', clip: { x: 0, y: 0, width: 512, height: 512 } });
    console.log(`wrote ${iconPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
