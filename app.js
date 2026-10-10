/* Discord ASCII generator — client-side only.
 * Pipeline: image -> canvas (W x H with char-aspect correction) -> luminance
 * -> brightness/contrast -> Floyd-Steinberg dithering (optional) -> charset map
 * -> mono text OR ANSI-colored text. Width auto-capped so final Discord
 * message (incl. fences + ANSI escapes) is <= 2000 chars.
 */
"use strict";

const DISCORD_LIMIT = 2000;

const RAMP_DETAILED = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";
const RAMP_STANDARD = "@%#*+=-:. ";
const RAMP_BLOCKS = "█▓▒░ ";
const RAMP_MINIMAL = ":+-. ";

const $ = (id) => document.getElementById(id);
const els = {
  drop: $("dropzone"), file: $("fileInput"), browse: $("browseBtn"), sample: $("sampleBtn"),
  thumbRow: $("thumbRow"), thumb: $("thumb"), imgInfo: $("imgInfo"), clear: $("clearBtn"),
  width: $("widthSlider"), widthVal: $("widthVal"), heightVal: $("heightVal"),
  maxFit: $("maxFitBtn"), aspect: $("aspectSlider"), aspectVal: $("aspectVal"),
  charset: $("charsetSel"), color: $("colorSel"), bright: $("brightSlider"), brightVal: $("brightVal"),
  contrast: $("contrastSlider"), contrastVal: $("contrastVal"),
  dither: $("ditherChk"), invert: $("invertChk"), bg: $("bgSel"),
  preview: $("preview"), wrap: $("wrapChk"), canvas: $("work"),
  count: $("charCount"), fitMsg: $("fitMsg"), meter: $("meterFill"),
  copyDiscord: $("copyDiscordBtn"), copyRaw: $("copyRawBtn"), download: $("downloadBtn"),
  status: $("status"),
};

// Approx RGB values for Discord's ANSI colors (dark theme).
const ANSI_TABLE = [
  { code: "30",    css: "#4f545c", rgb: [79, 84, 92] },
  { code: "31",    css: "#dc322f", rgb: [220, 50, 47] },
  { code: "32",    css: "#0dbc79", rgb: [13, 188, 121] },
  { code: "33",    css: "#e5e510", rgb: [229, 229, 16] },
  { code: "34",    css: "#2472c8", rgb: [36, 114, 200] },
  { code: "35",    css: "#bc3fbc", rgb: [188, 63, 188] },
  { code: "36",    css: "#11a8cd", rgb: [17, 168, 205] },
  { code: "37",    css: "#e5e5e5", rgb: [229, 229, 229] },
  { code: "1;30",  css: "#666666", rgb: [102, 102, 102] },
  { code: "1;31",  css: "#f17676", rgb: [241, 118, 118] },
  { code: "1;32",  css: "#23d18b", rgb: [35, 209, 139] },
  { code: "1;33",  css: "#f5f567", rgb: [245, 245, 103] },
  { code: "1;34",  css: "#3b8eea", rgb: [59, 142, 234] },
  { code: "1;35",  css: "#d670d6", rgb: [214, 112, 214] },
  { code: "1;36",  css: "#29b8db", rgb: [41, 184, 219] },
  { code: "1;37",  css: "#ffffff", rgb: [255, 255, 255] },
];
const ANSI_CSS = Object.fromEntries(ANSI_TABLE.map((c) => [c.code, c.css]));
const ESC = "\u001b[";

let srcImg = null;          // HTMLImageElement
let lastMono = "";          // last generated art without fences
let lastAnsi = "";          // last generated art body (with escapes) when in ansi mode
let lastIsAnsi = false;
let lastW = 0, lastH = 0;
let regenTimer = 0;

function ramp() {
  switch (els.charset.value) {
    case "standard": return RAMP_STANDARD;
    case "blocks": return RAMP_BLOCKS;
    case "minimal": return RAMP_MINIMAL;
    default: return RAMP_DETAILED;
  }
}

function fenceLen() { return lastIsAnsi ? "```ansi\n".length + "\n```".length : "```\n".length + "\n```".length; }

// ---------- image loading ----------
function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) { status("Not an image file."); return; }
  const url = URL.createObjectURL(file);
  loadUrl(url, file.name);
}

