// Theme toggle: respect system preference, allow manual override stored in localStorage
(function() {
  const root = document.documentElement;
  const stored = localStorage.getItem("theme");
  if (stored) root.setAttribute("data-theme", stored);

  const btn = document.getElementById("theme-toggle");
  function isDark() {
    const attr = root.getAttribute("data-theme");
    if (attr) return attr === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function updateIcon() { btn.textContent = isDark() ? "\u2600\uFE0F" : "\uD83C\uDF19"; }
  updateIcon();

  btn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateIcon();
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem("theme")) updateIcon();
  });
})();