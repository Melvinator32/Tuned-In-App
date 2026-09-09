/* Tuned In — app.js
   Core — state, API + undo, loadState, mutations, helpers, cell renderers, per-task timers, estimate alarm
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

/* ===========================================================
   Tuned In — frontend
   Talks to the Flask JSON API, renders Table / Kanban / Calendar.
   =========================================================== */

const CFG = window.RS_CONFIG;
const GROUP_COLORS = ["#00859b", "#77b28c", "#38a66f", "#00bfb8", "#bce194"];
// Curated brand swatches offered in the group color picker
const GROUP_SWATCHES = ["#00859b", "#00bfb8", "#77b28c", "#38a66f", "#bce194", "#cce7eb", "#e2725b", "#7a1f1f", "#b3b3b3", "#1c1c1e"];

let STATE = { columns: [], tasks: [], automations: [], palette: { status: [], priority: [] }, group_colors: {}, group_order: {} };

// Which parent tasks are expanded to show their subtasks (persists in-session).
const expandedParents = new Set();
// Parents whose finished subtasks are being shown anyway. Done subtasks
// collapse out of the way by default (see hideDoneSubs); this set is the
// per-parent "show them anyway" override and is deliberately NOT persisted —
// each session starts tidy.
const revealDoneSubs = new Set();
// Global switch for that behavior, persisted in settings.
function hideDoneSubs() {
  const v = STATE.settings && STATE.settings.hide_done_subs;
  return v === undefined || v === null || v === "" ? true : v === "1";
}
// Which groups are collapsed (header only, table hidden).
const collapsedGroups = new Set();

// Pillar/Idea cell collapse. A global flag (persisted in settings) collapses every
// Pillar & Idea cell to one line; a per-cell override set flips individual cells
// the other way (ephemeral, like group/subtask collapse). Effective state for a
// cell = global XOR override.
let goalCellsCollapsed = false;        // hydrated from settings in loadState()
const goalCellOverrides = new Set();   // keys "<taskId>:<colId>" flipped vs global
function goalCellKey(taskId, colId) { return taskId + ":" + colId; }
function goalCellIsCollapsed(taskId, colId) {
  const flipped = goalCellOverrides.has(goalCellKey(taskId, colId));
  return goalCellsCollapsed ? !flipped : flipped;
}

// Tracks the task currently being dragged (id + its origin group) so we can
// support dropping into a DIFFERENT group, not just reordering within one.
let dragState = null;
// Tracks a whole-group drag (reordering groups on the board).
let groupDragState = null;
// Tracks a column-header drag (reordering columns).
let colDragState = null;
// Tracks a Kanban lane-header drag (reordering status lanes).
let laneDragState = null;

// Subtask helpers
function childrenOf(parentId) {
  return STATE.tasks.filter((t) => t.parent_id === parentId);
}
function isDoneStatus(task) {
  const statusCol = STATE.columns.find((c) => c.type === "status");
  if (!statusCol) return false;
  return task.cells[statusCol.id] === "Done";
}
// Children of a parent, minus the finished ones when they're collapsed away.
function visibleChildrenOf(parentId) {
  const kids = childrenOf(parentId);
  if (!hideDoneSubs() || revealDoneSubs.has(parentId)) return kids;
  return kids.filter((k) => !isDoneStatus(k));
}
function hiddenDoneCount(parentId) {
  return childrenOf(parentId).length - visibleChildrenOf(parentId).length;
}
function subtaskProgress(parentId) {
  const kids = childrenOf(parentId);
  if (kids.length === 0) return null;
  const done = kids.filter(isDoneStatus).length;
  return { done, total: kids.length };
}

// A group's color: custom one if set, else a stable default from the rotating
// palette based on the group's index among all groups.
function groupColor(name, indexFallback) {
  const custom = (STATE.group_colors || {})[name];
  if (custom) return custom;
  return GROUP_COLORS[indexFallback % GROUP_COLORS.length];
}
let currentView = (() => {
  try { return localStorage.getItem("rs_view") || "table"; } catch (e) { return "table"; }
})();
let goalsSubview = "dash";
let gsDetailId = null;
let todaySub = "day";
let calWeekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; })();
// Tabs folded into hubs (Map+Improvements -> Goals, Calendar -> Today): remap stale saved views.
function normalizeFoldedView() {
  if (currentView === "map") { currentView = "goals"; goalsSubview = "map"; }
  else if (currentView === "improve") { currentView = "goals"; goalsSubview = "improve"; }
  else if (currentView === "calendar") { currentView = "today"; todaySub = "month"; }
}
normalizeFoldedView();
let search = "";

const $ = (sel, root = document) => root.querySelector(sel);
const todayStr = () => new Date().toISOString().slice(0, 10);

// Palette-driven lookups (status/priority values are now user-defined data).
function paletteFor(type) {
  if (type === "status") return STATE.palette.status || [];
  if (type === "priority") return STATE.palette.priority || [];
  return [];
}
function colorOf(type, value) {
  const entry = paletteFor(type).find((p) => p.label === value);
  return entry ? entry.color : "#b3b3b3";
}
function valuesFor(type) {
  return paletteFor(type).map((p) => p.label);
}
// Severity rank for a priority value = its position in the palette (lower = higher severity).
function priorityRank(value) {
  const list = STATE.palette.priority || [];
  const idx = list.findIndex((p) => p.label === value);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}
// Composite ordering used by Sort: completed tasks sink to the bottom, then by
// priority severity, with current position as a stable tiebreaker. Applies to
// top-level rows AND to subtasks among their siblings (they share the per-group
// sort), so "Done at the bottom" holds at every level.
function taskSortCompare(a, b) {
  const prioCol = STATE.columns.find((c) => c.type === "priority");
  const da = isDoneStatus(a) ? 1 : 0;
  const db = isDoneStatus(b) ? 1 : 0;
  if (da !== db) return da - db;                    // not-done before done
  if (prioCol) {
    const pa = priorityRank(a.cells[prioCol.id]);
    const pb = priorityRank(b.cells[prioCol.id]);
    if (pa !== pb) return pa - pb;                  // higher priority first
  }
  const dua = dueRank(a), dub = dueRank(b);
  if (dua !== dub) return dua < dub ? -1 : 1;       // within a priority: earlier due date first, no date last
  return (a.position || 0) - (b.position || 0);     // stable
}
// The board's due-date column: a date column named like "due", else the first
// date column. Detected by type + name, never by a hardcoded id.
function dueDateCol() {
  const dates = STATE.columns.filter((c) => c.type === "date");
  return dates.find((c) => /due/i.test(c.name || "")) || dates[0] || null;
}
// Sortable due-date key for a task: the ISO yyyy-mm-dd string (ISO dates compare
// correctly as strings), or a far-future sentinel for blank/invalid so undated
// tasks sink below dated ones within the same priority.
function dueRank(t) {
  const dc = dueDateCol();
  const v = dc ? String(t.cells[dc.id] || "").trim() : "";
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "9999-12-31";
}
function primaryCol() {
  return STATE.columns.find((c) => c.is_primary) || STATE.columns[0];
}

