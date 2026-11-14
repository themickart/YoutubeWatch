import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const mockAPI = `
window.YT = { Player: class {
  constructor(frame, options) {
    this.frame = frame;
    window.testPlayerEvents = options.events;
    queueMicrotask(() => options.events.onReady({ target: this }));
  }
  destroy() { this.frame.remove(); }
} };
window.onYouTubeIframeAPIReady();`;

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: route.request().url().includes('/iframe_api') ? 'application/javascript' : 'text/html',
    body: route.request().url().includes('/iframe_api') ? mockAPI : '<html><body>Mock YouTube iframe</body></html>'
  }));
});

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight && document.body.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('#video-form').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
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
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/M7lc1UVf-VE\?/);
  await expect(page.locator('#youtube-player')).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(page.locator('#demo-play')).toBeHidden();
  await page.evaluate(() => window.testPlayerEvents.onStateChange({ data: 1 }));
  await expect(page.locator('#status')).toHaveText('Playing');
  await page.evaluate(() => window.testPlayerEvents.onStateChange({ data: 2 }));
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.evaluate(() => {
    window.testPlayerEvents.onError({ data: 153 });
    window.testPlayerEvents.onReady();
    window.testPlayerEvents.onStateChange({ data: -1 });
  });
  await expect(page.locator('#status')).toContainText('Error 153');
  await expect(page.locator('#status')).toHaveAttribute('title', /HTTP Referer/);
  await expectNoOverflow(page);
});

test('timestamps survive reload and invalid input keeps the current player', async ({ page }) => {
  await page.goto('/');
  await page.locator('#video-url').fill('https://youtu.be/M7lc1UVf-VE?t=1m30s');
  await page.locator('#video-url').press('Enter');
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveAttribute('src', /[?&]start=90/);
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveAttribute('src', /[?&]start=90/);
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
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'width:480px;height:336px;border:0';
    frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    document.body.appendChild(frame);
  }, html);
  const sandbox = page.frameLocator('#figma-sandbox');
  await sandbox.locator('#demo-play').click();
  await expect(sandbox.locator('#status')).toHaveText('Press play in the video');
  expect(new URL(await sandbox.locator('#youtube-player').getAttribute('src')).searchParams.has('origin')).toBe(false);
  await sandbox.locator('#resize-handle').focus();
  await sandbox.locator('#resize-handle').press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.resizeMessage)).toEqual({ type: 'resize', width: 490, height: 336 });
});

test('events from an old video cannot replace the current player status', async ({ page }) => {
  await page.goto('/');
  await page.locator('#demo-play').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await page.evaluate(() => { window.oldPlayerEvents = window.testPlayerEvents; });
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await page.evaluate(() => {
    window.oldPlayerEvents.onError({ data: 153 });
    window.oldPlayerEvents.onStateChange({ data: 1 });
  });
  await expect(page.locator('#status')).toHaveText('Press play in the video');
  await expect(page.locator('#youtube-player')).toHaveCount(1);
  await expectNoOverflow(page);
});
