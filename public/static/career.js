/* Radio Station — career.js
   Career Notes — what the work is actually like, logged as it happens.

   Five surfaces: Quick Capture, Dimensions, Ikigai synthesis, Working
   Principles (+ Terms), and Baseline & comparison.

   State lives in one JSON blob at settings.career_notes, loaded into CAREER,
   saved through saveSetting() like GOALS/settings.goals_os. career/seed_baseline.py
   writes `schema`, `dimensions` and `baselines[0]` before this tab ever runs;
   normalizeCareer() only fills what's missing and never recreates them.

   The twelve dimension KEYS are load-bearing — every entry files under one.
   Rename a key and you orphan its entries. Hide a dimension instead.

   Load order matters: see templates/index.html. Classic scripts share one global scope. */

const CAREER_KEY = "career_notes";
const CAREER_SCHEMA = "career_notes/1";
let CAREER = null;
let careerSaveT = null;
let careerDirty = false;

// Fallback dimension set, used only when nothing has been seeded yet (a fresh
// install, or the tab opened before career/seed_baseline.py was run). Keys match
// the baseline snapshot exactly.
const CAREER_DIM_SEED = [
  { key: "work_type",     label: "Work type",             hint: "Precision craft vs. judgment calls" },
  { key: "cognitive_fit", label: "Cognitive fit",         hint: "Pace, depth, interruption tolerance" },
  { key: "autonomy",      label: "Autonomy & ownership",  hint: "Trusted to run vs. checked" },
  { key: "collaboration", label: "People & collaboration", hint: "Who you work with, and how" },
  { key: "mgmt_style",    label: "Management style",      hint: "How you're led" },
  { key: "leadership",    label: "Leadership identity",   hint: "Who you're becoming" },
  { key: "subject",       label: "Subject matter",        hint: "Content you'd read on a Saturday" },
  { key: "craft",         label: "Craft & mastery",       hint: "Skills you want to be excellent at" },
  { key: "impact",        label: "Impact & purpose",      hint: "Whether the work mattered" },
  { key: "ambiguity",     label: "Ambiguity & structure", hint: "Clear brief vs. open question" },
  { key: "rhythm",        label: "Workload rhythm",       hint: "Steady drumbeat vs. deal spikes" },
  { key: "tooling",       label: "Tooling & friction",    hint: "State of the systems you work in" },
];

// Work type carries two readings that aren't separate dimensions — they're the
// two halves of the same question, shown as sub-labels inside its card.
const CAREER_SUBLABELS = {
  work_type: ["Attention to detail", "Judgment / decision quality"],
};

const CAREER_VALENCE = [
  { key: "thrive",  label: "Thrive",  color: "#38a66f" },
  { key: "neutral", label: "Neutral", color: "#b3b3b3" },
  { key: "drain",   label: "Drain",   color: "#c0782a" },
];
function careerValence(k) { return CAREER_VALENCE.find((v) => v.key === k) || CAREER_VALENCE[1]; }

const CAREER_PROMPTS = [
  "What do I wish I was doing less of?",
  "What do I wish I was doing more of?",
  "What environments fit my brain?",
  "What did I love doing this week?",
  "What did I hate doing?",
  "Who am I becoming as a leader?",
  "What opportunities do I relish?",
];

// The four circles. "paid_for" is deliberately fed by the Terms card rather
// than by starred entries — what you can be paid for is negotiated annually,
// not observed week to week.
const CAREER_CIRCLES = [
  { key: "love",        label: "What I love",             hint: "Pulls you in on a Saturday" },
  { key: "good_at",     label: "What I'm good at",        hint: "Where the work lands cleanly" },
  { key: "world_needs", label: "What the world needs",    hint: "Worth someone's while" },
  { key: "paid_for",    label: "What I can be paid for",  hint: "Drawn from your terms, not your entries" },
];
const CAREER_OVERLAPS = [
  { key: "passion",    label: "Passion",    a: "love",        b: "good_at" },
  { key: "mission",    label: "Mission",    a: "love",        b: "world_needs" },
  { key: "profession", label: "Profession", a: "good_at",     b: "paid_for" },
  { key: "vocation",   label: "Vocation",   a: "world_needs", b: "paid_for" },
];

const CAREER_TERM_SEED = [
  "Compensation", "Vacation", "Flexibility", "Travel",
  "Geography", "Title and pace", "Stability vs. upside", "Hours",
];

// Comparison stays locked until there's enough logged to outweigh the baseline.
const CAREER_MIN_ENTRIES = 30;
const CAREER_MIN_PER_DIM = 3;

let careerOpenDims = new Set();     // dimension cards with entries expanded
let careerPromptOffset = 0;         // manual cycling of the daily prompt

