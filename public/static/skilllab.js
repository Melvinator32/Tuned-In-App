/* Radio Station — skilllab.js
   Skill Lab — categories (seeded + custom), multi-category task links (primary/
   secondary/tertiary), resource tracker with per-type gauges (pages, minutes,
   study sessions, notecard sessions, custom types), priorities (max 3 High),
   the 1% better daily check-in, and a dated activity log of every update.
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ============================================================================
// State persists in settings["sb_state"]. Board tasks are matched by their
// Priority value containing "Development" and linked to categories by task
// name (so linked copies count once). A task can live in up to 3 categories —
// its primary, secondary, and tertiary. Every mutation stamps SB.log with the
// date, shown as "Updated <date>" + an Activity panel.
// ============================================================================
const SB_KEY = "sb_state";
let SB = null;
let sbSaveT = null;
let sbShowLog = false;

const SB_CAT_SEED = [
  // Thinking & judgment
  { key: "decide",    label: "Decision Making",           color: "#00859b" },
  { key: "risk",      label: "Risk & Uncertainty",        color: "#0f6d7e" },
  { key: "strat",     label: "Strategy",                  color: "#00bfb8" },
  { key: "models",    label: "Mental Models",             color: "#4a9fb0" },
  // Learning & execution
  { key: "learn",     label: "Learning & Rethinking",     color: "#38a66f" },
  { key: "habits",    label: "Habits & Systems",          color: "#2f8f5e" },
  { key: "focus",     label: "Time & Focus",              color: "#77b28c" },
  // People
  { key: "influence", label: "Influence & Persuasion",    color: "#c0782a" },
  { key: "nego",      label: "Negotiation",               color: "#990061" },
  { key: "net",       label: "Networking & Relationships", color: "#d18a3a" },
  { key: "convo",     label: "Conversation",              color: "#b8603f" },
  { key: "meet",      label: "Meetings",                  color: "#8a5a2b" },
  // Leading & career
  { key: "leadmgmt",  label: "Leadership & Management",   color: "#a85bd2" },
  { key: "career",    label: "Career & Professionalism",  color: "#8e7cc3" },
  // Inner
  { key: "stoic",     label: "Resilience & Stoicism",     color: "#5d7479" },
  { key: "selfid",    label: "Self-Knowledge & Identity", color: "#6f8f96" },
  { key: "mind",      label: "Mindfulness",               color: "#9ab5a3" },
  // Life
  { key: "love",      label: "Love & Partnership",        color: "#e2725b" },
  { key: "health",    label: "Health & Energy",           color: "#8fbf5a" },
  // Money & world
  { key: "money",     label: "Money & Wealth",            color: "#2d7d6b" },
  { key: "world",     label: "World & Systems",           color: "#4a6fa5" },
  // Craft & technical
  { key: "writcraft", label: "Writing Craft",             color: "#6b8f7a" },
  { key: "fintech",   label: "Finance Technicals",        color: "#1f6f8b" },
  { key: "oil",       label: "Oil & Refining",            color: "#7a4a2b" },
  { key: "tools",     label: "Tools & Shortcuts",         color: "#5d7479" },
];
const SB_CAT_COLORS = ["#00859b", "#00bfb8", "#38a66f", "#77b28c", "#c0782a", "#5d7479", "#8e7cc3", "#a85bd2", "#990061", "#e2725b"];

// Built-in resource types. `track` decides the in-use gauge:
//   pages    — X of Y pages (books)
//   mins     — X of Y minutes (videos, podcasts)
//   sessions — open-ended session log (minutes for study, cards for notecards)
//   pct      — a 0-100% slider (courses, articles, custom types)
const SB_RES_TYPES = [
  { key: "book",    label: "Book",          track: "pages" },
  { key: "course",  label: "Course",        track: "pct" },
  { key: "video",   label: "Video",         track: "mins" },
  { key: "podcast", label: "Podcast",       track: "mins" },
  { key: "article", label: "Article",       track: "pct" },
  { key: "study",   label: "General study", track: "sessions", unit: "min" },
  { key: "cards",   label: "Notecards",     track: "sessions", unit: "cards" },
  { key: "other",   label: "Other",         track: "pct" },
];
const SB_HORIZONS = [
  { key: "short", label: "Short term" },
  { key: "med",   label: "Medium term" },
  { key: "long",  label: "Long term" },
];
const SB_MAX_CATS_PER_TASK = 3;

function sbLoad() {
  if (SB) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[SB_KEY]) || "{}"); } catch (e) { saved = {}; }
  SB = Object.assign({ cats: null, assign: {}, daily: {}, resTypes: [], log: [] }, saved);
  if (!SB.cats || !SB.cats.length) {
    SB.cats = SB_CAT_SEED.map((c) => ({ ...c, prio: "med", horizon: "med", resources: [] }));
  } else {
    // Add any seed category the user doesn't already have. Matched on key AND
    // on normalized label, so a category they already keep under a different
    // key (or with different spacing/case) isn't duplicated. Purely additive —
    // existing categories, their resources, and task links are never touched.
    // A curated set (the portfolio demo) opts out of the seed backfill.
    if (SB.noSeed) return;
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const haveKeys = new Set(SB.cats.map((c) => c.key));
    const haveLabels = new Set(SB.cats.map((c) => norm(c.label)));
    SB_CAT_SEED.forEach((c) => {
      if (haveKeys.has(c.key) || haveLabels.has(norm(c.label))) return;
      SB.cats.push({ ...c, prio: "med", horizon: "med", resources: [] });
      haveKeys.add(c.key); haveLabels.add(norm(c.label));
    });
    SB.cats.forEach((c) => { if (!c.resources) c.resources = []; });
  }
  if (!Array.isArray(SB.resTypes)) SB.resTypes = [];
  if (!Array.isArray(SB.log)) SB.log = [];
  if (!Array.isArray(SB.til)) SB.til = [];
  // Migration: assignment values were single category keys; now they're
  // ordered arrays [primary, secondary, tertiary]. Non-destructive.
  Object.keys(SB.assign).forEach((k) => {
    if (typeof SB.assign[k] === "string") SB.assign[k] = SB.assign[k] ? [SB.assign[k]] : [];
  });
}
function sbSave() {
  clearTimeout(sbSaveT);
  sbSaveT = setTimeout(() => {
    STATE.settings[SB_KEY] = JSON.stringify(SB);
    saveSetting(SB_KEY, STATE.settings[SB_KEY]);
  }, 400);
}
function sbUid() { return "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

// Every meaningful Skill Lab change gets a dated log entry (newest first).
function sbLogAdd(what) {
  SB.log = SB.log || [];
  SB.log.unshift({ d: todayStr(), what: String(what).slice(0, 140) });
  if (SB.log.length > 200) SB.log.length = 200;
}
function sbCatLabel(key) {
  const c = SB.cats.find((x) => x.key === key);
  return c ? c.label : key;
}
function sbResTypeList() { return SB_RES_TYPES.concat(SB.resTypes || []); }
function sbResType(key) {
  return sbResTypeList().find((t) => t.key === key) || { key: "other", label: "Other", track: "pct" };
}

// ---- Board task pool: Personal Development tasks from the main dashboard ----
function sbNameKey(t) {
  const pc = primaryCol();
  return String(t.cells[pc.id] || "").trim().toLowerCase();
}
function sbPool() {
  const prioCol = STATE.columns.find((c) => c.type === "priority");
  if (!prioCol) return [];
  const seen = new Set();
  return STATE.tasks
    .filter((t) => !t.parent_id)
    .filter((t) => /development/i.test(String(t.cells[prioCol.id] || "")))
    .filter((t) => {
      const k = sbNameKey(t) || "id:" + t.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
// Ordered categories a task belongs to: [primary, secondary, tertiary]
function sbCatsOf(nameKey) {
  const v = SB.assign[nameKey];
  return Array.isArray(v) ? v.filter((k) => SB.cats.some((c) => c.key === k)) : [];
}
function sbCatTasks(catKey) {
  return sbPool().filter((t) => sbCatsOf(sbNameKey(t)).includes(catKey));
}
function sbUnfiled() {
  return sbPool().filter((t) => {
    if (isDoneStatus(t)) return false;   // finished tasks aren't worth filing — assigned ones still count in the meter
    return sbCatsOf(sbNameKey(t)).length === 0;
  });
}

// ---- Progress: tasks done + resource completion, goal-tracking style ----
function sbResFraction(r) {
  if (r.status === "done") return 1;
  if (r.status !== "using") return 0;
  const track = sbResType(r.type).track;
  if (track === "pages" && Number(r.pagesTotal) > 0) {
    return Math.max(0, Math.min(1, Number(r.pagesRead || 0) / Number(r.pagesTotal)));
  }
  if (track === "mins" && Number(r.minsTotal) > 0) {
    return Math.max(0, Math.min(1, Number(r.minsDone || 0) / Number(r.minsTotal)));
  }
  if (track === "sessions") {
    // Open-ended practice: in progress counts half until marked done
    return (r.sessions && r.sessions.length) ? 0.5 : 0.25;
  }
  return Math.max(0, Math.min(1, Number(r.pct || 0) / 100));
}
function sbCatProgress(cat) {
  const tasks = sbCatTasks(cat.key);
  let num = 0, den = 0;
  tasks.forEach((t) => { den += 1; if (isDoneStatus(t)) num += 1; });
  (cat.resources || []).forEach((r) => { den += 1; num += sbResFraction(r); });
  return den === 0 ? null : num / den;
}

// ---- 1% better daily check-in ----
function sbToday() { return todayStr(); }
function sbCheckedToday() { return !!(SB.daily && SB.daily[sbToday()]); }
function sbStreak() {
  let n = 0;
  const d = new Date();
  if (!sbCheckedToday()) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    if (SB.daily && SB.daily[k]) { n += 1; d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}
function sbTotalDays() { return Object.keys(SB.daily || {}).length; }

function sbFmtMins(m) {
  m = Math.round(Number(m) || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim() : `${m}m`;
}
function sbFmtDate(iso) {
  try {
    const [y, mo, dd] = iso.split("-").map(Number);
    return new Date(y, mo - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (e) { return iso; }
}

function renderSignalBoost() {
  sbLoad();
  sbInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "sb-wrap" });

  const head = el("div", { class: "vibe-head" });
  const lastUpd = (SB.log && SB.log[0]) ? SB.log[0].d : null;
  head.append(el("div", {},
    el("div", { class: "vibe-title" }, "Skill Lab"),
    el("div", { class: "vibe-sub" },
      "Personal development & skill acquisition — 1% better every day." +
      (lastUpd ? ` Updated ${sbFmtDate(lastUpd)}.` : ""))));
  const headBtns = el("div", { style: "display:flex;gap:8px" });
  headBtns.append(el("button", { class: "tool-btn", onClick: () => {
    const name = prompt("New category name:");
    if (!name || !name.trim()) return;
    const key = "cust_" + sbUid();
    SB.cats.push({ key, label: name.trim(), color: SB_CAT_COLORS[SB.cats.length % SB_CAT_COLORS.length],
                   prio: "med", horizon: "med", resources: [], custom: true });
    sbLogAdd(`New category: ${name.trim()}`);
    sbSave(); render();
  } }, "+ New category"));
  headBtns.append(el("button", { class: "tool-btn", onClick: () => { sbShowLog = !sbShowLog; render(); } },
    sbShowLog ? "Hide activity" : "Activity"));
  const sortWrap = el("label", { class: "sb-sortwrap", title: "How linked tasks are ordered inside every category" });
  sortWrap.append(el("span", {}, "Tasks by"));
  const sortSel = el("select", { class: "sb-sortsel" });
  SB_TASK_SORTS.forEach(([k, lab]) => sortSel.append(
    el("option", Object.assign({ value: k }, k === sbTaskSort() ? { selected: "selected" } : {}), lab)));
  sortSel.addEventListener("change", () => { SB.taskSort = sortSel.value; sbSave(); render(); });
  sortWrap.append(sortSel);
  head.append(sortWrap);
  head.append(headBtns);
  wrap.append(head);

  // ---- Activity log (dated record of every Skill Lab update) ----
  if (sbShowLog) {
    const panel = el("div", { class: "sb-log" });
    if (!(SB.log || []).length) panel.append(el("div", { class: "sb-empty" }, "No activity yet."));
    (SB.log || []).slice(0, 15).forEach((e) => {
      const row = el("div", { class: "sb-log-row" });
      row.append(el("span", { class: "sb-log-date" }, sbFmtDate(e.d)));
      row.append(el("span", { class: "sb-log-what" }, e.what));
      panel.append(row);
    });
    if ((SB.log || []).length > 15) {
      panel.append(el("div", { class: "sb-empty" }, `+ ${SB.log.length - 15} older entries`));
    }
    wrap.append(panel);
  }

  // ---- 1% better hero strip ----
  const total = sbTotalDays();
  const mult = Math.pow(1.01, total);
  const hero = el("div", { class: "sb-hero" });
  const checked = sbCheckedToday();
  const btn = el("button", { class: "sb-one-btn" + (checked ? " done" : ""),
    title: "One rep a day — a chapter, a drill, a call, a lesson. Click when you've done today's.",
    onClick: () => {
      SB.daily = SB.daily || {};
      if (SB.daily[sbToday()]) { delete SB.daily[sbToday()]; sbLogAdd("1% check-in undone"); }
      else { SB.daily[sbToday()] = 1; sbLogAdd("1% better — daily check-in"); }
      sbSave(); render();
    } }, checked ? "✓ 1% better today" : "Did you get 1% better today?");
  hero.append(btn);
  const stats = el("div", { class: "sb-hero-stats" });
  stats.append(el("div", { class: "sb-stat" }, el("b", {}, String(sbStreak())), el("span", {}, "day streak")));
  stats.append(el("div", { class: "sb-stat" }, el("b", {}, String(total)), el("span", {}, "total days")));
  stats.append(el("div", { class: "sb-stat", title: "1.01 compounded over every checked-in day — the version of you those reps built" },
    el("b", {}, mult.toFixed(2) + "×"), el("span", {}, "compounded")));
  hero.append(stats);
  const dots = el("div", { class: "sb-dots", title: "Last 30 days" });
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    dots.append(el("span", { class: "sb-dot" + ((SB.daily && SB.daily[k]) ? " on" : "") }));
  }
  hero.append(dots);
  wrap.append(hero);

  wrap.append(sbTilSection());

  // ---- Unfiled Personal Development tasks ----
  const unfiled = sbUnfiled();
  if (unfiled.length) {
    const tray = el("div", { class: "sb-tray" });
    tray.append(el("div", { class: "sb-tray-head" },
      `Unfiled Personal Development tasks (${unfiled.length}) — pick a primary category for each:`));
    const pc = primaryCol();
    unfiled.forEach((t) => {
      const row = el("div", { class: "sb-tray-row" });
      row.append(el("span", { class: "sb-tray-name" }, t.cells[pc.id] || "Untitled"));
      const sel = el("select", { class: "sb-sel" });
      sel.append(el("option", { value: "" }, "Choose category…"));
      SB.cats.forEach((c) => sel.append(el("option", { value: c.key }, c.label)));
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        SB.assign[sbNameKey(t)] = [sel.value];
        sbLogAdd(`Linked "${t.cells[pc.id]}" to ${sbCatLabel(sel.value)}`);
        sbSave(); render();
      });
      row.append(sel);
      tray.append(row);
    });
    wrap.append(tray);
  }

  // ---- Category cards, High priorities first ----
  const prioOrder = { high: 0, med: 1, low: 2 };
  const cats = SB.cats.slice().sort((a, b) =>
    (prioOrder[a.prio] ?? 1) - (prioOrder[b.prio] ?? 1) ||
    SB.cats.indexOf(a) - SB.cats.indexOf(b));
  const grid = el("div", { class: "sb-grid" });
  cats.forEach((cat) => grid.append(sbCatCard(cat)));
  wrap.append(grid);

  board.append(wrap);
}

function sbHighCount() { return SB.cats.filter((c) => c.prio === "high").length; }

// ---- Linked-task status ----------------------------------------------------
// A task filed under a skill is still a task on the board, so the card shows
// where it actually stands. Status order follows the board's own palette
// (Working On It first, Done last), which is the workflow order rather than
// alphabetical — sorting by it groups a category's live work at the top.
const SB_TASK_SORTS = [["status", "Status"], ["name", "Name"], ["due", "Due date"]];
function sbTaskSort() { return (SB && SB.taskSort) || "status"; }
function sbStatusOf(t) {
  const sc = STATE.columns.find((c) => c.type === "status");
  return sc ? String(t.cells[sc.id] || "") : "";
}
function sbStatusRank(t) {
  const order = (STATE.palette && STATE.palette.status) || [];
  const i = order.findIndex((p) => p.label === sbStatusOf(t));
  return i === -1 ? order.length : i;          // unset sinks below the known ones
}
function sbStatusColor(label) {
  const order = (STATE.palette && STATE.palette.status) || [];
  const hit = order.find((p) => p.label === label);
  return hit ? hit.color : "#b3b3b3";
}
function sbDueOf(t) {
  const dc = STATE.columns.filter((c) => c.type === "date").find((c) => /due/i.test(c.name))
          || STATE.columns.find((c) => c.type === "date");
  return dc ? String(t.cells[dc.id] || "").slice(0, 10) : "";
}
function sbSortTasks(list) {
  const pc = primaryCol();
  const mode = sbTaskSort();
  return list.slice().sort((a, b) => {
    if (mode === "name") {
      return String(a.cells[pc.id] || "").localeCompare(String(b.cells[pc.id] || ""));
    }
    if (mode === "due") {
      const da = sbDueOf(a), db = sbDueOf(b);
      if (da && db) return da.localeCompare(db);
      if (da) return -1;                        // dated before undated
      if (db) return 1;
      return String(a.cells[pc.id] || "").localeCompare(String(b.cells[pc.id] || ""));
    }
    const r = sbStatusRank(a) - sbStatusRank(b);
    return r || String(a.cells[pc.id] || "").localeCompare(String(b.cells[pc.id] || ""));
  });
}

function sbCatCard(cat) {
  const card = el("div", { class: "sb-card", style: `--c:${cat.color}` });
  const pc = primaryCol();

  // Header + priority chips
  const head = el("div", { class: "sb-card-head" });
  const titleRow = el("div", { class: "sb-card-title-row" });
  titleRow.append(el("div", { class: "sb-card-title" }, cat.label));
  if (cat.custom) {
    titleRow.append(el("span", { class: "sb-task-x", title: "Delete this category (its resources go with it; tasks return to Unfiled)",
      onClick: () => {
        if (!confirm(`Delete category "${cat.label}"? Its resource list is removed; linked tasks go back to Unfiled.`)) return;
        SB.cats = SB.cats.filter((c) => c.key !== cat.key);
        Object.keys(SB.assign).forEach((k) => {
          SB.assign[k] = (SB.assign[k] || []).filter((x) => x !== cat.key);
        });
        sbLogAdd(`Deleted category: ${cat.label}`);
        sbSave(); render();
      } }, "✕"));
  }
  head.append(titleRow);
  const prioRow = el("div", { class: "sb-prio-row" });
  const chip = (key, label, title) => {
    const on = cat.prio === key;
    return el("span", { class: "sb-prio" + (on ? " on p-" + key : ""), title: title || "",
      onClick: () => {
        if (key === "high" && cat.prio !== "high" && sbHighCount() >= 3) {
          alert("Only 3 categories can be High priority — drop one first.");
          return;
        }
        cat.prio = key;
        sbLogAdd(`${cat.label} → ${label} priority`);
        sbSave(); render();
      } }, label);
  };
  prioRow.append(chip("high", "High", "Max 3 categories can be High"));
  prioRow.append(chip("med", "Medium"));
  prioRow.append(chip("low", "Low"));
  head.append(prioRow);
  if (cat.prio !== "high") {
    const hz = el("div", { class: "sb-hz-row" });
    SB_HORIZONS.forEach((h) => {
      hz.append(el("span", { class: "sb-hz" + (cat.horizon === h.key ? " on" : ""),
        onClick: () => { cat.horizon = h.key; sbLogAdd(`${cat.label} → ${h.label}`); sbSave(); render(); } }, h.label));
    });
    head.append(hz);
  }
  card.append(head);

  // Progress meter
  const prog = sbCatProgress(cat);
  const meter = el("div", { class: "sb-meter" });
  const pct = prog == null ? 0 : Math.round(prog * 100);
  meter.append(el("span", { class: "sb-meter-lab" }, prog == null ? "No items yet" : pct + "%"));
  const barEl = el("div", { class: "sb-meter-bar" });
  barEl.append(el("div", { class: "sb-meter-fill", style: `width:${pct}%;background:${cat.color}` }));
  meter.append(barEl);
  card.append(meter);

  // Active tasks (multi-category: a task can sit in up to 3 cards)
  const tasks = sbCatTasks(cat.key);
  const doneN = tasks.filter(isDoneStatus).length;
  const activeN = tasks.length - doneN;
  card.append(el("div", { class: "sb-sec-head" },
    `Linked tasks (${activeN} open${doneN ? ` · ${doneN} done` : ""})`));
  const tList = el("div", { class: "sb-task-list" });
  if (!tasks.length) tList.append(el("div", { class: "sb-empty" }, "No tasks linked."));
  sbSortTasks(tasks).forEach((t) => {
    const key = sbNameKey(t);
    const catsOf = sbCatsOf(key);
    const ord = catsOf.indexOf(cat.key);
    const st = sbStatusOf(t);
    const row = el("div", { class: "sb-task" + (isDoneStatus(t) ? " done" : "") });
    row.append(el("span", { class: "sb-task-dot", style: `background:${cat.color}` }));
    row.append(el("span", { class: "sb-task-name" }, t.cells[pc.id] || "Untitled"));
    if (st) {
      row.append(el("span", { class: "sb-task-status", style: `background:${sbStatusColor(st)}`,
        title: "Status on the board" }, st));
    }
    const due = sbDueOf(t);
    if (due && sbTaskSort() === "due") {
      row.append(el("span", { class: "sb-task-due" + (due < todayYMD() && !isDoneStatus(t) ? " over" : "") }, due.slice(5)));
    }
    if (catsOf.length > 1) {
      row.append(el("span", { class: "sb-ord", title: `This task is in ${catsOf.length} categories` },
        ["1st", "2nd", "3rd"][ord] || ""));
    }
    // Add to a secondary/tertiary category
    if (catsOf.length < SB_MAX_CATS_PER_TASK) {
      const addSel = el("select", { class: "sb-mini-sel", title: "Also file this task under another category" });
      addSel.append(el("option", { value: "" }, "+"));
      SB.cats.filter((c) => !catsOf.includes(c.key))
        .forEach((c) => addSel.append(el("option", { value: c.key }, c.label)));
      addSel.addEventListener("change", () => {
        if (!addSel.value) return;
        SB.assign[key] = catsOf.concat(addSel.value);
        sbLogAdd(`Also filed "${t.cells[pc.id]}" under ${sbCatLabel(addSel.value)}`);
        sbSave(); render();
      });
      row.append(addSel);
    }
    row.append(el("span", { class: "sb-task-x", title: "Unlink from this category (stays in its other categories)",
      onClick: () => {
        SB.assign[key] = catsOf.filter((x) => x !== cat.key);
        sbLogAdd(`Unlinked "${t.cells[pc.id]}" from ${cat.label}`);
        sbSave(); render();
      } }, "✕"));
    tList.append(row);
  });
  card.append(tList);

  // Resources
  card.append(el("div", { class: "sb-sec-head" }, `Resources (${(cat.resources || []).length})`));
  const rList = el("div", { class: "sb-res-list" });
  (cat.resources || []).forEach((r) => rList.append(sbResRow(cat, r)));
  if (!(cat.resources || []).length) rList.append(el("div", { class: "sb-empty" }, "No resources yet."));
  card.append(rList);

  // Add resource (type list includes custom types + "New type…")
  const addRow = el("div", { class: "sb-add-row" });
  const inp = el("input", { class: "sb-add-inp", placeholder: "Add a resource…" });
  const typeSel = el("select", { class: "sb-sel sb-sel-sm" });
  sbResTypeList().forEach((t) => typeSel.append(el("option", { value: t.key }, t.label)));
  typeSel.append(el("option", { value: "__new" }, "+ New type…"));
  typeSel.addEventListener("change", () => {
    if (typeSel.value !== "__new") return;
    const name = prompt("New resource type name (tracked with a % slider):");
    if (!name || !name.trim()) { typeSel.value = "other"; return; }
    const key = "ct_" + sbUid();
    SB.resTypes.push({ key, label: name.trim(), track: "pct" });
    sbLogAdd(`New resource type: ${name.trim()}`);
    sbSave();
    const opt = el("option", { value: key }, name.trim());
    typeSel.insertBefore(opt, typeSel.querySelector('option[value="__new"]'));
    typeSel.value = key;
  });
  const doAdd = () => {
    const v = inp.value.trim();
    if (!v || typeSel.value === "__new") return;
    cat.resources.push({ id: sbUid(), title: v, type: typeSel.value, status: "not",
      pagesRead: 0, pagesTotal: 0, minsDone: 0, minsTotal: 0, pct: 0, sessions: [] });
    sbLogAdd(`+ resource "${v}" (${sbResType(typeSel.value).label}) in ${cat.label}`);
    inp.value = "";
    sbSave(); render();
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
  addRow.append(inp, typeSel, el("button", { class: "sb-add-btn", onClick: doAdd }, "+ Add"));
  card.append(addRow);

  return card;
}

function sbResRow(cat, r) {
  const type = sbResType(r.type);
  const row = el("div", { class: "sb-res" });
  const top = el("div", { class: "sb-res-top" });
  top.append(el("span", { class: "sb-res-type" }, type.label));
  top.append(el("span", { class: "sb-res-name" + (r.status === "done" ? " done" : "") }, r.title));

  const STATUSES = [["not", "Not used"], ["using", "Using"], ["done", "Done"]];
  const cur = Math.max(0, STATUSES.findIndex((s) => s[0] === r.status));
  const stBtn = el("button", { class: "sb-res-status st-" + r.status, title: "Click to cycle: not used → using → done",
    onClick: () => {
      r.status = STATUSES[(cur + 1) % 3][0];
      sbLogAdd(`"${r.title}" → ${STATUSES[(cur + 1) % 3][1]}`);
      sbSave(); render();
    } },
    STATUSES[cur][1]);
  top.append(stBtn);
  top.append(el("span", { class: "sb-task-x", title: "Remove resource",
    onClick: () => {
      cat.resources = cat.resources.filter((x) => x.id !== r.id);
      sbLogAdd(`Removed resource "${r.title}" from ${cat.label}`);
      sbSave(); render();
    } }, "✕"));
  row.append(top);

  // In-use trackers, by type
  if (r.status === "using") {
    const trk = el("div", { class: "sb-res-trk" });
    if (type.track === "pages") {
      const read = el("input", { class: "sb-pg", type: "number", min: "0", value: String(r.pagesRead || 0) });
      const tot = el("input", { class: "sb-pg", type: "number", min: "0", value: String(r.pagesTotal || 0), placeholder: "total" });
      const upd = () => {
        r.pagesRead = Number(read.value || 0); r.pagesTotal = Number(tot.value || 0);
        sbLogAdd(`"${r.title}" — page ${r.pagesRead}${r.pagesTotal ? " of " + r.pagesTotal : ""}`);
        sbSave(); render();
      };
      read.addEventListener("change", upd); tot.addEventListener("change", upd);
      trk.append(el("span", { class: "sb-trk-lab" }, "Pages"), read, el("span", {}, "of"), tot);
      if (Number(r.pagesTotal) > 0) trk.append(el("span", { class: "sb-trk-pct" }, Math.round(sbResFraction(r) * 100) + "%"));
    } else if (type.track === "mins") {
      const done = el("input", { class: "sb-pg", type: "number", min: "0", value: String(r.minsDone || 0) });
      const tot = el("input", { class: "sb-pg", type: "number", min: "0", value: String(r.minsTotal || 0), placeholder: "total" });
      const upd = () => {
        r.minsDone = Number(done.value || 0); r.minsTotal = Number(tot.value || 0);
        sbLogAdd(`"${r.title}" — ${sbFmtMins(r.minsDone)}${r.minsTotal ? " of " + sbFmtMins(r.minsTotal) : ""} in`);
        sbSave(); render();
      };
      done.addEventListener("change", upd); tot.addEventListener("change", upd);
      trk.append(el("span", { class: "sb-trk-lab" }, "Minutes"), done, el("span", {}, "of"), tot);
      if (Number(r.minsTotal) > 0) trk.append(el("span", { class: "sb-trk-pct" }, Math.round(sbResFraction(r) * 100) + "%"));
    } else if (type.track === "sessions") {
      const isCards = type.key === "cards";
      const sessions = r.sessions || (r.sessions = []);
      // Gauge: totals + per-session average + last session
      if (sessions.length) {
        const tot = sessions.reduce((s, x) => s + Number(x.v || 0), 0);
        const avg = tot / sessions.length;
        const last = sessions[sessions.length - 1];
        const g = isCards
          ? `Σ ${tot} cards · avg ${Math.round(avg)}/session · ${sessions.length} sessions · last ${last.v} on ${sbFmtDate(last.d)}`
          : `Σ ${sbFmtMins(tot)} · avg ${sbFmtMins(avg)}/session · ${sessions.length} sessions · last ${sbFmtMins(last.v)} on ${sbFmtDate(last.d)}`;
        row.append(el("div", { class: "sb-gauge" }, g));
      }
      const num = el("input", { class: "sb-pg", type: "number", min: "0",
        placeholder: isCards ? "cards" : "mins" });
      const log = el("button", { class: "sb-add-btn", onClick: () => {
        const v = Number(num.value || 0);
        if (!v) return;
        sessions.push({ d: todayStr(), v });
        sbLogAdd(isCards ? `${v} notecards — "${r.title}"` : `${sbFmtMins(v)} study — "${r.title}"`);
        sbSave(); render();
      } }, "Log session");
      num.addEventListener("keydown", (e) => { if (e.key === "Enter") log.click(); });
      trk.append(el("span", { class: "sb-trk-lab" }, isCards ? "Cards this session" : "Minutes this session"), num, log);
    } else {
      const rng = el("input", { type: "range", min: "0", max: "100", value: String(r.pct || 0), class: "sb-pct" });
      const lab = el("span", { class: "sb-trk-pct" }, (r.pct || 0) + "%");
      rng.addEventListener("input", () => { lab.textContent = rng.value + "%"; });
      rng.addEventListener("change", () => {
        r.pct = Number(rng.value);
        sbLogAdd(`"${r.title}" — ${r.pct}%`);
        sbSave(); render();
      });
      trk.append(el("span", { class: "sb-trk-lab" }, "Progress"), rng, lab);
    }
    row.append(trk);
  }
  return row;
}

// ============================================================================
// Today I Learned — a dated log of lessons, each attached to a category.
// Copy a digest for the daily wisdom email, or download the full log as CSV.
// Logging a TIL also counts as today's 1% check-in.
// ============================================================================
let sbTilShowAll = false;
let sbTilFilter = "";

function sbTilSection() {
  const sec = el("div", { class: "sb-til" });

  // Header row: title + count + category filter + export controls
  const head = el("div", { class: "sb-til-head" });
  head.append(el("span", { class: "sb-til-title" }, "Today I Learned"));
  head.append(el("span", { class: "sb-til-count" }, `${(SB.til || []).length} entries`));
  const filt = el("select", { class: "sb-sel", title: "Show one category's lessons" });
  filt.append(el("option", { value: "" }, "All categories"));
  SB.cats.forEach((c) => filt.append(el("option", { value: c.key }, c.label)));
  filt.value = sbTilFilter;
  filt.addEventListener("change", () => { sbTilFilter = filt.value; render(); });
  head.append(filt);
  head.append(el("span", { style: "flex:1" }));
  const range = el("select", { class: "sb-sel", title: "How far back the export goes" });
  [["7", "Last 7 days"], ["30", "Last 30 days"], ["", "Everything"]].forEach(([v, l]) =>
    range.append(el("option", { value: v }, l)));
  head.append(range);
  const copyBtn = el("button", { class: "sb-add-btn",
    title: "Copy a formatted digest — paste it straight into the daily wisdom email",
    onClick: async () => {
      const text = sbTilDigest(range.value ? Number(range.value) : 0);
      const ok = await sbCopyText(text);
      copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => { copyBtn.textContent = "Copy for email"; }, 1800);
    } }, "Copy for email");
  head.append(copyBtn);
  head.append(el("button", { class: "sb-add-btn", title: "Download the full log as a spreadsheet-ready CSV",
    onClick: sbTilCsv }, "⬇ CSV"));
  sec.append(head);

  // Entry composer
  const compose = el("div", { class: "sb-til-compose" });
  const inp = el("textarea", { class: "sb-til-inp", rows: "2",
    placeholder: "What did you learn today?" });
  const catSel = el("select", { class: "sb-sel" });
  catSel.append(el("option", { value: "" }, "Category…"));
  SB.cats.forEach((c) => catSel.append(el("option", { value: c.key }, c.label)));
  const logBtn = el("button", { class: "sb-til-log", onClick: () => {
    const text = inp.value.trim();
    if (!text) return;
    if (!catSel.value) { alert("Pick a category for this lesson."); return; }
    SB.til.unshift({ id: sbUid(), d: sbToday(), cat: catSel.value, text });
    sbLogAdd(`TIL (${sbCatLabel(catSel.value)}): ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    if (!SB.daily[sbToday()]) {                        // learning something IS the 1%
      SB.daily[sbToday()] = 1;
      sbLogAdd("1% better — daily check-in (via TIL)");
    }
    inp.value = "";
    sbSave(); render();
  } }, "Log it");
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) logBtn.click();
  });
  compose.append(inp, catSel, logBtn);
  sec.append(compose);

  // Entries
  const entries = (SB.til || []).filter((t) => !sbTilFilter || t.cat === sbTilFilter);
  const list = el("div", { class: "sb-til-list" });
  if (!entries.length) {
    list.append(el("div", { class: "sb-empty" },
      sbTilFilter ? "No lessons in this category yet." : "Nothing logged yet — write down today's lesson above."));
  }
  const shown = sbTilShowAll ? entries : entries.slice(0, 8);
  shown.forEach((t) => {
    const c = SB.cats.find((x) => x.key === t.cat);
    const row = el("div", { class: "sb-til-row" });
    row.append(el("span", { class: "sb-til-date" }, sbFmtDate(t.d)));
    row.append(el("span", { class: "sb-cell-chip", style: `background:${c ? c.color : "#b3b3b3"}` }, c ? c.label : t.cat));
    row.append(el("span", { class: "sb-til-text" }, t.text));
    row.append(el("span", { class: "sb-task-x", title: "Delete this entry",
      onClick: () => {
        SB.til = SB.til.filter((x) => x.id !== t.id);
        sbLogAdd(`Deleted TIL: ${t.text.slice(0, 40)}`);
        sbSave(); render();
      } }, "✕"));
    list.append(row);
  });
  if (entries.length > 8) {
    list.append(el("button", { class: "sb-add-btn", style: "align-self:flex-start",
      onClick: () => { sbTilShowAll = !sbTilShowAll; render(); } },
      sbTilShowAll ? "Show recent" : `Show all ${entries.length}`));
  }
  sec.append(list);
  return sec;
}

// Digest for the daily wisdom email: newest first, date + category + lesson
function sbTilDigest(days) {
  const cutoff = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : "";
  const rows = (SB.til || []).filter((t) => !cutoff || t.d >= cutoff);
  if (!rows.length) return "Today I Learned — no entries in this range.";
  const span = days ? `last ${days} days` : "full log";
  const lines = [`Today I Learned (${span})`, ""];
  rows.forEach((t) => lines.push(`• ${sbFmtDate(t.d)} — ${sbCatLabel(t.cat)}: ${t.text}`));
  return lines.join("\n");
}
async function sbCopyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}
function sbTilCsv() {
  const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const lines = ["date,category,lesson"];
  (SB.til || []).slice().reverse().forEach((t) =>          // oldest first for spreadsheets
    lines.push([t.d, esc(sbCatLabel(t.cat)), esc(t.text)].join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "today-i-learned.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  sbLogAdd("Exported TIL log to CSV");
  sbSave();
}

function sbInjectCss() {
  if (document.getElementById("sb-extra-css")) return;
  const css = `
  .sb-wrap{padding:20px 28px;max-width:1500px;margin:0 auto}
  .sb-hero{display:flex;align-items:center;gap:22px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--light-gray);border-radius:14px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .sb-one-btn{border:none;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;background:var(--teal);color:#fff}
  .sb-one-btn:hover{filter:brightness(1.06)}
  .sb-one-btn.done{background:var(--green)}
  .sb-hero-stats{display:flex;gap:20px}
  .sb-stat{display:flex;flex-direction:column;align-items:center;line-height:1.15}
  .sb-stat b{font-size:19px;color:var(--teal)}
  .sb-stat span{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-2)}
  .sb-dots{display:flex;gap:3px;flex-wrap:wrap;max-width:340px}
  .sb-dot{width:9px;height:9px;border-radius:3px;background:var(--light-gray)}
  .sb-dot.on{background:var(--green)}
  .sb-log{background:var(--surface);border:1px solid var(--light-gray);border-radius:12px;padding:10px 14px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .sb-log-row{display:flex;gap:12px;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--off-white)}
  .sb-log-row:last-child{border-bottom:none}
  .sb-log-date{font-weight:700;color:var(--teal);white-space:nowrap;min-width:52px}
  .sb-log-what{color:var(--ink)}
  .sb-til{background:var(--surface);border:1px solid var(--light-gray);border-radius:14px;padding:12px 16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .sb-til-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .sb-til-title{font-weight:800;font-size:14.5px;color:var(--ink)}
  .sb-til-count{font-size:11px;font-weight:700;color:var(--text-2)}
  .sb-til-compose{display:flex;gap:8px;align-items:stretch;margin-bottom:10px;flex-wrap:wrap}
  .sb-til-inp{flex:1;min-width:220px;border:1px solid var(--light-gray);border-radius:9px;padding:8px 11px;font-size:13px;font-family:inherit;resize:vertical}
  .sb-til-inp:focus{outline:none;border-color:var(--teal)}
  .sb-til-log{border:none;background:var(--teal);color:#fff;font-weight:700;font-size:13px;border-radius:9px;padding:8px 18px;cursor:pointer;font-family:inherit;align-self:stretch}
  .sb-til-log:hover{filter:brightness(1.06)}
  .sb-til-list{display:flex;flex-direction:column;gap:5px}
  .sb-til-row{display:flex;align-items:baseline;gap:9px;font-size:12.5px;padding:4px 2px;border-bottom:1px solid var(--off-white)}
  .sb-til-row:last-of-type{border-bottom:none}
  .sb-til-date{font-weight:700;color:var(--teal);white-space:nowrap;min-width:48px;font-size:11.5px}
  .sb-til-text{flex:1;color:var(--ink);line-height:1.45}
  .sb-tray{background:var(--pale-teal);border:1px solid #b8d9de;border-radius:12px;padding:12px 14px;margin-bottom:16px}
  .sb-tray-head{font-size:12.5px;font-weight:700;color:var(--teal);margin-bottom:8px}
  .sb-tray-row{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:13px}
  .sb-tray-name{flex:1;color:var(--ink)}
  .sb-sel{border:1px solid var(--light-gray);border-radius:7px;padding:4px 8px;font-size:12px;font-family:inherit;background:var(--surface);color:var(--ink)}
  .sb-sel-sm{padding:4px 6px;max-width:130px}
  .sb-mini-sel{border:1px solid var(--light-gray);border-radius:6px;font-size:11px;font-family:inherit;background:var(--surface);color:var(--mid-gray);width:26px;padding:1px 2px;flex-shrink:0}
  .sb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
  .sb-card{background:var(--surface);border:1px solid var(--light-gray);border-top:4px solid var(--c,#00859b);border-radius:12px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,0.04);display:flex;flex-direction:column}
  .sb-card-head{margin-bottom:8px}
  .sb-card-title-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .sb-card-title{font-weight:800;font-size:14.5px;color:var(--ink);flex:1}
  .sb-prio-row,.sb-hz-row{display:flex;gap:6px;flex-wrap:wrap}
  .sb-hz-row{margin-top:5px}
  .sb-prio,.sb-hz{font-size:11px;font-weight:700;border:1px solid var(--light-gray);color:#5d6b66;background:var(--surface);border-radius:20px;padding:2px 10px;cursor:pointer}
  .sb-prio.on.p-high{background:#7a1f1f;border-color:#7a1f1f;color:#fff}
  .sb-prio.on.p-med{background:var(--teal);border-color:var(--teal);color:#fff}
  .sb-prio.on.p-low{background:var(--mid-gray);border-color:var(--mid-gray);color:#fff}
  .sb-hz.on{background:var(--sage);border-color:var(--sage);color:#fff}
  .sb-meter{display:flex;align-items:center;gap:10px;margin:6px 0 10px}
  .sb-meter-lab{font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;min-width:66px}
  .sb-meter-bar{flex:1;height:8px;background:var(--light-gray);border-radius:4px;overflow:hidden}
  .sb-meter-fill{height:100%;transition:width .2s}
  .sb-sec-head{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--text-2);margin:8px 0 5px}
  .sb-task-list,.sb-res-list{display:flex;flex-direction:column;gap:4px}
  .sb-task{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink);padding:3px 2px}
  .sb-task-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .sb-task-name{flex:1;line-height:1.3}
  .sb-ord{font-size:9.5px;font-weight:800;color:#fff;background:var(--mid-gray);border-radius:5px;padding:1px 5px;flex-shrink:0}
  .sb-task-x{color:var(--mid-gray);cursor:pointer;font-size:11px;padding:0 3px}
  .sb-task-x:hover{color:#c0392b}
  .sb-empty{font-size:12px;color:#9aa8a3;font-style:italic;padding:2px 0}
  .sb-res{border:1px solid var(--off-white);border-radius:8px;padding:6px 8px;background:#fbfbf9}
  .sb-res-top{display:flex;align-items:center;gap:8px}
  .sb-res-type{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#fff;background:var(--mid-gray);border-radius:5px;padding:1px 6px;flex-shrink:0}
  .sb-res-name{flex:1;font-size:12.5px;color:var(--ink);line-height:1.3}
  .sb-res-name.done{text-decoration:line-through;color:var(--mid-gray)}
  .sb-res-status{border:none;border-radius:14px;font-size:10.5px;font-weight:700;padding:3px 10px;cursor:pointer;font-family:inherit;flex-shrink:0}
  .sb-res-status.st-not{background:var(--light-gray);color:#5d6b66}
  .sb-res-status.st-using{background:var(--cyan);color:#fff}
  .sb-res-status.st-done{background:var(--green);color:#fff}
  .sb-res-trk{display:flex;align-items:center;gap:7px;margin-top:6px;font-size:12px;color:#5d6b66;flex-wrap:wrap}
  .sb-gauge{font-size:11px;color:var(--teal);font-weight:600;margin-top:5px}
  .sb-trk-lab{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--text-2)}
  .sb-pg{width:60px;border:1px solid var(--light-gray);border-radius:6px;padding:3px 6px;font-size:12px;font-family:inherit;text-align:right}
  .sb-pct{flex:1;accent-color:var(--teal);min-width:90px}
  .sb-trk-pct{font-weight:700;color:var(--teal);font-size:12px;min-width:36px;text-align:right}
  .sb-add-row{display:flex;gap:6px;margin-top:8px}
  .sb-add-inp{flex:1;border:1px solid var(--light-gray);border-radius:7px;padding:5px 9px;font-size:12.5px;font-family:inherit;min-width:80px}
  .sb-add-btn{border:none;background:var(--off-white);color:var(--teal);font-weight:700;font-size:12px;border-radius:7px;padding:5px 11px;cursor:pointer;font-family:inherit;flex-shrink:0}
  .sb-add-btn:hover{background:var(--pale-teal)}
  `;
  const st = document.createElement("style"); st.id = "sb-extra-css"; st.textContent = css;
  document.head.appendChild(st);
}

// ============================================================================
// Board integration — in any group whose name contains "personal" (Personal
// Tasks / Personal Development), the two goal-type columns display as CATEGORY
// and RESOURCE instead of Pillar and Goal. Display-layer only: the underlying
// pillar/goal cell values are untouched; Category reads/writes SB.assign and
// Resource reads/writes SB.taskRes — both live in the sb_state blob.
// ============================================================================
function sbGroupOverride(groupName) {
  return /personal/i.test(String(groupName || ""));
}
function sbBoardHeaderLabel(col) {
  // The pillar-named goal column becomes Category; the other becomes Resource.
  return /pillar|value/i.test(String(col.name || "")) ? "Category" : "Resource";
}
function sbTaskResources(nameKey) {
  sbLoad();
  SB.taskRes = SB.taskRes || {};
  const ids = SB.taskRes[nameKey] || [];
  const out = [];
  SB.cats.forEach((c) => (c.resources || []).forEach((r) => { if (ids.includes(r.id)) out.push(r); }));
  return out;
}

function sbBoardCell(col, task) {
  sbLoad();
  const key = sbNameKey(task);
  const isCat = sbBoardHeaderLabel(col) === "Category";
  const wrap = el("div", { class: "sb-cell-chips",
    title: isCat ? "Skill Lab categories — click to file (up to 3)"
                 : "Skill Lab resources you're using for this task — click to link" });

  if (isCat) {
    const cats = sbCatsOf(key);
    if (!cats.length) wrap.append(el("span", { class: "sb-cell-empty" }, "+ category"));
    cats.forEach((k, i) => {
      const c = SB.cats.find((x) => x.key === k);
      wrap.append(el("span", { class: "sb-cell-chip", style: `background:${c ? c.color : "#b3b3b3"}` },
        (c ? c.label : k) + (cats.length > 1 ? ` · ${["1st", "2nd", "3rd"][i]}` : "")));
    });
  } else {
    const res = sbTaskResources(key);
    if (!res.length) wrap.append(el("span", { class: "sb-cell-empty" }, "+ resource"));
    res.forEach((r) => wrap.append(el("span", { class: "sb-cell-chip res" }, r.title)));
  }
  wrap.addEventListener("click", (e) => {
    e.stopPropagation();
    sbOpenCellMenu(wrap, task, isCat);
  });
  return wrap;
}

// Small popover: toggle categories (max 3) or resources from the task's categories
function sbOpenCellMenu(anchor, task, isCat) {
  document.querySelectorAll(".sb-cell-menu").forEach((m) => m.remove());
  const key = sbNameKey(task);
  const pc = primaryCol();
  const tname = task.cells[pc.id] || "task";
  const menu = el("div", { class: "sb-cell-menu" });

  const rebuild = () => {
    menu.innerHTML = "";
    if (isCat) {
      menu.append(el("div", { class: "m-head" }, "Skill Lab categories (up to 3)"));
      const cats = sbCatsOf(key);
      SB.cats.forEach((c) => {
        const on = cats.includes(c.key);
        const row = el("div", { class: "m-row" + (on ? " on" : "") });
        row.append(el("span", { class: "m-dot", style: `background:${c.color}` }));
        row.append(el("span", {}, c.label));
        if (on) row.append(el("span", { class: "m-check" }, "✓"));
        row.addEventListener("click", () => {
          const cur = sbCatsOf(key);
          if (on) {
            SB.assign[key] = cur.filter((x) => x !== c.key);
            sbLogAdd(`Unlinked "${tname}" from ${c.label}`);
          } else {
            if (cur.length >= SB_MAX_CATS_PER_TASK) { alert("A task can sit in at most 3 categories."); return; }
            SB.assign[key] = cur.concat(c.key);
            sbLogAdd(`Filed "${tname}" under ${c.label}`);
          }
          sbSave(); rebuild();
        });
        menu.append(row);
      });
    } else {
      const cats = sbCatsOf(key);
      SB.taskRes = SB.taskRes || {};
      const ids = SB.taskRes[key] || [];
      if (!cats.length) {
        menu.append(el("div", { class: "m-head" }, "Resources"));
        menu.append(el("div", { class: "m-empty" }, "File this task under a category first — resources come from its categories."));
      } else {
        let any = false;
        cats.forEach((k) => {
          const c = SB.cats.find((x) => x.key === k);
          if (!c || !(c.resources || []).length) return;
          any = true;
          menu.append(el("div", { class: "m-head" }, c.label));
          c.resources.forEach((r) => {
            const on = ids.includes(r.id);
            const row = el("div", { class: "m-row" + (on ? " on" : "") });
            row.append(el("span", { class: "m-dot", style: `background:${c.color}` }));
            row.append(el("span", {}, r.title));
            if (on) row.append(el("span", { class: "m-check" }, "✓"));
            row.addEventListener("click", () => {
              const cur = SB.taskRes[key] || [];
              SB.taskRes[key] = on ? cur.filter((x) => x !== r.id) : cur.concat(r.id);
              sbLogAdd(on ? `Unlinked resource "${r.title}" from "${tname}"` : `Using "${r.title}" for "${tname}"`);
              sbSave(); rebuild();
            });
            menu.append(row);
          });
        });
        if (!any) {
          menu.append(el("div", { class: "m-head" }, "Resources"));
          menu.append(el("div", { class: "m-empty" }, "No resources in this task's categories yet — add some in Skill Lab."));
        }
      }
    }
  };
  rebuild();

  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12) + "px";
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 12) + "px";
  const close = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", close); render(); }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}
