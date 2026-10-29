/*
 * Theme toggle. Reads/persists choice in localStorage; defaults to "light".
 * Loaded synchronously in <head> so the html[data-theme] attribute is set
 * before the first paint to avoid a flash of the wrong theme.
 */
(function () {
  const KEY = "nitid-planner.theme";
  const root = document.documentElement;
  const stored = localStorage.getItem(KEY);
  const initial = stored === "dark" || stored === "light" ? stored : "light";
  root.setAttribute("data-theme", initial);

  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem(KEY, next);
    });
  });
})();
