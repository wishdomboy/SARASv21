# 🪷 SARAS — Saraswati AI Robot Autonomous System

> A full-stack robot control platform with AI chat, voice commands, browser-based face tracking, and Arduino control via Web Serial API. Cloud-deployed, hardware-ready.

---

## ✨ Features

| Feature | Where it runs |
|---|---|
| 🤖 Sarvam AI chatbot (50+ languages) | ☁️ Server (Render) |
| 🎙️ Voice recognition + TTS | 🌐 Browser |
| 📷 Live camera feed | 🌐 Browser (getUserMedia) |
| 👁️ Face detection & tracking | 🌐 Browser (face-api.js) |
| 🎯 Smart person tracking | 🌐 Browser (face recognition) |
| 🔌 Arduino motor control | 🌐 Browser (Web Serial API) |
| 🎮 Virtual gamepad + joystick | 🌐 Browser |
| ⌨️ Keyboard control | 🌐 Browser |

---

## 📋 Requirements

### Browser (for Arduino + Camera)
- **Chrome or Edge** on desktop — required for Web Serial API
- Firefox and Safari do **not** support Web Serial API

### Server
- Python 3.10+
- pip packages (see `requirements.txt`)
- Sarvam AI API key

### Arduino
- Any Arduino board (Uno, Nano, Mega)
- Upload `robot.ino` sketch
- Baud rate: 9600
- Connected to the **same device** running the browser

---

## 🚀 Quick Start (Local)

```bash
# 1. Clone the repo
git clone https://github.com/ravikumarxy321/SARAS
cd SARAS

# 2. Install Python dependencies (lightweight — no OpenCV/dlib)
pip install -r requirements.txt

# 3. Create your .env file
cp .env.example .env
# Edit .env → add your SARVAM_API_KEY and a SECRET_KEY

# 4. Run the server
python app.py

# 5. Open in Chrome or Edge
# http://localhost:5000
```

### Linux / Jetson Nano extra step (Arduino serial permission)
```bash
sudo usermod -aG dialout $USER
# Log out and back in, then run the app
```

---

## 🌐 Deploy to Render (Free)

### Step 1 — Prepare repo
```bash
# Make sure .env is NOT committed
echo ".env" >> .gitignore
git add .
git commit -m "Deploy: cloud edition — browser camera + Web Serial"
git push
```

### Step 2 — Deploy on Render
1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo `ravikumarxy321/SARAS`
3. Set these settings:
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python app.py`
4. Add environment variables:
   - `SARVAM_API_KEY` = your key from dashboard.sarvam.ai
   - `SECRET_KEY` = any long random string
5. Click **Deploy** → get URL like `https://saras-xxxx.onrender.com`

### Step 3 — Use it
- Open the URL in **Chrome or Edge**
- Chatbot, voice, camera: works immediately
- Arduino: plug into your device → click **CONNECT ARDUINO**

---

## 🔌 How Arduino Control Works

```
Your Device (Chrome/Edge)
       │
       ├── Web Serial API ──────────► Arduino (USB)
       │   (direct USB, no server)         │
       │                                   └── Motors / Servos
       │
       └── WebSocket ───────────────► Render Server
           (command log, chat)              │
                                           └── Sarvam AI LLM
```

**Arduino is plugged into the browser device — NOT the server.**
This means anyone visiting the URL can chat, use voice, see the camera — but Arduino control requires the robot to be physically connected to that browser's USB port.

---

## 🎮 Controls

### Keyboard
| Key | Action |
|-----|--------|
| W / ↑ | Forward |
| S / ↓ | Backward |
| A / ← | Left |
| D / → | Right |
| Space | Stop |

### Voice Commands
Say anything in English, Hindi, or Hinglish:
- "aage chalo" / "go forward" → Forward
- "ruko" / "stop" → Stop
- "follow me" → Start face tracking
- Any question → SARAS chatbot replies

### Face Tracking
1. Click **📷 TOGGLE CAMERA** → allow browser camera access
2. Click **◉ FOLLOW PERSON** → tracks nearest face, pans servo
3. For specific person tracking:
   - Stand in frame → click **REGISTER TARGET** → enter name → ✓ SAVE
   - Click **🎯 START TRACKING** → tracks only that person

---

## 📁 Project Structure

```
SARAS/
├── app.py                  # Flask server (chatbot, state, SocketIO)
├── chatbot_module.py       # Sarvam AI LLM integration
├── requirements.txt        # Python deps (no hardware deps)
├── Procfile               # Render deployment
├── .env.example           # Environment template
├── robot.ino              # Arduino sketch
├── templates/
│   └── index.html         # UI (face-api.js + Web Serial UI)
└── static/
    ├── style.css           # Styles
    ├── animations.js       # Visual effects
    ├── script.js           # Main frontend logic
    ├── webserial.js        # Arduino Web Serial API module
    └── camera.js          # Browser camera + face-api.js module
```

---

## 🧠 Architecture

### Old (local only)
```
Browser ──HTTP──► Flask ──pyserial──► Arduino
                     └──OpenCV──► Camera
                     └──dlib ──► Face recognition
```

### New (cloud + local)
```
Browser ──WebSerial──► Arduino  (direct USB)
        ──getUserMedia► Camera  (device camera)
        ──face-api.js──► Face detection (browser ML)
        ──WebSocket──► Flask on Render
                           └──SarvamAI──► Chatbot
```

---

## 🔑 Environment Variables

| Variable | Description | Required |
|---|---|---|
| `SARVAM_API_KEY` | From dashboard.sarvam.ai | Yes |
| `SECRET_KEY` | Flask session secret | Yes |
| `PORT` | Server port (default: 5000) | No |

---

## ⚠️ Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Chatbot | ✅ | ✅ | ✅ | ✅ |
| Voice (STT) | ✅ | ✅ | ❌ | ✅ |
| Camera | ✅ | ✅ | ✅ | ✅ |
| Face detection | ✅ | ✅ | ✅ | ✅ |
| **Arduino (Web Serial)** | ✅ | ✅ | ❌ | ❌ |

**Chrome or Edge required for Arduino control.**

---

## 🛠️ Troubleshooting

### Arduino not connecting
- Use Chrome or Edge (not Firefox/Safari)
- On Linux: `sudo usermod -aG dialout $USER` then re-login
- On Linux: `sudo systemctl disable ModemManager`
- Check Arduino is plugged in before clicking Connect

### Camera not starting
- Allow camera permission in browser (click the lock icon in URL bar)
- HTTPS required on non-localhost — Render provides this automatically
- On local network: use `http://localhost:5000` (not IP address)

### Face detection slow
- First load downloads ~6MB of models from CDN — wait for "Models loaded" in console
- Models are cached after first download
- For faster detection, reduce browser window size

### Chatbot not responding
- Check `SARVAM_API_KEY` is set correctly in Render environment variables
- Check Sarvam API key at dashboard.sarvam.ai

---

## 🔒 Security

- `.env` file is in `.gitignore` — never commit it
- API keys are only on the server — never sent to browser
- Camera data never leaves the browser — all face processing is local
- Web Serial requires a user gesture — cannot be accessed automatically

---

## 📄 License

MIT License — see `LICENSE` file.

---

*🪷 SARAS — Inspired by Goddess Saraswati, the goddess of knowledge and learning.*
