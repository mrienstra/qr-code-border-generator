import { generate, parseQr, computeLayout, getAlignmentPositions } from "./generate_border.mjs";
import { TIP_PROFILES } from "./per-pixel-paths.mjs";
import { ISLAND_PROFILES } from "./island-profiles.mjs";

// Load custom profiles from localStorage and inject into module-level objects
const BUILTIN_TIP_NAMES = new Set(Object.keys(TIP_PROFILES));
const BUILTIN_ISLAND_NAMES = new Set(Object.keys(ISLAND_PROFILES));

function loadCustomProfiles(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
const customTipProfiles = loadCustomProfiles("qr-custom-tip-profiles");
const customIslandProfiles = loadCustomProfiles("qr-custom-island-profiles");
Object.assign(TIP_PROFILES, customTipProfiles);
Object.assign(ISLAND_PROFILES, customIslandProfiles);

const QrCode = qrcodegen.QrCode;
const QrSegment = qrcodegen.QrSegment;
const Ecc = QrCode.Ecc;

// --- State ---
let currentSvgSource = null; // raw QR SVG text (from generator or upload)
let currentOutputSvg = null; // bordered SVG text
let uploadedSvg = null;

// Check sessionStorage for repro SVG (set by loadReproJson before reload)
const reproSvg = sessionStorage.getItem("qr-repro-svg");
if (reproSvg) {
  uploadedSvg = reproSvg;
  sessionStorage.removeItem("qr-repro-svg");
}

// --- Elements ---
const textInput = document.getElementById("text-input");
const eccRadios = document.querySelectorAll('input[name="ecc"]');
const versionMin = document.getElementById("version-min");
const versionMax = document.getElementById("version-max");
const maskInput = document.getElementById("mask-input");
const boostEcc = document.getElementById("boost-ecc");
const fileInput = document.getElementById("file-input");
const borderShapeRadios = document.querySelectorAll('input[name="border-shape"]');
const cornerRadiusField = document.getElementById("corner-radius-field");
const snapRadiusCheckbox = document.getElementById("snap-radius");
const cornerRadius = document.getElementById("corner-radius");
const cornerRadiusValue = document.getElementById("corner-radius-value");
const circleRatio = document.getElementById("circle-ratio");
const circleRatioValue = document.getElementById("circle-ratio-value");
const strokeWidth = document.getElementById("stroke-width");
const strokeWidthValue = document.getElementById("stroke-width-value");
const fgColor = document.getElementById("fg-color");
const fgAlpha = document.getElementById("fg-alpha");
const fgAlphaValue = document.getElementById("fg-alpha-value");
const borderColorInput = document.getElementById("border-color");
const borderAlpha = document.getElementById("border-alpha");
const borderAlphaValue = document.getElementById("border-alpha-value");
const border2Enabled = document.getElementById("border2-enabled");
const border2Fields = document.getElementById("border2-fields");
const border2Color = document.getElementById("border2-color");
const border2Alpha = document.getElementById("border2-alpha");
const border2AlphaValue = document.getElementById("border2-alpha-value");
const border2Width = document.getElementById("border2-width");
const border2WidthValue = document.getElementById("border2-width-value");
const border2Offset = document.getElementById("border2-offset");
const border2OffsetValue = document.getElementById("border2-offset-value");
const border2Trim = document.getElementById("border2-trim");
const bgColor = document.getElementById("bg-color");
const bgAlpha = document.getElementById("bg-alpha");
const bgAlphaValue = document.getElementById("bg-alpha-value");
const bgShapeRadios = document.querySelectorAll('input[name="bg-shape"]');
const gapInput = document.getElementById("gap");
const gapValue = document.getElementById("gap-value");
const flankGapInput = document.getElementById("flank-gap");
const flankGapValue = document.getElementById("flank-gap-value");
const shuffleCheckbox = document.getElementById("shuffle");
const randAlignCheckbox = document.getElementById("rand-align");
const randFluffCheckbox = document.getElementById("rand-fluff");
const noFluffCheckbox = document.getElementById("no-fluff");
const obfuscateCheckbox = document.getElementById("obfuscate");
const obfuscateFields = document.getElementById("obfuscate-fields");
const obfTl = document.getElementById("obf-tl");
const obfTlValue = document.getElementById("obf-tl-value");
const obfTr = document.getElementById("obf-tr");
const obfTrValue = document.getElementById("obf-tr-value");
const obfBl = document.getElementById("obf-bl");
const obfBlValue = document.getElementById("obf-bl-value");
const obfAlign = document.getElementById("obf-align");
const obfAlignValue = document.getElementById("obf-align-value");
const obfDarkOnly = document.getElementById("obf-dark-only");
const obfBorder = document.getElementById("obf-border");
const obfTint = document.getElementById("obf-tint");
const roundedPixelsCheckbox = document.getElementById("rounded-pixels");
const roundedPixelsFields = document.getElementById("rounded-pixels-fields");
const roundedRadius = document.getElementById("rounded-radius");
const roundedRadiusValue = document.getElementById("rounded-radius-value");
const roundedInner = document.getElementById("rounded-inner");
const roundedInnerValue = document.getElementById("rounded-inner-value");
const fullLCornersCheckbox = document.getElementById("full-l-corners");
const skipCheckerLCornersCheckbox = document.getElementById("skip-checker-l-corners");
const skipCheckerLCornersRow = document.getElementById("skip-checker-l-corners-row");
const getRenderer = () => document.querySelector('input[name="renderer"]:checked')?.value ?? "per-pixel";
const connectDiagonalsSlider = document.getElementById("connect-diagonals");
const connectDiagonalsValue = document.getElementById("connect-diagonals-value");
const cdOrderSelect = document.getElementById("cd-order");
const diagOnlyCheckbox = document.getElementById("diag-only");
const tipStyleSelect = document.getElementById("tip-style");
const tipBaseSlider = document.getElementById("tip-base");
const tipBaseValue = document.getElementById("tip-base-val");
const islandStyleSelect = document.getElementById("island-style");
const tipMixContainer = document.getElementById("tip-mix-sliders");
const islandMixContainer = document.getElementById("island-mix-sliders");
const TIP_BASE_DEFAULTS = {
  none: 0,
  ...Object.fromEntries(
    Object.entries(TIP_PROFILES).map(([name, profile]) => [
      name,
      typeof profile?.base === "number" ? profile.base : 0,
    ])
  ),
};
// Defaults matching generate()'s parameter defaults — used to build sparse repro JSON
const GENERATE_DEFAULTS = {
  colorful: false,
  circleRatio: 0.82,
  strokeWidth: 2,
  bgColor: "#ffffff",
  bgShape: "circle",
  fgColor: "#000000",
  borderColor: "#000000",
  borderShape: "circle",
  cornerRadius: 0,
  border2Color: null,
  border2Width: 4,
  border2Offset: 0,
  border2Trim: false,
  snapRadius: false,
  shuffle: false,
  gap: 1,
  flankGap: 1,
  randAlign: true,
  randFluff: false,
  obfuscate: null,
  roundedPixels: 0,
  roundedInner: 0,
  connectDiagonals: 0,
  connectDiagonalsOrder: "default",
  diagOnly: false,
  tipStyle: "none",
  islandStyle: "none",
  jiggle: 0,
  fullLCorners: false,
  skipCheckerLCorners: false,
  contourMode: false,
  cleanPathMode: false,
  wobbleFreq: 0,
  wobbleOctaves: 3,
  wobbleScale: 0,
  noFluff: false,
  finderSplit: false,
};
const jiggleSlider = document.getElementById("jiggle");
const jiggleValue = document.getElementById("jiggle-value");
const wobbleFreqSlider = document.getElementById("wobble-freq");
const wobbleFreqValue = document.getElementById("wobble-freq-value");
const wobbleOctavesSlider = document.getElementById("wobble-octaves");
const wobbleOctavesValue = document.getElementById("wobble-octaves-value");
const wobbleScaleSlider = document.getElementById("wobble-scale");
const wobbleScaleValue = document.getElementById("wobble-scale-value");
const finderSplitCheckbox = document.getElementById("finder-split");
function cdLabel(v) {
  const n = parseFloat(v);
  if (n === 0) return 'Off';
  if (n >= 5) return 'All';
  return n;
}
const colorful = document.getElementById("colorful");
const previewSvg = document.getElementById("preview-svg");
const statsEl = document.getElementById("stats");
const downloadBtn = document.getElementById("download-btn");
const stepSlider = document.getElementById("step-slider");
const stepLabel = document.getElementById("step-label");
const stepPlayBtn = document.getElementById("step-play");

// --- QR generation (using Nayuki library) ---

function getEcc() {
  const val = document.querySelector('input[name="ecc"]:checked').value;
  return { low: Ecc.LOW, medium: Ecc.MEDIUM, quartile: Ecc.QUARTILE, high: Ecc.HIGH }[val];
}

function qrToSvgString(qr) {
  // Generate SVG with border=0 so our parser gets 0-indexed coordinates
  const parts = [];
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.getModule(x, y))
        parts.push(`M${x},${y}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}">` +
    `<path d="${parts.join(" ")}"/></svg>`;
}

function generateQrSvg() {
  const text = textInput.value;
  const ecc = getEcc();
  const minV = Math.max(1, Math.min(40, parseInt(versionMin.value) || 1));
  const maxV = Math.max(minV, Math.min(40, parseInt(versionMax.value) || 40));
  const mask = parseInt(maskInput.value) || -1;
  const boost = boostEcc.checked;

  try {
    const segs = QrSegment.makeSegments(text);
    const qr = QrCode.encodeSegments(segs, ecc, minV, maxV, mask, boost);
    const version = (qr.size - 17) / 4;
    statsEl.textContent = `Version ${version}, ${qr.size}x${qr.size}, mask ${qr.mask}, ECC ${"LMQH"[qr.errorCorrectionLevel.ordinal]}`;
    return qrToSvgString(qr);
  } catch (e) {
    statsEl.textContent = e.message;
    return null;
  }
}

// --- Helpers ---

function colorWithAlpha(hex, alpha) {
  if (alpha >= 1) return hex;
  if (alpha <= 0) return "none";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// --- URL params ---

const DEFAULTS = {
  t: "https://example.com", ecc: "low", vmin: "1", vmax: "40", mask: "-1", boost: "1",
  shape: "circle", cr: "0", snap: "0", ratio: "0.82", sw: "2",
  fg: "000000", fga: "1", bc: "000000", bca: "1",
  b2: "0", b2c: "ffffff", b2a: "1", b2w: "4", b2o: "0", b2t: "0",
  bg: "ffffff", bga: "1", bgs: "circle", gap: "1", fgap: "1", shuf: "0", ra: "1", rf: "0",
  nf: "0",
  obf: "0", otl: "0", otr: "0", obl: "0", oal: "0", oeo: "0",
  obd: "0", obt: "rgba(0,0,30,0.1)",
  rp: "0", rpr: "0.3", rpri: "0.3", flc: "0", scl: "0", ct: "0", cd: "0", cdo: "default", dgo: "0", ts: "none", is: "none", rj: "0", cp: "0",
  wf: "0", wo: "3", ws: "0", fns: "0",
  dbg: "0",
};

function saveToUrl() {
  const state = {
    t: textInput.value,
    ecc: document.querySelector('input[name="ecc"]:checked').value,
    vmin: versionMin.value, vmax: versionMax.value, mask: maskInput.value,
    boost: boostEcc.checked ? "1" : "0",
    shape: document.querySelector('input[name="border-shape"]:checked').value,
    cr: cornerRadius.value, snap: snapRadiusCheckbox.checked ? "1" : "0",
    ratio: circleRatio.value, sw: strokeWidth.value,
    fg: fgColor.value.slice(1), fga: fgAlpha.value,
    bc: borderColorInput.value.slice(1), bca: borderAlpha.value,
    b2: border2Enabled.checked ? "1" : "0",
    b2c: border2Color.value.slice(1), b2a: border2Alpha.value,
    b2w: border2Width.value, b2o: border2Offset.value, b2t: border2Trim.checked ? "1" : "0",
    bg: bgColor.value.slice(1), bga: bgAlpha.value,
    bgs: document.querySelector('input[name="bg-shape"]:checked').value,
    gap: gapInput.value, fgap: flankGapInput.value,
    shuf: shuffleCheckbox.checked ? "1" : "0",
    ra: randAlignCheckbox.checked ? "1" : "0",
    rf: randFluffCheckbox.checked ? "1" : "0",
    nf: noFluffCheckbox.checked ? "1" : "0",
    obf: obfuscateCheckbox.checked ? "1" : "0",
    otl: obfTl.value, otr: obfTr.value, obl: obfBl.value, oal: obfAlign.value,
    oeo: obfDarkOnly.checked ? "1" : "0",
    obd: obfBorder.checked ? "1" : "0",
    obt: obfTint.value,
    rp: roundedPixelsCheckbox.checked ? "1" : "0",
    rpr: roundedRadius.value,
    rpri: roundedInner.value,
    flc: fullLCornersCheckbox.checked ? "1" : "0",
    scl: skipCheckerLCornersCheckbox.checked ? "1" : "0",
    rm: getRenderer(),
    cd: connectDiagonalsSlider.value,
    cdo: cdOrderSelect.value,
    dgo: diagOnlyCheckbox.checked ? "1" : "0",
    ts: tipStyleSelect.value === "mix"
      ? Object.entries(getMixWeights(tipMixContainer)).map(([n,w]) => `${n}:${w}`).join(",") || "none"
      : tipStyleSelect.value,
    ...(tipStyleSelect.value !== "mix" && parseFloat(tipBaseSlider.value) !== (TIP_BASE_DEFAULTS[tipStyleSelect.value] || 0) ? { tb: tipBaseSlider.value } : {}),
    is: islandStyleSelect.value === "mix"
      ? Object.entries(getMixWeights(islandMixContainer)).map(([n,w]) => `${n}:${w}`).join(",") || "none"
      : islandStyleSelect.value,
    rj: jiggleSlider.value,
    wf: wobbleFreqSlider.value, wo: wobbleOctavesSlider.value, ws: wobbleScaleSlider.value,
    fns: finderSplitCheckbox.checked ? "1" : "0",
    dbg: colorful.checked ? "1" : "0",
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v !== DEFAULTS[k]) params.set(k, v);
  }
  const hash = params.toString();
  history.replaceState(null, "", hash ? "#" + hash : location.pathname);
}

function loadFromUrl() {
  if (!location.hash || location.hash === "#") return;
  const params = new URLSearchParams(location.hash.slice(1));
  const get = (k) => params.get(k);

  if (get("t") != null) textInput.value = get("t");
  if (get("ecc") != null) {
    const r = document.querySelector(`input[name="ecc"][value="${get("ecc")}"]`);
    if (r) r.checked = true;
  }
  if (get("vmin") != null) versionMin.value = get("vmin");
  if (get("vmax") != null) versionMax.value = get("vmax");
  if (get("mask") != null) maskInput.value = get("mask");
  if (get("boost") != null) boostEcc.checked = get("boost") === "1";

  if (get("shape") != null) {
    const r = document.querySelector(`input[name="border-shape"][value="${get("shape")}"]`);
    if (r) r.checked = true;
  }
  cornerRadiusField.style.display =
    document.querySelector('input[name="border-shape"]:checked').value === "square" ? "" : "none";
  if (get("cr") != null) { cornerRadius.value = get("cr"); cornerRadiusValue.textContent = parseFloat(get("cr")).toFixed(2); }
  if (get("snap") != null) snapRadiusCheckbox.checked = get("snap") === "1";
  if (get("ratio") != null) { circleRatio.value = get("ratio"); circleRatioValue.textContent = parseFloat(get("ratio")).toFixed(2); }
  if (get("sw") != null) { strokeWidth.value = get("sw"); strokeWidthValue.textContent = get("sw"); }

  if (get("fg") != null) fgColor.value = "#" + get("fg");
  if (get("fga") != null) { fgAlpha.value = get("fga"); fgAlphaValue.textContent = parseFloat(get("fga")).toFixed(2); }
  if (get("bc") != null) borderColorInput.value = "#" + get("bc");
  if (get("bca") != null) { borderAlpha.value = get("bca"); borderAlphaValue.textContent = parseFloat(get("bca")).toFixed(2); }

  if (get("b2") != null) border2Enabled.checked = get("b2") === "1";
  border2Fields.style.display = border2Enabled.checked ? "" : "none";
  if (get("b2c") != null) border2Color.value = "#" + get("b2c");
  if (get("b2a") != null) { border2Alpha.value = get("b2a"); border2AlphaValue.textContent = parseFloat(get("b2a")).toFixed(2); }
  if (get("b2w") != null) { border2Width.value = get("b2w"); border2WidthValue.textContent = get("b2w"); }
  if (get("b2o") != null) { border2Offset.value = get("b2o"); border2OffsetValue.textContent = get("b2o"); }
  if (get("b2t") != null) border2Trim.checked = get("b2t") === "1";

  if (get("bg") != null) bgColor.value = "#" + get("bg");
  if (get("bga") != null) { bgAlpha.value = get("bga"); bgAlphaValue.textContent = parseFloat(get("bga")).toFixed(2); }
  if (get("bgs") != null) {
    const r = document.querySelector(`input[name="bg-shape"][value="${get("bgs")}"]`);
    if (r) r.checked = true;
  }
  if (get("gap") != null) { gapInput.value = get("gap"); gapValue.textContent = get("gap"); }
  if (get("fgap") != null) { flankGapInput.value = get("fgap"); flankGapValue.textContent = get("fgap"); }
  if (get("shuf") != null) shuffleCheckbox.checked = get("shuf") === "1";
  if (get("ra") != null) randAlignCheckbox.checked = get("ra") === "1";
  if (get("rf") != null) randFluffCheckbox.checked = get("rf") === "1";
  if (get("nf") != null) noFluffCheckbox.checked = get("nf") === "1";
  if (get("obf") != null) obfuscateCheckbox.checked = get("obf") === "1";
  if (get("otl") != null) { obfTl.value = get("otl"); obfTlValue.textContent = get("otl"); }
  if (get("otr") != null) { obfTr.value = get("otr"); obfTrValue.textContent = get("otr"); }
  if (get("obl") != null) { obfBl.value = get("obl"); obfBlValue.textContent = get("obl"); }
  if (get("oal") != null) { obfAlign.value = get("oal"); obfAlignValue.textContent = get("oal"); }
  if (get("oeo") != null) obfDarkOnly.checked = get("oeo") === "1";
  if (get("obd") != null) obfBorder.checked = get("obd") === "1";
  if (get("obt") != null) obfTint.value = get("obt");
  obfuscateFields.style.display = obfuscateCheckbox.checked ? "" : "none";
  if (get("rp") != null) roundedPixelsCheckbox.checked = get("rp") === "1";
  if (get("rpr") != null) { roundedRadius.value = get("rpr"); roundedRadiusValue.textContent = parseFloat(get("rpr")).toFixed(2); }
  if (get("rpri") != null) { roundedInner.value = get("rpri"); roundedInnerValue.textContent = parseFloat(get("rpri")).toFixed(2); }
  if (get("flc") != null) fullLCornersCheckbox.checked = get("flc") === "1";
  if (get("scl") != null) skipCheckerLCornersCheckbox.checked = get("scl") === "1";
  if (get("rm") != null) { const el = document.querySelector(`input[name="renderer"][value="${get("rm")}"]`); if (el) el.checked = true; }
  if (get("cd") != null) { connectDiagonalsSlider.value = get("cd"); connectDiagonalsValue.textContent = cdLabel(get("cd")); }
  if (get("cdo") != null) cdOrderSelect.value = get("cdo");
  if (get("dgo") != null) diagOnlyCheckbox.checked = get("dgo") === "1";
  if (get("ts") != null) {
    const tsVal = get("ts");
    if (tsVal.includes(":")) {
      tipStyleSelect.value = "mix";
      const weights = {};
      for (const part of tsVal.split(",")) {
        const [n, w] = part.split(":");
        weights[n.trim()] = parseFloat(w);
      }
      setMixWeights(tipMixContainer, weights);
      tipMixContainer.style.display = "";
    } else {
      tipStyleSelect.value = tsVal;
      tipMixContainer.style.display = "none";
    }
  }
  { const tb = get("tb") != null ? get("tb") : String(TIP_BASE_DEFAULTS[tipStyleSelect.value] || 0); tipBaseSlider.value = tb; tipBaseValue.textContent = tb; }
  if (get("is") != null) {
    const isVal = get("is");
    if (isVal.includes(":")) {
      islandStyleSelect.value = "mix";
      const weights = {};
      for (const part of isVal.split(",")) {
        const [n, w] = part.split(":");
        weights[n.trim()] = parseFloat(w);
      }
      setMixWeights(islandMixContainer, weights);
      islandMixContainer.style.display = "";
    } else {
      islandStyleSelect.value = isVal;
      islandMixContainer.style.display = "none";
    }
  }
  if (get("rj") != null) { jiggleSlider.value = get("rj"); jiggleValue.textContent = get("rj"); }
  if (get("wf") != null) { wobbleFreqSlider.value = get("wf"); wobbleFreqValue.textContent = get("wf"); }
  if (get("wo") != null) { wobbleOctavesSlider.value = get("wo"); wobbleOctavesValue.textContent = get("wo"); }
  if (get("ws") != null) { wobbleScaleSlider.value = get("ws"); wobbleScaleValue.textContent = get("ws"); }
  if (get("fns") != null) finderSplitCheckbox.checked = get("fns") === "1";
  roundedPixelsFields.style.display = roundedPixelsCheckbox.checked ? "" : "none";
  skipCheckerLCornersRow.style.display = fullLCornersCheckbox.checked ? "" : "none";
  if (get("dbg") != null) colorful.checked = get("dbg") === "1";
  document.getElementById("step-controls").style.display = colorful.checked ? "flex" : "none";
}

// --- Redraw ---

function redraw() {
  const svgText = uploadedSvg || generateQrSvg();
  if (!svgText) {
    previewSvg.innerHTML = "";
    currentOutputSvg = null;
    return;
  }
  currentSvgSource = svgText;

  if (uploadedSvg) {
    const { qrSize } = parseQr(svgText);
    const version = (qrSize - 17) / 4;
    statsEl.textContent = `Uploaded: version ${version}, ${qrSize}x${qrSize}`;
  }

  const options = {
    colorful: colorful.checked,
    circleRatio: parseFloat(circleRatio.value),
    strokeWidth: parseFloat(strokeWidth.value),
    bgColor: colorWithAlpha(bgColor.value, parseFloat(bgAlpha.value)),
    bgShape: document.querySelector('input[name="bg-shape"]:checked').value,
    fgColor: colorWithAlpha(fgColor.value, parseFloat(fgAlpha.value)),
    borderColor: colorWithAlpha(borderColorInput.value, parseFloat(borderAlpha.value)),
    borderShape: document.querySelector('input[name="border-shape"]:checked').value,
    cornerRadius: parseFloat(cornerRadius.value),
    border2Color: border2Enabled.checked ? colorWithAlpha(border2Color.value, parseFloat(border2Alpha.value)) : null,
    border2Width: parseFloat(border2Width.value),
    border2Offset: parseFloat(border2Offset.value),
    border2Trim: border2Trim.checked,
    snapRadius: snapRadiusCheckbox.checked,
    shuffle: shuffleCheckbox.checked,
    gap: parseInt(gapInput.value),
    flankGap: parseInt(flankGapInput.value),
    randAlign: randAlignCheckbox.checked,
    randFluff: randFluffCheckbox.checked,
    obfuscate: obfuscateCheckbox.checked ? {
      amounts: [parseFloat(obfTl.value), parseFloat(obfTr.value), parseFloat(obfBl.value), parseFloat(obfAlign.value)],
      darkOnly: obfDarkOnly.checked,
    } : null,
    roundedPixels: roundedPixelsCheckbox.checked ? parseFloat(roundedRadius.value) : 0,
    roundedInner: roundedPixelsCheckbox.checked ? parseFloat(roundedInner.value) : 0,
    connectDiagonals: parseFloat(connectDiagonalsSlider.value),
    connectDiagonalsOrder: cdOrderSelect.value,
    diagOnly: diagOnlyCheckbox.checked,
    tipStyle: tipStyleSelect.value === "mix" ? getMixWeights(tipMixContainer) : tipStyleSelect.value,
    tipBase: tipStyleSelect.value === "mix" ? null : parseFloat(tipBaseSlider.value),
    islandStyle: islandStyleSelect.value === "mix" ? getMixWeights(islandMixContainer) : islandStyleSelect.value,
    jiggle: parseFloat(jiggleSlider.value),
    fullLCorners: fullLCornersCheckbox.checked,
    skipCheckerLCorners: skipCheckerLCornersCheckbox.checked,
    contourMode: getRenderer() === "contour",
    cleanPathMode: getRenderer() === "clean-path",
    wobbleFreq: parseFloat(wobbleFreqSlider.value),
    wobbleOctaves: parseInt(wobbleOctavesSlider.value),
    wobbleScale: parseFloat(wobbleScaleSlider.value),
    noFluff: noFluffCheckbox.checked,
    finderSplit: finderSplitCheckbox.checked,
  };
  // Build sparse repro options (omit values matching generate()'s defaults)
  const effectiveDefaults = {
    ...GENERATE_DEFAULTS,
    tipBase: typeof options.tipStyle === "string" ? (TIP_BASE_DEFAULTS[options.tipStyle] || 0) : null,
  };
  const reproOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (v !== null && typeof v === "object") {
      if (Object.values(v).some(w => w > 0)) reproOptions[k] = v;
      continue;
    }
    if (v !== effectiveDefaults[k]) reproOptions[k] = v;
  }
  // Embed custom profile definitions referenced by tipStyle/islandStyle
  function collectCustomRefs(styleVal, builtins, allCustoms) {
    const refs = {};
    const names = typeof styleVal === "string" ? [styleVal] : Object.keys(styleVal || {});
    for (const n of names) {
      if (!builtins.has(n) && allCustoms[n]) refs[n] = allCustoms[n];
    }
    return Object.keys(refs).length ? refs : undefined;
  }
  const reproCustomTips = collectCustomRefs(options.tipStyle, BUILTIN_TIP_NAMES, customTipProfiles);
  const reproCustomIslands = collectCustomRefs(options.islandStyle, BUILTIN_ISLAND_NAMES, customIslandProfiles);
  if (reproCustomTips) reproOptions.customTipProfiles = reproCustomTips;
  if (reproCustomIslands) reproOptions.customIslandProfiles = reproCustomIslands;

  window._lastGenerateInputs = { svgText, options: reproOptions };
  const result = generate(svgText, options);

  currentOutputSvg = result;
  previewSvg.innerHTML = result;
  updateStepMax();
  setupSolverOverlay();
  saveToUrl();
}

