import { test, expect } from '@playwright/test';

test.describe('VoltViz – landing page (no stream)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle('VoltViz – Real-Time Music Visualizer');
  });

  test('shows app heading', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('VoltViz');
    await expect(heading).toContainText('Music Visualizer');
  });

  test('shows landing tagline', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Visualize Your Sound' })).toBeVisible();
  });

  test('Microphone button is visible and enabled', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Microphone' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('System Audio button is visible and enabled', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'System Audio' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('Sendspin button is visible and enabled', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Sendspin' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('Sendspin dialog opens on button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Sendspin' }).click();
    await expect(page.getByText('Connect to Sendspin')).toBeVisible();
    await expect(page.getByPlaceholder('http://192.168.1.100:8095')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('Sendspin dialog closes on Cancel', async ({ page }) => {
    await page.getByRole('button', { name: 'Sendspin' }).click();
    await expect(page.getByText('Connect to Sendspin')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Connect to Sendspin')).not.toBeVisible();
  });

  test('Sendspin Connect button is disabled when URL is empty', async ({ page }) => {
    await page.getByRole('button', { name: 'Sendspin' }).click();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  test('GitHub link is present', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Open GitHub profile' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/sanderdw/voltviz');
  });

  test('visualizer selector is not shown before audio starts', async ({ page }) => {
    await expect(page.locator('select')).not.toBeVisible();
  });

  test('Settings panel is hidden on load', async ({ page }) => {
    // The panel is off-screen (translate-x-full) until opened – not visible in viewport
    await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeInViewport();
  });
});
