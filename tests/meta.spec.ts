import { test, expect } from '@playwright/test';

const OG_IMAGE = 'https://voltviz.com/og-image.png';

test.describe('VoltViz – link-preview metadata', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Open Graph image tags are set', async ({ page }) => {
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', OG_IMAGE);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /VoltViz/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://voltviz.com/');
  });

  test('Twitter card has an image', async ({ page }) => {
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', OG_IMAGE);
  });

  test('web app manifest resolves and is filled in', async ({ page, request }) => {
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(new URL(href!, page.url()).toString());
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.short_name).toBe('VoltViz');
    expect(manifest.theme_color).toBe('#0f0f1a');
    // Icon paths are relative so they also resolve under a sub-path (HA ingress).
    for (const icon of manifest.icons as { src: string }[]) {
      expect(icon.src.startsWith('/')).toBe(false);
      const iconRes = await request.get(new URL(icon.src, res.url()).toString());
      expect(iconRes.status(), icon.src).toBe(200);
      expect(iconRes.headers()['content-type'], icon.src).toContain('image/png');
    }
  });
});

test.describe('VoltViz – root files are served as themselves (not the SPA shell)', () => {
  const textFiles: [string, RegExp][] = [
    ['/robots.txt', /^User-agent: \*/m],
    ['/sitemap.xml', /<loc>https:\/\/voltviz\.com\/<\/loc>/],
    ['/humans.txt', /^\/\* TEAM \*\//m],
    ['/llms.txt', /^# VoltViz/m],
    ['/.well-known/security.txt', /^Contact: /m],
  ];

  for (const [path, pattern] of textFiles) {
    test(`${path} exists`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body.trimStart().toLowerCase().startsWith('<!doctype')).toBe(false);
      expect(body).toMatch(pattern);
    });
  }

  test('robots.txt points at the sitemap', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Sitemap: https://voltviz.com/sitemap.xml');
  });

  for (const path of ['/og-image.png', '/favicon.ico', '/apple-touch-icon.png', '/icon-512-maskable.png']) {
    test(`${path} is an image`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^image\//);
    });
  }
});
