import { test, expect } from '@playwright/test';
import { visualizers } from '../src/visualizers';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const startMicrophone = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Microphone' }).click();
  await expect(page.getByTestId('visualizer-picker-open')).toBeVisible();
};

test.describe('VoltViz – visualizer picker', () => {
  test('picker button appears after starting audio and shows the active visualizer', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Poly Sphere');
  });

  test('modal opens with a card per visualizer and marks the active one', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await expect(page.getByTestId('visualizer-picker')).toBeVisible();
    await expect(page.getByTestId('visualizer-picker').getByRole('button', { pressed: true }))
      .toHaveAttribute('data-testid', 'viz-card-polysphere');
    expect(await page.getByTestId('visualizer-picker').locator('[data-testid^="viz-card-"]').count())
      .toBe(visualizers.length);
  });

  test('selecting a card switches visualizer, closes the modal and updates the URL', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-bars').click();
    await expect(page.getByTestId('visualizer-picker')).not.toBeVisible();
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Bars');
    await expect(page).toHaveURL(/viz=bars/);
  });

  test('Escape closes the modal without changing the selection', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await expect(page.getByTestId('visualizer-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('visualizer-picker')).not.toBeVisible();
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Poly Sphere');
  });

  test('switching visualizers crossfades through a temporary second layer', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    const layers = page.getByTestId('viz-layer');
    await expect(layers).toHaveCount(1);
    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-bars').click();
    // Label updates immediately, old layer keeps rendering underneath
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Bars');
    await expect(layers).toHaveCount(2);
    // After warm-up + fade the old layer unmounts
    await expect(layers).toHaveCount(1, { timeout: 5000 });
  });

  test('instant transition swaps layers without overlap', async ({ page }) => {
    await page.goto('/?transition=instant');
    await startMicrophone(page);
    const layers = page.getByTestId('viz-layer');
    await expect(layers).toHaveCount(1);
    await page.getByTestId('visualizer-picker-open').click();
    await page.getByTestId('viz-card-bars').click();
    await expect(page.getByTestId('visualizer-picker-open')).toContainText('Bars');
    await expect(layers).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('viz-transition')).toHaveValue('instant');
  });

  test('transition setting round-trips through the URL', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const select = page.getByTestId('viz-transition');
    await expect(select).toHaveValue('crossfade');
    await select.selectOption('instant');
    await expect(page).toHaveURL(/transition=instant/);
    await select.selectOption('crossfade');
    await expect(page).not.toHaveURL(/transition=/);
  });

  test('opting visualizers into the shuffle pool updates badges and URL without closing the modal', async ({ page }) => {
    await page.goto('/');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    const activeBefore = await page.getByTestId('visualizer-picker-open').textContent();
    await page.getByTestId('viz-pool-bars').click();
    await page.getByTestId('viz-pool-flame').click();
    await expect(page.getByTestId('visualizer-picker')).toBeVisible();
    await expect(page.getByTestId('viz-pool-bars')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viz-pool-flame')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/shufflePool=bars%2Cflame|shufflePool=bars,flame/);
    // Toggling a badge must not change the active visualizer
    expect(await page.getByTestId('visualizer-picker-open').textContent()).toBe(activeBefore);
  });

  test('shuffle pool is read from the URL and removable', async ({ page }) => {
    await page.goto('/?viz=tunnel&shufflePool=bars,flame');
    await startMicrophone(page);
    await page.getByTestId('visualizer-picker-open').click();
    await expect(page.getByTestId('viz-pool-bars')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viz-pool-flame')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('[data-testid^="viz-pool-"][aria-pressed="true"]').count()).toBe(2);
    await page.getByTestId('viz-pool-bars').click();
    await expect(page.getByTestId('viz-pool-bars')).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/bars/);
    await expect(page).toHaveURL(/shufflePool=flame/);
  });

  test('shuffle settings are read from the URL and written back when toggled', async ({ page }) => {
    await page.goto('/?viz=flame&shuffle=1&shuffleTime=30');
    await startMicrophone(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByTestId('viz-shuffle-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viz-shuffle-interval')).toHaveValue('30');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/shuffle=/);
    await expect(page.getByTestId('viz-shuffle-interval')).toBeDisabled();
  });
});