function loadUrl(url, name = "") {
  const img = new Image();
  img.onload = () => {
    srcImg = img;
    els.thumb.src = url;
    els.thumbRow.classList.remove("hidden");
    els.imgInfo.textContent = `${name || "image"} · ${img.naturalWidth}×${img.naturalHeight}`;
    status(`Loaded ${img.naturalWidth}×${img.naturalHeight}.`);
    regenerate();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => status("Could not decode that image.");
  img.src = url;
}

function loadSample() {
  // Built-in SVG gradient + shapes demo (no network needed).
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'>`
    + `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>`
    + `<stop offset='0' stop-color='#ff5f6d'/><stop offset='.5' stop-color='#ffc371'/>`
    + `<stop offset='1' stop-color='#4158d0'/></linearGradient>`
    + `<radialGradient id='r' cx='.5' cy='.4' r='.7'><stop offset='0' stop-color='white'/>`
    + `<stop offset='1' stop-color='black'/></radialGradient></defs>`
    + `<rect width='320' height='200' fill='url(#g)'/>`
    + `<circle cx='160' cy='100' r='62' fill='url(#r)'/>`
    + `<rect x='20' y='150' width='280' height='14' rx='7' fill='black' opacity='.55'/>`
    + `<text x='160' y='161' font-size='13' text-anchor='middle' fill='white' font-family='monospace'>DISCORD ASCII</text>`
    + `</svg>`;
  loadUrl("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), "sample.svg");
}

// ---------- core conversion ----------
function targetHeight(w) {
  if (!srcImg) return 0;
  const k = (srcImg.naturalHeight / srcImg.naturalWidth) * parseFloat(els.aspect.value);
  return Math.max(1, Math.round(w * k));
}

function drawToGrid(w, h) {
  const c = els.canvas;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = els.bg.value === "white" ? "#fff" : "#000";
  ctx.fillRect(0, 0, w, h);
  // Stretch the WHOLE image into the grid (no cropping). h already accounts
  // for the image aspect + char aspect, so proportions stay correct.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcImg, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Rec.709 luminance + brightness/contrast. Returns {lum:Float32Array, rgb:Uint8ClampedArray copy}
function luminanceGrid(data, w, h) {
  const b = parseInt(els.bright.value, 10);       // -100..100
  const c = parseInt(els.contrast.value, 10) / 100; // 0..2
  const inv = els.invert.checked;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data.data[i * 4], g = data.data[i * 4 + 1], bl = data.data[i * 4 + 2];
    let v = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255; // 0..1
    v = (v - 0.5) * c + 0.5 + b / 100;
    v = Math.min(1, Math.max(0, v));
    lum[i] = inv ? 1 - v : v;
  }
  return lum;
}

function floydSteinberg(lum, w, h, levels) {
  // Quantize in place with error diffusion (levels = charset length).
  const buf = Float32Array.from(lum);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const q = Math.round(old * (levels - 1)) / (levels - 1);
      buf[i] = q;
      const err = old - q;
      if (x + 1 < w) buf[i + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] += err * 3 / 16;
        buf[i + w] += err * 5 / 16;
        if (x + 1 < w) buf[i + w + 1] += err * 1 / 16;
      }
    }
  }
  return buf;
}

function nearestAnsi(r, g, b) {
  let best = ANSI_TABLE[0], bd = Infinity;
  for (const c of ANSI_TABLE) {
    const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2];
    const d = dr * dr * 0.3 + dg * dg * 0.5 + db * db * 0.2; // weight green (perception)
    if (d < bd) { bd = d; best = c; }
  }
  return best.code;
}

function buildArt(w, h, imgData, lum) {
  const chars = ramp();
  const n = chars.length;
  const ansiMode = els.color.value === "ansi";
  const lines = [];
  let ansiBody = "";
  for (let y = 0; y < h; y++) {
    let line = "";
    let ansiLine = "";
    let cur = null;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const idx = Math.min(n - 1, Math.max(0, Math.round(lum[i] * (n - 1))));
      // Ramps run dark → light ("$" dark … " " light), matching lum 0 → n-1.
      const glyph = chars[idx];
      line += glyph;
      if (ansiMode) {
        const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
        const code = nearestAnsi(r, g, b);
        if (code !== cur) { ansiLine += `${ESC}${code}m`; cur = code; }
        ansiLine += glyph;
      }
    }
    lines.push(line);
    if (ansiMode) ansiBody += ansiLine + `${ESC}0m` + (y < h - 1 ? "\n" : "");
  }
  return { mono: lines.join("\n"), ansiBody, lines };
}

function renderPreview(lines, imgData, w, h, ansiMode) {
  els.preview.innerHTML = "";
  const frame = document.createElement("div");
  frame.className = "msgFrame";
  frame.title = "Exact Discord message bounds";
  if (!ansiMode) {
    frame.textContent = lines.join("\n");
    els.preview.appendChild(frame);
    return;
  }
  const frag = document.createDocumentFragment();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const span = document.createElement("span");
      const code = nearestAnsi(imgData.data[i * 4], imgData.data[i * 4 + 1], imgData.data[i * 4 + 2]);
      span.style.color = ANSI_CSS[code];
      span.textContent = lines[y][x];
      frag.appendChild(span);
    }
    if (y < h - 1) frag.appendChild(document.createTextNode("\n"));
  }
  frame.appendChild(frag);
  els.preview.appendChild(frame);
}

// ---------- Discord cap ----------
function discordWrappedLength(bodyLen, ansiMode) {
  return bodyLen + (ansiMode ? "```ansi\n".length + "\n```".length : "```\n".length + "\n```".length);
}

