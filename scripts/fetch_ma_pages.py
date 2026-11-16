"""Fetch full Memory Alpha wikitext for episodes, for curating.

Usage: python3 -I fetch_ma_pages.py SIDEBARS_JSON KEYS_FILE OUT_JSON
KEYS_FILE has one "<SERIES>|<title>" per line (keys of sidebars.json).
Writes {key: {"page": ..., "text": ...}}.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

API = "https://memory-alpha.fandom.com/api.php"
UA = "trek-timeline/0.1 (personal project)"


def main():
    sidebars = json.load(open(sys.argv[1]))
    keys = [k.strip() for k in open(sys.argv[2]) if k.strip()]
    pages = {k: sidebars[k]["page"] for k in keys if sidebars.get(k)}
    out = {}
    titles = list(dict.fromkeys(pages.values()))
    for i in range(0, len(titles), 20):
        params = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                  "format": "json", "formatversion": "2", "titles": "|".join(titles[i:i + 20])}
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            for p in json.load(r)["query"]["pages"]:
                text = (p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", "")
                for k, t in pages.items():
                    if t == p["title"]:
                        out[k] = {"page": t, "text": text}
        time.sleep(1)
    json.dump(out, open(sys.argv[3], "w"), ensure_ascii=False)
    print(f"{len(out)}/{len(keys)} pages", file=sys.stderr)


if __name__ == "__main__":
    main()
