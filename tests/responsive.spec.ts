import { test, expect, type Page } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const headerFits = async (page: Page) => {
  const { scrollWidth, clientWidth } = await page.locator('header').evaluate(h => ({ scrollWidth: h.scrollWidth, clientWidth: h.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
};

const startMicrophone = async (page: Page) => {
  await page.getByRole('button', { name: 'Microphone' }).click();
  await expect(page.getByTestId('visualizer-picker-open')).toBeVisible();
};

for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 740 }, { width: 768, height: 1024 }]) {
  test.describe(`VoltViz – responsive ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });

    test('header controls fit before audio starts', async ({ page }) => {
      await page.goto('/');
      await headerFits(page);
      await expect(page.getByRole('link', { name: 'Open GitHub profile' })).toBeInViewport({ ratio: 1 });
      for (const name of ['Microphone', 'System Audio', 'Sendspin']) {
        await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
      }
    });

    test('header controls fit while running', async ({ page }) => {
      await page.goto('/');
      await startMicrophone(page);
      await headerFits(page);
      await expect(page.getByRole('link', { name: 'Open GitHub profile' })).toBeInViewport({ ratio: 1 });
      for (const name of ['Hide UI', 'Settings', 'Stop']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByTestId('visualizer-picker-open')).toBeInViewport({ ratio: 1 });
    });

    test('settings panel fits, scrolls to the bottom and closes on Escape', async ({ page }) => {
      await page.goto('/');
      await startMicrophone(page);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const reset = page.getByRole('button', { name: 'Reset to Defaults' });
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      await expect(reset).not.toBeInViewport();
    });

    test('visualizer picker fits the viewport', async ({ page }) => {
      await page.goto('/');
      await startMicrophone(page);
      await page.getByTestId('visualizer-picker-open').click();
      const dialog = page.getByTestId('visualizer-picker');
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 });
      await dialog.getByTestId('viz-card-bars').click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByTestId('visualizer-picker-open')).toContainText('Bars');
    });
  });
}

test.describe('VoltViz – responsive phone layout', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true });

  test('visualizer picker button gets its own row below the actions', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    const picker = await page.getByTestId('visualizer-picker-open').boundingBox();
    const settings = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
    expect(picker!.y).toBeGreaterThanOrEqual(settings!.y + settings!.height);
  });
});