// --- Event listeners ---

// QR options
textInput.addEventListener("input", () => { uploadedSvg = null; fileInput.value = ""; redraw(); });
eccRadios.forEach(r => r.addEventListener("change", () => { uploadedSvg = null; fileInput.value = ""; redraw(); }));
versionMin.addEventListener("input", () => { uploadedSvg = null; fileInput.value = ""; redraw(); });
versionMax.addEventListener("input", () => { uploadedSvg = null; fileInput.value = ""; redraw(); });
maskInput.addEventListener("input", () => { uploadedSvg = null; fileInput.value = ""; redraw(); });
boostEcc.addEventListener("change", () => { uploadedSvg = null; fileInput.value = ""; redraw(); });

// File upload
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadedSvg = reader.result;
    redraw();
  };
  reader.readAsText(file);
});

// Border options
borderShapeRadios.forEach(r => r.addEventListener("change", () => {
  cornerRadiusField.style.display =
    document.querySelector('input[name="border-shape"]:checked').value === "square" ? "" : "none";
  redraw();
}));
cornerRadius.addEventListener("input", () => {
  cornerRadiusValue.textContent = parseFloat(cornerRadius.value).toFixed(2);
  redraw();
});
snapRadiusCheckbox.addEventListener("change", redraw);
circleRatio.addEventListener("input", () => {
  circleRatioValue.textContent = parseFloat(circleRatio.value).toFixed(2);
  redraw();
});
strokeWidth.addEventListener("input", () => {
  strokeWidthValue.textContent = parseFloat(strokeWidth.value).toFixed(strokeWidth.value % 1 ? 2 : 0);
  redraw();
});
fgColor.addEventListener("input", redraw);
fgAlpha.addEventListener("input", () => {
  fgAlphaValue.textContent = parseFloat(fgAlpha.value).toFixed(2);
  redraw();
});
borderColorInput.addEventListener("input", redraw);
borderAlpha.addEventListener("input", () => {
  borderAlphaValue.textContent = parseFloat(borderAlpha.value).toFixed(2);
  redraw();
});
border2Enabled.addEventListener("change", () => {
  border2Fields.style.display = border2Enabled.checked ? "" : "none";
  redraw();
});
border2Color.addEventListener("input", redraw);
border2Alpha.addEventListener("input", () => {
  border2AlphaValue.textContent = parseFloat(border2Alpha.value).toFixed(2);
  redraw();
});
border2Width.addEventListener("input", () => {
  border2WidthValue.textContent = parseFloat(border2Width.value).toFixed(border2Width.value % 1 ? 2 : 0);
  redraw();
});
border2Offset.addEventListener("input", () => {
  border2OffsetValue.textContent = parseFloat(border2Offset.value).toFixed(border2Offset.value % 1 ? 2 : 0);
  redraw();
});
border2Trim.addEventListener("change", redraw);
bgColor.addEventListener("input", redraw);
bgAlpha.addEventListener("input", () => {
  bgAlphaValue.textContent = parseFloat(bgAlpha.value).toFixed(2);
  redraw();
});
bgShapeRadios.forEach(r => r.addEventListener("change", redraw));
gapInput.addEventListener("input", () => {
  gapValue.textContent = gapInput.value;
  redraw();
});
flankGapInput.addEventListener("input", () => {
  flankGapValue.textContent = flankGapInput.value;
  redraw();
});
shuffleCheckbox.addEventListener("change", redraw);
randAlignCheckbox.addEventListener("change", redraw);
randFluffCheckbox.addEventListener("change", redraw);
noFluffCheckbox.addEventListener("change", redraw);
obfuscateCheckbox.addEventListener("change", () => {
  obfuscateFields.style.display = obfuscateCheckbox.checked ? "" : "none";
  redraw();
});
for (const el of [obfTl, obfTr, obfBl, obfAlign]) {
  const valSpan = document.getElementById(el.id + "-value");
  el.addEventListener("input", () => {
    valSpan.textContent = parseFloat(el.value).toFixed(2);
    redraw();
  });
}
obfDarkOnly.addEventListener("change", redraw);
obfBorder.addEventListener("change", () => { setupSolverOverlay(); saveToUrl(); });
obfTint.addEventListener("input", () => { setupSolverOverlay(); saveToUrl(); });
roundedPixelsCheckbox.addEventListener("change", () => {
  roundedPixelsFields.style.display = roundedPixelsCheckbox.checked ? "" : "none";
  redraw();
});
roundedRadius.addEventListener("input", () => {
  roundedRadiusValue.textContent = parseFloat(roundedRadius.value).toFixed(2);
  redraw();
});
roundedInner.addEventListener("input", () => {
  roundedInnerValue.textContent = parseFloat(roundedInner.value).toFixed(2);
  redraw();
});
connectDiagonalsSlider.addEventListener("input", () => {
  connectDiagonalsValue.textContent = cdLabel(connectDiagonalsSlider.value);
  redraw();
});
cdOrderSelect.addEventListener("change", redraw);
diagOnlyCheckbox.addEventListener("change", () => redraw());
finderSplitCheckbox.addEventListener("change", redraw);

