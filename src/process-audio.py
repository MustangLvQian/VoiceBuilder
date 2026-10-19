#!/usr/bin/env python3
"""
Audio post-processing for VoiceBuilder "一键收尾" pipeline.

Applies to all WAV files in the recording directory (default: work/audio/):
1. Noise reduction (降噪) — spectral gating via noisereduce
2. Volume normalization (统一音量) — loudness normalization to -23 LUFS (EBU R128)

RVC (美式口音转换) has been REMOVED due to licensing concerns (fairseq GPL, model weights unclear).
For American English output, use the Kokoro TTS re-synthesis pipeline instead (Whisper ASR → Kokoro TTS).

Usage:
    python src/process-audio.py [--dir work/audio] [--list work/manifest.json]

Exit codes:
    0 = success (all files processed)
    1 = hard error (missing deps, etc.)
    2 = partial failure (some files failed, see report)
"""

import sys
import os
import json
import argparse
import shutil
from pathlib import Path
from typing import List, Dict, Tuple, Optional

# ---- Dependency checks -------------------------------------------------------

REQUIRED_DEPS = {
    'noisereduce': 'noisereduce',
    'pydub': 'pydub',
    'scipy': 'scipy',
    'numpy': 'numpy',
    'soundfile': 'soundfile',
    'pyloudnorm': 'pyloudnorm',
    'resampy': 'resampy',
}

TARGET_SR = 11025          # VoiceBuilder standard
TARGET_BITS = 16
TARGET_CHANNELS = 1
TARGET_LUFS = -23.0        # EBU R128 broadcast standard


def check_deps() -> Tuple[bool, List[str]]:
    """Verify required Python packages are installed."""
    missing = []
    for mod, pip_name in REQUIRED_DEPS.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pip_name)
    return len(missing) == 0, missing


# ---- Audio I/O helpers -------------------------------------------------------

def read_wav(path: Path) -> Tuple[int, 'np.ndarray']:
    import soundfile as sf
    data, sr = sf.read(path, dtype='float32', always_2d=True)  # (frames, channels)
    return sr, data


def write_wav(path: Path, sr: int, data: 'np.ndarray') -> None:
    import soundfile as sf
    # Ensure mono, 16-bit PCM
    if data.ndim == 2 and data.shape[1] > 1:
        data = data.mean(axis=1, keepdims=True)
    sf.write(path, data, sr, subtype='PCM_16')


def ensure_mono_11k(data: 'np.ndarray', sr: int) -> Tuple[int, 'np.ndarray']:
    """Resample to 11 kHz mono if needed."""
    import resampy
    if data.shape[1] > 1:
        data = data.mean(axis=1, keepdims=True)
    if sr != TARGET_SR:
        data = resampy.resample(data.T, sr, TARGET_SR, axis=0).T
        sr = TARGET_SR
    return sr, data


# ---- 1. Noise Reduction ------------------------------------------------------

def reduce_noise(data: 'np.ndarray', sr: int, stationary: bool = True) -> 'np.ndarray':
    """Spectral gating noise reduction via noisereduce.

    Uses conservative settings to avoid musical noise / choppy artifacts:
    - stationary=True: assumes relatively constant background noise (fan, AC, room tone)
    - prop_decrease=0.4: only 40% reduction, preserves speech naturalness
    - n_fft=1024: finer frequency resolution for speech
    """
    import noisereduce as nr
    # noisereduce expects (channels, frames) or (frames,)
    if data.ndim == 2:
        data = data.T  # (channels, frames)
    reduced = nr.reduce_noise(
        y=data,
        sr=sr,
        stationary=stationary,
        prop_decrease=0.4,       # conservative: avoid choppy/musical artifacts
        n_fft=1024,              # finer freq resolution for speech
        win_length=400,          # ~36ms at 11kHz, good for speech
        hop_length=100,          # 25% overlap
        n_std_thresh_stationary=1.5,  # less aggressive threshold
    )
    if reduced.ndim == 2:
        reduced = reduced.T  # back to (frames, channels)
    return reduced


# ---- 2. Volume Normalization -------------------------------------------------

def normalize_loudness(data: 'np.ndarray', sr: int, target_lufs: float = TARGET_LUFS) -> 'np.ndarray':
    """EBU R128 loudness normalization to target LUFS.
    
    pyloudnorm 0.2.0 expects (frames, channels) format.
    
    Safety guards:
    - Skip if audio too short (< 0.5s): loudness measurement unreliable
    - Skip if measured loudness invalid: avoid amplifying noise
    - Cap gain at ±12 dB: prevent extreme amplification of residual noise
    """
    import pyloudnorm as pyln
    import numpy as np
    
    # Skip if too short (loudness measurement needs ~0.5s+ for reliability)
    duration = data.shape[0] / sr
    if duration < 0.5:
        return data
    
    meter = pyln.Meter(sr)  # BS.1770 meter
    # data shape: (frames, channels) - pyloudnorm 0.2.0 expects this format
    loudness = meter.integrated_loudness(data)
    
    # Invalid loudness (silent, NaN, extreme) — skip normalization
    if loudness == -float('inf') or abs(loudness) > 100 or np.isnan(loudness):
        return data
    
    # Calculate required gain
    gain_db = target_lufs - loudness
    
    # Cap gain to ±12 dB to avoid amplifying residual noise / clipping
    MAX_GAIN_DB = 12.0
    if abs(gain_db) > MAX_GAIN_DB:
        gain_db = np.sign(gain_db) * MAX_GAIN_DB
    
    # Apply gain directly (more predictable than pyln.normalize.loudness)
    gain_linear = 10 ** (gain_db / 20.0)
    normalized = data * gain_linear
    
    # Soft clip prevention
    max_val = np.max(np.abs(normalized))
    if max_val > 0.99:
        normalized = normalized * (0.99 / max_val)
    
    return normalized


