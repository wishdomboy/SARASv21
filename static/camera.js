/**
 * camera.js — SARAS Browser Camera + Face Detection
 * Clean rewrite — April 2026
 */
'use strict';

(function () {

  // Use GitHub CDN — fast, reliable, has the weight files
  const MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';

  // ── State ──────────────────────────────────────────────────────────────────
  let _video         = null;
  let _canvas        = null;
  let _stream        = null;
  let _animFrame     = null;
  let _modelsLoaded  = false;
  let _modelsLoading = false;
  let _followActive  = false;
  let _smartActive   = false;
  let _lastCmd       = null;

  // Face registration
  let _registeredDescriptor = null;
  let _registeredName       = '';
  let _savedFaces           = {};

  // Callbacks
  let _onFaceDetected = null;
  let _onFaceLost     = null;
  let _onTrackCmd     = null;

  // ── UI Helpers ─────────────────────────────────────────────────────────────

  function _setBadge(text, cls) {
    const el = document.getElementById('cameraBadge');
    if (!el) return;
    el.textContent = text;
    el.className   = 'panel-badge ' + (cls || '');
  }

  function _log(msg, cls) {
    const log = document.getElementById('trackLog');
    if (!log) return;
    const idle = log.querySelector('.tl-idle');
    if (idle) idle.remove();
    const el = document.createElement('div');
    el.className   = 'tl-entry ' + (cls || '');
    el.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    log.prepend(el);
    while (log.children.length > 15) log.removeChild(log.lastChild);
  }

  // ── localStorage ──────────────────────────────────────────────────────────

  function _saveFaces() {
    try { localStorage.setItem('saras_faces', JSON.stringify(_savedFaces)); } catch (e) {}
  }

  function _loadFaces() {
    try {
      const raw = localStorage.getItem('saras_faces');
      if (raw) _savedFaces = JSON.parse(raw);
    } catch (e) {}
  }

  // ── Model Loading ─────────────────────────────────────────────────────────

  async function loadModels() {
    if (_modelsLoaded || _modelsLoading) return;
    _modelsLoading = true;
    console.log('[FACE] Loading models from CDN...');

    try {
      // tinyFaceDetector — fast detection
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
      console.log('[FACE] tinyFaceDetector ready');

      // faceLandmark68TinyNet — needed for withFaceLandmarks(true)
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL);
      console.log('[FACE] faceLandmark68TinyNet ready');

      // faceRecognitionNet — needed for descriptors (smart track)
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
      console.log('[FACE] faceRecognitionNet ready');

      _modelsLoaded  = true;
      _modelsLoading = false;
      console.log('[FACE] All models ready');
      _log('✅ Face models ready!', 'found');

      // Restore badge
      const badge = document.getElementById('cameraBadge');
      if (badge && badge.textContent.includes('LOADING')) {
        badge.textContent = _stream ? '● LIVE' : 'OFF';
        badge.className   = _stream ? 'panel-badge active' : 'panel-badge';
      }

    } catch (err) {
      _modelsLoading = false;
      console.error('[FACE] Model load error:', err.message);
      _setBadge('RETRY →', 'danger');
      _log('⚠ Models failed to load. Click REGISTER TARGET to retry.', 'bypass');
    }
  }

  // Wait up to timeoutMs for models to load
  async function waitForModels(timeoutMs) {
    if (_modelsLoaded) return true;

    // Reset error state so we can retry
    _modelsLoading = false;
    loadModels();

    const end = Date.now() + (timeoutMs || 60000);
    while (!_modelsLoaded) {
      if (Date.now() > end) return false;
      await new Promise(r => setTimeout(r, 500));
    }
    return true;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  async function start(videoEl, canvasEl) {
    _video  = videoEl;
    _canvas = canvasEl;

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      _video.srcObject = _stream;
      await new Promise(r => { _video.onloadedmetadata = r; });
      _video.play();

      if (_canvas) {
        _canvas.width  = _video.videoWidth  || 640;
        _canvas.height = _video.videoHeight || 480;
        _canvas.style.display = 'block';
      }

      // Start loading models if not already loading
      if (!_modelsLoaded && !_modelsLoading) loadModels();

      console.log('[CAM] Camera started');
      return true;
    } catch (err) {
      console.error('[CAM]', err.message);
      return false;
    }
  }

  function stop() {
    _followActive = false;
    _smartActive  = false;
    _lastCmd      = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_video) _video.srcObject = null;
    if (_canvas) {
      _canvas.style.display = 'none';
      _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
    }
    if (_onFaceLost) _onFaceLost();
  }

  function takeSnapshot() {
    if (!_video || !_video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width  = _video.videoWidth;
    c.height = _video.videoHeight;
    c.getContext('2d').drawImage(_video, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }

  // ── Face Detection ─────────────────────────────────────────────────────────

  async function _detectAll() {
    if (!_video || !_modelsLoaded || _video.readyState < 2) return [];
    try {
      // IMPORTANT: withFaceLandmarks(true) = use tiny model (which we loaded)
      // withFaceLandmarks() without arg = full model (not loaded) → would fail
      return await faceapi
        .detectAllFaces(_video, new faceapi.TinyFaceDetectorOptions({
          scoreThreshold: 0.3,
          inputSize: 416,
        }))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch (e) {
      console.warn('[FACE] detect error:', e.message);
      return [];
    }
  }

  function _largest(detections) {
    return detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b
    );
  }

  function _draw(detections, hiIdx) {
    if (!_canvas || !_video) return;
    const ctx = _canvas.getContext('2d');
    _canvas.width  = _video.videoWidth  || 640;
    _canvas.height = _video.videoHeight || 480;
    ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    detections.forEach((d, i) => {
      const box = d.detection.box;
      const hi  = i === hiIdx;
      ctx.strokeStyle = hi ? '#ff44aa' : '#00ff88';
      ctx.lineWidth   = hi ? 3 : 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle   = hi ? 'rgba(255,68,170,0.1)' : 'rgba(0,255,136,0.06)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      if (hi && _registeredName) {
        ctx.fillStyle = '#ff44aa';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(_registeredName, box.x + 4, box.y - 6);
      }
    });
  }

  function _sendTrackCmd(box) {
    const vw   = (_video && _video.videoWidth) ? _video.videoWidth : 640;
    const cx   = box.x + box.width / 2;
    const dead = vw * 0.15;
    const mid  = vw / 2;

    // Servo pan
    const servo = cx < mid - dead ? 'J' : cx > mid + dead ? 'K' : 'C';
    if (servo !== _lastCmd) {
      _lastCmd = servo;
      if (window.ArduinoSerial) window.ArduinoSerial.sendCmd(servo);
      if (_onTrackCmd) _onTrackCmd(servo, box);
    }

    // Body movement (only during smart track)
    if (_smartActive && window.sendCommand) {
      const closeWidth = 150;
      let bodyCmd;
      if      (cx < mid - dead)       bodyCmd = 'L';
      else if (cx > mid + dead)       bodyCmd = 'R';
      else if (box.width < closeWidth) bodyCmd = 'F';
      else                             bodyCmd = 'S';

      if (bodyCmd !== window._lastBodyCmd) {
        window._lastBodyCmd = bodyCmd;
        window.sendCommand(bodyCmd, 'SmartTrack');
      }
    }
  }

  // ── Follow Mode ────────────────────────────────────────────────────────────

  async function _followLoop() {
    if (!_followActive) return;
    const det = await _detectAll();
    if (det.length > 0) {
      const t = _largest(det);
      _draw(det, det.indexOf(t));
      _sendTrackCmd(t.detection.box);
      if (_onFaceDetected) _onFaceDetected({
        x: t.detection.box.x, y: t.detection.box.y,
        width: t.detection.box.width, height: t.detection.box.height,
        count: det.length,
      });
    } else {
      if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      _lastCmd = null;
      if (_onFaceLost) _onFaceLost();
    }
    if (_followActive) _animFrame = setTimeout(() => _followLoop(), 120);
  }

  async function startFollow() {
    _log('⏳ Starting follow mode — waiting for models...', 'scanning');
    const ok = await waitForModels(60000);
    if (!ok) { _log('⚠ Models failed. Check internet and try again.', 'bypass'); return; }
    _followActive = true;
    _smartActive  = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _followLoop();
    _log('✅ Following nearest face', 'found');
  }

  function stopFollow() {
    _followActive = false;
    _lastCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
  }

  // ── Register Face ──────────────────────────────────────────────────────────

  async function registerFace(name) {
    // Wait for models
    if (!_modelsLoaded) {
      _log('⏳ Loading face models (may take 20–60s first time)...', 'scanning');
      const ok = await waitForModels(90000);
      if (!ok) { _log('⚠ Models failed to load. Check connection.', 'bypass'); return false; }
    }

    // Check camera
    if (!_video || _video.readyState < 2 || !_stream) {
      _log('⚠ Camera not active — click Toggle Camera first.', 'bypass');
      return false;
    }

    // Detect face — up to 5 attempts
    _log('📸 Look at camera and stay still...', 'scanning');
    let detections = [];
    for (let i = 1; i <= 5; i++) {
      detections = await _detectAll();
      if (detections.length > 0) break;
      _log('🔍 Attempt ' + i + '/5 — no face yet...', 'scanning');
      await new Promise(r => setTimeout(r, 600));
    }

    if (detections.length === 0) {
      _log('⚠ No face detected. Ensure good lighting and face clearly visible.', 'bypass');
      return false;
    }

    const target     = _largest(detections);
    const descriptor = target.descriptor;

    if (!descriptor || descriptor.length !== 128) {
      _log('⚠ Descriptor failed. Try again in better lighting.', 'bypass');
      return false;
    }

    _registeredDescriptor = descriptor;
    _registeredName       = name;
    _savedFaces[name]     = Array.from(descriptor);
    _saveFaces();

    // Flash green box for 2s
    _draw(detections, detections.indexOf(target));
    setTimeout(() => {
      if (_canvas && !_followActive && !_smartActive) {
        _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      }
    }, 2000);

    console.log('[FACE] Registered:', name);
    return true;
  }

  function getSavedFaces()  { return Object.keys(_savedFaces); }
  function hasTarget()      { return _registeredDescriptor !== null; }
  function isModelsLoaded() { return _modelsLoaded; }

  function loadFace(name) {
    if (!_savedFaces[name]) return false;
    _registeredDescriptor = new Float32Array(_savedFaces[name]);
    _registeredName       = name;
    return true;
  }

  function deleteFace(name) {
    if (!_savedFaces[name]) return false;
    delete _savedFaces[name];
    _saveFaces();
    if (_registeredName === name) { _registeredDescriptor = null; _registeredName = ''; }
    return true;
  }

  // ── Smart Track ────────────────────────────────────────────────────────────

  async function _smartLoop() {
    if (!_smartActive || !_registeredDescriptor) return;
    const det = await _detectAll();

    if (det.length === 0) {
      if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      _lastCmd = null;
      if (_onFaceLost) _onFaceLost();
    } else {
      const matcher = new faceapi.FaceMatcher(
        [new faceapi.LabeledFaceDescriptors(_registeredName, [_registeredDescriptor])], 0.6
      );
      let best = null, bestDist = 1;
      det.forEach(d => {
        const r = matcher.findBestMatch(d.descriptor);
        if (r.label !== 'unknown' && r.distance < bestDist) { bestDist = r.distance; best = d; }
      });

      _draw(det, best ? det.indexOf(best) : -1);

      if (best) {
        _sendTrackCmd(best.detection.box);
        if (_onFaceDetected) _onFaceDetected({
          x: best.detection.box.x, y: best.detection.box.y,
          width: best.detection.box.width, height: best.detection.box.height,
          count: det.length, name: _registeredName,
        });
      } else {
        _lastCmd = null;
        if (_onFaceLost) _onFaceLost();
      }
    }

    if (_smartActive) _animFrame = setTimeout(() => _smartLoop(), 150);
  }

  async function startSmartTrack() {
    if (!_registeredDescriptor) { _log('⚠ Register a target first.', 'bypass'); return; }
    const ok = await waitForModels(30000);
    if (!ok) { _log('⚠ Models not ready.', 'bypass'); return; }
    _smartActive  = true;
    _followActive = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _smartLoop();
  }

  function stopSmartTrack() {
    _smartActive       = false;
    _lastCmd           = null;
    window._lastBodyCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
    // Stop robot
    if (window.ArduinoSerial) window.ArduinoSerial.sendCmd('S');
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────
  function onFaceDetected(fn) { _onFaceDetected = fn; }
  function onFaceLost(fn)     { _onFaceLost     = fn; }
  function onTrackCmd(fn)     { _onTrackCmd     = fn; }

  // ── Expose ─────────────────────────────────────────────────────────────────
  window.BrowserCamera = {
    loadModels, waitForModels,
    start, stop, takeSnapshot,
    startFollow, stopFollow,
    startSmartTrack, stopSmartTrack,
    registerFace, getSavedFaces, loadFace, deleteFace, hasTarget,
    onFaceDetected, onFaceLost, onTrackCmd,
    isModelsLoaded,
  };

  // Load faces from localStorage immediately
  _loadFaces();

  // Start loading models immediately when script runs
  setTimeout(loadModels, 100);

  console.log('[BrowserCamera] Module loaded.');

})();
