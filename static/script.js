/**
 * script.js — SARAS Robot Control (Deployment Edition)
 * ======================================================
 * Changes from original:
 *  ✅ sendCommand() → Web Serial (ArduinoSerial) + SocketIO log
 *  ✅ startCamera() / stopCamera() → BrowserCamera (getUserMedia)
 *  ✅ toggleFaceDetection() → BrowserCamera.startFollow/stopFollow
 *  ✅ Smart Track → BrowserCamera.registerFace + startSmartTrack
 *  ✅ Snapshot → taken from <video> element, download in browser
 *  ✅ Arduino connect panel wired up
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CAMERA — uses BrowserCamera (getUserMedia), NOT server MJPEG
// ══════════════════════════════════════════════════════════════════════════════

let _cameraOn = false;

function startCamera() {
  if (_cameraOn) return;

  const video    = document.getElementById('cameraFeed');
  const canvas   = document.getElementById('camCanvas');
  const offline  = document.getElementById('cameraOffline');
  const hud      = document.getElementById('cameraHud');
  const badge    = document.getElementById('cameraBadge');
  const btnSnap  = document.getElementById('btnSnapshot');

  if (!video || !window.BrowserCamera) return;

  if (offline) {
    offline.style.display = 'flex';
    const p = offline.querySelector('p');
    if (p) p.textContent = 'Camera starting...';
  }
  if (badge) { badge.textContent = '⏳ STARTING'; badge.className = 'panel-badge warning'; }

  window.BrowserCamera.start(video, canvas).then(ok => {
    if (ok) {
      _cameraOn = true;
      video.style.display  = 'block';
      video.style.opacity  = '1';
      if (offline) offline.style.display = 'none';
      if (hud)     hud.style.display     = 'block';
      if (badge)   { badge.textContent   = '● LIVE'; badge.className = 'panel-badge active'; }
      if (btnSnap) btnSnap.disabled      = false;
      const camSection = document.querySelector('.camera-panel');
      if (camSection) camSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      if (offline) {
        offline.style.display = 'flex';
        const p = offline.querySelector('p');
        const s = offline.querySelector('small');
        if (p) p.textContent = 'Camera Error';
        if (s) s.textContent = 'Check browser permissions for camera';
      }
      if (badge) { badge.textContent = 'ERROR'; badge.className = 'panel-badge danger'; }
    }
  });

  if (typeof broadcastAction === 'function') broadcastAction('camera_toggle', { active: true });
}

function stopCamera() {
  if (window.BrowserCamera) window.BrowserCamera.stop();

  const video   = document.getElementById('cameraFeed');
  const canvas  = document.getElementById('camCanvas');
  const offline = document.getElementById('cameraOffline');
  const hud     = document.getElementById('cameraHud');
  const badge   = document.getElementById('cameraBadge');
  const btnSnap = document.getElementById('btnSnapshot');

  if (video)   { video.style.display = 'none'; video.style.opacity = '0'; }
  if (canvas)  canvas.style.display  = 'none';
  if (offline) offline.style.display = 'flex';
  if (hud)     hud.style.display     = 'none';
  if (badge)   { badge.textContent   = 'OFF'; badge.className = 'panel-badge'; }
  if (btnSnap) btnSnap.disabled      = true;

  _cameraOn = false;
  if (typeof broadcastAction === 'function') broadcastAction('camera_toggle', { active: false });
}


// ══════════════════════════════════════════════════════════════════════════════
// BROWSER TEXT-TO-SPEECH
// ══════════════════════════════════════════════════════════════════════════════

window.speechSynthesis.onvoiceschanged = () => {
  console.log('[TTS] Voices ready:', window.speechSynthesis.getVoices().length);
};

function speakOnPhone(text) {
  window.speechSynthesis.cancel();
  if (!('speechSynthesis' in window)) return;
  const utterance  = new SpeechSynthesisUtterance(text);
  utterance.rate   = 0.88;
  utterance.pitch  = 0.75;
  utterance.volume = 1.0;
  const voices     = window.speechSynthesis.getVoices();
  const engVoice   = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
                  || voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (engVoice) utterance.voice = engVoice;
  utterance.onstart = () => { startRobotTalking(); };
  utterance.onend   = () => { stopRobotTalking();  };
  utterance.onerror = () => { stopRobotTalking();  };
  window.speechSynthesis.speak(utterance);
}


// ══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION
// ══════════════════════════════════════════════════════════════════════════════

const socket = io();
window._sarasSocket = socket;   // expose for webserial.js to use

socket.on('connect', () => {
  console.log('[WS] Connected');
  updateConnectionStatus(true);
});

socket.on('disconnect', () => {
  console.log('[WS] Disconnected');
  updateConnectionStatus(false);
});

socket.on('state_update', (state) => {
  updateRobotStateUI(state);
});

socket.on('command_logged', (entry) => {
  appendLogEntry(entry);
});

socket.on('log_history', (log) => {
  log.forEach(e => appendLogEntry(e));
});

socket.on('uptime', ({ seconds }) => {
  const el = document.getElementById('uptimeDisplay');
  if (el) el.textContent = formatUptime(seconds);
});

socket.on('robot_speaking', ({ text, active }) => {
  if (active) {
    speakOnPhone(text);
    showIntroOverlay(text);
  } else {
    hideIntroOverlay();
  }
});

socket.on('face_detected', (face) => {
  showFaceOnRadar(face);
});

socket.on('face_lost', () => {
  clearFaceFromRadar();
});

socket.on('face_status', ({ active }) => {
  const badge = document.getElementById('faceBadge');
  if (badge) {
    badge.textContent = active ? 'TRACKING' : 'STANDBY';
    badge.className   = active ? 'panel-badge active' : 'panel-badge';
  }
  const btn = document.getElementById('btnFaceDetect');
  if (btn) {
    btn.innerHTML = active
      ? '<span class="btn-icon">◎</span> STOP TRACKING'
      : '<span class="btn-icon">◉</span> FOLLOW PERSON';
  }
  if (active) startRadarSweep(); else stopRadarSweep();
});

socket.on('obstacle_detected', () => { triggerObstacleAlert(); });
socket.on('obstacle_cleared',  () => { clearObstacleAlert(); });


// ── Helpers ──────────────────────────────────────────────────────────────────

function updateConnectionStatus(online) {
  const chip = document.getElementById('connectionStatus');
  if (chip) {
    chip.className = 'tb-pill' + (online ? ' online' : '');
    const dot = chip.querySelector('.tb-dot');
    if (dot) dot.className = 'tb-dot' + (online ? ' active' : '');
    chip.childNodes.forEach(n => {
      if (n.nodeType === 3) n.textContent = online ? 'ONLINE' : 'OFFLINE';
    });
  }
  const hfDot    = document.getElementById('hfDot');
  const hfStatus = document.getElementById('hfStatus');
  if (hfDot)    hfDot.className      = 'hf-dot' + (online ? ' online' : '');
  if (hfStatus) hfStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
}


// ══════════════════════════════════════════════════════════════════════════════
// SEND COMMAND — Web Serial + SocketIO log
// ══════════════════════════════════════════════════════════════════════════════

function sendCommand(cmd, source = 'Manual') {
  if (_smartTrackActive && ['Keyboard','Manual','Voice','Gamepad'].includes(source)) {
    pauseSmartTrack(cmd, source);
    return;
  }

  // ── 1. Send to Arduino via Web Serial (if connected) ─────────────────────
  if (window.ArduinoSerial) {
    window.ArduinoSerial.sendCmd(cmd);
  }

  // ── 2. Log to server via SocketIO (for command log + state sync) ──────────
  socket.emit('browser_command', { cmd, source });

  // ── 3. Animate UI ─────────────────────────────────────────────────────────
  animateMovement(cmd);
}

// ── Smart Track Pause (manual override) ──────────────────────────────────────
let _pauseTimer = null;

function pauseSmartTrack(cmd, source) {
  const badge = document.getElementById('smartTrackBadge');
  if (badge) { badge.textContent = '⚡ MANUAL'; badge.className = 'panel-badge warning'; }
  trackLog(`⚡ Manual override: ${source} → ${cmd}`, 'scanning');

  if (window.ArduinoSerial) window.ArduinoSerial.sendCmd(cmd);
  socket.emit('browser_command', { cmd, source });
  animateMovement(cmd);

  if (_pauseTimer) clearTimeout(_pauseTimer);
  _pauseTimer = setTimeout(() => {
    if (_smartTrackActive) {
      const badge = document.getElementById('smartTrackBadge');
      if (badge) { badge.textContent = 'TRACKING'; badge.className = 'panel-badge active'; }
      trackLog('🎯 Resuming smart tracking...', 'found');
    }
  }, 2000);
}

async function sendCommandREST(cmd, source = 'API') {
  try {
    await fetch('/api/command', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cmd, source }),
    });
    animateMovement(cmd);
  } catch (err) {
    console.error('[API] Command failed:', err);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// "KNOW ME" — ROBOT INTRODUCTION
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnKnowMe')?.addEventListener('click', async () => {
  const intro =
    "Hello! I am SARAS, an AI powered robot. " +
    "I can move using voice commands, keyboard control, or a game controller. " +
    "I can detect obstacles and avoid them automatically. " +
    "I can also detect and follow a human face using my camera.";
  showIntroOverlay(intro);
  speakOnPhone(intro);
});


// ══════════════════════════════════════════════════════════════════════════════
// KEYBOARD CONTROL
// ══════════════════════════════════════════════════════════════════════════════

const KEY_CMD_MAP = {
  'w': 'F', 'ArrowUp':    'F',
  's': 'B', 'ArrowDown':  'B',
  'a': 'L', 'ArrowLeft':  'L',
  'd': 'R', 'ArrowRight': 'R',
  ' ': 'S',
};

const _heldKeys = new Set();

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const cmd = KEY_CMD_MAP[e.key];
  if (cmd && !_heldKeys.has(e.key)) {
    _heldKeys.add(e.key);
    sendCommand(cmd, 'Keyboard');
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (_heldKeys.has(e.key)) {
    _heldKeys.delete(e.key);
    const cmd = KEY_CMD_MAP[e.key];
    if (cmd && cmd !== 'S') sendCommand('S', 'Keyboard');
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// D-PAD (ON-SCREEN BUTTONS)
// ══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.dpad-btn').forEach(btn => {
  const cmd = btn.dataset.cmd;
  if (!cmd) return;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sendCommand(cmd, 'Manual');
    btn.classList.add('pressed');
  });
  btn.addEventListener('pointerup',    () => { btn.classList.remove('pressed'); if (cmd !== 'S') sendCommand('S', 'Manual'); });
  btn.addEventListener('pointerleave', () => {
    if (btn.classList.contains('pressed')) {
      btn.classList.remove('pressed');
      if (cmd !== 'S') sendCommand('S', 'Manual');
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// VOICE CONTROL
// ══════════════════════════════════════════════════════════════════════════════

let _recognition   = null;
let _micActive     = false;
let _audioCtx      = null;
let _analyserNode  = null;
let _micStream     = null;

function buildSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec          = new SpeechRecognition();
  rec.continuous     = true;
  rec.lang           = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}

async function startMicListening() {
  if (_micActive) { stopMicListening(); return; }
  _micActive = true;
  document.getElementById('btnMic')?.classList.add('active');
  const label = document.getElementById('waveformLabel');

  try {
    _micStream    = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioCtx     = new AudioContext();
    const src     = _audioCtx.createMediaStreamSource(_micStream);
    _analyserNode = _audioCtx.createAnalyser();
    _analyserNode.fftSize = 128;
    src.connect(_analyserNode);
    startWaveformAnimation(_analyserNode);
  } catch {
    startWaveformAnimation(null);
  }

  _recognition = buildSpeechRecognition();
  if (!_recognition) {
    if (label) label.textContent = 'SPEECH API NOT SUPPORTED';
    setTimeout(stopMicListening, 2000);
    return;
  }
  if (label) label.textContent = 'LISTENING...';

  let _lastProcessed = '';
  _recognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    const text   = result[0].transcript.trim();
    if (!text) return;
    document.getElementById('recognizedText').textContent = text;
    if (result.isFinal && text !== _lastProcessed) {
      _lastProcessed = text;
      await processVoiceText(text);
      setTimeout(() => { _lastProcessed = ''; }, 1500);
    }
  };
  _recognition.onerror = (err) => {
    if (err.error === 'not-allowed') stopMicListening();
    if (err.error === 'no-speech' || err.error === 'network') {
      if (_micActive) setTimeout(() => { if (_micActive && _recognition) try { _recognition.start(); } catch {} }, 300);
    }
  };
  _recognition.onend = () => {
    if (_micActive) setTimeout(() => { if (_micActive) try { _recognition.start(); } catch {} }, 200);
  };
  try { _recognition.start(); } catch (e) { console.warn('[Speech]', e); }
}

function stopMicListening() {
  _micActive = false;
  document.getElementById('btnMic')?.classList.remove('active');
  if (_recognition) { try { _recognition.stop(); } catch {} _recognition = null; }
  if (_micStream)   { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
  if (_audioCtx)    { _audioCtx.close(); _audioCtx = null; }
  stopWaveformAnimation();
}

async function processVoiceText(text) {
  const lower = text.toLowerCase().trim();
  const recEl = document.getElementById('recognizedText');
  if (recEl) recEl.textContent = text;

  if (lower.includes('register') || lower.includes('remember me')) {
    document.getElementById('btnRegisterTarget')?.click();
    speakOnPhone('Registering you as target person');
    return;
  }
  if (lower.includes('start camera') || lower.includes('open camera')) {
    if (!_cameraOn) startCamera();
    speakOnPhone('Camera starting');
    return;
  }

  // Get intent from server (or local fallback)
  let intent = { type: 'chat' };
  try {
    const res = await fetch('/api/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    intent = await res.json();
  } catch {
    if (lower.includes('forward') || lower.includes('aage'))   intent = { type:'command', command:'F' };
    else if (lower.includes('back') || lower.includes('peeche')) intent = { type:'command', command:'B' };
    else if (lower.includes('left') || lower.includes('baaye'))  intent = { type:'command', command:'L' };
    else if (lower.includes('right') || lower.includes('daaye')) intent = { type:'command', command:'R' };
    else if (lower.includes('stop') || lower.includes('ruko'))   intent = { type:'command', command:'S' };
    else if (lower.includes('follow'))  intent = { type:'follow' };
    else if (lower.includes('track'))   intent = { type:'track' };
  }

  switch (intent.type) {
    case 'command': {
      const dirs = { F:'Moving Forward', B:'Moving Backward', L:'Turning Left', R:'Turning Right', S:'Stopped' };
      sendCommand(intent.command, 'Voice');
      animateMovement(intent.command);
      appendChatMessage('user', text);
      appendChatMessage('assistant', dirs[intent.command] || 'Command executed.');
      speakOnPhone(dirs[intent.command] || 'Done');
      break;
    }
    case 'follow':
      if (!_faceDetectionActive) toggleFaceDetection();
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Following person now.');
      speakOnPhone('Following person');
      break;
    case 'track':
      if (!_smartTrackActive) document.getElementById('btnSmartTrack')?.click();
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Smart tracking activated.');
      speakOnPhone('Smart tracking activated');
      break;
    default:
      await sendToChat(text, 'voice');
  }
  broadcastAction('voice_text', { text });
}

document.getElementById('btnMic')?.addEventListener('click', () => startMicListening());

const _PRESET_CMD_MAP = {
  'go forward':'F','forward':'F','move forward':'F',
  'go backward':'B','backward':'B','move backward':'B','back':'B',
  'turn left':'L','left':'L','go left':'L',
  'turn right':'R','right':'R','go right':'R',
  'stop':'S','halt':'S','freeze':'S',
  'aage chalo':'F','aage jao':'F','aage':'F','seedha chalo':'F',
  'peeche chalo':'B','peeche jao':'B','peeche':'B',
  'left mudo':'L','left karo':'L','baaye':'L',
  'right mudo':'R','right karo':'R','daaye':'R',
  'ruko':'S','band karo':'S','rukjao':'S',
  'आगे':'F','आगे चलो':'F','आगे जाओ':'F',
  'पीछे':'B','पीछे चलो':'B',
  'बाएं':'L','लेफ्ट':'L',
  'दाएं':'R','राइट':'R',
  'रुको':'S','बंद करो':'S',
};

document.querySelectorAll('.qv-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text  = btn.dataset.text;
    const lower = text.toLowerCase().trim();
    const recEl = document.getElementById('recognizedText');
    if (recEl) recEl.textContent = text;
    const cmd = _PRESET_CMD_MAP[lower];
    if (cmd) {
      sendCommand(cmd, 'Voice');
      animateMovement(cmd);
      speakOnPhone(text);
      broadcastAction('voice_text', { text });
      return;
    }
    await processVoiceText(text);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// SARAS CHATBOT
// ══════════════════════════════════════════════════════════════════════════════

async function sendToChat(text, source = 'text') {
  if (!text.trim()) return;
  _lastChatSource = source;

  // Intent check first
  try {
    const intentRes = await fetch('/api/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const intent = await intentRes.json();
    const dirs = { F:'Forward', B:'Backward', L:'Left', R:'Right', S:'Stopped' };
    if (intent.type === 'command') {
      sendCommand(intent.command, 'Chat');
      animateMovement(intent.command);
      appendChatMessage('user', text);
      appendChatMessage('assistant', `Moving ${dirs[intent.command] || intent.command}.`);
      return;
    }
    if (intent.type === 'follow') {
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Following person now.');
      if (!_faceDetectionActive) toggleFaceDetection();
      return;
    }
    if (intent.type === 'track') {
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Smart tracking activated.');
      if (!_smartTrackActive) document.getElementById('btnSmartTrack')?.click();
      return;
    }
  } catch { /* offline — fall through */ }

  appendChatMessage('user', text);
  const typingEl = showChatTyping();

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    removeTypingIndicator(typingEl);
    if (!data.success) {
      appendChatMessage('assistant', data.response || 'Sorry, could not respond.');
    }
    // If intent from chat api contains command, execute it
    if (data.intent && data.intent.type === 'command') {
      sendCommand(data.intent.command, 'Chat');
      animateMovement(data.intent.command);
    }
  } catch {
    removeTypingIndicator(typingEl);
    appendChatMessage('assistant', 'Chatbot offline. Check server connection.');
  }
}

