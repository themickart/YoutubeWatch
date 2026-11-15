const params = new URLSearchParams(location.hash.slice(1));
const videoId = params.get('v');
const channel = params.get('channel');
let apiTimer;
let player;
let ready = false;
let volumeTimer;
let lastAudio = '';
let lastPlayback = '';

async function publishAspect() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = new URL('https://www.youtube.com/oembed');
    url.search = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' });
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json();
    send('aspect', videoAspectRatio(data.width, data.height));
  } catch { /* A missing metadata response leaves Fit at 16:9. */ }
  finally { clearTimeout(timer); }
}

function send(type, data) {
  // The local Figma UI has an opaque origin; authenticate replies there by source and channel.
  parent.postMessage({ source: 'youtubewatch-player', version: PLAYER_PROTOCOL, channel, type, data }, '*');
}

function showError(text) {
  const error = document.getElementById('error');
  error.textContent = text;
  error.hidden = false;
}

function publishVolume() {
  if (!ready) return;
  const volume = Math.round(player.getVolume());
  const muted = player.isMuted();
  if (!Number.isFinite(volume) || volume < 0 || volume > 100) return;
  const key = `${volume}:${muted}`;
  if (key === lastAudio) return;
  lastAudio = key;
  send('volume', { volume, muted });
}

function publishPlayback() {
  if (!ready) return;
  const time = player.getCurrentTime();
  const duration = player.getDuration();
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration < 0) return;
  const key = `${Math.floor(time * 2)}:${duration}`;
  if (lastPlayback === key) return;
  lastPlayback = key;
  send('playback', { time, duration });
}

window.addEventListener('message', event => {
  // Only the actual embedding window with this video's channel may control audio.
  const command = readPlayerCommand(event, parent, channel);
  if (!command || !ready) return;
  if (command.type === 'set-volume') {
    player.setVolume(command.data);
    if (command.data > 0) player.unMute();
    else player.mute();
  } else if (command.type === 'set-muted') {
    if (command.data) player.mute();
    else player.unMute();
  } else if (command.type === 'play') player.playVideo();
  else if (command.type === 'pause') player.pauseVideo();
  else if (command.type === 'seek') {
    const duration = player.getDuration();
    if (Number.isFinite(duration) && duration > 0) player.seekTo(Math.min(command.data, duration), true);
  }
  publishVolume();
  publishPlayback();
});
window.addEventListener('pagehide', () => clearInterval(volumeTimer));

if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '') || !/^[a-f0-9]{32}$/.test(channel || '')) {
  showError('Open a video from the YoutubeWatch plugin.');
} else if (!/^https?:$/.test(location.protocol)) {
  showError('The player must be opened from its website.');
} else {
  const frame = document.createElement('iframe');
  frame.id = 'player';
  frame.title = 'YouTube video player';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = embedUrl({ id: videoId, start: parseTime(params.get('start')) }, location.origin);
  document.body.appendChild(frame);
  publishAspect();

  window.onYouTubeIframeAPIReady = () => {
    clearTimeout(apiTimer);
    try {
      player = new YT.Player(frame, { events: {
        onReady: event => {
          player = event.target;
          ready = true;
          send('ready');
          publishVolume();
          publishPlayback();
          clearInterval(volumeTimer);
          volumeTimer = setInterval(() => { publishVolume(); publishPlayback(); }, 500);
        },
        onStateChange: event => send('state', event.data),
        onError: event => send('error', event.data),
        onAutoplayBlocked: () => send('autoplay-blocked')
      } });
    } catch { send('failure', 'api-unavailable'); }
  };
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.onerror = () => { clearTimeout(apiTimer); send('failure', 'api-unavailable'); };
  apiTimer = setTimeout(() => send('failure', 'api-unavailable'), 15000);
  document.head.appendChild(script);
}