// ---- State ----------------------------------------------------------------
function normalizeCareer() {
  if (CAREER) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[CAREER_KEY]) || "{}"); } catch (e) { saved = {}; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  CAREER = Object.assign({
    schema: CAREER_SCHEMA, dimensions: [], entries: [],
    ikigai: { love: "", good_at: "", world_needs: "", paid_for: "" },
    principles: [], terms: [], baselines: [], prompt_seed: 0,
  }, saved);
  if (!Array.isArray(CAREER.dimensions)) CAREER.dimensions = [];
  if (!Array.isArray(CAREER.entries)) CAREER.entries = [];
  if (!Array.isArray(CAREER.principles)) CAREER.principles = [];
  if (!Array.isArray(CAREER.terms)) CAREER.terms = [];
  if (!Array.isArray(CAREER.baselines)) CAREER.baselines = [];
  if (!CAREER.ikigai || typeof CAREER.ikigai !== "object") {
    CAREER.ikigai = { love: "", good_at: "", world_needs: "", paid_for: "" };
  }
  // Only seed dimensions when there are none — the seeder owns them otherwise.
  if (!CAREER.dimensions.length) {
    CAREER.dimensions = CAREER_DIM_SEED.map((d) => ({ ...d, hidden: false }));
  }
  if (!CAREER.terms.length) {
    CAREER.terms = CAREER_TERM_SEED.map((t, i) => ({ id: "tm_" + i, text: t }));
  }
  CAREER.entries.forEach((e) => {
    if (!Array.isArray(e.ikigai)) e.ikigai = [];
    if (!e.valence) e.valence = "neutral";
  });
  CAREER.schema = CAREER_SCHEMA;
}
function careerSave(immediate) {
  careerDirty = true;
  clearTimeout(careerSaveT);
  const flush = () => {
    careerSaveT = null;
    careerDirty = false;
    STATE.settings[CAREER_KEY] = JSON.stringify(CAREER);
    saveSetting(CAREER_KEY, STATE.settings[CAREER_KEY]);
  };
  if (immediate) { flush(); return; }
  careerSaveT = setTimeout(flush, 500);
}
// Recovery path: anything typed and clicked away from is already saved, and a
// pending save is flushed before the page can go anywhere.
function careerFlush() {
  if (!careerDirty) return;
  clearTimeout(careerSaveT);
  careerSaveT = null;
  careerDirty = false;
  STATE.settings[CAREER_KEY] = JSON.stringify(CAREER);
  saveSetting(CAREER_KEY, STATE.settings[CAREER_KEY]);
}
window.addEventListener("beforeunload", () => { try { careerFlush(); } catch (e) {} });
window.addEventListener("blur", () => { try { careerFlush(); } catch (e) {} });

