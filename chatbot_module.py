"""
chatbot_module.py — SARAS Chatbot Core
========================================
Stack:
  STT : Browser Web Speech API (Google) — frontend handles this
  LLM : Sarvam AI  /chat/completions    — THIS FILE
  TTS : Browser speechSynthesis         — frontend handles this

Requires:  pip install requests python-dotenv urllib3
"""

import os
import re
import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY  = os.getenv('SARVAM_API_KEY')
SARVAM_BASE_URL = 'https://api.sarvam.ai/v1'
SARVAM_MODEL    = 'sarvam-m'

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ══════════════════════════════════════════════════════════════════════════════
# SESSION — retry + connection pooling for speed
# ══════════════════════════════════════════════════════════════════════════════

def _make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=1, backoff_factor=0, status_forcelist=[502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry, pool_connections=2, pool_maxsize=4)
    session.mount('https://', adapter)
    session.mount('http://',  adapter)
    return session


# ══════════════════════════════════════════════════════════════════════════════
# INTENT DETECTOR — robot command vs chat question
# ══════════════════════════════════════════════════════════════════════════════

COMMAND_MAP = {
    'go forward':   'F', 'move forward': 'F', 'move ahead':  'F',
    'forward':      'F', 'ahead':        'F',
    'go backward':  'B', 'move backward':'B', 'go back':     'B',
    'move back':    'B', 'backward':     'B', 'reverse':     'B', 'back': 'B',
    'turn left':    'L', 'go left':      'L', 'left':        'L',
    'turn right':   'R', 'go right':     'R', 'right':       'R',
    'stop':         'S', 'halt':         'S', 'freeze':      'S',
    'aage chalo':   'F', 'aage jao':     'F', 'aage':        'F',
    'seedha chalo': 'F',
    'peeche chalo': 'B', 'peeche jao':   'B', 'peeche':      'B',
    'left mudo':    'L', 'left karo':    'L', 'baaye':       'L',
    'right mudo':   'R', 'right karo':   'R', 'daaye':       'R',
    'ruko':         'S', 'band karo':    'S', 'rukjao':      'S',
}

FOLLOW_WORDS = {
    'follow', 'follow person', 'follow me', 'start follow',
    'follow karo', 'peecha karo',
}

TRACK_WORDS = {
    'track', 'start tracking', 'track person', 'smart track',
    'track karo', 'tracking shuru karo',
}


def detect_intent(text: str) -> dict:
    """
    Returns intent dict:
      {'type': 'command', 'command': 'F'/'B'/'L'/'R'/'S'}
      {'type': 'follow'}
      {'type': 'track'}
      {'type': 'chat'}
    """
    lower = text.lower().strip()

    for w in FOLLOW_WORDS:
        if w in lower:
            return {'type': 'follow'}

    for w in TRACK_WORDS:
        if w in lower:
            return {'type': 'track'}

    for phrase in sorted(COMMAND_MAP, key=len, reverse=True):
        if phrase in lower:
            return {'type': 'command', 'command': COMMAND_MAP[phrase]}

    return {'type': 'chat'}


# ══════════════════════════════════════════════════════════════════════════════
# LANGUAGE DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

def _detect_language(text: str) -> str:
    if re.search(r'[\u0900-\u097F]', text): return 'Hindi'
    if re.search(r'[\u0600-\u06FF]', text): return 'Arabic'
    if re.search(r'[\u4E00-\u9FFF]', text): return 'Chinese'
    if re.search(r'[\u3040-\u30FF]', text): return 'Japanese'
    if re.search(r'[\uAC00-\uD7AF]', text): return 'Korean'
    if re.search(r'[\u0B80-\u0BFF]', text): return 'Tamil'
    if re.search(r'[\u0C00-\u0C7F]', text): return 'Telugu'
    if re.search(r'[\u0980-\u09FF]', text): return 'Bengali'
    HINGLISH = {
        'karo','kya','hai','hain','mein','nahi','nhi','aur','bhi','toh',
        'yeh','woh','kaise','kyun','kaun','kitna','batao','bolo','bol',
        'chalo','jao','ruko','theek','achha','haan','bilkul','bahut',
        'matlab','samjho','dekho','suno','agar','lekin',
    }
    if set(text.lower().split()) & HINGLISH:
        return 'Hinglish'
    return 'English'


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _clean_reply(text: str) -> str:
    """Remove complete AND incomplete <think> blocks."""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    text = re.sub(r'<think>.*',          '', text, flags=re.DOTALL)
    return text.strip()


