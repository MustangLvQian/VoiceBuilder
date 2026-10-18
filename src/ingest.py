#!/usr/bin/env python3
"""Imports raw recordings (phone m4a/mp3, recorder wav, ...) into the recording set.

The problem this solves: a phone hands you `IMG_4821.m4a`, but the App needs
`grade3-primary-core-v1--g3-core-listen-03.wav`. Naming them all by hand is the
tedious, error-prone part of a 89-clip recording session.

Three ways to work out which line a file is, tried in order:

  1. Name      - the file stem already is the id or the expected file name.
  2. ASR       - transcribe it and match against every line in the worklist,
                 accepting the best hit only when it is close and clearly ahead
                 of the runner-up. Anything ambiguous is left for a human.
  3. Order     - `--assume-order` maps the inbox in natural file-name order onto
                 the worklist in order. Use it when you deliberately recorded
                 straight down the list.

Accepted files are decoded and written as 11 kHz / 16-bit / mono WAV under
work/audio/<id>.wav - exactly what check-recordings, asr-verify and pack expect.
Imported originals are moved to work/inbox/imported/ so a re-run is idempotent;
unmatched ones are left in the inbox and listed in the report.

Setup: pip install vosk av   then   npm run model
Run:    npm run ingest   (or: python src/ingest.py [--inbox] [--out] [--dry-run])
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_text import (  # noqa: E402
    ASR_RATE,
    SAMPLE_RATE,
    decode_to_pcm16_mono,
    format_diff,
    load_model,
    normalize,
    similarity,
    transcribe,
    write_wav_mono16,
)

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]
WORK = ROOT / "work"
INBOX_DIR = WORK / "inbox"
AUDIO_DIR = WORK / "audio"
REPORTS_DIR = WORK / "reports"
DEFAULT_MODEL = ROOT / "models" / "vosk-model-small-en-us-0.15"
RECORDING_WORKLIST = WORK / "recording-worklist.json"

AUDIO_SUFFIXES = {
    ".wav", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".oga", ".flac",
    ".wma", ".mp4", ".m4v", ".webm", ".amr", ".aiff", ".aif", ".caf", ".3gp",
}

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def natural_key(name):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def resolve(path):
    path = Path(path)
    return path if path.is_absolute() else ROOT / path


def main():
    ap = argparse.ArgumentParser(description="Import raw recordings into the recording set.")
    ap.add_argument("--inbox", default=str(INBOX_DIR))
    ap.add_argument("--out", default=str(AUDIO_DIR))
    ap.add_argument("--list", default=str(RECORDING_WORKLIST))
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--assume-order", action="store_true",
                    help="map the inbox in file-name order onto the worklist in order")
    ap.add_argument("--match-threshold", type=float, default=0.75)
    ap.add_argument("--match-margin", type=float, default=0.12)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    inbox = resolve(args.inbox)
    out_dir = resolve(args.out)
    list_path = resolve(args.list)
    model_path = resolve(args.model)
    # Keep imported originals next to the inbox they came from, not next to the
    # default one: --inbox is usually a temporary folder.
    imported_dir = inbox / "imported"

    if not list_path.exists():
        print(f"Worklist not found: {list_path}", file=sys.stderr)
        print("Run: npm run worklists", file=sys.stderr)
        return 1
    worklist = json.loads(list_path.read_text(encoding="utf-8-sig"))
    if not worklist:
        print("Worklist is empty.", file=sys.stderr)
        return 1

    for item in worklist:
        item.setdefault("file", f"{item['id']}.wav")

    by_stem = {}
    for item in worklist:
        by_stem[item["id"].lower()] = item
        by_stem[Path(item["file"]).stem.lower()] = item

    if not inbox.exists():
        print(f"Inbox folder does not exist yet: {inbox}")
        print("Drop recordings into it and run again. Nothing to do.")
        return 0

    candidates = sorted(
        (p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES),
        key=lambda p: natural_key(p.name),
    )
    if not candidates:
        print(f"No audio files in {inbox.relative_to(ROOT).as_posix()}.")
        return 0

    # ---- decide each file's target, cheaply first -------------------------------
    plans = []       # {path, item, how, sim, got, diff, reason}
    for path in candidates:
        item = by_stem.get(path.stem.lower())
        if item:
            plans.append({"path": path, "item": item, "how": "文件名", "sim": None,
                          "got": "", "diff": "", "reason": ""})
            continue
        plans.append({"path": path, "how": "", "item": None, "sim": None,
                      "got": "", "diff": "", "reason": ""})

    unnamed = [p for p in plans if not p["item"]]

    if unnamed and args.assume_order:
        taken = {p["item"]["id"] for p in plans if p["item"]}
        # Work out which worklist lines still need a file, honouring the ones the
        # recorder named by hand.
        remaining = [it for it in worklist if it["id"] not in taken]
        if len(unnamed) > len(remaining):
            print(f"--assume-order: {len(unnamed)} unnamed files but only "
                  f"{len(remaining)} worklist lines left; extras cannot be placed.", file=sys.stderr)
        for plan, item in zip(unnamed, remaining):
            plan["item"] = item
            plan["how"] = "顺序"
        unnamed = [p for p in plans if not p["item"]]

    if unnamed:
        if not (model_path / "am").exists():
            print(f"ASR model not found: {model_path}", file=sys.stderr)
            print("Install it to let unnamed recordings be identified: pip install vosk && npm run model", file=sys.stderr)
            print("(or name the files after their ids, or pass --assume-order)", file=sys.stderr)
            return 1
        model = load_model(model_path)
        if model is None:
            print("vosk is not installed. Run: pip install vosk", file=sys.stderr)
            return 1

        corpus = [(it, normalize(it.get("text", ""))) for it in worklist]
        for plan in unnamed:
            try:
                frames = decode_to_pcm16_mono(plan["path"], ASR_RATE)
                got_text = transcribe(model, frames, ASR_RATE)
            except Exception as exc:
                plan["reason"] = f"无法读取：{exc}"
                continue
            got_tokens = normalize(got_text)
            scored = sorted(
                ((similarity(tokens, got_tokens), it) for it, tokens in corpus),
                key=lambda pair: pair[0], reverse=True,
            )
            best_sim, best_item = scored[0]
            runner_sim = scored[1][0] if len(scored) > 1 else 0.0
            plan["sim"] = best_sim
            plan["got"] = got_text
            if best_sim >= args.match_threshold and best_sim - runner_sim >= args.match_margin:
                plan["item"] = best_item
                plan["how"] = "识别"
                plan["diff"] = format_diff(normalize(best_item.get("text", "")), got_tokens)
            else:
                plan["reason"] = (
                    f"识别不确定（最高 {best_sim * 100:.0f}% vs 次高 {runner_sim * 100:.0f}%，"
                    f"最像 “{best_item['id']}”）"
                )

    # ---- one file per line ------------------------------------------------------
    claimed = {}
    for plan in sorted(plans, key=lambda p: (p["sim"] if p["sim"] is not None else 1.0), reverse=True):
        if not plan["item"]:
            continue
        key = plan["item"]["id"]
        if key in claimed:
            plan["item"] = None
            plan["reason"] = f"另一份文件已占用了 “{key}”，这份未被导入"
            continue
        claimed[key] = plan

    # ---- write ------------------------------------------------------------------
    imported, failed = [], []
    for plan in plans:
        if not plan["item"]:
            failed.append(plan)
            continue
        target = out_dir / plan["item"]["file"]
        existed = target.exists()
        plan["target"] = target
        plan["replaced"] = existed
        if args.dry_run:
            imported.append(plan)
            continue
        try:
            frames = decode_to_pcm16_mono(plan["path"], SAMPLE_RATE)
            write_wav_mono16(target, frames, SAMPLE_RATE)
        except Exception as exc:
            plan["reason"] = f"转码失败：{exc}"
            failed.append(plan)
            continue
        imported.append(plan)
        imported_dir.mkdir(parents=True, exist_ok=True)
        destination = imported_dir / plan["path"].name
        counter = 1
        while destination.exists():
            destination = imported_dir / f"{plan['path'].stem}-{counter}{plan['path'].suffix}"
            counter += 1
        shutil.move(str(plan["path"]), str(destination))

    # ---- report -----------------------------------------------------------------
    print(f"Ingest: {len(candidates)} file(s) in {inbox.relative_to(ROOT).as_posix()}"
          + ("  [dry run]" if args.dry_run else ""))
    print(f"  imported: {len(imported)}, not placed: {len(failed)}")
    for plan in imported:
        sim = "" if plan["sim"] is None else f" {plan['sim'] * 100:3.0f}%"
        note = " (覆盖)" if plan.get("replaced") else ""
        print(f"  {plan['how']}{sim}  {plan['path'].name} -> {plan['item']['file']}{note}")
    for plan in failed:
        print(f"  ????       {plan['path'].name}  {plan['reason']}")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 录音导入报告（自动生成）",
        "",
        "> 由 `python src/ingest.py` 生成。",
        f"> 来源：`{inbox.relative_to(ROOT).as_posix()}`；目标：`{out_dir.relative_to(ROOT).as_posix()}`",
        f"> 清单：`{list_path.relative_to(ROOT).as_posix()}`",
        "",
        f"- 导入：{len(imported)}",
        f"- 未归位：{len(failed)}",
        "",
        "## 已导入",
        "",
    ]
    if not imported:
        lines.append("无。")
    else:
        lines.append("| 原文件 | 判定 | 相似度 | 目标文件 |")
        lines.append("|---|---|---|---|")
        for plan in imported:
            sim = "" if plan["sim"] is None else f"{plan['sim'] * 100:.0f}%"
            lines.append(f"| `{plan['path'].name}` | {plan['how']} | {sim} | `{plan['item']['file']}` |")
    lines += ["", "## 未归位（需要人工处理）", ""]
    if not failed:
        lines.append("无。")
    else:
        lines.append("| 原文件 | 原因 | 识别结果 |")
        lines.append("|---|---|---|")
        for plan in failed:
            got = str(plan.get("got", "")).replace("|", "\\|")
            lines.append(f"| `{plan['path'].name}` | {plan['reason']} | {got} |")
    lines.append("")
    lines.append("> 未归位的文件留在 inbox 里。可给它们取名成目标 id，或逐条确认后再跑一次。")
    lines.append("")
    report_path = REPORTS_DIR / "recording-ingest.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {report_path.relative_to(ROOT).as_posix()}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
