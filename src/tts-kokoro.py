#!/usr/bin/env python3
"""
Kokoro TTS for VoiceBuilder sample/demo audio generation.

Generates expressive, natural American English audio at 11 kHz / 16-bit / mono
for use as reference samples during recording.

Commercial licensing: Apache-2.0 (Kokoro-82M model + code)
No Microsoft/Windows dependency — runs fully offline on any platform with Python.

Usage:
    python src/tts-kokoro.py --worklist work/manifest.json --output work/samples --voice af_heart

Voices (American English):
    af_heart      - Female, warm/natural (default)
    af_bella      - Female, soft
    af_nicole     - Female, clear
    af_sarah      - Female, professional
    am_michael    - Male, natural
    am_adam       - Male, deep
    am_fenrir     - Male, expressive
    am_echo       - Male, conversational

Dependencies:
    pip install kokoro-onnx soundfile numpy resampy misaki[en]
    # Or: pip install kokoro (PyTorch version, heavier)

Model files (auto-downloaded on first run to ~/.cache/kokoro/):
    kokoro-v1.0.onnx  (~350 MB)
    voices-v1.0.bin   (~50 MB)
"""

import sys
import json
import argparse
import os
import urllib.request
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import soundfile as sf
import resampy

# Kokoro ONNX runtime (lightweight, no PyTorch)
try:
    from kokoro_onnx import Kokoro
    from misaki import en
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install kokoro-onnx soundfile numpy resampy 'misaki[en]'")
    sys.exit(1)

TARGET_SR = 11025
TARGET_BITS = 16
TARGET_CHANNELS = 1

# Default voice: expressive female US English
DEFAULT_VOICE = "af_heart"

# Available US voices (Kokoro-82M v1.0)
US_VOICES = {
    "af_heart", "af_bella", "af_nicole", "af_sarah",
    "am_michael", "am_adam", "am_fenrir", "am_echo"
}

# Model file URLs (GitHub releases)
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices-v1.0.bin"

DEFAULT_MODEL_DIR = Path.home() / ".cache" / "kokoro"


def download_with_retry(url: str, dest: Path, max_retries: int = 3, timeout: int = 300) -> bool:
    """Download a file with retry logic."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    
    for attempt in range(1, max_retries + 1):
        try:
            print(f"Downloading {dest.name} (attempt {attempt}/{max_retries})...")
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                total = int(response.headers.get('Content-Length', 0))
                downloaded = 0
                with open(dest, 'wb') as f:
                    while True:
                        chunk = response.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            pct = downloaded * 100 // total
                            print(f"  {pct}% ({downloaded // 1024 // 1024} MB / {total // 1024 // 1024} MB)", end='\r')
                print(f"  Done ({downloaded // 1024 // 1024} MB)")
            return True
        except Exception as e:
            print(f"  Failed: {e}")
            if attempt < max_retries:
                import time
                time.sleep(5)
            else:
                return False
    return False


def ensure_model_files(model_dir: Path) -> tuple[Path, Path]:
    """Ensure model files exist, download if necessary."""
    model_path = model_dir / "kokoro-v1.0.onnx"
    voices_path = model_dir / "voices-v1.0.bin"
    
    if model_path.exists() and voices_path.exists():
        return model_path, voices_path
    
    print(f"Model files not found in {model_dir}, downloading...")
    model_dir.mkdir(parents=True, exist_ok=True)
    
    if not model_path.exists():
        if not download_with_retry(MODEL_URL, model_path):
            print(f"ERROR: Failed to download model from {MODEL_URL}")
            print("You can manually download kokoro-v1.0.onnx and voices-v1.0.bin to:")
            print(f"  {model_dir}")
            sys.exit(1)
    
    if not voices_path.exists():
        if not download_with_retry(VOICES_URL, voices_path):
            print(f"ERROR: Failed to download voices from {VOICES_URL}")
            sys.exit(1)
    
    return model_path, voices_path


class KokoroTTS:
    """Kokoro TTS wrapper for VoiceBuilder sample generation."""

    def __init__(self, voice: str = DEFAULT_VOICE, model_dir: Path = None, speed: float = 1.0):
        """
        Initialize Kokoro TTS.

        Args:
            voice: Voice name (see US_VOICES)
            model_dir: Directory containing model files (default: ~/.cache/kokoro/)
        """
        if voice not in US_VOICES:
            print(f"Warning: '{voice}' not in known US voices. Available: {', '.join(sorted(US_VOICES))}")

        self.voice = voice
        self.speed = speed
        self.g2p = en.G2P()

        # Ensure model files exist
        if model_dir is None:
            model_dir = DEFAULT_MODEL_DIR
        model_path, voices_path = ensure_model_files(model_dir)

        # Initialize Kokoro ONNX
        self.kokoro = Kokoro(model_path=str(model_path), voices_path=str(voices_path))

    def synthesize(self, text: str) -> tuple[int, np.ndarray]:
        """
        Synthesize text to audio.

        Returns:
            (sample_rate, audio_data) where audio_data is float32 mono at 24000 Hz
        """
        # Kokoro generates at 24 kHz
        audio, sr = self.kokoro.create(
            text,
            voice=self.voice,
            speed=self.speed,
            lang="en-us"
        )
        return sr, audio.astype(np.float32)

    def synthesize_to_file(self, text: str, output_path: Path, target_sr: int = TARGET_SR) -> None:
        """Synthesize and save as 11 kHz / 16-bit / mono WAV."""
        sr, audio = self.synthesize(text)

        # Resample to target SR (11025 Hz)
        if sr != target_sr:
            audio = resampy.resample(audio, sr, target_sr, axis=0)
            sr = target_sr

        # Ensure mono
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        # Write as 16-bit PCM WAV
        sf.write(output_path, audio, sr, subtype='PCM_16')


def load_worklist(path: Path) -> List[Dict[str, Any]]:
    """Load worklist JSON."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Worklist must be a JSON array")
    return data


