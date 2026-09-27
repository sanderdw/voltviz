import { test, expect } from '@playwright/test';
import { visualizers } from '../src/visualizers';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

// Every registered visualizer must mount, draw and run without console errors.
test.describe('VoltViz – every visualizer mounts and runs', () => {
  for (const v of visualizers) {
    test(`${v.id}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`/?viz=${v.id}&aibeat=0`);
      await page.getByRole('button', { name: 'Microphone' }).click();
      await expect(page.locator('[data-testid="viz-canvas-root"] canvas').first()).toBeAttached({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const stats = await page.evaluate(() => (window as unknown as { __voltviz: { host: { stats(): { id: string; fps: number; failed: boolean }[] } } }).__voltviz.host.stats());
      expect(stats.find(s => s.id === v.id)?.failed).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});
