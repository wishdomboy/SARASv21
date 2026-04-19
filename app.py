"""
app.py — SARAS Cloud Backend (Deployment Edition)
===================================================
Cloud-ready: No camera, no serial port, no dlib/OpenCV.

What runs HERE (server):
  ✅ Flask web server — serves the UI
  ✅ Sarvam AI chatbot — /api/chat
  ✅ Command log + state — SocketIO
  ✅ Intent detection — /api/intent

What runs in BROWSER:
  📷 Camera feed     — getUserMedia API
  👁  Face detection  — face-api.js (TinyFaceDetector / SSD)
  🔌 Arduino control — Web Serial API (Chrome/Edge only)
"""

import os
import time
import threading
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

# ── Chatbot ───────────────────────────────────────────────────────────────────
try:
    from chatbot_module import get_chatbot, detect_intent
    CHATBOT_AVAILABLE = True
    print("[CHATBOT] Sarvam chatbot loaded ✓")
except Exception as e:
    CHATBOT_AVAILABLE = False
    print(f"[CHATBOT] Not available: {e}")

# ── Flask + SocketIO ──────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'saras-default-secret-change-me')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ── Global State ──────────────────────────────────────────────────────────────
robot_state = {
    "status":          "IDLE",
    "direction":       "STOPPED",
    "face_detection":  False,
    "obstacle":        False,
    "last_command":    "None",
    "battery":         87,
    "signal_strength": 94,
    "uptime":          0,
    "arduino_mode":    "DEMO",   # DEMO until browser connects Arduino via Web Serial
}
command_log = []
start_time  = time.time()

_CMD_LABELS = {
    'F': ('FORWARD',  'Moving Forward'),
    'W': ('FORWARD',  'Moving Forward'),
    'B': ('BACKWARD', 'Moving Backward'),
    'L': ('LEFT',     'Turning Left'),
    'A': ('LEFT',     'Turning Left'),
    'R': ('RIGHT',    'Turning Right'),
    'D': ('RIGHT',    'Turning Right'),
    'S': ('STOPPED',  'Stopped'),
    'X': ('STOPPED',  'Stopped'),
    'J': ('PAN_LEFT', 'Pan Left'),
    'C': ('CENTER',   'Centered'),
}


# ══════════════════════════════════════════════════════════════════════════════
# BACKGROUND THREADS
# ══════════════════════════════════════════════════════════════════════════════
def uptime_ticker():
    while True:
        robot_state['uptime'] = int(time.time() - start_time)
        socketio.emit('uptime', {'seconds': robot_state['uptime']})
        time.sleep(1)


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/health', methods=['GET'])
def api_health():
    """Quick health check — open this URL to diagnose deployment issues."""
    import sys
    return jsonify({
        'status':            'ok',
        'chatbot_available': CHATBOT_AVAILABLE,
        'sarvam_key_set':    bool(os.environ.get('SARVAM_API_KEY')),
        'secret_key_set':    bool(os.environ.get('SECRET_KEY')),
        'python_version':    sys.version,
    })


@app.route('/api/state', methods=['GET'])
def api_state():
    return jsonify(robot_state)


@app.route('/api/log', methods=['GET'])
def api_log():
    return jsonify({'log': command_log})


# ── Command logging (browser sends what it sent to Arduino via Web Serial) ────
@app.route('/api/command', methods=['POST'])
def api_command():
    """
    Browser logs commands here after sending via Web Serial.
    Server updates state + broadcasts to all connected clients.
    """
    data = request.get_json(force=True) or {}
    cmd  = data.get('cmd', data.get('command', '')).upper().strip()
    src  = data.get('source', 'Browser')
    _log_command(cmd, src)
    info = _CMD_LABELS.get(cmd, (cmd, cmd))
    return jsonify({'success': True, 'direction': info[0], 'label': info[1]})


