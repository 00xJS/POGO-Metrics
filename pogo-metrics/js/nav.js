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
    { id: "home", href: "/", icon: "🏠", label: "Home" },
    { id: "guide", href: "/#datasets", icon: "📚", label: "What's in your export" },
    { id: "demo", href: "/demo.html", icon: "🎬", label: "Live Example" },
    { id: "model", href: "/trainer-model.html", icon: "📈", label: "Trainer Model" },
    { id: "app", href: "/metrics.html", icon: "📊", label: "Visualize my journey", cta: true },
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
            <span class="np-icon" aria-hidden="true">${p.icon}</span><span class="np-label">${p.label}</span>
          </a>`).join("")}
      </div>
    </div>`;

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
