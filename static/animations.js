/**
 * animations.js — NEXUS-1 Robot Control
 * =======================================
 * All animation helpers, visual effects, and UI state transitions.
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// WAVEFORM BARS (Voice Panel)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build the waveform bar elements on page load.
 */
function buildWaveform() {
  const container = document.getElementById('waveformBars');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    // Randomise custom property for height variance during animation
    bar.style.setProperty('--h', `${Math.floor(Math.random() * 36 + 6)}px`);
    bar.style.animationDelay = `${(i * 0.04).toFixed(2)}s`;
    container.appendChild(bar);
  }
}

/**
 * Animate bars live using AudioContext analyser data (if available),
 * or a simple random simulation.
 * @param {AnalyserNode|null} analyser
 */
let _waveAnim = null;

function startWaveformAnimation(analyser) {
  stopWaveformAnimation();
  const bars    = document.querySelectorAll('#waveformBars .bar');
  const label   = document.getElementById('waveformLabel');
  const wrapper = document.getElementById('waveformBars');

  wrapper.classList.add('listening');
  if (label) label.textContent = 'LISTENING...';

  if (analyser) {
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);

    function draw() {
      _waveAnim = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * bufLen);
        const v   = data[idx] / 128;         // 0–2
        const h   = Math.max(4, Math.round(v * 36));
        bar.style.height = h + 'px';
        bar.style.setProperty('--h', h + 'px');
      });
    }
    draw();
  } else {
    // Simulated random waves
    function simDraw() {
      _waveAnim = requestAnimationFrame(simDraw);
      bars.forEach(bar => {
        const h = Math.floor(Math.random() * 38 + 4);
        bar.style.height = h + 'px';
        bar.style.setProperty('--h', h + 'px');
      });
    }
    simDraw();
  }
}

function stopWaveformAnimation() {
  if (_waveAnim) { cancelAnimationFrame(_waveAnim); _waveAnim = null; }
  const bars    = document.querySelectorAll('#waveformBars .bar');
  const wrapper = document.getElementById('waveformBars');
  const label   = document.getElementById('waveformLabel');

  if (wrapper) wrapper.classList.remove('listening');
  if (label)   label.textContent = 'READY';
  bars.forEach(bar => { bar.style.height = '6px'; });
}


// ══════════════════════════════════════════════════════════════════════════════
// ROBOT AVATAR ANIMATIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Show "talking" state: animate mouth + sound waves + microphone glow.
 */
function startRobotTalking() {
  const mouth  = document.getElementById('robotMouth');
  const waves  = document.getElementById('soundWaves');
  const mic    = document.getElementById('micGlow');

  if (mouth)  mouth.classList.add('speaking');
  if (waves)  waves.classList.add('active');
  if (mic)    mic.classList.add('active');
}

function stopRobotTalking() {
  const mouth = document.getElementById('robotMouth');
  const waves = document.getElementById('soundWaves');
  const mic   = document.getElementById('micGlow');

  if (mouth)  mouth.classList.remove('speaking');
  if (waves)  waves.classList.remove('active');
  if (mic)    mic.classList.remove('active');
}


// ══════════════════════════════════════════════════════════════════════════════
// INTRODUCTION OVERLAY
// ══════════════════════════════════════════════════════════════════════════════

function showIntroOverlay(text) {
  const overlay   = document.getElementById('introOverlay');
  const introText = document.getElementById('introText');

  if (introText) introText.textContent = text || 'Hello! I am an AI powered robot...';
  if (overlay)   overlay.classList.add('active');

  startRobotTalking();
}

function hideIntroOverlay() {
  const overlay = document.getElementById('introOverlay');
  if (overlay) overlay.classList.remove('active');
  stopRobotTalking();
}


// ══════════════════════════════════════════════════════════════════════════════
// MOVEMENT DIRECTION ANIMATIONS
// ══════════════════════════════════════════════════════════════════════════════

const DIRECTION_MAP = {
  F: { arrow: '↑',  label: 'FORWARD',   class: 'dir-forward'  },
  B: { arrow: '↓',  label: 'BACKWARD',  class: 'dir-backward' },
  L: { arrow: '←',  label: 'TURNING LEFT',  class: 'dir-left' },
  R: { arrow: '→',  label: 'TURNING RIGHT', class: 'dir-right' },
  S: { arrow: '■',  label: 'STANDBY',   class: ''             },
};

