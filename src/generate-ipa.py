#!/usr/bin/env python3
"""Generates IPA phonetics and pronunciation tips for the recording worklist.

Phonemes come from the CMU Pronouncing Dictionary (American English) via the
`pronouncing` package. ARPAbet is converted to IPA. Tips are phoneme-driven:
whichever tricky sounds appear in the line, that is what the tip covers.

Run:  python src/generate-ipa.py [--list work/recording-worklist.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve()
ROOT = SCRIPT_PATH.parents[1]
WORK = ROOT / "work"

ARPABET_TO_IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "EH": "ɛ", "ER": "ɝ",
    "EY": "eɪ", "F": "f", "G": "ɡ", "HH": "h", "IH": "ɪ", "IY": "i",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ",
    "OW": "oʊ", "OY": "ɔɪ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "UH": "ʊ", "UW": "u", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}
STRESS = {"0": "", "1": "ˈ", "2": "ˌ"}

# Unstressed AH and ER are the schwa and the r-coloured schwa, not /ʌ/ and /ɝ/.
# CMU marks the vowel's stress with a digit, so this is decided per phoneme.
UNSTRESSED_IPA = {"ʌ": "ə", "ɝ": "ɚ"}

# ARPAbet vowel codes: these are the syllable nuclei.
VOWEL_CODES = {
    "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
    "IH", "IY", "OW", "OY", "UH", "UW",
}

# Legal English syllable onsets, in the IPA symbols this module emits. Used to
# decide how far left a stress mark travels from its vowel (see _onset_index).
VALID_ONSETS = {
    # single consonants (ŋ is never an onset)
    "b", "tʃ", "d", "ð", "f", "ɡ", "h", "dʒ", "k", "l", "m", "n",
    "p", "ɹ", "s", "ʃ", "t", "θ", "v", "w", "j", "z", "ʒ",
    # stop/fricative + liquid or glide
    "pɹ", "bɹ", "tɹ", "dɹ", "kɹ", "ɡɹ", "fɹ", "θɹ", "ʃɹ",
    "pl", "bl", "kl", "ɡl", "fl", "sl",
    "pj", "bj", "kj", "ɡj", "fj", "vj", "mj", "nj", "lj", "hj", "tj", "dj", "sj", "zj",
    # /s/ + obstruent or nasal/glide, which is how s-clusters start
    "sp", "st", "sk", "sm", "sn", "sf", "sw",
    # C + /w/
    "tw", "dw", "kw", "ɡw", "θw",
    # three-consonant onsets
    "spl", "spɹ", "stɹ", "skɹ", "skw", "spj", "stj", "skj",
}

# Tips keyed by the IPA symbol they cover. First match wins.
PHONEME_TIPS = [
    ("θ", "th = /θ/（清）：舌尖伸出上下齿之间吹气，声带不振动。不要读成 s 或 f。"),
    ("ð", "th = /ð/（浊）：舌尖伸出上下齿之间，声带振动。不要读成 d 或 z。"),
    ('ɹ', '美式 r：舌尖向上卷起接近上颚但不接触，不要读成中文的「日」或 l。'),
    ('l', '词尾 l：舌尖抵住上齿龈（上牙后），不要省略或读成 o。'),
    ('v', 'v：上齿轻咬下唇，声带振动。不要读成 w。'),
    ('w', 'w：双唇收圆突出，不要读成 v。'),
    ('æ', 'æ（cat）：嘴张得比「啊」大，舌尖抵下齿。不要读成「诶」。'),
    ('ɪ', '短元音 /ɪ/（ship）：短而松。与长音 /iː/（sheep）区分开。'),
    ('i', '长元音 /iː/（sheep）：长而紧，嘴角向两边咧。与短音 /ɪ/（ship）区分开。'),
    ('ʌ', 'ʌ（cup）：介于「啊」和「呃」之间，短而放松。不要读成「啊」。'),
    ('ɑ', 'ɑ（hot）：嘴大张，舌头放平。不要读成「哦」。'),
    ('ɔ', 'ɔ（door）：双唇收圆前突。不要读成「哦」或「啊」。'),
    ('tʃ', 'ch = /tʃ/：先堵住再放开，像「吃」但更轻更短。'),
    ('dʒ', 'j = /dʒ/：声带振动，像「知」但更浊更短。'),
    ('ʃ', 'sh = /ʃ/：双唇略突出，像「嘘」但更短。'),
    ("ʒ", "s = /ʒ/（measure）：声带振动的 /ʃ/。英语里极少见。"),
    ("ŋ", "ng = /ŋ/：舌根抬起抵软腭，不要加 g 音。"),
]


def _segments(phonemes):
    """ARPAbet tokens -> (ipa, stress, is_vowel) triples, dropping unknowns."""
    segs = []
    for phoneme in phonemes:
        match = re.match(r"^([A-Z]+)(\d?)$", phoneme)
        if not match:
            continue
        code, stress = match.groups()
        ipa = ARPABET_TO_IPA.get(code)
        if ipa is None:
            continue
        if code in VOWEL_CODES and stress in ("", "0"):
            ipa = UNSTRESSED_IPA.get(ipa, ipa)
        segs.append((ipa, stress or "", code in VOWEL_CODES))
    return segs


def _onset_index(segs, nucleus):
    """Index of the first segment of the syllable whose stressed vowel is at
    `nucleus`. Walks left over the preceding consonants and picks the longest
    suffix that is a legal English onset, so the mark lands on the syllable
    rather than on the vowel: /ˈnoʊtɪs/ not /nˈoʊtɪs/, /ɪkˈsplɔɹ/ not /ɪˈksplɔɹ/.
    """
    start = nucleus
    while start > 0 and not segs[start - 1][2]:
        start -= 1
    for i in range(start, nucleus):
        if "".join(seg[0] for seg in segs[i:nucleus]) in VALID_ONSETS:
            return i
    return nucleus


def arpabet_to_ipa(phonemes, join_with=""):
    segs = _segments(phonemes)
    marks = {}
    for i, (_, stress, is_vowel) in enumerate(segs):
        if is_vowel and stress:
            mark = STRESS.get(stress, "")
            if mark:
                marks.setdefault(_onset_index(segs, i), mark)
    out = []
    for i, (ipa, _, _) in enumerate(segs):
        out.append(marks.get(i, "") + ipa)
    return join_with.join(out)


def word_to_ipa(word, cmu):
    entries = cmu.get(word.lower())
    if not entries:
        return None
    return arpabet_to_ipa(entries[0])


def sentence_to_ipa(text, cmu):
    parts = []
    for word in re.findall(r"[A-Za-z\u2019']+", text):
        word = word.replace('\u2019', "'")
        ipa = word_to_ipa(word, cmu)
        parts.append(ipa if ipa else f"[{word}]")
    return " ".join(parts)


def word_ipa_list(text, cmu):
    """Per-word IPA, aligned 1:1 with the words in the text (in order)."""
    out = []
    for word in re.findall(r"[A-Za-z\u2019']+", text):
        word = word.replace('\u2019', "'")
        ipa = word_to_ipa(word, cmu)
        out.append(ipa if ipa else f"[{word}]")
    return out


def pronunciation_tips(text, cmu):
    """Tips for the phonemes that actually appear in this line.

    Deduplicated and capped: a line can contain a dozen tricky sounds, but
    handing the narrator eleven tips at once means they read none of them.
    The most common pitfalls come first.
    """
    ipa_all = sentence_to_ipa(text, cmu)
    tips = []
    seen = set()
    for symbol, tip in PHONEME_TIPS:
        if symbol in ipa_all and tip not in seen:
            tips.append(tip)
            seen.add(tip)
        if len(tips) >= 4:
            break
    return tips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", default=str(WORK / "recording-worklist.json"))
    args = ap.parse_args()

    list_path = Path(args.list)
    if not list_path.is_absolute():
        list_path = ROOT / list_path
    if not list_path.exists():
        print(f"Not found: {list_path}", file=sys.stderr)
        return 1

    try:
        import pronouncing
    except ImportError:
        print("pip install pronouncing", file=sys.stderr)
        return 1

    cmu = pronouncing.cmudict.dict()
    worklist = json.loads(list_path.read_text(encoding="utf-8"))

    for item in worklist:
        item["ipa"] = sentence_to_ipa(item.get("text", ""), cmu)
        item["wordIpa"] = word_ipa_list(item.get("text", ""), cmu)
        item["tips"] = pronunciation_tips(item.get("text", ""), cmu)

    list_path.write_text(json.dumps(worklist, ensure_ascii=False, indent=2) + "\n", "utf-8")
    with_tips = sum(1 for i in worklist if i["tips"])
    print(f"Generated IPA + tips for {len(worklist)} lines ({with_tips} with tips)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