// Tasks parked with someone/something else stay on the board but are kept OUT
// of the planning views (Today schedule, Eisenhower matrix). A task counts as
// parked if its GROUP or its STATUS mentions any of these — so renamed groups
// (e.g. "Holding Pattern / Pending") and status-only cases are both caught.
const PLANNING_EXCLUDED_TERMS = [
  "holding pattern", "someone else", "in other court", "waiting for feedback",
];
function excludedFromPlanning(t) {
  const g = String(t.group_name || "").toLowerCase();
  if (PLANNING_EXCLUDED_TERMS.some((term) => g.includes(term))) return true;
  const sc = STATE.columns.find((c) => c.type === "status");
  if (sc) {
    const sv = String(t.cells[sc.id] || "").toLowerCase();
    if (PLANNING_EXCLUDED_TERMS.some((term) => sv.includes(term))) return true;
  }
  return false;
}

// ---------------- Column widths ----------------
// A column's display width in px: its saved width, or a type-based default.
function colWidth(col) {
  if (col.width != null && col.width !== "") return Number(col.width);
  if (col.is_primary) return 260;
  switch (col.type) {
    case "status": return 150;
    case "priority": return 130;
    case "date": return 150;
    case "number": return 110;
    case "person": return 150;
    default: return 170;
  }
}

