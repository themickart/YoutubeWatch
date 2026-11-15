import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PLAYER_PAGE_URL } from '../../src/video.mjs';

const mockAPI = `
window.YT = { Player: class {
  constructor(frame, options) {
    this.frame = frame;
    this.volume = 100;
    this.muted = false;
    window.testPlayer = this;
    window.testPlayerEvents = options.events;
    queueMicrotask(() => options.events.onReady({ target: this }));
  }
  destroy() { this.frame.remove(); }
  getVolume() { return this.volume; }
  setVolume(value) { this.volume = value; }
  isMuted() { return this.muted; }
  mute() { this.muted = true; }
  unMute() { this.muted = false; }
} };
window.onYouTubeIframeAPIReady();`;

test.beforeEach(async ({ page }) => {
  const html = await readFile(new URL('../../player.html', import.meta.url), 'utf8');
  await page.route(PLAYER_PAGE_URL + '**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: route.request().url().includes('/iframe_api') ? 'application/javascript' : 'text/html',
    body: route.request().url().includes('/iframe_api') ? mockAPI : '<html><body>Mock YouTube iframe</body></html>'
  }));
});

async function emit(page, type, data) {
  const frame = page.frames().find(frame => frame.url().startsWith(PLAYER_PAGE_URL));
  await frame.evaluate(({ type, data }) => window.testPlayerEvents[type]({ data, target: window.testPlayer }), { type, data });
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight && document.body.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('#video-form').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.locator('.status-bar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

test('compact UI stays offline and validation does not add scrolling', async ({ page }) => {
  const youtubeRequests = [];
  page.on('request', request => { if (request.url().startsWith('https://www.youtube.com')) youtubeRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Paste a link or try the demo');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('header, footer, aside, h1, h2, select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('#video-url')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#video-url')).toBeFocused();
  await page.locator('#video-url').fill('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE');
  await page.locator('#video-url').press('Enter');
  await expect(page.locator('#status')).toContainText('Only YouTube');
  expect(youtubeRequests).toEqual([]);
  for (const [width, height] of [[360, 266], [480, 336], [640, 426], [880, 561]]) {
    await page.setViewportSize({ width, height });
    await expectNoOverflow(page);
    expect((await page.locator('.player-shell').boundingBox()).height).toBeGreaterThanOrEqual(200);
  }
  await page.setViewportSize({ width: 480, height: 336 });
  await page.goto('/');
});

test('demo reports playback and keeps 153 visible after late ready/unstarted events', async ({ page }) => {
  const embeds = [];
  const hostedRequests = [];
  page.on('request', request => {
    if (request.url().includes('/embed/')) embeds.push(request);
    if (request.url().startsWith(PLAYER_PAGE_URL)) hostedRequests.push(request);
  });
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveAttribute('src', /^https:\/\/themickart\.github\.io\/YoutubeWatch\/player\.html\?build=2#/);
  const youtube = page.frameLocator('#youtube-player').locator('#player');
  await expect(youtube).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/M7lc1UVf-VE\?/);
  await expect(youtube).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  expect(embeds[0].headers().referer).toBe('https://themickart.github.io/');
  expect(hostedRequests[0].headers().referer).toBeUndefined();
  await expect(page.locator('#demo-play')).toBeHidden();
  await emit(page, 'onStateChange', 1);
  await expect(page.locator('#status')).toHaveText('Playing');
  await emit(page, 'onStateChange', 2);
  await expect(page.locator('#status')).toHaveText('Paused');
  await emit(page, 'onError', 153);
  await emit(page, 'onReady');
  await emit(page, 'onStateChange', -1);
  await expect(page.locator('#status')).toContainText('Error 153');
  await expect(page.locator('#status')).toHaveAttribute('title', /HTTP Referer/);
  await expectNoOverflow(page);
});

test('timestamps survive reload and invalid input keeps the current player', async ({ page }) => {
  await page.goto('/');
  await page.locator('#video-url').fill('https://youtu.be/M7lc1UVf-VE?t=1m30s');
  await page.locator('#video-url').press('Enter');
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.frameLocator('#youtube-player').locator('#player')).toHaveAttribute('src', /[?&]start=90/);
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.frameLocator('#youtube-player').locator('#player')).toHaveAttribute('src', /[?&]start=90/);
  await expect(page.locator('#external-link')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=90s');
  await page.locator('#video-url').fill('javascript:alert(1)');
  await page.locator('#video-url').press('Enter');
  await expect(page.locator('#video-url')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#youtube-player')).toHaveCount(1);
});

test('API failure stays in the fixed status line', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.abort());
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Player status unavailable. Try reload.');
  await expect(page.locator('#youtube-player')).toBeVisible();
  await expectNoOverflow(page);
});

test('data URL sandbox exposes null origin and emits bounded resize messages', async ({ page }) => {
  await page.goto('/');
  const html = await readFile(new URL('../../ui.html', import.meta.url), 'utf8');
  await page.evaluate(html => {
    document.body.replaceChildren();
    window.resizeMessage = null;
    window.addEventListener('message', event => { if (event.data?.pluginMessage) window.resizeMessage = event.data.pluginMessage; });
    const frame = document.createElement('iframe');
    frame.id = 'figma-sandbox';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.style.cssText = 'width:480px;height:336px;border:0';
    frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    document.body.appendChild(frame);
  }, html);
  const sandbox = page.frameLocator('#figma-sandbox');
  await sandbox.locator('#demo-play').click();
  await expect(sandbox.locator('#status')).toHaveText('Press play in the video');
  expect(new URL(await sandbox.locator('#youtube-player').getAttribute('src')).origin).toBe('https://themickart.github.io');
  expect(new URL(await sandbox.locator('#youtube-player').getAttribute('src')).search).toBe('?build=2');
  await sandbox.locator('#resize-handle').focus();
  await sandbox.locator('#resize-handle').press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.resizeMessage)).toEqual({ type: 'resize', width: 490, height: 336 });
});

