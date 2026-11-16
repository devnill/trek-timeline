"""Summarize fetched Memory Alpha pages: date fields, logline and years the summary mentions.

Usage: python3 -I ma_digest.py PAGES_JSON
"""
import json
import re
import sys
from collections import Counter


def plain(t):
    t = re.sub(r"\{\{(?:[^{}|]*\|)*([^{}|]*)\}\}", r"\1", t)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    return re.sub(r"<[^>]+>|''+", "", t)


for k, v in json.load(open(sys.argv[1])).items():
    t = v["text"]
    field = lambda f: (re.search(r"\|\s*" + f + r"\s*=([^\n|]*)", t) or [None, ""])[1].strip()
    end = t.find("== Summary")
    head = t[:end]
    m = re.search(r"\n\}\}\s*\n(.*?)(?:\n==|$)", head, re.S)
    logline = plain(m.group(1)).strip().replace("\n", " ") if m else ""
    logline = re.sub(r"^\s*\{\{.*?\}\}\s*", "", logline)[:260]
    body = plain(t[end:t.find("== Memorable") if "== Memorable" in t else len(t)])
    years = Counter(re.findall(r"\b(1[0-9]{3}|2[0-9]{3}|3[0-9]{3})\b", body))
    print(f"### {k}\n  date={plain(field('date'))!r} other={plain(field('other date'))!r}\n  {logline}\n  years: {dict(years.most_common(8))}")
