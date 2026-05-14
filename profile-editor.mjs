/**
 * Shared profile editor logic for tip-editor.html and island-editor.html.
 *
 * @param {object} config
 * @param {object} config.profiles        - Mutable profile map (e.g. TIP_PROFILES)
 * @param {string} config.lsKey           - localStorage key for custom profiles
 * @param {string} config.defaultStyle    - Initial selected style (e.g. "paw")
 * @param {function} config.buildPath     - (style, params) => SVG path d string
 * @param {function} config.sliderRange   - (name) => { min, max, step }
 * @param {string} config.exportPrefix    - Filename prefix for export (e.g. "tip")
 * @param {function} [config.formatValue] - (k, v) => string for code output
 */
export function initProfileEditor({
  profiles,
  lsKey,
  defaultStyle,
  buildPath,
  sliderRange,
  exportPrefix,
  formatValue = (_k, v) => (typeof v === "number" ? v.toFixed(2) : String(v)),
}) {
  const BUILTIN_NAMES = new Set(Object.keys(profiles));

  function loadCustomProfiles() {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveCustomProfiles(customs) {
    localStorage.setItem(lsKey, JSON.stringify(customs));
  }

  // Inject custom profiles
  const customProfiles = loadCustomProfiles();
  for (const [name, profile] of Object.entries(customProfiles)) {
    profiles[name] = profile;
  }

  // Deep-copy defaults for reset
  const DEFAULTS = JSON.parse(JSON.stringify(profiles));

  // --- DOM ---
  const styleSelect = document.getElementById("style-select");
  const slidersDiv = document.getElementById("sliders");
  const shapePath = document.getElementById("shape");
  const codeOut = document.getElementById("code-out");
  const copyBtn = document.getElementById("copy-btn");
  const copyMsg = document.getElementById("copy-msg");
  const saveNameInput = document.getElementById("save-name");
  const saveBtn = document.getElementById("save-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const pasteInput = document.querySelector(".paste-input");

  // --- Grid ---
  const g = document.getElementById("grid");
  let gridD = "";
  for (let i = 0; i <= 10; i++) {
    const v = i / 10;
    gridD += `M${v},-0.1V1.1 M-0.1,${v}H1.1 `;
  }
  const gridPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  gridPath.setAttribute("d", gridD);
  gridPath.setAttribute("stroke", "#e8e8e8");
  gridPath.setAttribute("stroke-width", "0.003");
  gridPath.setAttribute("fill", "none");
  g.appendChild(gridPath);

  // --- Helpers ---
  function currentStyle() { return styleSelect.value; }
  function currentParams() { return profiles[currentStyle()]; }

  function labelForStyle(name) {
    return name.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }

  function flashMsg(text, cls) {
    copyMsg.textContent = text;
    if (cls) copyMsg.className = cls;
    setTimeout(() => { copyMsg.textContent = ""; copyMsg.className = ""; }, 1500);
  }

  // --- Dropdown ---
  function buildStyleOptions(selected = defaultStyle) {
    styleSelect.innerHTML = "";

    for (const name of BUILTIN_NAMES) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = labelForStyle(name);
      opt.selected = name === selected;
      styleSelect.appendChild(opt);
    }

    const customNames = Object.keys(profiles).filter(n => !BUILTIN_NAMES.has(n));
    if (customNames.length) {
      const sep = document.createElement("option");
      sep.disabled = true;
      sep.textContent = "--- Custom ---";
      styleSelect.appendChild(sep);
      for (const name of customNames) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = labelForStyle(name);
        opt.selected = name === selected;
        styleSelect.appendChild(opt);
      }
    }
  }

  // --- Save row state ---
  function updateSaveRow() {
    const style = currentStyle();
    const isCustom = !BUILTIN_NAMES.has(style);
    // Pre-populate name input with current custom style name
    saveNameInput.value = isCustom ? style : "";
    deleteBtn.style.display = isCustom ? "" : "none";
    updateSaveBtn();
  }

  function updateSaveBtn() {
    const name = saveNameInput.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const customs = loadCustomProfiles();
    const existing = name && customs[name];
    saveBtn.textContent = existing ? "Update save" : "Save to browser";

    // Disable when empty, builtin name, or saved version is identical
    let disabled = !name || BUILTIN_NAMES.has(name);
    if (!disabled && existing) {
      const current = currentParams();
      disabled = Object.keys(current).length === Object.keys(existing).length &&
        Object.entries(current).every(([k, v]) => existing[k] === v);
    }
    saveBtn.disabled = disabled;
  }

  saveNameInput.addEventListener("input", updateSaveBtn);

  // --- Shape + code output ---
  function updateShape() {
    const style = currentStyle();
    const params = currentParams();
    shapePath.setAttribute("d", buildPath(style, params));

    codeOut.textContent = Object.entries(params)
      .map(([k, v]) => `${k}: ${formatValue(k, v)}`)
      .join(", ");

    updateSaveRow();
  }

  // --- Sliders ---
  function buildSliders() {
    slidersDiv.innerHTML = "";
    const style = currentStyle();
    const params = currentParams();
    const defaults = DEFAULTS[style];

    for (const [name, val] of Object.entries(params)) {
      if (typeof val !== "number") continue;

      const row = document.createElement("div");
      row.className = "slider-row";

      const label = document.createElement("label");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = name;
      const valSpan = document.createElement("span");
      valSpan.className = "val";
      valSpan.textContent = val.toFixed(2);
      label.appendChild(nameSpan);
      label.appendChild(valSpan);

      const input = document.createElement("input");
      input.type = "range";
      const range = sliderRange(name);
      input.min = range.min;
      input.max = range.max;
      input.step = range.step;
      input.value = String(val);

      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        params[name] = v;
        valSpan.textContent = v.toFixed(2);
        updateShape();
      });

      if (defaults) {
        input.addEventListener("dblclick", () => {
          const v = defaults[name];
          params[name] = v;
          input.value = String(v);
          valSpan.textContent = v.toFixed(2);
          updateShape();
        });
      }

      row.appendChild(label);
      row.appendChild(input);
      slidersDiv.appendChild(row);
    }
  }

  // --- Event handlers ---
  styleSelect.addEventListener("change", () => {
    buildSliders();
    updateShape();
  });

  saveBtn.addEventListener("click", () => {
    const name = saveNameInput.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!name) { flashMsg("Enter a name"); return; }
    if (BUILTIN_NAMES.has(name)) { flashMsg("Can't overwrite built-in"); return; }

    const customs = loadCustomProfiles();
    const isUpdate = !!customs[name];

    const params = JSON.parse(JSON.stringify(currentParams()));
    profiles[name] = params;
    DEFAULTS[name] = JSON.parse(JSON.stringify(params));

    customs[name] = params;
    saveCustomProfiles(customs);

    buildStyleOptions(name);
    buildSliders();
    updateShape();
    flashMsg(isUpdate ? "Updated!" : "Saved!", "copied");
  });

  deleteBtn.addEventListener("click", () => {
    const name = currentStyle();
    if (BUILTIN_NAMES.has(name)) return;

    delete profiles[name];
    delete DEFAULTS[name];

    const customs = loadCustomProfiles();
    delete customs[name];
    saveCustomProfiles(customs);

    buildStyleOptions(defaultStyle);
    buildSliders();
    updateShape();
    flashMsg("Deleted!");
  });

  copyBtn.addEventListener("click", () => {
    const text = Object.entries(currentParams())
      .map(([k, v]) => `${k}: ${formatValue(k, v)}`)
      .join(", ");
    navigator.clipboard.writeText(text).then(() => {
      flashMsg("Copied!", "copied");
    });
  });

  pasteInput.addEventListener("input", () => {
    const text = pasteInput.value;
    if (!text.includes(":") && !text.includes("=")) return;
    pasteInput.value = "";
    pasteInput.blur();

    const params = currentParams();
    for (const part of text.split(",")) {
      const m = part.match(/^\s*(\w+)\s*[:=]\s*(.+?)\s*$/);
      if (!m) continue;
      const [, k, v] = m;
      if (k in params) params[k] = parseFloat(v);
    }
    buildSliders();
    updateShape();
    flashMsg("Pasted!", "copied");
  });

  document.getElementById("export-btn").addEventListener("click", () => {
    const d = buildPath(currentStyle(), currentParams());
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.15 -0.15 1.3 1.3" width="800" height="800">`,
      `  <path d="${gridD.trim()}" stroke="#e0e0e0" stroke-width="0.003" fill="none"/>`,
      `  <rect x="0" y="0" width="1" height="1" fill="none" stroke="#aaa" stroke-width="0.006"/>`,
      `  <path d="${d}" fill="rgba(0,0,0,0.1)" stroke="#000" stroke-width="0.008"/>`,
      `</svg>`,
    ].join("\n");

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportPrefix}-${currentStyle()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- Init ---
  buildStyleOptions(defaultStyle);
  buildSliders();
  updateShape();
}
