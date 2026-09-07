/* ── icon system ──────────────────────────────────────────────────────────
   One inline-SVG set (24-unit grid, 2px round strokes, currentColor) shared by
   every page. Emoji had been standing in for iconography sitewide — nav tabs,
   chapter heads, step cards, the dropzone — and emoji render differently on
   every OS, can't take the theme's colour, and read as a placeholder. These
   sit on the type baseline, inherit colour, and scale with font-size.
   `ICON(name)` returns markup; any element carrying `data-icon="name"` is
   hydrated on load, so static HTML can use them without inline SVG noise. */
(function () {
  const P = {
    home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
    trending: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
    chart: '<line x1="7" y1="20" x2="7" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="17" y1="20" x2="17" y2="13"/><line x1="3" y1="20" x2="21" y2="20"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    bag: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M8 22v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5"/>',
    log: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><line x1="13" y1="5" x2="13" y2="19" stroke-dasharray="2 3"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    rotate: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    receipt: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
    map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    flame: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.2-2-5.6-3.4-7.2-.4 1.6-1.3 2.6-2.4 3.1.3-2.9-.7-6.4-3.7-8.3.2 3.3-1.4 4.8-2.9 6.6C5.4 11 5 12.8 5 15.4 5 19.1 7.6 22 12 22z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="3"/>',
    rows: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/>',
    list: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/>',
  };
  window.ICON = function (name, cls) {
    const d = P[name];
    if (!d) return "";
    return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  };
  /* the catalog's 23 files keep an emoji as their KEY in catalog.js; this
     resolves it (or the file's group) to a line icon for every surface that
     lists files — the landing catalog, the detected-files list, the console */
  const FILE_ICON = { "🎮": "user", "🗺️": "log", "📍": "pin", "🤝": "users", "💔": "users", "✉️": "list", "🎉": "zap",
    "💳": "card", "🏃": "activity", "📱": "phone", "⬇️": "download", "🛰️": "globe", "📸": "camera", "🧭": "compass",
    "🎟️": "ticket", "🎁": "ticket", "↩️": "rotate", "🆘": "phone", "🛟": "phone", "🔐": "lock", "📇": "user",
    "📒": "book", "🎲": "zap", "🏅": "award", "⏱️": "clock", "🔍": "search", "📅": "calendar", "🌍": "globe", "🎒": "bag" };
  const GROUP_FILE_ICON = { "Your Profile": "user", "Your Activity": "activity", "Your Social World": "users", "Your Spending": "card",
    "Your Fitness": "activity", "Events": "ticket", "Technical & Device": "phone", "Identity (not visualized)": "lock" };
  window.fileIcon = function (emoji, group) {
    const name = FILE_ICON[emoji] || GROUP_FILE_ICON[group] || "folder";
    return window.ICON(name);
  };
  window.hydrateIcons = function (root) {
    (root || document).querySelectorAll("[data-icon]").forEach((el) => {
      const svg = window.ICON(el.dataset.icon);
      if (svg) el.innerHTML = svg;
    });
  };
})();

/* nav.js — shared top navigation, rendered into <nav id="topnav"> on each page.
 * The page sets data-active="home|guide|demo|model|app" to highlight the current tab. */
