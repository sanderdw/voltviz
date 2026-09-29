import { test, expect, type Page } from '@playwright/test';

// The Sendspin protocol is encrypted end to end, so these tests drive the bar through the
// development hook (src/app/sendspinDev.ts) instead of a real Sendspin / Music Assistant server.

type Call = { command: string; args?: unknown };

const inject = async (page: Page, options: unknown) => {
  await page.waitForFunction(() => '__voltvizSendspin' in window);
  await page.evaluate(o => (window as any).__voltvizSendspin.inject(o), options);
};
const setState = (page: Page, patch: unknown) => page.evaluate(p => (window as any).__voltvizSendspin.setState(p), patch);
const calls = (page: Page): Promise<{ sendspin: Call[]; ma: Call[] }> => page.evaluate(() => (window as any).__voltvizSendspin.calls());

const playing = {
  title: 'Strobe',
  artist: 'deadmau5',
  album: 'For Lack of a Better Name',
  progress: { track_progress: 61000, track_duration: 185000, playback_speed: 1000 },
};
const progress = { positionMs: 61000, durationMs: 185000, playbackSpeed: 1 };

const track = (id: string, name: string) => ({
  item_id: id, provider: 'library', name, uri: `library://track/${id}`, media_type: 'track', favorite: false, artists: [{ name: 'deadmau5' }],
});
const queueItem = (id: string, name: string) => ({ queue_id: 'test-player', queue_item_id: id, name: `deadmau5 - ${name}`, duration: 200, media_item: track(id, name) });
const current = queueItem('1', 'Strobe');
const queue = { queue_id: 'test-player', active: true, items: 3, current_index: 0, state: 'playing', current_item: current };
const emptyQueue = { queue_id: 'test-player', active: false, items: 0, state: 'idle', current_item: null };
const playlist = (id: string, name: string, favorite = false) => ({
  item_id: id, provider: 'library', name, uri: `library://playlist/${id}`, media_type: 'playlist', favorite,
});