def main():
    parser = argparse.ArgumentParser(description='Kokoro TTS for VoiceBuilder sample audio generation')
    parser.add_argument('--worklist', required=True, help='Path to worklist.json')
    parser.add_argument('--output', required=True, help='Output directory for WAV files')
    parser.add_argument('--manifest', help='Output manifest path (default: <output>/../manifest.json)')
    parser.add_argument('--voice', default=DEFAULT_VOICE, help=f'Voice name (default: {DEFAULT_VOICE})')
    parser.add_argument('--speed', type=float, default=1.0, help='Speaking speed; below 1.0 is slower (default: 1.0)')
    parser.add_argument('--model-dir', help='Directory for model files (default: ~/.cache/kokoro/)')
    parser.add_argument('--sample-rate', type=int, default=TARGET_SR, help=f'Target sample rate (default: {TARGET_SR})')
    args = parser.parse_args()

    worklist_path = Path(args.worklist)
    output_dir = Path(args.output)

    if not worklist_path.exists():
        print(f"Worklist not found: {worklist_path}")
        return 1

    if args.manifest:
        manifest_path = Path(args.manifest)
    else:
        manifest_path = output_dir.parent / 'manifest.json'

    # Load worklist
    try:
        worklist = load_worklist(worklist_path)
    except Exception as e:
        print(f"Failed to load worklist: {e}")
        return 1

    if not worklist:
        print("Worklist is empty")
        return 1

    # Initialize TTS
    try:
        model_dir = Path(args.model_dir) if args.model_dir else None
        tts = KokoroTTS(voice=args.voice, model_dir=model_dir, speed=args.speed)
    except Exception as e:
        print(f"Failed to initialize Kokoro TTS: {e}")
        return 1

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    manifest = []
    total_bytes = 0

    for item in worklist:
        item_id = item.get('id')
        text = item.get('text', '').strip()

        if not item_id or not text:
            print(f"Skipping invalid entry: {item}")
            continue

        # Clean text for TTS (same as SAPI script)
        speak_text = text.replace('\u2014', ', ').replace('\u2013', ', ')  # em/en dashes
        speak_text = speak_text.replace('\u2018', "'").replace('\u2019', "'")  # smart quotes
        speak_text = speak_text.replace('\u201c', '"').replace('\u201d', '"')
        speak_text = speak_text.replace('\u2026', ', ')  # ellipsis

        file_name = f"{item_id}.wav"
        file_path = output_dir / file_name

        try:
            tts.synthesize_to_file(speak_text, file_path, target_sr=args.sample_rate)
            file_size = file_path.stat().st_size
            total_bytes += file_size

            manifest.append({
                'id': item_id,
                'file': file_name,
                'source': item.get('source', ''),
                'day': item.get('day'),
                'text': text,
                'voice': args.voice,
                'locale': 'en-US',
                'status': 'kokoro-generated-unreviewed'
            })
            print(f"  Generated: {file_name} ({file_size} bytes)")

        except Exception as e:
            print(f"  ERROR generating {file_name}: {e}")
            return 1

    # Write manifest
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nGenerated {len(manifest)} WAV samples with voice '{args.voice}'.")
    print(f"Total WAV size: {total_bytes} bytes")
    print(f"Samples folder: {output_dir}")
    print(f"Manifest: {manifest_path}")

    return 0


if __name__ == '__main__':
    sys.exit(main())