function labelForStyle(name) {
  if (name === "none") return "None";
  if (name === "mix") return "Mix";
  return name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
}

// Build per-style weight sliders into a container div
function buildMixSliders(profiles, container) {
  container.innerHTML = "";
  for (const name of Object.keys(profiles)) {
    const row = document.createElement("div");
    row.className = "field";
    row.style.marginLeft = "12px";
    const label = document.createElement("label");
    label.style.fontSize = "12px";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = labelForStyle(name);
    const valSpan = document.createElement("span");
    valSpan.className = "range-value";
    valSpan.textContent = "0";
    valSpan.dataset.mixName = name;
    label.appendChild(nameSpan);
    label.appendChild(valSpan);
    const fr = document.createElement("div");
    fr.className = "field-row";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0"; input.max = "1"; input.step = "0.01"; input.value = "0";
    input.dataset.mixName = name;
    input.addEventListener("input", () => {
      valSpan.textContent = parseFloat(input.value).toFixed(2);
      redraw();
    });
    fr.appendChild(input);
    fr.appendChild(valSpan);
    row.appendChild(label);
    row.appendChild(fr);
    container.appendChild(row);
  }
}

// Read weights from a mix slider container → { name: weight, ... }
function getMixWeights(container) {
  const obj = {};
  for (const input of container.querySelectorAll("input[type=range]")) {
    const w = parseFloat(input.value);
    if (w > 0) obj[input.dataset.mixName] = w;
  }
  return obj;
}

