/* Trainer Model research layer — dashboard engine for trainer-model.html.
   Vanilla JS, no build step. Everything below runs on the visitor's machine
   against data/trainer-model/*.json; there is no backend and no network call
   beyond those files. Ported from the pogo-trainer-model dashboard — the
   population-level companion to this site's one-export story. */

/* ── palette (matches js/app.js) ──────────────────────────────────────── */
const C = {
  teal: "#41d8c6", yellow: "#ffcb05", blue: "#3b6cff",
  purple: "#a06bff", pink: "#ff6bb3", down: "#ff6b6b", dim: "#9ba1c5", faint: "#848ab0", grid: "rgba(255,255,255,.06)",
  raised: "#10142e",
};
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* `lower` is written out rather than derived with toLowerCase() — that would
   produce "pokémon caught", and the P in Pokémon is always capitalised. */
const METRICS = {
  caught:   { key: "caught",   label: "Pokémon caught",  lower: "Pokémon caught",  unit: "",    dp: 0, color: C.teal },
  battles:  { key: "battles",  label: "Battles won",     lower: "battles won",     unit: "",    dp: 0, color: C.yellow },
  distance: { key: "distance", label: "Distance walked", lower: "distance walked", unit: " km", dp: 1, color: C.blue },
};

/* Level → colour for the playstyle scatter, and the key rendered beside it. */
const LEVEL_BANDS = [
  { lo: 50, label: "50 (cap)", color: C.yellow },
  { lo: 45, label: "45–49", color: C.teal },
  { lo: 40, label: "40–44", color: C.blue },
  { lo: 35, label: "35–39", color: C.purple },
  { lo: 0,  label: "below 35", color: C.pink },
];
const shadeForLevel = (lv) => LEVEL_BANDS.find((b) => lv >= b.lo).color;

const $ = (id) => document.getElementById(id);

/* One stat tile, from [label, value, sub, cls] rows. Three chapters render the
   same tile; keeping one template means they can't drift apart. */
const statTiles = (rows) => rows.filter(Boolean).map(([label, value, sub, cls = ""]) =>
  `<div class="stat"><span class="label">${label}</span><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`
).join("");

/* A per-level series across the FULL integer range, null wherever the level is
   missing or withheld. This is the page's withholding promise expressed as
   code: a null breaks the line, so no stroke ever crosses a level whose
   statistics were held back. It was written out three times before this, which
   is exactly where a promise like that quietly stops being kept.
     rows   — a perLevel array, ascending
     pick   — row => value, returning null to withhold
     asXY   — true for {x, y} points (linear axes), false for a bare array
                aligned to the returned labels */
function levelSeries(rows, pick, { asXY = false } = {}) {
  const at = new Map(rows.map((r) => [r.level, r]));
  const labels = [];
  for (let lv = rows[0].level; lv <= rows.at(-1).level; lv++) labels.push(lv);
  const data = labels.map((lv) => {
    const r = at.get(lv);
    const v = r ? pick(r) : null;
    return asXY ? { x: lv, y: v ?? null } : (v ?? null);
  });
  return { labels, data };
}
const fmt = (n, d = 0) => n == null || !isFinite(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtCompact = (n) => n == null || !isFinite(n) ? "—"
  : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

let DATA = null;
const CHARTS = {};

/* ═══════════════════════ statistics ═══════════════════════ */

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/* Ordinary least squares, y = a + b·x, plus R² in the units of y. */
function ols(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const b = sxy / sxx, a = my - b * mx;
  return { a, b, predict: (x) => a + b * x, r2: r2Of(ys, xs.map((x) => a + b * x)) };
}

/* Log-linear: fit log(y) ~ x, then report accuracy back in the ORIGINAL units so
   it is directly comparable to the linear fit. r2Log is the fit quality in log
   space — the flattering number, shown separately and labelled as such. */
function logFit(xs, ys) {
  const px = [], py = [];
  for (let i = 0; i < xs.length; i++) if (ys[i] > 0) { px.push(xs[i]); py.push(Math.log(ys[i])); }
  if (px.length < 2) return null;
  const lin = ols(px, py);
  if (!lin) return null;
  const predict = (x) => Math.exp(lin.a + lin.b * x);
  return { predict, r2: r2Of(ys, xs.map(predict)), r2Log: lin.r2, perLevel: Math.exp(lin.b) };
}

function r2Of(actual, predicted) {
  const n = actual.length;
  if (!n) return null;
  const mean = actual.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (actual[i] - predicted[i]) ** 2; ssTot += (actual[i] - mean) ** 2; }
  return ssTot === 0 ? null : 1 - ssRes / ssTot;
}

/* Percentile rank of `v` within `sorted` — proportion below, plus half of ties.
   Half-of-ties keeps the result symmetric and stops a common value pinning
   someone at the 0th or 100th percentile. */
function percentileRank(sorted, v) {
  if (!sorted.length) return null;
  let below = 0, equal = 0;
  for (const x of sorted) { if (x < v) below++; else if (x === v) equal++; }
  return (100 * (below + equal / 2)) / sorted.length;
}

/* ── outlier handling ──────────────────────────────────────────────────── */

function iqrFilter(rows, field) {
  const v = rows.map((r) => r[field]).sort((a, z) => a - z);
  const q1 = quantile(v, 0.25), q3 = quantile(v, 0.75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return rows.filter((r) => r[field] >= lo && r[field] <= hi);
}

/* Reproduces the notebook's cell 2 exactly: IQR removal applied in sequence over
   level → battles → distance → caught, each pass operating on the survivors of
   the last. That chaining is what deletes the level-50 population. */
function applyOutlierMode(rows, mode) {
  if (mode === "iqr") {
    let out = rows;
    for (const f of ["level", "battles", "distance", "caught"]) out = iqrFilter(out, f);
    return out;
  }
  if (mode === "winsor") {
    const clamped = rows.map((r) => ({ ...r }));
    for (const f of ["battles", "distance", "caught"]) {
      const v = rows.map((r) => r[f]).sort((a, z) => a - z);
      const lo = quantile(v, 0.01), hi = quantile(v, 0.99);
      for (const r of clamped) r[f] = Math.min(hi, Math.max(lo, r[f]));
    }
    return clamped;
  }
  return rows;
}

/* ═══════════════════════ charts ═══════════════════════ */

function chartDefaults() {
  Chart.defaults.color = C.dim;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = C.raised;
  Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,.12)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = "#e8eaf6";
  Chart.defaults.plugins.tooltip.bodyColor = C.dim;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  if (REDUCED_MOTION) Chart.defaults.animation = false;
}

function mount(id, config) {
  CHARTS[id]?.destroy();
  CHARTS[id] = new Chart($(id), config);
  return CHARTS[id];
}

const axis = (title, logScale = false) => ({
  type: logScale ? "logarithmic" : "linear",
  title: { display: !!title, text: title, color: C.faint, font: { size: 11 } },
  grid: { color: C.grid },
  ticks: { callback: (v) => fmtCompact(v) },
});

/* ═══════════════════════ 1 · cohort ═══════════════════════ */