function careerUid() { return "c_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function careerDims() { return (CAREER.dimensions || []).filter((d) => !d.hidden); }
function careerDim(key) { return (CAREER.dimensions || []).find((d) => d.key === key) || null; }
function careerDimLabel(key) { const d = careerDim(key); return d ? d.label : key; }
function careerEntriesFor(key) { return (CAREER.entries || []).filter((e) => e.dim === key); }
function careerTally(key) {
  const list = careerEntriesFor(key);
  return {
    thrive: list.filter((e) => e.valence === "thrive").length,
    neutral: list.filter((e) => e.valence === "neutral").length,
    drain: list.filter((e) => e.valence === "drain").length,
    total: list.length,
  };
}
function careerWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
// One prompt per day, same for the whole day, cycled by the button.
function careerPrompt() {
  const epochDay = Math.floor(Date.now() / 86400000);
  const i = (epochDay + (CAREER.prompt_seed || 0) + careerPromptOffset) % CAREER_PROMPTS.length;
  return CAREER_PROMPTS[(i + CAREER_PROMPTS.length) % CAREER_PROMPTS.length];
}

// ---- Render ---------------------------------------------------------------
let careerSection = "capture";
const CAREER_SECTIONS = [
  ["capture",    "Quick Capture"],
  ["dims",       "Dimensions"],
  ["ikigai",     "Ikigai"],
  ["principles", "Principles"],
  ["baseline",   "Baseline"],
];

function renderCareer() {
  normalizeCareer();
  const board = $("#board");
  const wrap = el("div", { class: "cn-wrap" });

  const head = el("div", { class: "cn-head" });
  const ht = el("div", {});
  ht.append(el("h2", { class: "cn-h2" }, "Career Notes"));
  ht.append(el("div", { class: "cn-sub" }, "What the work is actually like \u2014 logged as it happens, not remembered later."));
  head.append(ht);
  const hb = el("div", { class: "cn-headbtns" });
  hb.append(el("button", { class: "tool-btn", title: "Download everything in Career Notes as a JSON snapshot", onClick: careerExport }, "\u2193 Export"));
  hb.append(el("button", { class: "tool-btn", title: "Rebuild from a snapshot", onClick: careerImport }, "\u2191 Import"));
  head.append(hb);
  wrap.append(head);

  const tabs = el("div", { class: "cn-tabs" });
  CAREER_SECTIONS.forEach(([k, label]) => {
    const t = el("button", { class: "cn-tab" + (careerSection === k ? " on" : ""),
      onClick: () => { careerFlush(); careerSection = k; render(); } }, label);
    if (k === "capture" && CAREER.entries.length) t.append(el("span", { class: "cn-tab-n" }, String(CAREER.entries.length)));
    tabs.append(t);
  });
  wrap.append(tabs);

  const body = el("div", { class: "cn-body" });
  wrap.append(body);
  board.append(wrap);

  if (careerSection === "capture") renderCareerCapture(body);
  else if (careerSection === "dims") renderCareerDims(body);
  else if (careerSection === "ikigai") renderCareerIkigai(body);
  else if (careerSection === "principles") renderCareerPrinciples(body);
  else renderCareerBaseline(body);
}

// ---- 1. Quick Capture ------------------------------------------------------
function renderCareerCapture(host) {
  // Rotating reflection prompt. The baseline ranking is deliberately absent
  // from this surface — seeing it while logging biases what gets noticed.
  const pr = el("div", { class: "cn-prompt" });
  pr.append(el("span", { class: "cn-prompt-q" }, careerPrompt()));
  pr.append(el("button", { class: "cn-prompt-cycle", title: "Another prompt",
    onClick: () => { careerPromptOffset++; host.innerHTML = ""; renderCareerCapture(host); } }, "\u21BB"));
  host.append(pr);

  const row = el("div", { class: "cn-addrow" });
  const text = el("input", { class: "cn-in", type: "text", placeholder: "What happened? One line." });
  const dim = el("select", { class: "cn-sel" });
  dim.append(el("option", { value: "" }, "Dimension\u2026"));
  careerDims().forEach((d) => dim.append(el("option", { value: d.key }, d.label)));
  const val = el("div", { class: "cn-val" });
  let valence = "thrive";
  const valBtns = {};
  CAREER_VALENCE.forEach((v) => {
    const btn = el("button", { class: "cn-valbtn" + (v.key === valence ? " on" : ""),
      style: `--vc:${v.color}`, title: v.label,
      onClick: () => { valence = v.key; Object.keys(valBtns).forEach((k) => valBtns[k].classList.toggle("on", k === valence)); } }, v.label);
    valBtns[v.key] = btn;
    val.append(btn);
  });
  const add = () => {
    const t = text.value.trim();
    if (!t) return;
    if (!dim.value) { dim.classList.add("cn-need"); setTimeout(() => dim.classList.remove("cn-need"), 900); return; }
    CAREER.entries.push({ id: careerUid(), text: t, dim: dim.value, valence, ts: new Date().toISOString(), ikigai: [] });
    careerSave(true);
    text.value = "";
    host.innerHTML = "";
    renderCareerCapture(host);
    const again = host.querySelector(".cn-in");
    if (again) again.focus();
  };
  text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  row.append(text, dim, val);
  row.append(el("button", { class: "tool-btn accent-teal", onClick: add }, "+ Log"));
  host.append(row);

  const feed = el("div", { class: "cn-feed" });
  const list = (CAREER.entries || []).slice().sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))).slice(0, 10);
  if (!list.length) {
    feed.append(el("div", { class: "cn-empty" }, "Nothing logged yet. One line about how today's work actually felt is enough."));
  }
  list.forEach((e) => feed.append(careerEntryRow(e, host)));
  host.append(feed);
  if (CAREER.entries.length > 10) {
    host.append(el("div", { class: "cn-more" }, `${CAREER.entries.length - 10} older entr${CAREER.entries.length - 10 === 1 ? "y" : "ies"} \u2014 see them on each dimension's card.`));
  }
}

function careerEntryRow(e, host) {
  const v = careerValence(e.valence);
  const row = el("div", { class: "cn-entry", style: `--vc:${v.color}` });
  const main = el("div", { class: "cn-entry-main" });
  const txt = el("span", { class: "cn-entry-text", title: "Click to edit" }, e.text);
  txt.addEventListener("click", () => {
    if (txt.isContentEditable) return;
    txt.contentEditable = "true"; txt.focus();
    const sel = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(txt); sel.removeAllRanges(); sel.addRange(r);
  });
  txt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); txt.blur(); }
    if (ev.key === "Escape") { txt.textContent = e.text; txt.blur(); }
  });
  txt.addEventListener("blur", () => {                       // click-out saves
    txt.contentEditable = "false";
    const nv = txt.textContent.trim();
    if (nv && nv !== e.text) { e.text = nv; careerSave(true); }
    else txt.textContent = e.text;
  });
  main.append(txt);
  row.append(main);

  const meta = el("div", { class: "cn-entry-meta" });
  meta.append(el("span", { class: "cn-chip" }, careerDimLabel(e.dim)));
  meta.append(el("span", { class: "cn-vdot", style: `background:${v.color}`, title: v.label }));
  meta.append(el("span", { class: "cn-when" }, careerWhen(e.ts)));
  meta.append(el("button", { class: "cn-x", title: "Draft a working principle from this",
    onClick: () => careerPromote(e) }, "+ promote"));
  meta.append(el("button", { class: "cn-x danger", title: "Delete this entry",
    onClick: () => {
      if (!confirm("Delete this entry?")) return;
      CAREER.entries = CAREER.entries.filter((x) => x.id !== e.id);
      careerSave(true);
      if (host) { host.innerHTML = ""; renderCareerCapture(host); } else render();
    } }, "\u00D7"));
  row.append(meta);
  return row;
}