# ── Chatbot ───────────────────────────────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def api_chat():
    data    = request.get_json(force=True) or {}
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'response': '', 'intent': {'type': 'chat'}})

    intent_data = {'type': 'chat'}
    if CHATBOT_AVAILABLE:
        try:
            intent_data = detect_intent(message)
        except:
            pass

    # Robot commands → return intent, browser handles Web Serial
    _DIRS = {'F': 'Forward', 'B': 'Backward', 'L': 'Left', 'R': 'Right', 'S': 'Stopped'}
    if intent_data['type'] == 'command':
        cmd = intent_data.get('command', '')
        return jsonify({'response': f"Moving {_DIRS.get(cmd, cmd)}!", 'intent': intent_data})
    if intent_data['type'] == 'follow':
        return jsonify({'response': "Starting follow person mode!", 'intent': intent_data})
    if intent_data['type'] == 'track':
        return jsonify({'response': "Starting smart tracking!", 'intent': intent_data})

    # General question → Sarvam LLM
    if CHATBOT_AVAILABLE:
        try:
            chatbot  = get_chatbot()
            response = chatbot.chat(message)
            # Broadcast to OTHER connected screens (multi-tab sync)
            # NOTE: The requesting client reads the reply from this JSON directly —
            # not from the socket event — so there is no race condition.
            socketio.emit('chat_message', {'role': 'assistant', 'text': response, 'speak': False})
            return jsonify({'response': response, 'intent': intent_data, 'success': True})
        except Exception as e:
            print(f"[CHAT ERROR] {e}")
            return jsonify({'response': f'Chatbot error: {str(e)}', 'intent': intent_data, 'success': False})

    return jsonify({'response': 'Chatbot offline. Check SARVAM_API_KEY in Render environment variables.', 'intent': intent_data, 'success': False})


@app.route('/api/chat/clear', methods=['POST'])
def api_chat_clear():
    if CHATBOT_AVAILABLE:
        try:
            get_chatbot().clear_memory()
        except:
            pass
    return jsonify({'status': 'cleared'})


@app.route('/api/intent', methods=['POST'])
def api_intent():
    data = request.get_json(force=True) or {}
    text = data.get('text', '')
    if CHATBOT_AVAILABLE:
        try:
            return jsonify(detect_intent(text))
        except:
            pass
    return jsonify({'type': 'chat'})


# ══════════════════════════════════════════════════════════════════════════════
# SOCKET.IO
# ══════════════════════════════════════════════════════════════════════════════
@socketio.on('connect')
def on_connect():
    socketio.emit('state_update', robot_state)
    socketio.emit('log_history',  command_log[:20])
    print("[WS] Client connected")


@socketio.on('browser_command')
def on_browser_command(data):
    """Browser emits this when it sends a command via Web Serial or manual control."""
    cmd = data.get('cmd', data.get('command', '')).upper()
    src = data.get('source', 'Browser')
    _log_command(cmd, src)


@socketio.on('arduino_status')
def on_arduino_status(data):
    """Browser emits when Arduino connects/disconnects via Web Serial."""
    connected = data.get('connected', False)
    robot_state['arduino_mode'] = 'REAL' if connected else 'DEMO'
    socketio.emit('state_update', robot_state)
    print(f"[ARDUINO] Web Serial: {'Connected' if connected else 'Disconnected'}")


@socketio.on('face_status_update')
def on_face_status(data):
    """Browser emits when face detection state changes."""
    robot_state['face_detection'] = data.get('active', False)
    socketio.emit('state_update', robot_state)
    socketio.emit('face_status', data)


@socketio.on('sync_action')
def on_sync_action(data):
    """Broadcast actions to all other connected screens."""
    socketio.emit('sync_action', data, include_self=False)


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def _log_command(cmd, src):
    if cmd not in _CMD_LABELS:
        return
    direction, label = _CMD_LABELS[cmd]
    robot_state['direction']    = direction
    robot_state['last_command'] = cmd
    robot_state['status']       = 'MOVING' if cmd not in ('S', 'X', 'C') else 'IDLE'

    entry = {
        'time':    time.strftime('%H:%M:%S'),
        'command': cmd,
        'label':   label,
        'source':  src,
        'success': True,
    }
    command_log.insert(0, entry)
    if len(command_log) > 50:
        command_log.pop()

    socketio.emit('state_update',   robot_state)
    socketio.emit('command_logged', entry)


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    print("=" * 60)
    print("  🤖 SARAS — Cloud Server  (Deployment Edition)")
    print("=" * 60)
    print("[INFO] Camera & face detection → Browser (face-api.js)")
    print("[INFO] Arduino control         → Browser (Web Serial API)")
    print("[INFO] Chatbot                 → Server (Sarvam AI)")
    print()

    threading.Thread(target=uptime_ticker, daemon=True).start()

    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

    print(f"[SERVER] http://0.0.0.0:{port}")
    print("[SERVER] Press Ctrl+C to stop.\n")
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
