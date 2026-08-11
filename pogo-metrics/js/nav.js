/* nav.js — shared top navigation, rendered into <nav id="topnav"> on each page.
 * The page sets data-active="home|guide|demo|model|app" to highlight the current tab. */
(function () {
  const nav = document.getElementById("topnav");
  if (!nav) return;
  const active = nav.dataset.active || "";
  const pages = [
    { id: "home", href: "index.html", icon: "🏠", label: "Home" },
    { id: "guide", href: "index.html#datasets", icon: "📚", label: "Your Data Explained" },
    { id: "demo", href: "demo.html", icon: "🎬", label: "Live Example" },
    { id: "model", href: "trainer-model.html", icon: "📈", label: "Trainer Model" },
    { id: "app", href: "metrics.html", icon: "📊", label: "Visualize my journey", cta: true },
  ];
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-brand" href="index.html">
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

  // Installable + offline-capable. Skipped on localhost so local dev never
  // fights a stale service-worker cache.
  if ("serviceWorker" in navigator && location.protocol === "https:" && location.hostname !== "localhost")
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();
