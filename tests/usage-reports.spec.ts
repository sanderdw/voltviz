import { test, expect } from '@playwright/test';

// VoltViz itself sends no statistics: the image is also the Home Assistant app and every
// self-hosted install. Only a deployment's own script (voltviz.com) may define the
// window.voltvizStats hook; see src/app/analytics.ts.

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const startMicrophone = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Microphone' }).click();
  await expect(page.getByTestId('visualizer-picker-open')).toBeVisible();
};

test.describe('VoltViz – usage reports', () => {
  test('the page talks to no other host than its own', async ({ page, baseURL }) => {
    const own = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== own) {
        foreign.push(req.url());
      }
    });
    await page.goto('/');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-bars').click();
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Bars');
    expect(foreign).toEqual([]);
    expect(await page.evaluate(() => '_paq' in window)).toBe(false);
  });

  test('the hook hears an audio start and a picked visualizer, not the page load', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __reports: unknown[]; voltvizStats: (u: unknown) => void };
      w.__reports = [];
      w.voltvizStats = u => w.__reports.push(u);
    });
    const reports = () => page.evaluate(() => (window as unknown as { __reports: unknown[] }).__reports);

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeVisible();
    expect(await reports()).toEqual([]);

    await startMicrophone(page);
    await expect.poll(reports).toEqual([
      { visualizer: 'halftonepulse', source: 'microphone', trigger: 'start', shuffle: false },
    ]);

    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-bars').click();
    await expect.poll(reports).toEqual([
      { visualizer: 'halftonepulse', source: 'microphone', trigger: 'start', shuffle: false },
      { visualizer: 'bars', source: 'microphone', trigger: 'select', shuffle: false },
    ]);
  });

  test('a throwing hook does not break the app', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { voltvizStats: () => void }).voltvizStats = () => { throw new Error('boom'); };
    });
    await page.goto('/');
    await startMicrophone(page);
    await expect(page.getByTestId('viz-layer')).toHaveCount(1);
  });
});
