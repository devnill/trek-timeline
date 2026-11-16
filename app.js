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
  // Why a year is marked approximate: the season estimate, or vague on screen.
  const estimated = (entry) => !entry.curated && entry.events[0].approx && !(entry.ma?.date || "").match(/\d{3}0s/);
  const approxWhy = (entry) => estimated(entry)
    ? "Approximate year: Memory Alpha gives no year for this episode, so it is estimated from the season."
    : "Approximate year: the story only gives a rough date (such as a decade), so years marked “c.” are best guesses.";
  const approxBadge = (entry) => el("span", { class: "approx-badge" }, estimated(entry) ? "≈ est. year" : "≈ approx.");
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

  function airCard(entry) {
    return el("button", {
      type: "button",
      class: `card air-card${entry.curated ? "" : " plain"}`,
      style: `--c:${SERIES[entry.series].color}`,
      "data-entry": entry.id,
      onclick: () => select(entry.id),
    },
      el("div", { class: "card-top" }, seriesBadge(entry),
        el("span", { class: "card-meta" }, [epCode(entry), fmtAir(entry.air), stardateOf(entry) && `SD ${stardateOf(entry)}`].filter(Boolean).join(" · "))),
      el("div", { class: "card-title" }, entry.title),
      entry.summary ? el("div", { class: "card-note" }, entry.summary) : null,
      el("div", { class: "placements" },
        entry.events.map((ev) =>
          el("span", { class: `place tl-${ev.tl}${ev.approx ? " approx" : ""}`,
            title: `${tlName(ev)} — ${KIND[ev.kind].label}${ev.approx ? " · year is approximate" : ""}` },
            `${KIND[ev.kind].icon} ${fmtYear(ev.y, ev.approx)}`,
            ev.tl !== "prime" ? el("small", {}, ` ${tlName(ev)}`) : null))));
  }

  // ---------- views ----------
  const centuryOf = (y) => (y < 0 ? "Before the Common Era" : `${Math.floor(y / 100) + 1}${ordinal(Math.floor(y / 100) + 1)} century`);
  // Overview segments: whole centuries from 1800 on; everything earlier is grouped.
  const eraOf = (y) => (y < 0 ? "Deep past" : y < 1800 ? "Before 1800" : centuryOf(y));
  const eraShort = (name) => ({ "Deep past": "BCE", "Before 1800": "<1800" }[name] ?? name.replace(" century", ""));

  let overview = [];   // [{ name, years, pos(y), node, marks }]
  let yearRows = [];   // rows that start a year, for the position readout

  function trackCard(entry, ev, idx) {
    const tag = ev.tl === "alt" ? ev.branch || "Alternate" : ev.tl !== "prime" ? TIMELINES[ev.tl].name : null;
    return el("button", {
      type: "button",
      class: `card kind-${ev.kind}${entry.curated ? "" : " plain"}${ev.approx ? " approx" : ""}`,
      style: `--c:${SERIES[entry.series].color}`,
      "data-entry": entry.id,
      "data-idx": idx,
      onclick: () => select(entry.id),
      title: ev.approx ? `${KIND[ev.kind].label} · year is approximate` : KIND[ev.kind].label,
    },
      el("div", { class: "card-top" },
        el("span", { class: "kind-icon", "aria-label": KIND[ev.kind].label }, KIND[ev.kind].icon),
        seriesBadge(entry),
        el("span", { class: "card-title" }, entry.title),
        tag ? el("span", { class: `branch tl-${ev.tl}` }, tag) : null,
        ev.approx ? approxBadge(entry) : null,
        el("span", { class: "card-meta" }, [
          ev.kind === "home" && stardateOf(entry) ? `SD ${stardateOf(entry)}` : null,
          epCode(entry), `Aired ${fmtAir(entry.air)}`].filter(Boolean).join(" · "))),
      ev.note ? el("div", { class: "card-note" }, ev.note) : null);
  }

  // One ordered column: by year, then stardate (scenes in their home time), then air date.
  // Each timeline is a rail on the left, drawn from its first point to its last.
  function renderCanon(entries) {
    const lanes = LANES.filter((l) => state.timelines.has(l));
    const items = [];
    for (const entry of entries) {
      entry.events.forEach((ev, idx) => {
        if (!eventVisible(ev)) return;
        items.push({ entry, ev, idx, key: ev.kind === "home" && entry.order != null ? entry.order : Infinity });
      });
    }
    items.sort((a, b) => (a.ev.y - b.ev.y) || (a.key - b.key) || a.entry.air.localeCompare(b.entry.air));

    const span = {};
    items.forEach((it, i) => { (span[it.ev.tl] ||= [i, i])[1] = i; });
    const yearApprox = new Map();
    for (const it of items) yearApprox.set(it.ev.y, (yearApprox.get(it.ev.y) ?? true) && !!it.ev.approx);

    // between = a row that sits just above item i (era bars, gaps).
    const rails = (i, tl, between) => el("div", { class: "rails", "aria-hidden": "true" }, lanes.map((l) => {
      const s = span[l];
      const on = s && (between ? i > s[0] && i <= s[1] : i >= s[0] && i <= s[1]);
      const cls = `rail tl-${l}${on ? " on" : ""}${on && !between && i === s[0] ? " start" : ""}${on && !between && i === s[1] ? " end" : ""}`;
      return el("span", { class: cls }, l === tl ? el("i", { class: `dot kind-${items[i].ev.kind}` }) : null);
    }));

    const out = [];
    let prev = null;
    items.forEach((it, i) => {
      const y = it.ev.y;
      const first = y !== prev;
      if (first && (prev == null || centuryOf(y) !== centuryOf(prev))) {
        out.push(el("div", { class: "trow era-row" }, el("div"), rails(i, null, true), el("h3", { class: "era" }, centuryOf(y))));
      } else if (first && y - prev > 20) {
        out.push(el("div", { class: "trow gap-row" }, el("div"), rails(i, null, true), el("div", { class: "gap" }, fmtSpan(y - prev))));
      }
      const approx = yearApprox.get(y);
      out.push(el("div", { class: `trow${first ? " new-year" : ""}`, "data-year": first ? y : null },
        el("div", { class: `tyear${approx ? " approx" : ""}${first ? "" : " repeat"}`, title: approx ? "Approximate year" : null },
          fmtYear(y, approx), first && approx ? el("small", {}, "approx.") : null),
        rails(i, it.ev.tl, false),
        trackCard(it.entry, it.ev, it.idx)));
      prev = y;
    });
    const list = el("div", { class: "track-list", style: `--nl:${lanes.length}` }, out);
    renderOverview(items, lanes);
    return [list];
  }

  function renderOverview(items, lanes) {
    const head = $("#canon-head");
    head.hidden = false;
    overview = [];
    for (const it of items) {
      const name = eraOf(it.ev.y);
      let seg = overview[overview.length - 1];
      if (!seg || seg.name !== name) overview.push(seg = { name, years: [], pts: new Map() });
      if (seg.years[seg.years.length - 1] !== it.ev.y) seg.years.push(it.ev.y);
      seg.pts.set(`${it.ev.y}|${it.ev.tl}`, it.ev);
    }
    const segs = overview.map((seg) => {
      const centuryStart = seg.name.endsWith("century") ? Math.floor(seg.years[0] / 100) * 100 : null;
      const lo = centuryStart ?? seg.years[0];
      const hi = centuryStart != null ? centuryStart + 99 : seg.years[seg.years.length - 1];
      // Deep past spans billions of years, so place its points evenly instead.
      seg.pos = (y) => (seg.name === "Deep past"
        ? (seg.years.indexOf(y) + 0.5) / seg.years.length
        : hi === lo ? 0.5 : (y - lo) / (hi - lo));
      seg.lo = lo; seg.hi = hi;
      seg.marks = el("span", { class: "ov-marks" });
      seg.caret = el("span", { class: "ov-caret", hidden: true });
      const n = [...seg.pts.keys()].length;
      seg.node = el("button", {
        type: "button", class: "ov-seg",
        style: `flex-grow:${(1 + Math.sqrt(n)).toFixed(2)}`,
        title: `${seg.name}: ${seg.years.length} years with stories (${fmtYear(seg.years[0])} – ${fmtYear(seg.years[seg.years.length - 1])})`,
        onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const target = seg.name === "Deep past" ? seg.years[Math.min(seg.years.length - 1, Math.floor(frac * seg.years.length))]
            : seg.years.find((y) => seg.pos(y) >= frac - 0.02) ?? seg.years[seg.years.length - 1];
          jumpToYear(target);
        },
      },
        el("span", { class: "ov-label" }, eraShort(seg.name)),
        el("span", { class: "ov-ticks" },
          [...seg.pts.values()].map((ev) => el("i", { class: `tick tl-${ev.tl}`, style: `left:${(seg.pos(ev.y) * 100).toFixed(2)}%` })),
          seg.marks, seg.caret));
      return seg.node;
    });
    head.replaceChildren(
      el("div", { class: "ov-bar" }, segs),
      el("div", { class: "ov-foot" },
        el("span", { class: "ov-readout" }),
        el("span", { class: "ov-legend" }, lanes.map((l) => el("span", { class: `tl-${l}` }, el("i"), TIMELINES[l].name))),
        el("span", { class: "ov-hint" }, "Click the bar to jump · eras are not to scale")));
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
    if (state.view !== "canon" || !overview.length) return;
    const line = $(".top").offsetHeight + $("#canon-head").offsetHeight + 10;
    let current = null;
    for (const row of yearRows) {
      if (row.getBoundingClientRect().top <= line + 4) current = +row.dataset.year;
      else break;
    }
    if (current == null && yearRows.length) current = +yearRows[0].dataset.year;
    for (const seg of overview) {
      const here = current != null && eraOf(current) === seg.name;
      seg.node.classList.toggle("current", here);
      seg.caret.hidden = !here;
      if (here) seg.caret.style.left = `${(seg.pos(current) * 100).toFixed(2)}%`;
    }
    const readout = $(".ov-readout");
    if (readout && current != null) readout.textContent = `Viewing ${fmtYear(current)}`;
  }
  window.addEventListener("scroll", () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updatePosition); }
  }, { passive: true });

  function markOverview() {
    for (const seg of overview) seg.marks.replaceChildren();
    if (!selected || state.view !== "canon") return;
    for (const ev of byId.get(selected).events) {
      if (!eventVisible(ev)) continue;
      const seg = overview.find((s) => s.name === eraOf(ev.y));
      if (seg) seg.marks.append(el("i", { class: `mark kind-${ev.kind}`, style: `left:${(seg.pos(ev.y) * 100).toFixed(2)}%;--c:${SERIES[byId.get(selected).series].color}`, title: fmtYear(ev.y) }));
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

  function renderAir(entries) {
    $("#canon-head").hidden = true;
    const sorted = [...entries].sort((a, b) => a.air.localeCompare(b.air));
    const out = [];
    let year = null, grid = null;
    for (const entry of sorted) {
      const y = entry.air.slice(0, 4);
      if (y !== year) {
        year = y;
        grid = el("div", { class: "air-grid" });
        out.push(el("section", { class: "air-year" }, el("h3", { class: "era" }, y), grid));
      }
      grid.append(airCard(entry));
    }
    return out;
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
    if (state.view !== "canon") overview = [];
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
      entry.events.some((ev) => ev.approx) ? el("p", { class: "approx-note" }, approxWhy(entry)) : null,
      el("h3", {}, "Points in time"),
      el("ol", { class: "detail-events" },
        [...entry.events].sort((a, b) => a.y - b.y).map((ev) =>
          el("li", { class: `tl-${ev.tl}` },
            el("button", { type: "button", onclick: () => focusEvent(entry, ev) },
              el("strong", {}, `${KIND[ev.kind].icon} ${fmtYear(ev.y, ev.approx)}`),
              el("span", { class: "tl-tag" }, tlName(ev)),
              ev.approx ? el("span", { class: "tl-tag approx-tag" }, "approx.") : null,
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
