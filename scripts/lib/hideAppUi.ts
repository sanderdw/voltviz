import type { Page } from 'playwright';

/**
 * Hides the app chrome for a clean capture: clicks "Hide UI" (which also hides a visualizer's
 * upload/style overlay), then removes the floating "Show UI" toggle and the version label that
 * stay visible in that mode.
 */
export async function hideAppUi(page: Page): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Hide UI' }).click();
  await page.addStyleTag({ content: 'button[title="Show UI"]{display:none !important}' });
  await page.evaluate(() => {
    document.querySelectorAll('div').forEach(el => {
      if (/^v\d+\./.test(el.textContent?.trim() ?? '') && el.childElementCount === 0) {
        (el as HTMLElement).style.display = 'none';
      }
    });
  });
}