function renderHero() {
  // The era summary is one compact then-vs-now table (the site's .tvn delta
  // pattern) instead of two rows of chips — ten pill "buttons" at the top of
  // the page read as clutter, and as controls. Called once with the 2025
  // column alone, and again by initEra2 to fill in the 2026 side.
  const t = DATA.trainers, m = DATA.meta;
  const capped1 = t.filter((r) => r.level === m.levelCap).length;
  const lo1 = Math.min(...t.map((r) => r.level)), hi1 = Math.max(...t.map((r) => r.level));
  const e2 = ERA2 && {
    n: ERA2.meta.n, cap: ERA2.meta.levelCap,
    lo: ERA2.perLevel[0].level, hi: ERA2.perLevel.at(-1).level,
    capped: ERA2.perLevel.find((l) => l.level === ERA2.meta.levelCap)?.n ?? "—",
    date: ERA2.meta.latestCapture,
  };
  const row = (label, a, bv, delta, dir) => `
    <div class="tvn-row">
      <span class="tvn-l">${label}</span>
      <span class="tvn-a">${a}</span>
      <span class="tvn-arrow ${dir || "flat"}">→</span>
      <span class="tvn-b">${e2 ? bv : "—"}</span>
      <span class="tvn-d ${dir || "flat"}">${(e2 && delta) || ""}</span>
    </div>`;
  $("era-summary").innerHTML = `
    <div class="tvn-head">
      <span class="tvn-l">One list, recorded twice</span>
      <span class="tvn-a">2025</span><span class="tvn-arrow"></span><span class="tvn-b">2026</span><span class="tvn-d"></span>
    </div>
    ${row("Level cap", m.levelCap, e2 && e2.cap, e2 && "+" + (e2.cap - m.levelCap), e2 && "up")}
    ${row("Trainers recorded", fmt(m.n), e2 && fmt(e2.n), e2 && "+" + fmt(e2.n - m.n), e2 && "up")}
    ${row("Levels seen", `${lo1}–${hi1}`, e2 && `${e2.lo}–${e2.hi}`)}
    ${row("At the cap", capped1, e2 && e2.capped)}
    ${row("Recorded", m.capturedAt, e2 && e2.date)}
    <div class="hw-caption" style="margin-top:10px">
      Same friends list under two ladders — levels aren't comparable across the
      eras${m.distanceUnitAssumed ? " · distance is assumed to be km (see Known limitations, chapter 01)" : ""}.
    </div>`;
}

function renderCohort() {
  const t = DATA.trainers, m = DATA.meta;
  const med = (f) => quantile(t.map((r) => r[f]).sort((a, z) => a - z), 0.5);
  const max = (f) => Math.max(...t.map((r) => r[f]));
  const capped = t.filter((r) => r.level === m.levelCap).length;

  $("cohort-stats").innerHTML = statTiles([
    ["Trainers", fmt(m.n), "one friends-list snapshot", "teal"],
    ["Median level", fmt(quantile(t.map((r) => r.level).sort((a, z) => a - z), 0.5), 0), `${capped} of them at the cap`, ""],
    ["Median caught", fmt(med("caught")), `most caught: ${fmt(max("caught"))}`, ""],
    ["Median battles won", fmt(med("battles")), `most: ${fmt(max("battles"))}`, ""],
    ["Median distance", fmt(med("distance")) + " km", `furthest: ${fmt(max("distance"))} km`, ""],
    ["Total caught", fmtCompact(t.reduce((s, r) => s + r.caught, 0)), "across the whole cohort", "yellow"],
  ]);

  $("hist-n").textContent = fmt(m.n);
  $("lim-cap").textContent = `${Math.round((100 * capped) / m.n)}%`;

  const levels = DATA.perLevel;
  mount("chart-levels", {
    type: "bar",
    data: {
      labels: levels.map((l) => l.level),
      datasets: [{
        label: "Trainers",
        data: levels.map((l) => l.n),
        backgroundColor: levels.map((l) => (l.level === m.levelCap ? C.yellow : C.teal)),
        borderRadius: 3,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (i) => `Level ${i[0].label}`, label: (i) => `${i.parsed.y} trainer${i.parsed.y === 1 ? "" : "s"}` } },
      },
      scales: {
        x: { title: { display: true, text: "Trainer level", color: C.faint, font: { size: 11 } }, grid: { display: false } },
        y: { ...axis("trainers"), beginAtZero: true },
      },
    },
  });
}

/* ═══════════════════════ 2 · explorer ═══════════════════════ */

const EXPLORER = { metric: "caught", mode: "none" };

function renderExplorer() {
  const M = METRICS[EXPLORER.metric];
  const rows = applyOutlierMode(DATA.trainers, EXPLORER.mode);
  const xs = rows.map((r) => r.level), ys = rows.map((r) => r[M.key]);
  const lin = ols(xs, ys), lg = logFit(xs, ys);

  const levels = [...new Set(xs)].sort((a, z) => a - z);
  const medianLine = levels.map((lv) => {
    const v = rows.filter((r) => r.level === lv).map((r) => r[M.key]).sort((a, z) => a - z);
    return { x: lv, y: quantile(v, 0.5) };
  });
  const medPred = rows.map((r) => medianLine.find((p) => p.x === r.level).y);
  const meanLine = levels.map((lv) => {
    const v = rows.filter((r) => r.level === lv).map((r) => r[M.key]);
    return { x: lv, y: v.reduce((s, n) => s + n, 0) / v.length };
  });
  const meanPred = rows.map((r) => meanLine.find((p) => p.x === r.level).y);

  const logScale = $("scale-log").checked;
  const span = [];
  for (let lv = Math.min(...xs); lv <= Math.max(...xs); lv += 0.5) span.push(lv);

  const datasets = [{
    type: "scatter",
    label: `Trainers (n = ${rows.length})`,
    data: rows.map((r) => ({ x: r.level, y: r[M.key], name: r.name })),
    backgroundColor: "rgba(65,216,198,.45)",
    borderColor: "rgba(65,216,198,.8)",
    borderWidth: 1,
    pointRadius: 3.5,
    pointHoverRadius: 6,
    order: 3,
  }];

  if ($("fit-linear").checked && lin) datasets.push({
    type: "line", label: "Linear fit",
    data: span.map((x) => ({ x, y: lin.predict(x) })),
    borderColor: C.down, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1,
  });

  if ($("fit-log").checked && lg) datasets.push({
    type: "line", label: "Log-linear fit",
    data: span.map((x) => ({ x, y: lg.predict(x) })),
    borderColor: C.teal, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1,
  });

  if ($("fit-median").checked) datasets.push({
    type: "line", label: "Median per level",
    data: medianLine,
    borderColor: C.yellow, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .25, order: 2,
  });

  if ($("fit-mean").checked) datasets.push({
    type: "line", label: "Mean per level",
    data: meanLine,
    borderColor: C.purple, borderWidth: 2, borderDash: [2, 3], pointRadius: 0, tension: .25, order: 2,
  });

  mount("chart-scatter", {
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: true },
      plugins: {
        /* The checkbox row above carries colour swatches and the chips below carry
           R², so a Chart.js legend here would be the same information a third time. */
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (i) => (i[0].raw.name ? i[0].raw.name : `Level ${fmt(i[0].parsed.x, 1)}`),
            label: (i) => i.raw.name
              ? [`Level ${i.parsed.x}`, `${M.label}: ${fmt(i.parsed.y, M.dp)}${M.unit}`]
              : `${i.dataset.label}: ${fmt(i.parsed.y)}${M.unit}`,
          },
        },
      },
      scales: {
        x: { ...axis("Trainer level"), ticks: { stepSize: 2, callback: (v) => v } },
        y: { ...axis(M.label + (M.unit ? ` (${M.unit.trim()})` : ""), logScale), beginAtZero: !logScale },
      },
    },
  });

  /* readout */
  const capped = rows.filter((r) => r.level === DATA.meta.levelCap).length;
  const dropped = DATA.meta.n - rows.length;
  $("explorer-readout").innerHTML = [
    `<span class="chip ${dropped ? "warn" : "ok"}"><span class="dot"></span>n = <b>${rows.length}</b>${dropped ? ` (−${dropped})` : ""}</span>`,
    `<span class="chip ${capped < 10 ? "down" : "teal"}"><span class="dot"></span><b>${capped}</b> at level 50</span>`,
    lin ? `<span class="chip"><span class="dot"></span>linear R² <b>${lin.r2.toFixed(3)}</b></span>` : "",
    lg ? `<span class="chip"><span class="dot"></span>log-linear R² <b>${lg.r2.toFixed(3)}</b></span>` : "",
    lg ? `<span class="chip"><span class="dot"></span>growth <b>×${lg.perLevel.toFixed(2)}</b>/level</span>` : "",
    `<span class="chip"><span class="dot"></span>median R² <b>${r2Of(ys, medPred).toFixed(3)}</b></span>`,
    `<span class="chip"><span class="dot"></span>mean R² <b>${r2Of(ys, meanPred).toFixed(3)}</b></span>`,
  ].join("");

  /* the point of the whole chapter */
  const zeroAt = lin && lin.b > 0 ? -lin.a / lin.b : null;
  const notes = {
    none: `<b>All ${DATA.meta.n} trainers, nothing removed.</b> ${zeroAt && zeroAt > Math.min(...xs)
      ? `Note where the red line crosses zero — the linear model predicts <b>zero ${M.lower} at level ${zeroAt.toFixed(1)}</b>, and negative below that, even though real trainers exist down there.`
      : `The straight line and the compounding curve disagree most at the top of the range, where most of this cohort lives.`}`,
    iqr: `<b>This is the original notebook's cleaning, reproduced exactly</b> — IQR removal applied in sequence across level, battles, distance and catches. It drops <b>${dropped} of ${DATA.meta.n} trainers (${Math.round((100 * dropped) / DATA.meta.n)}%)</b>, and because endgame players hold the biggest totals it eats them first: <b>level-50 trainers fall from 73 to ${capped}</b>. The model is now being asked to predict a level it has effectively never seen.`,
    winsor: `<b>Extremes clamped to the 1st and 99th percentile</b> rather than deleted. All ${rows.length} trainers survive — including the full level-50 cohort — so the fit is tamed without the sample being hollowed out. This is the honest version of what the notebook was reaching for.`,
  };
  $("explorer-note").innerHTML = notes[EXPLORER.mode];
  $("explorer-note").className = "callout " + (EXPLORER.mode === "iqr" ? "red" : EXPLORER.mode === "winsor" ? "teal" : "");
}