function regenerate() {
  if (!srcImg) return;
  const ansiMode = els.color.value === "ansi";
  let w = parseInt(els.width.value, 10);

  // Auto-shrink loop: keep total (incl. fences/escapes) <= 2000.
  for (let tries = 0; tries < 40; tries++) {
    const h = targetHeight(w);
    const imgData = drawToGrid(w, h);
    let lum = luminanceGrid(imgData, w, h);
    if (els.dither.checked) lum = floydSteinberg(lum, w, h, ramp().length);
    const { mono, ansiBody, lines } = buildArt(w, h, imgData, lum);
    const body = ansiMode ? ansiBody : mono;
    if (discordWrappedLength(body.length, ansiMode) <= DISCORD_LIMIT) {
      lastMono = mono; lastAnsi = ansiBody; lastIsAnsi = ansiMode; lastW = w; lastH = h;
      renderPreview(lines, imgData, w, h, ansiMode);
      updateStats(body.length, ansiMode, w, h, false);
      return;
    }
    w = Math.max(10, w - Math.max(1, Math.ceil(w * 0.08))); // shrink ~8%
    if (w <= 10) { // give up gracefully: show smallest anyway with warning
      lastMono = mono; lastAnsi = ansiBody; lastIsAnsi = ansiMode; lastW = w; lastH = h;
      renderPreview(lines, imgData, w, h, ansiMode);
      updateStats(body.length, ansiMode, w, h, true);
      return;
    }
  }
}

function maxFittingWidth() {
  if (!srcImg) return parseInt(els.width.value, 10);
  const ansiMode = els.color.value === "ansi";
  // Binary search largest width whose output fits (cheap approx then verify).
  let lo = 10, hi = 220, best = 10;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const h = targetHeight(mid);
    // Rough estimate: mono body = mid*h + (h-1); ansi ~ mono*1.6 + h*12 (empirical)
    const monoLen = mid * h + (h - 1);
    const est = ansiMode ? Math.ceil(monoLen * 1.7 + h * 14) : monoLen;
    if (discordWrappedLength(est, ansiMode) <= DISCORD_LIMIT) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  // Verify downward with a real render-free shrink (regenerate() re-verifies exactly).
  return Math.min(220, Math.max(10, best));
}

function updateStats(bodyLen, ansiMode, w, h, over) {
  const total = discordWrappedLength(bodyLen, ansiMode);
  els.count.textContent = `${total} / 2000${ansiMode ? " (ANSI)" : ""}`;
  els.widthVal.textContent = w;
  els.heightVal.textContent = `× ${h}`;
  els.fitMsg.textContent = over ? "⚠ Still over — try Mono or a smaller width"
    : (w < parseInt(els.width.value, 10) ? `↳ capped ${els.width.value}→${w} to fit` : "✓ fits");
  const pct = Math.min(100, (total / DISCORD_LIMIT) * 100);
  els.meter.style.width = pct + "%";
  els.meter.style.background = total > DISCORD_LIMIT ? "var(--bad)" : total > DISCORD_LIMIT * 0.9 ? "var(--warn)" : "var(--ok)";
  const has = lastMono.length > 0;
  els.copyDiscord.disabled = els.copyRaw.disabled = els.download.disabled = !has;
}

function wrappedText() {
  const body = lastIsAnsi ? lastAnsi : lastMono;
  return (lastIsAnsi ? "```ansi\n" : "```\n") + body + "\n```";
}

async function copyText(t, btn) {
  try {
    await navigator.clipboard.writeText(t);
    flash(btn);
    status("Copied — paste it into Discord.");
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); flash(btn); status("Copied."); }
    catch { status("Copy blocked — select the preview manually (Ctrl+A)."); }
    ta.remove();
  }
}

let flashTimer = 0;
function flash(btn) {
  if (!btn || !btn.textContent) return;
  const orig = btn.textContent;
  btn.textContent = "Copied ✓";
  btn.classList.add("copied");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1400);
}

function status(msg) { els.status.textContent = msg; }
function scheduleRegen() { clearTimeout(regenTimer); regenTimer = setTimeout(regenerate, 120); }

// ---------- events ----------
els.browse.addEventListener("click", (e) => { e.stopPropagation(); els.file.click(); });
els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") els.file.click(); });
els.file.addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });
els.sample.addEventListener("click", (e) => { e.stopPropagation(); loadSample(); });

["dragover", "dragenter"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("over"); }));
els.drop.addEventListener("drop", (e) => {
  const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) loadFile(f); else status("No image in that drop.");
});

// Paste from clipboard anywhere on the page.
// Routes to the Draw canvas when the Draw tab is active.
window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith("image/")) { e.preventDefault(); routeImageFile(it.getAsFile()); return; }
  }
  const files = e.clipboardData?.files || [];
  if (files.length && files[0].type.startsWith("image/")) { e.preventDefault(); routeImageFile(files[0]); }
});