function careerPromote(e) {
  const draft = prompt("Working principle, in one line:", e.text);
  if (!draft || !draft.trim()) return;
  CAREER.principles.push({ id: careerUid(), text: draft.trim(), from: e.text });
  careerSave(true);
  careerSection = "principles";
  render();
}

// ---- 2. Dimensions ---------------------------------------------------------
function renderCareerDims(host) {
  const grid = el("div", { class: "cn-dimgrid" });
  careerDims().forEach((d) => {
    const t = careerTally(d.key);
    const card = el("div", { class: "cn-dimcard" });
    const h = el("div", { class: "cn-dim-h" });
    h.append(el("span", { class: "cn-dim-name" }, d.label));
    h.append(el("span", { class: "cn-dim-n" }, `${t.total} entr${t.total === 1 ? "y" : "ies"}`));
    card.append(h);
    if (d.hint) card.append(el("div", { class: "cn-dim-hint" }, d.hint));

    (CAREER_SUBLABELS[d.key] || []).forEach((sl) => {
      card.append(el("span", { class: "cn-sublabel" }, sl));
    });

    // Thrive / neutral / drain proportions
    const bar = el("div", { class: "cn-tally" });
    if (t.total) {
      CAREER_VALENCE.forEach((v) => {
        const n = t[v.key];
        if (!n) return;
        bar.append(el("div", { class: "cn-tally-seg", style: `width:${(100 * n / t.total).toFixed(1)}%;background:${v.color}`,
          title: `${n} ${v.label}` }));
      });
    } else bar.append(el("div", { class: "cn-tally-seg empty", style: "width:100%" }));
    card.append(bar);
    card.append(el("div", { class: "cn-tally-key" },
      t.total ? `${t.thrive} thrive \u00B7 ${t.neutral} neutral \u00B7 ${t.drain} drain` : "no entries yet"));

    // Current read — a one-liner you keep rewriting as the picture firms up
    const read = el("input", { class: "cn-read", type: "text", value: d.read || "",
      placeholder: "Current read \u2014 one line" });
    read.addEventListener("input", () => { d.read = read.value; careerSave(); });
    read.addEventListener("blur", careerFlush);
    card.append(read);

    const open = careerOpenDims.has(d.key);
    const toggle = el("button", { class: "cn-caret" + (open ? " open" : ""),
      onClick: () => { if (open) careerOpenDims.delete(d.key); else careerOpenDims.add(d.key);
                       host.innerHTML = ""; renderCareerDims(host); } },
      `${open ? "\u25BE" : "\u25B8"} ${t.total} entr${t.total === 1 ? "y" : "ies"}`);
    card.append(toggle);
    if (open) {
      const list = el("div", { class: "cn-dim-entries" });
      careerEntriesFor(d.key).slice().reverse().forEach((e) => {
        const v = careerValence(e.valence);
        const r = el("div", { class: "cn-dim-entry" });
        r.append(el("span", { class: "cn-vdot", style: `background:${v.color}` }));
        r.append(el("span", { class: "cn-dim-entry-t" }, e.text));
        r.append(el("span", { class: "cn-when" }, careerWhen(e.ts)));
        list.append(r);
      });
      if (!careerEntriesFor(d.key).length) list.append(el("div", { class: "cn-empty" }, "Nothing here yet."));
      card.append(list);
    }
    grid.append(card);
  });
  host.append(grid);
}

