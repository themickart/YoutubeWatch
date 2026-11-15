const $ = id => document.getElementById(id);
let currentVideo = null;
let channel = null;
let loadTimer;
let playbackError = false;
let autoHideToolbar = true;
let audio = { volume: 100, muted: false };
let preferredVolume = null;
let preferredMuted = null;
let lastAudibleVolume = 100;
let aspectRatio = 16 / 9;
let fitActive = false;
let playing = false;
let duration = 0;
let seeking = false;

function fitWindow() {
  const size = fitPlayerWindow(innerWidth, !$('video-form').hidden, aspectRatio);
  resize(size.width, size.height);
}

function renderPlayback(value) {
  playing = value;
  $('playback-toggle').dataset.playing = String(value);
  $('playback-toggle').setAttribute('aria-label', value ? 'Pause' : 'Play');
  $('playback-toggle').title = value ? 'Pause' : 'Play';
}

function renderProgress(data) {
  duration = data.duration;
  $('seek').hidden = duration <= 0;
  $('seek').disabled = duration <= 0;
  if (seeking || duration <= 0) return;
  $('seek').value = String(Math.round(Math.min(data.time / duration, 1) * 1000));
  const label = `${formatTime(data.time)} / ${formatTime(duration)}`;
  $('seek').setAttribute('aria-valuetext', label);
  $('seek').title = label;
}

function setToolbarHidden(hidden) {
  const focused = $('video-form').contains(document.activeElement);
  $('video-form').hidden = hidden;
  document.querySelector('.app').classList.toggle('toolbar-hidden', hidden);
  $('toolbar-toggle').setAttribute('aria-expanded', String(!hidden));
  const label = hidden ? 'Show video link' : 'Hide video link';
  $('toolbar-toggle').setAttribute('aria-label', label);
  $('toolbar-toggle').title = label;
  if (hidden && focused) $('toolbar-toggle').focus({ preventScroll: true });
  if (fitActive) fitWindow();
  else if (innerHeight < (hidden ? 222 : 266)) resize(innerWidth, hidden ? 222 : 266);
}

function sendCommand(type, data) {
  const frame = $('youtube-player');
  if (frame && channel) frame.contentWindow.postMessage({ source: 'youtubewatch-ui', version: PLAYER_PROTOCOL, channel, type, data }, new URL(PLAYER_PAGE_URL).origin);
}

function renderAudio(data) {
  audio = data;
  if (data.volume > 0) lastAudibleVolume = data.volume;
  $('volume-controls').hidden = false;
  $('volume').value = String(data.volume);
  $('volume').setAttribute('aria-valuetext', `${data.volume}%`);
  $('volume').title = `Volume: ${data.volume}%`;
  const muted = data.muted || data.volume === 0;
  $('mute-toggle').setAttribute('aria-pressed', String(muted));
  $('mute-toggle').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  $('mute-toggle').title = muted ? 'Unmute' : 'Mute';
}

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
    $('playback-toggle').disabled = false;
    if (preferredVolume !== null) sendCommand('set-volume', preferredVolume);
    if (preferredMuted !== null) sendCommand('set-muted', preferredMuted);
  } else if (type === 'error') {
    playbackError = true;
    renderPlayback(false);
    setToolbarHidden(false);
    clearTimeout(loadTimer);
    setStatus(data === 153 ? 'Error 153 · missing player referrer' : `YouTube error ${data}`, 'error', playerError(data));
  } else if (type === 'state') {
    const states = { 0: ['Ended', 'ready'], 1: ['Playing', 'playing'], 2: ['Paused', 'ready'], 3: ['Buffering…', 'loading'], 5: ['Press play in the video', 'ready'] };
    // An unstarted event must not erase a preceding 153 error.
    if (states[data] && (data === 1 || !playbackError)) {
      if (data === 1) playbackError = false;
      if ([0, 1, 2, 5].includes(data)) renderPlayback(data === 1);
      if (data === 1 && autoHideToolbar) { autoHideToolbar = false; setToolbarHidden(true); }
      clearTimeout(loadTimer);
      setStatus(...states[data]);
    }
  } else if (type === 'volume') renderAudio(data);
  else if (type === 'playback') renderProgress(data);
  else if (type === 'aspect') { aspectRatio = data; if (fitActive) fitWindow(); }
  else if (type === 'autoplay-blocked' && !playbackError) { renderPlayback(false); setStatus('Press play in the video', 'ready'); }
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
  aspectRatio = 16 / 9;
  duration = 0;
  seeking = false;
  renderPlayback(false);
  $('playback-toggle').hidden = false;
  $('playback-toggle').disabled = true;
  $('seek').hidden = true;
  $('seek').disabled = true;
  $('fit-button').disabled = false;
  playbackError = false;
  autoHideToolbar = true;
  setToolbarHidden(false);
  $('toolbar-toggle').hidden = false;
  $('volume-controls').hidden = true;
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
$('toolbar-toggle').addEventListener('click', () => {
  autoHideToolbar = false;
  setToolbarHidden(!$('video-form').hidden);
});
$('volume').addEventListener('input', event => {
  preferredVolume = Number(event.target.value);
  preferredMuted = preferredVolume === 0;
  renderAudio({ volume: preferredVolume, muted: preferredMuted });
  sendCommand('set-volume', preferredVolume);
});
$('mute-toggle').addEventListener('click', () => {
  const muted = audio.muted || audio.volume === 0;
  preferredMuted = !muted;
  if (muted && audio.volume === 0) {
    preferredVolume = lastAudibleVolume;
    sendCommand('set-volume', preferredVolume);
    renderAudio({ volume: preferredVolume, muted: false });
  } else renderAudio({ volume: audio.volume, muted: preferredMuted });
  sendCommand('set-muted', preferredMuted);
});
$('fit-button').addEventListener('click', () => { fitActive = true; fitWindow(); });
$('playback-toggle').addEventListener('click', () => {
  sendCommand(playing ? 'pause' : 'play');
  renderPlayback(!playing);
});
$('seek').addEventListener('pointerdown', () => { seeking = true; });
$('seek').addEventListener('pointercancel', () => { seeking = false; });
$('seek').addEventListener('pointerup', () => { seeking = false; });
$('seek').addEventListener('input', event => {
  seeking = true;
  const label = `${formatTime(Number(event.target.value) / 1000 * duration)} / ${formatTime(duration)}`;
  $('seek').setAttribute('aria-valuetext', label);
  $('seek').title = label;
});
$('seek').addEventListener('change', event => {
  if (duration > 0) sendCommand('seek', Number(event.target.value) / 1000 * duration);
  seeking = false;
});

function resize(width, height) {
  width = Math.max(360, Math.min(1200, Math.round(width)));
  height = Math.max($('video-form').hidden ? 222 : 266, Math.min(900, Math.round(height)));
  if (window.parent !== window) parent.postMessage({ pluginMessage: { type: 'resize', width, height } }, '*');
}
let drag;
const handle = $('resize-handle');
handle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  fitActive = false;
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
  fitActive = false;
  event.preventDefault();
  resize(innerWidth + offsets[event.key][0], innerHeight + offsets[event.key][1]);
});