test.describe('Sendspin bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('says nothing is playing and where to start music', async ({ page }) => {
    await inject(page, { state: { groupName: 'VoltViz' } });
    const bar = page.getByTestId('sendspin-controls');
    await expect(bar.getByText('Nothing playing')).toBeVisible();
    await expect(bar.getByText('Start music in Music Assistant on “VoltViz”')).toBeVisible();
    // Music Assistant's API is not available here
    await expect(page.getByTestId('sendspin-start')).toHaveCount(0);
    await expect(page.getByTestId('sendspin-queue')).toHaveCount(0);
    await expect(page.getByTestId('sendspin-progress')).toHaveCount(0);
  });

  test('shows the track, album and progress', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress });
    const bar = page.getByTestId('sendspin-controls');
    await expect(bar.getByText('Strobe')).toBeVisible();
    await expect(bar.getByText('deadmau5')).toBeVisible();
    await expect(page.getByTestId('sendspin-album')).toHaveText('For Lack of a Better Name');
    await expect(page.getByTestId('sendspin-elapsed')).toHaveText('1:01');
    await expect(page.getByTestId('sendspin-duration')).toHaveText('3:05');
    await expect(page.getByTestId('sendspin-pause')).toBeVisible();
    // Without seek support the progress is display-only
    await expect(page.getByRole('progressbar', { name: 'Track progress' })).toBeVisible();
    await expect(page.getByTestId('sendspin-seek')).toHaveCount(0);
  });

  test('shows LIVE for a radio stream', async ({ page }) => {
    await inject(page, {
      state: { metadata: { title: 'Radio 538', progress: { track_progress: 5000, track_duration: 0, playback_speed: 1000 } } },
      progress: { positionMs: 125000, durationMs: 0, playbackSpeed: 1 },
    });
    await expect(page.getByTestId('sendspin-duration')).toHaveText('LIVE');
    await expect(page.getByTestId('sendspin-elapsed')).toHaveText('2:05');
  });

  test('goes back to "Nothing playing" when the track is cleared', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress });
    const bar = page.getByTestId('sendspin-controls');
    await expect(bar.getByText('Strobe')).toBeVisible();
    await setState(page, { metadata: null });
    await expect(bar.getByText('Nothing playing')).toBeVisible();
    await expect(page.getByText('Strobe')).toHaveCount(0);
  });

  test('shows paused and reconnecting', async ({ page }) => {
    await inject(page, {
      state: { metadata: { ...playing, progress: { ...playing.progress, playback_speed: 0 } } },
      progress: { ...progress, playbackSpeed: 0 },
    });
    await expect(page.getByTestId('sendspin-status')).toHaveText('Paused');
    await expect(page.getByTestId('sendspin-play')).toBeEnabled();
    await setState(page, { reconnectAttempt: 3 });
    await expect(page.getByTestId('sendspin-status')).toHaveText('Reconnecting (3/10)…');
    await expect(page.getByTestId('sendspin-play')).toBeDisabled();
  });

  test('seeks over Sendspin when the server supports it', async ({ page }) => {
    await inject(page, { state: { metadata: playing, supportedCmds: ['play', 'pause', 'seek'], seekMaxMs: 185000 }, progress });
    await page.getByTestId('sendspin-seek').fill('90000');
    await expect.poll(async () => (await calls(page)).sendspin).toContainEqual({ command: 'seek', args: { position_ms: 90000 } });
    await expect(page.getByTestId('sendspin-elapsed')).toHaveText('1:30');
  });

  test('sends the transport commands', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress });
    await page.getByTestId('sendspin-pause').click();
    await page.getByTestId('sendspin-next').click();
    await page.getByTestId('sendspin-shuffle').click();
    expect((await calls(page)).sendspin.map(c => c.command)).toEqual(['pause', 'next', 'shuffle']);
  });

  test('shows a shuffle or repeat change before the server reports it', async ({ page }) => {
    // Music Assistant 2.10 sends shuffle and repeat over Sendspin only with the next track
    await inject(page, { state: { metadata: playing }, progress });
    const shuffle = page.getByTestId('sendspin-shuffle');
    const repeat = page.getByTestId('sendspin-repeat');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: all');
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: one');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    expect((await calls(page)).sendspin.map(c => c.command)).toEqual(['shuffle', 'repeat_all', 'repeat_one', 'unshuffle']);
    // The next track brings what the server has
    await setState(page, { metadata: { ...playing, title: 'Ghosts n Stuff' }, repeat: 'off', shuffle: true });
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: off');
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  });

  test('slides the bar down and back up', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress });
    const bar = page.getByTestId('sendspin-controls');
    const toggle = page.getByTestId('sendspin-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(bar).not.toBeInViewport({ ratio: 0.1 });
    await expect(bar).toHaveAttribute('inert', '');
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await expect(toggle).toContainText('Strobe');

    // Remembered in this browser
    await page.reload();
    await inject(page, { state: { metadata: playing }, progress });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(bar).toBeInViewport({ ratio: 1 });
    await expect(bar).not.toHaveAttribute('inert');
  });
});

