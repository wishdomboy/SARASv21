/**
 * camera.js — SARAS Browser Camera + Face Detection/Tracking
 * ============================================================
 * All runs locally on the user's device.
 * No camera data is sent to the server.
 *
 * Requires face-api.js CDN loaded before this script.
 * Exposed as window.BrowserCamera.
 *
 * Modes:
 *   FOLLOW  — tracks nearest/largest face, pans servo
 *   SMART   — registers a specific person's face, tracks only them
 */

'use strict';

(function () {

  const MODELS_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
  const DEAD_ZONE  = 0.15;   // 15% center dead-zone to reduce jitter

  // ── State ───────────────────────────────────────────────────────────────────
  let _video          = null;
  let _canvas         = null;
  let _stream         = null;
  let _animFrame      = null;
  let _modelsLoaded   = false;
  let _modelsLoading  = false;

  let _followActive   = false;
  let _smartActive    = false;

  // Registered face for smart tracking
  let _registeredDescriptor = null;
  let _registeredName       = '';
  let _savedFaces           = {};  // { name: Float32Array descriptor }

  // Track last command to avoid flooding serial
  let _lastCmd = null;

  // ── Radar/UI update callbacks (wired from script.js) ───────────────────────
  // These are set by script.js once UI is ready.
  let _onFaceDetected = null;
  let _onFaceLost     = null;
  let _onTrackCmd     = null;   // called with 'J'/'C'/'K' for servo pan

  // ── Model loading ───────────────────────────────────────────────────────────

  async function loadModels() {
    if (_modelsLoaded || _modelsLoading) return;
    _modelsLoading = true;

    const badge = document.getElementById('cameraBadge');
    if (badge) { badge.textContent = '⏳ MODELS'; badge.className = 'panel-badge warning'; }

    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),
      ]);
      _modelsLoaded = true;
      _modelsLoading = false;
      console.log('[FACE] ✓ All models loaded');
    } catch (err) {
      _modelsLoading = false;
      console.error('[FACE] Model load failed:', err);
    }
  }

  // ── Camera start/stop ───────────────────────────────────────────────────────

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

      // Load models in background (don't block camera start)
      if (!_modelsLoaded) loadModels();

      console.log('[CAM] Browser camera started ✓');
      return true;
    } catch (err) {
      console.error('[CAM] Failed:', err);
      return false;
    }
  }

  function stop() {
    _followActive = false;
    _smartActive  = false;
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
    if (_stream)    { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_video)     { _video.srcObject = null; }
    if (_canvas)    { _canvas.style.display = 'none'; }
    if (_onFaceLost) _onFaceLost();
    console.log('[CAM] Camera stopped');
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────────

  function takeSnapshot() {
    if (!_video || !_video.videoWidth) return null;
    const snap = document.createElement('canvas');
    snap.width  = _video.videoWidth;
    snap.height = _video.videoHeight;
    snap.getContext('2d').drawImage(_video, 0, 0);
    return snap.toDataURL('image/jpeg', 0.9);
  }

  // ── Face detection helpers ───────────────────────────────────────────────────

  async function _detectAllFaces() {
    if (!_video || !_modelsLoaded || _video.readyState < 2) return [];
    try {
      return await faceapi
        .detectAllFaces(_video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch { return []; }
  }

  function _drawDetections(detections) {
    if (!_canvas || !_video) return;
    const ctx = _canvas.getContext('2d');
    _canvas.width  = _video.videoWidth  || 640;
    _canvas.height = _video.videoHeight || 480;
    ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    detections.forEach(d => {
      const box = d.detection.box;
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = 'rgba(0,255,136,0.15)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
    });
  }

  function _sendTrackCmd(box) {
    const videoWidth = _video ? (_video.videoWidth || 640) : 640;
    const center     = box.x + box.width / 2;
    const deadPx     = videoWidth * DEAD_ZONE;
    const mid        = videoWidth / 2;

    let cmd;
    if      (center < mid - deadPx) cmd = 'J';   // pan left
    else if (center > mid + deadPx) cmd = 'K';   // pan right (custom char)
    else                             cmd = 'C';   // center

    if (cmd !== _lastCmd) {
      _lastCmd = cmd;
      // Send via Web Serial
      if (window.ArduinoSerial) window.ArduinoSerial.sendCmd(cmd);
      // Notify script.js for radar/UI
      if (_onTrackCmd) _onTrackCmd(cmd, box);
    }
  }

  function _getLargestFace(detections) {
    return detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b
    );
  }

  // ── Follow mode — track nearest/largest face ─────────────────────────────────

  async function _followLoop() {
    if (!_followActive) return;

    const detections = await _detectAllFaces();
    _drawDetections(detections);

    if (detections.length > 0) {
      const target = _getLargestFace(detections);
      _sendTrackCmd(target.detection.box);

      if (_onFaceDetected) {
        _onFaceDetected({
          x:      target.detection.box.x,
          y:      target.detection.box.y,
          width:  target.detection.box.width,
          height: target.detection.box.height,
          count:  detections.length,
        });
      }
    } else {
      _lastCmd = null;
      if (_onFaceLost) _onFaceLost();
    }

    if (_followActive) {
      _animFrame = setTimeout(() => requestAnimationFrame(_followLoop), 150); // ~6fps
    }
  }

  function startFollow() {
    if (!_modelsLoaded) {
      console.warn('[FACE] Models not ready yet — retrying in 2s');
      setTimeout(startFollow, 2000);
      return;
    }
    _followActive = true;
    _smartActive  = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _followLoop();
    console.log('[FACE] Follow mode started');
  }

  function stopFollow() {
    _followActive = false;
    _lastCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) {
      _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
    }
    console.log('[FACE] Follow mode stopped');
  }

  // ── Register a specific face for smart tracking ──────────────────────────────

  async function registerFace(name) {
    if (!_modelsLoaded) {
      console.warn('[FACE] Models not loaded yet');
      return false;
    }
    if (!_video || _video.readyState < 2) {
      console.warn('[FACE] Camera not ready');
      return false;
    }

    try {
      const detections = await faceapi
        .detectAllFaces(_video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) return false;

      const target      = _getLargestFace(detections);
      const descriptor  = target.descriptor;

      _registeredDescriptor = descriptor;
      _registeredName       = name;
      _savedFaces[name]     = Array.from(descriptor);   // store for session

      console.log(`[FACE] '${name}' registered ✓`);
      return true;
    } catch (err) {
      console.error('[FACE] Register failed:', err);
      return false;
    }
  }

  function getSavedFaces() {
    return Object.keys(_savedFaces);
  }

  function loadFace(name) {
    if (!_savedFaces[name]) return false;
    _registeredDescriptor = new Float32Array(_savedFaces[name]);
    _registeredName       = name;
    return true;
  }

  function hasTarget() {
    return _registeredDescriptor !== null;
  }

  // ── Smart track — follow only the registered person ──────────────────────────

  async function _smartLoop() {
    if (!_smartActive || !_registeredDescriptor) return;

    try {
      const detections = await faceapi
        .detectAllFaces(_video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        _lastCmd = null;
        if (_onFaceLost) _onFaceLost();
      } else {
        // Find the face closest to registered descriptor
        const matcher = new faceapi.FaceMatcher(
          [new faceapi.LabeledFaceDescriptors(_registeredName, [_registeredDescriptor])],
          0.55   // distance threshold
        );

        let bestMatch = null;
        let bestDist  = 1;
        detections.forEach(d => {
          const result = matcher.findBestMatch(d.descriptor);
          if (result.label !== 'unknown' && result.distance < bestDist) {
            bestDist  = result.distance;
            bestMatch = d;
          }
        });

        // Draw all faces, highlight the matched one
        if (_canvas) {
          const ctx = _canvas.getContext('2d');
          _canvas.width  = _video.videoWidth  || 640;
          _canvas.height = _video.videoHeight || 480;
          ctx.clearRect(0, 0, _canvas.width, _canvas.height);

          detections.forEach(d => {
            const box = d.detection.box;
            const isTarget = (d === bestMatch);
            ctx.strokeStyle = isTarget ? '#ff44aa' : '#888888';
            ctx.lineWidth   = isTarget ? 3 : 1;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
            if (isTarget) {
              ctx.fillStyle = 'rgba(255,68,170,0.1)';
              ctx.fillRect(box.x, box.y, box.width, box.height);
              ctx.fillStyle = '#ff44aa';
              ctx.font = '12px monospace';
              ctx.fillText(_registeredName, box.x, box.y - 5);
            }
          });
        }

        if (bestMatch) {
          _sendTrackCmd(bestMatch.detection.box);
          if (_onFaceDetected) {
            _onFaceDetected({
              x: bestMatch.detection.box.x,
              y: bestMatch.detection.box.y,
              width: bestMatch.detection.box.width,
              height: bestMatch.detection.box.height,
              count: detections.length,
              name: _registeredName,
            });
          }
        } else {
          // Person not found in frame
          _lastCmd = null;
          if (_onFaceLost) _onFaceLost();
        }
      }
    } catch (err) {
      console.error('[SMART_TRACK] Error:', err);
    }

    if (_smartActive) {
      _animFrame = setTimeout(() => requestAnimationFrame(_smartLoop), 200); // ~5fps
    }
  }

  function startSmartTrack() {
    if (!_registeredDescriptor) {
      console.warn('[SMART_TRACK] No target registered');
      return;
    }
    if (!_modelsLoaded) {
      console.warn('[SMART_TRACK] Models not ready');
      setTimeout(startSmartTrack, 2000);
      return;
    }
    _smartActive  = true;
    _followActive = false;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    _smartLoop();
    console.log(`[SMART_TRACK] Tracking '${_registeredName}'`);
  }

  function stopSmartTrack() {
    _smartActive = false;
    _lastCmd = null;
    if (_animFrame) { clearTimeout(_animFrame); _animFrame = null; }
    if (_canvas) {
      _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
    }
    console.log('[SMART_TRACK] Stopped');
  }

  // ── Register UI callbacks ───────────────────────────────────────────────────

  function onFaceDetected(fn) { _onFaceDetected = fn; }
  function onFaceLost(fn)     { _onFaceLost     = fn; }
  function onTrackCmd(fn)     { _onTrackCmd     = fn; }

  // ── Expose globally ─────────────────────────────────────────────────────────
  window.BrowserCamera = {
    loadModels,
    start,
    stop,
    takeSnapshot,
    startFollow,
    stopFollow,
    startSmartTrack,
    stopSmartTrack,
    registerFace,
    getSavedFaces,
    loadFace,
    hasTarget,
    onFaceDetected,
    onFaceLost,
    onTrackCmd,
  };

  // Auto-start model loading on page load (background, non-blocking)
  window.addEventListener('load', () => {
    setTimeout(loadModels, 2000);   // delay so page renders first
  });

  console.log('[BrowserCamera] Module loaded.');

})();