// Drag the grip on a column header's right edge to resize that column. The new
// width is applied live to every group table (so they stay aligned) and saved.
function attachColumnResize(grip, th, col) {
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    document.body.classList.add("col-resizing");

    const onMove = (ev) => {
      const newW = Math.max(60, Math.min(900, Math.round(startW + (ev.clientX - startX))));
      // Apply live to ALL tables' matching column (header + first body row is enough
      // for fixed layout, but set every header th for crisp feedback)
      document.querySelectorAll("table.fixed-cols").forEach((tbl) => {
        const ths = tbl.querySelectorAll("thead th");
        // column index = position among data columns + 1 (handle cell is first)
        const idx = STATE.columns.findIndex((c) => c.id === col.id) + 1;
        if (ths[idx]) ths[idx].style.width = newW + "px";
        // also set the matching col in the first body row for fixed-layout stability
      });
      grip._lastW = newW;
    };
    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      const finalW = grip._lastW;
      if (finalW && finalW !== Math.round(startW)) {
        col.width = finalW;  // update local state
        try {
          await api(`/api/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ width: finalW }) });
        } catch (err) { console.error("[col resize] save failed:", err); }
        render();  // re-render so every table picks up the saved width cleanly
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// Drag a column header's ⠿ handle onto another header to reorder columns.
// The primary column is fixed in first place and isn't a drop target before it.
function attachColumnReorder(handle, th, col) {
  handle.addEventListener("dragstart", (e) => {
    colDragState = { id: col.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "col:" + col.id);
    th.classList.add("col-dragging");
  });
  handle.addEventListener("dragend", () => {
    th.classList.remove("col-dragging");
    document.querySelectorAll(".col-drop-before, .col-drop-after").forEach((n) =>
      n.classList.remove("col-drop-before", "col-drop-after"));
    colDragState = null;
  });
  // The whole th is a drop target while a column drag is active
  th.addEventListener("dragover", (e) => {
    if (!colDragState || colDragState.id === col.id || col.is_primary) return;
    e.preventDefault();
    const rect = th.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    th.classList.toggle("col-drop-after", after);
    th.classList.toggle("col-drop-before", !after);
  });
  th.addEventListener("dragleave", () => {
    th.classList.remove("col-drop-before", "col-drop-after");
  });
  th.addEventListener("drop", async (e) => {
    if (!colDragState || colDragState.id === col.id || col.is_primary) return;
    e.preventDefault();
    const rect = th.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    await reorderColumns(colDragState.id, col.id, after);
  });
}

// Move column `movedId` to before/after `targetId`, keeping the primary column
// pinned first, then persist the new order.
async function reorderColumns(movedId, targetId, after) {
  const order = STATE.columns.map((c) => c.id);
  const moved = order.splice(order.indexOf(movedId), 1)[0];
  let idx = order.indexOf(targetId);
  if (after) idx += 1;
  order.splice(idx, 0, moved);
  // Keep the primary column first no matter what
  const primary = STATE.columns.find((c) => c.is_primary);
  if (primary) {
    const pi = order.indexOf(primary.id);
    if (pi > 0) { order.splice(pi, 1); order.unshift(primary.id); }
  }
  // Reorder STATE.columns to match + update positions locally
  STATE.columns.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  STATE.columns.forEach((c, i) => { c.position = i; });
  colDragState = null;
  render();
  try {
    await api("/api/columns/reorder", { method: "PATCH", body: JSON.stringify({ order }) });
  } catch (err) { console.error("[col reorder] save failed:", err); }
}

// ---------------- API ----------------
// ---------------- Undo / redo ----------------
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 60;
let restoringSnapshot = false;  // guard so restore's own api calls don't snapshot

// Undo is whole-board: it POSTs an entire snapshot back and the server rewrites
// every table from it. With the board on a server several devices reach, that is
// only safe while this page has seen everything on it. The server returns a
// revision number with every response; we send the one we last saw along with a
// restore, and it refuses if the board moved on in the meantime.
let BOARD_REVISION = null;

function snapshotState() {
  // Deep clone the parts /api/restore needs
  return JSON.stringify({
    columns: STATE.columns, tasks: STATE.tasks, automations: STATE.automations,
    palette: STATE.palette, group_colors: STATE.group_colors,
    group_order: STATE.group_order, settings: STATE.settings,
  });
}
let _lastSnapAt = 0;
function pushUndoSnapshot() {
  if (restoringSnapshot) return;
  const snap = snapshotState();
  const now = Date.now();
  // Coalesce: if the previous snapshot is identical OR was taken within a brief
  // window (same logical action that fired multiple API calls), don't stack a
  // second undo step.
  if (undoStack.length) {
    const top = undoStack[undoStack.length - 1];
    if (top === snap || (now - _lastSnapAt) < 350) {
      _lastSnapAt = now;
      redoStack.length = 0;
      return;
    }
  }
  undoStack.push(snap);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  _lastSnapAt = now;
}
async function applySnapshot(snapJson) {
  restoringSnapshot = true;
  try {
    const snap = JSON.parse(snapJson);
    snap.base_revision = BOARD_REVISION;
    await api("/api/restore", { method: "POST", body: JSON.stringify(snap) });
    await loadState();
  } finally {
    restoringSnapshot = false;
  }
}

// A refused restore means this page is behind another device. Every snapshot we
// hold predates that work, so all of them are unsafe — drop the whole history
// rather than leave a button that would only fail again. Returns true if it
// handled the error.
function handleStaleBoard(err) {
  const stale = err && err.status === 409 && err.data && err.data.error === "stale_revision";
  if (!stale) return false;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButtons();
  showStaleBoardBanner(err.data.message);
  return true;
}

function showStaleBoardBanner(message) {
  const existing = document.getElementById("stale-board-banner");
  if (existing) existing.remove();
  const banner = el("div", { id: "stale-board-banner", class: "stale-banner" },
    message || "The board changed on another device, so this page is out of date.",
    " ",
    el("button", { class: "tool-btn", style: "margin-left:8px",
      onClick: () => location.reload() }, "Reload"),
    el("button", { class: "tool-btn", style: "margin-left:6px",
      onClick: () => { const b = document.getElementById("stale-board-banner"); if (b) b.remove(); } },
      "Dismiss"));
  document.body.prepend(banner);
}
// The buttons reflect what's actually available, so a greyed-out arrow means
// there is genuinely nothing to undo rather than a broken control.
function updateUndoButtons() {
  const u = document.getElementById("btn-undo");
  const r = document.getElementById("btn-redo");
  if (u) { u.disabled = undoStack.length === 0; u.title = undoStack.length ? `Undo (Ctrl+Z) — ${undoStack.length} step${undoStack.length === 1 ? "" : "s"}` : "Nothing to undo"; }
  if (r) { r.disabled = redoStack.length === 0; r.title = redoStack.length ? `Redo (Ctrl+Y) — ${redoStack.length} step${redoStack.length === 1 ? "" : "s"}` : "Nothing to redo"; }
}

async function doUndo() {
  if (undoStack.length === 0) return;
  const current = snapshotState();
  const prev = undoStack.pop();
  try {
    await applySnapshot(prev);
  } catch (err) {
    if (handleStaleBoard(err)) return;   // it cleared both stacks already
    undoStack.push(prev);                // transient failure — keep the step
    updateUndoButtons();
    throw err;
  }
  redoStack.push(current);               // only once the restore actually landed
  updateUndoButtons();
}
async function doRedo() {
  if (redoStack.length === 0) return;
  const current = snapshotState();
  const next = redoStack.pop();
  try {
    await applySnapshot(next);
  } catch (err) {
    if (handleStaleBoard(err)) return;
    redoStack.push(next);
    updateUndoButtons();
    throw err;
  }
  undoStack.push(current);
  updateUndoButtons();
}

async function api(path, opts) {
  // Snapshot the pre-action state for undo on any mutating call (but not for
  // reads, and not for restore itself).
  const method = (opts && opts.method) || "GET";
  if (method !== "GET" && path !== "/api/restore" && path !== "/api/state" && !restoringSnapshot) {
    pushUndoSnapshot();
  }
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  // Every API response reports where the board now stands. Remembering it is
  // what lets a whole-board restore prove it isn't about to overwrite work
  // done on another device.
  const rev = res.headers.get("X-Board-Revision");
  if (rev !== null && rev !== "") BOARD_REVISION = Number(rev);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text);
    err.status = res.status;
    try { err.data = JSON.parse(text); } catch (e) { /* not a JSON error body */ }
    throw err;
  }
  return res.status === 204 ? null : res.json();
}
// Must match SERVER_BUILD in app.py for this release. If the running server
// reports a different build, the files were updated without restarting the
// server — show a clear banner instead of letting features fail mysteriously.
const EXPECTED_SERVER_BUILD = "2026-08-21-A";
function checkServerBuild() {
  const existing = document.getElementById("stale-server-banner");
  if (STATE.server_build === EXPECTED_SERVER_BUILD) { if (existing) existing.remove(); return; }
  if (existing) return;
  const banner = el("div", { id: "stale-server-banner", class: "stale-banner" },
    "Tuned In's files were updated, but the app is still running the old version. ",
    el("b", {}, "Close the Tuned In window and double-click the launcher again"),
    " to finish updating.");
  document.body.prepend(banner);
}

async function loadState() {
  STATE = await api("/api/state");
  goalCellsCollapsed = (STATE.settings && STATE.settings["goal_collapsed"]) === "true";
  updateCollapseGoalsBtn();    // reflect the Pillar/Idea collapse toggle
  applyDensity(getDensity());  // reflect any saved display-density setting
  applyHeaderSettings();       // reflect any saved header visibility settings
  if (typeof applyTheme === "function") applyTheme();
  checkServerBuild();          // warn if the server process is stale
  applyTabOrder();             // arrange tabs in the user's saved order
  updateAlarmToggle();         // reflect the alarm on/off setting
  applyZenBackdrop();          // reflect a saved zen-garden backdrop
  render();
  ensureTimerTick();           // keep running timers ticking live
}

// ---------------- Display density ----------------
// A single 0..100 slider value maps to a font scale and row padding.
const DENSITY_KEY = "density";
function getDensity() {
  const v = STATE.settings && STATE.settings[DENSITY_KEY];
  const n = v == null ? 40 : Number(v);   // default 40 ≈ "Normal"
  return isNaN(n) ? 40 : Math.max(0, Math.min(100, n));
}
function applyDensity(val) {
  // Map slider 0..100 → scale 0.85..1.45 and row padding 3px..14px
  const scale = 0.85 + (val / 100) * 0.60;
  const padY = 3 + (val / 100) * 11;
  document.documentElement.style.setProperty("--density-scale", scale.toFixed(3));
  document.documentElement.style.setProperty("--row-pad-y", padY.toFixed(1) + "px");
}

// ---------------- Mutations ----------------
async function updateCell(taskId, colId, value) {
  const before = STATE.tasks.find((x) => x.id === taskId);
  const prevGroup = before ? before.group_name : undefined;
  const resp = await api(`/api/tasks/${taskId}/cell`, {
    method: "PATCH",
    body: JSON.stringify({ col: colId, value }),
  });
  // If this task is linked to copies in other groups (or copies were just
  // collapsed because it was marked Done), the simplest correct refresh is to
  // reload the whole board so every copy reflects the change.
  if (resp.linked_changed || resp.collapsed) {
    await loadState();
    return;
  }
  const t = STATE.tasks.find((x) => x.id === taskId);
  if (t) {
    t.cells = resp.cells; // pick up automation side-effects on cells
    if (resp.group_name !== undefined) t.group_name = resp.group_name;
  }
  // An automation may have moved the task to a different group, and the row
  // then belongs somewhere else entirely - that needs the whole board. When it
  // has not moved, only this task's own cells changed, so rebuilding its row is
  // both enough and far cheaper. refreshTaskCells says no when it cannot be
  // sure, and then we fall back.
  const movedGroup = resp.group_name !== undefined && resp.group_name !== prevGroup;
  if (movedGroup || !refreshTaskCells(taskId, colId)) render();
}

// Shows a confirm dialog when an action would create a duplicate in a group.
// Resolves true if the user chooses "Add anyway", false on cancel.
function confirmDuplicate(info) {
  return new Promise((resolve) => {
    const reason = info.kind === "link"
      ? `This task is already in “${info.group}” (a linked copy of it lives there).`
      : `A task named “${info.name}” already exists in “${info.group}”.`;
    openModal("Possible duplicate", (body, close) => {
      body.append(el("p", { style: "margin-top:0;font-size:13px;color:var(--ink)" }, reason));
      body.append(el("p", { style: "font-size:12px;color:var(--mid-gray)" },
        info.kind === "link"
          ? "Adding it again would put two identical synced copies in the same group."
          : "You can keep both, or cancel to avoid a duplicate."));
      const btns = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:8px" });
      btns.append(el("button", { class: "tool-btn", onClick: () => { close(); resolve(false); } }, "Cancel"));
      btns.append(el("button", { class: "tool-btn accent-teal", onClick: () => { close(); resolve(true); } }, "Add anyway"));
      body.append(btns);
    });
  });
}

async function copyTaskToGroup(taskId, group, force = false) {
  const cleanGroup = (typeof group === "string" && group.trim() && group.trim() !== "undefined")
    ? group.trim() : null;
  if (!cleanGroup) return;
  const resp = await api(`/api/tasks/${taskId}/copy`, {
    method: "POST", body: JSON.stringify({ group: cleanGroup, force }),
  });
  if (resp && resp.needs_confirm) {
    const ok = await confirmDuplicate(resp);
    if (!ok) return;
    return copyTaskToGroup(taskId, cleanGroup, true);  // retry, forced
  }
  await loadState();  // new linked placement (+ any subtasks) — reload to show it
}
async function addTask(group, parentId = null) {
  // Defensive: never send undefined/null/"undefined" through — that path was
  // the source of an earlier display bug.
  const cleanGroup = (typeof group === "string" && group.trim() && group.trim() !== "undefined")
    ? group.trim()
    : "All Active Tasks";
  const payload = { group: cleanGroup };
  if (parentId) payload.parent_id = parentId;
  const t = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
  if (parentId) {
    expandedParents.add(parentId);  // reveal the new subtask immediately
    // The parent may have linked copies; the backend mirrors the subtask into
    // them, so reload to pick up those propagated subtasks.
    await loadState();
  } else {
    STATE.tasks.push(t);
    render();
  }
}
async function deleteTask(taskId) {
  await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  // Drop the task and any of its subtasks from local state (backend cascades too)
  STATE.tasks = STATE.tasks.filter((t) => t.id !== taskId && t.parent_id !== taskId);
  expandedParents.delete(taskId);
  render();
}

// Delete a task INCLUDING its linked copies in other groups. Used from the
// planning views, where chips are deduped and stand for the logical task.
async function deleteTaskEverywhere(task) {
  const ids = STATE.tasks
    .filter((t) => !t.parent_id && (t.id === task.id || (task.link_id && t.link_id === task.link_id)))
    .map((t) => t.id);
  for (const id of ids) {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
  }
  await loadState();
}

async function moveTaskToGroup(taskId, newGroup, force = false) {
  const cleanGroup = (typeof newGroup === "string" && newGroup.trim() && newGroup.trim() !== "undefined")
    ? newGroup.trim()
    : null;
  if (!cleanGroup) {
    console.warn("[moveTaskToGroup] refused — invalid group:", newGroup);
    return;
  }
  const resp = await api(`/api/tasks/${taskId}/group`, {
    method: "PATCH", body: JSON.stringify({ group: cleanGroup, force }),
  });
  if (resp && resp.needs_confirm) {
    const ok = await confirmDuplicate(resp);
    if (!ok) { render(); return; }   // re-render to snap a dragged row back home
    return moveTaskToGroup(taskId, cleanGroup, true);  // retry, forced
  }
  const t = STATE.tasks.find((x) => x.id === taskId);
  if (t) t.group_name = cleanGroup;
  render();
}

/**
 * Delete a group. If it has tasks, ask whether to delete them too or merge them
 * into a different group. Empty groups (none exist in our model — groups are
 * implicit on tasks — but just in case) are dismissed quietly.
 */
function deleteGroup(name) {
  const tasksInGroup = STATE.tasks.filter((t) => t.group_name === name);
  const others = [...new Set(STATE.tasks.map((t) => t.group_name))].filter((g) => g !== name);

  if (tasksInGroup.length === 0) return;

  openModal(`Delete group "${name}"?`, (body, close) => {
    body.append(el("p", { style: "margin-top:0;font-size:14px" },
      `This group contains ${tasksInGroup.length} task${tasksInGroup.length === 1 ? "" : "s"}. What should happen to them?`));

    // Option 1: merge into another existing group
    if (others.length > 0) {
      const mergeBox = el("div", { style: "background:var(--off-white);border-radius:8px;padding:12px;margin-bottom:10px" });
      mergeBox.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px" }, "Move tasks to another group"));
      const row = el("div", { style: "display:flex;gap:8px;align-items:center" });
      const sel = el("select", { class: "sel", style: "flex:1" });
      others.forEach((g) => sel.append(el("option", { value: g }, g)));
      const goBtn = el("button", { class: "tool-btn accent-teal", onClick: async () => {
        await api("/api/groups/delete", { method: "POST", body: JSON.stringify({ name, mode: "merge", merge_into: sel.value }) });
        STATE.tasks.forEach((t) => { if (t.group_name === name) t.group_name = sel.value; });
        STATE.automations.forEach((a) => { if (a.action_type === "moveToGroup" && a.action_val === name) a.action_val = sel.value; });
        close(); render();
      } }, "Move & delete group");
      row.append(sel, goBtn);
      mergeBox.append(row);
      body.append(mergeBox);
    }

    // Option 2: delete the group and all its tasks
    const dangerBox = el("div", { style: "background:#fdecec;border-radius:8px;padding:12px;border:1px solid #f3c5c5" });
    dangerBox.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px;color:#7a1f1f" }, "Or, delete everything"));
    dangerBox.append(el("div", { style: "font-size:12px;color:#7a1f1f;margin-bottom:8px" },
      `Permanently removes the group and all ${tasksInGroup.length} task${tasksInGroup.length === 1 ? "" : "s"} in it. This can't be undone.`));
    const delBtn = el("button", {
      class: "tool-btn",
      style: "background:#7a1f1f;color:#fff;border-color:#7a1f1f",
      onClick: async () => {
        await api("/api/groups/delete", { method: "POST", body: JSON.stringify({ name, mode: "delete" }) });
        STATE.tasks = STATE.tasks.filter((t) => t.group_name !== name);
        STATE.automations.forEach((a) => { if (a.action_type === "moveToGroup" && a.action_val === name) a.enabled = 0; });
        close(); render();
      },
    }, `Delete group and its ${tasksInGroup.length} task${tasksInGroup.length === 1 ? "" : "s"}`);
    dangerBox.append(delBtn);
    body.append(dangerBox);

    // Cancel
    body.append(el("div", { style: "text-align:right;margin-top:14px" },
      el("button", { class: "tool-btn", onClick: () => close() }, "Cancel")));
  });
}

function allGroupNames() {
  // Distinct group names currently in use, in their first-seen order.
  const seen = new Set();
  STATE.tasks.forEach((t) => seen.add(t.group_name));
  return [...seen];
}

/**
 * A small "⋯" button on each row that opens a Move-to popup. Clicking elsewhere
 * closes it. Lets the user move a task to any existing group or create a new one.
 */
function buildRowMenu(task) {
  const wrap = el("span", { class: "row-menu-wrap" });
  const btn = el("button", { class: "row-menu-btn", title: "Move to group" }, "⋯");
  wrap.append(btn);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Close any other open menu first
    closeAllPopovers();

    // Build the menu detached from the table — it will be appended to document.body
    // with position:fixed so it can never be hidden behind table rows, add-task bars,
    // or any subsequent group blocks.
    const menu = el("div", { class: "row-menu floating" });
    menu.append(el("div", { class: "row-menu-head" }, "Move to group"));
    const others = allGroupNames().filter((n) => n !== task.group_name);
    if (others.length === 0) {
      menu.append(el("div", { class: "row-menu-empty" }, "No other groups yet"));
    }
    others.forEach((g) => {
      menu.append(el("div", { class: "row-menu-opt", onClick: async () => { menu.remove(); await moveTaskToGroup(task.id, g); } }, g));
    });
    // "+ New group" inline form
    const newRow = el("div", { class: "row-menu-new" });
    const inp = el("input", { class: "field", placeholder: "+ New group…", style: "padding:5px 8px;font-size:12px;width:100%" });
    inp.addEventListener("keydown", async (ev) => {
      if (ev.key === "Enter" && inp.value.trim()) {
        const target = inp.value.trim();
        menu.remove();
        await moveTaskToGroup(task.id, target);
      } else if (ev.key === "Escape") {
        menu.remove();
      }
    });
    newRow.append(inp);
    menu.append(newRow);

    // --- Copy (linked) to another group — only for top-level tasks ---
    if (!task.parent_id) {
      menu.append(el("div", { class: "row-menu-head", style: "margin-top:8px;border-top:1px solid var(--off-white);padding-top:8px" }, "Copy to group (linked)"));
      const copyTargets = allGroupNames().filter((n) => n !== task.group_name);
      if (copyTargets.length === 0) {
        menu.append(el("div", { class: "row-menu-empty" }, "No other groups yet"));
      }
      copyTargets.forEach((g) => {
        menu.append(el("div", { class: "row-menu-opt", title: "Linked copy — edits sync across copies",
          onClick: async () => { menu.remove(); await copyTaskToGroup(task.id, g); } }, "⧉ " + g));
      });
      // New-group copy form
      const copyNew = el("div", { class: "row-menu-new" });
      const cinp = el("input", { class: "field", placeholder: "⧉ Copy to new group…", style: "padding:5px 8px;font-size:12px;width:100%" });
      cinp.addEventListener("keydown", async (ev) => {
        if (ev.key === "Enter" && cinp.value.trim()) {
          const target = cinp.value.trim();
          menu.remove();
          await copyTaskToGroup(task.id, target);
        } else if (ev.key === "Escape") {
          menu.remove();
        }
      });
      copyNew.append(cinp);
      menu.append(copyNew);
    }

    // Position next to the trigger button using its viewport coords (attaches to body)
    positionFloatingMenu(menu, btn, "below-right");
    inp.focus();

    // dismiss on outside click / Escape
    attachOutsideClose(menu, btn);
  });
  return wrap;
}