/* ═══════════════════════ 7 · where you stand (both eras) ═══════════════════════ */

function bandFor(level) {
  return DATA.bands.find((b) => level >= b.lo && level <= b.hi) || DATA.bands[0];
}

// One form, two cohorts. RANK.era starts on the 2025 record and flips to the
// cap-80 record the moment era-2 data lands (initEra2), which also reveals the
// era toggle. Nothing about the two datasets is ever pooled — the toggle swaps
// which cohort the percentiles are computed against, whole.
const RANK = { era: "era1" };

function rankCohort() {
  if (RANK.era === "era2" && ERA2) return {
    rows: ERA2.trainers, cap: ERA2.meta.levelCap, bandOf: bandFor2,
    eraNote: `This compares against the <b>2026 record</b> (cap 80) — flip the era toggle for the 2025 cohort.`,
  };
  return {
    rows: DATA.trainers, cap: DATA.meta.levelCap, bandOf: bandFor,
    eraNote: ERA2
      ? `This compares against the <b>2025 record</b> (cap 50) — flip the era toggle for today's game.`
      : "",
  };
}

function syncRankForm({ resetValues = false } = {}) {
  const era2 = RANK.era === "era2" && ERA2;
  $("in-level").max = era2 ? ERA2.meta.levelCap : DATA.meta.levelCap;
  $("lbl-level-cap").textContent = era2 ? `(current cap: ${ERA2.meta.levelCap})` : `(2025 cap: ${DATA.meta.levelCap})`;
  if (resetValues) {
    const v = era2 ? [70, 52000, 3100, 7100] : [40, 48000, 1250, 5200];
    ["in-level", "in-caught", "in-battles", "in-distance"].forEach((id, k) => { $(id).value = v[k]; });
  }
}

function renderRank(writeBack = false) {
  // Clamp to the ACTIVE cohort's cap, not a literal. The clamped value is only
  // written back to the field on an explicit rank (button/Enter), never
  // mid-keystroke — rewriting while someone types made the field impossible
  // to clear.
  const { rows, cap, bandOf, eraNote } = rankCohort();
  const level = Math.max(1, Math.min(cap, Math.round(+$("in-level").value || 0)));
  if (writeBack) $("in-level").value = level;
  const band = bandOf(level);
  const peers = rows.filter((r) => r.level >= band.lo && r.level <= band.hi);

  const cards = Object.values(METRICS).map((M) => {
    const mine = +$("in-" + M.key).value || 0;
    const sorted = peers.map((r) => r[M.key]).sort((a, z) => a - z);
    const pct = percentileRank(sorted, mine);
    const median = quantile(sorted, 0.5);
    const vsMedian = median > 0 ? mine / median : null;
    const beats = Math.round((pct / 100) * peers.length);
    /* Within 2% of the median, "×1.00 above" reads like a rounding artefact
       rather than the "you are typical" it actually means. */
    const vs = !vsMedian ? ""
      : Math.abs(vsMedian - 1) < 0.02 ? ` · <span style="color:var(--ink-dim)">right on the median</span>`
      : vsMedian > 1 ? ` · <span style="color:var(--live)">×${vsMedian.toFixed(2)} above</span>`
      : ` · <span style="color:var(--down)">×${(1 / vsMedian).toFixed(2)} below</span>`;
    return `<div class="pct">
      <span class="label">${M.label}</span>
      <div class="big" style="color:${M.color}">${ordinal(Math.round(pct))}</div>
      <div class="note">percentile — ahead of ${fmt(beats)} of ${fmt(peers.length)} trainers in your band</div>
      <div class="bar"><span style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%"></span></div>
      <div class="note" style="margin-top:9px">
        You: <b style="color:var(--ink)">${fmt(mine, M.dp)}${M.unit}</b> ·
        band median: ${fmt(median, M.dp)}${M.unit}${vs}
      </div>
    </div>`;
  }).join("");

  const avgPct = Object.values(METRICS).reduce((s, M) => {
    const sorted = peers.map((r) => r[M.key]).sort((a, z) => a - z);
    return s + percentileRank(sorted, +$("in-" + M.key).value || 0);
  }, 0) / 3;

  $("rank-out").innerHTML = `
    <div class="chip-row" style="margin:0 0 14px">
      <span class="chip teal"><span class="dot"></span>compared against <b>${band.label}</b></span>
      <span class="chip"><span class="dot"></span><b>${peers.length}</b> trainers in band</span>
      <span class="chip ${avgPct >= 50 ? "ok" : "warn"}"><span class="dot"></span>overall <b>${ordinal(Math.round(avgPct))}</b> percentile</span>
    </div>
    <div class="pct-grid">${cards}</div>
    <div class="callout" style="margin-top:16px">
      Bands, not exact levels — there are too few trainers at any single level for a
      percentile to mean much. ${band.lo === cap && band.hi === cap
        ? "At the cap everyone shares one level, so this band is a straight comparison against every cap trainer in the cohort."
        : `Your band spans levels ${band.lo === 1 ? "up to " + band.hi : band.lo + "–" + band.hi}.`}
      ${level < band.lo ? `Level ${level} is below this cohort's recorded floor (${band.lo}), so you're measured against its lowest band.` : ""}
      ${eraNote}
    </div>`;
}

/* ═══════════════════════ 3 · the level-50 wall ═══════════════════════ */