(function () {
  const nav = document.getElementById("topnav");
  if (!nav) return;
  const active = nav.dataset.active || "";
  // Root-absolute, not relative: 404.html is served by Netlify at whatever URL
  // was missed, so a relative "index.html" there resolved against that path
  // (/foo/bar → /foo/index.html) and every nav link 404'd in turn.
  const pages = [
    // "/" not "/index.html": both serve the landing page, but "/" is what the
    // canonical tag and the sitemap declare, so the nav should vote for it too.
    { id: "home", href: "/", icon: "home", label: "Home" },
    { id: "guide", href: "/#datasets", icon: "book", label: "What's in your export" },
    { id: "demo", href: "/demo.html", icon: "play", label: "Live Example" },
    { id: "model", href: "/trainer-model.html", icon: "trending", label: "Trainer Model" },
    { id: "app", href: "/metrics.html", icon: "sparkles", label: "Visualize my journey", cta: true },
  ];
  nav.innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="nav-inner">
      <a class="nav-brand" href="/">
        <span class="pokeball-dot"></span> POGO&nbsp;Metrics
      </a>
      <div class="nav-pages">
        ${pages.map((p) => `
          <a href="${p.href}" aria-label="${p.label}"${p.id === active ? ' aria-current="page"' : ""} class="${p.id === active ? "active" : ""} ${p.cta ? "nav-cta" : ""}">
            <span class="np-icon" aria-hidden="true">${window.ICON(p.icon)}</span><span class="np-label">${p.label}</span>
          </a>`).join("")}
      </div>
    </div>`;

  if (window.hydrateIcons) window.hydrateIcons(document);

  /* ── shared chapter rail ──────────────────────────────────────────────
     The report page builds its rail inside app.js (it needs reader mode and
     the story player); any other chaptered page can call this with its own
     sections and get the same rail, scroll-spy and stagger. Chips mirror a
     section's hidden attribute, so chapters that only exist once data has
     loaded appear in the rail the moment they appear on the page. */
  window.chapterRail = function (host, sections, opts) {
    opts = opts || {};
    const I = (n) => (window.ICON ? window.ICON(n) : "");
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    host.classList.add("chapter-nav", "chapter-rail");
    host.innerHTML = (opts.head ? `<div class="rail-head">${opts.head}</div>` : "") + sections.map((s, i) =>
      `<a class="ch-chip" href="#${s.el.id}" data-hue="${s.hue || "teal"}" style="--i:${i}"${s.el.hidden ? " hidden" : ""}${s.attr || ""}>${I(s.icon)}<span class="ch-t">${s.label}</span><span class="ch-n">${s.num || String(i + 1).padStart(2, "0")}</span></a>`).join("");
    const links = [...host.querySelectorAll(".ch-chip")];
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => sections.forEach((s, i) => { links[i].hidden = s.el.hidden; }));
      sections.forEach((s) => mo.observe(s.el, { attributes: true, attributeFilter: ["hidden"] }));
    }
    let cur = -1, tick = false;
    const spy = () => {
      tick = false;
      const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 80;
      const line = navH + 140;
      let i = -1;
      sections.forEach((s, j) => { if (!s.el.hidden && s.el.getBoundingClientRect().top <= line) i = j; });
      if (i < 0 && sections[0] && sections[0].el.getBoundingClientRect().top <= innerHeight * .6) i = 0;
      if (i === cur) return;
      if (cur >= 0 && links[cur]) { links[cur].classList.remove("cur"); links[cur].removeAttribute("aria-current"); }
      cur = i;
      const a = links[cur];
      if (!a) return;
      a.classList.add("cur"); a.setAttribute("aria-current", "true");
      const b = reduced ? "auto" : "smooth";
      if (host.scrollWidth > host.clientWidth + 6) host.scrollTo({ left: a.offsetLeft - (host.clientWidth - a.offsetWidth) / 2, behavior: b });
      else if (host.scrollHeight > host.clientHeight + 6) host.scrollTo({ top: a.offsetTop - host.clientHeight / 2 + a.offsetHeight / 2, behavior: b });
    };
    const on = () => { if (!tick) { tick = true; requestAnimationFrame(spy); } };
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    requestAnimationFrame(spy);
    document.body.classList.add("has-rail");
    return { refresh: on };
  };

  // Publish the nav's REAL height. It wraps to three rows on a phone (~143px),
  // but scroll-padding and the sticky filter bar were hardcoded to a desktop
  // 80px, so anchor jumps landed behind the nav.
  const setNavH = () => document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
  setNavH();
  addEventListener("resize", setNavH);
  if (window.ResizeObserver) new ResizeObserver(setNavH).observe(nav);

  /* On phones the tab row is a one-line scroller with the scrollbar hidden, so
   * nothing signals that more tabs exist — and nothing kept the current page's
   * own tab on screen. Center the active tab (scrollLeft directly, NOT
   * scrollIntoView, which would also scroll the page), and publish scroll
   * state as classes so the CSS can fade the clipped edge. */
  const row = nav.querySelector(".nav-pages");
  if (row) {
    const act = row.querySelector(".active") || row.querySelector(".nav-cta");
    if (act && row.scrollWidth > row.clientWidth)
      row.scrollLeft = Math.max(0, act.offsetLeft - (row.clientWidth - act.offsetWidth) / 2);
    const edge = () => {
      row.classList.toggle("scrollable", row.scrollWidth > row.clientWidth + 6);
      row.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 6);
      row.classList.toggle("at-start", row.scrollLeft <= 6);
    };
    edge();
    row.addEventListener("scroll", edge, { passive: true });
    addEventListener("resize", edge);
  }

  /* ── heading permalinks ────────────────────────────────────────────────
     A "#" on each section heading that copies a link straight to it, so
     nobody has to know the anchor names to point someone at one chapter.
     Lives here because both engines need it and both pages already load
     nav.js; they call it themselves, since the Live Example's chapters do
     not exist until an export has been parsed.

     Deliberately NOT offered on metrics.html: that page builds from files on
     your own device, so a link to a chapter of it opens an empty upload page
     for whoever you send it to. A copy-link button there would be an
     invitation to share something that cannot be shared. */
  let liveRegion = null;
  window.linkifyHeadings = function (selector) {
    document.querySelectorAll(selector).forEach((h) => {
      const target = h.closest("[id]");
      if (!target || !target.id || h.querySelector(".permalink")) return;

      const a = document.createElement("a");
      a.className = "permalink";
      a.href = "#" + target.id;
      a.textContent = "#";
      a.dataset.tip = "Copy link";
      // The heading text is the only thing that identifies WHICH link this is
      // to someone who can't see where the "#" sits.
      a.setAttribute("aria-label", `Copy link to “${h.textContent.trim()}”`);

      a.addEventListener("click", (e) => {
        // No preventDefault: letting the link navigate updates the address bar
        // and scrolls, so even if the clipboard is unavailable the reader can
        // still copy the URL by hand. The copy is the convenience, not the
        // mechanism.
        const url = location.origin + location.pathname + "#" + target.id;
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(url).then(() => {
          a.dataset.tip = "Copied";
          a.classList.add("copied");
          if (!liveRegion) {
            liveRegion = document.createElement("div");
            liveRegion.className = "sr-only";
            liveRegion.setAttribute("role", "status");
            liveRegion.setAttribute("aria-live", "polite");
            document.body.appendChild(liveRegion);
          }
          liveRegion.textContent = `Link copied: ${url}`;
          setTimeout(() => { a.dataset.tip = "Copy link"; a.classList.remove("copied"); }, 1600);
        }).catch(() => {});
      });

      h.appendChild(a);
    });
  };

  // Installable + offline-capable. Skipped on localhost so local dev never
  // fights a stale service-worker cache.
  // Root-absolute for the same reason as the links above: on 404.html — served
  // at whatever URL was missed — a relative "sw.js" resolves to /that/path/sw.js
  // and 404s, so the app never installs from there.
  if ("serviceWorker" in navigator && location.protocol === "https:" && location.hostname !== "localhost")
    navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
