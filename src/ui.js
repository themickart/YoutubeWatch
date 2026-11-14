const $ = id => document.getElementById(id);
let player = null;
let currentVideo = null;
let attempt = 0;
let loadTimer;
let apiPromise;

function setStatus(text, state = 'idle', detail = text) {
  $('status').textContent = text;
  $('status').dataset.state = state;
  $('status').title = detail;
}

function loadAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(fail, 15000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      apiPromise = null;
      reject(new Error('Player status unavailable. Try reload.'));
    }
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return apiPromise;
}

function onPlayerEvent(type, data) {
  if (type === 'ready') {
    // Ready is a successful API handshake, not evidence that playback works.
    if ($('status').dataset.state === 'error') return;
    clearTimeout(loadTimer);
    setStatus('Press play in the video', 'ready');
  } else if (type === 'error') {
    clearTimeout(loadTimer);
    setStatus(data === 153 ? 'Error 153 · missing player referrer' : `YouTube error ${data}`, 'error', playerError(data));
  } else if (type === 'state') {
    const states = { 0: ['Ended', 'ready'], 1: ['Playing', 'playing'], 2: ['Paused', 'ready'], 3: ['Buffering…', 'loading'], 5: ['Press play in the video', 'ready'] };
    // An unstarted event must not erase a preceding 153 error.
    if (states[data] && (data === 1 || $('status').dataset.state !== 'error')) {
      clearTimeout(loadTimer);
      setStatus(...states[data]);
    }
  } else if (type === 'autoplay-blocked') setStatus('Press play in the video', 'ready');
}

async function loadVideo(input) {
  let video;
  try { video = parseVideo(input); }
  catch (error) {
    setStatus(error.message, 'error');
    $('video-url').setAttribute('aria-invalid', 'true');
    $('video-url').focus();
    return;
  }
  $('video-url').removeAttribute('aria-invalid');
  const token = ++attempt;
  clearTimeout(loadTimer);
  if (player) { player.destroy(); player = null; }
  currentVideo = video;
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
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = embedUrl(video, window.location.origin);
  $('player-host').replaceChildren(frame);
  loadTimer = setTimeout(() => {
    if (token === attempt) setStatus('Player did not respond · try reload', 'error');
  }, 20000);
  try {
    await loadAPI();
    if (token !== attempt) return;
    player = new YT.Player(frame, {
      events: {
        onReady: () => { if (token === attempt) onPlayerEvent('ready'); },
        onStateChange: event => { if (token === attempt) onPlayerEvent('state', event.data); },
        onError: event => { if (token === attempt) onPlayerEvent('error', event.data); },
        onAutoplayBlocked: () => { if (token === attempt) onPlayerEvent('autoplay-blocked'); }
      }
    });
  } catch (error) {
    if (token !== attempt) return;
    clearTimeout(loadTimer);
    setStatus(error.message, 'error');
  }
}

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