function renderWall() {
  const cap = DATA.meta.levelCap;
  const capped = DATA.trainers.filter((r) => r.level === cap);
  $("wall-n").textContent = capped.length;

  const sorted = [...capped].sort((a, z) => a.caught - z.caught);
  mount("chart-wall", {
    type: "bar",
    data: {
      labels: sorted.map((r) => r.name),
      datasets: [{
        label: "Pokémon caught",
        data: sorted.map((r) => r.caught),
        backgroundColor: C.teal,
        borderRadius: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Each bar is one level-50 trainer, sorted by catches", color: C.faint, font: { size: 11 } },
        tooltip: { callbacks: { label: (i) => `${fmt(i.parsed.y)} caught` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: { ...axis("Pokémon caught"), beginAtZero: true },
      },
    },
  });

  const rows = Object.values(METRICS).map((M) => {
    const v = capped.map((r) => r[M.key]).sort((a, z) => a - z);
    const d = M.dp;
    return `<tr>
      <td>${M.label}</td>
      <td class="num">${fmt(v[0], d)}</td>
      <td class="num">${fmt(quantile(v, .25), d)}</td>
      <td class="num">${fmt(quantile(v, .5), d)}</td>
      <td class="num">${fmt(quantile(v, .75), d)}</td>
      <td class="num">${fmt(v[v.length - 1], d)}</td>
      <td class="num ratio-bad">${(v[v.length - 1] / Math.max(v[0], 1)).toFixed(0)}×</td>
    </tr>`;
  }).join("");

  $("tbl-wall").innerHTML = `
    <thead><tr><th>Metric</th><th class="num">Min</th><th class="num">p25</th><th class="num">Median</th><th class="num">p75</th><th class="num">Max</th><th class="num">Spread</th></tr></thead>
    <tbody>${rows}</tbody>`;

  const v = capped.map((r) => r.caught).sort((a, z) => a - z);
  $("wall-note").innerHTML = `
    All ${capped.length} of these trainers share the exact same level. Between the
    quietest and the busiest there is a <b>${(v[v.length - 1] / v[0]).toFixed(0)}× gap in Pokémon caught</b>
    — from ${fmt(v[0])} to ${fmt(v[v.length - 1])}. No model that takes only level as its
    input can tell these players apart, because as far as the data is concerned they are
    identical. This is <b>${Math.round((100 * capped.length) / DATA.meta.n)}% of the entire cohort</b>.
    It is the ceiling on this whole approach, and the reason the ratios in chapter 05
    are the more useful lens.`;
}

/* ═══════════════════════ 4 · report card ═══════════════════════ */

function renderR2Table() {
  const rows = Object.values(METRICS).map((M) => {
    const xs = DATA.trainers.map((r) => r.level), ys = DATA.trainers.map((r) => r[M.key]);
    const lin = ols(xs, ys), lg = logFit(xs, ys);
    const medMap = new Map(DATA.perLevel.map((l) => [l.level, l.median[M.key]]));
    const medR2 = r2Of(ys, xs.map((x) => medMap.get(x)));
    const best = Math.max(lin.r2, lg.r2, medR2);
    const cell = (v) => `<td class="num${v === best ? " ratio-ok" : ""}">${v.toFixed(3)}</td>`;
    return `<tr>
      <td>${M.label}</td>
      ${cell(lin.r2)}${cell(lg.r2)}${cell(medR2)}
      <td class="num faint">${lg.r2Log.toFixed(3)}</td>
      <td class="num">×${lg.perLevel.toFixed(2)}</td>
    </tr>`;
  }).join("");

  $("tbl-r2").innerHTML = `
    <thead><tr>
      <th>Metric</th>
      <th class="num">Linear</th><th class="num">Log-linear</th><th class="num">Median per level</th>
      <th class="num">Log-linear <span class="faint">(in log space)</span></th>
      <th class="num">Growth / level</th>
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

const REPORT = { metric: "caught" };

function renderReport() {
  const M = METRICS[REPORT.metric];
  const preds = DATA.notebookPredictions;
  const actualFor = (lv) => DATA.perLevel.find((l) => l.level === lv);

  const rows = preds.map((p) => {
    const a = actualFor(p.level);
    if (!a) return null;
    const ratio = a.median[M.key] / p[M.key];
    const d = M.dp;
    const off = Math.abs(Math.log(ratio)) > Math.log(2);
    return { level: p.level, n: a.n, pred: p[M.key], actual: a.median[M.key], ratio, d, off };
  }).filter(Boolean);

  mount("chart-report", {
    data: {
      labels: rows.map((r) => r.level),
      datasets: [
        { type: "line", label: "Original model's prediction", data: rows.map((r) => r.pred), borderColor: C.down, backgroundColor: "rgba(255,107,107,.10)", borderWidth: 2.5, pointRadius: 3, fill: false, tension: 0 },
        { type: "line", label: "Actual median of real trainers", data: rows.map((r) => r.actual), borderColor: C.teal, backgroundColor: "rgba(65,216,198,.12)", borderWidth: 2.5, pointRadius: 3, fill: true, tension: .2 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "start" },
        tooltip: { callbacks: { title: (i) => `Level ${i[0].label}`, label: (i) => `${i.dataset.label}: ${fmt(i.parsed.y)}${M.unit}` } },
      },
      scales: {
        x: { title: { display: true, text: "Trainer level", color: C.faint, font: { size: 11 } }, grid: { display: false } },
        y: { ...axis(M.label), beginAtZero: true },
      },
    },
  });

  $("tbl-report").innerHTML = `
    <thead><tr>
      <th>Level</th><th class="num">Trainers</th>
      <th class="num">Model predicted</th><th class="num">Actual median</th><th class="num">Off by</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr class="${r.off ? "highlight" : ""}">
        <td>${r.level}${r.level === 50 ? " <span class='faint'>(cap)</span>" : ""}</td>
        <td class="num">${r.n}</td>
        <td class="num">${fmt(r.pred, r.d)}</td>
        <td class="num">${fmt(r.actual, r.d)}</td>
        <td class="num ${r.off ? "ratio-bad" : ""}">${r.ratio >= 1 ? "×" + r.ratio.toFixed(1) + " low" : "×" + (1 / r.ratio).toFixed(1) + " high"}</td>
      </tr>`).join("")}</tbody>`;

  const cap = rows.find((r) => r.level === 50);
  $("report-note").innerHTML = `
    The original model over-predicts through the middle of the range and then falls
    badly behind at the top. At <b>level 50</b> — where <b>${cap.n} of the ${DATA.meta.n} trainers</b>
    in this cohort actually sit — it predicts <b>${fmt(cap.pred, cap.d)}</b> ${M.lower}
    against a real median of <b>${fmt(cap.actual, cap.d)}</b>. That is
    <b>${cap.ratio.toFixed(1)}× too low</b>, and it happens for one reason: the outlier
    filter that produced this model had already deleted 72 of those 73 trainers before
    it ever saw them. Try the <a href="#explorer">IQR setting in the explorer</a> to watch it happen.`;
}

/* ═══════════════════════ 5 · playstyle ═══════════════════════ */

function renderPlaystyle() {
  const rows = DATA.trainers.filter((r) => r.distance > 0 && r.caught > 0);
  const pts = rows.map((r) => ({
    x: r.caught / r.distance,
    y: (1000 * r.battles) / r.caught,
    name: r.name, level: r.level,
  }));

  // A handful of extreme ratios would flatten everyone else against the axes, so the
  // view is capped at the 98th percentile. Nobody is dropped from the dataset — the
  // count of off-view trainers is reported below the chart.
  const capAt = (arr, q) => quantile([...arr].sort((a, z) => a - z), q);
  const xMax = capAt(pts.map((p) => p.x), 0.98), yMax = capAt(pts.map((p) => p.y), 0.98);
  const offView = pts.filter((p) => p.x > xMax || p.y > yMax).length;

  const shade = shadeForLevel;
  $("playstyle-key").innerHTML = LEVEL_BANDS.map((b) =>
    `<span class="chip"><span class="dot" style="background:${b.color};box-shadow:0 0 8px ${b.color}"></span>${b.label}</span>`
  ).join("");

  mount("chart-playstyle", {
    type: "scatter",
    data: {
      datasets: [{
        label: "Trainers",
        data: pts,
        backgroundColor: pts.map((p) => shade(p.level) + "88"),
        borderColor: pts.map((p) => shade(p.level)),
        borderWidth: 1,
        pointRadius: 4,
        pointHoverRadius: 7,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (i) => i[0].raw.name,
            label: (i) => [
              `Level ${i.raw.level}`,
              `${i.parsed.x.toFixed(1)} catches per km`,
              `${i.parsed.y.toFixed(1)} battles per 1,000 catches`,
            ],
          },
        },
      },
      scales: {
        x: { ...axis("Catches per kilometre walked"), beginAtZero: true, max: Math.ceil(xMax) },
        y: { ...axis("Battles won per 1,000 catches"), beginAtZero: true, max: Math.ceil(yMax) },
      },
    },
  });

  const xs = pts.map((p) => p.x).sort((a, z) => a - z);
  const ys = pts.map((p) => p.y).sort((a, z) => a - z);
  const grinder = [...pts].sort((a, z) => z.x - a.x)[0];
  const battler = [...pts].sort((a, z) => z.y - a.y)[0];
  const walker = [...pts].sort((a, z) => a.x - z.x)[0];

  $("playstyle-stats").innerHTML = statTiles([
    ["Median catches / km", quantile(xs, .5).toFixed(1), "typical trainer in this cohort", "teal"],
    ["Median battles / 1k catches", quantile(ys, .5).toFixed(1), "how much battling per catching", ""],
    ["Densest catcher", grinder.x.toFixed(1) + " /km", `${grinder.name} · level ${grinder.level}`, "yellow"],
    ["Most battle-heavy", battler.y.toFixed(1) + " /1k", `${battler.name} · level ${battler.level}`, ""],
    ["Purest walker", walker.x.toFixed(1) + " /km", `${walker.name} · level ${walker.level}`, ""],
    ["Off the visible range", fmt(offView), "extreme ratios, still in the data", ""],
  ]);
}

/* ═══════════════════════ 6 · the new era (cap 80) ═══════════════════════ */

// Renders only if data/trainer-model/era2.json exists — the chapter
// self-activates once the cap-80 era has data. The 2025 dataset and
// this one are different eras (XP/level rebalance) and are never mixed.
let ERA2 = null;
const ERA2_STATE = { metric: "caught" };

function renderEra2() {
  if (!ERA2) return;
  const M = METRICS[ERA2_STATE.metric];
  // Full integer axis: levels nobody currently holds still occupy a slot, so
  // the curve isn't quietly compressed where the ladder is empty — the sparse
  // bottom of the range is where that category-axis distortion was worst.
  const series = (f) => levelSeries(ERA2.perLevel, (r) => r[M.key][f]);
  const labels = series("median").labels;
  const d = M.dp;

  $("era2-date").textContent = ERA2.meta.latestCapture ?? "—";
  const capped = ERA2.perLevel.find((l) => l.level === ERA2.meta.levelCap);
  const sparseCount = ERA2.perLevel.filter((l) => l.sparse).length;
  $("era2-chips").innerHTML = [
    `<span class="chip ok"><span class="dot"></span><b>${fmt(ERA2.meta.n)}</b> trainers</span>`,
    `<span class="chip"><span class="dot"></span>levels <b>${labels[0]}–${labels.at(-1)}</b></span>`,
    capped ? `<span class="chip teal"><span class="dot"></span><b>${capped.n}</b> at the level-80 cap</span>` : "",
    (ERA2.meta.captures?.length ?? 0) > 1 ? `<span class="chip"><span class="dot"></span><b>${ERA2.meta.captures.length}</b> snapshots</span>` : "",
    // What's missing is stated once, in the scatter panel's callout, from
    // meta.nFriendsTotal / nNotRecorded (see renderLedger). Repeating it as a
    // chip here read as a second, competing ledger.
    sparseCount ? `<span class="chip warn"><span class="dot"></span><b>${sparseCount}</b> thin levels (n&lt;${ERA2.meta.minNForQuartiles ?? 5})</span>` : "",
  ].join("");

  mount("chart-era2", {
    data: {
      labels,
      datasets: [
        // Levels below the minimum-n threshold carry null stats from the build,
        // so the line simply breaks there — an honest gap rather than a
        // confident stroke through a level backed by one person.
        { type: "line", label: `Median ${M.lower}`, data: series("median").data,
          borderColor: M.color, backgroundColor: M.color, borderWidth: 2.5,
          pointRadius: 3, spanGaps: false, tension: .25, yAxisID: "y", order: 1 },
        // The mean rides above the median wherever a few heavy grinders pull the
        // average up — that gap is the point of showing both. Same n>=5 masking:
        // sparse levels carry null means from the build, so the dash breaks too.
        { type: "line", label: `Mean ${M.lower} (average)`, data: series("mean").data,
          borderColor: M.color, borderDash: [6, 5], borderWidth: 1.5,
          pointRadius: 0, spanGaps: false, tension: .25, yAxisID: "y", order: 1 },
        { type: "line", label: "75th percentile", data: series("p75").data,
          borderColor: "transparent", backgroundColor: M.color + "24", pointRadius: 0, fill: "+1", tension: .25, yAxisID: "y", order: 2 },
        { type: "line", label: "25th percentile", data: series("p25").data,
          borderColor: "transparent", pointRadius: 0, tension: .25, yAxisID: "y", order: 2 },
        { type: "bar", label: "Trainers at level", data: levelSeries(ERA2.perLevel, (r) => r.n).data,
          backgroundColor: "rgba(155,161,197,.25)", borderRadius: 2, yAxisID: "yn", order: 3 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start",
          labels: { filter: (item) => !item.text.includes("percentile") } },
        tooltip: { callbacks: {
          title: (i) => `Level ${i[0].label}`,
          label: (i) => i.dataset.yAxisID === "yn"
            ? `${i.parsed.y} trainer${i.parsed.y === 1 ? "" : "s"}`
            : `${i.dataset.label}: ${fmt(i.parsed.y, d)}${M.unit}`,
        } },
      },
      scales: {
        x: { title: { display: true, text: "Trainer level", color: C.faint, font: { size: 11 } }, grid: { display: false } },
        y: { ...axis(M.label + (M.unit ? ` (${M.unit.trim()})` : "")), beginAtZero: true },
        yn: { position: "right", beginAtZero: true, grid: { display: false },
              title: { display: true, text: "trainers", color: C.faint, font: { size: 11 } },
              ticks: { callback: (v) => fmtCompact(v), precision: 0 } },
      },
    },
  });
}

// "N of M friends, the remaining K aren't recorded" — read from era2.json's
// meta rather than written into the page, so a future recording round updates
// the sentence by shipping data. The markup carries the current numbers as
// static fallbacks, so the prose still reads correctly before this runs (or if
// the data never loads).
const SMALL_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function renderLedger() {
  const m = ERA2?.meta;
  if (!m?.nFriendsTotal) return;
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set("led-n", fmt(m.n));
  set("led-total", fmt(m.nFriendsTotal));
  set("led-n2", fmt(m.n));
  set("led-total2", fmt(m.nFriendsTotal));
  const k = m.nNotRecorded ?? 0;
  set("led-missing", k === 0
    ? "everyone on it is recorded"
    : `the remaining ${SMALL_WORDS[k] ?? fmt(k)} ${k === 1 ? "isn't" : "aren't"} recorded`);
}

// Every recorded trainer in the cap-80 era as one dot, with the published
// (n>=5-masked) median curve over the top. The per-level stats are read from
// the build's perLevel block, never recomputed from the raw rows — the
// thin-level withholding lives in the data and stays there.
function renderEra2Scatter() {
  if (!ERA2) return;
  const M = METRICS[ERA2_STATE.metric];
  const MIN_N = ERA2.meta.minNForQuartiles ?? 5;
  const pts = ERA2.trainers.map((t) => ({ x: t.level, y: t[M.key], id: t.id }));
  // Null-masked over the full level range so the median line BREAKS at
  // withheld or empty levels instead of bridging them with a stroke.
  const med = levelSeries(ERA2.perLevel, (r) => r[M.key].median, { asXY: true }).data;
  $("era2-all-n").textContent = fmt(pts.length);
  const logScale = $("era2-scale-log")?.checked ?? false;
  const d = M.dp;

  mount("chart-era2-scatter", {
    data: { datasets: [
      { type: "scatter", label: `Trainers (n = ${pts.length})`, data: pts,
        backgroundColor: "rgba(65,216,198,.35)", borderColor: "rgba(65,216,198,.7)",
        borderWidth: 1, pointRadius: 3, pointHoverRadius: 6, order: 2 },
      { type: "line", label: `Median per level (n ≥ ${MIN_N})`, data: med,
        borderColor: C.yellow, borderWidth: 2, borderDash: [5, 4], pointRadius: 0,
        tension: .25, spanGaps: false, order: 1 },
    ] },
    options: {
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: true },
      plugins: {
        legend: { position: "top", align: "start" },
        tooltip: {
          callbacks: {
            title: (i) => (i[0].raw.id ? `Trainer ${i[0].raw.id}` : `Level ${i[0].parsed.x}`),
            label: (i) => i.raw.id
              ? [`Level ${i.parsed.x}`, `${M.label}: ${fmt(i.parsed.y, d)}${M.unit}`]
              : `median: ${fmt(i.parsed.y, d)}${M.unit}`,
          },
        },
      },
      scales: {
        // Derived, not literal: the callout promises every trainer is plotted,
        // so the axis has to follow the data rather than a number typed once.
        x: { type: "linear", min: Math.min(10, ERA2.perLevel[0].level), max: ERA2.meta.levelCap + 2,
             title: { display: true, text: "Trainer level", color: C.faint, font: { size: 11 } },
             grid: { color: C.grid }, ticks: { stepSize: 10 } },
        y: { ...axis(M.label + (M.unit ? ` (${M.unit.trim()})` : ""), logScale), beginAtZero: !logScale },
      },
    },
  });
}

// Both eras' median-per-level curves on one linear level axis. Era-1 medians
// are masked below the same n>=5 floor the era-2 build applies, so neither line
// ever asserts a "typical trainer" from one person's numbers.
function renderCompare() {
  if (!ERA2 || !DATA) return;
  const M = METRICS[ERA2_STATE.metric];
  const MIN_N = ERA2.meta.minNForQuartiles ?? 5;
  // Null-masked full ranges: a level that is withheld (n < MIN_N) or simply
  // empty breaks the line, exactly as the caption promises — the stroke never
  // bridges a level the page refuses to publish.
  // Era 1 masks here (its build predates the rule); era 2 arrives pre-masked.
  const era1 = levelSeries(DATA.perLevel, (r) => (r.n >= MIN_N ? r.median[M.key] : null), { asXY: true }).data;
  const era2 = levelSeries(ERA2.perLevel, (r) => r[M.key].median, { asXY: true }).data;

  mount("chart-compare", {
    type: "line",
    data: { datasets: [
      { label: "2025 · cap 50", data: era1, borderColor: C.teal, backgroundColor: C.teal,
        borderWidth: 2.5, pointRadius: 3, tension: .25, spanGaps: false },
      { label: "2026 · cap 80", data: era2, borderColor: C.yellow, backgroundColor: C.yellow,
        borderWidth: 2.5, pointRadius: 3, tension: .25, spanGaps: false },
    ] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "top", align: "start" },
        tooltip: { callbacks: {
          title: (i) => `Level ${i[0].parsed.x}`,
          label: (i) => `${i.dataset.label}: ${fmt(i.parsed.y, M.dp)}${M.unit} median`,
        } },
      },
      scales: {
        x: { type: "linear", min: 0, max: ERA2.meta.levelCap + 2,
             title: { display: true, text: "Trainer level (meaning differs between eras — that's the point)", color: C.faint, font: { size: 11 } },
             grid: { color: C.grid }, ticks: { stepSize: 10 } },
        y: { ...axis(`Median ${M.lower}` + (M.unit ? ` (${M.unit.trim()})` : "")), beginAtZero: true },
      },
    },
  });
}

