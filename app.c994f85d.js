/* Eat at State — Lunch Menus PWA */
(function () {
  "use strict";

  const CATEGORIES = ["entree", "side", "grain", "salad", "dessert", "beverage", "other"];
  const CAT_LABEL = {
    entree: "Entrees", side: "Sides", grain: "Grains",
    salad: "Salads", dessert: "Desserts", beverage: "Beverages", other: "Other",
  };
  const STORE_KEY = "eas-lunch-cache";

  // Static (GitHub Pages) mode: no backend, load the latest snapshot from
  // the data/ directory (published from the data branch).
  // Also enabled with ?static=1 for testing against a local server.
  const STATIC = location.hostname.endsWith(".github.io") ||
    new URLSearchParams(location.search).has("static");
  let staticFile = null; // {date, fetched_at, meals: {breakfast: {fetched_at, halls}, ...}}

  const state = {
    data: null,          // {meal, date, fetched_at, halls:[...]}
    meal: "lunch",
    date: null,
    hallIndex: 0,
    view: "categories",   // "stations" | "categories" | "nutrition"
    cats: new Set(),     // empty = all; in categories view
    query: "",
    loading: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- theme (dark default, light opt-in) ---------- */

  const THEME_KEY = "eas-theme";
  const STATION_STATE_KEY = "eas-stations-collapsed"; // ["<hall>||<station>", ...] — collapsed set
  const VIEW_KEY = "eas-view";       // "stations" | "categories" | "nutrition"
  const HALL_KEY = "eas-hall";       // hall name (index shifts when halls close, so persist by name)
  function isLight() { return document.documentElement.classList.contains("light"); }
  const ICON_M = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  const ICON_S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  function applyThemeBtn() {
    const btn = $("#theme-btn");
    if (!btn) return;
    const light = isLight();
    btn.innerHTML = light ? ICON_M : ICON_S;
    btn.title = light ? "Switch to dark theme" : "Switch to light theme";
    btn.setAttribute("aria-label", btn.title);
  }
  function initTheme() {
    // html.light already applied pre-paint by the head bootstrap.
    const btn = $("#theme-btn");
    if (btn) btn.addEventListener("click", () => {
      const next = isLight() ? "dark" : "light";
      document.documentElement.classList.toggle("light", next === "light");
      try {
        if (next === "dark") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, "light");
      } catch (e) {}
      applyThemeBtn();
    });
    applyThemeBtn();
  }

  /* ---------- data ---------- */

  function loadCache(meal, date) {
    try {
      const raw = localStorage.getItem(STORE_KEY + ":" + meal + ":" + date);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveCache(meal, date, data) {
    try {
      localStorage.setItem(STORE_KEY + ":" + meal + ":" + date, JSON.stringify(data));
      // prune old dates (keep only today per meal)
      const prefix = STORE_KEY + ":";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix) && k !== STORE_KEY + ":" + meal + ":" + date) {
          const d = k.slice(prefix.length).split(":").pop();
          if (d < todayStr()) localStorage.removeItem(k);
        }
      }
    } catch (e) { /* quota — ignore */ }
  }

  function todayStr() {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
  }

  // Date string (America/Detroit) for offsetDays days ago from today.
  function detDateStr(offsetDays) {
    const d = new Date(Date.now() - offsetDays * 86400000);
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  // Find the most recent snapshot in data/ (today back to 7 days).
  async function loadStatic(force) {
    if (staticFile && !force) return true;
    staticFile = null;
    for (let i = 0; i < 7; i++) {
      const key = detDateStr(i);
      try {
        const res = await fetch("data/" + key + ".json", { cache: "no-cache" });
        if (!res.ok) continue;
        const f = await res.json();
        if (f && f.meals && Object.keys(f.meals).length) {
          staticFile = f;
          return true;
        }
      } catch (e) { /* try the previous day */ }
    }
    return false;
  }

  async function fetchMenusStatic(meal, force) {
    state.meal = meal;
    renderChrome();
    if (!staticFile || force) {
      if (!staticFile) {
        const c = $("#content");
        c.innerHTML = "";
        c.appendChild(el("div", "status", "Loading menu data…"));
      }
      await loadStatic(force);
    }
    if (!staticFile || !staticFile.meals || !staticFile.meals[meal]) {
      const c = $("#content");
      c.innerHTML = "";
      c.appendChild(el("div", "empty", !staticFile
        ? "No menu data found. Check the data branch in the repository."
        : "No " + meal + " data in the latest snapshot."));
      return;
    }
    const blk = staticFile.meals[meal];
    state.data = {
      meal: meal,
      date: staticFile.date,
      fetched_at: blk.fetched_at || staticFile.fetched_at,
      halls: blk.halls,
    };
    state.date = staticFile.date;
    render();
  }

  // Dispatch to the live API or static snapshot depending on mode.
  function doFetch(meal, opts) {
    if (STATIC) return fetchMenusStatic(meal, opts && opts.force);
    return fetchMenus(meal, todayStr());
  }

  let reqSeq = 0;
  async function fetchMenus(meal, date) {
    const seq = ++reqSeq;
    state.meal = meal;
    renderChrome();
    state.loading = true;
    const btn = $("#refresh-btn");
    btn.classList.add("spinning");
    try {
      const res = await fetch("/api/menus?meal=" + meal + "&date=" + (date || todayStr()));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (seq !== reqSeq) return; // superseded by a newer request
      state.data = data;
      state.date = data.date;
      saveCache(data.meal, data.date, data);
      render();
    } catch (err) {
      if (seq !== reqSeq) return;
      const cached = loadCache(meal, state.date || date || todayStr());
      if (cached) {
        state.data = cached;
        state.date = cached.date;
        showOffline(true);
        render();
      } else {
        showError(err.message);
      }
    } finally {
      if (seq === reqSeq) {
        state.loading = false;
        btn.classList.remove("spinning");
      }
    }
  }

  function showError(msg) {
    state.data = null;
    $("#hall-row").innerHTML = "";
    $("#cat-row").hidden = true;
    $("#content").innerHTML = "";
    const d = el("div", "error");
    d.appendChild(el("div", null, "Could not load menus"));
    d.appendChild(el("div", null, msg));
    d.appendChild(el("div", null, "Check your connection and pull to refresh."));
    $("#content").appendChild(d);
  }

  function showOffline(on) {
    $("#offline-banner").hidden = !on;
  }

  /* ---------- derived data ---------- */

  function matches(q, entry) {
    if (!q) return true;
    const hay = (entry.item.name + " " + (entry.item.desc || "") + " " + entry.hall + " " + entry.station).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  /* ---------- rendering ---------- */

  function renderChrome() {
    if (state.date) $("#date-label").textContent = state.date;
    document.title = "Eat at State - Simplified";
  }

  function render() {
    if (!state.data) return;
    renderChrome();
    renderHallRow();
    renderCatRow();
    $("#date-label").textContent = state.date;
    $("#fetched-at").textContent =
      "Updated " + new Date(state.data.fetched_at).toLocaleString() + " · " + state.meal;
    renderContentOnly();
  }

  let userPickedHall = false; // set on chip click; persisted hall only applies before that
  function renderHallRow() {
    const row = $("#hall-row");
    row.innerHTML = "";
    const halls = state.data.halls;
    // Closed halls are hidden; keep the original data index for selection.
    const open = halls.map((h, i) => ({ h, i })).filter((e) => !e.h.closed);
    if (open.length) {
      if (!userPickedHall) {
        // First render of this session: restore the persisted hall by name
        // (name, not index — the index shifts when halls are closed).
        let saved = null;
        try { saved = localStorage.getItem(HALL_KEY); } catch (e) {}
        const match = open.find((e) => e.h.name === saved);
        state.hallIndex = (match || open[0]).i;
      } else if (!open.some((e) => e.i === state.hallIndex)) {
        state.hallIndex = open[0].i; // selected hall is closed
      }
    }
    open.forEach(({ h, i }) => {
      const b = el("button", "hall-chip" + (i === state.hallIndex ? " active" : ""));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === state.hallIndex));
      b.textContent = h.name;
      b.addEventListener("click", () => {
        userPickedHall = true;
        state.hallIndex = i;
        try { localStorage.setItem(HALL_KEY, h.name); } catch (e) {}
        renderHallRow();
        renderContentOnly();
      });
      row.appendChild(b);
    });
  }

  function renderCatRow() {
    const row = $("#cat-row");
    row.innerHTML = "";
    if (state.view !== "categories") { row.hidden = true; return; }
    row.hidden = false;
    const counts = {};
    // Counts follow the content scoping: all halls while searching,
    // otherwise the selected hall only.
    const entries = state.query ? allHallItems() : (() => {
      const hall = (state.data.halls[state.hallIndex] || state.data.halls[0]);
      return hall && !hall.closed && !hall.error ? hallItems(hall) : [];
    })();
    for (const e of entries) counts[e.item.cat] = (counts[e.item.cat] || 0) + 1;
    const all = el("button", "cat-chip" + (state.cats.size === 0 ? " active" : ""));
    all.textContent = "All";
    all.addEventListener("click", () => { state.cats.clear(); renderCatRow(); renderContentOnly(); });
    row.appendChild(all);
    for (const c of CATEGORIES) {
      if (!counts[c]) continue;
      const b = el("button", "cat-chip" + (state.cats.has(c) ? " active" : ""));
      b.innerHTML = "";
      b.appendChild(document.createTextNode(CAT_LABEL[c]));
      b.appendChild(el("span", "n", String(counts[c])));
      b.addEventListener("click", () => {
        if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
        if (state.cats.size === CATEGORIES.length) state.cats.clear();
        renderCatRow(); renderContentOnly();
      });
      row.appendChild(b);
    }
  }

  function renderContentOnly() {
    if (state.view === "stations") renderStations();
    else if (state.view === "categories") renderCategories();
    else renderNutrition();
  }

  function itemBadge(cat) {
    const b = el("span", "cat-badge" + (cat === "entree" ? " entree" : ""));
    b.textContent = cat;
    return b;
  }

  /* ---------- protein detection (from dish names; data has no such field) ---------- */

  const PROTEINS = [
    { id: "beef",      label: "Beef",      emoji: "🥩", re: /\b(beef|steak|hamburg?er|roast beef)\b/i },
    { id: "pork",      label: "Pork",      emoji: "🥓", re: /\b(pork|sausage|bacon)\b|\bham\b(?!\w*burger)/i },
    { id: "lamb",      label: "Lamb",      emoji: "🐑", re: /\blamb\b/i },
    { id: "poultry",   label: "Poultry",   emoji: "🍗", re: /\b(chicken|turkey|drumstick|thighs?)\b/i },
    { id: "fish",      label: "Fish",      emoji: "🐟", re: /\b(fish|salmon|tuna|cod|tilapia|trout|mackerel)\b/i },
    { id: "shellfish", label: "Shellfish", emoji: "🍤", re: /\b(shrimp|prawn|crab|lobster|scallop|calamari)\b/i },
    { id: "vegan",     label: "Vegan",     emoji: "🌱", re: /\b(tofu|tempeh|seitan|edamame|falafels?|lentils?|chickpeas?|quinoa|black beans?|kidney beans?|navy beans?|beans?)\b/i },
  ];
  function detectProteins(name) {
    const out = [];
    const n = name || "";
    // A "turkey burger" is poultry, not beef: suppress beef on burger when poultry is present.
    const isPoultry = /\b(chicken|turkey)\b/i.test(n);
    for (const p of PROTEINS) {
      if (p.id === "beef" && isPoultry) {
        if (/\b(beef|steak|roast beef)\b/i.test(n)) out.push(p);
      } else if (p.re.test(n)) {
        out.push(p);
      }
    }
    return out;
  }
  function proteinIcons(item) {
    const wrap = el("span", "protein-icons");
    for (const p of detectProteins(item.name)) {
      const s = el("span", "protein");
      s.textContent = p.emoji;
      s.title = p.label;
      wrap.appendChild(s);
    }
    return wrap;
  }

  function makeItemButton(entry) {
    const b = el("button", "item" + (entry.item.cat === "entree" ? " entree" : ""));
    b.appendChild(document.createTextNode(entry.item.name));
    b.appendChild(proteinIcons(entry.item));
    if (entry.item.calories) b.appendChild(el("span", "cal", Math.round(entry.item.calories) + " cal"));
    b.appendChild(itemBadge(entry.item.cat));
    b.addEventListener("click", () => openModal(entry));
    return b;
  }

  // Resolves the selected hall for hall-scoped views. If the hall is
  // unavailable (missing/closed/error) it renders the appropriate message
  // into #content and returns null; otherwise returns the hall untouched.
  function selectedHall(c) {
    const halls = state.data.halls;
    const hall = halls[state.hallIndex] || halls[0];
    if (!hall) { c.appendChild(el("div", "empty", "No halls available.")); return null; }
    if (hall.closed) {
      const d = el("div", "hall-closed");
      const big = el("div", "big");
      big.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><path d="M14 12v.01"/></svg>';
      d.appendChild(big);
      d.appendChild(el("div", null, hall.name + " is closed for lunch on " + state.date));
      c.appendChild(d);
      return null;
    }
    if (hall.error) {
      c.appendChild(el("div", "error", "Error loading " + hall.name + ": " + hall.error));
      return null;
    }
    return hall;
  }

  // Flat {item, hall, station} entries for a single hall's stations.
  function hallItems(hall) {
    const out = [];
    for (const s of hall.stations) {
      for (const it of s.items) out.push({ item: it, hall: hall.name, station: s.name });
    }
    return out;
  }

  // Flat entries across every open hall — used by search, which spans all halls.
  function allHallItems() {
    const out = [];
    for (const h of state.data.halls) {
      if (h.closed || h.error) continue;
      for (const e of hallItems(h)) out.push(e);
    }
    return out;
  }

  // Per-item source tag: station only when hall-scoped, "hall · station" in
  // global search where the hall is no longer implied.
  function entryTag(e, searching) {
    return searching ? e.hall + " · " + e.station : e.station;
  }

  // Collapsible station sections (Stations view). Expanded by default; the
  // collapsed set is persisted per hall+station so the layout survives reloads.
  function stationCollapsed() {
    try {
      const v = JSON.parse(localStorage.getItem(STATION_STATE_KEY) || "[]");
      return new Set(Array.isArray(v) ? v : Object.keys(v));
    }
    catch (e) { return new Set(); }
  }
  function setStationCollapsed(key, collapsed) {
    const s = stationCollapsed();
    if (collapsed) s.add(key); else s.delete(key);
    try {
      localStorage.setItem(STATION_STATE_KEY, JSON.stringify(Array.from(s)));
    } catch (e) {}
  }
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function renderStations() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    // No search: the selected hall. Search: every open hall.
    const halls = searching
      ? state.data.halls.filter((h) => !h.closed && !h.error)
      : [selectedHall(c)];
    if (!searching && !halls[0]) return;
    const collapsed = stationCollapsed();
    let shown = 0;
    for (const hall of halls) {
      if (!hall) continue;
      const byStation = {};
      const order = [];
      for (const s of hall.stations) {
        const items = s.items.filter((it) => matches(q, { item: it, hall: hall.name, station: s.name }));
        if (!items.length) continue;
        if (!byStation[s.name]) { byStation[s.name] = { group: s.group, items: [] }; order.push(s.name); }
        byStation[s.name].items.push(...items);
        shown += items.length;
      }
      // In global search the hall earns a header; otherwise the station name
      // leads, exactly like the normal Stations view.
      for (const name of order) {
        const st = byStation[name];
        const key = hall.name + "||" + name;
        const box = el("section", "station");
        const head = el("button", "station-head");
        head.type = "button";
        const isCollapsed = collapsed.has(key);
        if (isCollapsed) box.classList.add("collapsed");
        head.setAttribute("aria-expanded", String(!isCollapsed));
        if (searching) {
          head.appendChild(el("span", "station-name", hall.name));
          head.appendChild(el("span", "station-group", name));
        } else {
          head.appendChild(el("span", "station-name", name));
          if (st.group) head.appendChild(el("span", "station-group", st.group));
        }
        const chev = el("span", "chev");
        chev.innerHTML = CHEV;
        chev.setAttribute("aria-hidden", "true");
        head.appendChild(chev);
        box.appendChild(head);
        const ul = el("ul", "items");
        for (const it of st.items) ul.appendChild(makeItemButton({ item: it, hall: hall.name, station: name }));
        box.appendChild(ul);
        head.addEventListener("click", () => {
          const nowCollapsed = box.classList.toggle("collapsed");
          head.setAttribute("aria-expanded", String(!nowCollapsed));
          setStationCollapsed(key, nowCollapsed);
        });
        c.appendChild(box);
      }
    }
    if (!shown) c.appendChild(el("div", "empty", searching ? "No dishes match your search." : "No dishes to show."));
  }

  // Item button for a "list" section (cat-section/cat-list): name, protein
  // icons, station/hall tag, category badge. Used by Categories and Nutrition.
  function makeListItemButton(entry, searching) {
    const b = el("button", "item");
    b.appendChild(document.createTextNode(entry.item.name));
    b.appendChild(proteinIcons(entry.item));
    b.appendChild(el("span", "hall-tag", entryTag(entry, searching)));
    b.appendChild(itemBadge(entry.item.cat));
    b.addEventListener("click", () => openModal(entry));
    return b;
  }

  function renderCategories() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    // Search spans all halls; otherwise the selected hall only.
    let entries;
    if (searching) {
      entries = allHallItems().filter((e) =>
        (state.cats.size === 0 || state.cats.has(e.item.cat)) && matches(q, e));
    } else {
      const hall = selectedHall(c);
      if (!hall) return;
      entries = hallItems(hall).filter((e) =>
        (state.cats.size === 0 || state.cats.has(e.item.cat)) && matches(q, e));
    }
    if (!entries.length) { c.appendChild(el("div", "empty", "No dishes match your search.")); return; }
    const byCat = {};
    for (const e of entries) (byCat[e.item.cat] = byCat[e.item.cat] || []).push(e);
    for (const cat of CATEGORIES) {
      const list = byCat[cat];
      if (!list) continue;
      // Items matching a protein type (beef, lamb, …) float to the top of each category.
      list.sort((a, b) =>
        (detectProteins(b.item.name).length ? 1 : 0) - (detectProteins(a.item.name).length ? 1 : 0));
      const sec = el("section", "cat-section");
      sec.appendChild(el("h2", null, CAT_LABEL[cat] + "  (" + list.length + ")"));
      const ul = el("ul", "cat-list");
      for (const e of list) ul.appendChild(makeListItemButton(e, searching));
      sec.appendChild(ul);
      c.appendChild(sec);
    }
  }

  function renderNutrition() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    let entries;
    if (searching) {
      entries = allHallItems().filter((e) => matches(q, e));
    } else {
      const hall = selectedHall(c);
      if (!hall) return;
      entries = hallItems(hall).filter((e) => matches(q, e));
    }
    if (!entries.length) { c.appendChild(el("div", "empty", "No dishes match your search.")); return; }
    const byProtein = {};
    for (const e of entries) {
      for (const p of detectProteins(e.item.name)) (byProtein[p.id] = byProtein[p.id] || []).push(e);
    }
    let shown = false;
    for (const p of PROTEINS) {
      const list = byProtein[p.id];
      if (!list || !list.length) continue;
      shown = true;
      const sec = el("section", "cat-section");
      sec.appendChild(el("h2", null, p.emoji + " " + p.label + "  (" + list.length + ")"));
      const ul = el("ul", "cat-list");
      for (const e of list) ul.appendChild(makeListItemButton(e, searching));
      sec.appendChild(ul);
      c.appendChild(sec);
    }
    if (!shown) c.appendChild(el("div", "empty", "No dishes match your search."));
  }

  /* ---------- modal ---------- */

  function openModal(entry) {
    const m = $("#modal");
    const it = entry.item;
    $("#modal-title").textContent = it.name;
    $("#modal-title").appendChild(proteinIcons(it));
    const catDiv = $("#modal-cat");
    catDiv.innerHTML = "";
    catDiv.appendChild(itemBadge(it.cat));
    catDiv.appendChild(el("span", "hall-tag", entry.hall + " · " + entry.station));
    const meta = [];
    if (it.calories) meta.push(Math.round(it.calories) + " calories");
    $("#modal-meta").textContent = meta.join(" · ");
    $("#modal-desc").textContent = it.desc || "";
    $("#modal-desc").hidden = !it.desc;
    const ing = $("#modal-ingredients");
    if (it.ingredients) {
      ing.hidden = false;
      $("#modal-ingredients-text").textContent = it.ingredients;
    } else ing.hidden = true;
    m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* ---------- controls ---------- */

  const VIEWS = ["stations", "categories", "nutrition"];
  VIEWS.forEach((v) => $("#seg-" + v).addEventListener("click", () => setView(v)));
  function setView(v) {
    state.view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    VIEWS.forEach((x) => {
      const b = $("#seg-" + x);
      b.classList.toggle("active", x === v);
      b.setAttribute("aria-selected", String(x === v));
    });
    renderCatRow();
    renderContentOnly();
  }

  const searchInput = $("#search");
  // Collapsed search: ⌕ button on the view-mode row toggles the input row.
  const searchRow = $("#search-row");
  const searchToggle = $("#search-toggle");
  function setSearchOpen(open) {
    searchRow.hidden = !open;
    searchToggle.setAttribute("aria-expanded", String(open));
    if (open) searchInput.focus();
    else {
      searchInput.value = "";
      state.query = "";
      $("#search-clear").hidden = true;
      renderCatRow();
      renderContentOnly();
    }
  }
  searchToggle.addEventListener("click", () => setSearchOpen(searchRow.hidden));
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    $("#search-clear").hidden = !state.query;
    renderCatRow(); // chip counts follow the search scoping (all halls)
    renderContentOnly();
  });
  $("#search-clear").addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    $("#search-clear").hidden = true;
    renderCatRow();
    renderContentOnly();
  });

  // The static page is served from a provided JSON file, so there is no live
  // source to refresh — hide the refresh button in STATIC mode.
  if (STATIC) $("#refresh-btn").hidden = true;
  $("#refresh-btn").addEventListener("click", () => doFetch(state.meal, { force: true }));

  ["breakfast", "lunch", "dinner"].forEach((m) => {
    $("#meal-" + m).addEventListener("click", () => setMeal(m));
  });
  function setMeal(m) {
    if (m === state.meal && state.data) return;
    ["breakfast", "lunch", "dinner"].forEach((x) => {
      const b = $("#meal-" + x);
      b.classList.toggle("active", x === m);
      b.setAttribute("aria-selected", String(x === m));
    });
    state.meal = m;
    renderChrome();
    // instant: show any cached snapshot for this meal
    const today = todayStr();
    const cached = loadCache(m, today);
    if (cached) {
      state.data = cached;
      state.date = cached.date;
      render();
    } else {
      // no cache: show a loading state instead of stale content
      const c = $("#content");
      c.innerHTML = "";
      c.appendChild(el("div", "status", "Loading " + m + "…"));
    }
    doFetch(m);
  }

  /* ---------- offline / SW ---------- */

  function updateOnline() {
    if (navigator.onLine && !state.loading) {
      // back online: refetch to clear stale banner
      showOffline(false);
      doFetch(state.meal, { force: true });
    } else if (!navigator.onLine) {
      showOffline(true);
    }
  }
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);

  if ("serviceWorker" in navigator && !STATIC) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  /* ---------- init ---------- */

  initTheme();

  // Keep the sticky control bar docked right below the sticky topbar
  // (topbar height varies: safe-area inset, mobile single-row layout).
  const topbar = $(".topbar");
  const syncStickbarTop = () => {
    if (topbar) document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
  };
  syncStickbarTop();
  window.addEventListener("resize", syncStickbarTop);
  window.addEventListener("load", syncStickbarTop);
  if (topbar && "ResizeObserver" in window) {
    new ResizeObserver(syncStickbarTop).observe(topbar);
  }

  // Desktop: horizontal-scroll the hall row with the mouse wheel
  // (touch already scrolls natively).
  const hallRow = $("#hall-row");
  if (hallRow) hallRow.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already horizontal
    const max = hallRow.scrollWidth - hallRow.clientWidth;
    if (max <= 0) return;
    const atStart = hallRow.scrollLeft <= 0 && e.deltaY < 0;
    const atEnd = hallRow.scrollLeft >= max && e.deltaY > 0;
    if (atStart || atEnd) return; // let the page scroll at the edges
    hallRow.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // Default meal by local time: 9:00–11:00 breakfast, 11:00–16:30 lunch,
  // 16:30–21:00 dinner (3:00–4:30 is lunch per menu hours); before 9:00
  // breakfast is the next service, after 21:00 dinner just ended.
  function defaultMeal() {
    const d = new Date();
    const t = d.getHours() + d.getMinutes() / 60;
    if (t >= 9 && t < 11) return "breakfast";
    if (t >= 11 && t < 16.5) return "lunch";
    if (t >= 16.5) return "dinner";
    return "breakfast";
  }

  // Restore persisted view mode before the first render (HTML defaults to
  // Categories; the active class + state are aligned here without re-rendering).
  let savedView = null;
  try { savedView = localStorage.getItem(VIEW_KEY); } catch (e) {}
  if (savedView && VIEWS.includes(savedView) && savedView !== state.view) {
    state.view = savedView;
    VIEWS.forEach((x) => {
      const b = $("#seg-" + x);
      b.classList.toggle("active", x === savedView);
      b.setAttribute("aria-selected", String(x === savedView));
    });
  }

  const initialMeal = defaultMeal();
  if (initialMeal !== state.meal) {
    setMeal(initialMeal);
  } else {
    const cached = STATIC ? null : loadCache("lunch", todayStr());
    if (cached) {
      state.data = cached;
      state.date = cached.date;
      render();
    } else {
      render(); // shows loading status
    }
    doFetch("lunch");
  }
})();
