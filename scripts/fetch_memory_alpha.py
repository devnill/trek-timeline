"""Fetch Memory Alpha episode/film sidebars for every entry.

Usage: python3 -I fetch_memory_alpha.py build/episodes.json OUT_JSON

Tries a few page-title spellings per episode ("X (episode)", "X", "X, Part II", ...),
50 titles per API request, and keeps only the {{sidebar episode|film ...}} block.
Writes {"<series>|<title>": {"page": ..., "sidebar": ...} or null}.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://memory-alpha.fandom.com/api.php"
UA = "trek-timeline/0.1 (personal project)"

FILMS = {
    "Star Trek: The Motion Picture": ["Star Trek: The Motion Picture"],
    "Star Trek II: The Wrath of Khan": ["Star Trek II: The Wrath of Khan"],
    "Star Trek III: The Search for Spock": ["Star Trek III: The Search for Spock"],
    "Star Trek IV: The Voyage Home": ["Star Trek IV: The Voyage Home"],
    "Star Trek V: The Final Frontier": ["Star Trek V: The Final Frontier"],
    "Star Trek VI: The Undiscovered Country": ["Star Trek VI: The Undiscovered Country"],
    "Star Trek Generations": ["Star Trek Generations"],
    "Star Trek: First Contact": ["Star Trek: First Contact"],
    "Star Trek: Insurrection": ["Star Trek: Insurrection"],
    "Star Trek: Nemesis": ["Star Trek Nemesis", "Star Trek: Nemesis"],
    "Star Trek (2009)": ["Star Trek (film)", "Star Trek (2009 film)"],
    "Star Trek Into Darkness": ["Star Trek Into Darkness"],
    "Star Trek Beyond": ["Star Trek Beyond"],
    "Star Trek: Section 31": ["Star Trek: Section 31", "Section 31 (film)"],
}
ROMAN = {1: "I", 2: "II", 3: "III"}


def candidates(title):
    m = re.match(r"^(.*?)[,:]?\s*\(?\bPart\s+(\w+)\)?$", title, re.I)
    names = [title]
    if m:
        base, part = m.group(1).strip(), m.group(2)
        n = {"I": 1, "II": 2, "III": 3}.get(part.upper(), int(part) if part.isdigit() else None)
        if n:
            names += [f"{base}, Part {ROMAN[n]}", f"{base}, Part {n}", f"{base}: Part {ROMAN[n]}", f"{base} Part {ROMAN[n]}"]
        names.append(base)  # two-part episodes MA keeps on one page
    out = []
    for n in names:
        out += [f"{n} (episode)", n]
    return list(dict.fromkeys(out))


def query(titles):
    params = {
        "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
        "redirects": "1", "format": "json", "formatversion": "2", "titles": "|".join(titles),
    }
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry on any network error
            print(f"retry {attempt}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Memory Alpha request failed")


def sidebar(text):
    m = re.search(r"\{\{\s*sidebar (?:episode|film)\b", text, re.I)
    if not m:
        return None
    depth, i = 0, m.start()
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i):
            depth -= 1
            i += 2
            if depth == 0:
                return text[m.start():i]
        else:
            i += 1
    return None


def main():
    episodes = json.load(open(sys.argv[1]))
    # Shared titles are disambiguated by series, e.g. "Anomaly (DIS) (episode)".
    items = {f"{e['series']}|{e['title']}": candidates(e["title"]) + [f"{e['title']} ({e['series']}) (episode)"]
             for e in episodes}
    items.update({f"FILM|{k}": v for k, v in FILMS.items()})

    result = {k: None for k in items}
    tries = {k: 0 for k in items}
    while True:
        todo = {k: items[k][tries[k]] for k in items if result[k] is None and tries[k] < len(items[k])}
        if not todo:
            break
        wanted = list(dict.fromkeys(todo.values()))
        pages = {}
        for i in range(0, len(wanted), 50):
            d = query(wanted[i:i + 50])["query"]
            alias = {}
            for kind in ("normalized", "redirects"):
                for x in d.get(kind, []):
                    alias[x["from"]] = x["to"]
            for p in d.get("pages", []):
                text = (p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", "")
                pages[p["title"]] = sidebar(text)
            for t in wanted[i:i + 50]:
                r = t
                while r in alias:
                    r = alias[r]
                if r in pages:
                    pages[t] = (r, pages[r])
            time.sleep(1)
        for k, t in todo.items():
            hit = pages.get(t)
            if isinstance(hit, tuple) and hit[1]:
                result[k] = {"page": hit[0], "sidebar": hit[1]}
            else:
                tries[k] += 1
        print(f"resolved {sum(v is not None for v in result.values())}/{len(result)}", file=sys.stderr)

    # Fallback: search, and accept a result whose title matches ignoring case and punctuation.
    def norm(t):
        t = re.sub(r"\s*\([^)]*\)$", "", t)
        return re.sub(r"[^a-z0-9]", "", t.lower().replace("&", "and"))
    for k in [k for k, v in result.items() if v is None]:
        want = {norm(c) for c in items[k]}
        base = re.sub(r"[,:]?\s*\(?\bPart\s+\w+\)?$", "", k.split("|", 1)[1])
        params = {"action": "query", "list": "search", "srsearch": base, "srlimit": "10",
                  "srnamespace": "0", "format": "json", "formatversion": "2"}
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            hits = [h["title"] for h in json.load(r)["query"]["search"]]
        hits = [h for h in hits if norm(h) in want]
        series = k.split("|", 1)[0]
        hits.sort(key=lambda h: (series not in h, not h.endswith("(episode)"), len(h)))
        if hits:
            d = query(hits[:5])["query"]
            for h in hits[:5]:
                for p in d.get("pages", []):
                    if p["title"] == h:
                        sb = sidebar((p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", ""))
                        if sb and result[k] is None:
                            result[k] = {"page": h, "sidebar": sb}
        time.sleep(1)

    json.dump(result, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    missing = [k for k, v in result.items() if v is None]
    print(f"missing {len(missing)}: {missing}", file=sys.stderr)


if __name__ == "__main__":
    main()
