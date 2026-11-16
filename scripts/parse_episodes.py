"""Parse Wikipedia episode-list HTML into a JSON list of episodes.

Usage: python3 -I parse_episodes.py RAW_DIR OUT_JSON

RAW_DIR holds one <CODE>.html per series (Parsoid HTML from the Wikipedia REST API).
Only title, season, episode number and first air date are extracted.
"""
import html
import json
import re
import sys
from pathlib import Path

TOKEN = re.compile(
    r'<h([234])[^>]*>(?P<head>.*?)</h\1>'
    r'|<tr class="vevent[^"]*"[^>]*>(?P<row>.*?)</tr>',
    re.S,
)
TAG = re.compile(r"<[^>]+>")
REF = re.compile(r"<sup[^>]*>.*?</sup>", re.S)


def text(fragment):
    fragment = REF.sub("", fragment)
    return html.unescape(TAG.sub("", fragment)).replace("\xa0", " ").strip()


def cell_ints(row):
    """Leading numeric cells: overall number (th) and number in season (td)."""
    nums = []
    for m in re.finditer(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", row, re.S):
        if 'class="summary"' in m.group(0)[:200]:
            break
        t = text(m.group(1))
        n = re.match(r"\d+", t)
        nums.append(int(n.group()) if n else None)
    return nums


def parse(code, src):
    season = None
    pending_part = None
    out = []
    for m in TOKEN.finditer(src):
        if m.group("head") is not None:
            h = text(m.group("head"))
            s = re.match(r"(?:Season|Series)\s+(\d+)", h)
            if s:
                season = int(s.group(1))
            elif re.match(r"Pilot", h):
                season = 0
            elif re.match(r"(Series overview|Home media|Reception|Production|See also|References|Notes|Cast)", h):
                season = None
            continue
        row = m.group("row")
        dates = re.findall(r'class="[^"]*\b(?:bday|dtstart)\b[^"]*">(\d{4}-\d{2}-\d{2})<', row)
        air = next((d for d in dates if "1960" <= d[:4] <= "2099"), None)
        canon = next((d for d in dates if d[:4] >= "2100"), None)
        sm = re.search(r'<td class="summary"([^>]*)>(.*?)</td>', row, re.S)
        if not sm and pending_part and not air:
            air = pending_part["air"]  # both parts released the same day
        if season is None or not air:
            continue
        nums = cell_ints(row)
        ep = nums[1] if len(nums) > 1 else (nums[0] if nums else None)
        if not sm:
            # Second half of a two-part episode whose title cell spans both rows.
            if pending_part:
                first = pending_part
                pending_part = None
                first["title"] = f"{first['title']} (Part 1)"
                out.append({**first, "title": first["title"].replace("(Part 1)", "(Part 2)"),
                            "ep": ep, "air": air, "canon": canon})
            continue
        title = text(sm.group(2))
        title = re.sub(r"\[[a-z0-9 ]+\]$", "", title).strip()
        title = title.strip('"“”').strip()
        # Titles like '"Foo" / "Bar"' keep only the first quoted title.
        title = re.split(r'"\s*(?:/|\n)', title)[0].strip('"“” ')
        entry = {"series": code, "season": season, "ep": ep, "title": title, "air": air, "canon": canon}
        out.append(entry)
        pending_part = entry if 'rowspan="2"' in sm.group(1) else None
    return out


def main():
    raw, dest = Path(sys.argv[1]), Path(sys.argv[2])
    episodes = []
    for f in sorted(raw.glob("*.html")):
        eps = parse(f.stem, f.read_text(encoding="utf-8"))
        # Drop exact duplicates (some pages repeat tables in overview sections).
        seen, uniq = set(), []
        for e in eps:
            k = (e["series"], e["title"], e["air"])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        print(f"{f.stem}: {len(uniq)} episodes, seasons {sorted({e['season'] for e in uniq})}", file=sys.stderr)
        episodes += uniq
    dest.write_text(json.dumps(episodes, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
