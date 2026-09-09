/* Tuned In — zen.js
   Zen Garden — sand raking, items, bends, backdrop
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ============================================================================
// Zen Garden — a break app. Rake sand, place rocks and bonsai, bend the lines,
// and set the finished garden as the app backdrop.
// State persists in settings["zen_garden"]; the backdrop PNG is saved server-
// side via /api/zen-backdrop and applied as a fixed layer behind the board.
// ============================================================================
const ZEN_KEY = "zen_garden";
const ZEN_W = 1600, ZEN_H = 900;
let ZEN = null;               // { seed, density, wiggle, bend, bends[], items[] }
let zenTool = "move";         // "move" | "bend" | an item type key
let zenCanvas = null, zenDrag = null, zenSaveT = null;

const ZEN_ITEMS = [
  { key: "rock_lg",  label: "Boulder",      icon: "⬤" },
  { key: "rock_sm",  label: "Stone",        icon: "●" },
  { key: "rock_flat",label: "Flat rock",    icon: "▬" },
  { key: "bonsai",   label: "Bonsai",       icon: "" },
  { key: "bonsai_c", label: "Cascade bonsai", icon: "" },
  { key: "lantern",  label: "Stone lantern",icon: "" },
  { key: "moss",     label: "Moss mound",   icon: "" },
  { key: "pagoda",   label: "Pagoda",       icon: "" },
];

function zenLoad() {
  if (ZEN) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[ZEN_KEY]) || "{}"); } catch (e) { saved = {}; }
  ZEN = Object.assign({
    seed: 7, density: 26, wiggle: 8, bend: 60, autoN: 6,
    bends: [],   // { x, y, dir: 1 (push) | -1 (pull) }
    items: [     // a calm starter arrangement
      { id: "z1", type: "rock_lg", x: 1130, y: 320, scale: 1.15 },
      { id: "z2", type: "rock_sm", x: 1240, y: 420, scale: 0.9 },
      { id: "z3", type: "bonsai",  x: 340,  y: 560, scale: 1.1 },
    ],
  }, saved);
}
function zenSave() {
  clearTimeout(zenSaveT);
  zenSaveT = setTimeout(() => {
    STATE.settings[ZEN_KEY] = JSON.stringify(ZEN);
    saveSetting(ZEN_KEY, STATE.settings[ZEN_KEY]);
  }, 500);
}

// Deterministic pseudo-random from the seed — re-rake just picks a new seed.
function zenRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---- Karesansui contour field -------------------------------------------
// The raking is rendered as iso-lines (contours) of a smooth-min DISTANCE
// field: every groove is a curve of constant distance to the nearest feature
// — items, swirl points, a few seeded "flow ridges", and the garden border.
// That is literally how a rake behaves around obstacles: concentric rings hug
// every shape, run parallel to the edges, and where two systems meet they
// join at a soft seam, exactly like real raked gravel. Even spacing comes
// free (a distance field's gradient is 1 everywhere).
let zenPhase = 0;          // reseeded on re-rake
let zenRidgeCache = [];    // seeded flow ridges for open sand

function zenField(x, y) {
  const K = 7;   // seam softness (px)
  // Gather distance-like values from every source, then smooth-min them
  const gs2 = [];
  const bias = Math.max(0, 140 - (ZEN.bend || 60)) * 0.9;  // higher reach = rings extend farther before yielding to flow
  for (const rd of zenRidgeCache) {
    const yy = rd.y + Math.sin(x / rd.wav + rd.ph) * rd.amp;
    gs2.push(Math.abs(y - yy) + bias);
  }
  gs2.push(Math.min(x, y, ZEN_W - x, ZEN_H - y) + bias * 0.7);  // border-parallel raking
  for (const it of ZEN.items) {
    const dx = x - it.x, dyy = y - it.y;
    gs2.push(Math.max(0, Math.sqrt(dx * dx + dyy * dyy) - zenItemRadius(it) - 8));
  }
  for (const b of (ZEN.bends || [])) {
    const dx = x - b.x, dyy = y - b.y;
    gs2.push(Math.max(0, Math.sqrt(dx * dx + dyy * dyy) - (10 + (b.sz || 1) * 16)));
  }
  // Shifted log-sum-exp smooth minimum (numerically safe)
  let m = Infinity;
  for (const g of gs2) if (g < m) m = g;
  let acc = 0;
  for (const g of gs2) { const e = (g - m) / K; if (e < 30) acc += Math.exp(-e); }
  const F = m - K * Math.log(acc);
  // Organic hand-raked waviness on top
  return F
    + Math.sin(x / 210 + y / 470 + zenPhase * 6.28) * ZEN.wiggle * 0.45
    + Math.sin(x / 83 - y / 190 + zenPhase * 12.6) * ZEN.wiggle * 0.2;
}

// Marching squares: extract every contour of zenField at `spacing` intervals
// and return them as line segments, batched per pass for one stroke() call.
function zenContourSegments(spacing, cw = ZEN_W, ch = ZEN_H, fieldFn = zenField) {
  const gs = 5;                                  // field grid resolution (px)
  const nx = Math.floor(cw / gs) + 2, ny = Math.floor(ch / gs) + 2;
  const F = new Float32Array(nx * ny);
  let fmin = Infinity, fmax = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = fieldFn(i * gs, j * gs);
      F[j * nx + i] = v;
      if (v < fmin) fmin = v;
      if (v > fmax) fmax = v;
    }
  }
  const segs = [];
  const lerp = (a, b, L) => (L - a) / (b - a);
  const L0 = Math.ceil(fmin / spacing) * spacing;
  for (let L = L0; L <= fmax; L += spacing) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = F[j * nx + i],       b = F[j * nx + i + 1];
        const c = F[(j + 1) * nx + i + 1], d = F[(j + 1) * nx + i];
        let idx = 0;
        if (a > L) idx |= 1;
        if (b > L) idx |= 2;
        if (c > L) idx |= 4;
        if (d > L) idx |= 8;
        if (idx === 0 || idx === 15) continue;
        const x0 = i * gs, y0 = j * gs;
        // edge midpoints via linear interpolation
        const top    = [x0 + gs * lerp(a, b, L), y0];
        const right  = [x0 + gs, y0 + gs * lerp(b, c, L)];
        const bottom = [x0 + gs * lerp(d, c, L), y0 + gs];
        const left   = [x0, y0 + gs * lerp(a, d, L)];
        const put = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
        switch (idx) {
          case 1: case 14: put(left, top); break;
          case 2: case 13: put(top, right); break;
          case 3: case 12: put(left, right); break;
          case 4: case 11: put(right, bottom); break;
          case 6: case 9:  put(top, bottom); break;
          case 7: case 8:  put(left, bottom); break;
          case 5:  put(left, top); put(right, bottom); break;
          case 10: put(top, right); put(left, bottom); break;
        }
      }
    }
  }
  return segs;
}

function zenItemRadius(it) {
  const base = { rock_lg: 62, rock_sm: 34, rock_flat: 52, bonsai: 58, bonsai_c: 58, lantern: 42, moss: 40, pagoda: 46 }[it.type] || 44;
  return base * (it.scale || 1);
}

function zenDraw() {
  if (!zenCanvas) return;
  const ctx = zenCanvas.getContext("2d");
  const rand = zenRng(ZEN.seed * 1000 + 17);
  zenPhase = rand();                       // seeds the waviness for this rake
  zenRidgeCache = [];                      // seeded flow ridges for open sand
  const nRidges = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < nRidges; i++) {
    zenRidgeCache.push({
      y: 90 + rand() * (ZEN_H - 180),
      wav: 240 + rand() * 240,
      ph: rand() * 6.28,
      amp: 12 + ZEN.wiggle * 2.2,
    });
  }

  // Sand
  const g = ctx.createLinearGradient(0, 0, 0, ZEN_H);
  g.addColorStop(0, "#f8ecdb"); g.addColorStop(1, "#f0e2cc");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ZEN_W, ZEN_H);
  // Speckle
  ctx.fillStyle = "rgba(160,140,110,0.10)";
  for (let i = 0; i < 900; i++) ctx.fillRect(rand() * ZEN_W, rand() * ZEN_H, 1.6, 1.6);

  // Raked grooves: contours of the field. Two strokes per set — a light
  // ridge offset up-left and a darker furrow — batched into two paths total.
  const spacing = Math.max(12, Math.min(60, ZEN.density));
  const segs = zenContourSegments(spacing);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const pass of [
    { ox: -0.9, oy: -1.5, color: "rgba(255,255,255,0.6)", w: 2.1 },
    { ox: 0,    oy: 0,    color: "rgba(148,122,90,0.45)", w: 2.2 },
  ]) {
    ctx.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      ctx.moveTo(segs[k] + pass.ox, segs[k + 1] + pass.oy);
      ctx.lineTo(segs[k + 2] + pass.ox, segs[k + 3] + pass.oy);
    }
    ctx.strokeStyle = pass.color; ctx.lineWidth = pass.w; ctx.stroke();
  }

  // Items on top
  ZEN.items.forEach((it) => zenDrawItem(ctx, it));

  // Swirl markers (only while the Swirl tool is active)
  if (zenTool === "bend") {
    (ZEN.bends || []).forEach((b) => {
      ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,133,155,0.75)";
      ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(b.sz || 1), b.x, b.y + 0.5);
    });
  }
}

function zenDrawItem(ctx, it) {
  const s = it.scale || 1;
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.scale(s, s);
  const shadow = () => {
    ctx.beginPath(); ctx.ellipse(4, 10, 48, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120,100,70,0.18)"; ctx.fill();
  };
  // Rounded-rectangle path (arcs, not corners) — used everywhere instead of rects
  const rrect = (x, y, w, h, rad) => {
    const r2 = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r2, y);
    ctx.arcTo(x + w, y, x + w, y + h, r2);
    ctx.arcTo(x + w, y + h, x, y + h, r2);
    ctx.arcTo(x, y + h, x, y, r2);
    ctx.arcTo(x, y, x + w, y, r2);
    ctx.closePath();
  };
  const rockBlob = (rx, ry, tone) => {
    ctx.beginPath();
    ctx.moveTo(-rx, 4);
    ctx.bezierCurveTo(-rx * 1.05, -ry * 0.7, -rx * 0.3, -ry, rx * 0.25, -ry * 0.9);
    ctx.bezierCurveTo(rx * 0.85, -ry * 0.75, rx * 1.05, -ry * 0.1, rx * 0.9, ry * 0.35);
    ctx.bezierCurveTo(rx * 0.5, ry * 0.62, -rx * 0.6, ry * 0.62, -rx, 4);
    ctx.closePath();
    const rg = ctx.createLinearGradient(-rx, -ry, rx, ry);
    rg.addColorStop(0, tone[0]); rg.addColorStop(1, tone[1]);
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = "rgba(60,60,64,0.35)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-rx * 0.3, -ry * 0.45, rx * 0.34, ry * 0.2, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
  };
  const foliage = (cx, cy, r, tone) => {
    for (const [ox, oy, rr] of [[0, 0, r], [-r * 0.8, r * 0.25, r * 0.7], [r * 0.8, r * 0.3, r * 0.65]]) {
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2);
      ctx.fillStyle = tone; ctx.fill();
      ctx.strokeStyle = "rgba(30,70,50,0.35)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  };
  switch (it.type) {
    case "rock_lg": shadow(); rockBlob(52, 46, ["#9a9a9e", "#6f6f74"]); break;
    case "rock_sm": shadow(); rockBlob(30, 26, ["#b3b3b6", "#84848a"]); break;
    case "rock_flat": shadow(); rockBlob(50, 20, ["#a8a49c", "#7d7a72"]); break;
    case "bonsai": {
      shadow();
      rrect(-18, 6, 36, 18, 8); ctx.fillStyle = "#8a5a33"; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 7, 21, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#6f4626"; ctx.fill();
      ctx.strokeStyle = "#5d4126"; ctx.lineWidth = 7; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.bezierCurveTo(-4, -8, 10, -16, 4, -30); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(1, -12); ctx.quadraticCurveTo(-8, -16, -16, -22); ctx.stroke();
      foliage(4, -38, 16, "#38a66f"); foliage(-20, -24, 11, "#77b28c");
      break;
    }
    case "bonsai_c": {
      shadow();
      rrect(-14, -6, 28, 26, 9); ctx.fillStyle = "#7d6a56"; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -5, 16, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#6b5a48"; ctx.fill();
      ctx.strokeStyle = "#5d4126"; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.bezierCurveTo(6, -22, 26, -20, 34, -2); ctx.stroke();
      foliage(0, -26, 12, "#38a66f"); foliage(34, -2, 12, "#bce194"); foliage(20, -18, 9, "#77b28c");
      break;
    }
    case "lantern": {
      shadow();
      // base + pillar (rounded)
      ctx.beginPath(); ctx.ellipse(0, 16, 20, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#84848a"; ctx.fill();
      rrect(-8, -6, 16, 22, 6); ctx.fillStyle = "#9a9a9e"; ctx.fill();
      // light box (rounded) with warm glow
      rrect(-16, -28, 32, 18, 8); ctx.fillStyle = "#84848a"; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -19, 9, 6.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f8ecdb"; ctx.fill();
      // dome cap + finial
      ctx.beginPath(); ctx.ellipse(0, -28, 24, 8, 0, Math.PI, 0);
      ctx.lineTo(24, -28);
      ctx.quadraticCurveTo(12, -46, 0, -47);
      ctx.quadraticCurveTo(-12, -46, -24, -28);
      ctx.closePath();
      ctx.fillStyle = "#6f6f74"; ctx.fill();
      ctx.beginPath(); ctx.arc(0, -49, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#84848a"; ctx.fill();
      break;
    }
    case "moss": {
      shadow();
      ctx.beginPath();
      ctx.ellipse(0, -2, 38, 24, 0, Math.PI, 0);
      ctx.quadraticCurveTo(0, 6, -38, -2);
      ctx.closePath();
      ctx.fillStyle = "#77b28c"; ctx.fill();
      ctx.strokeStyle = "rgba(30,70,50,0.3)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "rgba(188,225,148,0.6)";
      ctx.beginPath(); ctx.ellipse(-12, -14, 12, 6, -0.3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "pagoda": {
      shadow();
      // rounded roof: a squashed dome with upturned quadratic eaves
      const roof = (w, yBase) => {
        ctx.beginPath();
        ctx.moveTo(-w, yBase);
        ctx.quadraticCurveTo(-w * 0.5, yBase - 14, 0, yBase - 15);
        ctx.quadraticCurveTo(w * 0.5, yBase - 14, w, yBase);
        ctx.quadraticCurveTo(w * 0.55, yBase + 3, 0, yBase + 3);
        ctx.quadraticCurveTo(-w * 0.55, yBase + 3, -w, yBase);
        ctx.closePath();
        ctx.fillStyle = "#84848a"; ctx.fill();
      };
      rrect(-7, 4, 14, 15, 6); ctx.fillStyle = "#9a9a9e"; ctx.fill();
      roof(30, 4);
      rrect(-5.5, -12, 11, 8, 4.5); ctx.fillStyle = "#9a9a9e"; ctx.fill();
      roof(22, -12);
      rrect(-4.5, -26, 9, 7, 4); ctx.fillStyle = "#9a9a9e"; ctx.fill();
      roof(14, -26);
      ctx.beginPath(); ctx.arc(0, -44, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#6f6f74"; ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function zenCanvasPoint(e) {
  const r = zenCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (ZEN_W / r.width),
    y: (e.clientY - r.top) * (ZEN_H / r.height),
  };
}
function zenHitItem(p) {
  for (let i = ZEN.items.length - 1; i >= 0; i--) {
    const it = ZEN.items[i];
    if (Math.hypot(p.x - it.x, p.y - it.y) < zenItemRadius(it)) return it;
  }
  return null;
}

// A fresh random garden: 4-8 items placed with breathing room, 1-3 swirls,
// new raking. Keeps your density/wiggle/reach sliders where they are.
function zenRandomGarden() {
  const types = ZEN_ITEMS.map((d) => d.key);
  const margin = 130;
  const items = [];
  const n = Math.max(2, Math.min(12, Number(ZEN.autoN) || 6));
  for (let k = 0; k < n; k++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = margin + Math.random() * (ZEN_W - margin * 2);
      const y = margin + Math.random() * (ZEN_H - margin * 2);
      if (items.every((it) => Math.hypot(x - it.x, y - it.y) > 190)) {
        items.push({ id: "z" + Date.now().toString(36) + k, type: types[Math.floor(Math.random() * types.length)],
                     x, y, scale: 0.8 + Math.random() * 0.6 });
        break;
      }
    }
  }
  const bends = [];
  const nb = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < nb; k++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = 90 + Math.random() * (ZEN_W - 180);
      const y = 90 + Math.random() * (ZEN_H - 180);
      if (items.every((it) => Math.hypot(x - it.x, y - it.y) > zenItemRadius(it) + 120)) {
        bends.push({ x, y, sz: 1 + Math.floor(Math.random() * 3) });
        break;
      }
    }
  }
  ZEN.items = items;
  ZEN.bends = bends;
  ZEN.seed = Math.floor(Math.random() * 100000);
  zenDraw(); zenSave();
}

function renderZen() {
  zenLoad();
  zenInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "zen-wrap" });

  const head = el("div", { class: "vibe-head" });
  head.append(el("div", {},
    el("div", { class: "vibe-title" }, "Zen Garden"),
    el("div", { class: "vibe-sub" }, "Take a break. Place rocks and bonsai, rake the sand, bend the lines — then make it your backdrop.")));
  const headBtns = el("div", { style: "display:flex;gap:8px;align-items:center" });
  headBtns.append(el("button", { class: "tool-btn accent-teal", onClick: zenSetBackdrop }, "Set as app backdrop"));
  // Show the on/off toggle only once a garden has been saved as a backdrop.
  // "off" hides it (white background) without deleting the saved image, so you
  // can flip it back on later. Default for anyone starting fresh is OFF.
  if (zenBackdropSaved()) {
    const on = zenBackdropOn();
    const toggle = el("label", { class: "zen-toggle", title: "Show or hide the saved garden backdrop (doesn't delete it)" });
    const cb = el("input", { type: "checkbox" });
    cb.checked = on;
    cb.addEventListener("change", () => {
      STATE.settings.zen_backdrop_on = cb.checked ? "1" : "0";
      saveSetting("zen_backdrop_on", STATE.settings.zen_backdrop_on);
      applyZenBackdrop();
    });
    toggle.append(cb, el("span", {}, "Backdrop on"));
    headBtns.append(toggle);
  }
  headBtns.append(el("button", { class: "tool-btn", onClick: zenClearBackdrop, title: "Delete the saved garden backdrop entirely and return to the plain background" }, "Clear backdrop"));
  head.append(headBtns);
  wrap.append(head);

  // Tool rail: move, bend, then the item palette
  const rail = el("div", { class: "zen-rail" });
  const toolBtn = (key, label, icon, title) => {
    const b = el("button", { class: "zen-tool" + (zenTool === key ? " on" : ""), title: title || label,
      onClick: () => { zenTool = key; wrap.querySelectorAll(".zen-tool").forEach((x) => x.classList.remove("on")); b.classList.add("on"); zenDraw(); } });
    b.append(el("span", { class: "zen-tool-ic" }, icon));
    b.append(el("span", {}, label));
    return b;
  };
  rail.append(toolBtn("move", "Move", "", "Drag items to rearrange. Double-click an item to remove it."));
  rail.append(toolBtn("bend", "Swirl", "〰", "Click the sand to rake a circular swirl into it. Click a swirl to grow it (cycles 3 sizes); double-click to remove."));
  rail.append(el("span", { class: "zen-rail-div" }));
  ZEN_ITEMS.forEach((d) => rail.append(toolBtn(d.key, d.label, d.icon, `Click the garden to place a ${d.label.toLowerCase()}`)));
  wrap.append(rail);

  // Sliders + re-rake
  const bar = el("div", { class: "zen-bar" });
  const slider = (label, min, max, val, oninput) => {
    const seg = el("div", { class: "zen-seg" });
    seg.append(el("label", {}, label));
    const inp = el("input", { type: "range", min: String(min), max: String(max), value: String(val) });
    inp.addEventListener("input", () => { oninput(Number(inp.value)); zenDraw(); zenSave(); });
    seg.append(inp);
    return seg;
  };
  bar.append(slider("Line density", 12, 60, 72 - ZEN.density, (v) => { ZEN.density = 72 - v; }));
  bar.append(slider("Wiggle", 0, 30, ZEN.wiggle, (v) => { ZEN.wiggle = v; }));
  bar.append(slider("Ring reach", 10, 140, ZEN.bend, (v) => { ZEN.bend = v; }));
  bar.append(el("button", { class: "tool-btn", title: "Rake the sand fresh with new waviness (keeps items and swirls)",
    onClick: () => { ZEN.seed = Math.floor(Math.random() * 100000); zenDraw(); zenSave(); } }, "↻ Re-rake"));
  bar.append(el("button", { class: "tool-btn", title: "Generate a whole new random garden — items, swirls, raking",
    onClick: zenRandomGarden }, "New garden"));
  // How many items places
  const nSeg = el("div", { class: "zen-seg", title: "How many items a new random garden gets" });
  nSeg.append(el("label", {}, "Items"));
  const nInp = el("input", { type: "range", min: "2", max: "12", value: String(ZEN.autoN || 6) });
  const nVal = el("span", { class: "zen-seg-val" }, String(ZEN.autoN || 6));
  nInp.addEventListener("input", () => { ZEN.autoN = Number(nInp.value); nVal.textContent = nInp.value; zenSave(); });
  nSeg.append(nInp, nVal);
  bar.append(nSeg);
  // Panel opacity: how solid content panels are over the backdrop (app-wide)
  const opSeg = el("div", { class: "zen-seg", title: "How solid content panels are over the garden backdrop — lower shows more garden" });
  opSeg.append(el("label", {}, "Panel opacity"));
  const opInp = el("input", { type: "range", min: "20", max: "95",
    value: String(Math.round(zenAlpha() * 100)) });
  opInp.addEventListener("input", () => {
    STATE.settings.zen_alpha = String(Number(opInp.value) / 100);
    zenApplyAlpha();
  });
  opInp.addEventListener("change", () => saveSetting("zen_alpha", STATE.settings.zen_alpha));
  opSeg.append(opInp);
  bar.append(opSeg);
  bar.append(el("button", { class: "tool-btn", title: "Remove every placed item",
    onClick: () => { if (confirm("Clear all rocks, trees, and decorations?")) { ZEN.items = []; zenDraw(); zenSave(); } } }, "Clear items"));
  wrap.append(bar);

  // Canvas
  const cwrap = el("div", { class: "zen-canvas-wrap" });
  zenCanvas = el("canvas", { class: "zen-canvas", width: String(ZEN_W), height: String(ZEN_H) });
  cwrap.append(zenCanvas);
  wrap.append(cwrap);
  wrap.append(el("div", { class: "zen-hint" },
    "Move: drag items, double-click to remove · 〰 Swirl: click sand to rake a circular swirl, click it to grow, double-click to remove · Palette: click the garden to place · for a fresh random garden"));

  // ---- Interactions ----
  zenCanvas.addEventListener("mousedown", (e) => {
    const p = zenCanvasPoint(e);
    if (zenTool === "move") {
      const it = zenHitItem(p);
      if (it) zenDrag = { it, ox: p.x - it.x, oy: p.y - it.y, moved: false };
      return;
    }
    if (zenTool === "bend") {
      const hit = (ZEN.bends || []).find((b) => Math.hypot(p.x - b.x, p.y - b.y) < 18);
      if (hit) { hit.sz = ((hit.sz || 1) % 3) + 1; }       // grow: 1 -> 2 -> 3 -> 1
      else { ZEN.bends = ZEN.bends || []; ZEN.bends.push({ x: p.x, y: p.y, sz: 1 }); }
      zenDraw(); zenSave();
      return;
    }
    // Placement tool
    ZEN.items.push({ id: "z" + Date.now().toString(36), type: zenTool, x: p.x, y: p.y, scale: 0.8 + Math.random() * 0.5 });
    zenDraw(); zenSave();
  });
  zenCanvas.addEventListener("mousemove", (e) => {
    if (!zenDrag) return;
    const p = zenCanvasPoint(e);
    zenDrag.it.x = p.x - zenDrag.ox; zenDrag.it.y = p.y - zenDrag.oy; zenDrag.moved = true;
    zenDraw();
  });
  const endDrag = () => { if (zenDrag && zenDrag.moved) zenSave(); zenDrag = null; };
  zenCanvas.addEventListener("mouseup", endDrag);
  zenCanvas.addEventListener("mouseleave", endDrag);
  zenCanvas.addEventListener("dblclick", (e) => {
    const p = zenCanvasPoint(e);
    if (zenTool === "bend") {
      const i = (ZEN.bends || []).findIndex((b) => Math.hypot(p.x - b.x, p.y - b.y) < 18);
      if (i !== -1) { ZEN.bends.splice(i, 1); zenDraw(); zenSave(); }
      return;
    }
    const it = zenHitItem(p);
    if (it) { ZEN.items = ZEN.items.filter((x) => x !== it); zenDraw(); zenSave(); }
  });

  board.append(wrap);
  zenDraw();
}

async function zenSetBackdrop() {
  if (!zenCanvas) return;
  const keepTool = zenTool;
  zenTool = "move"; zenDraw();          // render without bend markers
  // The backdrop is stored in D1, which caps a row at 2 MB. A big garden can
  // exceed that as a PNG, so fall back to JPEG rather than failing the save.
  let dataUrl = zenCanvas.toDataURL("image/png");
  if (dataUrl.length > 1400000) dataUrl = zenCanvas.toDataURL("image/jpeg", 0.85);
  zenTool = keepTool; zenDraw();
  try {
    const resp = await api("/api/zen-backdrop", { method: "POST", body: JSON.stringify({ dataUrl }) });
    STATE.settings.zen_backdrop = resp.value;
    STATE.settings.zen_backdrop_on = "1";           // saving turns it on
    saveSetting("zen_backdrop_on", "1");
    applyZenBackdrop();
    render();                                        // surface the on/off toggle
  } catch (err) {
    console.error("[zen] backdrop save failed:", err);
    alert("Couldn't save the backdrop — see console.");
  }
}
async function zenClearBackdrop() {
  try {
    await api("/api/zen-backdrop", { method: "DELETE" });
    STATE.settings.zen_backdrop = "";
    STATE.settings.zen_backdrop_on = "";
    applyZenBackdrop();
    render();                                        // remove the on/off toggle
  } catch (err) { console.error("[zen] backdrop clear failed:", err); }
}

// A fixed layer behind everything showing the garden at full strength. Empty
// page space is fully transparent (you see the garden); content panels go 50%
// translucent via the body.zen-bg overrides in style.css. Turned on/off by
// settings["zen_backdrop"].
function zenAlpha() {
  const v = Number(STATE.settings && STATE.settings.zen_alpha);
  return (v >= 0.2 && v <= 0.95) ? v : 0.5;
}
function zenApplyAlpha() {
  const a = zenAlpha();
  document.body.style.setProperty("--zen-alpha", String(a));
  document.body.style.setProperty("--zen-alpha-soft", String(Math.max(0.12, a * 0.6)));
}
// Has a garden ever been saved as a backdrop? (an image + stamp exist)
function zenBackdropSaved() {
  return !!(STATE.settings && STATE.settings.zen_backdrop);
}
// Is the backdrop switched on? Defaults to ON when a backdrop was just saved
// (unset setting) so existing behavior is preserved, but a user who has never
// set one — anyone starting from scratch — has no backdrop and a white page.
function zenBackdropOn() {
  if (!zenBackdropSaved()) return false;
  const v = STATE.settings.zen_backdrop_on;
  return v === undefined || v === null || v === "" ? true : v === "1";
}
function applyZenBackdrop() {
  const show = zenBackdropSaved() && zenBackdropOn();
  const stamp = STATE.settings && STATE.settings.zen_backdrop;
  let layer = document.getElementById("zen-backdrop-layer");
  document.body.classList.toggle("zen-bg", show);
  zenApplyAlpha();
  if (!show) { if (layer) layer.remove(); return; }
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "zen-backdrop-layer";
    layer.style.cssText = "position:fixed;inset:0;z-index:-1;background-size:cover;background-position:center;";
    document.body.prepend(layer);
  }
  layer.style.backgroundImage = `url(/static/zen_backdrop.png?v=${encodeURIComponent(stamp)})`;
}

function zenInjectCss() {
  if (document.getElementById("zen-extra-css")) return;
  const css = `
  .zen-wrap{padding:20px 28px;max-width:1400px;margin:0 auto}
  .zen-rail{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .zen-rail-div{width:1px;height:26px;background:var(--light-gray)}
  .zen-tool{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--light-gray);background:#fff;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;font-family:inherit}
  .zen-tool:hover{background:var(--off-white)}
  .zen-tool.on{background:var(--teal);border-color:var(--teal);color:#fff}
  .zen-tool-ic{font-size:14px;line-height:1}
  .zen-bar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .zen-seg{display:flex;align-items:center;gap:8px}
  .zen-seg label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#7a8a86}
  .zen-seg input[type=range]{width:130px;accent-color:var(--teal)}
  .zen-seg-val{font-size:12px;font-weight:700;color:var(--teal);min-width:16px;text-align:center}
  .zen-canvas-wrap{border:1px solid var(--light-gray);border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.06);background:#f8ecdb}
  .zen-canvas{display:block;width:100%;height:auto;cursor:crosshair}
  .zen-hint{font-size:11.5px;color:#9aa8a3;margin-top:8px;line-height:1.5}
  `;
  const st = document.createElement("style"); st.id = "zen-extra-css"; st.textContent = css;
  document.head.appendChild(st);
}


// ============================================================================
// Banner wood — the app header is a panel of oak: staggered planks with wavy
// grain, a knot or two, dark seams. Painted procedurally (seeded, so it's the
// same wood every launch) and repainted crisp on resize.
// ============================================================================
function zenPaintBanner() {
  const cv = document.getElementById("banner-sand");
  if (!cv) return;
  const banner = cv.parentElement;
  const w = banner.clientWidth, h = banner.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rand = zenRng(7777);
  const nP = Math.max(2, Math.round(h / 46));         // plank rows
  const ph = h / nP;
  // Oak tones — one per plank, slight variation
  // Plank tones follow the theme: oak for Radio, weathered driftwood for Shore.
  const dark = document.body.classList.contains("theme-dark");
  // Driftwood-olive planks; darker still on the Wet Slate ground.
  const tones = dark
    ? [["#3a3b2f", "#2b2c24"], ["#43442f", "#31321f"],
       ["#35362a", "#26271d"], ["#4a4b39", "#37382a"]]
    : [["#77785a", "#5f6047"], ["#8a8b6b", "#6b6c52"],
       ["#6f7053", "#585940"], ["#a69c89", "#877f6d"]];
  const grainDark = "rgba(22,24,15,0.32)";
  const grainLite = dark ? "rgba(225,226,216,0.10)" : "rgba(225,226,216,0.18)";
  const seamDark = "rgba(16,18,13,0.66)";
  const seamLite = dark ? "rgba(225,226,216,0.09)" : "rgba(225,226,216,0.16)";

  for (let p = 0; p < nP; p++) {
    const y0 = p * ph;
    const [t1, t2] = tones[Math.floor(rand() * tones.length)];
    const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
    g.addColorStop(0, t1); g.addColorStop(1, t2);
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, ph);

    // Grain: long wavy streaks along the plank
    const nGrain = 9 + Math.floor(rand() * 6);
    for (let i = 0; i < nGrain; i++) {
      const gy = y0 + 3 + rand() * (ph - 6);
      const amp = 0.6 + rand() * 1.8;
      const wav = 90 + rand() * 240;
      const ph2 = rand() * 6.28;
      const dark = rand() < 0.75;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 7) {
        const yy = gy + Math.sin(x / wav + ph2) * amp + Math.sin(x / 23 + ph2 * 2) * 0.5;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = dark ? grainDark : grainLite;
      ctx.lineWidth = dark ? 0.9 + rand() * 0.9 : 0.8;
      ctx.stroke();
    }

    // Occasional knot: concentric distorted rings
    if (rand() < 0.5) {
      const kx = w * (0.08 + rand() * 0.84), ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let r = 7; r > 0; r--) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * 2.6 + rand(), r * 1.5 + rand() * 0.6, rand() * 0.4 - 0.2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(22,24,15,${0.16 + (7 - r) * 0.05})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(kx, ky, 2.4, 1.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(16,18,13,0.8)"; ctx.fill();
    }

    // Vertical butt joints, staggered per row
    const nJ = 1 + Math.floor(rand() * 2);
    for (let j = 0; j < nJ; j++) {
      const jx = w * ((j + 0.25 + rand() * 0.5 + p * 0.33) % 1);
      ctx.fillStyle = seamDark;
      ctx.fillRect(jx, y0 + 1, 1.6, ph - 2);
      ctx.fillStyle = seamLite;
      ctx.fillRect(jx + 1.6, y0 + 1, 1, ph - 2);
    }

    // Horizontal seam between planks
    if (p > 0) {
      ctx.fillStyle = seamDark;
      ctx.fillRect(0, y0 - 1, w, 2);
      ctx.fillStyle = seamLite;
      ctx.fillRect(0, y0 + 1, w, 1);
    }
  }

  // Fine speckle + soft vignette to seat the chrome on it
  ctx.fillStyle = "rgba(22,24,15,0.06)";
  for (let i = 0; i < Math.round(w * h / 900); i++) ctx.fillRect(rand() * w, rand() * h, 1.2, 1.2);
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, "rgba(0,0,0,0.10)"); v.addColorStop(0.25, "rgba(0,0,0,0)");
  v.addColorStop(0.8, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

// Paint now (scripts run after the DOM) and again on resize
zenPaintBanner();
(() => {
  let t = null;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(zenPaintBanner, 160); });
})();
