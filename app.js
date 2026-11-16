(() => {
  const SERIES = window.SERIES;
  const TIMELINES = window.TIMELINES;
  const ENTRIES = mergeEntries(window.EPISODES || [], window.CURATED);
  const LANES = ["prime", "kelvin", "mirror", "alt"];
  const KIND = {
    home:   { icon: "●", label: "Main setting" },
    past:   { icon: "↶", label: "Trip to the past" },
    future: { icon: "↷", label: "Trip to the future" },
    vision: { icon: "◌", label: "Vision or simulation" },
    origin: { icon: "⇢", label: "Visitor's origin" },
    other:  { icon: "◇", label: "Flashback or other scene" },
  };

  // Match a curated entry to generated episodes by series and title. A curated title
  // with a part number only matches that part; without one it matches every part.
  function titleKey(title) {
    const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };
    let part = null;
    const base = title
      .replace(/[,:]?\s*\(?\bpart\s+([ivx]+|\d+)\)?\s*$/i, (_, p) => { part = ROMAN[p.toLowerCase()] ?? +p; return ""; })
      .replace(/\s+(I{1,3})$/, (_, p) => { part = p.length; return ""; });
    return { base: base.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""), part };
  }

  function mergeEntries(episodes, curated) {
    const used = new Set();
    const keyed = curated.map((c) => ({ c, k: titleKey(c.title) }));
    const merged = episodes.map((ep) => {
      const k = titleKey(ep.title);
      const hit = keyed.find(({ c, k: ck }) =>
        c.series === ep.series && ck.base === k.base && (ck.part == null || ck.part === k.part));
      if (!hit) return ep;
      used.add(hit.c);
      const events = hit.c.events.filter((ev) => ev.part == null || ev.part === (k.part ?? 1));
      return { ...ep, summary: hit.c.summary, stardate: hit.c.stardate, events, curated: true };
    });
    const films = window.MA_FILMS || {};
    for (const c of curated) {
      if (used.has(c)) continue;
      if (!c.air) { console.warn(`Curated entry matched no episode: ${c.series} "${c.title}"`); continue; }
      const ma = films[c.title];
      const sd = parseFloat(c.stardate || ma?.stardate);
      merged.push({ ...c, ma, order: Number.isNaN(sd) ? undefined : sd, curated: true });
    }
    return merged;
  }

  const stardateOf = (e) => e.stardate || e.ma?.stardate || null;
  const maUrl = (page) => `https://memory-alpha.fandom.com/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`;

  const epCode = (e) => (e.season != null && e.ep != null ? `S${e.season}E${e.ep}` : e.type === "film" ? "Film" : "");

  const byId = new Map(ENTRIES.map((e) => [e.id, e]));
  const airYears = ENTRIES.map((e) => +e.air.slice(0, 4));
  const AIR_MIN = Math.min(...airYears);
  const AIR_MAX = Math.max(...airYears);

  const defaults = () => ({
    view: "canon",
    series: new Set(Object.keys(SERIES)),
    timelines: new Set(LANES),
    airFrom: AIR_MIN,
    airTo: AIR_MAX,
    canonFrom: null,
    canonTo: null,
    travelOnly: false,
    visions: true,
    search: "",
  });
  let state = defaults();
  let selected = null;

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };

  // ---------- formatting ----------
  function fmtYear(y, approx) {
    let s;
    if (y <= -1e9) s = `${+(-y / 1e9).toFixed(1)} billion BCE`;
    else if (y <= -1e6) s = `${+(-y / 1e6).toFixed(1)} million BCE`;
    else if (y < 0) s = `${(-y).toLocaleString()} BCE`;
    else s = String(y);
    return approx ? `c. ${s}` : s;
  }
  function fmtAir(d) {
    return new Date(d + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  // Approximate years carry a reason. `est` marks our own estimate, as opposed to a
  // source that is only vague (a decade, "mid-25th century").
  const whyOf = (ev) => ev.why || (ev.est
    ? "Estimate: no source gives this year."
    : "The story only gives a rough date, so this year is approximate.");
  const approxBadge = (ev) => el("span", { class: `approx-badge${ev.est ? " est" : ""}`, title: whyOf(ev) },
    ev.est ? "≈ estimate" : "≈ approx.");
  const tlName = (ev) => (ev.tl === "alt" ? ev.branch || "Alternate" : TIMELINES[ev.tl].name);

  // ---------- filtering ----------
  const isTravel = (entry) =>
    entry.events.some((ev) => ev.kind !== "home" || ev.tl === "alt" || ev.tl === "mirror");

  function eventVisible(ev) {
    if (!state.timelines.has(ev.tl)) return false;
    if (!state.visions && ev.kind === "vision") return false;
    if (state.canonFrom != null && ev.y < state.canonFrom) return false;
    if (state.canonTo != null && ev.y > state.canonTo) return false;
    return true;
  }

  function entryVisible(entry) {
    if (!state.series.has(entry.series)) return false;
    const ay = +entry.air.slice(0, 4);
    if (ay < state.airFrom || ay > state.airTo) return false;
    if (state.travelOnly && !isTravel(entry)) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = [entry.title, entry.summary, SERIES[entry.series].name, stardateOf(entry),
        ...entry.events.map((e) => `${e.note} ${e.branch || ""}`)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return entry.events.some(eventVisible);
  }

  // ---------- cards ----------
  function seriesBadge(entry) {
    return el("span", { class: "badge", style: `--c:${SERIES[entry.series].color}`, title: SERIES[entry.series].name },
      entry.series.replace(/F$/, " film"));
  }

  function canonCard(entry, ev, idx) {
    const tag = ev.tl === "alt" ? ev.branch || "Alternate" : ev.tl !== "prime" ? TIMELINES[ev.tl].name : null;
    return el("button", {
      type: "button",
      class: `card kind-${ev.kind}${entry.curated ? "" : " plain"}${ev.approx ? " approx" : ""}`,
      style: `--c:${SERIES[entry.series].color}`,
      "data-entry": entry.id,
      "data-idx": idx,
      onclick: () => select(entry.id),
      title: ev.approx ? `${KIND[ev.kind].label} · ${whyOf(ev)}` : KIND[ev.kind].label,
    },
      el("div", { class: "card-top" },
        el("span", { class: "kind-icon", "aria-label": KIND[ev.kind].label }, KIND[ev.kind].icon),
        seriesBadge(entry),
        el("span", { class: "card-title" }, entry.title),
        tag ? el("span", { class: `branch tl-${ev.tl}` }, tag) : null,
        ev.approx ? approxBadge(ev) : null,
        el("span", { class: "card-meta" }, [
          ev.kind === "home" && stardateOf(entry) ? `SD ${stardateOf(entry)}` : null,
          epCode(entry), `Aired ${fmtAir(entry.air)}`].filter(Boolean).join(" · "))),
      ev.note ? el("div", { class: "card-note" }, ev.note) : null);
  }

  function airCard(entry) {
    return el("button", {
      type: "button",
      class: `card${entry.curated ? "" : " plain"}`,
      style: `--c:${SERIES[entry.series].color}`,
      "data-entry": entry.id,
      onclick: () => select(entry.id),
    },
      el("div", { class: "card-top" },
        seriesBadge(entry),
        el("span", { class: "card-title" }, entry.title),
        el("span", { class: "placements" },
          entry.events.map((ev) =>
            el("span", { class: `place tl-${ev.tl}${ev.approx ? " approx" : ""}`,
              title: `${tlName(ev)} — ${KIND[ev.kind].label}${ev.approx ? ` · ${whyOf(ev)}` : ""}` },
              `${KIND[ev.kind].icon} ${fmtYear(ev.y, ev.approx)}`,
              ev.tl !== "prime" ? el("small", {}, ` ${tlName(ev)}`) : null))),
        el("span", { class: "card-meta" },
          [epCode(entry), stardateOf(entry) && `SD ${stardateOf(entry)}`].filter(Boolean).join(" · "))),
      entry.summary ? el("div", { class: "card-note" }, entry.summary) : null);
  }

  // ---------- views ----------
  // Both views are one ordered column with a rail per lane (timelines in-universe,
  // series by air date) and an overview bar of the whole range.
  const centuryOf = (y) => (y < 0 ? "Before the Common Era" : `${Math.floor(y / 100) + 1}${ordinal(Math.floor(y / 100) + 1)} century`);
  const decadeOf = (y) => `${Math.floor(y / 10) * 10}s`;
  const airAt = (entry) => {
    const d = new Date(entry.air + "T12:00:00");
    return d.getFullYear() + (d - new Date(d.getFullYear(), 0, 1)) / 3.16e10;
  };

  const MODES = {
    canon: {
      // Overview segments: whole centuries from 1800 on; everything earlier is grouped.
      eraOf: (y) => (y < 0 ? "Deep past" : y < 1800 ? "Before 1800" : centuryOf(y)),
      short: (name) => ({ "Deep past": "BCE", "Before 1800": "<1800" }[name] ?? name.replace(" century", "")),
      span: (name, years) => (name === "Deep past" ? null : name === "Before 1800"
        ? [years[0], years[years.length - 1] + 1] : [Math.floor(years[0] / 100) * 100, Math.floor(years[0] / 100) * 100 + 100]),
      headOf: centuryOf,
      gapAfter: 20,
      hint: "Click the bar to jump · eras are not to scale",
    },
    air: {
      eraOf: decadeOf,
      short: (name) => name,
      span: (name) => [parseInt(name, 10), parseInt(name, 10) + 10],
      headOf: decadeOf,
      gapAfter: 1,
      hint: "Click the bar to jump · ticks are episodes, colored by series",
    },
  };

  let overview = [];   // [{ name, years, pos(at), node, marks, caret }]
  let yearRows = [];   // rows that start a year, for the position readout

  // rows: [{ y, at, lane, kind, approx, node, tick }] in order. lanes: [{ key, color, label }].
  function renderTrack(rows, lanes, mode) {
    const M = MODES[mode];
    const span = {};
    rows.forEach((r, i) => { (span[r.lane] ||= [i, i])[1] = i; });
    const yearApprox = new Map();
    for (const r of rows) yearApprox.set(r.y, (yearApprox.get(r.y) ?? true) && !!r.approx);

    // between = a row that sits just above row i (era bars, gaps).
    const rails = (i, between) => el("div", { class: "rails", "aria-hidden": "true" }, lanes.map((l) => {
      const s = span[l.key];
      const on = s && (between ? i > s[0] && i <= s[1] : i >= s[0] && i <= s[1]);
      const cls = `rail${l.key === "prime" ? " main" : ""}${on ? " on" : ""}${on && !between && i === s[0] ? " start" : ""}${on && !between && i === s[1] ? " end" : ""}`;
      return el("span", { class: cls, style: `--tl:${l.color}`, title: l.label },
        !between && rows[i].lane === l.key ? el("i", { class: `dot kind-${rows[i].kind || "home"}` }) : null);
    }));

    const out = [];
    let prev = null;
    rows.forEach((r, i) => {
      const first = r.y !== prev;
      if (first && (prev == null || M.headOf(r.y) !== M.headOf(prev))) {
        out.push(el("div", { class: "trow era-row" }, el("div"), rails(i, true), el("h3", { class: "era" }, M.headOf(r.y))));
      } else if (first && r.y - prev > M.gapAfter) {
        out.push(el("div", { class: "trow gap-row" }, el("div"), rails(i, true),
          el("div", { class: "gap" }, mode === "air" ? `${r.y - prev - 1} ${r.y - prev - 1 === 1 ? "year" : "years"} without new Star Trek` : fmtSpan(r.y - prev))));
      }
      const approx = yearApprox.get(r.y);
      const label = mode === "air" && !first ? r.dateLabel : fmtYear(r.y, approx);
      out.push(el("div", { class: `trow${first ? " new-year" : ""}`, "data-year": first ? r.y : null },
        el("div", { class: `tyear${approx ? " approx" : ""}${first ? "" : " repeat"}`, title: approx ? "Approximate year" : null },
          label, first && approx ? el("small", {}, "approx.") : null),
        rails(i, false),
        r.node));
      prev = r.y;
    });
    renderOverview(rows, lanes, mode);
    return [el("div", { class: `track-list mode-${mode}`, style: `--nl:${lanes.length}` }, out)];
  }

  function renderCanon(entries) {
    const rows = [];
    for (const entry of entries) {
      entry.events.forEach((ev, idx) => {
        if (!eventVisible(ev)) return;
        rows.push({ y: ev.y, at: ev.y, lane: ev.tl, kind: ev.kind, approx: ev.approx, entry,
          key: ev.kind === "home" && entry.order != null ? entry.order : Infinity,
          node: canonCard(entry, ev, idx) });
      });
    }
    // By year, then stardate (scenes in their home time), then air date.
    rows.sort((a, b) => (a.y - b.y) || (a.key - b.key) || a.entry.air.localeCompare(b.entry.air));
    const lanes = LANES.filter((l) => state.timelines.has(l))
      .map((l) => ({ key: l, color: `var(--tl-${l})`, label: TIMELINES[l].name }));
    return renderTrack(rows, lanes, "canon");
  }

  function renderAir(entries) {
    const sorted = [...entries].sort((a, b) => a.air.localeCompare(b.air) || (a.ep ?? 0) - (b.ep ?? 0));
    const rows = sorted.map((entry) => ({
      y: +entry.air.slice(0, 4), at: airAt(entry), lane: entry.series, entry,
      dateLabel: new Date(entry.air + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      node: airCard(entry),
    }));
    const lanes = Object.keys(SERIES).filter((code) => rows.some((r) => r.lane === code))
      .map((code) => ({ key: code, color: SERIES[code].color, label: SERIES[code].name }));
    return renderTrack(rows, lanes, "air");
  }

  function renderOverview(rows, lanes, mode) {
    const M = MODES[mode];
    const head = $("#canon-head");
    overview = [];
    for (const r of rows) {
      const name = M.eraOf(r.y);
      let seg = overview[overview.length - 1];
      if (!seg || seg.name !== name) overview.push(seg = { name, years: [], pts: [] });
      if (seg.years[seg.years.length - 1] !== r.y) seg.years.push(r.y);
      seg.pts.push(r);
    }
    const segs = overview.map((seg) => {
      const range = M.span(seg.name, seg.years);
      // Without a range (deep past spans billions of years), years are spaced evenly.
      seg.pos = (at) => (range
        ? Math.min(1, Math.max(0, (at - range[0]) / (range[1] - range[0])))
        : (seg.years.indexOf(Math.floor(at)) + 0.5) / seg.years.length);
      seg.marks = el("span", { class: "ov-marks" });
      seg.caret = el("span", { class: "ov-caret", hidden: true });
      const ticks = new Map();
      for (const r of seg.pts) {
        const lane = lanes.find((l) => l.key === r.lane);
        ticks.set(`${(seg.pos(r.at) * 200).toFixed(0)}|${r.lane}`, { left: seg.pos(r.at), color: lane.color, main: r.lane === "prime" || mode === "air" });
      }
      seg.node = el("button", {
        type: "button", class: "ov-seg",
        style: `flex-grow:${(1 + Math.sqrt(ticks.size)).toFixed(2)}`,
        title: `${seg.name}: ${fmtYear(seg.years[0])} – ${fmtYear(seg.years[seg.years.length - 1])}`,
        onclick: (e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - b.left) / b.width;
          jumpToYear(seg.years.find((y) => seg.pos(y + (range ? 1 : 0)) >= frac) ?? seg.years[seg.years.length - 1]);
        },
      },
        el("span", { class: "ov-label" }, M.short(seg.name)),
        el("span", { class: "ov-ticks" },
          [...ticks.values()].map((t) => el("i", { class: `tick${t.main ? "" : " side"}`, style: `left:${(t.left * 100).toFixed(2)}%;--tl:${t.color}` })),
          seg.marks, seg.caret));
      return seg.node;
    });
    head.hidden = false;
    head.replaceChildren(
      el("div", { class: "ov-bar" }, segs),
      el("div", { class: "ov-foot" },
        el("span", { class: "ov-readout" }),
        mode === "canon"
          ? el("span", { class: "ov-legend" }, lanes.map((l) => el("span", { style: `--tl:${l.color}` }, el("i"), l.label)))
          : null,
        el("span", { class: "ov-hint" }, M.hint)));
  }

  function jumpToYear(y) {
    const row = document.querySelector(`.trow[data-year="${y}"]`);
    if (!row) return;
    const offset = $(".top").offsetHeight + $("#canon-head").offsetHeight + 8;
    window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
  }

  // Show where in the whole range the reader is.
  let scrollQueued = false;
  function updatePosition() {
    scrollQueued = false;
    if (!overview.length) return;
    const M = MODES[state.view];
    const line = $(".top").offsetHeight + $("#canon-head").offsetHeight + 10;
    let current = null;
    for (const row of yearRows) {
      if (row.getBoundingClientRect().top <= line + 4) current = +row.dataset.year;
      else break;
    }
    if (current == null && yearRows.length) current = +yearRows[0].dataset.year;
    for (const seg of overview) {
      const here = current != null && M.eraOf(current) === seg.name;
      seg.node.classList.toggle("current", here);
      seg.caret.hidden = !here;
      if (here) seg.caret.style.left = `${(seg.pos(current + (state.view === "air" ? 0.5 : 0)) * 100).toFixed(2)}%`;
    }
    const readout = $(".ov-readout");
    if (readout && current != null) readout.textContent = `${state.view === "air" ? "Aired" : "Viewing"} ${fmtYear(current)}`;
  }
  window.addEventListener("scroll", () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updatePosition); }
  }, { passive: true });

  function markOverview() {
    for (const seg of overview) seg.marks.replaceChildren();
    if (!selected) return;
    const entry = byId.get(selected);
    const M = MODES[state.view];
    const points = state.view === "air" ? [{ y: +entry.air.slice(0, 4), at: airAt(entry), kind: "home" }]
      : entry.events.filter(eventVisible).map((ev) => ({ y: ev.y, at: ev.y, kind: ev.kind }));
    for (const p of points) {
      const seg = overview.find((s) => s.name === M.eraOf(p.y));
      if (seg) seg.marks.append(el("i", { class: `mark kind-${p.kind}`, style: `left:${(seg.pos(p.at) * 100).toFixed(2)}%;--c:${SERIES[entry.series].color}`, title: fmtYear(p.y) }));
    }
  }

  function fmtSpan(n) {
    if (n >= 1e9) return `about ${+(n / 1e9).toFixed(1)} billion years`;
    if (n >= 1e6) return `about ${+(n / 1e6).toFixed(1)} million years`;
    return `${n.toLocaleString()} years`;
  }

  function ordinal(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  }

  function render() {
    const entries = ENTRIES.filter(entryVisible);
    const tl = $("#timeline");
    tl.className = `timeline view-${state.view}`;
    const nodes = state.view === "canon" ? renderCanon(entries) : renderAir(entries);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("links");
    tl.replaceChildren(svg, ...nodes);
    yearRows = [...tl.querySelectorAll(".trow[data-year]")];
    updatePosition();

    const nEvents = tl.querySelectorAll(".card").length;
    $("#count").textContent = entries.length
      ? state.view === "canon"
        ? `${entries.length} stories, ${nEvents} points in time (${tl.querySelectorAll(".card.approx").length} with approximate years)`
        : `${entries.length} stories, in broadcast order`
      : "Nothing matches these filters.";

    document.querySelectorAll(".view-toggle button").forEach((b) =>
      b.setAttribute("aria-selected", b.dataset.view === state.view));
    applySelection();
  }

  // ---------- selection & links ----------
  function select(id) {
    selected = selected === id ? null : id;
    applySelection();
    renderDetail();
  }

  function applySelection() {
    const tl = $("#timeline");
    tl.classList.toggle("has-selection", !!selected);
    tl.querySelectorAll(".card").forEach((c) => c.classList.toggle("selected", c.dataset.entry === selected));
    markOverview();
    drawLinks();
  }

  function drawLinks() {
    const tl = $("#timeline");
    const svg = tl.querySelector("svg.links");
    if (!svg) return;
    svg.replaceChildren();
    if (!selected || state.view !== "canon") return;
    const cards = [...tl.querySelectorAll(`.card[data-entry="${selected}"]`)];
    if (cards.length < 2) return;
    const box = tl.getBoundingClientRect();
    svg.setAttribute("width", tl.scrollWidth);
    svg.setAttribute("height", tl.scrollHeight);
    const entry = byId.get(selected);
    const homeIdx = Math.max(0, entry.events.findIndex((e) => e.kind === "home"));
    const home = cards.find((c) => +c.dataset.idx === homeIdx) || cards[0];
    const hr = home.getBoundingClientRect();
    // Arcs bulge out to the right of the column; longer jumps bulge further.
    for (const c of cards) {
      if (c === home) continue;
      const r = c.getBoundingClientRect();
      const ev = entry.events[+c.dataset.idx];
      const x1 = hr.right - box.left, y1 = hr.top + hr.height / 2 - box.top;
      const x2 = r.right - box.left, y2 = r.top + r.height / 2 - box.top;
      const bend = Math.min(260, 30 + Math.abs(y2 - y1) * 0.08);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1},${y1} C${x1 + bend},${y1} ${x2 + bend},${y2} ${x2},${y2}`);
      path.setAttribute("class", `link kind-${ev.kind}`);
      path.style.stroke = SERIES[entry.series].color;
      svg.append(path);
    }
  }

  function renderDetail() {
    const panel = $("#detail");
    if (!selected) { panel.hidden = true; return; }
    const entry = byId.get(selected);
    panel.hidden = false;
    panel.style.setProperty("--c", SERIES[entry.series].color);
    panel.querySelector(".detail-body").replaceChildren(...[
      el("div", { class: "card-top" }, seriesBadge(entry), el("span", {}, SERIES[entry.series].name)),
      el("h2", {}, entry.title),
      el("p", { class: "card-meta" }, [epCode(entry), `${entry.type === "film" ? "Released" : "First aired"} ${fmtAir(entry.air)}`].filter(Boolean).join(" · ")),
      entry.summary ? el("p", {}, entry.summary) : null,
      el("dl", { class: "facts" },
        el("dt", {}, "Stardate"), el("dd", {}, stardateOf(entry) || "Not given"),
        entry.ma ? [el("dt", {}, "Memory Alpha"), el("dd", {}, entry.ma.date || "—",
          entry.ma.other ? el("div", { class: "card-meta" }, `Also: ${entry.ma.other}`) : null)] : null),
      entry.ma ? el("p", {}, el("a", { href: maUrl(entry.ma.page), target: "_blank", rel: "noopener" }, "Open on Memory Alpha ↗")) : null,
      entry.events.some((ev) => ev.approx) ? el("div", { class: "approx-note" },
        el("strong", {}, entry.events.some((ev) => ev.est) ? "Contains estimated years" : "Approximate years"),
        el("ul", {}, entry.events.filter((ev) => ev.approx).map((ev) =>
          el("li", {}, el("b", {}, fmtYear(ev.y, true)), ` — ${whyOf(ev)}`)))) : null,
      el("h3", {}, "Points in time"),
      el("ol", { class: "detail-events" },
        [...entry.events].sort((a, b) => a.y - b.y).map((ev) =>
          el("li", { class: `tl-${ev.tl}` },
            el("button", { type: "button", onclick: () => focusEvent(entry, ev) },
              el("strong", {}, `${KIND[ev.kind].icon} ${fmtYear(ev.y, ev.approx)}`),
              el("span", { class: "tl-tag" }, tlName(ev)),
              ev.approx ? el("span", { class: "tl-tag approx-tag" }, ev.est ? "estimate" : "approx.") : null,
              ev.note ? el("span", {}, ev.note) : null))))].filter(Boolean));
  }

  function focusEvent(entry, ev) {
    let changed = false;
    if (state.view !== "canon") { state.view = "canon"; changed = true; }
    if (!eventVisible(ev) || !entryVisible(entry)) {
      // Widen filters just enough to show it.
      state.series.add(entry.series);
      state.timelines.add(ev.tl);
      if (ev.kind === "vision") state.visions = true;
      state.canonFrom = state.canonTo = null;
      state.search = "";
      const ay = +entry.air.slice(0, 4);
      state.airFrom = Math.min(state.airFrom, ay);
      state.airTo = Math.max(state.airTo, ay);
      syncControls();
      changed = true;
    }
    selected = entry.id;
    if (changed) render(); else applySelection();
    const card = document.querySelector(`.card[data-entry="${entry.id}"][data-idx="${entry.events.indexOf(ev)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.remove("flash");
      void card.offsetWidth;
      card.classList.add("flash");
      setTimeout(drawLinks, 400);
    }
  }

  // ---------- controls ----------
  function buildControls() {
    const sf = $("#series-filters");
    for (const [code, s] of Object.entries(SERIES)) {
      sf.append(el("label", { class: "chip", style: `--c:${s.color}`, title: s.name },
        el("input", { type: "checkbox", value: code, onchange: (e) => {
          e.target.checked ? state.series.add(code) : state.series.delete(code);
          render();
        } }),
        el("span", {}, s.name)));
    }
    const tf = $("#timeline-filters");
    for (const [code, t] of Object.entries(TIMELINES)) {
      tf.append(el("label", { class: `check tl-${code}` },
        el("input", { type: "checkbox", value: code, onchange: (e) => {
          e.target.checked ? state.timelines.add(code) : state.timelines.delete(code);
          render();
        } }),
        el("span", { class: "swatch" }), t.name));
    }

    document.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
      state.series = new Set(Object.keys(SERIES)); syncControls(); render();
    }));
    document.querySelectorAll("[data-none]").forEach((b) => b.addEventListener("click", () => {
      state.series.clear(); syncControls(); render();
    }));
    document.querySelectorAll(".view-toggle button").forEach((b) => b.addEventListener("click", () => {
      state.view = b.dataset.view; render();
    }));

    const num = (v) => (v === "" ? null : Number(v));
    $("#air-from").addEventListener("input", (e) => { state.airFrom = num(e.target.value) ?? AIR_MIN; render(); });
    $("#air-to").addEventListener("input", (e) => { state.airTo = num(e.target.value) ?? AIR_MAX; render(); });
    $("#canon-from").addEventListener("input", (e) => { state.canonFrom = num(e.target.value); render(); });
    $("#canon-to").addEventListener("input", (e) => { state.canonTo = num(e.target.value); render(); });
    $("#travel-only").addEventListener("change", (e) => { state.travelOnly = e.target.checked; render(); });
    $("#show-visions").addEventListener("change", (e) => { state.visions = e.target.checked; render(); });
    $("#search").addEventListener("input", (e) => { state.search = e.target.value.trim(); render(); });
    $("#reset").addEventListener("click", () => {
      const view = state.view; state = defaults(); state.view = view; syncControls(); render();
    });

    $("#detail .close").addEventListener("click", () => select(selected));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) select(selected); });
    window.addEventListener("resize", drawLinks);

    for (const id of ["air-from", "air-to"]) {
      $("#" + id).min = AIR_MIN; $("#" + id).max = AIR_MAX;
    }
  }

  function syncControls() {
    document.querySelectorAll("#series-filters input").forEach((i) => (i.checked = state.series.has(i.value)));
    document.querySelectorAll("#timeline-filters input").forEach((i) => (i.checked = state.timelines.has(i.value)));
    $("#air-from").value = state.airFrom;
    $("#air-to").value = state.airTo;
    $("#canon-from").value = state.canonFrom ?? "";
    $("#canon-to").value = state.canonTo ?? "";
    $("#travel-only").checked = state.travelOnly;
    $("#show-visions").checked = state.visions;
    $("#search").value = state.search;
  }

  buildControls();
  syncControls();
  render();
})();
