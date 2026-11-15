const params = new URLSearchParams(location.hash.slice(1));
const videoId = params.get('v');
const channel = params.get('channel');
let apiTimer;

function send(type, data) {
  // The local Figma UI has an opaque origin; authenticate replies there by source and channel.
  parent.postMessage({ source: 'youtubewatch-player', version: PLAYER_PROTOCOL, channel, type, data }, '*');
}

function showError(text) {
  const error = document.getElementById('error');
  error.textContent = text;
  error.hidden = false;
}

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

  window.onYouTubeIframeAPIReady = () => {
    clearTimeout(apiTimer);
    try {
      new YT.Player(frame, { events: {
        onReady: () => send('ready'),
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