/* ── the cap-80 bands (chapter 07's 2026 mode) ─────────────────────────── */

// Level bands for the cap-80 cohort. Every band holds a healthy crowd of the
// 493 recorded trainers (≤55: 76 · 56–65: 124 · 66–75: 171 · 76–79: 71 ·
// 80: 51), so a percentile inside one actually means something. Defined in
// ascending order — bandFor2 takes the first match.
const ERA2_BANDS = [
  { lo: 1, hi: 55, label: "Level ≤ 55" },
  { lo: 56, hi: 65, label: "Level 56–65" },
  { lo: 66, hi: 75, label: "Level 66–75" },
  { lo: 76, hi: 79, label: "Level 76–79" },
  { lo: 80, hi: 80, label: "Level 80 (cap)", isCap: true },
];
const bandFor2 = (level) => ERA2_BANDS.find((b) => level >= b.lo && level <= b.hi) || ERA2_BANDS[0];

/* ═══════════════════════ 8 · the ladder, as numbers and as a story ═══════ */

// Milestone rungs of the cap-80 ladder. Only levels the build published stats
// for (n >= 5) can appear — a missing rung simply drops out of the table.
const LADDER_LEVELS = [50, 60, 70, 80];

function renderLadder() {
  if (!ERA2 || !DATA) return;
  const rows = LADDER_LEVELS
    .map((lv) => ERA2.perLevel.find((l) => l.level === lv && !l.sparse))
    .filter(Boolean)
    .map((l) => `
      <tr${l.level === ERA2.meta.levelCap ? ' class="highlight"' : ""}>
        <td>${l.level}${l.level === ERA2.meta.levelCap ? " <span class='faint'>(cap)</span>" : ""}</td>
        <td class="num">${l.n}</td>
        <td class="num">${fmt(l.caught.median)}</td>
        <td class="num faint">${fmt(l.caught.mean)}</td>
        <td class="num">${fmt(l.battles.median)}</td>
        <td class="num">${fmt(l.distance.median, 1)}</td>
      </tr>`).join("");

  // The 2025 era's summit, for scale — the same friends list under the old cap.
  const e1 = DATA.perLevel.find((l) => l.level === DATA.meta.levelCap);
  const e1caught = DATA.trainers.filter((r) => r.level === DATA.meta.levelCap).map((r) => r.caught);
  const e1mean = e1caught.reduce((s, n) => s + n, 0) / e1caught.length;

  $("tbl-ladder").innerHTML = `
    <thead><tr>
      <th>Level</th><th class="num">Trainers</th>
      <th class="num">Median caught</th><th class="num">Mean caught</th>
      <th class="num">Median battles</th><th class="num">Median km</th>
    </tr></thead>
    <tbody>${rows}
      <tr>
        <td>50 <span class="faint">(2025 era — the old cap)</span></td>
        <td class="num">${e1.n}</td>
        <td class="num">${fmt(e1.median.caught)}</td>
        <td class="num faint">${fmt(e1mean)}</td>
        <td class="num">${fmt(e1.median.battles)}</td>
        <td class="num">${fmt(e1.median.distance, 1)}</td>
      </tr>
    </tbody>`;
}

