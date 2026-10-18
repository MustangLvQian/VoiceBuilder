#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOD_PATH = ROOT / "src" / "doc-to-worklist.py"
spec = importlib.util.spec_from_file_location("doc_to_worklist", str(MOD_PATH))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # type: ignore

def assert_eq(a, b):
    if a != b:
        raise AssertionError(f"{a!r} != {b!r}")

def assert_true(cond, msg=None):
    if not cond:
        raise AssertionError(msg or "condition false")

def test_slugify():
    assert_eq(mod.slugify("My Article.pdf"), "my-article")
    assert_eq(mod.slugify("Hello World!!.txt"), "hello-world")
    assert_eq(mod.slugify("___"), "doc")
    assert_eq(mod.slugify(""), "doc")
    assert_eq(mod.slugify("Report v2 FINAL"), "report-v2-final")
    assert_eq(mod.slugify("My Article.v2.txt"), "my-article.v2")

def test_words_in():
    assert_eq(mod.words_in("don't stop!"), 2)
    assert_eq(mod.words_in("Hello, world."), 2)
    assert_eq(mod.words_in("123,456"), 0)

def test_estimate_seconds():
    est = mod.estimate_seconds(30)
    assert_true(est["min"] > 0)
    assert_true(est["max"] > est["nominal"] > est["min"])

def test_split_sentences_basic():
    out = mod.split_sentences("Hello world. How are you?")
    assert_eq(out, ["Hello world.", "How are you?"])

def test_abbrevs():
    out = mod.split_sentences("Mr. Smith went home. He left.")
    assert_eq(len(out), 2)
    assert_true(out[0].startswith("Mr. Smith"))
    out = mod.split_sentences("The U.S. is big. It is.")
    assert_eq(len(out), 2)
    out = mod.split_sentences("I met J. K. Rowling. Nice.")
    assert_eq(len(out), 2)

def test_ordinary_words_not_abbrevs():
    # "sun." / "sat." / "mar." are ordinary words, not Sunday/Saturday/March.
    assert_eq(len(mod.split_sentences("The sun is bright. It shines.")), 2)
    assert_eq(len(mod.split_sentences("She sat down. Then she rested.")), 2)
    assert_eq(len(mod.split_sentences("It may mar the view. Look closer.")), 2)

def test_long_fallback():
    words = ["abc"] * 40
    s = ", ".join(words)
    out = mod.split_sentences(s + ".")
    assert_true(len(out) > 1)
    for piece in out:
        assert_true(mod.words_in(piece) <= 30)

def test_no_punct_long():
    s = " ".join(["abc"] * 40)
    out = mod.split_sentences(s)
    assert_true(len(out) > 1)

def test_looks_english():
    assert_true(mod.looks_english("Hello world"))
    assert_true(not mod.looks_english("你好"))
    assert_true(mod.looks_english("你好 world"))  # mostly ASCII

def test_markdown_strip():
    md = "# Title\n[link](url) test `code`"
    stripped = mod.strip_markdown(md)
    assert_true("Title" in stripped)
    assert_true("link" in stripped)

def test_build_items():
    items = mod.build_items(["Hi", "Bye"], slug="test", name="Test", source="t.txt")
    assert_eq(len(items), 2)
    assert_eq(items[0]["id"], "doc-test-0001")
    assert_eq(items[0]["file"], "doc-test-0001.wav")
    assert_eq(items[1]["index"], 2)

def test_normalize_hyphen_break():
    text = "inter-\nnational"
    s = mod.normalize_whitespace(text)
    assert_true("international" in s)

def test_paragraph_break_is_boundary():
    text = "A title\n\nFirst sentence here. Second one here."
    assert_eq(mod.split_sentences(text), ["A title", "First sentence here.", "Second one here."])

def test_soft_wrap_joins():
    text = "He makes a cup of tea and\nopens his window to let the cool air in."
    out = mod.split_sentences(text)
    assert_eq(len(out), 1)
    assert_true("\n" not in out[0])

def test_write_topic_integration():
    tmp = tempfile.mkdtemp()
    try:
        doc = Path(tmp) / "test.txt"
        doc.write_text("Hello world. How are you today?", encoding="utf-8")
        out = mod.write_topic(doc, "Test File.txt", Path(tmp))
        assert_true(Path(out["dir"]).exists())
        assert_true((Path(out["dir"]) / "worklist.json").exists())
        assert_true((Path(out["dir"]) / "meta.json").exists())
        assert_true((Path(out["dir"]) / "samples").is_dir())
        assert_true((Path(out["dir"]) / "audio").is_dir())
        assert_true((Path(out["dir"]) / "doc.txt").exists())
        items = json.loads((Path(out["dir"]) / "worklist.json").read_text(encoding="utf-8"))
        assert_eq(len(items), 2)
    finally:
        import shutil
        shutil.rmtree(tmp)

def main():
    tests = [
        test_slugify, test_words_in, test_estimate_seconds,
        test_split_sentences_basic, test_abbrevs, test_ordinary_words_not_abbrevs,
        test_long_fallback, test_no_punct_long, test_looks_english,
        test_markdown_strip, test_build_items, test_normalize_hyphen_break,
        test_paragraph_break_is_boundary, test_soft_wrap_joins,
        test_write_topic_integration,
    ]
    for t in tests:
        t()
    print(f"all {len(tests)} passed")
    return 0

if __name__ == "__main__":
    sys.exit(main())