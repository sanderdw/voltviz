import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('visualizer overlay controls start collapsed to their eye toggle', async ({ page }) => {
  await page.goto('/?viz=halftonepulse');
  await page.getByRole('button', { name: 'Microphone' }).click();
  const toggle = page.getByRole('button', { name: 'Show UI' });
  await expect(toggle).toBeVisible();
  await expect(page.getByText('Upload Image')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Style' })).toBeHidden();

  await toggle.click();
  await expect(page.getByText('Upload Image')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Style' })).toBeVisible();
});

test('Hide UI also hides the visualizer overlay controls, and Show UI brings them back', async ({ page }) => {
  await page.goto('/?viz=vinylsendspin');
  await page.getByRole('button', { name: 'Microphone' }).click();
  const upload = page.getByText('Upload Cover');
  await page.getByRole('button', { name: 'Show UI' }).click();
  await expect(upload).toBeVisible();

  await page.locator('header').getByRole('button', { name: 'Hide UI' }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hide UI' })).toHaveCount(0);

  // only the app's own Show UI is left; it brings back the overlay as it was
  await page.getByRole('button', { name: 'Show UI' }).click();
  await expect(upload).toBeVisible();
});