/** Close every popover. */
function closeAllPopovers() {
  document.querySelectorAll(".row-menu, .pill-menu, .color-pop").forEach((m) => m.remove());
}
// Close the most-recently-opened modal (if any). Returns true if one closed.
function closeTopModal() {
  const overlays = document.querySelectorAll("#modal-root .modal-overlay");
  if (overlays.length) {
    overlays[overlays.length - 1].remove();
    return true;
  }
  return false;
}

/**
 * Floating color picker for a group. Shows preset swatches, a native
 * custom-color input, and a "Reset" option that clears the custom color so the
 * group falls back to the default rotating palette.
 */
function openGroupColorPicker(groupName, triggerEl) {
  closeAllPopovers();
  const pop = el("div", { class: "color-pop floating" });
  pop.append(el("div", { class: "row-menu-head" }, "Group color"));

  const setColor = async (color) => {
    pop.remove();
    try {
      await api("/api/groups/color", { method: "PATCH", body: JSON.stringify({ name: groupName, color: color || null }) });
      if (color) STATE.group_colors[groupName] = color;
      else delete STATE.group_colors[groupName];
      render();
    } catch (err) {
      console.error("[group color] failed:", err);
    }
  };

  // Swatch grid
  const grid = el("div", { class: "swatch-grid" });
  const current = STATE.group_colors[groupName];
  GROUP_SWATCHES.forEach((c) => {
    const sw = el("button", {
      class: "swatch" + (current === c ? " selected" : ""),
      style: `background:${c}`,
      title: c,
      onClick: () => setColor(c),
    });
    grid.append(sw);
  });
  pop.append(grid);

  // Custom color + reset row
  const customRow = el("div", { class: "color-custom-row" });
  const picker = el("input", { type: "color", class: "color-input", value: current || "#00859b", title: "Custom color" });
  picker.addEventListener("change", () => setColor(picker.value));
  const customLabel = el("label", { class: "color-custom-label" }, picker, el("span", {}, "Custom"));
  customRow.append(customLabel);
  customRow.append(el("button", { class: "color-reset", onClick: () => setColor(null) }, "Reset"));
  pop.append(customRow);

  positionFloatingMenu(pop, triggerEl, "below-left");
  attachOutsideClose(pop, triggerEl);
}

