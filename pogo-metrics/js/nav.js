/* nav.js — shared top navigation, rendered into <nav id="topnav"> on each page.
 * The page sets data-active="home|guide|app" to highlight the current tab. */
(function () {
  const nav = document.getElementById("topnav");
  if (!nav) return;
  const active = nav.dataset.active || "";
  const pages = [
    { id: "home", href: "index.html", icon: "🏠", label: "Home" },
    { id: "guide", href: "index.html#datasets", icon: "📚", label: "Your Data Explained" },
    { id: "demo", href: "demo.html", icon: "🎬", label: "Live Example" },
    { id: "app", href: "metrics.html", icon: "📊", label: "Visualize my journey", cta: true },
  ];
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-brand" href="index.html">
        <span class="pokeball-dot"></span> POGO&nbsp;Metrics
      </a>
      <div class="nav-pages">
        ${pages.map((p) => `
          <a href="${p.href}" class="${p.id === active ? "active" : ""} ${p.cta ? "nav-cta" : ""}">
            <span class="np-icon">${p.icon}</span><span class="np-label">${p.label}</span>
          </a>`).join("")}
      </div>
    </div>`;
})();
