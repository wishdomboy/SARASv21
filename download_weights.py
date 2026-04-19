"""
download_weights.py
Run this once in your SARAS project folder:
    python download_weights.py

Downloads face-api.js model weights into static/weights/
so they are served by your own Flask server — no CDN needed.
"""

import urllib.request
import os

WEIGHTS_DIR = os.path.join('static', 'weights')
os.makedirs(WEIGHTS_DIR, exist_ok=True)

BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'

FILES = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'face_landmark_68_tiny_model-weights_manifest.json',
    'face_landmark_68_tiny_model-shard1',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2',
]

for filename in FILES:
    url  = f'{BASE}/{filename}'
    dest = os.path.join(WEIGHTS_DIR, filename)
    print(f'Downloading {filename}...', end=' ', flush=True)
    try:
        urllib.request.urlretrieve(url, dest)
        size = os.path.getsize(dest)
        print(f'✓  ({size // 1024} KB)')
    except Exception as e:
        print(f'✗  FAILED: {e}')

print('\nDone! Now run:')
print('  git add static/weights/')
print('  git add static/camera.js')
print('  git commit -m "Add face-api weights served locally"')
print('  git push origin main --force')