/**
 * Position a floating menu near a trigger using viewport (fixed) coordinates,
 * and leave it attached to document.body. `placement` controls anchoring:
 * "below-left" aligns the menu's left edge to the trigger's left and drops
 * below it; "below-right" aligns the menu's right edge to the trigger's right.
 * Flips above if it would run off the bottom of the viewport.
 */
function positionFloatingMenu(menu, trigger, placement = "below-left") {
  menu.style.position = "fixed";
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";
  document.body.append(menu);
  const t = trigger.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = placement === "below-right" ? (t.right - m.width) : t.left;
  let top = t.bottom + 4;
  left = Math.max(8, Math.min(left, vw - m.width - 8));
  if (top + m.height > vh - 8) {
    top = t.top - m.height - 4;
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.visibility = "";
}

/** Attach outside-click + Escape dismissal to a popover. */
function attachOutsideClose(menu, trigger) {
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== trigger && !trigger.contains?.(ev.target)) {
        menu.remove();
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      }
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        menu.remove();
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
  }, 0);
}

// Reorder whole groups: move `movedName` to before/after `targetName`, then
// The full set of groups that should exist on the board: any group that has
// tasks, plus any group that was created or ordered or colored independently.
// This is what keeps an empty group from vanishing.
function knownGroupNames() {
  const set = new Set();
  STATE.tasks.filter((t) => !t.parent_id).forEach((t) => set.add(t.group_name));
  Object.keys(STATE.group_order || {}).forEach((n) => set.add(n));
  Object.keys(STATE.group_colors || {}).forEach((n) => set.add(n));
  return [...set];
}

// persist the full ordering.
async function reorderGroups(movedName, targetName, after) {
  // Current display order = how renderTable sorted them (include empty groups)
  const names = knownGroupNames();
  names.sort((a, b) => {
    const pa = STATE.group_order[a], pb = STATE.group_order[b];
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pa - pb;
  });
  const without = names.filter((n) => n !== movedName);
  const idx = without.indexOf(targetName);
  const insertAt = after ? idx + 1 : idx;
  without.splice(insertAt, 0, movedName);
  // Reassign positions locally + persist
  without.forEach((n, i) => { STATE.group_order[n] = i; });
  groupDragState = null;
  render();
  await api("/api/groups/reorder", { method: "PATCH", body: JSON.stringify({ order: without }) });
}

// After a drag, read the on-screen row order across ALL groups (in document
// order) and persist it as each task's position. Keeping it global avoids
// position collisions between groups.
async function persistGroupOrder(_tbody, _group) {
  // Only top-level rows are draggable/orderable; skip subtask rows so their
  // interleaved DOM position doesn't corrupt the saved order.
  const ids = [...document.querySelectorAll("#board tbody tr[data-id]:not(.subtask-row)")].map((tr) => tr.dataset.id);
  ids.forEach((id, i) => { const t = STATE.tasks.find((x) => x.id === id); if (t) t.position = i; });
  STATE.tasks.sort((a, b) => a.position - b.position);
  await api("/api/tasks/reorder", { method: "PATCH", body: JSON.stringify({ order: ids }) });
}

// ---------------- Helpers ----------------
function filteredTasks() {
  if (!search) return STATE.tasks;
  const q = search.toLowerCase();
  return STATE.tasks.filter((t) =>
    Object.values(t.cells).some((v) => String(v).toLowerCase().includes(q))
  );
}

