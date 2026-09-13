/* landing.js — the landing page's live preview and its section sub-nav.
 *
 * The hero used to sell the product with a paragraph. Now it shows it: a
 * miniature of the report masthead and the story player, built from a compact
 * summary of the same anonymized sample export the Live Example parses
 * (data/sample-preview.json — regenerate it from the Live Example after a new
 * sample). The markup ships with one real slide already in it, so the preview
 * reads correctly before the fetch resolves and if it never does. No numbers
 * are invented here: every figure comes from that file. */
(function () {
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => Number(n).toLocaleString();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  /* These two lived in an inline <script> in index.html until the CSP dropped
   * 'unsafe-inline' for scripts. This file is deferred, so the DOM is already
   * parsed when it runs — the same moment the old DOMContentLoaded handler saw. */

  /* ── a file dropped on this page ──
   * The hero says "drop the files here" — a literal drop on THIS page must not
   * navigate the tab to the raw file. Files can't survive navigation, so hand
   * the visitor to the page that actually reads them. */
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files"))
      location.href = "metrics.html";
  });

  /* ── "Check for my Pokémon GO export" — a 7-days-from-now reminder, generated
   * on the device as a plain .ics download. No calendar service, no request. ── */
  const icsBtn = $("ics-reminder");
  if (icsBtn) icsBtn.addEventListener("click", () => {
    // seven days on from today on this device's calendar. The UTC date is
    // already tomorrow on an evening west of Greenwich, and was a day out.
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const ymd = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//POGO Metrics//EN",
      "BEGIN:VEVENT", "UID:" + stamp + "@pogo-metrics",
      "DTSTAMP:" + stamp, "DTSTART;VALUE=DATE:" + ymd,
      "SUMMARY:Check for your Pokémon GO data export",
      "DESCRIPTION:Support's reply has taken anywhere from a day to a month (the privacy policy's stated target is 30 days) — and the download link expires 7 days after it lands. Grab the ZIP\\, then visualize it at https://pogo-metrics.netlify.app/",
      "URL:https://pogo-metrics.netlify.app/", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const dl = document.createElement("a");
    dl.href = url; dl.download = "pogo-metrics-reminder.ics";
    document.body.appendChild(dl); dl.click(); dl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  /* ── section sub-nav: fixed under the site nav once the hero has scrolled away ── */
  const SECTIONS = [
    ["how", "How it works"], ["privacy", "Privacy"], ["datasets", "Your export"], ["research", "Trainer Model"],
  ];
  const sub = $("subnav");
  if (sub) {
    // Sections only — the site nav directly above already carries the yellow
    // "Visualize my journey", and a second one here stacked under it.
    sub.innerHTML = SECTIONS.map(([id, label]) =>
      `<a class="ch-chip" href="#${id}"><span class="ch-t">${label}</span></a>`).join("");
    const links = [...sub.querySelectorAll("a[href^='#']")];
    const hero = $("hero");
    let tick = false;
    const spy = () => {
      tick = false;
      const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 80;
      const past = hero ? hero.getBoundingClientRect().bottom < navH + 8 : true;
      sub.classList.toggle("on", past);
      document.documentElement.style.scrollPaddingTop = (past ? navH + 62 : navH + 12) + "px";
      const line = navH + 120;
      let cur = -1;
      SECTIONS.forEach(([id], i) => { const s = $(id); if (s && s.getBoundingClientRect().top <= line) cur = i; });
      links.forEach((a, i) => { a.classList.toggle("cur", i === cur); if (i === cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      if (cur >= 0 && sub.scrollWidth > sub.clientWidth + 6) {
        const a = links[cur];
        sub.scrollTo({ left: a.offsetLeft - (sub.clientWidth - a.offsetWidth) / 2, behavior: REDUCED ? "auto" : "smooth" });
      }
    };
    const onScroll = () => { if (!tick) { tick = true; requestAnimationFrame(spy); } };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    spy();
  }

  /* ── section 04: trainers per level, straight from the model's own data ── */
  const mini = $("tm-mini");
  if (mini) fetch("data/trainer-model/trainers.json").then((r) => r.json()).then((d) => {
    const rows = (d.perLevel || []).filter((r) => r.n > 0);
    if (!rows.length) return;
    const cap = (d.meta && d.meta.levelCap) || 50;
    const W = 640, H = 120, max = Math.max(...rows.map((r) => r.n));
    const bw = W / rows.length;
    const bars = rows.map((r, i) => {
      const h = Math.max(2, (r.n / max) * (H - 18));
      return `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(H - 14 - h).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${r.level === cap ? "cap" : ""}"/>`;
    }).join("");
    const labels = rows.map((r, i) => (i % 4 === 0 || r.level === cap)
      ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${r.level}</text>` : "").join("");
    mini.querySelector("svg").innerHTML = bars + labels;
    mini.hidden = false;
  }).catch(() => {});

  /* ── the live preview ── */
  const box = $("hero-preview");
  if (!box) return;
  const HUES = ["#41d8c6", "#ffcb05", "#6f92ff", "#a06bff", "#ff6bb3", "#ff9a44", "#3ddc84", "#e061b0", "#41d8c6", "#ffcb05", "#6f92ff", "#a06bff"];

  const sparkline = (series) => {
    const svg = $("hp-spark");
    if (!svg || series.length < 2) return;
    const vals = series.map((m) => m[1]);
    const max = Math.max(...vals) || 1;
    const W = 300, H = 48, n = vals.length;
    const pts = vals.map((v, i) => [(i / (n - 1)) * W, H - 4 - (v / max) * (H - 10)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const last = pts[n - 1];
    svg.innerHTML = `<path class="sp-fill" d="${d} L${W} ${H} L0 ${H} Z"/><path class="sp-line" d="${d}"/>`;
    const dot = box.querySelector(".hp-spark .sp-end") || document.createElement("i");
    dot.className = "sp-end";
    dot.style.left = `calc(${((last[0] / W) * 100).toFixed(2)}% - 4px)`;
    dot.style.top = `calc(${((last[1] / H) * 100).toFixed(2)}% - 4px)`;
    svg.parentElement.appendChild(dot);
  };

  const countUp = (el, target, ms) => {
    if (REDUCED || target < 20) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const play = (slides) => {
    const stage = $("hp-story"), prog = $("hp-prog");
    if (!stage || !prog || !slides.length) return;
    prog.innerHTML = slides.map(() => "<i><b></b></i>").join("");
    const segs = [...prog.children];
    let i = -1, timer = null, paused = false;
    const MS = 3400;
    const show = (idx) => {
      i = (idx + slides.length) % slides.length;
      const s = slides[i];
      segs.forEach((seg, j) => { seg.className = j < i ? "done" : j === i ? "cur" : ""; });
      const old = stage.querySelector(".hp-slide");
      const el = document.createElement("div");
      el.className = "hp-slide in";
      el.innerHTML = `<div class="hp-kicker">${esc(s.kicker)}</div>
        <div class="hp-big${s.num != null ? " mono" : ""}">${s.num != null ? "0" : esc(s.big)}</div>
        <div class="hp-label">${esc(s.label)}</div>`;
      stage.style.setProperty("--wash", HUES[s.grad % HUES.length]);
      if (old) old.remove();
      stage.appendChild(el);
      if (s.num != null) countUp(el.querySelector(".hp-big"), s.num, 900);
      box.querySelector(".hp-count").textContent = `${i + 1} / ${slides.length}`;
    };
    const next = () => show(i + 1);
    const arm = () => { if (timer) clearInterval(timer); if (!REDUCED) timer = setInterval(() => { if (!paused) next(); }, MS); };
    show(2);            // open on the first real number, not the title card
    arm();
    stage.addEventListener("click", (e) => {
      const r = stage.getBoundingClientRect();
      (e.clientX - r.left) < r.width * 0.3 ? show(i - 1) : next();
      arm();
    });
    stage.addEventListener("mouseenter", () => { paused = true; });
    stage.addEventListener("mouseleave", () => { paused = false; });
    stage.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { next(); arm(); }
      if (e.key === "ArrowLeft") { show(i - 1); arm(); }
    });
    // don't burn CPU in a background tab
    document.addEventListener("visibilitychange", () => { paused = document.hidden; });
  };

  fetch("data/sample-preview.json").then((r) => r.json()).then((d) => {
    const p = d.profile || {};
    const name = box.querySelector(".hp-name");
    if (name && p.username) name.textContent = `${p.username}’s journey`;
    const meta = box.querySelector(".hp-meta");
    if (meta) meta.textContent = [p.level && `Level ${p.level}`, p.startYear && `since ${p.startYear}`, d.daysPlayed && `${fmt(d.daysPlayed)} days played`].filter(Boolean).join(" · ");
    const av = box.querySelector(".hp-avatar");
    if (av && p.username) av.textContent = p.username.charAt(0).toUpperCase();
    const t = d.totals || {};
    // the report's own sum (catchesOf in app.js): encounters, since the map, incense and lure logs never record a catch
    const met = (t["GO Plus catches"] || 0) + (t["Encounters"] || 0) + (t["Incense"] || 0) + (t["Lures"] || 0);
    const tiles = $("hp-tiles");
    if (tiles) tiles.innerHTML = [[met, "encounters"], [t["Raids"] || 0, "raids"], [d.friends || 0, "friends"], [d.places || 0, "places"]]
      .map(([v, l]) => `<div><b>${fmt(v)}</b><span>${l}</span></div>`).join("");
    if (d.monthly) {
      sparkline(d.monthly);
      const l = box.querySelector(".hp-spark-l");
      const mon = (k) => { const [y, m] = k.split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1] + " ’" + y.slice(2); };
      if (l) l.innerHTML = `<span>${mon(d.monthly[0][0])}</span><span>Actions per month</span><span>${mon(d.monthly[d.monthly.length - 1][0])}</span>`;
    }
    play(d.slides || []);
  }).catch(() => { /* the static slide in the markup stands */ });
})();
