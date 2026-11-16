# Star Trek Timeline

Every Star Trek episode and film, ordered by air date or by in-universe year, with
time travel, the Kelvin timeline, the Mirror Universe and erased timelines shown in
separate lanes.

## Run

```bash
python3 -m http.server 8743
```

Then open http://localhost:8743.

## Data

- `episodes.js` is generated: every episode with its season, number and first air date
  from Wikipedia's episode lists, plus the stardate and year from each episode's
  Memory Alpha page. Years Memory Alpha lists under "other date" (flashbacks, time
  travel) become extra points. Where Memory Alpha gives no year, the year is estimated
  from a 24th-century stardate (41000 ≈ 2364, about 1,000 a year) or from the episodes
  around it. Within a year, stories are ordered by stardate.
- Every approximate year carries a reason (`why`) that the app shows. `est: true` marks our
  own estimates ("≈ estimate"); other approximate years come from vague sources, such as
  a decade ("≈ approx.").
- `data.js` is hand-written: series colors, timelines, films, and curated entries that
  replace an episode's placement with a summary, exact years, time travel and alternate
  timelines. Entries are matched to episodes by series and title.

To refresh (for example after new episodes air):

```bash
mkdir -p build/raw   # put one <CODE>.html per series here, from
                     # https://en.wikipedia.org/api/rest_v1/page/html/List_of_Star_Trek:_..._episodes
python3 -I scripts/parse_episodes.py build/raw build/episodes.json
python3 -I scripts/fetch_memory_alpha.py build/episodes.json build/ma/sidebars.json
python3 -I scripts/build_episodes.py build/episodes.json build/ma/sidebars.json episodes.js build/ma_year_report.md
```

`build/ma_year_report.md` lists episodes where Memory Alpha's year differs from the
season estimate. Season-to-year spans live in `SEASONS` in `scripts/build_episodes.py`;
new seasons need a line there.
