#!/usr/bin/env python3
"""Offline speech check: transcribes each recording and diffs it against the
sentence it is supposed to contain.

The companion of src/check-recordings.mjs. That tool catches missing files,
wrong format, silence and clipping; this one catches the wrong words — a clip
recorded against the wrong line, a sentence half-read, a word the narrator
fluffed.

It runs fully offline with Vosk. It is a second opinion, not a judge: ASR
mishears proper nouns, numbers and quiet syllables, so a row is only a hard
FAIL when the transcript barely resembles the expected line. Anything close
lands in REVIEW for a human to confirm by ear.

Setup (once per machine):
  1. pip install vosk
  2. npm run model        (or: powershell -ExecutionPolicy Bypass -File src/fetch-asr-model.ps1)

Run:
  python src/asr-verify.py [--dir work/audio] [--list work/manifest.json]
                           [--model models/vosk-model-small-en-us-0.15]
Exit: 0 when nothing FAILs, 1 when at least one clip FAILs.
"""
import argparse
import json
import re
import sys
import wave
from difflib import SequenceMatcher
from pathlib import Path

try:
    import audioop
except ImportError:  # removed in Python 3.13
    audioop = None

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]
WORK = ROOT / "work"
AUDIO_DIR = WORK / "audio"
REPORTS_DIR = WORK / "reports"
DEFAULT_MODEL = ROOT / "models" / "vosk-model-small-en-us-0.15"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40",
    "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80",
    "ninety": "90", "hundred": "100",
}


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
    return stem(a) == stem(b) or soundex(a) == soundex(b)