// ---- 3. Ikigai -------------------------------------------------------------
function careerCircleEntries(ck) {
  if (ck === "paid_for") return [];                       // fed by Terms instead
  return (CAREER.entries || []).filter((e) => (e.ikigai || []).includes(ck));
}
// An entry logged from a circle is still a normal entry — it just arrives
// already starred into that circle. Every entry files under a dimension, so
// the row carries a dimension picker; it remembers the last one used so
// logging several in a row is quick.
let careerLastDim = "";
// An item inside a circle is a full entry, so it can be edited, refiled under
// a different dimension, taken out of this circle, or deleted outright — the
// same operations Quick Capture offers, without leaving the synthesis.
function careerIkiItem(e, circle, host) {
  const row = el("div", { class: "cn-iki-item" });
  const txt = el("span", { class: "cn-iki-item-t", title: "Click to edit" }, e.text);
  txt.addEventListener("click", () => {
    if (txt.isContentEditable) return;
    txt.contentEditable = "true"; txt.focus();
    const sel = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(txt); sel.removeAllRanges(); sel.addRange(r);
  });
  txt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); txt.blur(); }
    if (ev.key === "Escape") { txt.textContent = e.text; txt.blur(); }
  });
  txt.addEventListener("blur", () => {
    txt.contentEditable = "false";
    const v = txt.textContent.trim();
    if (v && v !== e.text) { e.text = v; careerSave(true); }
    else txt.textContent = e.text;
  });
  row.append(txt);

  // Refile under a different dimension without losing the circle it sits in
  const dim = el("select", { class: "cn-iki-item-dim", title: "Which dimension this files under" });
  careerDims().forEach((d) => dim.append(el("option",
    Object.assign({ value: d.key }, d.key === e.dim ? { selected: "selected" } : {}), d.label)));
  dim.addEventListener("change", () => { e.dim = dim.value; careerSave(true); });
  dim.addEventListener("click", (ev) => ev.stopPropagation());
  row.append(dim);

  row.append(el("button", { class: "cn-iki-item-x", title: `Take out of "${circle.label}" (the entry stays)`,
    onClick: () => {
      e.ikigai = (e.ikigai || []).filter((k) => k !== circle.key);
      careerSave(true);
      host.innerHTML = ""; renderCareerIkigai(host);
    } }, "\u2296"));
  row.append(el("button", { class: "cn-iki-item-x danger", title: "Delete this entry everywhere",
    onClick: () => {
      if (!confirm(`Delete "${e.text}"?\n\nIt's removed from every circle and from your entries.`)) return;
      CAREER.entries = CAREER.entries.filter((x) => x.id !== e.id);
      careerSave(true);
      host.innerHTML = ""; renderCareerIkigai(host);
    } }, "\u00D7"));
  return row;
}