/* ── what each level costs ─────────────────────────────────────────────────
   The one figure on a profile that describes the game rather than the player:
   the XP needed for the next level is identical for everyone, so it carries no
   privacy weight and needs no withholding. It is also the mechanism behind
   every other finding on this page — the reason the top of the ladder barely
   moves is printed right here. */
function renderCost() {
  const cost = ERA2?.levelCost;
  if (!cost?.length) return;
  $("cost-panel").hidden = false;
  const at = (lv) => cost.find((c) => c.level === lv);
  const first = cost[0], last = cost.at(-1);
  $("cost-range").textContent = `${fmt(cost.length)} levels shown`;

  // Headline comparison uses two fixed, well-attested rungs rather than the
  // cheapest and dearest on show. Min and max are decided by whoever happens to
  // be on the friends list — the lowest level here is held by one person, and
  // leaning on it would let a single friend swing the number several-fold.
  const anchorLo = at(50) ?? first, anchorHi = at(ERA2.meta.levelCap - 1) ?? last;
  const ratio = anchorHi.xpToNext / anchorLo.xpToNext;
  const thin = cost.filter((c) => c.readings < 2).length;

  $("cost-stats").innerHTML = statTiles([
    [`Leaving level ${anchorLo.level}`, fmtCompact(anchorLo.xpToNext) + " XP", "the old cap, for scale", "teal"],
    [`Leaving level ${anchorHi.level}`, fmtCompact(anchorHi.xpToNext) + " XP", "the last rung before the cap", "yellow"],
    ["The step got", "×" + ratio.toFixed(1) + " dearer", `between those two rungs`, ""],
    ["Levels shown", fmt(cost.length), "levels someone on the list occupies", ""],
  ]);

  // Full integer axis and log scale. The axis spans every level in range, not
  // just the ones on show, so the levels nobody occupies read as the gaps they
  // are — a category axis would stand level 13 flush against 27 and imply a
  // continuous ladder. Log, because a 1,000× range flattens the early game to
  // nothing on a linear axis.
  const lo = first.level, hi = last.level;
  const labels = [];
  for (let lv = lo; lv <= hi; lv++) labels.push(lv);
  const byLevel = new Map(cost.map((c) => [c.level, c]));
  mount("chart-cost", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "XP for the next level",
        data: labels.map((lv) => byLevel.get(lv)?.xpToNext ?? null),
        backgroundColor: labels.map((lv) => (lv >= 71 ? C.yellow : C.teal)),
        borderRadius: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "XP to reach the next level — yellow is the endgame, 71 and up (log scale)", color: C.faint, font: { size: 11 } },
        tooltip: { callbacks: {
          title: (i) => `Level ${i[0].label} → ${Number(i[0].label) + 1}`,
          label: (i) => {
            const c = byLevel.get(Number(i.label));
            return [`${fmt(i.parsed.y)} XP`, c && c.readings < 2 ? "read once" : `read ${c?.readings} times`];
          },
        } },
      },
      scales: {
        x: { title: { display: true, text: "Leaving this level (gaps: nobody on the list is here)", color: C.faint, font: { size: 11 } }, grid: { display: false } },
        y: { ...axis("XP required", true) },
      },
    },
  });

  $("cost-note").innerHTML = `
    <b>The XP figures here are the game's, not anyone's.</b> The cost of a level is the same for
    every player, so these numbers describe no individual — the only quantities on this page that
    don't. Leaving level ${anchorHi.level}, the last rung before the cap, costs
    <b>${fmt(anchorHi.xpToNext)} XP</b>; leaving level ${anchorLo.level} costs
    <b>${fmt(anchorLo.xpToNext)}</b>. The ladder steepens the whole way up.
    <b>Read the bars for shape, not size:</b> the axis is logarithmic, so each gridline is ten
    times the one below it and a bar only a little taller is worth several times as much. The
    numbers above carry the real gap; the chart carries the fact that it never stops growing.
    <br><br>
    <b>Which levels appear, though, is this friends list's doing.</b> A level is on the chart when
    someone on the list stands there — the gaps are levels nobody currently occupies, not levels
    that were checked and rejected.${thin ? ` ${fmt(thin)} of the ${fmt(cost.length)} rest on a single
    reading; hover any bar to see how many times it was read.` : ""}
    The rungs shown span ${lo}–${hi}: the cap itself is absent because there is no level after it
    to pay for.`;
}

