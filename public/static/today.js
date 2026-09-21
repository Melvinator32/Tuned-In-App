/* Radio Station — today.js
   Today — priorities + time-block schedule, .ics import, Eisenhower matrix, Today hub (Day/Week/Month)
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ---------------- Today: top priorities + 15-min time-block schedule ----------------
let scheduleDay = null;          // 'YYYY-MM-DD' currently shown
let scheduleBlocks = null;       // cached blocks for scheduleDay
let scheduleLoadingFor = null;   // guard against duplicate fetches
const DAY_START_MIN = 6 * 60;    // grid starts 6:00 AM
const DAY_END_MIN = 22 * 60;     // ...ends 10:00 PM
const SLOT_MIN = 15;             // 15-minute increments
const SLOT_PX = 22;              // pixels per slot

function todayYMD() { return toYMD(startOfToday()); }
function minToHHMM(m) { const h = Math.floor(m / 60), mm = m % 60; return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); }
function hhmmToMin(s) { const [h, m] = String(s).split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function fmtTime(m) {
  let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "PM" : "AM";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ap}`;
}

// ---- Outlook .ics import (populates Today + Calendar as schedule blocks) ----
async function importIcsText(text) {
  try {
    const resp = await api("/api/schedule/import", { method: "POST", body: JSON.stringify({ ics: text }) });
    // clear caches so both views refresh
    scheduleBlocks = null; scheduleDay = null; calBlocks = {};
    let msg = `Imported ${resp.added} event${resp.added === 1 ? "" : "s"} from ${resp.events} entr${resp.events === 1 ? "y" : "ies"}.`;
    if (resp.skipped_allday) msg += ` (${resp.skipped_allday} all-day event${resp.skipped_allday === 1 ? "" : "s"} skipped.)`;
    showTimerToast(msg);
    render();
  } catch (e) {
    showTimerToast("Couldn't read that file — make sure it's an Outlook .ics export.");
  }
}
function readIcsFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => importIcsText(String(r.result || ""));
  r.readAsText(file);
}
// The local build re-read an .ics saved next to the app on demand ("sync
// folder"). Cloudflare has no app folder, so the button is gone and the
// drag-and-drop / file-picker import below is the only way in. The
// /api/schedule/rescan endpoint still exists and still answers "no file
// found", so nothing 404s if an old cached page calls it.
// A clickable + drag-and-drop zone for dropping an .ics file.
function icsImportZone() {
  const zone = el("div", { class: "ics-zone", title: "Drop an Outlook .ics file here, or click to choose" },
    "⬆ Drop .ics here, or click to choose a file");
  const input = el("input", { type: "file", accept: ".ics,text/calendar", style: "display:none" });
  input.addEventListener("change", () => { if (input.files && input.files[0]) readIcsFile(input.files[0]); input.value = ""; });
  zone.append(input);
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readIcsFile(f);
  });
  return zone;
}
async function clearImportedSchedule() {
  if (!confirm("Remove all events imported from Outlook? (Blocks you created by hand stay.)")) return;
  const resp = await api("/api/schedule/clear-imported", { method: "POST" });
  scheduleBlocks = null; scheduleDay = null; calBlocks = {};
  showTimerToast(`Removed ${resp.removed} imported event${resp.removed === 1 ? "" : "s"}.`);
  render();
}

// Calendar month cache of schedule blocks, keyed "Y-M".
let calBlocks = {};
let calBlocksLoading = null;
async function loadCalBlocks(y, m) {
  const key = `${y}-${m}`;
  if (calBlocks[key] || calBlocksLoading === key) return;
  calBlocksLoading = key;
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  try {
    const resp = await api(`/api/schedule/range?from=${from}&to=${to}`);
    calBlocks[key] = resp.blocks || [];
  } catch (e) { calBlocks[key] = []; }
  calBlocksLoading = null;
  if (currentView === "calendar") render();
}

async function loadSchedule(day) {
  scheduleLoadingFor = day;
  try {
    const resp = await api(`/api/schedule?day=${encodeURIComponent(day)}`);
    // Ignore if the user navigated to a different day meanwhile
    if (scheduleLoadingFor !== day) return;
    scheduleDay = day;
    scheduleBlocks = resp.blocks || [];
  } finally {
    scheduleLoadingFor = null;   // always clear so a later load can re-fire
  }
  if (currentView === "today") render();
}

// ---- Auto-plan the day around what's already scheduled ----------------
// Order comes from the Eisenhower matrix (Do First → Schedule → Delegate;
// Eliminate is skipped), and within a quadrant from the board's own sort
// (priority, then earliest due date). Each task takes its matrix estimate.
// The server does the gap-fitting so meetings and hand-placed blocks are
// never overwritten.
const PLAN_QUAD_ORDER = ["do", "schedule", "delegate"];
function planWindow() {
  const s = (STATE.settings && STATE.settings.plan_start) || "08:00";
  const e = (STATE.settings && STATE.settings.plan_end) || "18:00";
  return { start: /^\d{2}:\d{2}$/.test(s) ? s : "08:00", end: /^\d{2}:\d{2}$/.test(e) ? e : "18:00" };
}

function planCandidates(day) {
  // Tasks already on this day's schedule shouldn't be planned twice — but only
  // blocks that will SURVIVE the re-plan count. The previous auto-plan is
  // cleared by the server first, so those tasks are candidates again;
  // otherwise a second run would quietly plan a different, smaller set.
  const fixed = (scheduleBlocks || []).filter((b) => !b.auto);
  const scheduled = new Set(fixed.map((b) => b.task_id).filter(Boolean));
  const pc = primaryCol();
  const scheduledNames = new Set(
    fixed.map((b) => String(b.label || "").trim().toLowerCase()).filter(Boolean));
  const out = [];
  PLAN_QUAD_ORDER.forEach((qk) => {
    matrixTasks()
      .filter((t) => eisQuadOf(t) === qk)
      .filter((t) => !scheduled.has(t.id))
      .filter((t) => !scheduledNames.has(String(t.cells[pc.id] || "").trim().toLowerCase()))
      .sort(taskSortCompare)
      .forEach((t) => out.push({
        task_id: t.id,
        label: String(t.cells[pc.id] || "Untitled"),
        minutes: estOrDefault(t),
      }));
  });
  return out;
}

async function autoPlanDay(day) {
  const items = planCandidates(day);
  if (!items.length) {
    alert("Nothing to plan.\n\nSort tasks in Prioritize first (Do First / Schedule / Delegate) — anything already on today's schedule is skipped.");
    return;
  }
  const win = planWindow();
  // On today, don't plan into hours that have already passed.
  let startMin = hhmmToMin(win.start);
  if (day === todayYMD()) {
    const now = new Date();
    const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN) * SLOT_MIN;
    startMin = Math.max(startMin, nowMin);
  }
  if (startMin >= hhmmToMin(win.end)) {
    alert(`The planning window (${win.start}–${win.end}) has already passed for today.`);
    return;
  }
  const resp = await api("/api/schedule/autoplan", { method: "POST", body: JSON.stringify({
    day, window_start: minToHHMM(startMin), window_end: win.end, items }) });
  scheduleBlocks = null;
  await loadSchedule(day);
  const n = (resp.placed || []).length;
  const left = (resp.unplaced || []).length;
  let msg = `Planned ${n} task${n === 1 ? "" : "s"} into your free time.`;
  if (left) msg += ` ${left} didn't fit — free up time or trim estimates.`;
  toastMsg(msg);
}

async function clearAutoPlan(day) {
  const resp = await api(`/api/schedule/autoplan?day=${encodeURIComponent(day)}`, { method: "DELETE" });
  scheduleBlocks = null;
  await loadSchedule(day);
  toastMsg(resp.removed ? `Removed ${resp.removed} auto-planned block${resp.removed === 1 ? "" : "s"}.` : "No auto-planned blocks on this day.");
}

// Small transient message (reuses the timer toast's styling)
function toastMsg(msg) {
  const old = document.getElementById("timer-toast");
  if (old) old.remove();
  const t = el("div", { id: "timer-toast", class: "timer-toast" });
  t.append(el("span", { class: "timer-toast-icon" }, ""));
  t.append(el("span", {}, msg));
  t.append(el("button", { class: "timer-toast-x", onClick: () => t.remove() }, "×"));
  document.body.append(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 6000);
}

function renderToday() {
  const board = $("#board");
  const day = scheduleDay || todayYMD();
  // Fetch this day's blocks if we don't have them yet. Fire the load whenever
  // we don't have blocks for this day and one isn't already in flight.
  if (scheduleBlocks === null || scheduleDay !== day) {
    if (scheduleLoadingFor !== day) loadSchedule(day);
    board.append(el("div", { class: "muted", style: "padding:20px" }, "Loading schedule…"));
    return;
  }

  const layout = el("div", { class: "today-layout" });

  // ---- Left: Top Priorities + task list (draggable sources) ----
  const left = el("div", { class: "today-left" });
  const dd = parseYMD(day);
  const isToday = day === todayYMD();
  left.append(el("h2", { class: "today-title" }, isToday ? "Top Priorities" : "Priorities"));

  // Outlook import (drop or click). Imported events become editable blocks.
  const importRow = el("div", { class: "ics-row" });
  importRow.append(icsImportZone());
  importRow.append(el("span", { class: "ics-clear", title: "Remove imported Outlook events", onClick: clearImportedSchedule }, "clear imported"));
  left.append(importRow);

  const pCol0 = primaryCol();
  const seenTask = new Set();
  const incomplete = STATE.tasks
    .filter((t) => !t.parent_id)
    .filter((t) => !excludedFromPlanning(t))
    .filter((t) => {
      const sc = STATE.columns.find((c) => c.type === "status");
      return !sc || String(t.cells[sc.id] || "") !== "Done";
    })
    // Collapse copies of the same task to one chip. Key by name (so the same
    // task shown in several groups appears once) — matches the calendar's rule.
    .filter((t) => {
      const nm = String(t.cells[pCol0.id] || "").trim().toLowerCase();
      const key = nm ? "name:" + nm : "id:" + t.id;
      if (seenTask.has(key)) return false;
      seenTask.add(key);
      return true;
    })
    .sort(taskSortCompare);   // priority first, then earliest due date

  const pCol = primaryCol();
  const prioCol = STATE.columns.find((c) => c.type === "priority");
  const makeChip = (t, top) => {
    const chip = el("div", { class: "today-chip" + (top ? " top" : ""), draggable: "true", "data-task": t.id });
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", "task:" + t.id);
      todayDrag = { type: "task", id: t.id, label: String(t.cells[pCol.id] || "Untitled") };
    });
    chip.addEventListener("dragend", () => { todayDrag = null; });
    chip.append(el("span", { class: "today-chip-grip" }, "⠿"));
    chip.append(el("span", { class: "today-chip-name" }, t.cells[pCol.id] || "Untitled"));
    if (prioCol && t.cells[prioCol.id]) {
      chip.append(el("span", { class: "today-chip-pri", style: `background:${colorOf("priority", t.cells[prioCol.id])}` }, t.cells[prioCol.id]));
    }
    // Delete the task from here. Chips are deduped, so one chip can stand for
    // copies in several groups — deleting removes them all (otherwise another
    // copy would instantly reappear in the list).
    chip.append(el("button", { class: "today-chip-del", title: "Delete this task (removes it and its linked copies)",
      onClick: async (e) => {
        e.stopPropagation();
        const nm = t.cells[pCol.id] || "this task";
        if (!confirm(`Delete "${nm}"? This removes it from the board, including its copies in other groups.`)) return;
        await deleteTaskEverywhere(t);
      } }, "×"));
    return chip;
  };

  const topList = el("div", { class: "today-chips" });
  incomplete.slice(0, 6).forEach((t) => topList.append(makeChip(t, true)));
  if (!incomplete.length) topList.append(el("div", { class: "muted", style: "font-size:13px" }, "Nothing outstanding — nice."));
  left.append(topList);

  if (incomplete.length > 6) {
    left.append(el("div", { class: "today-subhead" }, "More tasks"));
    const moreList = el("div", { class: "today-chips" });
    incomplete.slice(6).forEach((t) => moreList.append(makeChip(t, false)));
    left.append(moreList);
  }
  left.append(el("p", { class: "today-tip" }, "Drag a task onto the schedule →  (it's copied to your day; the task stays put)"));

  // ---- Right: day schedule ----
  const right = el("div", { class: "today-right" });
  const navbar = el("div", { class: "today-nav" });
  navbar.append(el("button", { class: "today-navbtn", title: "Previous day", onClick: () => { scheduleDay = toYMD(addDays(parseYMD(day), -1)); scheduleBlocks = null; todayGridScroll = null; render(); } }, "‹"));
  const dlabel = dd ? dd.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : day;
  navbar.append(el("span", { class: "today-date" }, (isToday ? "Today · " : "") + dlabel));
  navbar.append(el("button", { class: "today-navbtn", title: "Next day", onClick: () => { scheduleDay = toYMD(addDays(parseYMD(day), 1)); scheduleBlocks = null; todayGridScroll = null; render(); } }, "›"));
  if (!isToday) navbar.append(el("button", { class: "today-navbtn today-jump", title: "Jump to today", onClick: () => { scheduleDay = todayYMD(); scheduleBlocks = null; todayGridScroll = null; render(); } }, "Today"));
  navbar.append(el("span", { style: "flex:1" }));
  navbar.append(el("button", { class: "today-navbtn today-meeting", title: "Block off time for a meeting",
    onClick: () => addMeetingBlock(day, null) }, "+ Block off time"));
  right.append(navbar);

  // Auto-plan row: fills the gaps around meetings with matrix-sorted tasks
  const planbar = el("div", { class: "plan-bar" });
  planbar.append(el("button", { class: "today-navbtn plan-go",
    title: "Fill this day's free time with tasks from Prioritize, in quadrant order, using each task's estimate",
    onClick: () => autoPlanDay(day) }, "Auto-plan day"));
  const win = planWindow();
  planbar.append(el("span", { class: "plan-lab" }, "between"));
  const mkTime = (val, key) => {
    const inp = el("input", { type: "time", class: "plan-time", value: val, step: "900" });
    inp.addEventListener("change", () => {
      if (!/^\d{2}:\d{2}$/.test(inp.value)) return;
      STATE.settings[key] = inp.value;
      saveSetting(key, inp.value);
    });
    return inp;
  };
  planbar.append(mkTime(win.start, "plan_start"));
  planbar.append(el("span", { class: "plan-lab" }, "and"));
  planbar.append(mkTime(win.end, "plan_end"));
  const nPlan = (scheduleBlocks || []).filter((b) => b.auto).length;
  planbar.append(el("span", { style: "flex:1" }));
  const ready = planCandidates(day).length;
  planbar.append(el("span", { class: "plan-note" },
    nPlan ? `${nPlan} auto-planned` : (ready ? `${ready} task${ready === 1 ? "" : "s"} ready` : "sort tasks in Prioritize first")));
  if (nPlan) {
    planbar.append(el("button", { class: "today-navbtn", title: "Remove only the auto-planned blocks (meetings and blocks you placed stay)",
      onClick: () => clearAutoPlan(day) }, "Clear auto-plan"));
  }
  right.append(planbar);

  const grid = el("div", { class: "today-grid" });
  const colWrap = el("div", { class: "today-gridcol", style: `height:${((DAY_END_MIN - DAY_START_MIN) / SLOT_MIN) * SLOT_PX}px` });

  // Hour labels + slot drop targets
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
    const slot = el("div", {
      class: "today-slot" + (m % 60 === 0 ? " hour" : ""),
      style: `top:${((m - DAY_START_MIN) / SLOT_MIN) * SLOT_PX}px;height:${SLOT_PX}px`,
      "data-min": String(m),
    });
    if (m % 60 === 0) slot.append(el("span", { class: "today-hourlabel" }, fmtTime(m)));
    slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("slot-over"); });
    slot.addEventListener("dragleave", () => slot.classList.remove("slot-over"));
    slot.addEventListener("drop", async (e) => {
      e.preventDefault(); slot.classList.remove("slot-over");
      if (!todayDrag) return;
      const start = minToHHMM(m);
      if (todayDrag.type === "task") {
        await api("/api/schedule", { method: "POST", body: JSON.stringify({
          day, start, minutes: 30, task_id: todayDrag.id, label: todayDrag.label }) });
      } else if (todayDrag.type === "block") {
        await api(`/api/schedule/${todayDrag.id}`, { method: "PATCH", body: JSON.stringify({ start }) });
      }
      scheduleBlocks = null; await loadSchedule(day);
    });
    // Click an empty slot to block off time for a meeting (a task-less block).
    slot.addEventListener("click", () => addMeetingBlock(day, m));
    colWrap.append(slot);
  }

  // Render blocks
  (scheduleBlocks || []).forEach((b) => {
    const startM = hhmmToMin(b.start);
    const top = ((startM - DAY_START_MIN) / SLOT_MIN) * SLOT_PX;
    const h = (b.minutes / SLOT_MIN) * SLOT_PX;
    // Colour by the referenced task's status, if it still exists
    let color = b.color || "var(--cyan)";
    const task = b.task_id ? STATE.tasks.find((t) => t.id === b.task_id) : null;
    if (task) {
      const sc = STATE.columns.find((c) => c.type === "status");
      const sv = sc ? task.cells[sc.id] : "";
      if (sv) color = colorOf("status", sv);
    }
    const compact = b.minutes <= 20;   // 15-min blocks get a one-line layout
    // On today's schedule, blocks that have already ended fade back so the
    // current and upcoming work stands out.
    const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
    const isPast = isToday && (startM + b.minutes) <= nowMin;
    const isMeeting = !b.task_id;
    const labelText0 = (isMeeting ? "◷ " : "") + (b.label || (task ? task.cells[primaryCol().id] : "Block"));
    const blk = el("div", { class: "today-block" + (compact ? " compact" : "") + (isPast ? " past" : "") + (b.auto ? " auto-block" : ""), draggable: "true",
      title: `${labelText0} · ${fmtTime(startM)} – ${fmtTime(startM + b.minutes)}`,
      style: `top:${top}px;height:${Math.max(SLOT_PX - 2, h - 2)}px;background:${color}` });
    blk.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "block:" + b.id);
      todayDrag = { type: "block", id: b.id };
    });
    blk.addEventListener("dragend", () => { todayDrag = null; });
    blk.append(el("div", { class: "today-block-label" }, labelText0));
    blk.append(el("div", { class: "today-block-time" }, `${fmtTime(startM)} – ${fmtTime(startM + b.minutes)}`));
    // Duration control + delete
    const ctr = el("div", { class: "today-block-ctr" });
    const dur = el("select", { class: "today-block-dur", title: "Duration" });
    [15, 30, 45, 60, 90, 120].forEach((mn) => {
      const o = el("option", { value: String(mn) }, mn >= 60 ? `${mn / 60}h${mn % 60 ? " " + (mn % 60) + "m" : ""}` : `${mn}m`);
      if (mn === b.minutes) o.selected = true;
      dur.append(o);
    });
    dur.addEventListener("click", (e) => e.stopPropagation());
    dur.addEventListener("change", async () => {
      await api(`/api/schedule/${b.id}`, { method: "PATCH", body: JSON.stringify({ minutes: Number(dur.value) }) });
      scheduleBlocks = null; await loadSchedule(day);
    });
    ctr.append(dur);
    ctr.append(el("button", { class: "today-block-del", title: "Remove from schedule",
      onClick: async (e) => { e.stopPropagation(); await api(`/api/schedule/${b.id}`, { method: "DELETE" }); scheduleBlocks = null; await loadSchedule(day); } }, "×"));
    blk.append(ctr);
    colWrap.append(blk);
  });

  // Dotted line marking the current time (today only), repositioned each
  // minute by the global timer tick.
  if (isToday) {
    const n = new Date();
    const nowMin = n.getHours() * 60 + n.getMinutes();
    if (nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN) {
      const line = el("div", { class: "now-line", id: "now-line",
        style: `top:${((nowMin - DAY_START_MIN) / SLOT_MIN) * SLOT_PX}px` });
      line.append(el("span", { class: "now-line-dot" }));
      colWrap.append(line);
    }
  }

  grid.append(colWrap);
  right.append(grid);

  // Apply saved panel width and insert a draggable divider so the priorities
  // panel and schedule can be resized; the width persists in settings.
  const savedW = parseInt((STATE.settings && STATE.settings["today_left_w"]) || "", 10);
  if (savedW && savedW >= 180 && savedW <= 700) {
    left.style.flex = `0 0 ${savedW}px`;
    left.style.maxWidth = savedW + "px";
  }
  layout.append(left);
  layout.append(makePanelDivider(left, "today_left_w"));
  layout.append(right);
  board.append(layout);
}

// A vertical drag handle that resizes the panel to its left and saves the width.
function makePanelDivider(leftEl, settingKey) {
  const div = el("div", { class: "panel-divider", title: "Drag to resize" });
  div.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftEl.getBoundingClientRect().width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const w = Math.max(180, Math.min(700, startW + (ev.clientX - startX)));
      leftEl.style.flex = `0 0 ${w}px`;
      leftEl.style.maxWidth = w + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const finalW = Math.round(leftEl.getBoundingClientRect().width);
      STATE.settings = STATE.settings || {};
      STATE.settings[settingKey] = String(finalW);
      saveSetting(settingKey, String(finalW));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  return div;
}
let todayDrag = null;
// Vertical scroll of the Today schedule grid, preserved across re-renders
// (e.g. deleting a block). Null = no saved position → auto-scroll to the
// first scheduled block on a fresh open.
let todayGridScroll = null;

// Create a task-less "meeting" block. If startMin is given (slot click), the
// start time is prefilled; otherwise it defaults to the next round hour.
function addMeetingBlock(day, startMin) {
  const defMin = startMin != null ? startMin : (() => {
    const n = new Date(); let m = n.getHours() * 60 + Math.ceil(n.getMinutes() / 15) * 15;
    return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - SLOT_MIN, m));
  })();
  openModal("Block off time", (body, close) => {
    body.append(el("label", { class: "rw-flabel" }, "What's it for?"));
    const name = el("input", { class: "field", placeholder: "e.g. Team sync, 1:1, Dentist", style: "width:100%;margin-bottom:12px" });
    body.append(name);

    const row = el("div", { style: "display:flex;gap:12px;margin-bottom:14px" });
    // Start time select (15-min increments across the grid range)
    const startSel = el("select", { class: "field", style: "flex:1" });
    for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
      const o = el("option", { value: String(m) }, fmtTime(m));
      if (m === defMin) o.selected = true;
      startSel.append(o);
    }
    const durSel = el("select", { class: "field", style: "flex:1" });
    [15, 30, 45, 60, 90, 120, 180].forEach((mn) => {
      const o = el("option", { value: String(mn) }, mn >= 60 ? `${mn / 60}h${mn % 60 ? " " + (mn % 60) + "m" : ""}` : `${mn} min`);
      if (mn === 30) o.selected = true;
      durSel.append(o);
    });
    const startCol = el("div", { style: "flex:1" }); startCol.append(el("label", { class: "rw-flabel" }, "Start")); startCol.append(startSel);
    const durCol = el("div", { style: "flex:1" }); durCol.append(el("label", { class: "rw-flabel" }, "Length")); durCol.append(durSel);
    row.append(startCol); row.append(durCol);
    body.append(row);

    const save = el("button", { class: "tool-btn accent-teal", onClick: async () => {
      const nm = name.value.trim() || "Meeting";
      close();
      await api("/api/schedule", { method: "POST", body: JSON.stringify({
        day, start: minToHHMM(Number(startSel.value)), minutes: Number(durSel.value),
        task_id: null, label: nm, color: "#6b6f76" }) });   // grey = a held/meeting block
      scheduleBlocks = null; await loadSchedule(day);
    } }, "Add to schedule");
    body.append(save);
    setTimeout(() => name.focus(), 30);
  });
}

// ---------------- Eisenhower matrix ----------------
// Quadrant assignment lives on the task under the reserved key "__eis", so it
// syncs across linked copies and persists. Values: do | schedule | delegate |
// eliminate. Tasks without a value sit in the Unsorted panel.
let matrixDrag = null;
// Per-task time estimate for planning, in minutes, on the reserved cell key
// "__est" (same pattern as "__eis" — syncs across linked copies, persists).
// 15-minute increments; unset means "no estimate" and auto-plan uses
// EST_DEFAULT_MIN for it.
const EST_DEFAULT_MIN = 30;
const EST_CHOICES = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 480];
function estMinutes(t) {
  const raw = parseInt(t.cells["__est"], 10);
  if (!raw || raw < 15) return 0;                 // 0 = not estimated
  return Math.min(480, Math.round(raw / 15) * 15);
}
function estOrDefault(t) { return estMinutes(t) || EST_DEFAULT_MIN; }
function fmtDur(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  if (!h) return mm + "m";
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
// Total estimated time in a quadrant (unestimated tasks count as the default)
function quadMinutes(tasks, key) {
  return tasks.filter((t) => eisQuadOf(t) === key)
              .reduce((s, t) => s + estOrDefault(t), 0);
}

const EIS_QUADRANTS = [
  { key: "do",        title: "Do First",  sub: "Urgent · Important",        cls: "q-do" },
  { key: "schedule",  title: "Schedule",  sub: "Not urgent · Important",    cls: "q-schedule" },
  { key: "delegate",  title: "Delegate",  sub: "Urgent · Not important",    cls: "q-delegate" },
  { key: "eliminate", title: "Eliminate", sub: "Not urgent · Not important", cls: "q-eliminate" },
];

/** The tasks Prioritize deliberately leaves out: parked with someone else, or
 *  in a holding group. They are still real work, and dropping them silently is
 *  what makes this view look out of step with the list - things you added
 *  simply never appear, with nothing to say why. */