els.clear.addEventListener("click", () => {
  srcImg = null; lastMono = ""; lastAnsi = "";
  els.thumbRow.classList.add("hidden");
  els.preview.textContent = "Paste or drop an image to start.";
  updateStatsPlaceholder();
});

function updateStatsPlaceholder() {
  els.count.textContent = "0 / 2000";
  els.meter.style.width = "0%"; els.fitMsg.textContent = "";
  els.copyDiscord.disabled = els.copyRaw.disabled = els.download.disabled = true;
}

[els.width, els.aspect, els.charset, els.color, els.bright, els.contrast, els.bg]
  .forEach((el) => el.addEventListener("input", () => {
    els.aspectVal.textContent = parseFloat(els.aspect.value).toFixed(2);
    els.brightVal.textContent = els.bright.value;
    els.contrastVal.textContent = els.contrast.value + "%";
    scheduleRegen();
  }));
[els.dither, els.invert].forEach((el) => el.addEventListener("change", scheduleRegen));
els.wrap.addEventListener("change", () => els.preview.classList.toggle("wrap", els.wrap.checked));

els.maxFit.addEventListener("click", () => {
  if (!srcImg) { status("Load an image first."); return; }
  const w = maxFittingWidth();
  // Walk upward while it truly fits (exact check via trial widths is done in regenerate's shrink loop,
  // so set slider high and let regenerate cap it precisely).
  els.width.value = Math.min(220, w + 20);
  els.width.max = 220;
  regenerate();
  els.width.value = lastW; // snap slider to the exact capped width
  status(`Max detail for this image: ${lastW}×${lastH}.`);
});

