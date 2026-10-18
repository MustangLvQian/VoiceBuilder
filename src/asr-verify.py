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
                           [--only id,id] [--json]
Exit: 0 when nothing FAILs, 1 when at least one clip FAILs.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_text import (  # noqa: E402
    format_diff,
    load_model,
    normalize,
    read_wav_mono16,
    similarity,
    transcribe,
)

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]
WORK = ROOT / "work"
AUDIO_DIR = WORK / "audio"
REPORTS_DIR = WORK / "reports"
DEFAULT_MODEL = ROOT / "models" / "vosk-model-small-en-us-0.15"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser(description="Offline ASR check of the recording set.")
    ap.add_argument("--dir", default=str(AUDIO_DIR))
    ap.add_argument("--list", default="")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--only", default="", help="comma-separated ids to check")
    ap.add_argument("--json", action="store_true", help="print a JSON result to stdout")
    ap.add_argument("--no-report", action="store_true",
                    help="do not write the markdown report (used for one-clip re-checks)")
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
        print(f"Expected list not found: {list_path}", file=sys.stderr)
        return 1
    expected = json.loads(list_path.read_text(encoding="utf-8-sig"))

    only = {i.strip() for i in args.only.split(",") if i.strip()}
    if only:
        expected = [item for item in expected if item.get("id") in only]

    model_path = Path(args.model)
    if not model_path.is_absolute():
        model_path = ROOT / args.model
    if not (model_path / "am").exists():
        print(f"ASR model not found: {model_path}", file=sys.stderr)
        print("Run: pip install vosk   then   npm run model", file=sys.stderr)
        return 1

    model = load_model(model_path)
    if model is None:
        print("vosk is not installed. Run: pip install vosk", file=sys.stderr)
        return 1

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

        got_text = transcribe(model, frames, rate)

        exp_tokens = normalize(item.get("text", ""))
        got_tokens = normalize(got_text)
        sim = similarity(exp_tokens, got_tokens)

        if sim >= args.pass_threshold:
            status = "PASS"; oks += 1
        elif sim >= args.review_threshold:
            status = "REVIEW"; reviews += 1
        else:
            status = "FAIL"; fails += 1

        diff = "" if status == "PASS" else format_diff(exp_tokens, got_tokens)
        rows.append({"file": file, "id": item.get("id", ""), "status": status,
                     "sim": sim, "expected": item.get("text", ""), "got": got_text, "diff": diff})

    total = len(expected)
    if args.json:
        print(json.dumps({
            "total": total, "pass": oks, "review": reviews, "fail": fails, "skip": skipped,
            "rows": rows,
        }, ensure_ascii=False))
        return 1 if fails else 0

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

    if not args.no_report:
        report_path = REPORTS_DIR / "recording-asr-check.md"
        report_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"Report: {report_path.relative_to(ROOT).as_posix()}")

    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
