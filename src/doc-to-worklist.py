#!/usr/bin/env python3
"""Turns a document into a recording worklist for the web recorder.

The App's recording set comes from the question banks (see
build-recording-worklist.mjs). This script is for a different job: a one-off
"document topic" - you upload an English article (PDF/docx/txt/md), it is cut
into sentences, and the web page lets you record each sentence on its own.

The output is deliberately the *same shape* as work/recording-worklist.json so
the server, the IPA generator and the ASR checker can all be pointed at it
without new code paths.

Topic layout (work/docs/<slug>/):
    doc.<ext>        the uploaded original, kept for reference
    worklist.json    one item per sentence (this script writes it)
    meta.json        slug / name / counts, for the topic list
    samples/         TTS reference WAVs (written by tts-worklist.ps1)
    audio/           the narrator's WAVs (written by the web page)

Run:
    python src/doc-to-worklist.py --input article.pdf --name "Article.pdf"
    python src/doc-to-worklist.py --input a.txt --name a.txt --docs-dir work/docs

It prints a human-readable log, then one JSON summary line on stdout, which the
server reads to learn the slug it should point the page at.

Splitting rules (agreed 2026-10-18):
    - cut after . ! ? when the next word starts a sentence
    - never cut after a known abbreviation (Mr. Dr. e.g. U.S. ...) or an initial
    - a sentence over 30 words is first split at ; : , where that keeps the
      pieces sane, and hard-split at 30 words if it still has no breathing room
"""
import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DOC_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".markdown"}

# Clips are recorded one at a time, so a sentence long enough to need two
# breaths is worse than an extra clause break. 30 words is the agreed ceiling.
DEFAULT_MAX_WORDS = 30

# "Mr. Smith" must not become two sentences. Any period-terminated token in this
# set is treated as "more of the same sentence coming".
#
# Deliberately absent: weekdays (Sun. / Sat.) and the months Mar. / Aug., which
# are ordinary words far more often than they are abbreviations ("the sun.",
# "sat down", "it may mar the view").
ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
    "no", "nos", "fig", "figs", "vol", "vols", "pp", "p", "al", "inc", "ltd",
    "co", "corp", "dept", "univ", "approx", "est", "min", "max", "ca", "cf",
    "ed", "eds", "jan", "feb", "apr", "jun", "jul", "sept", "sep", "oct", "nov", "dec",
    "am", "pm", "wt", "hr", "sec", "secs", "kg", "km",
}

# A token that ends a chunk: letters/dots (so U.S. and e.g. count) then a period.
_TAIL = re.compile(r"([A-Za-z.]+)\.$")
_LINE_BREAK_HYPHEN = re.compile(r"(\w)-\s*\n\s*(\w)")
_WORD = re.compile(r"[A-Za-z\u2019']+")


class DocError(Exception):
    """Anything that should be shown to the person who uploaded the file."""


# ------------------------------------------------------------------ pure helpers


def words_in(text):
    """Same definition as build-recording-worklist.mjs, so estimates agree."""
    return len(_WORD.findall(text or ""))


def estimate_seconds(words):
    """Same formula as build-recording-worklist.mjs:31-36."""
    return {
        "min": max(0.6, words / 3.8),
        "nominal": max(0.7, words / 2.2),
        "max": words / 1.4 + 2.5,
    }


def slugify(name):
    """A filesystem- and URL-safe id, stable for a given file name."""
    stem = Path(name).stem if name else ""
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-.").lower()
    slug = re.sub(r"-{2,}", "-", slug)
    # Nothing but dots/underscores/dashes (e.g. "___") is not a usable id.
    if not re.sub(r"[._-]", "", slug) or slug in {".", ".."}:
        slug = "doc"
    return slug[:60].strip("-.") or "doc"