// Set mix slider values from a weights object
function setMixWeights(container, weights) {
  for (const input of container.querySelectorAll("input[type=range]")) {
    const w = weights[input.dataset.mixName] || 0;
    input.value = String(w);
    const valSpan = container.querySelector(`span[data-mix-name="${input.dataset.mixName}"]`);
    if (valSpan) valSpan.textContent = w.toFixed(2);
  }
}

function addSelectOption(select, name, selected) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = labelForStyle(name);
  if (selected) opt.selected = true;
  select.appendChild(opt);
}

function buildStyleOptions(selected = "none") {
  tipStyleSelect.innerHTML = "";
  addSelectOption(tipStyleSelect, "none", "none" === selected);
  for (const name of Object.keys(TIP_PROFILES)) {
    addSelectOption(tipStyleSelect, name, name === selected);
  }
  addSelectOption(tipStyleSelect, "mix", "mix" === selected);
}

buildStyleOptions();
buildMixSliders(TIP_PROFILES, tipMixContainer);

// Island style dropdown
function buildIslandOptions(selected = "none") {
  islandStyleSelect.innerHTML = "";
  addSelectOption(islandStyleSelect, "none", "none" === selected);
  for (const name of Object.keys(ISLAND_PROFILES)) {
    addSelectOption(islandStyleSelect, name, name === selected);
  }
  addSelectOption(islandStyleSelect, "mix", "mix" === selected);
}
buildIslandOptions();
buildMixSliders(ISLAND_PROFILES, islandMixContainer);