function careerCircleAdd(circle, host) {
  const wrap = el("div", { class: "cn-iki-add" });
  const inp = el("input", { class: "cn-iki-addin", type: "text",
    placeholder: "Add to " + circle.label.replace(/^What (I |the world )?/i, "").replace(/^I'?m /, "") + "\u2026" });
  const dim = el("select", { class: "cn-iki-adddim", title: "Which dimension does this sit under?" });
  careerDims().forEach((d) => dim.append(el("option",
    Object.assign({ value: d.key }, d.key === (careerLastDim || careerDims()[0].key) ? { selected: "selected" } : {}), d.label)));
  const add = () => {
    const t = inp.value.trim();
    if (!t) return;
    careerLastDim = dim.value;
    CAREER.entries.push({ id: careerUid(), text: t, dim: dim.value, valence: "thrive",
                          ts: new Date().toISOString(), ikigai: [circle.key] });
    careerSave(true);
    host.innerHTML = "";
    renderCareerIkigai(host);
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  wrap.append(inp, dim);
  wrap.append(el("button", { class: "cn-iki-addbtn", onClick: add }, "+"));
  return wrap;
}

function renderCareerIkigai(host) {
  const grid = el("div", { class: "cn-ikigrid" });
  CAREER_CIRCLES.forEach((c) => {
    const card = el("div", { class: "cn-ikicard" });
    card.append(el("div", { class: "cn-iki-h" }, c.label));
    card.append(el("div", { class: "cn-iki-hint" }, c.hint));
    const stmt = el("textarea", { class: "cn-iki-stmt", rows: "2", placeholder: "In your own words\u2026" });
    stmt.value = (CAREER.ikigai || {})[c.key] || "";
    stmt.addEventListener("input", () => { CAREER.ikigai[c.key] = stmt.value; careerSave(); });
    stmt.addEventListener("blur", careerFlush);
    card.append(stmt);

    if (c.key === "paid_for") {
      const terms = el("div", { class: "cn-iki-list" });
      (CAREER.terms || []).forEach((t, i) => {
        terms.append(el("div", { class: "cn-iki-item" }, `${i + 1}. ${t.text}`));
      });
      card.append(el("div", { class: "cn-iki-src" }, "From your ranked terms \u2014 edit them under Principles."));
      card.append(terms);
    } else {
      const list = careerCircleEntries(c.key);
      const box = el("div", { class: "cn-iki-list" });
      if (!list.length) box.append(el("div", { class: "cn-empty" }, "Nothing in this circle yet \u2014 add one below."));
      list.slice(-6).forEach((e) => box.append(careerIkiItem(e, c, host)));
      if (list.length > 6) box.append(el("div", { class: "cn-more" }, `+${list.length - 6} more`));
      card.append(el("div", { class: "cn-iki-count" }, `${list.length} entr${list.length === 1 ? "y" : "ies"}`));
      card.append(box);
      card.append(careerCircleAdd(c, host));
    }
    grid.append(card);
  });
  host.append(grid);

  // Derived overlaps — each names its two parent circles and the count in both
  const ov = el("div", { class: "cn-ovgrid" });
  CAREER_OVERLAPS.forEach((o) => {
    const a = new Set(careerCircleEntries(o.a).map((e) => e.id));
    const both = careerCircleEntries(o.b).filter((e) => a.has(e.id));
    const cell = el("div", { class: "cn-ov" + (both.length ? " on" : "") });
    cell.append(el("div", { class: "cn-ov-name" }, o.label));
    cell.append(el("div", { class: "cn-ov-parents" },
      `${CAREER_CIRCLES.find((c) => c.key === o.a).label} + ${CAREER_CIRCLES.find((c) => c.key === o.b).label}`));
    cell.append(el("div", { class: "cn-ov-n" }, `${both.length} in both`));
    ov.append(cell);
  });
  host.append(ov);

  // The centre: an entry sitting in every circle
  const all = (CAREER.entries || []).filter((e) => {
    const s = e.ikigai || [];
    return ["love", "good_at", "world_needs"].every((k) => s.includes(k)) && s.includes("paid_for");
  });
  if (all.length) {
    const c = el("div", { class: "cn-ikigai-centre" });
    c.append(el("div", { class: "cn-ikigai-h" }, "\u25C9 Ikigai"));
    all.forEach((e) => c.append(el("div", { class: "cn-ikigai-item" }, e.text)));
    host.append(c);
  }

  // Star entries into circles
  host.append(el("div", { class: "cn-sec-h" }, "Star entries into circles"));
  const starList = el("div", { class: "cn-starlist" });
  const recent = (CAREER.entries || []).slice().sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))).slice(0, 20);
  if (!recent.length) starList.append(el("div", { class: "cn-empty" },
    "Nothing logged yet. Add straight into a circle above, or log entries in Quick Capture and star them here."));
  recent.forEach((e) => {
    const r = el("div", { class: "cn-star" });
    r.append(el("span", { class: "cn-star-t" }, e.text));
    const btns = el("div", { class: "cn-star-btns" });
    CAREER_CIRCLES.forEach((c) => {
      const on = (e.ikigai || []).includes(c.key);
      btns.append(el("button", { class: "cn-starbtn" + (on ? " on" : ""), title: c.label,
        onClick: () => {
          e.ikigai = e.ikigai || [];
          if (e.ikigai.includes(c.key)) e.ikigai = e.ikigai.filter((x) => x !== c.key);
          else e.ikigai.push(c.key);                      // one entry can sit in several
          careerSave(true);
          host.innerHTML = ""; renderCareerIkigai(host);
        } }, c.label.replace(/^What (I |the world )?/i, "").replace(/^I'?m /, "")));
    });
    r.append(btns);
    starList.append(r);
  });
  host.append(starList);
}

// ---- 4. Working Principles + Terms ----------------------------------------
function renderCareerPrinciples(host) {
  const head = el("div", { class: "cn-sec-head" });
  head.append(el("div", { class: "cn-sec-h" }, "Working principles"));
  head.append(el("button", { class: "tool-btn accent-teal", onClick: () => {
    const t = prompt("Working principle, in one line:");
    if (!t || !t.trim()) return;
    CAREER.principles.push({ id: careerUid(), text: t.trim(), from: "" });
    careerSave(true); host.innerHTML = ""; renderCareerPrinciples(host);
  } }, "+ New principle"));
  host.append(head);

  const list = el("div", { class: "cn-prlist" });
  if (!CAREER.principles.length) {
    list.append(el("div", { class: "cn-empty" }, "None yet \u2014 use \u201C+ promote\u201D on an entry, or add one directly."));
  }
  CAREER.principles.forEach((p, idx) => {
    const r = el("div", { class: "cn-pr", draggable: "true", "data-idx": String(idx) });
    r.append(el("span", { class: "cn-pr-n" }, String(idx + 1)));
    const t = el("span", { class: "cn-pr-t", title: "Click to edit" }, p.text);
    t.addEventListener("click", () => {
      if (t.isContentEditable) return;
      t.contentEditable = "true"; t.focus();
      const sel = window.getSelection(); const rg = document.createRange();
      rg.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(rg);
    });
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); t.blur(); }
      if (e.key === "Escape") { t.textContent = p.text; t.blur(); }
    });
    t.addEventListener("blur", () => {
      t.contentEditable = "false";
      const nv = t.textContent.trim();
      if (nv && nv !== p.text) { p.text = nv; careerSave(true); } else t.textContent = p.text;
    });
    r.append(t);
    const from = el("input", { class: "cn-pr-from", type: "text", value: p.from || "", placeholder: "learned from\u2026" });
    from.addEventListener("input", () => { p.from = from.value; careerSave(); });
    from.addEventListener("blur", careerFlush);
    r.append(from);
    r.append(el("button", { class: "cn-x danger", title: "Delete", onClick: () => {
      if (!confirm(`Delete principle "${p.text}"?`)) return;
      CAREER.principles = CAREER.principles.filter((x) => x.id !== p.id);
      careerSave(true); host.innerHTML = ""; renderCareerPrinciples(host);
    } }, "\u00D7"));

    r.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(idx)); r.classList.add("dragging"); });
    r.addEventListener("dragend", () => r.classList.remove("dragging"));
    r.addEventListener("dragover", (e) => { e.preventDefault(); r.classList.add("dragover"); });
    r.addEventListener("dragleave", () => r.classList.remove("dragover"));
    r.addEventListener("drop", (e) => {
      e.preventDefault(); r.classList.remove("dragover");
      const from2 = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(from2) || from2 === idx) return;
      const moved = CAREER.principles.splice(from2, 1)[0];
      CAREER.principles.splice(idx, 0, moved);
      careerSave(true); host.innerHTML = ""; renderCareerPrinciples(host);
    });
    list.append(r);
  });
  host.append(list);

  // Terms — decided annually, not observed weekly, so they stay out of capture
  host.append(el("div", { class: "cn-sec-h", style: "margin-top:22px" }, "Terms"));
  host.append(el("div", { class: "cn-sec-note" },
    "Ranked, not logged \u2014 these are settled once a year, not noticed week to week. Drag to reorder."));
  const tl = el("div", { class: "cn-termlist" });
  (CAREER.terms || []).forEach((t, idx) => {
    const r = el("div", { class: "cn-term", draggable: "true" });
    r.append(el("span", { class: "cn-pr-n" }, String(idx + 1)));
    const tx = el("span", { class: "cn-pr-t", title: "Click to edit" }, t.text);
    tx.addEventListener("click", () => {
      if (tx.isContentEditable) return;
      tx.contentEditable = "true"; tx.focus();
    });
    tx.addEventListener("blur", () => {
      tx.contentEditable = "false";
      const nv = tx.textContent.trim();
      if (nv && nv !== t.text) { t.text = nv; careerSave(true); } else tx.textContent = t.text;
    });
    tx.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tx.blur(); } });
    r.append(tx);
    r.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", "T" + idx); r.classList.add("dragging"); });
    r.addEventListener("dragend", () => r.classList.remove("dragging"));
    r.addEventListener("dragover", (e) => { e.preventDefault(); r.classList.add("dragover"); });
    r.addEventListener("dragleave", () => r.classList.remove("dragover"));
    r.addEventListener("drop", (e) => {
      e.preventDefault(); r.classList.remove("dragover");
      const raw = e.dataTransfer.getData("text/plain");
      if (raw[0] !== "T") return;
      const f = parseInt(raw.slice(1), 10);
      if (isNaN(f) || f === idx) return;
      const moved = CAREER.terms.splice(f, 1)[0];
      CAREER.terms.splice(idx, 0, moved);
      careerSave(true); host.innerHTML = ""; renderCareerPrinciples(host);
    });
    tl.append(r);
  });
  host.append(tl);
}