// ---- Icons -----------------------------------------------------------------
// Inline SVG rather than emoji: emoji render differently on every platform, some
// don't render at all on Windows, and they can't take the theme's colour. These
// inherit currentColor and scale with font size.
const RS_ICONS = {
  broom:    'M9.5 14.5 4 20M14 3l3 3M12.5 4.5l3 3-5.5 5.5-3-3zM8 12l-3.6 3.6a2 2 0 0 0-.5 2L4 19l1.4.1a2 2 0 0 0 2-.5L11 15z',
  bolt:     'M9.5 2 4 12h4l-1.5 8L14 9h-4l1.5-7z',
  gear:     'M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4',
  calendar: 'M4.5 5.5h15v14h-15zM4.5 10h15M8.5 3v4M15.5 3v4',
  bell:     'M12 3a5.5 5.5 0 0 0-5.5 5.5V13L5 16h14l-1.5-3V8.5A5.5 5.5 0 0 0 12 3zM10 19a2 2 0 0 0 4 0',
  bellOff:  'M12 3a5.5 5.5 0 0 0-5.5 5.5V13L5 16h14l-1.5-3V8.5A5.5 5.5 0 0 0 12 3zM10 19a2 2 0 0 0 4 0M3 3l18 18',
  flag:     'M6 21V4M6 4h11l-2 3.5L17 11H6',
  clipboard:'M9 3.5h6v3H9zM7 5H5.5v15.5h13V5H17',
  hand:     'M9 12V5.5a1.5 1.5 0 0 1 3 0V11m0-.5V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0',
  eyeOff:   'M3 3l18 18M10.6 5.2A7.6 7.6 0 0 1 12 5c5 0 9 5 9 7a11 11 0 0 1-2.3 3.1M6.5 7.4C4.3 8.9 3 11.2 3 12c0 2 4 7 9 7a8.6 8.6 0 0 0 3.4-.7M9.9 9.9a3 3 0 0 0 4.2 4.2',
  dice:     'M5 5.5h14v14H5zM9 9.5h.01M15 9.5h.01M12 12.5h.01M9 15.5h.01M15 15.5h.01',
  image:    'M4 5.5h16v13H4zM4 15l4.5-4.5 4 4L16 11l4 4M9 9.5h.01',
  chart:    'M4 20V9M10 20V4M16 20v-7M22 20H2',
  doc:      'M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6',
  abacus:   'M4 4v16M20 4v16M4 8h16M4 13h16M8 6v4M14 6v4M11 11v4M17 11v4',
  search:   'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.2 16.2 21 21',
  cap:      'M2.5 8.5 12 4.5l9.5 4-9.5 4zM6.5 11v5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-5',
  pen:      'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z',
  compass:  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  scales:   'M12 4v16M6 20h12M4 9l3.5-4L11 9M3.5 9a3.5 3.5 0 0 0 7 0zM13 9l3.5-4L20 9M12.5 9a3.5 3.5 0 0 0 7 0z',
  tools:    'M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-8 8a2 2 0 0 1-2.8-2.8zM6.5 4l2.5 2.5M4 6.5 6.5 4M4.8 9.2 9.2 4.8',
  mail:     'M3.5 6h17v12h-17zM3.5 6.5 12 13l8.5-6.5',
  tree:     'M12 3 6.5 12h11zM12 8l-4 7h8zM12 15v6M9 21h6',
  bamboo:   'M9 21V3M15 21V3M6 8h6M12 8h6M6 14h6M12 14h6',
  lantern:  'M12 3v2M12 19v2M8 6h8l1.5 5-1.5 5H8l-1.5-5zM9.5 6v10M14.5 6v10',
  circle:   'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
  pagoda:   'M12 3 4 8h16zM6 8v3M18 8v3M5 11h14l-2 3H7zM8 14v4M16 14v4M6.5 18h11l-1 3h-9z',
  tag:      'M11 3H3v8l10 10 8-8zM7.5 7.5h.01',
  columns:  'M4 4.5h16v15H4zM10 4.5v15M16 4.5v15',
  moon:     'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  sun:      'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2.2M12 19.8V22M22 12h-2.2M4.2 12H2M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6M19.1 19.1l-1.6-1.6M6.5 6.5 4.9 4.9',
  sliders:  'M4 8h10M18 8h2M4 16h4M12 16h8M15 5.5v5M8 13.5v5',
  header:   'M4 5.5h16v5H4zM4 14h7M4 17.5h11',
  contrast: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17a8.5 8.5 0 0 0 0-17z',
  keyboard: 'M3 6.5h18v11H3zM7 10h.01M11 10h.01M15 10h.01M17.5 10h.01M6.5 13.5h.01M8.5 13.5h7M17.5 13.5h.01',
  history:  'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V10h5.5M12 7.5V12l3 2',
};
function icon(name, size) {
  const d = RS_ICONS[name];
  if (!d) return document.createTextNode("");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const s = size || 14;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", s); svg.setAttribute("height", s);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "rs-ic");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}
// For places that build markup as a string rather than DOM nodes.
function iconHtml(name, size) {
  const d = RS_ICONS[name];
  if (!d) return "";
  const s = size || 14;
  return `<svg class="rs-ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" `
       + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

/**
 * Make any text element click-to-rename.
 *   span        : the element whose text becomes editable
 *   currentVal  : a function returning the current value (so it stays fresh)
 *   onCommit    : async (newValue) — only called when value actually changed
 *   placeholder : optional placeholder for the input
 */
function inlineRename(span, currentVal, onCommit, placeholder = "") {
  span.classList.add("editable");
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    const original = String(currentVal() ?? "");
    // Build the input WITHOUT relying on the value-attribute path in el(); set
    // the live .value property directly so the field always shows the current name.
    const inp = document.createElement("input");
    inp.className = "inline-rename";
    inp.value = original;
    if (placeholder) inp.placeholder = placeholder;
    // Match the span's font (size/family) so editing feels in-place. We do NOT
    // copy color — the input always has a white background, so it uses the
    // stylesheet's dark text color to stay readable (e.g. on colored headers).
    const cs = getComputedStyle(span);
    inp.style.font = cs.font;
    inp.style.width = Math.max(span.offsetWidth + 20, 80) + "px";
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const newVal = (inp.value || "").trim();
      // Only commit if we have a real, non-empty new value that actually changed.
      if (save && newVal && newVal !== original) {
        try {
          await onCommit(newVal);
        } catch (err) {
          console.error("rename failed:", err);
          // Best-effort restore so the user sees the old name, not nothing
          if (inp.isConnected) inp.replaceWith(span);
        }
      } else if (inp.isConnected) {
        // Restore the original span if nothing changed / cancelled
        inp.replaceWith(span);
      }
    };
    inp.addEventListener("blur", () => finish(true));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
  });
}

// ---------------- Cell renderer ----------------
// Build an interactive status/priority pill that opens the tag picker on click.
// Shared by the Table and Kanban views so tag editing behaves identically.
function buildTagPill(col, task, commit) {
  commit = commit || ((tid, cid, v) => updateCell(tid, cid, v));
  const value = task.cells[col.id];
  const wrap = el("span", { style: "position:relative;display:inline-block" });
  const pillId = `${task.id}:${col.id}`;
  const pill = el("span", {
    class: "pill" + (value ? "" : " empty"),
    style: `background:${value ? colorOf(col.type, value) : "#b3b3b3"}`,
  }, value || "—");
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    const existing = document.querySelector(`.pill-menu[data-pill-id="${pillId}"]`);
    if (existing) { existing.remove(); return; }
    closeAllPopovers();
    const menu = el("div", { class: "pill-menu floating", "data-pill-id": pillId });
    valuesFor(col.type).forEach((opt) => {
      menu.append(el("div", { class: "pill-opt", onClick: () => { menu.remove(); commit(task.id, col.id, opt); } },
        el("span", { class: "pill-swatch", style: `background:${colorOf(col.type, opt)}` }),
        el("span", {}, opt)));
    });
    menu.append(el("div", { class: "pill-clear", onClick: () => { menu.remove(); commit(task.id, col.id, ""); } }, "Clear"));
    positionFloatingMenu(menu, pill, "below-left");
    attachOutsideClose(menu, pill);
  });
  wrap.append(pill);
  return wrap;
}

