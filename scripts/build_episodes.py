"""Turn build/episodes.json into episodes.js with in-universe placements and stardates.

Usage: python3 -I build_episodes.py build/episodes.json build/ma/sidebars.json episodes.js [REPORT_MD]

Each episode gets a "home" event in the Prime timeline. The year and stardate come
from the episode's Memory Alpha sidebar ("date" field). Years Memory Alpha lists under
"other date" (flashbacks, time travel, epilogues) become extra "other" events. When
Memory Alpha has no year, the year is estimated from the season's span and marked
approximate. Curated entries in data.js override these placements in the app.

REPORT_MD, if given, gets a list of places where Memory Alpha and our estimates differ.
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date

# (first year, last year) of each season, in-universe.
SEASONS = {
    "TOS": {1: (2266, 2267), 2: (2267, 2268), 3: (2268, 2269)},
    "TAS": {1: (2269, 2270), 2: (2270, 2270)},
    "TNG": {s: (2363 + s, 2363 + s) for s in range(1, 8)},
    "DS9": {s: (2368 + s, 2368 + s) for s in range(1, 8)},
    "VOY": {**{s: (2370 + s, 2370 + s) for s in range(1, 7)}, 7: (2377, 2378)},
    "ENT": {1: (2151, 2152), 2: (2152, 2153), 3: (2153, 2154), 4: (2154, 2155)},
    "DIS": {1: (2256, 2257), 2: (2257, 2258), 3: (3188, 3189), 4: (3189, 3190), 5: (3191, 3191)},
    "PIC": {1: (2399, 2399), 2: (2401, 2401), 3: (2401, 2401)},
    "LD":  {1: (2380, 2380), 2: (2381, 2381), 3: (2381, 2381), 4: (2381, 2381), 5: (2381, 2382)},
    "PRO": {1: (2383, 2384), 2: (2384, 2385)},
    "SNW": {1: (2259, 2259), 2: (2259, 2260), 3: (2260, 2260), 4: (2260, 2261)},
    "SFA": {1: (3191, 3191)},
}

# Short Treks are standalone stories set all over the timeline.
SHORT_TREKS = {
    "Runaway": (2257, "Tilly aboard Discovery."),
    "Calypso": (3200, "Discovery, long abandoned, in the far future (date unclear)."),
    "The Brightest Star": (2237, "Saru on Kaminar, before joining Starfleet."),
    "The Escape Artist": (2257, "Harry Mudd's cons."),
    "Q&A": (2254, "Spock's first day on the Enterprise."),
    "The Trouble with Edward": (2255, "Tribbles aboard the USS Cabot."),
    "Ask Not": (2258, "Cadet Sidhu and Captain Pike."),
    "Ephraim and Dot": (2266, "A tardigrade aboard Kirk's Enterprise, through to 2285."),
    "The Girl Who Made the Stars": (2230, "Michael Burnham as a child."),
    "Children of Mars": (2385, "The synth attack on Mars."),
}


def split_fields(sidebar):
    """Split '{{sidebar episode |a = x |b = y}}' into {a: x}, respecting [[..]] and {{..}}."""
    body = sidebar[2:-2]
    parts, depth, cur, i = [], 0, "", 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("[[", "{{"):
            depth += 1; cur += two; i += 2; continue
        if two in ("]]", "}}"):
            depth -= 1; cur += two; i += 2; continue
        if body[i] == "|" and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += body[i]
        i += 1
    parts.append(cur)
    fields = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            fields[k.strip().lower()] = re.sub(r"<!--.*?-->|<ref[^>]*/>|<ref.*?</ref>", "", v, flags=re.S).strip()
    return fields


def clean(wikitext):
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", wikitext)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\{\{[^}]*\}\}", "", t)
    t = re.sub(r"<[^>]+>\[?\d*\]?(</[^>]+>)?", "", t)
    t = t.replace("''", "").replace("&ndash;", "–").replace("&mdash;", "—").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", t).strip()


YEAR_LINK = re.compile(r"\[\[(\d{3,4})(s)?(?:\|[^\]]*)?\]\]")


def memory_alpha(sidebar):
    f = split_fields(sidebar)
    date_raw, other_raw = f.get("date", ""), f.get("other date", "")
    years = [(int(y), bool(dec)) for y, dec in YEAR_LINK.findall(date_raw)]
    others = sorted({int(y) for y, dec in YEAR_LINK.findall(other_raw) if not dec})
    # Stardate: a leading number that is not a linked year, e.g. "41153.7-41174.2 ([[2364]])".
    no_years = clean(YEAR_LINK.sub("", date_raw)).lstrip(":; ")
    m = re.match(r"^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?", no_years)
    stardate = None
    if m:
        stardate = m.group(1) + (f"–{m.group(2)}" if m.group(2) else "")
    return {
        "stardate": stardate,
        "sd": float(m.group(1)) if m else None,
        "years": years,
        "others": others,
        "date": clean(date_raw).lstrip(":; ").replace("( ", "("),
        "other": clean(other_raw),
    }


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    src, ma_src, dest = sys.argv[1], sys.argv[2], sys.argv[3]
    report_path = sys.argv[4] if len(sys.argv) > 4 else None
    episodes = [e for e in json.load(open(src)) if e["air"] <= date.today().isoformat()]
    sidebars = json.load(open(ma_src))
    ma = {k: dict(memory_alpha(v["sidebar"]), page=v["page"]) for k, v in sidebars.items() if v}
    report = []

    by_season = defaultdict(list)
    for e in episodes:
        by_season[(e["series"], e["season"])].append(e)

    out = []
    for (series, season), eps in by_season.items():
        eps.sort(key=lambda e: (e["air"], e["ep"] or 0))
        for i, e in enumerate(eps):
            if series == "ST":
                y, note = SHORT_TREKS.get(e["title"], (2257, ""))
                est = {"y": y, "approx": True, "tl": "prime", "kind": "home", "note": note}
            elif e.get("canon"):
                est = {"y": int(e["canon"][:4]), "tl": "prime", "kind": "home", "note": ""}
            else:
                lo, hi = SEASONS[series][season]
                y = min(hi, lo + (hi - lo + 1) * i // len(eps))
                est = {"y": y, "approx": True, "tl": "prime", "kind": "home", "note": ""}

            info = ma.get(f"{series}|{e['title']}")
            ev = dict(est)
            if info and info["years"]:
                y, decade = info["years"][0]
                ev = {**est, "y": y, "approx": decade}
                if y != est["y"]:
                    report.append(f"| {series} | {e['title']} | {est['y']}{' (est.)' if est.get('approx') else ''} | {info['date']} |")
            events = [ev]
            if info:
                for oy in info["others"]:
                    if oy != ev["y"]:
                        events.append({"y": oy, "tl": "prime", "kind": "other", "note": f"Memory Alpha: also set in {info['other']}"})
            entry = {
                "id": f"{series.lower()}-s{season}e{e['ep']}-{slug(e['title'])}",
                "series": series,
                "season": season,
                "ep": e["ep"],
                "title": e["title"],
                "air": e["air"],
                "events": events,
            }
            if info:
                entry["ma"] = {k: info[k] for k in ("page", "stardate", "date", "other", "others") if info[k]}
                # In-year sort key: stardate, or the on-screen calendar date.
                if info["sd"] is not None:
                    entry["order"] = info["sd"]
            if "order" not in entry and e.get("canon"):
                d = date.fromisoformat(e["canon"])
                entry["order"] = round(d.year + d.timetuple().tm_yday / 366, 4)
            out.append(entry)

    out.sort(key=lambda e: (e["air"], e["series"], e["ep"] or 0))

    # Episodes without a stardate inherit the previous one in the same series, so they
    # stay beside their broadcast neighbours when a year is sorted by stardate.
    last = {}
    for e in out:
        if "order" in e:
            last[e["series"]] = e["order"]
        elif e["series"] in last:
            e["order"] = last[e["series"]]

    films = {k.split("|", 1)[1]: {kk: v[kk] for kk in ("page", "stardate", "date", "other", "others") if v[kk]}
             for k, v in ma.items() if k.startswith("FILM|")}
    with open(dest, "w") as f:
        f.write("// Generated by scripts/build_episodes.py from Wikipedia episode lists and Memory Alpha.\n// Do not edit by hand;\n")
        f.write("// put corrections and time-travel details in data.js instead.\n")
        f.write("window.EPISODES = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\nwindow.MA_FILMS = ")
        json.dump(films, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    if report_path:
        with open(report_path, "w") as f:
            f.write("# Memory Alpha year differs from our estimate\n\n| Series | Episode | Ours | Memory Alpha date |\n|---|---|---|---|\n")
            f.write("\n".join(report) + "\n")
    print(f"{len(out)} episodes written to {dest}", file=sys.stderr)


if __name__ == "__main__":
    main()