islandStyleSelect.addEventListener("change", () => {
  islandMixContainer.style.display = islandStyleSelect.value === "mix" ? "" : "none";
  redraw();
});

tipStyleSelect.addEventListener("change", () => {
  tipMixContainer.style.display = tipStyleSelect.value === "mix" ? "" : "none";
  if (tipStyleSelect.value !== "mix") {
    const def = TIP_BASE_DEFAULTS[tipStyleSelect.value] || 0;
    tipBaseSlider.value = String(def);
    tipBaseValue.textContent = String(def);
  }
  redraw();
});
tipBaseSlider.addEventListener("input", () => {
  tipBaseValue.textContent = tipBaseSlider.value;
  redraw();
});

// Reload custom profiles when saved in another tab (e.g. tip/island editor)
window.addEventListener("storage", (e) => {
  if (e.key === "qr-custom-tip-profiles") {
    // Remove old custom entries, reload fresh
    for (const k of Object.keys(TIP_PROFILES)) {
      if (!BUILTIN_TIP_NAMES.has(k)) delete TIP_PROFILES[k];
    }
    Object.assign(TIP_PROFILES, loadCustomProfiles("qr-custom-tip-profiles"));
    buildStyleOptions(tipStyleSelect.value);
    const tipWeights = getMixWeights(tipMixContainer);
    buildMixSliders(TIP_PROFILES, tipMixContainer);
    setMixWeights(tipMixContainer, tipWeights);
    redraw();
  }
  if (e.key === "qr-custom-island-profiles") {
    for (const k of Object.keys(ISLAND_PROFILES)) {
      if (!BUILTIN_ISLAND_NAMES.has(k)) delete ISLAND_PROFILES[k];
    }
    Object.assign(ISLAND_PROFILES, loadCustomProfiles("qr-custom-island-profiles"));
    buildIslandOptions(islandStyleSelect.value);
    const islandWeights = getMixWeights(islandMixContainer);
    buildMixSliders(ISLAND_PROFILES, islandMixContainer);
    setMixWeights(islandMixContainer, islandWeights);
    redraw();
  }
});