/* ── the pace panel: the only place a clock touches this data ──────────────
   Every other number on this page is a lifetime total. A trainer recorded in
   two rounds gives one measured interval, and that interval is worth exactly
   what it is: one short window, of one cohort, during whatever was running
   that week. It is reported as what happened, never extrapolated into a
   time-to-80 — 8 level-ups across 213 trainers cannot carry that weight. */
function renderPace() {
  const p = ERA2?.pace;
  if (!p?.nObserved) return;
  $("pace-panel").hidden = false;
  $("pace-window").textContent = `${fmt(p.nObserved)} seen twice · ~${p.meanWindowDays} days`;

  const pct = (100 * p.nLeveled) / p.nObserved;
  const climbing = p.byBand.filter((b) => b.lo < ERA2.meta.levelCap);
  const stillClimbing = climbing.reduce((s, b) => s + b.n, 0);
  const moved = climbing.filter((b) => b.leveled > 0);
  const everyoneGainedOne = p.nLeveled > 0 && p.levelsGained === p.nLeveled;

  $("pace-stats").innerHTML = statTiles([
    ["Recorded twice", fmt(p.nObserved), `over about ${p.meanWindowDays} days`, "teal"],
    ["Gained a level", fmt(p.nLeveled), `${pct.toFixed(1)}% of them, in that whole window`, ""],
    ["Still had one to gain", fmt(stillClimbing), "the rest were already at the cap", ""],
    everyoneGainedOne
      ? ["Nobody gained two", "exactly 1 each", `${fmt(p.levelsGained)} levels across ${fmt(p.nLeveled)} trainers`, ""]
      : ["Levels gained", fmt(p.levelsGained), "across every trainer, combined", ""],
  ]);

  const capBand = p.byBand.find((b) => b.lo === ERA2.meta.levelCap);
  const costShown = !$("cost-panel")?.hidden;
  // Where the movement actually was, stated as rates so bands of different
  // sizes are comparable. This is the part that resists a tidy story: the
  // dearest band moved the most, not the least.
  const rate = (b) => (b.n ? (100 * b.leveled) / b.n : 0);
  const busiest = moved.length ? moved.reduce((m, b) => (rate(b) > rate(m) ? b : m)) : null;

  $("pace-note").innerHTML = `
    <b>This is why the page won't tell you how long it takes to reach ${ERA2.meta.levelCap}.</b>
    Across about ${p.meanWindowDays} days, <b>${fmt(p.nObserved)} of these trainers gave a usable
    second reading — and ${p.nLeveled === 0 ? "none" : "only <b>" + fmt(p.nLeveled) + "</b>"} of them
    gained a single level</b>.
    ${capBand ? `${fmt(capBand.n)} of them were already at ${ERA2.meta.levelCap}, with nowhere left to climb.` : ""}
    ${p.nExcludedForCorrection ? `(A further ${fmt(p.nExcludedForCorrection)} were set aside: their level
      changed between rounds because the record was corrected, not because they played.)` : ""}
    <br><br>
    ${busiest ? `<b>And it is not simply that the dear levels move slowest.</b> The busiest band was
      <b>level ${busiest.band}</b>, where ${fmt(busiest.leveled)} of ${fmt(busiest.n)}
      (${rate(busiest).toFixed(0)}%) gained one — ${costShown ? "and those are among the most expensive rungs on the chart above" : "and those are among the most expensive rungs of all"}.
      Cost sets the size of the task; whether anyone finishes it in a week is about how hard they
      are playing, and the people near the top are the ones still pushing. ` : ""}
    One window, one cohort, whatever happened to be running that week. It is a real measurement,
    and it is not a forecast — ${p.nLeveled === 1 ? "a single level-up" : fmt(p.nLeveled) + " level-ups"} cannot carry one.`;
  $("pace-xref").hidden = false;
}

// A full-screen, tappable recap in the site's story-mode dress (the .story-*
// classes come from css/style.css). Every number is computed from the loaded
// data at open time — nothing on the slides is hardcoded. The one thing the
// story refuses to do is convert totals into time: there are no timestamps in
// the data, so "how long" is answered honestly — by weighing the climb.
let STORY = null;
const EARTH_KM = 40075;

function storySlides() {
  const at = (lv) => ERA2.perLevel.find((l) => l.level === lv && !l.sparse);
  const cap = at(ERA2.meta.levelCap), l50 = at(50), l60 = at(60), l70 = at(70);
  const e1cap = DATA.perLevel.find((l) => l.level === DATA.meta.levelCap);
  const slides = [];

  slides.push({ kicker: "The Trainer Model", big: "One ladder,<br>80 rungs.",
    label: `How far real trainers have climbed the rebalanced game — ${fmt(ERA2.meta.n)} friends from one list, as of ${ERA2.meta.latestCapture}.` });

  if (l50) slides.push({ kicker: "Level 50 · the old summit", big: `${fmtCompact(l50.caught.median)} caught`,
    label: `Today's median level-50 trainer has caught ${fmt(l50.caught.median)} Pokémon. In the 2025 game, 50 was the cap — its median trainer carried ${fmt(e1cap.median.caught)}. Same rung, a much longer ladder.` });

  if (l60) slides.push({ kicker: "Level 60 · the long middle", big: `${fmtCompact(l60.caught.median)} caught`,
    label: `The median level-60: ${fmt(l60.battles.median)} battles won and ${fmt(l60.distance.median, 1)} km walked, across ${l60.n} trainers.` });

  if (l70) slides.push({ kicker: "Level 70 · the climb steepens", big: `${fmtCompact(l70.caught.median)} caught`,
    label: `The median level-70: ${fmt(l70.battles.median)} battles won and ${fmt(l70.distance.median, 1)} km walked, across ${l70.n} trainers.` });

  if (cap) slides.push({ kicker: `Level ${ERA2.meta.levelCap} · the cap`, big: `${fmtCompact(cap.caught.median)} caught`,
    label: `The median trainer at the cap: ${fmt(cap.battles.median)} battles won, ${fmt(cap.distance.median, 1)} km walked — across ${cap.n} trainers. On average (the mean) it's ${fmt(cap.caught.mean)} catches; the grinders pull it up.` });

  const p = ERA2.pace;
  if (p?.nObserved) slides.push({ kicker: "How long does that take?", big: `${p.nLeveled} of ${fmt(p.nObserved)}`,
    label: `That's how many trainers gained a level while we watched — ${fmt(p.nObserved)} of them, recorded twice about ${p.meanWindowDays} days apart. Near the top, a week of ordinary play moves the number next to your name by nothing at all.` });

  if (cap) slides.push({ kicker: "So the honest answer is", big: "A very<br>long time.",
    label: `Lifetime totals carry no clock, so this page won't guess in months. What it can do is weigh the climb: the median level-${ERA2.meta.levelCap} has walked ${fmt(cap.distance.median, 1)} km — ${Math.round((100 * cap.distance.median) / EARTH_KM)}% of the way around the Earth, on foot.` });

  slides.push({ kicker: "Two eras, one friends list", big: "50 → 80",
    label: "The rebalance re-mapped everyone onto a longer ladder, so a level now means less lifetime play than it used to. The chapters above hold the full picture — every trainer, every fit, every caveat.",
    final: true });

  return slides;
}

