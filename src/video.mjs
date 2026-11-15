export const DEMO_URL = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
export const PLAYER_PAGE_URL = "https://themickart.github.io/YoutubeWatch/player.html";
export const PLAYER_PROTOCOL = 1;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function playerPageUrl(video, channel) {
  if (!VIDEO_ID.test(video.id) || !/^[a-f0-9]{32}$/.test(channel)) throw new Error('Invalid player configuration.');
  const url = new URL(PLAYER_PAGE_URL);
  url.searchParams.set('build', '3');
  url.hash = new URLSearchParams({ v: video.id, start: String(parseTime(String(video.start))), channel });
  return url.href;
}

export function readPlayerEvent(event, source, channel) {
  if (!source || !channel || event.source !== source || event.origin !== new URL(PLAYER_PAGE_URL).origin) return null;
  const message = event.data;
  if (!message || message.source !== 'youtubewatch-player' || message.version !== PLAYER_PROTOCOL || message.channel !== channel) return null;
  if (['ready', 'autoplay-blocked'].includes(message.type)) return message;
  if (message.type === 'state' && [-1, 0, 1, 2, 3, 5].includes(message.data)) return message;
  if (message.type === 'error' && Number.isInteger(message.data)) return message;
  if (message.type === 'failure' && message.data === 'api-unavailable') return message;
  if (message.type === 'volume' && message.data && Number.isInteger(message.data.volume) && message.data.volume >= 0 && message.data.volume <= 100 && typeof message.data.muted === 'boolean') return message;
  if (message.type === 'aspect' && Number.isFinite(message.data) && message.data >= 0.2 && message.data <= 5) return message;
  if (message.type === 'playback' && message.data && Number.isFinite(message.data.time) && message.data.time >= 0 && Number.isFinite(message.data.duration) && message.data.duration >= 0) return message;
  return null;
}

export function readPlayerCommand(event, source, channel) {
  if (!source || !channel || event.source !== source) return null;
  const message = event.data;
  if (!message || message.source !== 'youtubewatch-ui' || message.version !== PLAYER_PROTOCOL || message.channel !== channel) return null;
  if (message.type === 'set-volume' && Number.isInteger(message.data) && message.data >= 0 && message.data <= 100) return message;
  if (message.type === 'set-muted' && typeof message.data === 'boolean') return message;
  if (['play', 'pause'].includes(message.type) && message.data === undefined) return message;
  if (message.type === 'seek' && Number.isFinite(message.data) && message.data >= 0 && message.data <= 2147483647) return message;
  return null;
}

export function videoAspectRatio(width, height) {
  const ratio = Number(width) / Number(height);
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) return 16 / 9;
  // oEmbed rounds its small embed dimensions, e.g. 200x113 for a 16:9 video.
  return [16 / 9, 4 / 3, 9 / 16, 1, 3 / 2, 21 / 9].find(value => Math.abs(ratio / value - 1) < 0.015) || ratio;
}

export function fitPlayerWindow(width, toolbarVisible, ratio = 16 / 9) {
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) ratio = 16 / 9;
  const chrome = toolbarVisible ? 66 : 22;
  width = Math.max(360, Math.min(1200, Math.round(width)));
  width = Math.max(width, Math.ceil(200 * ratio));
  if (width / ratio + chrome > 900) width = Math.max(360, Math.floor((900 - chrome) * ratio));
  return { width, height: Math.max(chrome + 200, Math.min(900, Math.round(width / ratio) + chrome)) };
}

export function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function parseTime(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 2147483647);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return 0;
  return Math.min(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0), 2147483647);
}

export function parseVideo(input) {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return { id: value, start: 0 };
  let url;
  try {
    url = new URL(/^(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be)\//i.test(value) ? `https://${value}` : value);
  } catch {
    throw new Error("Paste a YouTube video link or an 11-character video ID.");
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Use a regular YouTube video link.");
  }
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1) id = parts[0];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  } else {
    throw new Error("Only YouTube video links are supported.");
  }
  if (!id || !VIDEO_ID.test(id)) throw new Error("This link has no video ID. Open a video and copy its link.");
  return { id, start: parseTime(url.searchParams.get('t') || url.searchParams.get('start') || new URLSearchParams(url.hash.slice(1)).get('t')) };
}

export function embedUrl(video, origin) {
  // Never navigate directly to pasted URLs, including short URLs.
  const url = new URL(`https://www.youtube.com/embed/${video.id}`);
  url.search = new URLSearchParams({ enablejsapi: '1', playsinline: '1', autoplay: '0', controls: '0', rel: '0' });
  if (video.start) url.searchParams.set('start', String(video.start));
  // An opaque Figma sandbox has no HTTP origin; do not invent one.
  if (origin && /^https?:\/\//.test(origin)) url.searchParams.set('origin', new URL(origin).origin);
  return url.href;
}

export function playerError(code) {
  const messages = {
    2: "YouTube could not read this video ID. Check the link and try again.",
    5: "YouTube could not play this video. Try reloading it or opening it on YouTube.",
    100: "This video is unavailable, private, or has been removed. Try another link.",
    101: "The owner does not allow embedded playback. Try another video or open it on YouTube.",
    150: "The owner does not allow embedded playback. Try another video or open it on YouTube.",
    153: "YouTube did not receive the required HTTP Referer. Reload the video and check that the current player.html is published on GitHub Pages."
  };
  return messages[code] || "YouTube could not play this video. Try another link or open it on YouTube.";
}