/**
 * Update the movement indicator (arrow + label) and highlight D-pad button.
 * @param {string} cmd  — 'F'|'B'|'L'|'R'|'S'
 */
function animateMovement(cmd) {
  const indicator = document.getElementById('movementIndicator');
  const arrowEl   = document.getElementById('moveArrow');
  const labelEl   = document.getElementById('moveLabel');

  const info = DIRECTION_MAP[cmd] || DIRECTION_MAP['S'];

  // Clear all direction classes
  if (indicator) {
    indicator.className = 'movement-indicator';
    if (info.class) indicator.classList.add(info.class);
  }
  if (arrowEl)  arrowEl.textContent  = info.arrow;
  if (labelEl)  labelEl.textContent  = info.label;

  // Highlight D-pad button temporarily
  const dpadId = { F:'dpadF', B:'dpadB', L:'dpadL', R:'dpadR', S:'dpadS' }[cmd];
  if (dpadId) {
    const btn = document.getElementById(dpadId);
    if (btn) {
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 200);
    }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// FACE DETECTION ANIMATIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Show a face bounding box on the radar canvas.
 * @param {object} face — {x, y, width, height, offset}
 */
function showFaceOnRadar(face) {
  const radar   = document.getElementById('radarContainer');
  const box     = document.getElementById('faceDetectionBox');
  const dot     = document.getElementById('radarDot');
  const offsetEl = document.getElementById('faceOffset');

  if (!radar || !box) return;

  const rW = radar.offsetWidth;
  const rH = radar.offsetHeight;

  // Map face coords (assumes 640×480 source) to radar size
  const scaleX = rW / 640;
  const scaleY = rH / 480;

  box.style.left   = (face.x * scaleX) + 'px';
  box.style.top    = (face.y * scaleY) + 'px';
  box.style.width  = (face.width  * scaleX) + 'px';
  box.style.height = (face.height * scaleY) + 'px';
  box.classList.add('visible');

  if (dot) {
    const cx = (face.x + face.width / 2) * scaleX;
    const cy = (face.y + face.height / 2) * scaleY;
    dot.style.left = cx + 'px';
    dot.style.top  = cy + 'px';
    dot.style.transform = 'translate(-50%, -50%)';
    dot.classList.add('visible');
  }

  if (offsetEl) offsetEl.textContent = face.offset > 0 ? `+${face.offset}` : face.offset;
}

function clearFaceFromRadar() {
  const box = document.getElementById('faceDetectionBox');
  const dot = document.getElementById('radarDot');
  if (box) box.classList.remove('visible');
  if (dot) dot.classList.remove('visible');
}

/**
 * Start/stop radar sweep animation.
 */
function startRadarSweep() {
  const sweep = document.getElementById('radarSweep');
  if (sweep) sweep.classList.add('active');
}
function stopRadarSweep() {
  const sweep = document.getElementById('radarSweep');
  if (sweep) sweep.classList.remove('active');
}


// ══════════════════════════════════════════════════════════════════════════════
// OBSTACLE ANIMATIONS
// ══════════════════════════════════════════════════════════════════════════════

let _obstacleTimer = null;

function triggerObstacleAlert() {
  // Status bar
  const card   = document.getElementById('obstacleCard');
  const status = document.getElementById('obstacleStatus');
  const badge  = document.getElementById('obstacleBadge');
  const text   = document.getElementById('obstacleStatusText');
  const icon   = document.getElementById('obstacleIcon');
  const bars   = document.querySelector('.sensor-bars');
  const panel  = document.getElementById('obstaclePanel');
  const overlay = document.getElementById('obstacleOverlay');

  if (card)    card.classList.add('danger');
  if (status)  status.textContent = 'DANGER';
  if (badge)   { badge.textContent = 'OBSTACLE!'; badge.className = 'panel-badge danger'; }
  if (text)    text.textContent = '⚠ OBSTACLE DETECTED — AUTO-STOP ENGAGED';
  if (icon)    icon.classList.add('danger');
  if (bars)    bars.classList.add('danger');
  if (overlay) overlay.classList.add('active');

  // Auto-clear after 3 s
  if (_obstacleTimer) clearTimeout(_obstacleTimer);
  _obstacleTimer = setTimeout(clearObstacleAlert, 3000);
}

function clearObstacleAlert() {
  const card    = document.getElementById('obstacleCard');
  const status  = document.getElementById('obstacleStatus');
  const badge   = document.getElementById('obstacleBadge');
  const text    = document.getElementById('obstacleStatusText');
  const icon    = document.getElementById('obstacleIcon');
  const bars    = document.querySelector('.sensor-bars');
  const overlay = document.getElementById('obstacleOverlay');

  if (card)    card.classList.remove('danger');
  if (status)  status.textContent = 'CLEAR';
  if (badge)   { badge.textContent = 'CLEAR'; badge.className = 'panel-badge'; }
  if (text)    text.textContent = 'PATH CLEAR — NO OBSTACLES DETECTED';
  if (icon)    icon.classList.remove('danger');
  if (bars)    bars.classList.remove('danger');
  if (overlay) overlay.classList.remove('active');
}


// ══════════════════════════════════════════════════════════════════════════════
// JOYSTICK ANIMATION (Gamepad)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Move the joystick knob visually based on axis values.
 * @param {number} axisX — -1 to 1
 * @param {number} axisY — -1 to 1
 */
function animateJoystick(axisX, axisY) {
  const knob = document.getElementById('joystickKnob');
  if (!knob) return;

  const MAX_OFFSET = 32;   // max pixel travel from center
  const x = axisX * MAX_OFFSET;
  const y = axisY * MAX_OFFSET;

  knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  knob.style.left = '50%';
  knob.style.top  = '50%';

  document.getElementById('gpAxisX').textContent = axisX.toFixed(2);
  document.getElementById('gpAxisY').textContent = axisY.toFixed(2);
}

function resetJoystick() {
  const knob = document.getElementById('joystickKnob');
  if (knob) knob.style.transform = 'translate(-50%, -50%)';
  animateJoystick(0, 0);
}


// ══════════════════════════════════════════════════════════════════════════════
// COMMAND LOG UI
// ══════════════════════════════════════════════════════════════════════════════

function appendLogEntry(entry) {
  const log = document.getElementById('commandLog');
  if (!log) return;

  // Remove empty placeholder
  const empty = log.querySelector('.log-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `
    <span class="log-time">${entry.time}</span>
    <span class="log-cmd">${entry.command}</span>
    <span class="log-label">${entry.label}</span>
    <span class="log-source ${entry.source}">${entry.source.toUpperCase()}</span>
  `;
  log.prepend(el);

  // Scroll to top so newest entry always visible
  log.scrollTop = 0;

  // Keep max 50 entries in DOM
  const entries = log.querySelectorAll('.log-entry');
  if (entries.length > 50) entries[entries.length - 1].remove();
}

function clearLog() {
  const log = document.getElementById('commandLog');
  if (log) log.innerHTML = '<div class="log-empty">Log cleared.</div>';
}


// ══════════════════════════════════════════════════════════════════════════════
// ROBOT STATE UI UPDATE
// ══════════════════════════════════════════════════════════════════════════════

function updateRobotStateUI(state) {
  const setEl = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setEl('robotStatus',    state.status    || 'IDLE');
  setEl('robotDirection', state.direction || 'STOPPED');
  setEl('lastCommand',    state.last_command || '—');
  setEl('batteryLevel',   state.battery   || '--');
  setEl('signalStrength', state.signal_strength || '--');
  setEl('faceStatus',     state.face_detection ? 'ON' : 'OFF');

  if (state.direction && state.direction !== 'STOPPED') {
    const cmdChar = { FORWARD:'F', BACKWARD:'B', LEFT:'L', RIGHT:'R', STOPPED:'S' }[state.direction] || 'S';
    animateMovement(cmdChar);
  }

  if (state.obstacle) {
    triggerObstacleAlert();
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// UPTIME FORMATTER
// ══════════════════════════════════════════════════════════════════════════════

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}


// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  buildWaveform();

  // Wire intro close button
  const closeBtn = document.getElementById('introClose');
  if (closeBtn) closeBtn.addEventListener('click', hideIntroOverlay);
});