# Load Bot_prompt.txt once at module level
_BOT_PROMPT_BASE = ""
try:
    _prompt_path = os.path.join(os.path.dirname(__file__), 'Bot_prompt.txt')
    with open(_prompt_path, 'r', encoding='utf-8') as f:
        _BOT_PROMPT_BASE = f.read().strip()
    print(f"[SARAS] Bot_prompt.txt loaded ({len(_BOT_PROMPT_BASE)} chars)")
except Exception as e:
    print(f"[SARAS] Bot_prompt.txt not found, using default prompt: {e}")
    _BOT_PROMPT_BASE = (
        "You are SARAS — Saraswati AI Robot Autonomous System. "
        "You are an intelligent robot inspired by Goddess Saraswati. "
        "You are calm, wise, helpful, and concise. "
        "Never say you are an AI language model — you ARE SARAS the robot. "
        "Keep answers to 2-3 sentences unless more detail is needed."
    )


def _build_system_prompt(user_text: str) -> str:
    lang = _detect_language(user_text)
    # Use Bot_prompt.txt as the base, append language instruction
    return (
        _BOT_PROMPT_BASE + "\n\n"
        f"Detected language: {lang}. REPLY IN {lang.upper()} ONLY. "
        "No bullet points. No markdown."
    )


# ══════════════════════════════════════════════════════════════════════════════
# SARVAM LLM CHATBOT
# ══════════════════════════════════════════════════════════════════════════════

class SARASChatbot:
    """Sarvam-m chatbot — fast, multilingual, SSL-resilient."""

    def __init__(self):
        if not SARVAM_API_KEY:
            raise ValueError(
                'SARVAM_API_KEY missing in .env — '
                'add: SARVAM_API_KEY=sk_...'
            )
        self.url     = f'{SARVAM_BASE_URL}/chat/completions'
        self.headers = {
            'api-subscription-key': SARVAM_API_KEY,
            'Content-Type':         'application/json',
        }
        self.history = []
        self.session = _make_session()
        print('[SARAS Chatbot] Sarvam-m ready ✓')

    def chat(self, user_text: str) -> str:
        """Get LLM reply. Auto language detection + conversation memory."""
        self.history.append({'role': 'user', 'content': user_text})

        system_prompt = _build_system_prompt(user_text)
        messages = [{'role': 'system', 'content': system_prompt}] + self.history

        # Try with SSL first, fallback without SSL on error
        reply = self._call_api(messages, verify_ssl=True)
        if reply is None:
            print('[SARAS Chatbot] SSL issue — retrying without strict SSL...')
            reply = self._call_api(messages, verify_ssl=False)
        if reply is None:
            reply = 'Network error. Please check your connection.'

        # Strip <think> blocks (sarvam-m chain-of-thought)
        reply = _clean_reply(reply)
        if not reply:
            # Retry without think blocks confusing the model
            reply = self._call_api(
                [{'role': 'system', 'content': 'Answer briefly in 1-2 sentences.'},
                 {'role': 'user', 'content': user_text}],
                verify_ssl=True
            ) or 'I am SARAS. Please ask me again.'
            reply = _clean_reply(reply)

        # Save to memory, keep last 10 messages (5 turns)
        self.history.append({'role': 'assistant', 'content': reply})
        if len(self.history) > 10:
            self.history = self.history[-10:]

        return reply

    def _call_api(self, messages: list, verify_ssl: bool = True):
        """Single API call. Returns reply string or None on SSL failure."""
        try:
            resp = self.session.post(
                self.url,
                json={
                    'model':       SARVAM_MODEL,
                    'messages':    messages,
                    'max_tokens':  150,
                    'temperature': 0.2,
                },
                headers=self.headers,
                timeout=10,
                verify=verify_ssl,
            )
            resp.raise_for_status()
            return resp.json()['choices'][0]['message']['content'].strip()

        except requests.exceptions.SSLError:
            return None
        except requests.exceptions.Timeout:
            return 'Request timed out. Please try again.'
        except requests.exceptions.HTTPError as e:
            return f'API error {e.response.status_code}. Check SARVAM_API_KEY.'
        except Exception as e:
            return f'Error: {str(e)}'

    def clear_memory(self):
        self.history = []
        print('[SARAS Chatbot] Memory cleared.')


# ── Singleton ─────────────────────────────────────────────────────────────────
_instance = None

def get_chatbot() -> SARASChatbot:
    global _instance
    if _instance is None:
        _instance = SARASChatbot()
    return _instance