// ---- 5. Baseline & comparison ---------------------------------------------
function careerLockState() {
  const total = (CAREER.entries || []).length;
  const dims = careerDims();
  const ready = dims.filter((d) => careerEntriesFor(d.key).length >= CAREER_MIN_PER_DIM);
  return {
    total, need: CAREER_MIN_ENTRIES,
    dimsReady: ready.length, dimsTotal: dims.length,
    unlocked: total >= CAREER_MIN_ENTRIES && ready.length === dims.length,
  };
}
function renderCareerBaseline(host) {
  const st = careerLockState();

  host.append(el("div", { class: "cn-sec-h" }, "Baselines"));
  const bl = el("div", { class: "cn-bllist" });
  if (!(CAREER.baselines || []).length) {
    bl.append(el("div", { class: "cn-empty" },
      "No baseline recorded yet. Run career/seed_baseline.py from the Radio Station folder with the app closed."));
  }
  (CAREER.baselines || []).forEach((b, i) => {
    const r = el("div", { class: "cn-bl" });
    r.append(el("span", { class: "cn-bl-date" }, b.taken || "\u2014"));
    r.append(el("span", { class: "cn-bl-meta" },
      `${(b.dimensions || []).length} dimensions \u00B7 ${(b.responses || []).length} forced choices`));
    if (i === 0) r.append(el("span", { class: "cn-bl-tag" }, "first"));
    if (i === CAREER.baselines.length - 1 && CAREER.baselines.length > 1) r.append(el("span", { class: "cn-bl-tag" }, "latest"));
    bl.append(r);
  });
  host.append(bl);
  host.append(el("div", { class: "cn-sec-note" },
    "Append-only. Retaking the quiz adds a baseline; nothing is ever overwritten."));

  host.append(el("div", { class: "cn-sec-h", style: "margin-top:22px" }, "Comparison"));
  if (!st.unlocked) {
    const lock = el("div", { class: "cn-lock" });
    lock.append(el("div", { class: "cn-lock-h" }, "\u25A0 Locked until there's enough logged to argue with it"));
    lock.append(el("div", { class: "cn-lock-why" },
      "Reading the baseline while you're still logging biases what you notice \u2014 which is the whole reason it was recorded before logging began."));
    const g = el("div", { class: "cn-lock-grid" });
    const c1 = el("div", { class: "cn-lock-cell" + (st.total >= st.need ? " done" : "") });
    c1.append(el("div", { class: "cn-lock-n" }, `${st.total} / ${st.need}`));
    c1.append(el("div", { class: "cn-lock-l" }, "entries logged"));
    g.append(c1);
    const c2 = el("div", { class: "cn-lock-cell" + (st.dimsReady === st.dimsTotal ? " done" : "") });
    c2.append(el("div", { class: "cn-lock-n" }, `${st.dimsReady} / ${st.dimsTotal}`));
    c2.append(el("div", { class: "cn-lock-l" }, `dimensions with ${CAREER_MIN_PER_DIM}+ entries`));
    g.append(c2);
    lock.append(g);
    const short = careerDims().filter((d) => careerEntriesFor(d.key).length < CAREER_MIN_PER_DIM);
    if (short.length && short.length <= 12) {
      const nl = el("div", { class: "cn-lock-short" });
      nl.append(el("span", { class: "cn-lock-shortlab" }, "Still thin:"));
      short.forEach((d) => nl.append(el("span", { class: "cn-chip" },
        `${d.label} ${careerEntriesFor(d.key).length}/${CAREER_MIN_PER_DIM}`)));
      lock.append(nl);
    }
    host.append(lock);
    return;
  }

  // Unlocked: what you logged vs what you said you valued
  const b = CAREER.baselines[CAREER.baselines.length - 1] || {};
  const pts = (b.allocation || {}).points || {};
  const rows = careerDims().map((d) => {
    const t = careerTally(d.key);
    const net = t.total ? (t.thrive - t.drain) / t.total : 0;
    return { d, t, net, budget: pts[d.key] || 0 };
  }).sort((a, b2) => b2.net - a.net);
  const tbl = el("div", { class: "cn-cmp" });
  const hdr = el("div", { class: "cn-cmp-row cn-cmp-hdr" });
  hdr.append(el("div", {}, "Dimension"), el("div", {}, "Logged"), el("div", {}, "Net thrive"), el("div", {}, "Budget said"));
  tbl.append(hdr);
  rows.forEach((r) => {
    const row = el("div", { class: "cn-cmp-row" });
    row.append(el("div", { class: "cn-cmp-name" }, r.d.label));
    row.append(el("div", {}, `${r.t.total}`));
    const nb = el("div", { class: "cn-cmp-net" });
    const w = Math.round(Math.abs(r.net) * 100);
    nb.append(el("span", { class: "cn-cmp-bar", style: `width:${w}%;background:${r.net >= 0 ? "#38a66f" : "#c0782a"}` }));
    nb.append(el("span", { class: "cn-cmp-pct" }, `${r.net >= 0 ? "+" : ""}${Math.round(r.net * 100)}%`));
    row.append(nb);
    row.append(el("div", {}, `${r.budget} pts`));
    tbl.append(row);
  });
  host.append(tbl);
}

// ---- Export / import (recovery path) --------------------------------------
function careerExport() {
  normalizeCareer();
  careerFlush();
  const blob = new Blob([JSON.stringify(CAREER, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "career_notes-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function careerImport() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { alert("That isn't valid JSON."); return; }
    if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
      alert("That doesn't look like a Career Notes export."); return;
    }
    const n = data.entries.length, cur = (CAREER.entries || []).length;
    if (!confirm(`Replace Career Notes with this snapshot?\n\nSnapshot: ${n} entries, `
      + `${(data.principles || []).length} principles, ${(data.baselines || []).length} baseline(s).\n`
      + `Current: ${cur} entries.\n\nThe version you're replacing stays in Edit \u2192 Data history.`)) return;
    CAREER = null;
    STATE.settings[CAREER_KEY] = JSON.stringify(data);
    await saveSetting(CAREER_KEY, STATE.settings[CAREER_KEY]);
    normalizeCareer();
    render();
  });
  inp.click();
}