def normalize_whitespace(text):
    """Join wrapped lines, but keep paragraph breaks as sentence boundaries."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _LINE_BREAK_HYPHEN.sub(r"\1\2", text)   # "inter-\nnational" -> international
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    text = re.sub(r"[ \t\f\v]+", " ", text)        # horizontal whitespace -> one space
    text = re.sub(r" *\n *", "\n", text)           # trim around newlines
    # A lone newline is a soft wrap inside a sentence (PDF/txt reflow); two or
    # more are a paragraph break, which is where a heading or new thought starts.
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
    return text.strip()


def _ends_with_abbreviation(chunk):
    tail = chunk.rstrip().rstrip("\"')]\u201d\u2019")
    match = _TAIL.search(tail)
    if not match:
        return False
    token = match.group(1)
    if len(token) == 1:
        return True           # an initial: "J. Smith"
    if "." in token:
        return True           # a dotted acronym: "U.S.", "e.g."
    return token.lower() in ABBREVIATIONS


def split_long(sentence, max_words=DEFAULT_MAX_WORDS):
    """Keep every piece short enough to read in one breath."""
    words = sentence.split()
    if len(words) <= max_words:
        return [sentence.strip()]
    chunks = []
    current = []
    floor = max_words * 0.6
    for word in words:
        current.append(word)
        at_break = word.endswith((";", ":", ","))
        if len(current) >= max_words or (at_break and len(current) >= floor):
            chunks.append(" ".join(current))
            current = []
    if current:
        chunks.append(" ".join(current))
    return [c.strip() for c in chunks if c.strip()]


def split_sentences(text, max_words=DEFAULT_MAX_WORDS):
    text = normalize_whitespace(text)
    if not text:
        return []
    out = []
    for paragraph in re.split(r"\n+", text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        raw = re.split(r"(?<=[.!?])\s+", paragraph)
        merged = []
        for part in raw:
            if merged and _ends_with_abbreviation(merged[-1]):
                merged[-1] = f"{merged[-1]} {part}"
            else:
                merged.append(part)
        for sentence in merged:
            out.extend(split_long(sentence, max_words))
    return [s.strip() for s in out if s.strip()]


def looks_english(text):
    """Keep English lines; drop Chinese/other scripts the English TTS can't say."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    ascii_letters = sum(1 for c in letters if c.isascii())
    return ascii_letters / len(letters) >= 0.5