fullLCornersCheckbox.addEventListener("change", () => {
  skipCheckerLCornersRow.style.display = fullLCornersCheckbox.checked ? "" : "none";
  redraw();
});
skipCheckerLCornersCheckbox.addEventListener("change", () => redraw());
document.querySelectorAll('input[name="renderer"]').forEach(r => r.addEventListener("change", () => redraw()));
jiggleSlider.addEventListener("input", () => {
  jiggleValue.textContent = jiggleSlider.value;
  redraw();
});
wobbleFreqSlider.addEventListener("input", () => {
  wobbleFreqValue.textContent = wobbleFreqSlider.value;
  redraw();
});
wobbleOctavesSlider.addEventListener("input", () => {
  wobbleOctavesValue.textContent = wobbleOctavesSlider.value;
  redraw();
});
wobbleScaleSlider.addEventListener("input", () => {
  wobbleScaleValue.textContent = wobbleScaleSlider.value;
  redraw();
});
const stepControls = document.getElementById("step-controls");
colorful.addEventListener("change", () => {
  stepControls.style.display = colorful.checked ? "flex" : "none";
  if (!colorful.checked) {
    stepSlider.value = stepSlider.max;
    applyStepFilter();
  }
  redraw();
});

// Download
downloadBtn.addEventListener("click", () => {
  if (!currentOutputSvg) return;
  const blob = new Blob([currentOutputSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "qr-code-border.svg";
  a.click();
  URL.revokeObjectURL(url);
});

// --- Repro JSON submenu ---
const reproBtn = document.getElementById("repro-btn");
const reproMenu = document.getElementById("repro-menu");
const reproCopy = document.getElementById("repro-copy");
const reproDownload = document.getElementById("repro-download");
const reproOpen = document.getElementById("repro-open");
const reproFileInput = document.getElementById("repro-file-input");
const reproPasteInput = reproMenu.querySelector(".repro-paste-input");

function flashReproBtn(msg) {
  reproBtn.textContent = msg;
  setTimeout(() => { reproBtn.textContent = "Repro JSON"; }, 2000);
}

function getReproJson() {
  if (!window._lastGenerateInputs) return null;
  const obj = { ...window._lastGenerateInputs, hash: location.hash };
  return JSON.stringify(obj, null, 2);
}

function loadReproJson(jsonStr) {
  try {
    const fixture = JSON.parse(jsonStr);
    const { svgText, options, hash } = fixture;
    if (!svgText || !options) throw new Error("Missing svgText or options");

    // Save custom profiles to localStorage
    if (options.customTipProfiles) {
      const existing = loadCustomProfiles("qr-custom-tip-profiles");
      Object.assign(existing, options.customTipProfiles);
      localStorage.setItem("qr-custom-tip-profiles", JSON.stringify(existing));
    }
    if (options.customIslandProfiles) {
      const existing = loadCustomProfiles("qr-custom-island-profiles");
      Object.assign(existing, options.customIslandProfiles);
      localStorage.setItem("qr-custom-island-profiles", JSON.stringify(existing));
    }

    // Store SVG in sessionStorage for reload
    sessionStorage.setItem("qr-repro-svg", svgText);

    // Set URL hash from repro and reload
    if (hash) {
      location.hash = hash.startsWith("#") ? hash.slice(1) : hash;
    }
    location.reload();
  } catch (e) {
    flashReproBtn("Invalid JSON");
  }
}

// Toggle menu on click (for touch devices)
reproBtn.addEventListener("click", () => {
  reproMenu.classList.toggle("open");
});
// Close menu when clicking outside
document.addEventListener("click", (e) => {
  if (!reproMenu.contains(e.target)) reproMenu.classList.remove("open");
});

reproCopy.addEventListener("click", async () => {
  const json = getReproJson();
  if (!json) return;
  try {
    await navigator.clipboard.writeText(json);
    flashReproBtn("Copied!");
  } catch {
    flashReproBtn("Copy failed");
  }
  reproMenu.classList.remove("open");
});

reproDownload.addEventListener("click", () => {
  const json = getReproJson();
  if (!json) return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "repro.json";
  a.click();
  URL.revokeObjectURL(url);
  flashReproBtn("Downloaded!");
  reproMenu.classList.remove("open");
});

reproOpen.addEventListener("click", () => {
  reproFileInput.click();
});
reproFileInput.addEventListener("change", () => {
  const file = reproFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadReproJson(reader.result);
  reader.readAsText(file);
});

reproPasteInput.addEventListener("input", () => {
  const value = reproPasteInput.value;
  if (!value.includes('"svgText"')) return;
  reproPasteInput.value = "";
  reproPasteInput.blur();
  loadReproJson(value);
});

// --- Step animation ---

let stepTimer = null;
const STEP_NAMES = ["QR code", "Reflections", "Flanking 1", "Flanking 2", "Flanking 3", "Flanking 4"];

function applyStepFilter() {
  const svg = previewSvg.querySelector("svg");
  if (!svg) return;
  const max = parseInt(stepSlider.value);
  const maxStep = parseInt(stepSlider.max);
  svg.querySelectorAll("[data-step]").forEach(el => {
    const s = parseInt(el.dataset.step);
    el.style.display = s <= max ? "" : "none";
  });
  stepLabel.textContent = max >= maxStep ? "All" : (STEP_NAMES[max] || `Step ${max}`);
}

function updateStepMax() {
  const svg = previewSvg.querySelector("svg");
  if (!svg) return;
  let maxStep = 0;
  svg.querySelectorAll("[data-step]").forEach(el => {
    maxStep = Math.max(maxStep, parseInt(el.dataset.step));
  });
  stepSlider.max = maxStep;
  if (!colorful.checked || parseInt(stepSlider.value) > maxStep) stepSlider.value = maxStep;
  applyStepFilter();
}

stepSlider.addEventListener("input", () => {
  if (stepTimer) { clearInterval(stepTimer); stepTimer = null; stepPlayBtn.textContent = "\u25B6"; }
  applyStepFilter();
});

stepPlayBtn.addEventListener("click", () => {
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = null;
    stepPlayBtn.textContent = "\u25B6";
    return;
  }
  stepSlider.value = 0;
  applyStepFilter();
  stepPlayBtn.textContent = "\u23F8";
  stepTimer = setInterval(() => {
    const next = parseInt(stepSlider.value) + 1;
    if (next > parseInt(stepSlider.max)) {
      clearInterval(stepTimer);
      stepTimer = null;
      stepPlayBtn.textContent = "\u25B6";
      return;
    }
    stepSlider.value = next;
    applyStepFilter();
  }, 800);
});

// --- Solver overlay ---

const isFinderDark = (x, y) =>
  y === 0 || y === 6 || x === 0 || x === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
const isAlignDark = (dx, dy) =>
  Math.abs(dx) === 2 || Math.abs(dy) === 2 || (dx === 0 && dy === 0);

function setupSolverOverlay() {
  const svg = previewSvg.querySelector("svg");
  if (!svg || !currentSvgSource) return;
  const existing = svg.querySelector("#solver-overlay");
  if (existing) existing.remove();
  const existingFilter = svg.querySelector("#solver-shadow");
  if (existingFilter) existingFilter.remove();
  const existingFilter2 = svg.querySelector("#solver-shadow-plastic");
  if (existingFilter2) existingFilter2.remove();
  if (!obfuscateCheckbox.checked) return;

  const amounts = [parseFloat(obfTl.value), parseFloat(obfTr.value), parseFloat(obfBl.value), parseFloat(obfAlign.value)];
  if (!amounts.some(a => a > 0)) return;

  const { qrSize } = parseQr(currentSvgSource);
  const darkOnly = obfDarkOnly.checked;
  const fgCol = colorWithAlpha(fgColor.value, parseFloat(fgAlpha.value));
  const bgCol = colorWithAlpha(bgColor.value, parseFloat(bgAlpha.value));

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.id = "solver-overlay";
  g.style.pointerEvents = "none";
  g.style.display = "none";
  g.dataset.qrSize = qrSize;

  // Simulate clear plastic: blue tint, 1px border + 20px bottom handle, drop shadow
  const pad = 1, handle = 20;
  const pW = qrSize + pad * 2, pH = qrSize + pad + handle;

  // Drop shadow filter
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.id = "solver-shadow";
  filter.setAttribute("x", "-20%"); filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%"); filter.setAttribute("height", "140%");
  const feOff = document.createElementNS("http://www.w3.org/2000/svg", "feOffset");
  feOff.setAttribute("in", "SourceAlpha"); feOff.setAttribute("dx", "0.1"); feOff.setAttribute("dy", "1");
  const feBlur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "1.5");
  const feFlood = document.createElementNS("http://www.w3.org/2000/svg", "feFlood");
  feFlood.setAttribute("flood-color", "rgba(0,0,0,0.3)");
  const feComp = document.createElementNS("http://www.w3.org/2000/svg", "feComposite");
  feComp.setAttribute("in2", ""); feComp.setAttribute("operator", "in");
  const feMerge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
  const feMN1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  const feMN2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  feMN2.setAttribute("in", "SourceGraphic");
  filter.append(feOff, feBlur, feFlood, feComp, feMerge);
  feMerge.append(feMN1, feMN2);
  // Chain: SourceAlpha → offset → blur (result1), flood → composite in result1 → merge with SourceGraphic
  feOff.setAttribute("result", "off"); feBlur.setAttribute("in", "off"); feBlur.setAttribute("result", "blur");
  feFlood.setAttribute("result", "color"); feComp.setAttribute("in", "color"); feComp.setAttribute("in2", "blur");
  // Subtle shadow filter for the transparent plastic area
  const filter2 = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter2.id = "solver-shadow-plastic";
  filter2.setAttribute("x", "-20%"); filter2.setAttribute("y", "-20%");
  filter2.setAttribute("width", "140%"); filter2.setAttribute("height", "140%");
  const feOff2 = document.createElementNS("http://www.w3.org/2000/svg", "feOffset");
  feOff2.setAttribute("in", "SourceAlpha"); feOff2.setAttribute("dx", "0.1"); feOff2.setAttribute("dy", "0.5");
  const feBlur2 = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  feBlur2.setAttribute("stdDeviation", "0.8");
  const feFlood2 = document.createElementNS("http://www.w3.org/2000/svg", "feFlood");
  feFlood2.setAttribute("flood-color", "rgba(0,0,0,0.1)");
  const feComp2 = document.createElementNS("http://www.w3.org/2000/svg", "feComposite");
  feComp2.setAttribute("operator", "in");
  const feMerge2 = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
  const feMN2a = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  filter2.append(feOff2, feBlur2, feFlood2, feComp2, feMerge2);
  feMerge2.append(feMN2a);
  feOff2.setAttribute("result", "off2"); feBlur2.setAttribute("in", "off2"); feBlur2.setAttribute("result", "blur2");
  feFlood2.setAttribute("result", "color2"); feComp2.setAttribute("in", "color2"); feComp2.setAttribute("in2", "blur2");

  const defs = svg.querySelector("defs") || svg.insertBefore(document.createElementNS("http://www.w3.org/2000/svg", "defs"), svg.firstChild);
  defs.appendChild(filter);
  defs.appendChild(filter2);

  // Visual tint rect (no filter)
  const plastic = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  plastic.setAttribute("x", -pad); plastic.setAttribute("y", -pad);
  plastic.setAttribute("width", pW); plastic.setAttribute("height", pH);
  plastic.setAttribute("fill", obfTint.value);
  g.appendChild(plastic);

  // Edge-only frame for plastic shadow (filter outputs shadow only, no SourceGraphic)
  const plasticG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  plasticG.setAttribute("filter", "url(#solver-shadow-plastic)");
  const edgeW = 0.5;
  const ox = -pad, oy = -pad;
  const outerEdge = `M${ox},${oy}h${pW}v${pH}h${-pW}z`;
  const innerEdge = `M${ox + edgeW},${oy + edgeW}h${pW - edgeW * 2}v${pH - edgeW * 2}h${-(pW - edgeW * 2)}z`;
  const edgePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  edgePath.setAttribute("d", `${outerEdge} ${innerEdge}`);
  edgePath.setAttribute("fill", "#000");
  edgePath.setAttribute("fill-rule", "evenodd");
  plasticG.appendChild(edgePath);
  g.appendChild(plasticG);

  // Solid elements group with stronger shadow
  const solidG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  solidG.setAttribute("filter", "url(#solver-shadow)");

  // Optional white border matching the gap around the QR code
  if (obfBorder.checked) {
    const gapW = parseInt(gapInput.value) || 1;
    const border = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const outer = `M${-gapW},${-gapW}h${qrSize + gapW * 2}v${qrSize + gapW * 2}h${-(qrSize + gapW * 2)}z`;
    const inner = `M0,0h${qrSize}v${qrSize}h${-qrSize}z`;
    border.setAttribute("d", `${outer} ${inner}`);
    border.setAttribute("fill", bgCol);
    border.setAttribute("fill-rule", "evenodd");
    solidG.appendChild(border);
  }

  // Finder pattern positions (7x7 dark pattern, 8x8 zone with separator)
  const finderOffsets = [[0, 0], [qrSize - 7, 0], [0, qrSize - 7]];
  const finderZoneOffsets = [[0, 0], [qrSize - 8, 0], [0, qrSize - 8]];

  // Background rects when not dark-only (cover the full randomized zones)
  if (!darkOnly) {
    for (let i = 0; i < 3; i++) {
      if (amounts[i] <= 0) continue;
      const [zx, zy] = finderZoneOffsets[i];
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", zx); bg.setAttribute("y", zy);
      bg.setAttribute("width", "8"); bg.setAttribute("height", "8");
      bg.setAttribute("fill", bgCol);
      solidG.appendChild(bg);
    }
    if (amounts[3] > 0) {
      const version = (qrSize - 17) / 4;
      const positions = getAlignmentPositions(version);
      const last = qrSize - 7;
      for (const row of positions)
        for (const col of positions) {
          if (row === 6 && col === 6) continue;
          if (row === 6 && col === last) continue;
          if (row === last && col === 6) continue;
          const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          bg.setAttribute("x", col - 2); bg.setAttribute("y", row - 2);
          bg.setAttribute("width", "5"); bg.setAttribute("height", "5");
          bg.setAttribute("fill", bgCol);
          solidG.appendChild(bg);
        }
    }
  }

  // Dark pixel path for all active patterns
  const parts = [];
  for (let i = 0; i < 3; i++) {
    if (amounts[i] <= 0) continue;
    const [fx, fy] = finderOffsets[i];
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++)
        if (isFinderDark(x, y))
          parts.push(`M${fx + x},${fy + y}h1v1h-1z`);
  }
  if (amounts[3] > 0) {
    const version = (qrSize - 17) / 4;
    const positions = getAlignmentPositions(version);
    const last = qrSize - 7;
    for (const row of positions)
      for (const col of positions) {
        if (row === 6 && col === 6) continue;
        if (row === 6 && col === last) continue;
        if (row === last && col === 6) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (isAlignDark(dx, dy))
              parts.push(`M${col + dx},${row + dy}h1v1h-1z`);
      }
  }
  if (parts.length > 0) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", parts.join(" "));
    path.setAttribute("fill", fgCol);
    solidG.appendChild(path);
  }

  g.appendChild(solidG);
  svg.appendChild(g);
}

previewSvg.addEventListener("mouseenter", () => {
  const overlay = previewSvg.querySelector("#solver-overlay");
  if (!overlay) return;
  overlay.style.display = "";
  previewSvg.style.cursor = "none";
});

previewSvg.addEventListener("mouseleave", () => {
  const overlay = previewSvg.querySelector("#solver-overlay");
  if (overlay) overlay.style.display = "none";
  previewSvg.style.cursor = "";
});

previewSvg.addEventListener("mousemove", (e) => {
  const svg = previewSvg.querySelector("svg");
  const overlay = svg?.querySelector("#solver-overlay");
  if (!overlay || overlay.style.display === "none") return;
  const qrSize = parseInt(overlay.dataset.qrSize);
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
  // Center the full QR-sized overlay on cursor
  overlay.setAttribute("transform", `translate(${svgPt.x - qrSize / 2}, ${svgPt.y - qrSize / 2})`);
});

// --- Init ---
loadFromUrl();
redraw();
