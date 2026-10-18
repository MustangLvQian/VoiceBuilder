"""Shared text and audio helpers for the recording tools.

asr-verify.py (checks a finished set) and ingest.py (imports raw recordings and
works out which line each one is) must agree on exactly two things: how a spoken
sentence is normalised for comparison, and how an arbitrary audio file is turned
into the 11 kHz / 16-bit / mono PCM the App expects. Both live here so the two
tools cannot drift apart.
"""
import array
import json
import re
import wave
from difflib import SequenceMatcher
from pathlib import Path

try:  # removed in Python 3.13
    import audioop
except ImportError:
    audioop = None

# The App ships 11 kHz / 16-bit / mono so each audio subpackage stays under the
# WeChat 2 MB limit. Vosk wants 16 kHz.
SAMPLE_RATE = 11025
ASR_RATE = 16000

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40",
    "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80",
    "ninety": "90", "hundred": "100",
}


# --------------------------------------------------------------------------- text

def normalize(text):
    """Lower-case, drop punctuation and apostrophes, canonicalise numbers."""
    t = text.lower().replace("\u2019", "'")
    t = re.sub(r"[^a-z0-9'\s]", " ", t).replace("'", "")
    return [NUMBER_WORDS.get(tok, tok) for tok in t.split()]


_SOUNDEX = {
    "b": "1", "f": "1", "p": "1", "v": "1",
    "c": "2", "g": "2", "j": "2", "k": "2", "q": "2", "s": "2", "x": "2", "z": "2",
    "d": "3", "t": "3", "l": "4", "m": "5", "n": "5", "r": "6",
}


def soundex(word):
    """American Soundex, so homophones (red/read, Ben/been, colour/color) agree."""
    if not word or not word[0].isalpha():
        return word
    word = word.lower()
    out = word[0].upper()
    prev = _SOUNDEX.get(word[0], "")
    for ch in word[1:]:
        code = _SOUNDEX.get(ch, "")
        if code:
            if code != prev:
                out += code
            prev = code
        elif ch not in ("h", "w"):
            prev = ""
    return (out + "000")[:4]


def stem(word):
    """Crude suffix strip, so reads/read, checks/checked, add/added agree."""
    for suffix in ("ing", "edly", "ed", "ly", "es", "s"):
        if len(word) > len(suffix) + 1 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def equivalent(a, b):
    if a == b:
        return True
    return stem(a) == stem(b)


def word_diff(expected, got):
    """Word alignment where ASR-noise variants (stems/homophones) count as equal."""
    out = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(a=expected, b=got, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend(("=", w) for w in expected[i1:i2])
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for a, b in zip(expected[i1:i2], got[j1:j2]):
                out.append(("=", a) if equivalent(a, b) else ("~", f"{a}\u2192{b}"))
        else:
            out.extend(("-", w) for w in expected[i1:i2])
            out.extend(("+", w) for w in got[j1:j2])
    return out


def similarity(expected, got):
    """1 - (alignment distance / length), with equivalent words costing 0."""
    if not expected and not got:
        return 1.0
    if not expected or not got:
        return 0.0
    n, m = len(expected), len(got)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if equivalent(expected[i - 1], got[j - 1]) else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return 1 - prev[m] / max(n, m)


def format_diff(expected_tokens, got_tokens):
    glyph = {"=": lambda w: w, "-": lambda w: "\u2212" + w, "+": lambda w: "+" + w,
             "~": lambda w: f"({w})"}
    return " ".join(glyph[t](w) for t, w in word_diff(expected_tokens, got_tokens))


# -------------------------------------------------------------------------- audio

def resample_pcm16(frames, src_rate, dst_rate):
    """Linear-interpolation resample of 16-bit mono PCM. Vosk is rate-sensitive."""
    if src_rate == dst_rate:
        return frames
    if audioop is not None:
        return audioop.ratecv(frames, 2, 1, src_rate, dst_rate, None)[0]
    src = array.array("h")
    src.frombytes(frames)
    n_out = int(len(src) * dst_rate / src_rate)
    out = array.array("h", [0]) * n_out
    for i in range(n_out):
        pos = i * src_rate / dst_rate
        i0 = int(pos)
        frac = pos - i0
        s0 = src[i0] if i0 < len(src) else 0
        s1 = src[i0 + 1] if i0 + 1 < len(src) else s0
        out[i] = int(s0 + (s1 - s0) * frac)
    return out.tobytes()


def read_wav_mono16(path):
    """Read a 16 kHz mono PCM16 buffer from a WAV, for ASR. stdlib only, so the
    ASR numbers do not depend on optional decoders being installed."""
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        channels = w.getnchannels()
        sampwidth = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if sampwidth != 2:
        if audioop is None:
            raise ValueError(f"unsupported sample width {sampwidth * 8}-bit without audioop")
        frames = audioop.lin2lin(frames, sampwidth, 2)
    if channels != 1:
        if audioop is None:
            raise ValueError("stereo input needs audioop")
        frames = audioop.tomono(frames, 2, 0.5, 0.5)
    return resample_pcm16(frames, rate, ASR_RATE), ASR_RATE


def _decode_with_wav(path, sample_rate):
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        channels = w.getnchannels()
        sampwidth = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if sampwidth != 2:
        if audioop is None:
            raise ValueError("cannot read non-16-bit WAV without audioop")
        frames = audioop.lin2lin(frames, sampwidth, 2)
    if channels != 1:
        if audioop is None:
            raise ValueError("cannot downmix without audioop")
        frames = audioop.tomono(frames, 2, 0.5, 0.5)
    return resample_pcm16(frames, rate, sample_rate)


def _decode_with_av(path, sample_rate):
    import av
    out = bytearray()
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError("file has no audio stream")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                out += bytes(resampled.planes[0])
        if hasattr(resampler, "resample"):
            try:
                for resampled in resampler.resample(None):
                    out += bytes(resampled.planes[0])
            except Exception:
                pass
    return bytes(out)


def decode_to_pcm16_mono(path, sample_rate=SAMPLE_RATE):
    """Decode any audio file (wav/mp3/m4a/aac/opus/ogg/flac/...) to mono PCM16.

    PyAV bundles FFmpeg, so no system ffmpeg is needed; it is only required for
    non-WAV input. WAV falls back to the stdlib so the tool still works without
    the optional dependency.
    """
    path = Path(path)
    if path.suffix.lower() == ".wav":
        try:
            return _decode_with_wav(path, sample_rate)
        except Exception:
            pass
    try:
        import av  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            f"cannot decode {path.name}: install PyAV for non-WAV audio (pip install av)"
        ) from exc
    return _decode_with_av(path, sample_rate)


def write_wav_mono16(path, frames, rate=SAMPLE_RATE):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)


# ---------------------------------------------------------------------- ASR model

def load_model(model_path):
    """Load a Vosk model, or return None when vosk/model are unavailable."""
    try:
        from vosk import Model, SetLogLevel
    except ImportError:
        return None
    SetLogLevel(-1)
    return Model(str(model_path))


def transcribe(model, frames, rate=ASR_RATE):
    from vosk import KaldiRecognizer
    rec = KaldiRecognizer(model, rate)
    rec.AcceptWaveform(frames)
    return json.loads(rec.FinalResult()).get("text", "")