function appendChatMessage(role, text) {
  const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

  const heroLog = document.getElementById('cwMessages');
  if (heroLog) {
    const el = document.createElement('div');
    el.className = `cw-msg ${role}`;
    if (role === 'assistant') {
      el.innerHTML = `<div class="cw-avatar">🪷</div><div class="cw-bubble-wrap"><div class="cw-bubble">${escapeHtml(text)}</div><div class="cw-time">${time}</div></div>`;
    } else {
      el.innerHTML = `<div class="cw-bubble-wrap"><div class="cw-bubble">${escapeHtml(text)}</div><div class="cw-time">${time}</div></div>`;
    }
    heroLog.appendChild(el);
    heroLog.scrollTop = heroLog.scrollHeight;
  }

  const ctrlLog = document.getElementById('chatLog');
  if (ctrlLog) {
    const empty = ctrlLog.querySelector('.chat-empty');
    if (empty) empty.remove();
    const el = document.createElement('div');
    el.className = `chat-msg chat-${role}`;
    el.innerHTML = `<span class="chat-bubble">${escapeHtml(text)}</span><span class="chat-time">${time}</span>`;
    ctrlLog.appendChild(el);
    ctrlLog.scrollTop = ctrlLog.scrollHeight;
  }
}

function showChatTyping() {
  const dots = '<span class="cw-dot"></span><span class="cw-dot"></span><span class="cw-dot"></span>';
  const heroLog = document.getElementById('cwMessages');
  let heroEl = null;
  if (heroLog) {
    heroEl = document.createElement('div');
    heroEl.className = 'cw-msg assistant typing';
    heroEl.innerHTML = `<div class="cw-avatar">🪷</div><div class="cw-bubble-wrap"><div class="cw-bubble">${dots}</div></div>`;
    heroLog.appendChild(heroEl);
    heroLog.scrollTop = heroLog.scrollHeight;
  }
  const ctrlLog = document.getElementById('chatLog');
  let ctrlEl = null;
  if (ctrlLog) {
    ctrlEl = document.createElement('div');
    ctrlEl.className = 'chat-msg chat-assistant chat-typing';
    ctrlEl.innerHTML = `<span class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
    ctrlLog.appendChild(ctrlEl);
    ctrlLog.scrollTop = ctrlLog.scrollHeight;
  }
  return { heroEl, ctrlEl };
}

function removeTypingIndicator(els) {
  if (!els) return;
  if (els.heroEl?.parentNode) els.heroEl.parentNode.removeChild(els.heroEl);
  if (els.ctrlEl?.parentNode) els.ctrlEl.parentNode.removeChild(els.ctrlEl);
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Hero composer
document.getElementById('cwSend')?.addEventListener('click', () => {
  const input = document.getElementById('cwInput');
  if (!input) return;
  const text = input.value.trim();
  if (text) { input.value = ''; sendToChat(text, 'text'); }
});
document.getElementById('cwInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('cwSend')?.click(); }
});

// Chat mic
let _chatMicActive = false;
let _lastChatSource = 'text';
let _chatRecognition = null;

document.getElementById('cwMic')?.addEventListener('click', () => {
  if (_chatMicActive) stopChatMic(); else startChatMic();
});

function startChatMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Speech API not supported.'); return; }
  _chatMicActive = true;
  document.getElementById('cwMic')?.classList.add('active');
  _chatRecognition = new SpeechRecognition();
  _chatRecognition.lang = 'hi-IN';
  _chatRecognition.continuous = false;
  _chatRecognition.interimResults = true;
  _chatRecognition.maxAlternatives = 1;
  _chatRecognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    const text   = result[0].transcript.trim();
    if (!text) return;
    document.getElementById('cwInput').value = text;
    if (result.isFinal) {
      stopChatMic();
      _lastChatSource = 'voice';
      await sendToChat(text, 'voice');
      document.getElementById('cwInput').value = '';
    }
  };
  _chatRecognition.onerror = () => stopChatMic();
  _chatRecognition.onend   = () => stopChatMic();
  _chatRecognition.start();
}

function stopChatMic() {
  _chatMicActive = false;
  document.getElementById('cwMic')?.classList.remove('active');
  if (_chatRecognition) { try { _chatRecognition.stop(); } catch {} _chatRecognition = null; }
}

// Hero chips
document.querySelectorAll('.cw-chip').forEach(chip => {
  chip.addEventListener('click', async () => {
    const cmd = chip.dataset.cmd;
    if (cmd) {
      document.getElementById('cwInput').value = cmd;
      document.getElementById('cwSend')?.click();
    }
  });
});

// Controls panel chat
document.getElementById('btnChatSend')?.addEventListener('click', () => {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (text) { input.value = ''; sendToChat(text, 'text'); }
});
document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btnChatSend')?.click(); }
});

document.getElementById('btnChatClear')?.addEventListener('click', async () => {
  const ctrlLog = document.getElementById('chatLog');
  if (ctrlLog) ctrlLog.innerHTML = '<div class="chat-empty">Conversation cleared.</div>';
  const heroLog = document.getElementById('cwMessages');
  if (heroLog) { heroLog.innerHTML = ''; showWelcomeMessage(); }
  try { await fetch('/api/chat/clear', { method: 'POST' }); } catch {}
});

socket.on('chat_message', ({ role, text, speak }) => {
  if (role === 'assistant') {
    appendChatMessage(role, text);
    if (speak) speakOnPhone(text);
  }
});

function showWelcomeMessage() {
  const heroLog = document.getElementById('cwMessages');
  if (!heroLog) return;
  const el = document.createElement('div');
  el.className = 'cw-msg assistant';
  el.innerHTML = `
    <div class="cw-avatar">🪷</div>
    <div class="cw-bubble-wrap">
      <div class="cw-bubble">
        Namaste! I am <strong>SARAS</strong> — your AI-powered robot.<br><br>
        Talk to me, ask questions, or give commands like <em>"aage chalo"</em> or <em>"follow me"</em>.<br>
        I understand <strong>50+ languages</strong>. 🪷
      </div>
      <div class="cw-time">Just now</div>
    </div>`;
  heroLog.appendChild(el);
}
document.addEventListener('DOMContentLoaded', showWelcomeMessage);


// ══════════════════════════════════════════════════════════════════════════════
// GAMEPAD API
// ══════════════════════════════════════════════════════════════════════════════

let _gamepadIndex   = null;
let _gamepadLoop    = null;
let _lastGamepadCmd = null;
const AXIS_THRESHOLD = 0.35;

window.addEventListener('gamepadconnected', (e) => {
  _gamepadIndex = e.gamepad.index;
  const badge = document.getElementById('gamepadBadge');
  if (badge) { badge.textContent = `PAD ${_gamepadIndex} CONNECTED`; badge.className = 'panel-badge active'; }
  const physDot   = document.getElementById('vgpPhysDot');
  const physLabel = document.getElementById('vgpPhysLabel');
  const physPanel = document.getElementById('vgpPhysPanel');
  if (physDot)   physDot.classList.add('vgp-connected');
  if (physLabel) physLabel.textContent = `PAD ${e.gamepad.index}: ${e.gamepad.id.slice(0, 20)}`;
  if (physPanel) physPanel.classList.add('vgp-visible');
  startGamepadLoop();
});

window.addEventListener('gamepaddisconnected', () => {
  _gamepadIndex = null;
  const badge = document.getElementById('gamepadBadge');
  if (badge) { badge.textContent = 'VIRTUAL MODE'; badge.className = 'panel-badge'; }
  const physDot   = document.getElementById('vgpPhysDot');
  const physLabel = document.getElementById('vgpPhysLabel');
  const physPanel = document.getElementById('vgpPhysPanel');
  if (physDot)   physDot.classList.remove('vgp-connected');
  if (physLabel) physLabel.textContent = 'No physical pad';
  if (physPanel) physPanel.classList.remove('vgp-visible');
  stopGamepadLoop();
  resetJoystick?.();
});

function startGamepadLoop() {
  stopGamepadLoop();
  function loop() { _gamepadLoop = requestAnimationFrame(loop); pollGamepad(); }
  loop();
}
function stopGamepadLoop() {
  if (_gamepadLoop) { cancelAnimationFrame(_gamepadLoop); _gamepadLoop = null; }
}

function pollGamepad() {
  if (_gamepadIndex === null) return;
  const gp = (navigator.getGamepads ? navigator.getGamepads() : [])[_gamepadIndex];
  if (!gp) return;
  const axisX = gp.axes[0] || 0;
  const axisY = gp.axes[1] || 0;
  animateJoystick(axisX, axisY);

  let cmd = null;
  if (axisY < -AXIS_THRESHOLD) cmd = 'F';
  else if (axisY > AXIS_THRESHOLD) cmd = 'B';
  else if (axisX < -AXIS_THRESHOLD) cmd = 'L';
  else if (axisX > AXIS_THRESHOLD) cmd = 'R';
  if (gp.buttons[12]?.pressed) cmd = 'F';
  if (gp.buttons[13]?.pressed) cmd = 'B';
  if (gp.buttons[14]?.pressed) cmd = 'L';
  if (gp.buttons[15]?.pressed) cmd = 'R';
  if ([0,1,2,3].some(i => gp.buttons[i]?.pressed)) cmd = 'S';

  if (cmd !== _lastGamepadCmd) {
    _lastGamepadCmd = cmd;
    sendCommand(cmd || 'S', 'Gamepad');
    const pressedNames = gp.buttons.map((b, i) => b.pressed ? i : null).filter(i => i !== null).join(', ');
    const gpBtns = document.getElementById('gpButtons');
    if (gpBtns) gpBtns.textContent = pressedNames || '—';
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// FACE DETECTION — now uses BrowserCamera (no server calls)
// ══════════════════════════════════════════════════════════════════════════════

let _faceDetectionActive = false;

async function toggleFaceDetection() {
  _faceDetectionActive = !_faceDetectionActive;

  if (_faceDetectionActive) {
    // Start camera if not running
    if (!_cameraOn) {
      startCamera();
      await new Promise(r => setTimeout(r, 1500));
    }
    // Start browser face detection
    window.BrowserCamera?.startFollow();
    socket.emit('face_status_update', { active: true });
  } else {
    window.BrowserCamera?.stopFollow();
    socket.emit('face_status_update', { active: false });
    clearFaceFromRadar();
  }
  updateFaceUI(_faceDetectionActive);
  broadcastAction('face_toggle', { active: _faceDetectionActive });
}

function updateFaceUI(active) {
  const badge = document.getElementById('faceBadge');
  const btn   = document.getElementById('btnFaceDetect');
  const faceStatus = document.getElementById('faceStatus');
  if (active) {
    if (badge) { badge.textContent = 'TRACKING'; badge.className = 'panel-badge active'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">◎</span> STOP TRACKING';
    if (faceStatus) faceStatus.textContent = 'ON';
    startRadarSweep();
  } else {
    if (badge) { badge.textContent = 'STANDBY'; badge.className = 'panel-badge'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">◉</span> FOLLOW PERSON';
    if (faceStatus) faceStatus.textContent = 'OFF';
    stopRadarSweep();
    clearFaceFromRadar();
    const faceOffset = document.getElementById('faceOffset');
    if (faceOffset) faceOffset.textContent = '—';
  }
}

document.getElementById('btnFaceDetect')?.addEventListener('click', toggleFaceDetection);

// Wire BrowserCamera callbacks to radar UI
if (window.BrowserCamera) {
  window.BrowserCamera.onFaceDetected((face) => {
    showFaceOnRadar(face);
    const faceOffset = document.getElementById('faceOffset');
    if (faceOffset && face.width) {
      const videoW = 640;
      const offset = Math.round((face.x + face.width / 2) - videoW / 2);
      faceOffset.textContent = (offset > 0 ? '+' : '') + offset;
    }
    const hudFaceCount = document.getElementById('hudFaceCount');
    if (hudFaceCount && face.count) hudFaceCount.textContent = `${face.count} FACE${face.count > 1 ? 'S' : ''}`;
  });

  window.BrowserCamera.onFaceLost(() => {
    clearFaceFromRadar();
    const hudFaceCount = document.getElementById('hudFaceCount');
    if (hudFaceCount) hudFaceCount.textContent = '';
  });

  window.BrowserCamera.onTrackCmd((cmd, box) => {
    // Update servo visual
    const videoW = 640;
    const center = box.x + box.width / 2;
    const ratio  = center / videoW;
    const angle  = Math.round(ratio * 180);
    updateServoUI(angle);

    const trackAction = document.getElementById('trackAction');
    const cmds = { J: 'PAN LEFT', C: 'CENTER', K: 'PAN RIGHT' };
    if (trackAction) trackAction.textContent = cmds[cmd] || cmd;
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// ARDUINO CONNECT BUTTON
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnArduinoConnect')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnArduinoConnect');
  if (!window.ArduinoSerial) return;

  if (window.ArduinoSerial.isConnected()) {
    await window.ArduinoSerial.disconnect();
    if (btn) btn.textContent = '🔌 CONNECT ARDUINO';
  } else {
    if (btn) { btn.textContent = '⏳ CONNECTING...'; btn.disabled = true; }
    const ok = await window.ArduinoSerial.connect();
    if (btn) {
      btn.textContent = ok ? '🔴 DISCONNECT ARDUINO' : '🔌 CONNECT ARDUINO';
      btn.disabled = false;
    }
    if (ok) {
      const arduinoMode = document.getElementById('arduinoMode');
      if (arduinoMode) arduinoMode.textContent = 'REAL';
    }
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// CAMERA TOGGLE BUTTON
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnCameraToggle')?.addEventListener('click', () => {
  if (_cameraOn) {
    stopCamera();
    if (_faceDetectionActive) {
      _faceDetectionActive = false;
      updateFaceUI(false);
    }
    if (_smartTrackActive) {
      _smartTrackActive = false;
      window.BrowserCamera?.stopSmartTrack();
    }
  } else {
    startCamera();
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// SNAPSHOT — captures from video element, downloads in browser
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnSnapshot')?.addEventListener('click', () => {
  if (!window.BrowserCamera) return;
  const dataUrl = window.BrowserCamera.takeSnapshot();
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = `saras_snapshot_${Date.now()}.jpg`;
  a.click();
});


// ══════════════════════════════════════════════════════════════════════════════
// SMART TRACKING — browser face recognition (face-api.js)
// ══════════════════════════════════════════════════════════════════════════════

let _smartTrackActive = false;

// Register Target button
document.getElementById('btnRegisterTarget')?.addEventListener('click', async () => {
  const row = document.getElementById('registerNameRow');
  if (row) row.style.display = 'flex';
  // Ensure camera is on
  if (!_cameraOn) {
    startCamera();
    await new Promise(r => setTimeout(r, 1500));
  }
});

// Save face with name
document.getElementById('btnFaceNameConfirm')?.addEventListener('click', async () => {
  const nameInput = document.getElementById('faceNameInput');
  const name = nameInput?.value.trim();
  if (!name) { alert('Please enter a name.'); return; }

  const row = document.getElementById('registerNameRow');
  if (row) row.style.display = 'none';
  if (nameInput) nameInput.value = '';

  trackLog(`⏳ Registering '${name}'...`, 'scanning');

  const ok = await window.BrowserCamera?.registerFace(name);
  if (ok) {
    document.getElementById('targetStatus').textContent = `${name} ✓`;
    document.getElementById('btnSmartTrack').disabled = false;
    trackLog(`✓ '${name}' registered! Click START TRACKING.`, 'found');
    socket.emit('target_registered', { success: true, name });
    refreshSavedFacesList();
    speakOnPhone(`${name} registered as tracking target`);
  } else {
    trackLog('⚠ No face detected. Make sure camera is on and face is visible.', 'bypass');
    document.getElementById('btnRegisterTarget')?.click();
  }
});

document.getElementById('btnFaceNameCancel')?.addEventListener('click', () => {
  const row = document.getElementById('registerNameRow');
  if (row) row.style.display = 'none';
  document.getElementById('faceNameInput').value = '';
});

// Smart track toggle
document.getElementById('btnSmartTrack')?.addEventListener('click', async () => {
  if (!window.BrowserCamera?.hasTarget() && !_smartTrackActive) {
    trackLog('⚠ No target registered. Click REGISTER TARGET first.', 'bypass');
    return;
  }

  _smartTrackActive = !_smartTrackActive;
  const badge = document.getElementById('smartTrackBadge');
  const btn   = document.getElementById('btnSmartTrack');

  if (_smartTrackActive) {
    if (!_cameraOn) {
      startCamera();
      await new Promise(r => setTimeout(r, 1500));
    }
    window.BrowserCamera?.startSmartTrack();
    if (badge) { badge.textContent = 'TRACKING'; badge.className = 'panel-badge active'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">⏹</span> STOP TRACKING';
    socket.emit('face_status_update', { active: true });
    trackLog('🎯 Smart tracking started!', 'found');
    startRadarSweep();
  } else {
    window.BrowserCamera?.stopSmartTrack();
    if (badge) { badge.textContent = 'STANDBY'; badge.className = 'panel-badge'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">🎯</span> START TRACKING';
    socket.emit('face_status_update', { active: false });
    trackLog('⏹ Tracking stopped.', 'scanning');
    stopRadarSweep();
  }
});

// Refresh saved faces list (session only — no server persistence)
function refreshSavedFacesList() {
  const list = document.getElementById('savedFacesList');
  if (!list || !window.BrowserCamera) return;

  const faces = window.BrowserCamera.getSavedFaces();
  if (faces.length === 0) {
    list.innerHTML = '<span class="sf-empty">No faces registered yet.</span>';
    return;
  }

  list.innerHTML = '';
  faces.forEach(name => {
    const item = document.createElement('div');
    item.className = 'sf-item';
    item.innerHTML = `
      <span class="sf-name">👤 ${escapeHtml(name)}</span>
      <button class="btn btn-sm btn-ghost sf-load-btn" data-name="${escapeHtml(name)}">LOAD</button>`;
    list.appendChild(item);
  });

  list.querySelectorAll('.sf-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const faceName = btn.dataset.name;
      const ok = window.BrowserCamera.loadFace(faceName);
      if (ok) {
        document.getElementById('targetStatus').textContent = `${faceName} ✓`;
        document.getElementById('btnSmartTrack').disabled = false;
        trackLog(`✓ Loaded '${faceName}' as target.`, 'found');
      }
    });
  });
}

document.getElementById('btnRefreshFaces')?.addEventListener('click', refreshSavedFacesList);

// Servo UI helper
function updateServoUI(angle) {
  const pct = ((angle || 90) / 180) * 100;
  const indicator = document.getElementById('servoIndicator');
  if (indicator) indicator.style.left = `${pct}%`;
  const angleEl = document.getElementById('servoAngle');
  const angleDisplay = document.getElementById('servoAngleDisplay');
  if (angleEl)     angleEl.textContent     = `${angle}°`;
  if (angleDisplay) angleDisplay.textContent = `${angle}°`;
}

function trackLog(msg, cls) {
  const log = document.getElementById('trackLog');
  if (!log) return;
  const idle = log.querySelector('.tl-idle');
  if (idle) idle.remove();
  const el = document.createElement('div');
  el.className = `tl-entry ${cls || ''}`;
  el.textContent = `[${new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}] ${msg}`;
  log.prepend(el);
  if (log.children.length > 10) log.removeChild(log.lastChild);
}

// SocketIO events for smart track UI
socket.on('smart_track_status', ({ active }) => {
  _smartTrackActive = active;
  const badge = document.getElementById('smartTrackBadge');
  if (!active && badge) { badge.textContent = 'STANDBY'; badge.className = 'panel-badge'; updateServoUI(90); }
});

socket.on('target_registered', (data) => {
  if (data.success) {
    document.getElementById('targetStatus').textContent = `${data.name || ''} REGISTERED ✓`;
    document.getElementById('btnSmartTrack').disabled = false;
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// OBSTACLE SIMULATION
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnSimObstacle')?.addEventListener('click', () => {
  triggerObstacleAlert();
  sendCommand('S', 'ObstacleSensor');
  setTimeout(clearObstacleAlert, 3000);
  broadcastAction('obstacle_sim', {});
});


// ══════════════════════════════════════════════════════════════════════════════
// COMMAND LOG
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnClearLog')?.addEventListener('click', () => { clearLog(); });


// ══════════════════════════════════════════════════════════════════════════════
// PAGE LOAD INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  console.log('[SARAS] Dashboard initialised. Version: 3.0 (Cloud Edition)');

  // Fetch initial state
  fetch('/api/state')
    .then(r => r.json())
    .then(data => updateRobotStateUI(data))
    .catch(() => console.warn('[API] Could not fetch initial state.'));

  // Fetch initial log
  fetch('/api/log')
    .then(r => r.json())
    .then(data => (data.log || []).forEach(e => appendLogEntry(e)))
    .catch(() => {});

  // Initial saved faces list
  setTimeout(refreshSavedFacesList, 500);
});


// ══════════════════════════════════════════════════════════════════════════════
// SCREEN SYNC SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

function broadcastAction(type, payload = {}) {
  socket.emit('sync_action', { type, payload });
}

socket.on('sync_action', (data) => {
  switch (data.type) {
    case 'intro_open':
      showIntroOverlay(data.payload.text);
      speakOnPhone(data.payload.text);
      break;
    case 'intro_close':
      hideIntroOverlay();
      window.speechSynthesis.cancel();
      break;
    case 'face_toggle':
      _faceDetectionActive = data.payload.active;
      updateFaceUI(_faceDetectionActive);
      break;
    case 'obstacle_sim':
      triggerObstacleAlert();
      setTimeout(clearObstacleAlert, 3000);
      break;
    case 'voice_text':
      const recEl = document.getElementById('recognizedText');
      if (recEl) recEl.textContent = data.payload.text;
      break;
  }
});

socket.on('connect', () => {
  fetch('/api/state')
    .then(r => r.json())
    .then(data => updateRobotStateUI(data))
    .catch(() => {});
});


// ══════════════════════════════════════════════════════════════════════════════
// VIRTUAL GAMEPAD CONTROLLER
// ══════════════════════════════════════════════════════════════════════════════

(function initVirtualGamepad() {
  const vjZone     = document.getElementById('vjZone');
  const vjKnob     = document.getElementById('vjKnob');
  const vjBase     = document.getElementById('vjBase');
  const vjAxisXEl  = document.getElementById('vjAxisX');
  const vjAxisYEl  = document.getElementById('vjAxisY');
  const cmdDisplay = document.getElementById('vgpCmdDisplay');

  if (!vjZone) return;

  const KNOB_RADIUS   = 60;
  const DEAD_ZONE     = 0.22;
  const CMD_THRESHOLD = 0.38;

  let joyActive = false;
  let lastVJCmd = null;

  function setAxisDisplay(ax, ay) {
    if (vjAxisXEl) vjAxisXEl.textContent = ax.toFixed(2);
    if (vjAxisYEl) vjAxisYEl.textContent = ay.toFixed(2);
    const gx = document.getElementById('gpAxisX');
    const gy = document.getElementById('gpAxisY');
    if (gx) gx.textContent = ax.toFixed(2);
    if (gy) gy.textContent = ay.toFixed(2);
  }

  function setCmdDisplay(cmd) {
    if (!cmdDisplay) return;
    const MAP = { F:'FORWARD ↑', B:'BACKWARD ↓', L:'LEFT ←', R:'RIGHT →', S:'STOP ■' };
    cmdDisplay.textContent = (cmd && cmd !== 'S') ? (MAP[cmd] || cmd) : 'STANDBY';
    cmdDisplay.classList.toggle('vgp-cmd-active', !!(cmd && cmd !== 'S'));
  }

  function setDirArrow(cmd) {
    if (!vjBase) return;
    vjBase.className = 'vgp-joystick-base' + (cmd ? ` vdir-${cmd}` : '');
  }

  function dispatchVirtualCmd(cmd, src) {
    if (typeof sendCommand === 'function') sendCommand(cmd, src || 'Gamepad');
    if (typeof animateMovement === 'function') animateMovement(cmd);
  }

  function getZoneCenter() {
    const r = vjZone.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function processJoyMove(clientX, clientY) {
    const c  = getZoneCenter();
    let dx   = clientX - c.x;
    let dy   = clientY - c.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > KNOB_RADIUS) { const s = KNOB_RADIUS / d; dx *= s; dy *= s; }

    const rawAx = dx / KNOB_RADIUS;
    const rawAy = dy / KNOB_RADIUS;
    const ax    = Math.abs(rawAx) < DEAD_ZONE ? 0 : rawAx;
    const ay    = Math.abs(rawAy) < DEAD_ZONE ? 0 : rawAy;

    if (vjKnob) vjKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setAxisDisplay(ax, ay);

    let cmd = null;
    if      (ay < -CMD_THRESHOLD) cmd = 'F';
    else if (ay >  CMD_THRESHOLD) cmd = 'B';
    else if (ax < -CMD_THRESHOLD) cmd = 'L';
    else if (ax >  CMD_THRESHOLD) cmd = 'R';

    setDirArrow(cmd);
    setCmdDisplay(cmd);

    if (cmd !== lastVJCmd) {
      lastVJCmd = cmd;
      dispatchVirtualCmd(cmd || 'S', 'Gamepad');
    }
  }

  function resetJoyVisual() {
    if (vjKnob) vjKnob.style.transform = 'translate(-50%, -50%)';
    setAxisDisplay(0, 0);
    setDirArrow(null);
    setCmdDisplay(null);
    vjZone.classList.remove('vgp-active');
    if (lastVJCmd !== 'S') { lastVJCmd = 'S'; dispatchVirtualCmd('S', 'Gamepad'); }
  }

  vjZone.addEventListener('pointerdown', (e) => {
    e.preventDefault(); joyActive = true;
    vjZone.classList.add('vgp-active');
    try { vjZone.setPointerCapture(e.pointerId); } catch {}
    processJoyMove(e.clientX, e.clientY);
  });
  vjZone.addEventListener('pointermove', (e) => {
    if (!joyActive) return; e.preventDefault(); processJoyMove(e.clientX, e.clientY);
  });
  ['pointerup', 'pointercancel'].forEach(evt => {
    vjZone.addEventListener(evt, () => { joyActive = false; resetJoyVisual(); });
  });

  function wireHoldButton(el, cmd) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.classList.add('vgp-pressed');
      dispatchVirtualCmd(cmd, 'Gamepad'); setCmdDisplay(cmd !== 'S' ? cmd : null);
    });
    const release = () => {
      el.classList.remove('vgp-pressed');
      if (cmd !== 'S') { dispatchVirtualCmd('S', 'Gamepad'); setCmdDisplay(null); }
    };
    el.addEventListener('pointerup',     release);
    el.addEventListener('pointerleave',  release);
    el.addEventListener('pointercancel', release);
  }

  document.querySelectorAll('.vgp-dpad-btn').forEach(btn => wireHoldButton(btn, btn.dataset.cmd));
  document.querySelectorAll('.vgp-face-btn').forEach(btn => wireHoldButton(btn, btn.dataset.cmd));
  document.querySelectorAll('.vgp-shoulder').forEach(btn => wireHoldButton(btn, btn.dataset.cmd));

  const _origAnimateJoystick = window.animateJoystick;
  window.animateJoystick = function(axisX, axisY) {
    if (typeof _origAnimateJoystick === 'function') _origAnimateJoystick(axisX, axisY);
    if (!joyActive && vjKnob) {
      const dx = axisX * KNOB_RADIUS;
      const dy = axisY * KNOB_RADIUS;
      vjKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      setAxisDisplay(axisX, axisY);
      const THRESHOLD = 0.35;
      const physCmd = axisY < -THRESHOLD ? 'F' : axisY > THRESHOLD ? 'B' :
                      axisX < -THRESHOLD ? 'L' : axisX > THRESHOLD ? 'R' : null;
      setDirArrow(physCmd);
      setCmdDisplay(physCmd);
    }
  };

  console.log('[VirtualGamepad] ✓ Initialised');
})();
