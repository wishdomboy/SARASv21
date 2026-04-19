/**
 * webserial.js — SARAS Arduino Control via Web Serial API
 * =========================================================
 * Works on Chrome / Edge desktop only (Firefox not supported).
 * Exposed as window.ArduinoSerial — no ES module imports needed.
 *
 * Usage:
 *   await window.ArduinoSerial.connect()
 *   window.ArduinoSerial.sendCmd('F')   // forward
 *   window.ArduinoSerial.isConnected()  // bool
 *   await window.ArduinoSerial.disconnect()
 *
 * Maps internal commands to Arduino sketch characters:
 *   F → W  (forward)
 *   B → S  (backward)
 *   L → A  (left)
 *   R → D  (right)
 *   S → X  (stop)
 *   J → J  (servo pan left)
 *   C → C  (servo center)
 */

'use strict';

(function () {

  // ── Internal state ──────────────────────────────────────────────────────────
  let _port       = null;
  let _writer     = null;
  let _connected  = false;
  let _readActive = false;

  const _encoder = new TextEncoder();
  const _decoder = new TextDecoder();

  // Map from SARAS internal commands → Arduino sketch characters
  const _CMD_MAP = {
    'F': 'W',   // forward
    'B': 'S',   // backward
    'L': 'A',   // left
    'R': 'D',   // right
    'S': 'X',   // stop
    'X': 'X',   // stop (alias)
    'J': 'J',   // servo pan left
    'C': 'C',   // servo center
    'K': 'K',   // servo pan right
    // Pass-through for direct Arduino chars
    'W': 'W', 'A': 'A', 'D': 'D',
  };

  // ── UI helpers ──────────────────────────────────────────────────────────────
  function _setStatus(text, cls) {
    const el = document.getElementById('arduinoStatusBadge');
    if (!el) return;
    el.textContent = text;
    el.className   = 'arduino-badge ' + (cls || '');
  }

  function _setMockLog(msg) {
    const el = document.getElementById('mockCmdLog');
    if (el) el.textContent = msg;
  }

  function _setDist(txt) {
    const el = document.getElementById('distDisplay');
    if (el) el.textContent = txt;
  }

  // ── Read incoming serial data from Arduino ──────────────────────────────────
  async function _startReading() {
    if (!_port || !_port.readable || _readActive) return;
    _readActive = true;
    let buffer  = '';

    while (_port && _port.readable && _connected) {
      const reader = _port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += _decoder.decode(value);
          const lines = buffer.split('\n');
          buffer = lines.pop();   // keep incomplete line
          for (const line of lines) {
            _handleArduinoMsg(line.trim());
          }
        }
      } catch (e) {
        break;
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    }
    _readActive = false;
  }

  function _handleArduinoMsg(msg) {
    if (!msg) return;
    if (msg.startsWith('DIST:')) {
      const cm = msg.replace('DIST:', '').trim();
      _setDist(`📡 ${cm} cm`);
    }
    if (msg === 'STOP')  _setStatus('⛔ OBSTACLE', 'danger');
    if (msg === 'CLEAR') _setStatus('✅ CONNECTED', 'connected');
    if (msg === 'READY') console.log('[ARDUINO] Ready');
    console.log('[ARDUINO]', msg);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request a serial port and open connection.
   * Must be called from a user gesture (button click).
   * @returns {Promise<boolean>} true if connected
   */
  async function connect() {
    if (!('serial' in navigator)) {
      alert(
        'Web Serial API not supported.\n' +
        'Use Chrome or Edge on desktop/Android.\n' +
        'Firefox and Safari do not support Web Serial.'
      );
      return false;
    }

    try {
      _port = await navigator.serial.requestPort();
      await _port.open({ baudRate: 9600 });
      _writer    = _port.writable.getWriter();
      _connected = true;
      _setStatus('✅ CONNECTED', 'connected');
      _setMockLog('');
      console.log('[SERIAL] Arduino connected via Web Serial ✓');

      // Notify server
      if (window._sarasSocket) {
        window._sarasSocket.emit('arduino_status', { connected: true });
      }

      // Start reading from Arduino
      _startReading();
      return true;

    } catch (err) {
      console.error('[SERIAL] Connection failed:', err);
      if (err.name !== 'NotFoundError') {
        // User cancelled — don't show error
        _setStatus('❌ FAILED', 'danger');
      }
      return false;
    }
  }

  /**
   * Close the serial connection.
   */
  async function disconnect() {
    _connected = false;
    try { if (_writer)  { _writer.releaseLock(); _writer = null; }  } catch {}
    try { if (_port)    { await _port.close(); _port = null; }       } catch {}
    _setStatus('● DEMO', '');
    _setMockLog('[DEMO] No Arduino');
    _setDist('');
    console.log('[SERIAL] Disconnected');

    if (window._sarasSocket) {
      window._sarasSocket.emit('arduino_status', { connected: false });
    }
  }

  /**
   * Send a command to Arduino.
   * Automatically maps SARAS internal commands to Arduino chars.
   * @param {string} cmd — SARAS command: F/B/L/R/S/J/C
   */
  async function sendCmd(cmd) {
    const arduinoChar = _CMD_MAP[cmd.toUpperCase()] || cmd;

    if (!_connected || !_writer) {
      // DEMO mode — show in UI
      _setMockLog(`[DEMO] → ${arduinoChar}`);
      console.log('[DEMO]', cmd, '→', arduinoChar);
      return;
    }

    try {
      await _writer.write(_encoder.encode(arduinoChar));
      console.log('[SERIAL]', cmd, '→', arduinoChar);
    } catch (err) {
      console.error('[SERIAL] Send failed:', err);
      _connected = false;
      _setStatus('❌ LOST', 'danger');
    }
  }

  /**
   * @returns {boolean} true if Arduino is currently connected
   */
  function isConnected() {
    return _connected;
  }

  // ── Expose globally ─────────────────────────────────────────────────────────
  window.ArduinoSerial = { connect, disconnect, sendCmd, isConnected };

  console.log('[ArduinoSerial] Web Serial module loaded. Chrome/Edge only.');

})();
