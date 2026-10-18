#!/usr/bin/env python3
"""Transcodes the reference samples to small Ogg/Opus files for the phone app.

The 89 reference WAVs are 11 kHz/16-bit and total ~13 MB - fine on a laptop, a
waste inside an APK. Speech at 24 kbps mono is indistinguishable for the purpose
(playing a line back so the narrator can copy it), and the browser decodes Opus
natively, so this shrinks the bundle to about a tenth with no codec work at
runtime.

Input :  work/samples/*.wav
Output:  mobile-dist/samples/<name>.ogg
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default=str(ROOT / "work" / "samples"))
    ap.add_argument("--out", dest="dst", default=str(ROOT / "mobile-dist" / "samples"))
    ap.add_argument("--bitrate", type=int, default=24000)
    ap.add_argument("--rate", type=int, default=48000)
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    if not src.is_absolute():
        src = ROOT / src
    if not dst.is_absolute():
        dst = ROOT / dst
    if not src.exists():
        print(f"No samples directory: {src}", file=sys.stderr)
        return 1

    try:
        import av
    except ImportError:
        print("PyAV is required: pip install av", file=sys.stderr)
        return 1

    wavs = sorted(src.glob("*.wav"))
    if not wavs:
        print(f"No .wav in {src}", file=sys.stderr)
        return 1

    dst.mkdir(parents=True, exist_ok=True)
    total_in = total_out = 0
    for wav in wavs:
        target = dst / (wav.stem + ".ogg")
        with av.open(str(wav)) as source:
            stream_in = source.streams.audio[0]
            with av.open(str(target), "w", format="ogg") as out:
                stream = out.add_stream("libopus", rate=args.rate)
                stream.layout = "mono"
                stream.bit_rate = args.bitrate
                resampler = av.AudioResampler(format="s16", layout="mono", rate=args.rate)
                for frame in source.decode(stream_in):
                    for resampled in resampler.resample(frame):
                        for packet in stream.encode(resampled):
                            out.mux(packet)
                for packet in stream.encode(None):
                    out.mux(packet)
        total_in += wav.stat().st_size
        total_out += target.stat().st_size

    print(f"Transcoded {len(wavs)} samples -> {dst}")
    print(f"  {total_in / 1048576:.1f} MB -> {total_out / 1048576:.1f} MB "
          f"({total_out / max(total_in, 1) * 100:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
