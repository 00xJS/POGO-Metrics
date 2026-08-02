/* catalog-ui.js — the "Filter Deck" rendering of window.CATALOG.
 *
 * Replaces the old 8-group grid of cards whose detail lived inside 21 <details>
 * collapsibles. Here nothing is nested: every field of every file is in the DOM,
 * and a single density switch (LIST / CARDS / FULL) decides how much shows.
 * Filtering hides with the `hidden` attribute so hidden cards leave the tab order
 * and the accessibility tree cleanly.
 *
 * All counts are derived from the catalog at runtime — nothing is hardcoded, so
 * adding a file to catalog.js updates every number, chip and filter for free. */
(function () {
  const root = document.getElementById("catalog");
  if (!root || !window.CATALOG) return;

  const C = window.CATALOG;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const ORDER = [
    "Your Profile", "Your Activity", "Your Social World", "Your Spending",
    "Your Fitness", "Events", "Technical & Device", "Identity (not visualised)",
  ];
  const SENS = [
    { k: "high", label: "High", color: "var(--red)" },
    { k: "medium", label: "Medium", color: "var(--orange)" },
    { k: "low", label: "Low", color: "var(--green)" },
  ];
  const SENS_RANK = { high: 3, medium: 2, low: 1 };

  /* ── derive everything from the data ───────────────────────────────── */
  const isGps = (c) => /latitude|longitude/i.test(c.columns.join(" "));
  const stats = {
    total: C.length,
    high: C.filter((c) => c.sensitivity === "high").length,
    ignored: C.filter((c) => !c.story).length,
    charted: C.filter((c) => c.story).length,
    gps: C.filter(isGps).length,
    columns: C.reduce((a, c) => a + c.columns.length, 0),
  };
  const groups = ORDER.filter((g) => C.some((c) => c.group === g));
  const groupCount = (g) => C.filter((c) => c.group === g).length;

  // per-entry search index + the individual fragments the echo needs to quote back
  C.forEach((c) => {
    c._fields = [
      ...c.contains.map((t) => ({ label: "Contains", text: t })),
      ...c.columns.map((t) => ({ label: "Raw column", text: t })),
    ];
    c._hay = [c.name, c.id, c.group, c.summary, c.sensitivityNote, c.story || "",
      c.contains.join(" "), c.columns.join(" ")].join(" ").toLowerCase();
  });

  /* ── state ─────────────────────────────────────────────────────────── */
  const state = { sens: new Set(), doing: new Set(), group: new Set(), gps: false, q: "", sort: "default", density: "cards" };

  /* ── markup ────────────────────────────────────────────────────────── */
  const tile = (v, k, filter) =>
    `<button class="deck-tile${filter ? "" : " is-inert"}" type="button"${filter ? ` data-tile="${filter}" aria-pressed="false"` : ' aria-disabled="true" tabindex="-1"'}>
       <span class="dt-v">${v}</span><span class="dt-k">${esc(k)}</span>
     </button>`;

  const chip = (kind, val, label, count, dot) =>
    `<button class="chip" type="button" data-kind="${kind}" data-val="${esc(val)}" aria-pressed="false">
       ${dot ? `<span class="chip-dot" style="background:${dot}" aria-hidden="true"></span>` : ""}
       <span class="chip-l">${esc(label)}</span><span class="chip-n">${count}</span>
     </button>`;

  root.innerHTML = `
    <div class="deck-stats">
      ${tile(stats.total, "files in export", "")}
      ${tile(stats.high, "high sensitivity", "high")}
      ${tile(stats.ignored, "we never read", "ignored")}
      ${tile(stats.gps, "contain your GPS", "gps")}
    </div>

    <div class="deck-bar" role="region" aria-label="Filter and search the file catalog">
      <div class="deck-find-row">
        <input type="search" id="deck-find" class="deck-find" autocomplete="off"
               placeholder="Search files, contents, or raw column names…"
               aria-label="Search files, contents, or raw column names">
        <div class="deck-seeds">TRY:
          ${["latitude", "email", "IP", "address", "payment"].map((s) => `<button class="seed" type="button">${s}</button>`).join(" · ")}
        </div>
      </div>

      <div class="deck-rails">
        <div class="rail" role="group" aria-label="Filter by sensitivity">
          <span class="rail-l">Sensitivity</span>
          ${SENS.map((s) => chip("sens", s.k, s.label, C.filter((c) => c.sensitivity === s.k).length, s.color)).join("")}
        </div>
        <div class="rail" role="group" aria-label="Filter by what this site does with the file">
          <span class="rail-l">What we do</span>
          ${chip("doing", "charted", "We chart it", stats.charted, "var(--accent)")}
          ${chip("doing", "ignored", "We never read", stats.ignored, "var(--ink-faint)")}
        </div>
        <div class="rail rail-group" role="group" aria-label="Filter by group">
          <span class="rail-l">Group</span>
          ${groups.map((g) => chip("group", g, g, groupCount(g), "")).join("")}
        </div>
      </div>

      <div class="deck-controls">
        <label class="ctl"><span class="rail-l">Sort</span>
          <select class="deck-sort" aria-label="Sort files">
            <option value="default">Catalog order</option>
            <option value="sens">Sensitivity</option>
            <option value="group">Group</option>
            <option value="az">A–Z</option>
            <option value="fields">Field count</option>
          </select>
        </label>
        <div class="ctl"><span class="rail-l" id="dens-l">Detail</span>
          <div class="dens" role="radiogroup" aria-labelledby="dens-l">
            <button role="radio" aria-checked="false" data-d="list" type="button" tabindex="-1">List</button>
            <button role="radio" aria-checked="true"  data-d="cards" type="button" tabindex="0">Cards</button>
            <button role="radio" aria-checked="false" data-d="full" type="button" tabindex="-1">Full</button>
          </div>
        </div>
        <button class="chip chip-clear" type="button" id="deck-clear" hidden>Clear filters ✕</button>
      </div>
    </div>

    <p class="sr-only" role="status" aria-live="polite" id="deck-live"></p>
    <p class="deck-count" id="deck-count"></p>

    <div class="deck-grid" id="deck-grid"></div>
    <div class="deck-listwrap" id="deck-listwrap"></div>
    <p class="deck-empty" id="deck-empty" hidden>No files match those filters. <button type="button" class="linkish" id="deck-reset">Clear them</button>.</p>`;

  /* ── cards ─────────────────────────────────────────────────────────── */
  const micro = (t) => `<div class="ml">${esc(t)}</div>`;
  const cardHTML = (c) => {
    const sens = SENS.find((s) => s.k === c.sensitivity) || SENS[1];
    return `<article class="fcard spine-${c.sensitivity}" id="f-${slug(c.id)}" data-id="${esc(c.id)}">
      <div class="fc-head">
        <span class="fc-emoji" aria-hidden="true">${c.icon}</span>
        <div class="fc-id">
          <h3 class="fc-name">${esc(c.name)}</h3>
          <div class="fc-file">${esc(c.id)}</div>
        </div>
        <span class="fc-cols" title="${c.columns.length} raw columns">${c.columns.length} COLS</span>
      </div>
      <div class="fc-meta">
        <span class="chip chip-static">${esc(c.group)}</span>
        <span class="sens-pill sens-${c.sensitivity}"><span class="chip-dot" style="background:${sens.color}" aria-hidden="true"></span>${sens.label} sensitivity</span>
      </div>
      <p class="fc-sum">${esc(c.summary)}</p>
      <div class="fc-story ${c.story ? "" : "is-none"}">
        ${micro(c.story ? "What we build" : "We never read this file")}
        <p>${c.story ? esc(c.story) : "Nothing to chart here — this site deliberately leaves it alone."}</p>
      </div>
      <div class="fc-block">${micro("Why it's " + c.sensitivity)}<p>${esc(c.sensitivityNote)}</p></div>
      <div class="fc-block">${micro("What's inside")}<ul class="fc-list">${c.contains.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="fc-block fc-cols-block">${micro("Raw columns Niantic ships")}
        <ul class="fc-colchips">${c.columns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>
      <div class="fc-block fc-retention">${micro("Niantic retention")}<p>${esc(c.retention)}</p></div>
      <button class="fc-showcols" type="button">Show raw columns →</button>
      <div class="fc-echo" hidden></div>
    </article>`;
  };

  const grid = document.getElementById("deck-grid");
  grid.innerHTML = C.map(cardHTML).join("");
  const cardOf = new Map(C.map((c) => [c.id, grid.querySelector(`[data-id="${CSS.escape(c.id)}"]`)]));

  /* ── list (mission-control table) ──────────────────────────────────── */
  const listwrap = document.getElementById("deck-listwrap");
  listwrap.innerHTML = `
    <table class="deck-list">
      <caption class="sr-only">Every file in a Niantic Pokémon GO export, with its group, sensitivity, what this site builds from it, and how many raw columns it has.</caption>
      <thead><tr>
        <th scope="col" data-sort="az">File</th>
        <th scope="col" data-sort="group">Group</th>
        <th scope="col" data-sort="sens">Sensitivity</th>
        <th scope="col">We build</th>
        <th scope="col" class="num" data-sort="fields">Fields</th>
      </tr></thead>
      <tbody>${C.map((c) => {
        const sens = SENS.find((s) => s.k === c.sensitivity) || SENS[1];
        return `<tr data-id="${esc(c.id)}">
          <td><span aria-hidden="true">${c.icon}</span> <b>${esc(c.name)}</b><span class="lt-file">${esc(c.id)}</span></td>
          <td class="lt-mono">${esc(c.group)}</td>
          <td><span class="chip-dot" style="background:${sens.color}" aria-hidden="true"></span>${sens.label}</td>
          <td class="lt-story">${c.story ? esc(c.story) : '<span class="lt-ign">Ignored</span>'}</td>
          <td class="num">${c.columns.length}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  const rowOf = new Map(C.map((c) => [c.id, listwrap.querySelector(`tr[data-id="${CSS.escape(c.id)}"]`)]));

  /* ── filtering + sorting ───────────────────────────────────────────── */
  const matches = (c) => {
    if (state.sens.size && !state.sens.has(c.sensitivity)) return false;
    if (state.doing.size) {
      const key = c.story ? "charted" : "ignored";
      if (!state.doing.has(key)) return false;
    }
    if (state.group.size && !state.group.has(c.group)) return false;
    if (state.gps && !isGps(c)) return false;
    if (state.q && !c._hay.includes(state.q)) return false;
    return true;
  };

  const sorters = {
    default: () => 0,
    sens: (a, b) => SENS_RANK[b.sensitivity] - SENS_RANK[a.sensitivity] || a.name.localeCompare(b.name),
    group: (a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.name.localeCompare(b.name),
    az: (a, b) => a.name.localeCompare(b.name),
    fields: (a, b) => b.columns.length - a.columns.length || a.name.localeCompare(b.name),
  };

  const echoFor = (c) => {
    if (!state.q) return "";
    const hits = c._fields.filter((f) => f.text.toLowerCase().includes(state.q)).slice(0, 4);
    if (!hits.length) return "";
    return hits.map((f) => {
      const i = f.text.toLowerCase().indexOf(state.q);
      const t = esc(f.text.slice(0, i)) + "<mark>" + esc(f.text.slice(i, i + state.q.length)) + "</mark>" + esc(f.text.slice(i + state.q.length));
      return `<span class="echo-chip"><span class="ec-l">${esc(f.label)}</span>${t}</span>`;
    }).join("");
  };

  const live = document.getElementById("deck-live");
  const countEl = document.getElementById("deck-count");
  const emptyEl = document.getElementById("deck-empty");
  const clearBtn = document.getElementById("deck-clear");
  let liveTimer = null;

  function apply() {
    const shown = C.filter(matches).sort(sorters[state.sort] || sorters.default);
    const shownIds = new Set(shown.map((c) => c.id));

    // re-append in sorted order so the DOM order matches the visual + a11y order
    shown.forEach((c) => {
      const el = cardOf.get(c.id);
      el.hidden = false;
      grid.appendChild(el);
      const e = el.querySelector(".fc-echo");
      const html = echoFor(c);
      e.innerHTML = html;
      e.hidden = !html;
      rowOf.get(c.id).hidden = false;
      listwrap.querySelector("tbody").appendChild(rowOf.get(c.id));
    });
    C.forEach((c) => {
      if (shownIds.has(c.id)) return;
      cardOf.get(c.id).hidden = true;
      rowOf.get(c.id).hidden = true;
    });

    const anyFilter = state.sens.size || state.doing.size || state.group.size || state.gps || state.q;
    clearBtn.hidden = !anyFilter;
    emptyEl.hidden = shown.length > 0;
    countEl.textContent = shown.length === C.length
      ? `All ${C.length} files · ${stats.columns} raw columns · ${stats.charted} charted, ${stats.ignored} left alone`
      : `Showing ${shown.length} of ${C.length} files`;

    // live region, debounced so typing doesn't spam a screen reader
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { live.textContent = `Showing ${shown.length} of ${C.length} files`; }, 300);

    // chip pressed states
    root.querySelectorAll(".chip[data-kind]").forEach((b) => {
      const set = state[b.dataset.kind === "sens" ? "sens" : b.dataset.kind === "doing" ? "doing" : "group"];
      b.setAttribute("aria-pressed", String(set.has(b.dataset.val)));
    });
    root.querySelectorAll(".deck-tile[data-tile]").forEach((b) => {
      const t = b.dataset.tile;
      const on = t === "high" ? state.sens.has("high") : t === "ignored" ? state.doing.has("ignored") : state.gps;
      b.setAttribute("aria-pressed", String(on));
    });
    writeHash();
  }

  /* ── URL state (no storage — consistent with the privacy pitch) ─────── */
  function writeHash() {
    const p = [];
    if (state.sens.size) p.push("sens=" + [...state.sens].join(","));
    if (state.doing.size) p.push("do=" + [...state.doing].join(","));
    if (state.group.size) p.push("group=" + [...state.group].map(encodeURIComponent).join(","));
    if (state.gps) p.push("gps=1");
    if (state.q) p.push("q=" + encodeURIComponent(state.q));
    if (state.sort !== "default") p.push("sort=" + state.sort);
    if (state.density !== "cards") p.push("d=" + state.density);
    history.replaceState(null, "", "#datasets" + (p.length ? "&" + p.join("&") : ""));
  }
  function readHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h.startsWith("datasets")) return;
    h.split("&").slice(1).forEach((kv) => {
      const [k, v] = kv.split("=");
      if (!v) return;
      if (k === "sens") v.split(",").forEach((x) => state.sens.add(x));
      if (k === "do") v.split(",").forEach((x) => state.doing.add(x));
      if (k === "group") v.split(",").forEach((x) => state.group.add(decodeURIComponent(x)));
      if (k === "gps") state.gps = true;
      if (k === "q") state.q = decodeURIComponent(v).toLowerCase();
      if (k === "sort") state.sort = v;
      if (k === "d") state.density = v;
    });
    if (state.q) document.getElementById("deck-find").value = state.q;
    root.querySelector(".deck-sort").value = state.sort;
    setDensity(state.density, false);
  }

  /* ── density ───────────────────────────────────────────────────────── */
  function setDensity(d, focus) {
    state.density = d;
    root.dataset.density = d;
    root.querySelectorAll(".dens button").forEach((b) => {
      const on = b.dataset.d === d;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
  }

  /* ── events ────────────────────────────────────────────────────────── */
  root.addEventListener("click", (e) => {
    const chipBtn = e.target.closest(".chip[data-kind]");
    if (chipBtn) {
      const kind = chipBtn.dataset.kind;
      const set = state[kind === "sens" ? "sens" : kind === "doing" ? "doing" : "group"];
      const v = chipBtn.dataset.val;
      set.has(v) ? set.delete(v) : set.add(v);
      return apply();
    }
    const t = e.target.closest(".deck-tile[data-tile]");
    if (t) {
      const k = t.dataset.tile;
      if (k === "high") state.sens.has("high") ? state.sens.delete("high") : state.sens.add("high");
      else if (k === "ignored") state.doing.has("ignored") ? state.doing.delete("ignored") : state.doing.add("ignored");
      else state.gps = !state.gps;
      return apply();
    }
    const seed = e.target.closest(".seed");
    if (seed) {
      const inp = document.getElementById("deck-find");
      inp.value = seed.textContent;
      state.q = seed.textContent.toLowerCase();
      inp.focus();
      return apply();
    }
    const dens = e.target.closest(".dens button");
    if (dens) return setDensity(dens.dataset.d, false), writeHash();
    if (e.target.closest("#deck-clear") || e.target.closest("#deck-reset")) {
      state.sens.clear(); state.doing.clear(); state.group.clear();
      state.gps = false; state.q = "";
      document.getElementById("deck-find").value = "";
      return apply();
    }
    const show = e.target.closest(".fc-showcols");
    if (show) {
      setDensity("full", false);
      writeHash();
      show.closest(".fcard").scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  });

  let qTimer = null;
  document.getElementById("deck-find").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    const v = e.target.value.trim().toLowerCase();
    qTimer = setTimeout(() => { state.q = v; apply(); }, 120);
  });
  document.getElementById("deck-find").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.target.value = ""; state.q = ""; apply(); }
  });

  root.querySelector(".deck-sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });

  // sortable table headers
  listwrap.querySelectorAll("th[data-sort]").forEach((th) => {
    th.innerHTML = `<button type="button">${th.textContent}</button>`;
    th.querySelector("button").addEventListener("click", () => {
      state.sort = th.dataset.sort;
      root.querySelector(".deck-sort").value = state.sort;
      listwrap.querySelectorAll("th").forEach((o) => o.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", "descending");
      apply();
    });
  });

  // arrow keys move the density radiogroup
  root.querySelector(".dens").addEventListener("keydown", (e) => {
    const order = ["list", "cards", "full"];
    const i = order.indexOf(state.density);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setDensity(order[(i + 1) % 3], true); writeHash(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setDensity(order[(i + 2) % 3], true); writeHash(); }
  });

  readHash();
  apply();
})();
