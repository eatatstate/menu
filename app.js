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
    view: "stations",    // "stations" | "categories"
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
  function isLight() { return document.documentElement.classList.contains("light"); }
  function applyThemeBtn() {
    const btn = $("#theme-btn");
    if (!btn) return;
    const light = isLight();
    btn.textContent = light ? "🌙" : "☀️";
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

  function openHalls() {
    if (!state.data) return [];
    return state.data.halls.filter((h) => !h.closed && !h.error);
  }

  function allItems() {
    // flat list: {hall, station, item}
    const out = [];
    for (const h of openHalls()) {
      for (const s of h.stations) {
        for (const it of s.items) {
          out.push({ hall: h.name, station: s.name, item: it });
        }
      }
    }
    return out;
  }

  function matches(q, entry) {
    if (!q) return true;
    const hay = (entry.item.name + " " + (entry.item.desc || "") + " " + entry.hall + " " + entry.station).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  /* ---------- rendering ---------- */

  function renderChrome() {
    const label = state.meal.charAt(0).toUpperCase() + state.meal.slice(1);
    $("#meal-label").textContent = label;
    if (state.date) $("#date-label").textContent = state.date;
    document.title = label + " · Eat at State";
  }

  function render() {
    if (!state.data) return;
    renderChrome();
    renderHallRow();
    renderCatRow();
    $("#date-label").textContent = state.date;
    $("#fetched-at").textContent =
      "Updated " + new Date(state.data.fetched_at).toLocaleString();
    if (state.view === "stations") renderStations();
    else renderCategories();
  }

  function renderHallRow() {
    const row = $("#hall-row");
    row.innerHTML = "";
    const halls = state.data.halls;
    // Closed halls are hidden; keep the original data index for selection.
    const open = halls.map((h, i) => ({ h, i })).filter((e) => !e.h.closed);
    if (open.length && !open.some((e) => e.i === state.hallIndex)) {
      state.hallIndex = open[0].i;
    }
    open.forEach(({ h, i }) => {
      const b = el("button", "hall-chip" + (i === state.hallIndex ? " active" : ""));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === state.hallIndex));
      b.textContent = h.name;
      b.addEventListener("click", () => { state.hallIndex = i; renderHallRow(); renderContentOnly(); });
      row.appendChild(b);
    });
  }

  function renderCatRow() {
    const row = $("#cat-row");
    row.innerHTML = "";
    if (state.view !== "categories") { row.hidden = true; return; }
    row.hidden = false;
    const counts = {};
    for (const e of allItems()) counts[e.item.cat] = (counts[e.item.cat] || 0) + 1;
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
    if (state.view === "stations") renderStations(); else renderCategories();
  }

  function itemBadge(cat) {
    const b = el("span", "cat-badge" + (cat === "entree" ? " entree" : ""));
    b.textContent = cat;
    return b;
  }

  function makeItemButton(entry) {
    const b = el("button", "item" + (entry.item.cat === "entree" ? " entree" : ""));
    b.appendChild(document.createTextNode(entry.item.name));
    if (entry.item.calories) b.appendChild(el("span", "cal", Math.round(entry.item.calories) + " cal"));
    b.appendChild(itemBadge(entry.item.cat));
    b.addEventListener("click", () => openModal(entry));
    return b;
  }

  function renderStations() {
    const c = $("#content");
    c.innerHTML = "";
    const halls = state.data.halls;
    const hall = halls[state.hallIndex] || halls[0];
    if (!hall) { c.appendChild(el("div", "empty", "No halls available.")); return; }
    if (hall.closed) {
      const d = el("div", "hall-closed");
      d.appendChild(el("div", "big", "🚪"));
      d.appendChild(el("div", null, hall.name + " is closed for lunch on " + state.date));
      c.appendChild(d);
      return;
    }
    if (hall.error) {
      c.appendChild(el("div", "error", "Error loading " + hall.name + ": " + hall.error));
      return;
    }
    const q = state.query.toLowerCase();
    let shown = 0;
    for (const s of hall.stations) {
      const items = s.items.filter((it) => matches(q, { item: it, hall: hall.name, station: s.name }));
      if (!items.length) continue;
      shown += items.length;
      const box = el("section", "station");
      const head = el("div", "station-head");
      head.appendChild(el("span", "station-name", s.name));
      if (s.group) head.appendChild(el("span", "station-group", s.group));
      box.appendChild(head);
      const ul = el("ul", "items");
      for (const it of items) ul.appendChild(makeItemButton({ item: it, hall: hall.name, station: s.name }));
      box.appendChild(ul);
      c.appendChild(box);
    }
    if (!shown) c.appendChild(el("div", "empty", "No dishes match your search."));
  }

  function renderCategories() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const entries = allItems().filter((e) =>
      (state.cats.size === 0 || state.cats.has(e.item.cat)) && matches(q, e)
    );
    if (!entries.length) { c.appendChild(el("div", "empty", "No dishes match.")); return; }
    const byCat = {};
    for (const e of entries) (byCat[e.item.cat] = byCat[e.item.cat] || []).push(e);
    for (const cat of CATEGORIES) {
      const list = byCat[cat];
      if (!list) continue;
      const sec = el("section", "cat-section");
      sec.appendChild(el("h2", null, CAT_LABEL[cat] + "  (" + list.length + ")"));
      // group by hall
      const byHall = {};
      for (const e of list) (byHall[e.hall] = byHall[e.hall] || []).push(e);
      for (const hall of Object.keys(byHall)) {
        const items = byHall[hall];
        if (Object.keys(byHall).length > 1) sec.appendChild(el("div", "cat-hall", hall));
        const ul = el("ul", "cat-list");
        for (const e of items) {
          const b = el("button", "item");
          b.appendChild(document.createTextNode(e.item.name));
          b.appendChild(el("span", "hall-tag", e.station));
          b.appendChild(itemBadge(e.item.cat));
          b.addEventListener("click", () => openModal(e));
          ul.appendChild(b);
        }
        sec.appendChild(ul);
      }
      c.appendChild(sec);
    }
  }

  /* ---------- modal ---------- */

  function openModal(entry) {
    const m = $("#modal");
    const it = entry.item;
    $("#modal-title").textContent = it.name;
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

  $("#seg-stations").addEventListener("click", () => setView("stations"));
  $("#seg-categories").addEventListener("click", () => setView("categories"));
  function setView(v) {
    state.view = v;
    $("#seg-stations").classList.toggle("active", v === "stations");
    $("#seg-categories").classList.toggle("active", v === "categories");
    $("#seg-stations").setAttribute("aria-selected", String(v === "stations"));
    $("#seg-categories").setAttribute("aria-selected", String(v === "categories"));
    renderCatRow();
    renderContentOnly();
  }

  const searchInput = $("#search");
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    $("#search-clear").hidden = !state.query;
    renderContentOnly();
  });
  $("#search-clear").addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    $("#search-clear").hidden = true;
    renderContentOnly();
  });

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

  const today = todayStr();
  const cached = STATIC ? null : loadCache("lunch", today);
  if (cached) {
    state.data = cached;
    state.date = cached.date;
    render();
  } else {
    render(); // shows loading status
  }
  doFetch("lunch");
})();