test.describe('Sendspin bar with Music Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts a playlist from the picker when the queue is empty', async ({ page }) => {
    await inject(page, {
      ma: {
        queue: emptyQueue,
        playlists: [playlist('1', '500 Random tracks'), playlist('2', 'Beste van NL', true)],
        favoritePlaylists: [playlist('2', 'Beste van NL', true)],
      },
    });
    await expect(page.getByText('Pick something to start')).toBeVisible();
    await page.getByTestId('sendspin-start').click();
    const picker = page.getByTestId('sendspin-picker');
    const items = picker.getByTestId('sendspin-media-item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Beste van NL');
    await items.filter({ hasText: '500 Random tracks' }).click();
    await expect(picker).toHaveCount(0);
    expect((await calls(page)).ma).toContainEqual({
      command: 'player_queues/play_media',
      args: { queue_id: 'test-player', media: 'library://playlist/1', option: 'replace' },
    });
  });

  test('loads Music Assistant\'s artwork through ingress', async ({ page }) => {
    const id = 'e416ca57dc9724c6b3724798eb9b75122206e89de0c6e9c430f26c62e3ce2050';
    await inject(page, { state: { metadata: { ...playing, artwork_url: `http://ma.local:8095/imageproxy/${id}?size=512&fmt=jpg` } }, progress, ma: { queue } });
    await expect(page.getByTestId('sendspin-track').locator('img')).toHaveAttribute('src', `/api/hassio_ingress/ma/imageproxy/${id}?size=512&fmt=jpg`);
  });

  test('shows the note icon for artwork Music Assistant cannot fetch', async ({ page }) => {
    await inject(page, { ma: { queue: emptyQueue, playlists: [{ ...playlist('1', 'Gone from Spotify'), image: { path: '/no-such-cover.png' } }] } });
    await page.getByTestId('sendspin-start').click();
    const item = page.getByTestId('sendspin-media-item');
    await expect(item).toContainText('Gone from Spotify');
    await expect(item.locator('img')).toHaveCount(0);
    await expect(item.locator('svg')).toBeVisible();
  });

  test('Play on an empty queue opens the picker', async ({ page }) => {
    await inject(page, { ma: { queue: emptyQueue } });
    await page.getByTestId('sendspin-play').click();
    await expect(page.getByTestId('sendspin-picker')).toBeVisible();
    expect((await calls(page)).sendspin).toEqual([]);
  });

  test('searches the library and plays a result next to the current queue', async ({ page }) => {
    await inject(page, {
      state: { metadata: playing },
      progress,
      ma: { queue, search: { albums: [{ ...playlist('7', 'Random Album Title'), media_type: 'album', uri: 'library://album/7' }], tracks: [track('9', 'Ghosts n Stuff')] } },
    });
    await page.getByTestId('sendspin-queue').click();
    await page.getByTestId('sendspin-add-music').click();
    await page.getByTestId('sendspin-picker-tab-search').click();
    await page.getByTestId('sendspin-picker-search').fill('dead');
    const picker = page.getByTestId('sendspin-picker');
    await expect(picker.getByText('Albums')).toBeVisible();
    await picker.getByTestId('sendspin-media-item').filter({ hasText: 'Ghosts n Stuff' }).click();
    const maCalls = (await calls(page)).ma;
    expect(maCalls).toContainEqual({ command: 'music/search', args: expect.objectContaining({ search_query: 'dead' }) });
    expect(maCalls).toContainEqual({ command: 'player_queues/play_media', args: { queue_id: 'test-player', media: 'library://track/9', option: 'play' } });
  });

  test('shows the queue and jumps to an item', async ({ page }) => {
    await inject(page, {
      state: { metadata: playing },
      progress,
      ma: { queue, queueItems: [current, queueItem('2', 'Ghosts n Stuff'), queueItem('3', 'I Remember')] },
    });
    await page.getByTestId('sendspin-queue').click();
    const rows = page.getByTestId('sendspin-queue-item');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    await rows.nth(2).click();
    await expect.poll(async () => (await calls(page)).ma).toContainEqual({
      command: 'player_queues/play_index',
      args: { queue_id: 'test-player', index: '3' },
    });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sendspin-queue-panel')).toHaveCount(0);
  });

  test('takes queue updates from Music Assistant events', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue } });
    await expect(page.getByTestId('sendspin-status')).toHaveText('');
    await page.evaluate(q => (window as any).__voltvizSendspin.emitMaEvent({ event: 'queue_updated', object_id: 'test-player', data: { ...q, state: 'paused' } }), queue);
    await expect(page.getByTestId('sendspin-status')).toHaveText('Paused');
    // Another player's queue is ignored
    await page.evaluate(q => (window as any).__voltvizSendspin.emitMaEvent({ event: 'queue_updated', object_id: 'kitchen', data: { ...q, queue_id: 'kitchen', state: 'playing' } }), queue);
    await expect(page.getByTestId('sendspin-status')).toHaveText('Paused');
  });

  test('adds the current track to the favorites', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue } });
    const heart = page.getByTestId('sendspin-favorite');
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect((await calls(page)).ma).toContainEqual({ command: 'music/favorites/add_item', args: { item: 'library://track/1' } });
  });

  test('hides the heart when favorites cannot be changed', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue, failing: ['music/favorites/add_item'] } });
    await page.getByTestId('sendspin-favorite').click();
    await expect(page.getByTestId('sendspin-favorite')).toHaveCount(0);
  });

  test('seeks through Music Assistant when Sendspin cannot', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue } });
    await page.getByTestId('sendspin-seek').fill('90000');
    await expect.poll(async () => (await calls(page)).ma).toContainEqual({ command: 'player_queues/seek', args: { queue_id: 'test-player', position: 90 } });
  });

  test('changes shuffle and repeat through Music Assistant', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue: { ...queue, shuffle_enabled: false, repeat_mode: 'off' } } });
    const shuffle = page.getByTestId('sendspin-shuffle');
    const repeat = page.getByTestId('sendspin-repeat');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: all');
    const all = await calls(page);
    expect(all.ma).toContainEqual({ command: 'player_queues/shuffle', args: { queue_id: 'test-player', shuffle_enabled: true } });
    expect(all.ma).toContainEqual({ command: 'player_queues/repeat', args: { queue_id: 'test-player', repeat_mode: 'all' } });
    expect(all.sendspin).toEqual([]);
    // Changed somewhere else: the queue update wins
    await page.evaluate(q => (window as any).__voltvizSendspin.emitMaEvent({ event: 'queue_updated', object_id: 'test-player', data: { ...q, shuffle_enabled: false, repeat_mode: 'one' } }), queue);
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: one');
  });

  test('undoes a refused shuffle and locks shuffle and repeat on a dynamic queue', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue, failing: ['player_queues/shuffle'] } });
    const shuffle = page.getByTestId('sendspin-shuffle');
    await shuffle.click();
    await expect.poll(async () => (await calls(page)).ma.map(c => c.command)).toContain('player_queues/shuffle');
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(q => (window as any).__voltvizSendspin.emitMaEvent({ event: 'queue_updated', object_id: 'test-player', data: { ...q, is_dynamic: true } }), queue);
    await expect(shuffle).toBeDisabled();
    await expect(page.getByTestId('sendspin-repeat')).toBeDisabled();
  });

  test('closes the queue when the bar slides down', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue } });
    await page.getByTestId('sendspin-queue').click();
    await expect(page.getByTestId('sendspin-queue-panel')).toBeVisible();
    await page.getByTestId('sendspin-toggle').click();
    await expect(page.getByTestId('sendspin-queue-panel')).toHaveCount(0);
  });

  test('hides the Music Assistant controls while its connection is down', async ({ page }) => {
    await inject(page, { state: { metadata: playing }, progress, ma: { queue } });
    await page.getByTestId('sendspin-queue').click();
    await expect(page.getByTestId('sendspin-queue-panel')).toBeVisible();
    await page.evaluate(() => (window as any).__voltvizSendspin.setMaStatus('reconnecting'));
    await expect(page.getByTestId('sendspin-queue-panel')).toHaveCount(0);
    await expect(page.getByTestId('sendspin-queue')).toHaveCount(0);
    await expect(page.getByTestId('sendspin-favorite')).toHaveCount(0);
    await page.evaluate(() => (window as any).__voltvizSendspin.setMaStatus('connected'));
    await expect(page.getByTestId('sendspin-queue')).toBeVisible();
  });
});

for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 740 }]) {
  test.describe(`Sendspin bar – ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });

    test('the bar and the picker fit the screen', async ({ page }) => {
      await page.goto('/');
      await inject(page, { state: { metadata: playing }, progress, ma: { queue, playlists: [playlist('1', 'A playlist with a rather long name that has to be cut off')] } });
      const bar = page.getByTestId('sendspin-controls');
      await expect(bar).toBeInViewport({ ratio: 1 });
      for (const id of ['sendspin-toggle', 'sendspin-play', 'sendspin-pause', 'sendspin-next', 'sendspin-queue', 'sendspin-seek', 'sendspin-duration']) {
        const el = page.getByTestId(id);
        if (await el.count()) await expect(el).toBeInViewport({ ratio: 1 });
      }
      await page.getByTestId('sendspin-queue').click();
      await page.getByTestId('sendspin-add-music').click();
      await expect(page.getByTestId('sendspin-picker')).toBeInViewport({ ratio: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