def strip_markdown(text):
    """Enough markdown removal that headings/links/lists don't reach the TTS."""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"~~~.*?~~~", " ", text, flags=re.S)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)          # images -> gone
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)       # links -> label
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.M)  # headings
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.M)       # blockquotes
    text = re.sub(r"^\s{0,3}([-*+]|\d+[.)])\s+", "", text, flags=re.M)  # lists
    text = re.sub(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$", " ", text, flags=re.M)  # rules
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    text = re.sub(r"^\s*\|.*\|\s*$", " ", text, flags=re.M)    # table rows
    return text


def build_items(sentences, slug, name, source):
    items = []
    for number, sentence in enumerate(sentences, start=1):
        clip_id = f"doc-{slug}-{number:04d}"
        words = words_in(sentence)
        est = estimate_seconds(words)
        items.append({
            "index": number,
            "id": clip_id,
            "group": name,
            "source": source,
            "day": None,
            "text": sentence,
            "file": f"{clip_id}.wav",
            "words": words,
            "estSecondsMin": round(est["min"], 1),
            "estSecondsNominal": round(est["nominal"], 1),
            "estSecondsMax": round(est["max"], 1),
        })
    return items


# ------------------------------------------------------------------ extraction


def _read_text_file(path):
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def _extract_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise DocError("缺少 pypdf，无法读取 PDF：pip install pypdf")
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise DocError("这个 PDF 有密码，无法读取")
        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append("")
        text = "\n".join(pages)
    except DocError:
        raise
    except Exception as exc:  # a corrupt or odd PDF
        raise DocError(f"PDF 读取失败：{exc}")
    if not text.strip():
        raise DocError(
            "这个 PDF 里提不出文字，多半是扫描版/图片型 PDF。"
            "本工具不做 OCR，请换一个可选中的 PDF，或先用别的工具转成 txt。"
        )
    return text


def _extract_docx(path):
    try:
        from docx import Document
    except ImportError:
        raise DocError("缺少 python-docx，无法读取 docx：pip install python-docx")
    try:
        document = Document(str(path))
    except Exception as exc:
        raise DocError(f"docx 读取失败：{exc}")
    blocks = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            blocks.append("\t".join(cell.text for cell in row.cells))
    return "\n".join(blocks)


def extract_text(path):
    """Raw text for any supported document, or a DocError worth showing."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf(path)
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix == ".md" or suffix == ".markdown":
        return strip_markdown(_read_text_file(path))
    if suffix == ".txt":
        return _read_text_file(path)
    raise DocError(f"不支持的格式 {suffix or '(无扩展名)'}，只支持 PDF / docx / txt / md")


# ------------------------------------------------------------------ topic files


def _clear_generated(topic_dir):
    """Same file name means same topic: replace anything we generated before."""
    for folder in ("samples", "audio"):
        target = topic_dir / folder
        if target.is_dir():
            shutil.rmtree(target)
    for name in ("worklist.json", "manifest.json", "meta.json"):
        target = topic_dir / name
        if target.exists():
            target.unlink()


def write_topic(path, name, docs_dir, max_words=DEFAULT_MAX_WORDS):
    """Parse one document and lay out work/docs/<slug>/. Returns the summary."""
    suffix = path.suffix.lower()
    if suffix not in DOC_EXTENSIONS:
        raise DocError(f"不支持的格式 {suffix or '(无扩展名)'}，只支持 PDF / docx / txt / md")

    raw = extract_text(path)
    sentences = split_sentences(raw, max_words)
    kept = [s for s in sentences if looks_english(s)]
    dropped = len(sentences) - len(kept)
    if not kept:
        raise DocError("文档里没有找到可用的英文句子（英文 TTS 读不了中文或其他语言）。")

    slug = slugify(name)
    topic_dir = docs_dir / slug
    topic_dir.mkdir(parents=True, exist_ok=True)
    _clear_generated(topic_dir)
    (topic_dir / "samples").mkdir(parents=True, exist_ok=True)
    (topic_dir / "audio").mkdir(parents=True, exist_ok=True)

    document_name = Path(name).name or f"{slug}{suffix}"
    shutil.copy2(path, topic_dir / f"doc{suffix}")

    display_name = Path(name).stem or slug
    items = build_items(kept, slug, display_name, document_name)
    worklist_path = topic_dir / "worklist.json"
    worklist_path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    meta = {
        "slug": slug,
        "name": display_name,
        "source": document_name,
        "ext": suffix,
        "uploadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sentences": len(items),
        "droppedNonEnglish": dropped,
        "maxWords": max_words,
        "words": sum(item["words"] for item in items),
    }
    (topic_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "ok": True,
        "slug": slug,
        "dir": str(topic_dir),
        "worklist": str(worklist_path),
        "samples": str(topic_dir / "samples"),
        "audio": str(topic_dir / "audio"),
        "name": display_name,
        "total": len(items),
        "droppedNonEnglish": dropped,
        "words": meta["words"],
    }


def main():
    ap = argparse.ArgumentParser(description="Turn a document into a recording worklist.")
    ap.add_argument("--input", required=True, help="the document to read")
    ap.add_argument("--name", default="", help="the original file name (drives the slug and title)")
    ap.add_argument("--docs-dir", default=str(ROOT / "work" / "docs"))
    ap.add_argument("--max-words", type=int, default=DEFAULT_MAX_WORDS)
    args = ap.parse_args()

    source = Path(args.input)
    if not source.is_file():
        print(f"输入文件不存在：{source}", file=sys.stderr)
        return 1
    name = args.name or source.name
    docs_dir = Path(args.docs_dir)
    if not docs_dir.is_absolute():
        docs_dir = ROOT / docs_dir

    try:
        summary = write_topic(source, name, docs_dir, args.max_words)
    except DocError as exc:
        print(f"[文档解析失败] {exc}", file=sys.stderr)
        return 1

    print(f"文档：{summary['name']}（{Path(name).suffix}）")
    print(f"分句：{summary['total']} 条，共 {summary['words']} 词")
    if summary["droppedNonEnglish"]:
        print(f"跳过非英文句：{summary['droppedNonEnglish']} 条")
    print(f"专题目录：{Path(summary['dir']).relative_to(ROOT).as_posix()}")
    # The server reads this last line to learn where the topic landed.
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())