# ---- Main processing pipeline ------------------------------------------------

def process_file(
    in_path: Path,
    out_path: Path
) -> Dict:
    """Process a single WAV file. Returns status dict."""
    import numpy as np

    try:
        # Read
        sr, data = read_wav(in_path)
        orig_sr, orig_shape = sr, data.shape

        # 1. Noise reduction
        print(f"  [NR] {in_path.name}")
        data = reduce_noise(data, sr)

        # 2. Loudness normalization
        print(f"  [LN] {in_path.name}")
        data = normalize_loudness(data, sr)

        # 3. Ensure final format: 11 kHz mono 16-bit
        sr, data = ensure_mono_11k(data, sr)
        write_wav(out_path, sr, data)

        return {
            'file': in_path.name,
            'status': 'ok',
            'orig_sr': orig_sr,
            'orig_shape': list(orig_shape),
            'final_sr': sr,
            'final_shape': list(data.shape),
        }

    except Exception as e:
        return {
            'file': in_path.name,
            'status': 'error',
            'error': str(e),
        }


def main():
    parser = argparse.ArgumentParser(description='VoiceBuilder audio post-processing')
    parser.add_argument('--dir', default='work/audio', help='Input/output directory (default: work/audio)')
    parser.add_argument('--list', default='work/manifest.json', help='Expected file list (JSON)')
    parser.add_argument('--file', help='Process a single file (relative to --dir) instead of the full list')
    parser.add_argument('--backup', action='store_true', help='Backup original files to .bak before overwriting')
    parser.add_argument('--json', action='store_true', help='Print JSON result to stdout (for API consumption)')
    args = parser.parse_args()

    # Resolve paths
    root = Path(__file__).parent.parent
    # Server passes absolute paths; treat as-is if absolute, else relative to root
    audio_dir = Path(args.dir) if Path(args.dir).is_absolute() else root / args.dir
    list_path = Path(args.list) if Path(args.list).is_absolute() else root / args.list

    if not audio_dir.exists():
        print(f"Audio directory not found: {audio_dir}")
        return 1

    # Determine files to process
    if args.file:
        files_to_process = [args.file]
        # For single file mode, manifest is optional (just validates the file exists)
        if not list_path.exists():
            print(f"Manifest not found: {list_path} (continuing with single file mode)")
    else:
        if not list_path.exists():
            print(f"Expected list not found: {list_path}")
            return 1
        expected = json.loads(list_path.read_text(encoding='utf-8'))
        files_to_process = [item.get('file') or f"{item['id']}.wav" for item in expected]

    # Check deps
    ok, missing = check_deps()
    if not ok:
        print(f"Missing dependencies: {', '.join(missing)}")
        print(f"Install with: pip install {' '.join(missing)}")
        return 1

    # Process each file
    results = []
    errors = 0

    for fname in files_to_process:
        in_path = audio_dir / fname
        if not in_path.exists():
            print(f"  [SKIP] {fname} — not found")
            results.append({'file': fname, 'status': 'skipped', 'reason': 'not found'})
            continue

        # Backup if requested
        if args.backup:
            bak_path = in_path.with_suffix('.wav.bak')
            if not bak_path.exists():
                shutil.copy2(in_path, bak_path)

        print(f"Processing {fname}...")
        result = process_file(in_path, in_path)
        results.append(result)
        if result['status'] == 'error':
            errors += 1
            print(f"  ERROR: {result['error']}")

    # Write report
    reports_dir = root / 'work' / 'reports'
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / 'audio-processing-report.json'
    report_data = {
        'processed': len([r for r in results if r['status'] == 'ok']),
        'skipped': len([r for r in results if r['status'] == 'skipped']),
        'errors': errors,
        'details': results,
    }
    report_path.write_text(json.dumps(report_data, indent=2, ensure_ascii=False), encoding='utf-8')

    # Output JSON to stdout if requested (for API consumption)
    if args.json:
        print(json.dumps(report_data, ensure_ascii=False))

    print(f"\nDone. Processed: {len([r for r in results if r['status'] == 'ok'])}, "
          f"Skipped: {len([r for r in results if r['status'] == 'skipped'])}, "
          f"Errors: {errors}")
    print(f"Report: {report_path}")

    return 0 if errors == 0 else 2


if __name__ == '__main__':
    sys.exit(main())