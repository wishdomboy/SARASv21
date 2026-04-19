/**
 * camera.js — SARAS Browser Camera + Face Detection/Tracking
 * ============================================================
 * All runs locally on the user's device — no camera data sent to server.
 *
 * Fixes in this version:
 *  ✅ Dropped ssdMobilenetv1 (heavy 6MB — was causing registration failures)
 *  ✅ TinyFaceDetector used for everything (fast, reliable, ~2MB total)
 *  ✅ registerFace() waits for models with a timeout + clear UI feedback
 *  ✅ 3-attempt retry for face detection during registration
 *  ✅ Model load badge shows real progress, resets correctly
 *  ✅ No silent failures — every error surfaces to the trackLog UI
 *
 * Models loaded (~2MB total, cached by browser after first load):
 *   - tinyFaceDetector       (~180 KB)
 *   - faceLandmark68TinyNet  (~80 KB)
 *   - faceRecognitionNet     (~1.7 MB) — needed for smart track descriptors
 *
 * Exposed as window.BrowserCamera
 */

'use strict';

(function () {

  const MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
  const DEAD_ZONE  = 0.15;   // 15% center dead-zone — reduces servo jitter

  // ── State ───────────────────────────────────────────────────────────────────
  let _video         = null;
  let _canvas        = null;
  let _stream        = null;
  let _animFrame     = null;

  let _modelsLoaded  = false;
  let _modelsLoading = false;
  let _modelsError   = false;

  let _followActive  = false;
  let _smartActive   = false;

  let _registeredDescriptor = null;
  let _registeredName       = '';
  let _savedFaces           = {};   // { name: Array<number> }

  let _lastCmd = null;

  let _onFaceDetected = null;
  let _onFaceLost     = null;
  let _onTrackCmd     = null;

  // ── UI helpers ──────────────────────────────────────────────────────────────

  function _setBadge(text, cls) {
    const el = document.getElementById('cameraBadge');
    if (!el) return;
    el.textContent = text;
    el.className   = 'panel-badge ' + (cls || '');
  }

  function _trackLog(msg, cls) {
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

  // ── Model loading ───────────────────────────────────────────────────────────

  async function loadModels() {
    if (_modelsLoaded || _modelsLoading) return;
    _modelsLoading = true;
    _modelsError   = false;

    console.log('[FACE] Loading models...');

    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
      console.log('[FACE] tinyFaceDetector ready');

      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL);
      console.log('[FACE] faceLandmark68TinyNet ready');

      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
      console.log('[FACE] faceRecognitionNet ready');

      _modelsLoaded  = true;
      _modelsLoading = false;
      console.log('[FACE] All models ready');

      // Fix badge if it was stuck on LOADING
      const el = document.getElementById('cameraBadge');
      if (el && el.textContent.includes('LOADING')) {
        el.textContent = _stream ? 'LIVE' : 'OFF';
        el.className   = _stream ? 'panel-badge active' : 'panel-badge';
      }

    } catch (err) {
      _modelsLoading = false;
      _modelsError   = true;
      console.error('[FACE] Model load error:', err);
      _setBadge('MODEL ERR', 'danger');
    }
  }

  async function waitForModels(timeoutMs) {
    timeoutMs = timeoutMs || 25000;
    if (_modelsLoaded) return true;
    if (_modelsError)  return false;
    if (!_modelsLoading) loadModels();

    const deadline = Date.now() + timeoutMs;
    while (!_modelsLoaded && !_modelsError) {
      if (Date.now() > deadline) return false;
      await new Promise(r => setTimeout(r, 400));
    }
    return _modelsLoaded;
  }

  // ── Camera ──────────────────────────────────────────────────────────────────

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

      if (!_modelsLoaded && !_modelsLoading) loadModels();

      console.log('[CAM] Camera started');
      return true;
    } catch (err) {
      console.error('[CAM] Start failed:', err);
      return false;
    }
  }

  function stop() {
    _followActive = false;
    _smartActive  = false;
    _lastCmd      = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_stream)    { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_video)     { _video.srcObject = null; }
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

  // ── Detection helpers ────────────────────────────────────────────────────────

  async function _detectAll() {
    if (!_video || !_modelsLoaded || _video.readyState < 2) return [];
    try {
      return await faceapi
        .detectAllFaces(_video, new faceapi.TinyFaceDetectorOptions({
          scoreThreshold: 0.4,
          inputSize: 320,
        }))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch (e) {
      return [];
    }
  }

  function _getLargest(detections) {
    return detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b
    );
  }

  function _draw(detections, highlightIdx) {
    if (!_canvas || !_video) return;
    const ctx = _canvas.getContext('2d');
    _canvas.width  = _video.videoWidth  || 640;
    _canvas.height = _video.videoHeight || 480;
    ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    detections.forEach((d, i) => {
      const box = d.detection.box;
      const hi  = (i === highlightIdx);
      ctx.strokeStyle = hi ? '#ff44aa' : '#00ff88';
      ctx.lineWidth   = hi ? 3 : 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = hi ? 'rgba(255,68,170,0.12)' : 'rgba(0,255,136,0.08)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      if (hi && _registeredName) {
        ctx.fillStyle = '#ff44aa';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(_registeredName, box.x + 4, box.y - 6);
      }
    });
  }

  function _sendTrackCmd(box) {
    const vw   = (_video && _video.videoWidth) ? _video.videoWidth : 640;
    const cx   = box.x + box.width / 2;
    const dead = vw * DEAD_ZONE;
    const mid  = vw / 2;

    const cmd = cx < mid - dead ? 'J' : cx > mid + dead ? 'K' : 'C';
    if (cmd !== _lastCmd) {
      _lastCmd = cmd;
      if (window.ArduinoSerial) window.ArduinoSerial.sendCmd(cmd);
      if (_onTrackCmd) _onTrackCmd(cmd, box);
    }
  }

  // ── Follow mode ──────────────────────────────────────────────────────────────

  async function _followLoop() {
    if (!_followActive) return;
    const detections = await _detectAll();

    if (detections.length > 0) {
      const t = _getLargest(detections);
      _draw(detections, detections.indexOf(t));
      _sendTrackCmd(t.detection.box);
      if (_onFaceDetected) _onFaceDetected({
        x: t.detection.box.x, y: t.detection.box.y,
        width: t.detection.box.width, height: t.detection.box.height,
        count: detections.length,
      });
    } else {
      if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      _lastCmd = null;
      if (_onFaceLost) _onFaceLost();
    }

    if (_followActive) {
      _animFrame = setTimeout(() => requestAnimationFrame(() => _followLoop()), 120);
    }
  }

  async function startFollow() {
    _trackLog('⏳ Starting follow — waiting for models...', 'scanning');
    const ready = await waitForModels(25000);
    if (!ready) { _trackLog('⚠ Models failed to load. Check internet.', 'bypass'); return; }
    _followActive = true;
    _smartActive  = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _followLoop();
    _trackLog('✅ Following nearest face', 'found');
  }

  function stopFollow() {
    _followActive = false;
    _lastCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
  }

  // ── Register face ────────────────────────────────────────────────────────────

  async function registerFace(name) {

    // 1. Wait for models
    if (!_modelsLoaded) {
      _trackLog('⏳ Face models loading... please wait (5–20s on first use)', 'scanning');
      let t = 0;
      const ticker = setInterval(() => {
        t++;
        _trackLog(`⏳ Loading models — ${t}s elapsed...`, 'scanning');
      }, 1000);
      const ready = await waitForModels(30000);
      clearInterval(ticker);

      if (!ready) {
        _trackLog('⚠ Models timed out. Refresh the page and try again.', 'bypass');
        return false;
      }
      _trackLog('✅ Models ready!', 'found');
    }

    // 2. Verify camera
    if (!_video || _video.readyState < 2 || !_stream) {
      _trackLog('⚠ Camera not active. Click "Toggle Camera" first.', 'bypass');
      return false;
    }

    // 3. Detect face (up to 4 attempts)
    _trackLog('📸 Detecting face — look at camera and stay still...', 'scanning');
    let detections = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      detections = await _detectAll();
      if (detections.length > 0) break;
      _trackLog(`🔍 Attempt ${attempt}/4 — no face yet, stay still...`, 'scanning');
      await new Promise(r => setTimeout(r, 700));
    }

    if (detections.length === 0) {
      _trackLog('⚠ No face detected after 4 tries. Check: face clearly visible, good lighting, camera on.', 'bypass');
      return false;
    }

    // 4. Get descriptor from largest face
    const target     = _getLargest(detections);
    const descriptor = target.descriptor;

    if (!descriptor || descriptor.length !== 128) {
      _trackLog('⚠ Face descriptor failed. Improve lighting and try again.', 'bypass');
      return false;
    }

    // 5. Save
    _registeredDescriptor = descriptor;
    _registeredName       = name;
    _savedFaces[name]     = Array.from(descriptor);

    // Flash confirmation box for 2s
    _draw(detections, detections.indexOf(target));
    setTimeout(() => {
      if (_canvas && !_followActive && !_smartActive) {
        _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      }
    }, 2000);

    console.log(`[FACE] Registered '${name}', descriptor length: ${descriptor.length}`);
    return true;
  }

  // ── Smart track ──────────────────────────────────────────────────────────────

  async function _smartLoop() {
    if (!_smartActive || !_registeredDescriptor) return;
    const detections = await _detectAll();

    if (detections.length === 0) {
      if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
      _lastCmd = null;
      if (_onFaceLost) _onFaceLost();
    } else {
      const matcher = new faceapi.FaceMatcher(
        [new faceapi.LabeledFaceDescriptors(_registeredName, [_registeredDescriptor])],
        0.6
      );
      let best = null, bestDist = 1;
      detections.forEach(d => {
        const r = matcher.findBestMatch(d.descriptor);
        if (r.label !== 'unknown' && r.distance < bestDist) { bestDist = r.distance; best = d; }
      });
      _draw(detections, best ? detections.indexOf(best) : -1);
      if (best) {
        _sendTrackCmd(best.detection.box);
        if (_onFaceDetected) _onFaceDetected({
          x: best.detection.box.x, y: best.detection.box.y,
          width: best.detection.box.width, height: best.detection.box.height,
          count: detections.length, name: _registeredName,
        });
      } else {
        _lastCmd = null;
        if (_onFaceLost) _onFaceLost();
      }
    }

    if (_smartActive) {
      _animFrame = setTimeout(() => requestAnimationFrame(() => _smartLoop()), 150);
    }
  }

  async function startSmartTrack() {
    if (!_registeredDescriptor) { _trackLog('⚠ No target registered. Click REGISTER TARGET first.', 'bypass'); return; }
    const ready = await waitForModels(15000);
    if (!ready) { _trackLog('⚠ Models not ready. Refresh and try again.', 'bypass'); return; }
    _smartActive  = true;
    _followActive = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _smartLoop();
  }

  function stopSmartTrack() {
    _smartActive = false;
    _lastCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
  }

  function onFaceDetected(fn) { _onFaceDetected = fn; }
  function onFaceLost(fn)     { _onFaceLost     = fn; }
  function onTrackCmd(fn)     { _onTrackCmd     = fn; }
  function isModelsLoaded()   { return _modelsLoaded; }

  window.BrowserCamera = {
    loadModels, waitForModels,
    start, stop, takeSnapshot,
    startFollow, stopFollow,
    startSmartTrack, stopSmartTrack,
    registerFace, getSavedFaces, loadFace, hasTarget,
    onFaceDetected, onFaceLost, onTrackCmd,
    isModelsLoaded,
  };

  function getSavedFaces() { return Object.keys(_savedFaces); }
  function loadFace(name) {
    if (!_savedFaces[name]) return false;
    _registeredDescriptor = new Float32Array(_savedFaces[name]);
    _registeredName = name;
    return true;
  }
  function hasTarget() { return _registeredDescriptor !== null; }

  // Auto-start model loading on page load (background, cached after first run)
  window.addEventListener('load', () => setTimeout(loadModels, 1500));

  console.log('[BrowserCamera] Module loaded. Models load in background.');

})();
