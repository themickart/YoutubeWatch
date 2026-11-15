const $ = id => document.getElementById(id);
let currentVideo = null;
let channel = null;
let loadTimer;
let playbackError = false;

function setStatus(text, state = 'idle', detail = text) {
  $('status').textContent = text;
  $('status').dataset.state = state;
  $('status').title = detail;
}

function onPlayerEvent(type, data) {
  if (type === 'ready') {
    // Ready is a successful API handshake, not evidence that playback works.
    if (playbackError) return;
    clearTimeout(loadTimer);
    setStatus('Press play in the video', 'ready');
  } else if (type === 'error') {
    playbackError = true;
    clearTimeout(loadTimer);
    setStatus(data === 153 ? 'Error 153 · missing player referrer' : `YouTube error ${data}`, 'error', playerError(data));
  } else if (type === 'state') {
    const states = { 0: ['Ended', 'ready'], 1: ['Playing', 'playing'], 2: ['Paused', 'ready'], 3: ['Buffering…', 'loading'], 5: ['Press play in the video', 'ready'] };
    // An unstarted event must not erase a preceding 153 error.
    if (states[data] && (data === 1 || !playbackError)) {
      if (data === 1) playbackError = false;
      clearTimeout(loadTimer);
      setStatus(...states[data]);
    }
  } else if (type === 'autoplay-blocked' && !playbackError) setStatus('Press play in the video', 'ready');
  else if (type === 'failure') {
    clearTimeout(loadTimer);
    setStatus('Player status unavailable. Try reload.', 'error');
  }
}

function loadVideo(input) {
  let video;
  try { video = parseVideo(input); }
  catch (error) {
    setStatus(error.message, 'error');
    $('video-url').setAttribute('aria-invalid', 'true');
    $('video-url').focus();
    return;
  }
  $('video-url').removeAttribute('aria-invalid');
  clearTimeout(loadTimer);
  currentVideo = video;
  playbackError = false;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  channel = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  $('demo-play').hidden = true;
  $('reload').disabled = false;
  $('external-link').href = `https://www.youtube.com/watch?v=${video.id}${video.start ? `&t=${video.start}s` : ''}`;
  $('external-link').hidden = false;
  setStatus('Loading…', 'loading');
  const frame = document.createElement('iframe');
  frame.id = 'youtube-player';
  frame.title = 'YouTube video player';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer';
  frame.src = playerPageUrl(video, channel);
  $('player-host').replaceChildren(frame);
  loadTimer = setTimeout(() => {
    setStatus('Player unavailable · try reload', 'error', 'The player page did not respond. Check that player.html is published on GitHub Pages and try reloading.');
  }, 20000);
}

window.addEventListener('message', event => {
  const message = readPlayerEvent(event, $('youtube-player')?.contentWindow, channel);
  if (message) onPlayerEvent(message.type, message.data);
});

$('video-form').addEventListener('submit', event => { event.preventDefault(); loadVideo($('video-url').value); });
$('demo-play').addEventListener('click', () => { $('video-url').value = DEMO_URL; loadVideo(DEMO_URL); });
$('video-url').addEventListener('input', () => $('video-url').removeAttribute('aria-invalid'));
$('reload').addEventListener('click', () => {
  if (currentVideo) loadVideo(`https://www.youtube.com/watch?v=${currentVideo.id}&t=${currentVideo.start}s`);
});

function resize(width, height) {
  width = Math.max(360, Math.min(1200, Math.round(width)));
  height = Math.max(266, Math.min(900, Math.round(height)));
  if (window.parent !== window) parent.postMessage({ pluginMessage: { type: 'resize', width, height } }, '*');
}
let drag;
const handle = $('resize-handle');
handle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { x: event.screenX, y: event.screenY, width: innerWidth, height: innerHeight };
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing');
});
handle.addEventListener('pointermove', event => {
  if (drag) resize(drag.width + event.screenX - drag.x, drag.height + event.screenY - drag.y);
});
function endDrag() { drag = null; document.body.classList.remove('resizing'); }
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);
handle.addEventListener('lostpointercapture', endDrag);
handle.addEventListener('keydown', event => {
  const step = event.shiftKey ? 40 : 10;
  const offsets = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (!offsets[event.key]) return;
  event.preventDefault();
  resize(innerWidth + offsets[event.key][0], innerHeight + offsets[event.key][1]);
});