function matrixParked() {
  const sc = STATE.columns.find((c) => c.type === "status");
  return STATE.tasks
    .filter((t) => !t.parent_id)
    .filter((t) => excludedFromPlanning(t))
    .filter((t) => !sc || String(t.cells[sc.id] || "") !== "Done");
}

/** How many real tasks each chip stands for.
 *
 *  Chips are deduped by name, so one chip can represent the same task sitting
 *  in several groups. Deleting one of those from the list view then looks like
 *  nothing happened - the chip is still there, backed by the copy you did not
 *  delete. Showing the count makes that visible instead of baffling. */
let mxDupeCounts = null;
function matrixDuplicateCounts() {
  if (mxDupeCounts) return mxDupeCounts;
  const pc = primaryCol();
  const counts = new Map();
  STATE.tasks
    .filter((t) => !t.parent_id)
    .filter((t) => !excludedFromPlanning(t))
    .forEach((t) => {
      const nm = String(t.cells[pc.id] || "").trim().toLowerCase();
      const key = nm ? "name:" + nm : "id:" + t.id;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  mxDupeCounts = counts;
  return counts;
}

function matrixKeyOf(t) {
  const nm = String(t.cells[primaryCol().id] || "").trim().toLowerCase();
  return nm ? "name:" + nm : "id:" + t.id;
}

function matrixTasks() {
  // Same scope as the Today panel: top-level, not Done, not in parked groups,
  // deduped by name so the same task in several groups shows once.
  const pc = primaryCol();
  const sc = STATE.columns.find((c) => c.type === "status");
  const seen = new Set();
  return STATE.tasks
    .filter((t) => !t.parent_id)
    .filter((t) => !excludedFromPlanning(t))
    .filter((t) => !sc || String(t.cells[sc.id] || "") !== "Done")
    .filter((t) => {
      const nm = String(t.cells[pc.id] || "").trim().toLowerCase();
      const key = nm ? "name:" + nm : "id:" + t.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Manual order inside a quadrant lives on the task under the reserved key
// "__eisrank" — same pattern as "__eis" and "__est", so it syncs across linked
// copies and survives a reload. Unranked tasks sort last, keeping their
// existing order, so nothing jumps around until you actually drag something.
/** Which quadrant a task sits in, or "" for unsorted.
 *
 *  A task that has never been dragged in Prioritize has no "__eis" cell at all,
 *  so its value is undefined rather than "". Comparing that strictly against ""
 *  meant every untouched task matched no quadrant AND not Unsorted either - it
 *  simply never rendered. Every task you had not already sorted was invisible
 *  here, which is why new items never showed up. The drag handlers had always
 *  used this looser reading; the render path had not. */
function eisQuadOf(t) {
  return String((t.cells && t.cells["__eis"]) || "");
}

const EIS_RANK_KEY = "__eisrank";
function eisRank(t) {
  const v = Number(t.cells[EIS_RANK_KEY]);
  return Number.isFinite(v) && t.cells[EIS_RANK_KEY] !== "" && t.cells[EIS_RANK_KEY] != null ? v : Infinity;
}
// How the chips inside a quadrant are ordered. Dragging is the default and
// stays the default - it is the only order the board remembers. The rest are
// ways of reading the same quadrant without disturbing that: switch back to
// Manual and your own order is exactly where you left it.
const MX_SORTS = [
  ["manual",   "Manual order"],
  ["priority", "Priority"],
  ["due",      "Due date"],
  ["longest",  "Longest first"],
  ["shortest", "Shortest first"],
  ["name",     "Name A–Z"],
];
let mxSort = (() => { try { return localStorage.getItem("rs_mx_sort") || "manual"; } catch (e) { return "manual"; } })();
function mxSortLabel(k) { const s = MX_SORTS.find((x) => x[0] === k); return s ? s[1] : k; }

// Priority order comes from the palette, so a renamed or reordered priority
// list sorts the way the board shows it rather than by a list copied in here.
function mxPrioRank(t) {
  const col = STATE.columns.find((c) => c.type === "priority");
  const v = col ? String(t.cells[col.id] || "") : "";
  if (!v) return 999;                               // unset sinks below set
  const list = (STATE.palette && STATE.palette.priority) || [];
  const at = list.findIndex((p) => p.label === v);
  return at === -1 ? 998 : at;
}
function mxName(t) {
  const pc = primaryCol();
  return String((pc && t.cells[pc.id]) || "").toLowerCase();
}

/** Comparators. Each falls back to the manual rank so ties keep a stable,
 *  familiar order rather than shuffling on every render. */
const MX_COMPARE = {
  priority: (a, b) => mxPrioRank(a) - mxPrioRank(b),
  due:      (a, b) => (dueRank(a) < dueRank(b) ? -1 : dueRank(a) > dueRank(b) ? 1 : 0),
  longest:  (a, b) => estOrDefault(b) - estOrDefault(a),
  shortest: (a, b) => estOrDefault(a) - estOrDefault(b),
  name:     (a, b) => mxName(a).localeCompare(mxName(b)),
};

function quadOrdered(tasks, key) {
  const cmp = MX_COMPARE[mxSort];
  return tasks.filter((t) => eisQuadOf(t) === key)
              .map((t, i) => [t, i])
              .sort((a, b) => (cmp ? cmp(a[0], b[0]) : 0)
                           || (eisRank(a[0]) - eisRank(b[0]))
                           || (a[1] - b[1]))
              .map((x) => x[0]);
}
// Renumber a quadrant 0..n-1 after a move, so ranks stay dense and comparable.
async function eisRenumber(order) {
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    if (String(t.cells[EIS_RANK_KEY] ?? "") === String(i)) continue;
    t.cells[EIS_RANK_KEY] = String(i);
    try { await updateCell(t.id, EIS_RANK_KEY, String(i)); }
    catch (e) { if (!/not found/i.test(String(e && e.message))) console.error("[matrix] rank save:", e); }
  }
}

function makeMatrixChip(t, inQuadrant) {
  const pc = primaryCol();
  const prioCol = STATE.columns.find((c) => c.type === "priority");
  const chip = el("div", { class: "today-chip mx-chip", draggable: "true", "data-task": t.id });
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "mx:" + t.id);
    matrixDrag = { id: t.id };
  });
  chip.addEventListener("dragend", () => { matrixDrag = null; chip.classList.remove("mx-over-top", "mx-over-bot"); });
  // Dropping onto a chip inserts before or after it, depending on which half
  // you're over — that's what makes ordering inside a quadrant possible.
  chip.addEventListener("dragover", (e) => {
    if (!matrixDrag || matrixDrag.id === t.id) return;
    e.preventDefault(); e.stopPropagation();
    const r = chip.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    chip.classList.toggle("mx-over-bot", after);
    chip.classList.toggle("mx-over-top", !after);
  });
  chip.addEventListener("dragleave", () => chip.classList.remove("mx-over-top", "mx-over-bot"));
  chip.addEventListener("drop", async (e) => {
    if (!matrixDrag || matrixDrag.id === t.id) return;
    e.preventDefault(); e.stopPropagation();
    const r = chip.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    chip.classList.remove("mx-over-top", "mx-over-bot");
    const movedId = matrixDrag.id;
    matrixDrag = null;
    const destQuad = String(t.cells["__eis"] || "");
    const moved = STATE.tasks.find((x) => x.id === movedId);
    if (!moved) return;
    // Crossing quadrants: set the quadrant first, then place it.
    if (String(moved.cells["__eis"] || "") !== destQuad) {
      moved.cells["__eis"] = destQuad;
      await updateCell(movedId, "__eis", destQuad);
    }
    // Only renumber when manual order is what is on screen. Doing it under a
    // sort would rewrite the order arranged by hand to match a view the user is
    // about to switch away from.
    if (mxSort === "manual") {
      const order = quadOrdered(matrixTasks(), destQuad).filter((x) => x.id !== movedId);
      const at = order.findIndex((x) => x.id === t.id);
      order.splice(at < 0 ? order.length : at + (after ? 1 : 0), 0, moved);
      await eisRenumber(order);
    }
    render();
  });
  chip.append(el("span", { class: "today-chip-grip" }, "⠿"));
  chip.append(el("span", { class: "today-chip-name", title: t.cells[pc.id] || "" }, t.cells[pc.id] || "Untitled"));
  // One chip can stand for several tasks of the same name. Say so next to the
  // name, or deleting one of them from the list looks like it did nothing.
  const dupes = matrixDuplicateCounts().get(matrixKeyOf(t)) || 1;
  if (dupes > 1) {
    chip.append(el("span", { class: "mx-dupes",
      title: dupes + " tasks share this name. Deleting one leaves the rest." },
      "×" + dupes));
  }
  if (prioCol && t.cells[prioCol.id]) {
    chip.append(el("span", { class: "today-chip-pri", style: `background:${colorOf("priority", t.cells[prioCol.id])}` }, t.cells[prioCol.id]));
  }
  // Which quadrant this belongs in, as a control rather than a gesture.
  //
  // Dragging was the only way to sort, which is fine with a mouse and close to
  // unusable on a phone: the chips are narrow, the quadrants are below the fold,
  // and a drag competes with the page scroll. A select does the same job in one
  // tap, works the same on both, and gives the keyboard a way in.
  const quadPick = el("select", { class: "mx-quad-pick",
    title: "Which quadrant this task belongs in" });
  quadPick.append(el("option", { value: "" }, "— sort"));
  EIS_QUADRANTS.forEach((q) => {
    quadPick.append(el("option",
      Object.assign({ value: q.key }, q.key === eisQuadOf(t) ? { selected: "selected" } : {}),
      q.title));
  });
  quadPick.addEventListener("mousedown", (e) => e.stopPropagation());  // don't start a drag
  quadPick.addEventListener("click", (e) => e.stopPropagation());
  quadPick.addEventListener("change", async (e) => {
    e.stopPropagation();
    const dest = quadPick.value;
    t.cells["__eis"] = dest;
    await updateCell(t.id, "__eis", dest);
    // Land it at the end of wherever it went, so it does not jump the queue.
    // Under a sort there is no queue to jump: the sort decides the order.
    if (mxSort === "manual") await eisRenumber(quadOrdered(matrixTasks(), dest));
    render();
  });
  chip.append(quadPick);

  // Time estimate — 15-minute increments, feeds Today's auto-plan
  const est = estMinutes(t);
  const sel = el("select", { class: "mx-est" + (est ? " set" : ""),
    title: "Estimated time — used when auto-planning your day" });
  sel.append(el("option", { value: "" }, "— est"));
  EST_CHOICES.forEach((m) => {
    sel.append(el("option", Object.assign({ value: String(m) }, m === est ? { selected: "selected" } : {}), fmtDur(m)));
  });
  sel.addEventListener("mousedown", (e) => e.stopPropagation());   // don't start a drag
  sel.addEventListener("click", (e) => e.stopPropagation());
  sel.addEventListener("change", async (e) => {
    e.stopPropagation();
    await updateCell(t.id, "__est", sel.value);
    t.cells["__est"] = sel.value;
    render();
  });
  chip.append(sel);
  if (inQuadrant) {
    chip.append(el("button", { class: "mx-unsort", title: "Send back to Unsorted",
      onClick: (e) => { e.stopPropagation(); updateCell(t.id, "__eis", ""); } }, "×"));
  }
  return chip;
}

function attachQuadrantDrop(zone, quadKey) {
  zone.addEventListener("dragover", (e) => {
    if (!matrixDrag) return;
    e.preventDefault();
    zone.classList.add("q-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("q-over"));
  zone.addEventListener("drop", (e) => {
    zone.classList.remove("q-over");
    if (!matrixDrag) return;
    e.preventDefault();
    const movedId = matrixDrag.id;
    matrixDrag = null;
    (async () => {
      const moved = STATE.tasks.find((x) => x.id === movedId);
      if (!moved) return;
      moved.cells["__eis"] = quadKey;
      await updateCell(movedId, "__eis", quadKey);
      if (quadKey) {
        // Dropped on the quadrant itself rather than on a chip: put it last.
        const order = quadOrdered(matrixTasks(), quadKey).filter((x) => x.id !== movedId);
        order.push(moved);
        await eisRenumber(order);
      }
      render();
    })();
  });
}

// Send every sorted task back to Unsorted. Estimates are kept — they're
// reusable, and re-sorting is the point of clearing.
async function clearMatrix() {
  const sorted = matrixTasks().filter((t) => t.cells["__eis"]);
  if (!sorted.length) { alert("Nothing is sorted yet."); return; }
  if (!confirm(`Send all ${sorted.length} sorted task${sorted.length === 1 ? "" : "s"} back to Unsorted?\n\nTime estimates are kept.`)) return;
  for (const t of sorted) {
    await updateCell(t.id, "__eis", "");
    t.cells["__eis"] = "";
  }
  render();
}

function renderMatrix() {
  mxDupeCounts = null;          // the board may have changed since last render
  const board = $("#board");
  const tasks = matrixTasks();
  const layout = el("div", { class: "matrix-layout" });

  // Left: unsorted tasks
  const left = el("div", { class: "matrix-left" });
  left.append(el("h2", { class: "today-title" }, "Unsorted"));
  const unsortedZone = el("div", { class: "today-chips mx-unsorted-zone" });
  const unsorted = quadOrdered(tasks, "");
  unsorted.forEach((t) => unsortedZone.append(makeMatrixChip(t, false)));
  if (!unsorted.length) unsortedZone.append(el("div", { class: "muted", style: "font-size:13px" }, "Everything is sorted."));
  attachQuadrantDrop(unsortedZone, "");   // dropping back here unsorts
  left.append(unsortedZone);
  // Two hints, one shown at a time by CSS. Telling someone on a phone to drag a
  // task into a quadrant is telling them to do the thing that does not work.
  left.append(el("p", { class: "today-tip mx-hint-drag" }, mxSort === "manual"
    ? "Drag a task into a quadrant →  (drag back here to unsort)"
    : "Sorted by " + mxSortLabel(mxSort).toLowerCase()
      + " — drag still moves a task between quadrants; choose Manual order to arrange them yourself"));
  left.append(el("p", { class: "today-tip mx-hint-touch" },
    "Tag each task above, then swipe left to see the matrix →"));

  // Parked work, listed rather than silently missing. It stays out of the
  // quadrants on purpose - it is not yours to plan right now - but it is on
  // the board, so it belongs on screen.
  const parked = matrixParked();
  if (parked.length) {
    const det = el("details", { class: "mx-parked" });
    det.append(el("summary", {},
      parked.length + " parked " + (parked.length === 1 ? "task" : "tasks") + " not shown above"));
    det.append(el("p", { class: "today-tip", style: "margin:6px 0 8px" },
      "Waiting on someone else, or in a holding group. Change the status or the "
      + "group and it joins Unsorted."));
    const list = el("div", { class: "today-chips" });
    parked.forEach((t) => {
      const chip = el("div", { class: "today-chip mx-parked-chip", title: t.group_name });
      chip.append(el("span", {}, String(t.cells[primaryCol().id] || "").trim() || "(untitled)"));
      list.append(chip);
    });
    det.append(list);
    left.append(det);
  }
  const mxBar = el("div", { class: "mx-actions" });
  mxBar.append(el("button", { class: "tool-btn", title: "Send every sorted task back to Unsorted (estimates are kept)",
    onClick: clearMatrix }, "Clear priorities"));

  const sortSel = el("select", { class: "mx-sort" + (mxSort === "manual" ? "" : " on"),
    title: "How chips are ordered inside each quadrant" });
  MX_SORTS.forEach(([k, label]) => {
    sortSel.append(el("option",
      Object.assign({ value: k }, k === mxSort ? { selected: "selected" } : {}), label));
  });
  sortSel.addEventListener("change", () => {
    mxSort = sortSel.value;
    try { localStorage.setItem("rs_mx_sort", mxSort); } catch (e) {}
    $("#board").innerHTML = "";
    render();
  });
  mxBar.append(el("label", { class: "mx-sort-lab" }, "Sort ", sortSel));
  const totalEst = tasks.filter((t) => t.cells["__eis"] && t.cells["__eis"] !== "eliminate")
                        .reduce((s, t) => s + estOrDefault(t), 0);
  if (totalEst) mxBar.append(el("span", { class: "mx-total", title: "Everything sorted, minus Eliminate" }, fmtDur(totalEst) + " planned"));
  left.append(mxBar);
  const savedMW = parseInt((STATE.settings && STATE.settings["matrix_left_w"]) || "", 10);
  if (savedMW && savedMW >= 180 && savedMW <= 700) {
    left.style.flex = `0 0 ${savedMW}px`;
    left.style.maxWidth = savedMW + "px";
  }
  layout.append(left);
  layout.append(makePanelDivider(left, "matrix_left_w"));

  // Right: 2×2 quadrant grid with axis labels
  const right = el("div", { class: "matrix-right" });
  const grid = el("div", { class: "matrix-grid" });
  EIS_QUADRANTS.forEach((q) => {
    const zone = el("div", { class: "mx-quad " + q.cls });
    const head = el("div", { class: "mx-quad-head" });
    head.append(el("span", { class: "mx-quad-title" }, q.title));
    head.append(el("span", { class: "mx-quad-sub" }, q.sub));
    const qm = quadMinutes(tasks, q.key);
    if (qm) head.append(el("span", { class: "mx-quad-est", title: "Estimated time in this quadrant" }, fmtDur(qm)));
    zone.append(head);
    const bodyZone = el("div", { class: "mx-quad-body" });
    quadOrdered(tasks, q.key).forEach((t) => bodyZone.append(makeMatrixChip(t, true)));
    zone.append(bodyZone);
    attachQuadrantDrop(zone, q.key);
    grid.append(zone);
  });
  right.append(grid);
  layout.append(right);
  board.append(layout);
}

function renderCalendar() {
  const board = $("#board");
  const dateCol = STATE.columns.find((c) => c.type === "date");
  if (!dateCol) { board.append(el("div", { class: "muted" }, "Add a Date column to use the Calendar view.")); return; }
  const statusCol = STATE.columns.find((c) => c.type === "status");
  const pCol = primaryCol();

  const first = new Date(calMonth.y, calMonth.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
  const monthName = first.toLocaleString("default", { month: "long" });

  // Collect tasks by due date, collapsing the same task to ONE entry per day.
  // A task placed in several groups (linked copies) shares a due date and name,
  // so we dedupe within each day by link_id when present, otherwise by name —
  // that way copies show once whether or not they carry a link_id.
  const byDay = {};
  const seenPerDay = {};
  filteredTasks().filter((t) => !t.parent_id).forEach((t) => {
    const dv = t.cells[dateCol.id];
    if (!dv) return;
    const key = t.link_id ? "link:" + t.link_id : "name:" + String(t.cells[pCol.id] || "").trim().toLowerCase();
    const seen = seenPerDay[dv] || (seenPerDay[dv] = new Set());
    if (seen.has(key)) return;  // same task already shown on this day
    seen.add(key);
    (byDay[dv] = byDay[dv] || []).push(t);
  });

  const cal = el("div", { class: "cal" });
  const head = el("div", { class: "cal-head" });
  head.append(el("button", { class: "tool-btn", onClick: () => { calMonth = calMonth.m === 0 ? { y: calMonth.y - 1, m: 11 } : { y: calMonth.y, m: calMonth.m - 1 }; render(); } }, "‹"));
  head.append(el("div", { class: "cal-title" }, `${monthName} ${calMonth.y}`));
  head.append(el("button", { class: "tool-btn", onClick: () => { calMonth = calMonth.m === 11 ? { y: calMonth.y + 1, m: 0 } : { y: calMonth.y, m: calMonth.m + 1 }; render(); } }, "›"));
  head.append(icsImportZone());
  cal.append(head);

  // Fetch this month's schedule blocks (Outlook imports + hand-made) and group
  // them by day so they show alongside task due-dates.
  loadCalBlocks(calMonth.y, calMonth.m);
  const monthBlocks = calBlocks[`${calMonth.y}-${calMonth.m}`] || [];
  const blocksByDay = {};
  monthBlocks.forEach((b) => { (blocksByDay[b.day] = blocksByDay[b.day] || []).push(b); });

  const grid = el("div", { class: "cal-grid" });
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => grid.append(el("div", { class: "cal-dow" }, d)));
  for (let i = 0; i < startDow; i++) grid.append(el("div"));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = ds === todayStr();
    const cell = el("div", { class: "cal-cell" + (isToday ? " today" : "") });
    cell.append(el("div", { class: "cal-num" }, String(d)));
    // Calendar/Outlook events first (clicking jumps to that day in Today).
    const evs = (blocksByDay[ds] || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    evs.slice(0, 3).forEach((b) => {
      const t12 = fmtTime12(b.start);
      cell.append(el("div", { class: "cal-event", style: `border-left:3px solid ${b.color || "#5d7479"}`, title: `${t12} · ${b.label || ""}`, onClick: () => { scheduleDay = ds; scheduleBlocks = null; setView("today"); } },
        el("span", { class: "cal-ev-time" }, t12), el("span", { class: "cal-ev-lab" }, b.label || "(busy)")));
    });
    if (evs.length > 3) cell.append(el("div", { class: "cal-more" }, `+${evs.length - 3} event${evs.length - 3 === 1 ? "" : "s"}`));
    const dayTasks = byDay[ds] || [];
    dayTasks.slice(0, 2).forEach((t) => {
      const bg = statusCol ? colorOf("status", t.cells[statusCol.id]) : "#00859b";
      cell.append(el("div", { class: "cal-task", style: `background:${bg}` }, t.cells[pCol.id] || "Untitled"));
    });
    if (dayTasks.length > 2) cell.append(el("div", { class: "cal-more" }, `+${dayTasks.length - 2} more`));
    grid.append(cell);
  }
  cal.append(grid);
  board.append(cal);
}

// "14:30" → "2:30p"
function fmtTime12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || "";
  let h = Number(m[1]); const mm = m[2]; const ap = h >= 12 ? "p" : "a";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm}${ap}`;
}

function emptyBoard() {
  const d = el("div", { class: "empty-board" });
  d.innerHTML = 'No tasks yet. Click <b>+ New Task</b> to begin.';
  return d;
}

// ============================================================================
// TODAY HUB (2026-06-27-B) — Day / Week / Month sub-tabs. The old Calendar
// tab is folded in here: Month = the existing monthly grid, Week = a new
// 7-day view. Day = the existing Today schedule.
// ============================================================================
let gdShowHidden = false;

function renderTodayHub() {
  gsInjectCss();
  const board = $("#board");
  board.innerHTML = "";
  const nav = el("div", { class: "gs-subnav" });
  [["day", "\u25F4 Today"], ["week", "\u25A6 Week"], ["month", "\u25A3 Month"]].forEach(([k, label]) => {
    nav.append(el("button", { class: "gs-subbtn" + (todaySub === k ? " active" : ""), onClick: () => { todaySub = k; render(); } }, label));
  });
  board.append(nav);
  if (todaySub === "week") { renderCalendarWeek(); return; }
  if (todaySub === "month") { renderCalendar(); return; }
  renderToday();
}

function renderCalendarWeek() {
  const board = $("#board");
  const dateCol = STATE.columns.find((c) => c.type === "date");
  const statusCol = STATE.columns.find((c) => c.type === "status");
  const pCol = primaryCol();
  const start = new Date(calWeekStart);
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Tasks by due date (dedupe linked copies, same pattern as the month grid).
  const byDay = {}; const seenPerDay = {};
  if (dateCol) filteredTasks().filter((t) => !t.parent_id).forEach((t) => {
    const dv = t.cells[dateCol.id]; if (!dv) return;
    const key = t.link_id ? "link:" + t.link_id : "name:" + String(t.cells[pCol.id] || "").trim().toLowerCase();
    const seen = seenPerDay[dv] || (seenPerDay[dv] = new Set());
    if (seen.has(key)) return; seen.add(key);
    (byDay[dv] = byDay[dv] || []).push(t);
  });
  // Outlook/hand-made blocks for whatever month(s) the week spans.
  const months = new Set(days.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  months.forEach((mk) => { const [y, m] = mk.split("-").map(Number); loadCalBlocks(y, m); });
  const blocksByDay = {};
  months.forEach((mk) => { const [y, m] = mk.split("-").map(Number); (calBlocks[`${y}-${m}`] || []).forEach((b) => { (blocksByDay[b.day] = blocksByDay[b.day] || []).push(b); }); });

  const wrap = el("div", { class: "calw" });
  const head = el("div", { class: "calw-head" });
  head.append(el("button", { class: "tool-btn", onClick: () => { calWeekStart.setDate(calWeekStart.getDate() - 7); calWeekStart = new Date(calWeekStart); render(); } }, "\u2039"));
  const label = `${days[0].toLocaleString("default", { month: "short", day: "numeric" })} \u2013 ${days[6].toLocaleString("default", { month: "short", day: "numeric" })}`;
  head.append(el("div", { class: "calw-title" }, label));
  head.append(el("button", { class: "tool-btn", onClick: () => { calWeekStart.setDate(calWeekStart.getDate() + 7); calWeekStart = new Date(calWeekStart); render(); } }, "\u203A"));
  head.append(el("button", { class: "tool-btn", onClick: () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); calWeekStart = d; render(); } }, "This week"));
  head.append(icsImportZone());
  wrap.append(head);
  if (!dateCol) wrap.append(el("div", { class: "muted", style: "padding:2px 0 10px" }, "Add a Date column to place tasks; calendar events still show."));

  const grid = el("div", { class: "calw-grid" });
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  days.forEach((d, i) => {
    const ds = ymd(d);
    const isToday = ds === todayStr();
    const col = el("div", { class: "calw-col" + (isToday ? " today" : "") });
    col.append(el("div", { class: "calw-dow" }, DOW[i]));
    col.append(el("div", { class: "calw-date" }, String(d.getDate())));
    const evs = (blocksByDay[ds] || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    evs.slice(0, 4).forEach((b) => {
      col.append(el("div", { class: "calw-ev", style: `border-left-color:${b.color || "#5d7479"}`, title: `${fmtTime12(b.start)} \u00B7 ${b.label || ""}`, onClick: () => { scheduleDay = ds; scheduleBlocks = null; todaySub = "day"; setView("today"); } },
        el("b", {}, fmtTime12(b.start)), b.label || "(busy)"));
    });
    if (evs.length > 4) col.append(el("div", { class: "calw-more" }, `+${evs.length - 4} more`));
    (byDay[ds] || []).slice(0, 5).forEach((t) => {
      const bg = statusCol ? colorOf("status", t.cells[statusCol.id]) : "#00859b";
      col.append(el("div", { class: "calw-task", style: `background:${bg}` }, t.cells[pCol.id] || "Untitled"));
    });
    const extra = (byDay[ds] || []).length - 5;
    if (extra > 0) col.append(el("div", { class: "calw-more" }, `+${extra} more`));
    grid.append(col);
  });
  wrap.append(grid);
  board.append(wrap);
}

function render() {
  normalizeFoldedView();
  const board = $("#board");
  // Preserve each group's horizontal scroll so a re-render (cell edit, timer
  // click, etc.) doesn't snap wide tables back to the left.
  const savedScroll = {};
  board.querySelectorAll(".group[data-group]").forEach((gEl) => {
    const w = gEl.querySelector(".table-wrap");
    if (w && w.scrollLeft) savedScroll[gEl.dataset.group] = w.scrollLeft;
  });
  // Preserve the Today schedule's vertical scroll (only when the grid is
  // actually on screen — the brief "Loading…" state must not clobber it).
  {
    const tg = board.querySelector(".today-grid");
    if (tg) todayGridScroll = tg.scrollTop;
  }
  board.innerHTML = "";
  if (currentView === "table") renderTable();
  else if (currentView === "kanban") renderKanban();
  else if (currentView === "rewards") renderRewards();
  else if (currentView === "today") renderTodayHub();
  else if (currentView === "matrix") renderMatrix();
  else if (currentView === "goals") renderGoals();
  else if (currentView === "vibe") renderVibe();
  else if (currentView === "improve") renderImprovements();
  else if (currentView === "studio") renderPromptStudio();
  else if (currentView === "zen") renderZen();
  else if (currentView === "ideas") renderIdeas();
  else if (currentView === "para") renderPara();
  else if (currentView === "notes") renderNotebookShell();
  else if (currentView === "career") renderCareer();
  else if (currentView === "signal") renderSignalBoost();
  else renderCalendar();
  // Restore scroll positions
  board.querySelectorAll(".group[data-group]").forEach((gEl) => {
    const s = savedScroll[gEl.dataset.group];
    if (s) { const w = gEl.querySelector(".table-wrap"); if (w) w.scrollLeft = s; }
  });
  if (currentView === "today") {
    const g = board.querySelector(".today-grid");
    if (g) {
      if (todayGridScroll != null) {
        g.scrollTop = todayGridScroll;          // stay where the user was
      } else {
        // Fresh open: jump to the first scheduled block so the day starts at
        // the first activity rather than an empty 6 AM.
        const fb = g.querySelector(".today-block");
        if (fb) g.scrollTop = Math.max(0, fb.offsetTop - 12);
      }
    }
  }
  updatePointsBadge();
}