// ---------------- Date cell: countdown ring + quick-set + calendar ----------------
// The ring shows how much time is left until the due date, normalized against a
// 30-day horizon (full ring ≈ a month or more out; it depletes as the date
// nears). When the due date has passed, a red flag replaces the ring.
const DUE_HORIZON_DAYS = 30;

function parseYMD(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function toYMD(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfToday() {
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysUntil(ymd) {
  const due = parseYMD(ymd); if (!due) return null;
  return Math.round((due - startOfToday()) / 86400000);
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

// Build the little SVG countdown ring. fraction 0..1 of time left; overdue=flag.
function buildDueRing(ymd) {
  const left = daysUntil(ymd);
  const wrap = el("span", { class: "due-ring-wrap" });
  if (ymd && left != null && left < 0) {
    // Overdue → red flag
    wrap.append(el("span", { class: "due-flag", title: `Overdue by ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"}` }, ""));
    return wrap;
  }
  if (!ymd || left == null) {
    wrap.append(el("span", { class: "due-ring-empty", title: "No due date" }));
    return wrap;
  }
  const frac = Math.max(0, Math.min(1, left / DUE_HORIZON_DAYS));
  const r = 7, c = 2 * Math.PI * r;
  // Color: teal when healthy, amber when ≤3 days, deepening as it shrinks
  let color = "var(--cyan)";
  if (left <= 1) color = "#e8852b";
  else if (left <= 3) color = "#e0a800";
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 18 18"); svg.setAttribute("class", "due-ring");
  const mk = (cls, extra) => { const ci = document.createElementNS(ns, "circle");
    ci.setAttribute("cx", "9"); ci.setAttribute("cy", "9"); ci.setAttribute("r", String(r));
    ci.setAttribute("fill", "none"); ci.setAttribute("class", cls); Object.entries(extra || {}).forEach(([k, v]) => ci.setAttribute(k, v)); return ci; };
  svg.append(mk("due-ring-bg"));
  const fg = mk("due-ring-fg", {
    stroke: color, "stroke-width": "2.5", "stroke-linecap": "round",
    "stroke-dasharray": `${(c * frac).toFixed(2)} ${c.toFixed(2)}`,
    transform: "rotate(-90 9 9)",
  });
  svg.append(fg);
  const title = left === 0 ? "Due today" : `${left} day${left === 1 ? "" : "s"} left`;
  svg.appendChild(document.createElementNS(ns, "title")).textContent = title;
  wrap.append(svg);
  return wrap;
}

function buildDateCell(col, task) {
  const value = task.cells[col.id] || "";

  // When the task is Done, this cell records WHEN it was completed rather than
  // counting down to a due date. Show the stamped done date with a check; the
  // due date is preserved and returns if the task leaves Done.
  const statusCol = STATE.columns.find((c) => c.type === "status");
  const isDone = statusCol && String(task.cells[statusCol.id] || "") === "Done";
  if (isDone) {
    const doneYMD = task.cells["__done_date"] || "";
    const cell = el("span", { class: "due-cell done", title: doneYMD ? "Completed" : "Done" });
    cell.append(el("span", { class: "due-check", title: "Completed" }, "✓"));
    const dd = parseYMD(doneYMD);
    const txt = dd ? "Done · " + dd.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Done";
    cell.append(el("span", { class: "due-text done-text" }, txt));
    return cell;
  }

  const cell = el("span", { class: "due-cell" + (value && daysUntil(value) != null && daysUntil(value) < 0 ? " overdue" : "") });
  cell.append(buildDueRing(value));

  const label = value
    ? (() => { const left = daysUntil(value);
        const dd = parseYMD(value);
        const txt = dd ? dd.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : value;
        const rel = left == null ? "" : left < 0 ? ` · ${Math.abs(left)}d over` : left === 0 ? " · today" : ` · ${left}d`;
        return txt + rel; })()
    : "Set date";
  const text = el("span", { class: "due-text" + (value ? "" : " muted") }, label);
  cell.append(text);

  const set = (ymd) => updateCell(task.id, col.id, ymd);

  cell.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = document.querySelector(`.due-pop[data-for="${task.id}:${col.id}"]`);
    if (open) { open.remove(); return; }
    closeAllPopovers();
    const pop = el("div", { class: "due-pop floating", "data-for": `${task.id}:${col.id}` });

    // Quick-set buttons
    const quick = el("div", { class: "due-quick" });
    const today = startOfToday();
    const btn = (lbl, d) => el("button", { class: "due-qbtn", onClick: () => { pop.remove(); set(toYMD(d)); } }, lbl);
    quick.append(btn("Today", today));
    quick.append(btn("+1 day", addDays(today, 1)));
    quick.append(btn("+1 week", addDays(today, 7)));
    quick.append(btn("+1 month", addMonths(today, 1)));
    pop.append(quick);

    // Calendar dropdown (native date picker → day/month/year calendar)
    const calRow = el("div", { class: "due-cal-row" });
    const cal = el("input", { type: "date", class: "due-cal", value: value || "" });
    cal.addEventListener("change", () => { if (cal.value) { pop.remove(); set(cal.value); } });
    calRow.append(el("span", { class: "due-cal-label" }, "Pick a date:"));
    calRow.append(cal);
    pop.append(calRow);

    if (value) {
      pop.append(el("button", { class: "due-clear", onClick: () => { pop.remove(); set(""); } }, "Clear date"));
    }

    positionFloatingMenu(pop, cell, "below-left");
    attachOutsideClose(pop, cell);
    // Pop the calendar open immediately if the browser supports it
    if (cal.showPicker) { try { /* let the popover settle first */ setTimeout(() => {}, 0); } catch (e) {} }
  });

  return cell;
}

// ---------------- Per-task time tracker ----------------
// Reserved cell keys hold the data; a small widget shows elapsed time with a
// start/stop button and compares against the Est. Hours estimate.
const TIMER_TICK = new Set();   // task ids with a running clock currently on screen
let timerInterval = null;

function fmtDuration(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function taskElapsed(task) {
  const spent = Number(task.cells["__time_spent"] || 0);
  const started = task.cells["__time_started"] || "";
  if (started) {
    const extra = (Date.now() - new Date(started).getTime()) / 1000;
    return spent + Math.max(0, extra);
  }
  return spent;
}
function estimateSeconds(task) {
  const estCol = STATE.columns.find((c) => c.type === "number" && c.name.trim().toLowerCase().includes("hour"));
  if (!estCol) return null;
  const v = task.cells[estCol.id];
  if (v === "" || v == null) return null;
  const hrs = Number(v);
  return isNaN(hrs) ? null : hrs * 3600;
}

function buildTimer(task) {
  const running = !!task.cells["__time_started"];
  const wrap = el("span", { class: "timer" + (running ? " running" : "") });
  const btn = el("button", { class: "timer-btn", title: running ? "Stop timer" : "Start timer",
    onClick: async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const resp = await api(`/api/tasks/${task.id}/timer`, { method: "POST", body: JSON.stringify({ action: running ? "stop" : "start" }) });
        // Apply the result locally for instant feedback (no full reload needed)
        const st = STATE.tasks.find((x) => x.id === task.id);
        if (st) {
          st.cells["__time_spent"] = resp.time_spent;
          st.cells["__time_started"] = resp.time_started;
        }
        ALARM_FIRED.delete(task.id);   // re-arm the estimate alarm on start/stop
        render();
      } catch (err) {
        console.error("[timer] failed:", err);
        alert("Timer action failed — see console.");
      }
    } });
  // Inline SVG play/pause — font glyphs (▶/⏸) render blank when the symbol font
  // is missing, so the icon is drawn as vector art instead.
  btn.innerHTML = running
    ? '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
  wrap.append(btn);

  const readout = el("span", { class: "timer-readout", "data-task": task.id }, fmtDuration(taskElapsed(task)));
  // Compare to estimate
  const est = estimateSeconds(task);
  if (est != null && est > 0) {
    const elapsed = taskElapsed(task);
    const over = elapsed > est;
    readout.classList.toggle("over-est", over);
    readout.title = `Estimate ${fmtDuration(est)} · ${over ? "over by " + fmtDuration(elapsed - est) : fmtDuration(est - elapsed) + " left"}`;
  } else {
    readout.title = "Time tracked (set Est. Hours to compare)";
  }
  wrap.append(readout);
  // Click the readout to manually correct the tracked time (e.g. timer left on)
  readout.style.cursor = "pointer";
  readout.title += " — click to adjust";
  readout.addEventListener("click", (e) => { e.stopPropagation(); openTimerAdjust(task); });

  // Difference vs. estimate (only once there's both an estimate and tracked time)
  if (est != null && est > 0 && taskElapsed(task) > 0) {
    const diff = taskElapsed(task) - est;
    const over = diff > 0;
    wrap.append(el("span", { class: "timer-diff" + (over ? " over" : " under"),
      title: over ? "Over your estimate" : "Under your estimate" },
      `${over ? "+" : "−"}${fmtDuration(Math.abs(diff))}`));
  }

  if (running) TIMER_TICK.add(task.id);
  // Right-click / long-press to reset
  wrap.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (confirm("Reset tracked time for this task?")) {
      await api(`/api/tasks/${task.id}/timer`, { method: "POST", body: JSON.stringify({ action: "reset" }) });
      await loadState();
    }
  });
  return wrap;
}

