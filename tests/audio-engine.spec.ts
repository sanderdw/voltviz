import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

// Count AudioContexts created by the page (the engine must create exactly one per session).
const countContexts = () => {
  const w = window as unknown as { __ctxCount: number; AudioContext: typeof AudioContext };
  w.__ctxCount = 0;
  const Orig = w.AudioContext;
  w.AudioContext = class extends Orig {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      w.__ctxCount++;
    }
  };
};

const startMicrophone = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Microphone' }).click();
  await expect(page.getByTestId('visualizer-picker-open')).toBeVisible();
};

test.describe('VoltViz – audio engine settings', () => {
  test('Auto Gain is off by default and round-trips through the URL', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByTestId('viz-autogain-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]agc=1/);
    await page.goto('/?agc=1');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('viz-autogain-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AI beat tracking is on by default; turning it off is persisted as aibeat=0', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByTestId('viz-aibeat-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).not.toHaveURL(/aibeat/);
    await toggle.click();
    await expect(page).toHaveURL(/[?&]aibeat=0/);
  });

  test('Reset to Defaults also resets Auto Gain and AI beat tracking', async ({ page }) => {
    await page.goto('/?agc=1&aibeat=0&sensitivity=2');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Reset to Defaults' }).click();
    await expect(page.getByTestId('viz-autogain-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('viz-aibeat-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).not.toHaveURL(/agc=|aibeat=|sensitivity=/);
  });

  test('one AudioContext for the whole session, also across a crossfade', async ({ page }) => {
    await page.addInitScript(countContexts);
    await page.goto('/?viz=bars&aibeat=0');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-circular').click();
    await expect(page.getByTestId('viz-layer')).toHaveCount(2);
    await expect(page.getByTestId('viz-layer')).toHaveCount(1, { timeout: 5000 });
    // React StrictMode (dev) mounts effects twice: the first engine is discarded, never both alive
    const alive = await page.evaluate(() => (window as unknown as { __voltviz: { engine: { context: AudioContext } } }).__voltviz.engine.context.state);
    expect(alive).toBe('running');
    const count = await page.evaluate(() => (window as unknown as { __ctxCount: number }).__ctxCount);
    expect(count).toBeLessThanOrEqual(2);
  });
});
