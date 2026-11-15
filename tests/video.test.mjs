import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseVideo, parseTime, embedUrl, playerError, playerPageUrl, readPlayerEvent, PLAYER_PAGE_URL } from '../src/video.mjs';

test('accepts video links, mobile, Shorts, live and embed links without fetching them', () => {
  for (const input of [
    'M7lc1UVf-VE', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&si=tracking',
    'https://youtu.be/M7lc1UVf-VE', 'youtu.be/M7lc1UVf-VE',
    'youtube.com/watch?v=M7lc1UVf-VE', 'https://m.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com/shorts/M7lc1UVf-VE', 'https://www.youtube.com/live/M7lc1UVf-VE',
    'https://www.youtube.com/embed/M7lc1UVf-VE'
  ]) assert.deepEqual(parseVideo(input), { id: 'M7lc1UVf-VE', start: 0 }, input);
});

test('preserves timestamp formats and caps unreasonable start values', () => {
  assert.equal(parseTime('1h2m3s'), 3723);
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1:30'), 0);
  assert.equal(parseTime('-1'), 0);
  assert.equal(parseTime('999999999999h'), 2147483647);
  for (const suffix of ['&t=1m30s', '&start=90', '#t=90']) {
    assert.equal(parseVideo(`https://www.youtube.com/watch?v=M7lc1UVf-VE${suffix}`).start, 90);
  }
});

test('rejects other domains, executable URLs, spoofed hosts, credentials and invalid IDs', () => {
  for (const input of [
    '', 'hello', '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE"></iframe>',
    'javascript:alert(1)', 'data:text/html,test', 'file:///video.mp4',
    'https://www.youtube.com.evil.example/watch?v=M7lc1UVf-VE',
    'https://evil.example/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com@evil.example/watch?v=M7lc1UVf-VE',
    'https://user@www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com:444/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com/playlist?list=example',
    'https://www.youtube.com/watch?v=bad', 'https://youtu.be/M7lc1UVf-VE/extra'
  ]) assert.throws(() => parseVideo(input), undefined, input);
});

test('normalizes YouTube embeds to the official network origin', () => {
  const url = new URL(embedUrl(parseVideo('https://youtu.be/M7lc1UVf-VE?t=12&si=tracking'), 'null'));
  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.pathname, '/embed/M7lc1UVf-VE');
  assert.equal(url.searchParams.get('start'), '12');
  assert.equal(url.searchParams.get('autoplay'), '0');
  assert.equal(url.searchParams.has('origin'), false);
  assert.equal(url.searchParams.has('si'), false);
  assert.equal(new URL(embedUrl({ id: 'M7lc1UVf-VE', start: 0 }, 'https://www.figma.com')).searchParams.get('origin'), 'https://www.figma.com');
});

test('explains blocked embedding and missing player identification', () => {
  assert.match(playerError(153), /HTTP Referer/);
  assert.match(playerError(101), /owner/);
  assert.match(playerError(150), /owner/);
  assert.match(playerError(100), /unavailable/);
  assert.match(playerError(999), /could not play/);
});

test('hosted player URLs keep the video and channel in the fragment', () => {
  const channel = 'a'.repeat(32);
  const url = new URL(playerPageUrl(parseVideo('https://youtu.be/M7lc1UVf-VE?t=90'), channel));
  assert.equal(url.origin + url.pathname, PLAYER_PAGE_URL);
  assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('start'), '90');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('channel'), channel);
  assert.throws(() => playerPageUrl({ id: '<script>', start: 0 }, channel));
  assert.throws(() => playerPageUrl({ id: 'M7lc1UVf-VE', start: 0 }, 'invalid'));
});

test('player events require the correct origin, window, channel, version and shape', () => {
  const source = {};
  const channel = 'a'.repeat(32);
  const message = { source: 'youtubewatch-player', version: 1, channel, type: 'state', data: 1 };
  const event = { source, origin: 'https://themickart.github.io', data: message };
  assert.equal(readPlayerEvent(event, source, channel), message);
  for (const patch of [{ source: {} }, { origin: 'null' }, { origin: 'https://evil.example' }, { data: null }]) assert.equal(readPlayerEvent({ ...event, ...patch }, source, channel), null);
  for (const patch of [{ version: 2 }, { channel: 'b'.repeat(32) }, { source: 'other' }, { type: 'resize' }, { data: '1' }, { data: 10000 }]) assert.equal(readPlayerEvent({ ...event, data: { ...message, ...patch } }, source, channel), null);
  assert.equal(readPlayerEvent(event, null, channel), null);
  assert.equal(readPlayerEvent(event, source, null), null);
});

test('manifest includes the plugin ID and player domains and points to runnable artifacts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.id, '1441766262549436446');
  assert.deepEqual(manifest.networkAccess, { allowedDomains: ['https://www.youtube.com', 'https://themickart.github.io'] });
  assert.equal(manifest.documentAccess, 'dynamic-page');
  for (const path of [manifest.main, manifest.ui]) assert.ok((await readFile(new URL(`../${path}`, import.meta.url))).length);
  const html = await readFile(new URL('../ui.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('/* INLINE_'));
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  const player = await readFile(new URL('../player.html', import.meta.url), 'utf8');
  assert.ok(!player.includes('/* INLINE_'));
  new vm.Script(player.match(/<script>([\s\S]*)<\/script>/)[1]);
});

test('Figma entry point only opens UI and handles bounded window sizes', async () => {
  const calls = [];
  const figma = {
    showUI: (html, options) => calls.push(['show', html, options]),
    ui: { resize: (...args) => calls.push(['resize', ...args]) }
  };
  vm.runInNewContext(await readFile(new URL('../code.js', import.meta.url), 'utf8'), { figma, __html__: 'ui' });
  assert.equal(calls[0][1], 'ui');
  assert.equal(calls[0][2].width, 480);
  assert.equal(calls[0][2].height, 336);
  figma.ui.onmessage({ type: 'resize', width: 640, height: 426 });
  figma.ui.onmessage({ type: 'resize', width: 1, height: 1 });
  figma.ui.onmessage({ type: 'resize', width: 10000, height: 10000 });
  assert.deepEqual(calls.slice(1), [['resize', 640, 426], ['resize', 360, 266], ['resize', 1200, 900]]);
  const count = calls.length;
  for (const message of [null, {}, { type: 'resize', width: NaN, height: 300 }, { type: 'resize', width: Infinity, height: 300 }, { type: 'resize', width: '640', height: 300 }, { type: 'unknown' }]) figma.ui.onmessage(message);
  assert.equal(calls.length, count);
});