test('events from an old video cannot replace the current player status', async ({ page }) => {
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await page.evaluate(() => {
    const frame = document.getElementById('youtube-player');
    window.oldPlayerSource = frame.contentWindow;
    window.oldPlayerChannel = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('channel');
  });
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: window.oldPlayerSource,
      origin: 'https://themickart.github.io',
      data: { source: 'youtubewatch-player', version: 1, channel: window.oldPlayerChannel, type: 'error', data: 153 }
    }));
  });
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveCount(1);
  await expectNoOverflow(page);
});

test('a missing Pages deployment gets a useful timeout without scrolling', async ({ page }) => {
  await page.route(PLAYER_PAGE_URL + '**', route => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' }));
  await page.clock.install();
  await page.goto('/');
  await page.locator('#demo-play').click();
  await page.clock.fastForward(21000);
  await expect(page.locator('#status')).toHaveText('Player unavailable · try reload');
  await expect(page.locator('#status')).toHaveAttribute('title', /player.html is published/);
  await expectNoOverflow(page);
});

test('an invalid hosted player configuration never loads YouTube', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('https://www.youtube.com')) requests.push(request.url()); });
  await page.goto(PLAYER_PAGE_URL + '#v=invalid&channel=invalid');
  await expect(page.locator('#error')).toHaveText('Open a video from the YoutubeWatch plugin.');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('the link panel collapses on playback and can stay open without reloading video', async ({ page }) => {
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  const src = await page.locator('#youtube-player').getAttribute('src');
  const height = (await page.locator('.player-shell').boundingBox()).height;
  await emit(page, 'onStateChange', 1);
  await expect(page.locator('#video-form')).toBeHidden();
  await expect(page.locator('#toolbar-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect((await page.locator('.player-shell').boundingBox()).height).toBe(height + 44);
  await expect(page.locator('#volume-controls')).toBeVisible();
  await emit(page, 'onStateChange', 2);
  await expect(page.locator('#video-form')).toBeHidden();
  await page.getByRole('button', { name: 'Show video link', exact: true }).click();
  await expect(page.locator('#video-form')).toBeVisible();
  await emit(page, 'onStateChange', 3);
  await emit(page, 'onStateChange', 1);
  await expect(page.locator('#video-form')).toBeVisible();
  await expect(page.locator('#youtube-player')).toHaveAttribute('src', src);
  await page.getByRole('button', { name: 'Hide video link', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 266 });
  await expectNoOverflow(page);
  await emit(page, 'onError', 100);
  await expect(page.locator('#video-form')).toBeVisible();
  await expectNoOverflow(page);
});

test('volume and mute control the player, sync native changes and survive reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#volume-controls')).toBeVisible();
  const hosted = () => page.frames().find(frame => frame.url().startsWith(PLAYER_PAGE_URL));
  await page.locator('#volume').evaluate(element => { element.value = '35'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.getVolume())).toBe(35);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.isMuted())).toBe(true);
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.isMuted())).toBe(false);
  await page.locator('#volume').evaluate(element => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.isMuted())).toBe(true);
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.getVolume())).toBe(35);
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.isMuted())).toBe(false);
  await hosted().evaluate(() => { window.testPlayer.volume = 17; window.testPlayer.muted = true; });
  await expect(page.locator('#volume')).toHaveValue('17');
  await expect(page.locator('#mute-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#reload').click();
  await expect(page.locator('#volume-controls')).toBeVisible();
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.getVolume())).toBe(35);
  await expect.poll(() => hosted().evaluate(() => window.testPlayer.isMuted())).toBe(false);
  await page.setViewportSize({ width: 360, height: 266 });
  await expectNoOverflow(page);
});