def word_diff(expected, got):
    """Word-level alignment where ASR-noise variants (stems/homophones) count as equal."""
    out = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(a=expected, b=got, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend(("=", w) for w in expected[i1:i2])
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for a, b in zip(expected[i1:i2], got[j1:j2]):
                out.append(("=", a) if equivalent(a, b) else ("~", f"{a}→{b}"))
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


def resample_to_16k(frames, sampwidth, rate):
    if rate == 16000:
        return frames, 16000
    if audioop is not None:
        return audioop.ratecv(frames, sampwidth, 1, rate, 16000, None)[0], 16000
    import array
    src = array.array("h")
    src.frombytes(frames)
    n_out = int(len(src) * 16000 / rate)
    out = array.array("h", [0]) * n_out
    for i in range(n_out):
        pos = i * rate / 16000
        i0 = int(pos)
        frac = pos - i0
        s0 = src[i0] if i0 < len(src) else 0
        s1 = src[i0 + 1] if i0 + 1 < len(src) else s0
        out[i] = int(s0 + (s1 - s0) * frac)
    return out.tobytes(), 16000


def read_wav_mono16(path):
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        channels = w.getnchannels()
        sampwidth = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if sampwidth != 2:
        if audioop is None:
            raise ValueError(f"unsupported sample width {sampwidth * 8}-bit without audioop")
        frames = audioop.lin2lin(frames, sampwidth, 2)
        sampwidth = 2
    if channels != 1:
        if audioop is None:
            raise ValueError("stereo input needs audioop")
        frames = audioop.tomono(frames, sampwidth, 0.5, 0.5)
    return resample_to_16k(frames, sampwidth, rate)


def main():
    ap = argparse.ArgumentParser(description="Offline ASR check of the recording set.")
    ap.add_argument("--dir", default=str(AUDIO_DIR))
    ap.add_argument("--list", default="")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--pass-threshold", type=float, default=0.90)
    ap.add_argument("--review-threshold", type=float, default=0.70)
    args = ap.parse_args()

    directory = Path(args.dir)
    if not directory.is_absolute():
        directory = ROOT / directory
    if args.list:
        list_path = Path(args.list)
        if not list_path.is_absolute():
            list_path = ROOT / list_path
    else:
        manifest = WORK / "manifest.json"
        list_path = manifest if manifest.exists() else WORK / "recording-worklist.json"

    if not list_path.exists():
        print(f"Expected list not found: {list_path}")
        return 1
    expected = json.loads(list_path.read_text(encoding="utf-8-sig"))

    model_path = Path(args.model)
    if not model_path.is_absolute():
        model_path = ROOT / args.model
    if not (model_path / "am").exists():
        print(f"ASR model not found: {model_path}")
        print("Run: pip install vosk   then   npm run model")
        return 1

    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
    except ImportError:
        print("vosk is not installed. Run: pip install vosk")
        return 1

    SetLogLevel(-1)
    model = Model(str(model_path))

    rows = []
    fails = reviews = oks = skipped = 0
    for item in expected:
        file = item.get("file") or f"{item['id']}.wav"
        path = directory / file
        if not path.exists():
            skipped += 1
            rows.append({"file": file, "id": item.get("id", ""), "status": "SKIP",
                         "sim": None, "expected": item.get("text", ""), "got": "", "diff": "文件缺失"})
            continue
        try:
            frames, rate = read_wav_mono16(path)
        except Exception as e:
            skipped += 1
            rows.append({"file": file, "id": item.get("id", ""), "status": "SKIP",
                         "sim": None, "expected": item.get("text", ""), "got": "", "diff": f"无法读取：{e}"})
            continue

        rec = KaldiRecognizer(model, rate)
        rec.AcceptWaveform(frames)
        got_text = json.loads(rec.FinalResult()).get("text", "")

        exp_tokens = normalize(item.get("text", ""))
        got_tokens = normalize(got_text)
        sim = similarity(exp_tokens, got_tokens)

        if sim >= args.pass_threshold:
            status = "PASS"; oks += 1
        elif sim >= args.review_threshold:
            status = "REVIEW"; reviews += 1
        else:
            status = "FAIL"; fails += 1

        diff = ""
        if status != "PASS":
            glyph = {"=": lambda w: w, "-": lambda w: "−" + w, "+": lambda w: "+" + w,
                     "~": lambda w: f"({w})"}
            diff = " ".join(glyph[t](w) for t, w in word_diff(exp_tokens, got_tokens))
        rows.append({"file": file, "id": item.get("id", ""), "status": status,
                     "sim": sim, "expected": item.get("text", ""), "got": got_text, "diff": diff})

    total = len(expected)
    print(f"ASR check: {total} expected clips in {directory.name}")
    print(f"  PASS: {oks}, REVIEW: {reviews}, FAIL: {fails}, SKIP: {skipped}")
    for r in rows:
        if r["status"] in ("FAIL", "REVIEW"):
            sim = "" if r["sim"] is None else f"{r['sim'] * 100:.0f}%"
            print(f"  {r['status']:6} {sim:>4}  {r['file']}")
    if fails:
        print("\nFAIL means the transcript little resembles the expected line - check the clip.")
    if reviews:
        print("REVIEW means close but not exact - confirm by ear before accepting.")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 录音内容校验报告（ASR，自动生成）",
        "",
        "> 由 `python src/asr-verify.py` 生成，使用 Vosk 离线英文模型。",
        f"> 清单：`{list_path.relative_to(ROOT).as_posix()}`；目录：`{directory.name}`",
        "> 这是**第二意见**，不是判决：专有名词、数字、轻读会被识别错。",
        "> PASS=基本一致；REVIEW=接近但需人工听辨；FAIL=与预期台词几乎不符。",
        "",
        f"- PASS：{oks}",
        f"- REVIEW：{reviews}",
        f"- FAIL：{fails}",
        f"- SKIP（缺失/无法读取）：{skipped}",
        "",
        "## 需要人工确认的行（FAIL / REVIEW）",
        "",
    ]
    attention = [r for r in rows if r["status"] in ("FAIL", "REVIEW")]
    if not attention:
        lines.append("无。")
    else:
        lines.append("| 文件 | 状态 | 相似度 | 差异（− 预期 / + 识别） |")
        lines.append("|---|---|---|---|")
        for r in attention:
            sim = "" if r["sim"] is None else f"{r['sim'] * 100:.0f}%"
            lines.append(f"| `{r['file']}` | {r['status']} | {sim} | {r['diff'] or ''} |")
    lines += ["", "## 全部明细", "", "| 文件 | 状态 | 相似度 | 预期台词 | 识别结果 |", "|---|---|---|---|---|"]
    for r in rows:
        sim = "" if r["sim"] is None else f"{r['sim'] * 100:.0f}%"
        exp = str(r["expected"]).replace("|", "\\|")
        got = str(r["got"]).replace("|", "\\|")
        lines.append(f"| `{r['file']}` | {r['status']} | {sim} | {exp} | {got} |")
    lines.append("")
    report_path = REPORTS_DIR / "recording-asr-check.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {report_path.relative_to(ROOT).as_posix()}")

    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