function openStory() {
  if (STORY) return;
  const slides = storySlides();
  let i = 0;

  const ov = document.createElement("div");
  ov.className = "story-ov";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "The ladder story");
  ov.tabIndex = -1;                    // focusable, so the dialog can hold focus
  document.body.appendChild(ov);
  document.body.style.overflow = "hidden";
  // A fixed opaque overlay isn't a modal on its own — without this, Tab walks
  // straight out to the nav and footer behind the story. Same mechanism the
  // site's own story mode uses (js/app.js).
  const inerted = [...document.body.children].filter((el) => el !== ov && !el.inert);
  inerted.forEach((el) => (el.inert = true));
  // Whatever opened this gets focus back when it closes — otherwise a keyboard
  // user lands at the top of the document with no idea where they were.
  const opener = document.activeElement;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    ov.remove();
    inerted.forEach((el) => (el.inert = false));
    document.body.style.overflow = "";
    STORY = null;
    if (opener && document.contains(opener)) opener.focus();
  };

  const render = () => {
    const s = slides[i];
    ov.innerHTML = `
      <div class="story-prog">${slides.map((_, k) =>
        `<i class="${k < i ? "done" : k === i ? "cur" : ""}"></i>`).join("")}</div>
      <button class="story-x" aria-label="Close story">×</button>
      <div class="story-stage"><div class="story-slide">
        <div class="story-kicker">${s.kicker}</div>
        <div class="story-big">${s.big}</div>
        <div class="story-label">${s.label}</div>
        ${s.final ? `<div class="story-cta">
          <a class="btn btn-teal" href="#cohort">Explore every chapter</a>
          <button class="btn btn-ghost" type="button">Close</button>
        </div>` : ""}
      </div></div>
      <div class="story-hint">tap to continue · esc to close</div>`;
    ov.querySelector(".story-x").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    const ghost = ov.querySelector(".story-cta .btn-ghost");
    if (ghost) ghost.addEventListener("click", (e) => { e.stopPropagation(); close(); });
    const cta = ov.querySelector(".story-cta .btn-teal");
    if (cta) cta.addEventListener("click", () => close());
    // Each slide replaces the dialog's contents, which destroys whatever held
    // focus; put it back on the dialog itself so Tab still starts from inside.
    if (!ov.contains(document.activeElement)) ov.focus();
  };

  const step = (dir) => {
    if (dir > 0 && i >= slides.length - 1) { close(); return; }
    i = Math.max(0, Math.min(slides.length - 1, i + dir));
    render();
  };

  ov.addEventListener("click", (e) => {
    if (e.target.closest(".story-cta") || e.target.closest(".story-x")) return;
    step(1);
  });
  const onKey = (e) => {
    if (e.key === "Escape") { close(); return; }
    // Enter/Space belong to whichever control has focus; only advance the story
    // when nothing in the dialog is focused, or the dialog itself is.
    const onControl = document.activeElement !== ov && ov.contains(document.activeElement);
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if ((e.key === " " || e.key === "Enter") && !onControl) { e.preventDefault(); step(1); }
  };
  document.addEventListener("keydown", onKey);

  STORY = { close };
  render();
}

async function initEra2() {
  try {
    const res = await fetch("data/trainer-model/era2.json");
    if (!res.ok) return;                       // no era-2 data yet — chapters stay hidden
    ERA2 = await res.json();
  } catch { return; }
  document.getElementById("era2").hidden = false;
  document.getElementById("story").hidden = false;
  // Reveal the era-dependent chapter chips. They ship in the markup, in
  // position, so unhiding keeps the 01–08 sequence intact — appending here
  // would put 06 after 07 in the row.
  for (const chip of document.querySelectorAll("#chapter-nav [data-era2]")) chip.hidden = false;
  // The benchmark defaults to today's game now that its cohort exists.
  RANK.era = "era2";
  $("rank-era-ctl").hidden = false;
  syncRankForm({ resetValues: true });

  // Wire the controls BEFORE drawing anything. These chapters are already
  // visible by now, so a render that throws on an unexpected artifact would
  // otherwise leave the reader with dead toggles and no story button —
  // failing loudly in the console but silently on the page.
  $("btn-story").addEventListener("click", openStory);
  $("era2-scale-log").addEventListener("change", renderEra2Scatter);
  // writeBack on an era flip: the caps differ, so a level valid in one cohort
  // can be out of range in the other. Leaving the old number in the field while
  // ranking against the clamped one shows two different levels at once.
  segment("seg-rank-era", "era", RANK, () => { syncRankForm(); renderRank(true); });
  segment("seg-era2", "metric", ERA2_STATE, () => { renderEra2Scatter(); renderEra2(); renderCompare(); });

  // Fill in the 2026 column of the era-summary table, and state the ledger.
  renderHero();
  renderLedger();
  renderRank();
  renderEra2Scatter();
  renderEra2();
  renderCompare();
  renderLadder();
  renderCost();
  renderPace();
}

/* ═══════════════════════ wiring ═══════════════════════ */

function segment(id, key, store, onChange) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    for (const b of $(id).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
    store[key] = btn.dataset[key];
    onChange();
  });
}

async function init() {
  chartDefaults();
  try {
    const res = await fetch("data/trainer-model/trainers.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<div class="callout red" style="margin-top:100px">Could not load <code>data/trainer-model/trainers.json</code> (${err.message}).
       This page needs to be served over HTTP — locally, run <code>node static-server.mjs "$PWD" 8770</code> from the site folder and open the address it prints.</div>`);
    return;
  }

  renderHero();
  renderCohort();
  renderExplorer();
  renderRank();
  renderWall();
  renderR2Table();
  renderReport();
  renderPlaystyle();
  // Era-2 is optional and self-activating; a failure there must never take the
  // 2025 chapters down with it, and must not surface only as an unhandled
  // rejection. Nothing is awaited here — the era-1 page is already complete.
  initEra2().catch((err) => console.error("era-2 chapters could not be built:", err));

  segment("seg-metric", "metric", EXPLORER, renderExplorer);
  segment("seg-outlier", "mode", EXPLORER, renderExplorer);
  segment("seg-report", "metric", REPORT, renderReport);
  for (const id of ["fit-linear", "fit-log", "fit-median", "fit-mean", "scale-log"]) $(id).addEventListener("change", renderExplorer);

  /* Chart.js resizes itself via a ResizeObserver, but that can miss a viewport
     change that doesn't resize the container synchronously (phone rotation is the
     common one). Nudging every chart on resize is cheap and makes it deterministic. */
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { for (const c of Object.values(CHARTS)) c.resize(); }, 150);
  });

  $("btn-rank").addEventListener("click", () => renderRank(true));
  for (const id of ["in-level", "in-caught", "in-battles", "in-distance"]) {
    $(id).addEventListener("input", () => renderRank(false));
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") renderRank(true); });
  }
}

document.addEventListener("DOMContentLoaded", init);