// Live-update running timers once a second without a full re-render
function ensureTimerTick() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    // Keep the current-time line on the Today schedule in the right place
    const nl = document.getElementById("now-line");
    if (nl) {
      const n = new Date();
      const nowMin = n.getHours() * 60 + n.getMinutes();
      nl.style.top = (((nowMin - DAY_START_MIN) / SLOT_MIN) * SLOT_PX) + "px";
    }
    const running = STATE.tasks.filter((t) => t.cells["__time_started"]);
    if (!running.length) return;
    running.forEach((t) => {
      document.querySelectorAll(`.timer-readout[data-task="${t.id}"]`).forEach((node) => {
        node.textContent = fmtDuration(taskElapsed(t));
        const est = estimateSeconds(t);
        if (est != null && est > 0) node.classList.toggle("over-est", taskElapsed(t) > est);
      });
      checkEstimateAlarm(t);
    });
  }, 1000);
}

// ---------------- Timer adjust (manual correction) ----------------
function openTimerAdjust(task) {
  const cur = Math.round(taskElapsed(task));
  const curH = Math.floor(cur / 3600), curM = Math.floor((cur % 3600) / 60);
  openModal("Adjust tracked time", (body, close) => {
    body.append(el("p", { class: "muted", style: "margin-top:0;font-size:13px" },
      "Correct the actual time spent — useful when the timer was left running."));
    const row = el("div", { style: "display:flex;gap:10px;align-items:center;margin-bottom:14px" });
    const hrs = el("input", { class: "field", type: "number", min: "0", value: String(curH), style: "width:80px" });
    const mins = el("input", { class: "field", type: "number", min: "0", max: "59", value: String(curM), style: "width:80px" });
    row.append(hrs, el("span", {}, "h"), mins, el("span", {}, "m"));
    body.append(row);
    const save = el("button", { class: "tool-btn accent-teal", onClick: async () => {
      const seconds = Math.max(0, (parseInt(hrs.value || "0", 10) || 0) * 3600 + (parseInt(mins.value || "0", 10) || 0) * 60);
      close();
      try {
        const resp = await api(`/api/tasks/${task.id}/timer`, { method: "POST", body: JSON.stringify({ action: "set", seconds }) });
        const st = STATE.tasks.find((x) => x.id === task.id);
        if (st) { st.cells["__time_spent"] = resp.time_spent; st.cells["__time_started"] = resp.time_started; }
        ALARM_FIRED.delete(task.id);   // allow the alarm to re-arm after a correction
        render();
      } catch (err) { alert("Couldn't adjust the time — see console."); console.error(err); }
    } }, "Save");
    body.append(save);
    setTimeout(() => { hrs.focus(); hrs.select(); }, 30);
  });
}

// ---------------- Estimate alarm (sound + banner, toggleable) ----------------
const ALARM_FIRED = new Set();   // task ids already alerted this run
function alarmEnabled() {
  return (STATE.settings && STATE.settings["timer_alarm"]) !== "off";
}
function updateAlarmToggle() {
  const b = document.getElementById("alarm-toggle");
  if (!b) return;
  const on = alarmEnabled();
  // Swap the icon rather than the text: the bell is an inline SVG, so writing
  // textContent here would erase it.
  b.innerHTML = "";
  b.append(icon(on ? "bell" : "bellOff", 14));
  b.classList.toggle("off", !on);
  b.title = on
    ? "Timer alarm ON — sound + banner when a running task passes its Est. Hours (click to turn off)"
    : "Timer alarm OFF (click to turn on)";
}
function playAlarmBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!window.__alarmCtx) window.__alarmCtx = new Ctx();
    const ctx = window.__alarmCtx;
    if (ctx.state === "suspended") ctx.resume();
    // three short rising beeps
    [0, 0.25, 0.5].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 740 + i * 140;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch (e) { /* audio unavailable — banner still shows */ }
}
function showTimerToast(msg) {
  const old = document.getElementById("timer-toast");
  if (old) old.remove();
  const toast = el("div", { id: "timer-toast", class: "timer-toast" });
  toast.append(el("span", { class: "timer-toast-icon" }, "⏰"));
  toast.append(el("span", {}, msg));
  toast.append(el("button", { class: "timer-toast-x", onClick: () => toast.remove() }, "×"));
  document.body.append(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 10000);
}
function checkEstimateAlarm(task) {
  const est = estimateSeconds(task);
  if (est == null || est <= 0) return;
  if (taskElapsed(task) < est) return;
  if (ALARM_FIRED.has(task.id)) return;
  ALARM_FIRED.add(task.id);
  if (!alarmEnabled()) return;
  const name = task.cells[primaryCol().id] || "Task";
  playAlarmBeep();
  showTimerToast(`"${name}" just hit its estimate (${fmtDuration(est)}).`);
  // Browser notification too, if the user has allowed them
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Tuned In — time's up", { body: `${name} hit its estimate (${fmtDuration(est)})` });
    }
  } catch (e) {}
}