els.copyDiscord.addEventListener("click", () => copyText(wrappedText(), els.copyDiscord));
els.copyRaw.addEventListener("click", () => copyText(lastIsAnsi ? lastAnsi : lastMono, els.copyRaw));
els.download.addEventListener("click", () => {
  const blob = new Blob([wrappedText()], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "discord-ascii.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// init
els.width.max = 220;
updateStatsPlaceholder();

/* ================= DRAW TAB =================
 * Freehand paint canvas (192×96 px) exported as half-block ANSI art:
 * each character cell = top pixel (fg) + bottom pixel (bg) via ▀,
 * so vertical resolution is doubled vs plain ASCII. Empty areas emit
 * a bare space (no escape codes) to save characters. Width auto-shrinks
 * until the wrapped ```ansi message is <= 2000 chars.
 */
const PAINT_W = 192, PAINT_H = 96;
const paint = document.getElementById("paint");
const pctx = paint.getContext("2d", { willReadFrequently: true });
const dEls = {
  swatches: document.getElementById("swatches"),
  custom: document.getElementById("customColor"),
  brush: document.getElementById("brushSlider"),
  brushVal: document.getElementById("brushVal"),
  pen: document.getElementById("penBtn"),
  eraser: document.getElementById("eraserBtn"),
  clear: document.getElementById("paintClearBtn"),
  width: document.getElementById("drawWidthSlider"),
  widthVal: document.getElementById("drawWidthVal"),
  heightVal: document.getElementById("drawHeightVal"),
  preview: document.getElementById("drawPreview"),
  count: document.getElementById("drawCount"),
  fit: document.getElementById("drawFit"),
  meter: document.getElementById("drawMeterFill"),
  copy: document.getElementById("drawCopyBtn"),
  download: document.getElementById("drawDownloadBtn"),
  status: document.getElementById("drawStatus"),
  safe: document.getElementById("mobileSafeChk"),
  tabImage: document.getElementById("tabImage"),
  tabDraw: document.getElementById("tabDraw"),
  imageView: document.getElementById("imageView"),
  drawView: document.getElementById("drawView"),
};
let drawColor = "#e5e510";
let erasing = false;
let painting = false;
let lastPt = null;
let lastDrawBody = "";
let lastDrawSafe = false;

dEls.tabImage.addEventListener("click", () => switchTab(false));
dEls.tabDraw.addEventListener("click", () => switchTab(true));
function switchTab(draw) {
  dEls.tabImage.classList.toggle("active", !draw);
  dEls.tabDraw.classList.toggle("active", draw);
  dEls.imageView.classList.toggle("hidden", draw);
  dEls.drawView.classList.toggle("hidden", !draw);
  if (draw) regenerateDraw();
}

// Build palette from the same ANSI colors used for export.
ANSI_TABLE.forEach((c, i) => {
  const b = document.createElement("button");
  b.className = "sw" + (c.css === drawColor ? " active" : "");
  b.style.background = c.css;
  b.title = c.code;
  b.type = "button";
  b.addEventListener("click", () => {
    drawColor = c.css; erasing = false; syncDrawTools();
    dEls.custom.value = toHex(drawColor);
  });
  dEls.swatches.appendChild(b);
});
function toHex(css) {
  const m = css.match(/^#([0-9a-f]{6})$/i);
  return m ? css : "#e5e510";
}
function syncDrawTools() {
  [...dEls.swatches.children].forEach((s) => {
    const active = !erasing && s.style.background && rgbToHex(s.style.background) === rgbToHex(drawColor);
    s.classList.toggle("active", !!active);
  });
  dEls.pen.classList.toggle("toggled", !erasing);
  dEls.eraser.classList.toggle("toggled", erasing);
}
function rgbToHex(s) {
  if (s.startsWith("#")) return s.toLowerCase();
  const m = s.match(/\d+/g);
  if (!m) return s;
  return "#" + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, "0")).join("");
}
dEls.custom.addEventListener("input", () => { drawColor = dEls.custom.value; erasing = false; syncDrawTools(); });
dEls.brush.addEventListener("input", () => { dEls.brushVal.textContent = dEls.brush.value; });
dEls.pen.addEventListener("click", () => { erasing = false; syncDrawTools(); });
dEls.eraser.addEventListener("click", () => { erasing = true; syncDrawTools(); });
dEls.clear.addEventListener("click", () => {
  pushHist();
  pctx.clearRect(0, 0, PAINT_W, PAINT_H);
  regenerateDraw();
  dEls.status.textContent = "Canvas cleared.";
});

// --- painting ---
function paintPos(e) {
  const r = paint.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (PAINT_W / r.width),
    y: (e.clientY - r.top) * (PAINT_H / r.height),
  };
}
function dab(x, y) {
  const s = parseInt(dEls.brush.value, 10);
  pctx.fillStyle = drawColor;
  if (erasing) pctx.clearRect(x - s / 2, y - s / 2, s, s);
  else { pctx.beginPath(); pctx.arc(x, y, s / 2, 0, 7); pctx.fill(); }
}
paint.addEventListener("pointerdown", (e) => {
  pushHist();
  painting = true; lastPt = paintPos(e); dab(lastPt.x, lastPt.y);
  paint.setPointerCapture(e.pointerId);
});
paint.addEventListener("pointermove", (e) => {
  if (!painting) return;
  const p = paintPos(e);
  // Interpolate so fast strokes stay solid.
  const dist = Math.hypot(p.x - lastPt.x, p.y - lastPt.y);
  const steps = Math.max(1, Math.floor(dist));
  for (let i = 1; i <= steps; i++) {
    dab(lastPt.x + ((p.x - lastPt.x) * i) / steps, lastPt.y + ((p.y - lastPt.y) * i) / steps);
  }
  lastPt = p;
});
const stopPaint = () => { if (painting) { painting = false; regenerateDraw(); } };
paint.addEventListener("pointerup", stopPaint);
paint.addEventListener("pointercancel", stopPaint);

// --- export ---
function hexRgb(hex) {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function nearestAnsiStd(r, g, b) {
  // Backgrounds: restrict to standard 8 (40–47) for Discord compat.
  let best = 0, bd = Infinity;
  for (let i = 0; i < 8; i++) {
    const c = ANSI_TABLE[i].rgb;
    const d = (r - c[0]) ** 2 * 0.3 + (g - c[1]) ** 2 * 0.5 + (b - c[2]) ** 2 * 0.2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function exportDraw(W) {
  const H = Math.max(1, Math.round((W * PAINT_H) / PAINT_W / 2)); // 2 paint-px per cell row
  const cw = PAINT_W / W, chh = PAINT_H / H;
  const buf = pctx.getImageData(0, 0, PAINT_W, PAINT_H).data; // single grab
  // Mobile-safe: plain-``` fence, ASCII glyphs only, zero escape codes.
  // (Mobile Discord renders ansi blocks as one flat color and its monospace
  // font can misalign ▀▄█, so color/half-block art breaks on phones.)
  const safe = dEls.safe.checked;
  const ramp = RAMP_DETAILED, rn = ramp.length;
  // Average a rect from the buffer; null when mostly transparent.
  const avgRect = (sx, sy, sw, sh) => {
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(PAINT_W, Math.ceil(sx + sw)), y1 = Math.min(PAINT_H, Math.ceil(sy + sh));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * PAINT_W + x) * 4, alpha = buf[i + 3] / 255;
      r += buf[i] * alpha; g += buf[i + 1] * alpha; b += buf[i + 2] * alpha; a += alpha; n++;
    }
    if (n === 0 || a / n < 0.25) return null;
    return [r / a, g / a, b / a];
  };
  const lines = [];       // glyphs per row (for preview layout)
  const cells = [];       // {g, fg, bg} per cell for preview styling
  let body = "";
  for (let y = 0; y < H; y++) {
    let lineGlyphs = "", lineBody = "", curFg = null, curBg = null, coded = false;
    const rowCells = [];
    for (let x = 0; x < W; x++) {
      let g = " ", fg = null, bg = null;
      if (safe) {
        const full = avgRect(x * cw, y * chh, cw, chh);
        if (full) {
          const lum = (0.2126 * full[0] + 0.7152 * full[1] + 0.0722 * full[2]) / 255;
          g = ramp[Math.min(rn - 1, Math.max(0, Math.round(lum * (rn - 1))))];
        }
      } else {
      const top = avgRect(x * cw, y * chh, cw, chh / 2);
      const bot = avgRect(x * cw, y * chh + chh / 2, cw, chh / 2);
      if (top && bot) {
        const t = nearestAnsi(top[0], top[1], top[2]);
        const bStd = nearestAnsiStd(bot[0], bot[1], bot[2]);
        const tStd = nearestAnsiStd(top[0], top[1], top[2]);
        if (t === ANSI_TABLE[bStd].code || tStd === bStd) {
          // Same color both halves → full block, one code.
          g = "█"; fg = t;
        } else { g = "▀"; fg = t; bg = String(40 + bStd); }
      } else if (top) { g = "▀"; fg = nearestAnsi(top[0], top[1], top[2]); }
      else if (bot) {
        const bStd = nearestAnsiStd(bot[0], bot[1], bot[2]);
        g = "█"; fg = ANSI_TABLE[bStd].code; // full block avoids bg code
      }
      } // end else (full-color branch)
      lineGlyphs += g;
      rowCells.push({ g, fg, bg });
      if (fg !== curFg) { if (fg !== null) { lineBody += `${ESC}${fg}m`; coded = true; } curFg = fg; }
      if (bg !== curBg) {
        if (bg !== null) { lineBody += `${ESC}${bg}m`; coded = true; }
        else if (curBg !== null) { lineBody += `${ESC}49m`; coded = true; } // back to default bg
        curBg = bg;
      }
      lineBody += g;
    }
    lines.push(lineGlyphs);
    cells.push(rowCells);
    if (coded) lineBody += `${ESC}0m`;
    body += lineBody + (y < H - 1 ? "\n" : "");
  }
  return { body, lines, cells, W, H, safe };
}

function drawOverhead() {
  return (dEls.safe.checked ? "```\n" : "```ansi\n").length + "\n```".length;
}
function drawWrapped() {
  return (lastDrawSafe ? "```\n" : "```ansi\n") + lastDrawBody + "\n```";
}
function regenerateDraw() {
  let W = parseInt(dEls.width.value, 10);
  const ov = drawOverhead();
  for (let i = 0; i < 30; i++) {
    const r = exportDraw(W);
    if (r.body.length + ov <= DISCORD_LIMIT) {
      lastDrawBody = r.body; lastDrawSafe = r.safe;
      renderDrawPreview(r);
      updateDrawStats(r, false);
      return;
    }
    W = Math.max(10, W - Math.max(1, Math.ceil(W * 0.1)));
    if (W <= 10) {
      const r2 = exportDraw(W);
      lastDrawBody = r2.body; lastDrawSafe = r2.safe;
      renderDrawPreview(r2);
      updateDrawStats(r2, true);
      return;
    }
  }
}
function renderDrawPreview(r) {
  dEls.preview.innerHTML = "";
  if (!r.body.trim()) { dEls.preview.textContent = "Draw something to start."; return; }
  const frame = document.createElement("div");
  frame.className = "msgFrame";
  frame.title = "Exact Discord message bounds";
  const frag = document.createDocumentFragment();
  const bgCss = (code) => ANSI_CSS[ANSI_TABLE[parseInt(code, 10) - 40].code] || "#000";
  r.cells.forEach((row, y) => {
    row.forEach((c) => {
      const s = document.createElement("span");
      s.textContent = c.g;
      if (c.fg) s.style.color = ANSI_CSS[c.fg] || "#fff";
      if (c.bg) s.style.background = bgCss(c.bg);
      frag.appendChild(s);
    });
    if (y < r.cells.length - 1) frag.appendChild(document.createTextNode("\n"));
  });
  frame.appendChild(frag);
  dEls.preview.appendChild(frame);
  fitDrawPreview();
}
// Shrink preview text until the whole framed message fits the screen width
// (mobile) — display only, the copied text is unchanged.
function fitDrawPreview() {
  const p = dEls.preview;
  p.style.fontSize = "";
  let fs = 11;
  for (let i = 0; i < 8 && p.scrollWidth > p.clientWidth + 1; i++) {
    fs -= 1;
    p.style.fontSize = fs + "px";
  }
}
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!dEls.drawView.classList.contains("hidden")) fitDrawPreview();
  }, 150);
});
// 📱 Mobile view: constrain the preview to phone width. The auto-fit then
// shrinks the text exactly as needed, showing what fits on mobile Discord.
const mobileBtn = document.getElementById("mobileViewBtn");
mobileBtn.addEventListener("click", () => {
  const on = dEls.drawView.classList.toggle("phone");
  mobileBtn.classList.toggle("toggled", on);
  mobileBtn.textContent = on ? "Mobile view ✓" : "Mobile view";
  fitDrawPreview();
  dEls.status.textContent = on ? "Phone-width preview." : "Desktop-width preview.";
});
function updateDrawStats(r, over) {
  const total = r.body.length + (r.safe ? "```\n".length : "```ansi\n".length) + "\n```".length;
  dEls.count.textContent = `${total} / 2000${r.safe ? " (mobile-safe)" : " (ANSI)"}`;
  dEls.widthVal.textContent = r.W;
  dEls.heightVal.textContent = `× ${r.H} (half-blocks)`;
  dEls.fit.textContent = over ? "⚠ Still over — clear some detail"
    : (r.W < parseInt(dEls.width.value, 10) ? `↳ capped ${dEls.width.value}→${r.W} to fit` : "✓ fits");
  dEls.meter.style.width = Math.min(100, (total / DISCORD_LIMIT) * 100) + "%";
  dEls.meter.style.background = total > DISCORD_LIMIT ? "var(--bad)" : total > 1800 ? "var(--warn)" : "var(--ok)";
  const has = r.body.trim().length > 0;
  dEls.copy.disabled = dEls.download.disabled = !has;
}
dEls.width.addEventListener("input", regenerateDraw);
dEls.copy.addEventListener("click", async () => {
  const t = drawWrapped();
  try { await navigator.clipboard.writeText(t); flash(dEls.copy); dEls.status.textContent = "Copied — paste it into Discord."; }
  catch { dEls.status.textContent = "Copy blocked — select the preview manually (Ctrl+A)."; }
});
dEls.download.addEventListener("click", () => {
  const blob = new Blob([drawWrapped()], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "discord-drawing.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
dEls.safe.addEventListener("change", () => {
  if (dEls.safe.checked) {
    if (parseInt(dEls.width.value, 10) > 40) dEls.width.value = 40;
    dEls.status.textContent = "Mobile-safe on — plain ASCII, identical on phones.";
  } else {
    dEls.status.textContent = "Full-color ANSI mode (best on desktop).";
  }
  regenerateDraw();
});
syncDrawTools();
dEls.copy.disabled = dEls.download.disabled = true;

/* ============ DRAW: undo/redo, brush ring, draw-on-preview ============ */
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const ring = document.getElementById("brushRing");
const histUndo = [], histRedo = [];

function pushHist() {
  histUndo.push(pctx.getImageData(0, 0, PAINT_W, PAINT_H));
  if (histUndo.length > 30) histUndo.shift();
  histRedo.length = 0;
  syncHist();
}
function syncHist() {
  undoBtn.disabled = histUndo.length === 0;
  redoBtn.disabled = histRedo.length === 0;
}
function doUndo() {
  if (!histUndo.length) return;
  histRedo.push(pctx.getImageData(0, 0, PAINT_W, PAINT_H));
  pctx.putImageData(histUndo.pop(), 0, 0);
  syncHist(); regenerateDraw();
}
function doRedo() {
  if (!histRedo.length) return;
  histUndo.push(pctx.getImageData(0, 0, PAINT_W, PAINT_H));
  pctx.putImageData(histRedo.pop(), 0, 0);
  syncHist(); regenerateDraw();
}
undoBtn.addEventListener("click", doUndo);
redoBtn.addEventListener("click", doRedo);
dEls.tabImage.addEventListener("click", hideRing);
window.addEventListener("keydown", (e) => {
  if (dEls.drawView.classList.contains("hidden")) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
  else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
});

// --- brush-size ring cursor ---
function showRing(x, y, d) {
  ring.style.display = "block";
  ring.style.left = x + "px"; ring.style.top = y + "px";
  ring.style.width = ring.style.height = Math.max(6, d) + "px";
}
function hideRing() { ring.style.display = "none"; }
paint.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const r = paint.getBoundingClientRect();
  showRing(e.clientX, e.clientY, parseInt(dEls.brush.value, 10) * r.width / PAINT_W);
});
paint.addEventListener("pointerleave", hideRing);

// --- draw directly on the preview (1:1 with output cells) ---
// Grid size is read back from the rendered preview so it always matches
// what you see (including auto-capped widths).
function drawCellsRoot() {
  return dEls.preview.querySelector(".msgFrame") || dEls.preview;
}
function currentGrid() {
  let rows = 1, cols = 0, c = 0, any = false;
  for (const k of drawCellsRoot().childNodes) {
    if (k.nodeType === 3) { if (k.textContent.includes("\n")) { rows++; cols = Math.max(cols, c); c = 0; } }
    else { c++; any = true; }
  }
  cols = Math.max(cols, c);
  return any && cols > 0 ? { W: cols, H: rows } : null;
}
function cellFromPoint(cx, cy) {
  let node = null;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(cx, cy);
    if (p) node = p.offsetNode;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(cx, cy);
    if (r) node = r.startContainer;
  }
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  const span = el && el.closest ? el.closest("span") : null;
  if (!span || !dEls.preview.contains(span)) return null;
  // Row = newlines before the span; col = spans since the last newline.
  let col = 0, row = 0, sib = span.previousSibling, inRow = true;
  while (sib) {
    if (sib.nodeType === 3 && sib.textContent.includes("\n")) { row++; inRow = false; }
    else if (inRow && sib.nodeType !== 3) col++;
    sib = sib.previousSibling;
  }
  const r = span.getBoundingClientRect();
  return { col, row, half: (cy - r.top) < r.height / 2 ? 0 : 1 };
}
let pvStroke = false, pvRaf = false;
function schedulePreviewRegen() {
  if (pvRaf) return;
  pvRaf = true;
  requestAnimationFrame(() => { pvRaf = false; regenerateDraw(); });
}
function paintPreviewCell(col, row, half) {
  const g = currentGrid();
  if (!g || col < 0 || row < 0 || col >= g.W || row >= g.H) return;
  const cw = PAINT_W / g.W, chh = PAINT_H / g.H;
  // Brush px → cells (min brush = 1 cell = half-block precision).
  const cells = Math.max(1, Math.round(parseInt(dEls.brush.value, 10) * g.W / PAINT_W));
  const fill = (c, r, top, bottom) => {
    const x = c * cw, y = r * chh;
    if (erasing) { pctx.clearRect(x, y, cw, chh); return; }
    pctx.fillStyle = drawColor;
    if (top && bottom) pctx.fillRect(x, y, cw, chh);
    else pctx.fillRect(x, top ? y : y + chh / 2, cw, chh / 2);
  };
  if (cells <= 1) { fill(col, row, half === 0, half === 1); }
  else {
    const rad = (cells - 1) / 2;
    for (let dy = -cells; dy <= cells; dy++) for (let dx = -cells; dx <= cells; dx++) {
      if (dx * dx + dy * dy > rad * rad + 0.5) continue;
      const c = col + dx, r = row + dy;
      if (c < 0 || r < 0 || c >= g.W || r >= g.H) continue;
      fill(c, r, true, true);
    }
  }
  schedulePreviewRegen();
}
dEls.preview.addEventListener("pointerdown", (e) => {
  const c = cellFromPoint(e.clientX, e.clientY);
  if (!c) return;
  e.preventDefault();
  pushHist();
  pvStroke = true;
  dEls.preview.style.userSelect = "none";
  try { dEls.preview.setPointerCapture(e.pointerId); } catch {}
  paintPreviewCell(c.col, c.row, c.half);
});
dEls.preview.addEventListener("pointermove", (e) => {
  if (pvStroke) {
    const c = cellFromPoint(e.clientX, e.clientY);
    if (c) paintPreviewCell(c.col, c.row, c.half);
    return;
  }
  if (e.pointerType !== "mouse") return;
  const m = dEls.preview.querySelector("span");
  const g = currentGrid();
  if (!m || !g) { hideRing(); return; }
  const cells = Math.max(1, Math.round(parseInt(dEls.brush.value, 10) * g.W / PAINT_W));
  showRing(e.clientX, e.clientY, cells * m.getBoundingClientRect().width);
});
const endPvStroke = () => {
  if (!pvStroke) return;
  pvStroke = false;
  dEls.preview.style.userSelect = "";
  regenerateDraw();
};
dEls.preview.addEventListener("pointerup", endPvStroke);
dEls.preview.addEventListener("pointercancel", endPvStroke);
dEls.preview.addEventListener("pointerleave", () => { if (!pvStroke) hideRing(); });
syncHist();

/* ============ DRAW: add picture (trace over / colorize photos) ============ */
function placeImageOnPaint(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) { dEls.status.textContent = "Could not read that image."; return; }
  // Contain-fit: whole picture visible, never cropped. Empty margins stay
  // transparent (export as cheap spacers).
  const s = Math.min(PAINT_W / iw, PAINT_H / ih);
  const dw = Math.max(1, Math.round(iw * s)), dh = Math.max(1, Math.round(ih * s));
  pushHist();
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(img, Math.round((PAINT_W - dw) / 2), Math.round((PAINT_H - dh) / 2), dw, dh);
  regenerateDraw();
  dEls.status.textContent = `Picture placed (${iw}×${ih}).`;
}
function loadDrawFile(file) {
  if (!file || !file.type.startsWith("image/")) { dEls.status.textContent = "Not an image file."; return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { placeImageOnPaint(img); URL.revokeObjectURL(url); };
  img.onerror = () => { dEls.status.textContent = "Could not decode that image."; URL.revokeObjectURL(url); };
  img.src = url;
}
// Pasted/dropped images go to the active tab.
function routeImageFile(file) {
  if (!dEls.drawView.classList.contains("hidden")) loadDrawFile(file);
  else loadFile(file);
}
document.getElementById("drawImageBtn").addEventListener("click", () => document.getElementById("drawFile").click());
document.getElementById("drawFile").addEventListener("change", (e) => {
  if (e.target.files[0]) loadDrawFile(e.target.files[0]);
  e.target.value = "";
});
paint.addEventListener("dragover", (e) => e.preventDefault());
paint.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) loadDrawFile(f);
  else dEls.status.textContent = "No image in that drop.";
});
