/* Radio Station — board.js
   Board — goal-link column, Table & Kanban views, rewards system, Improvements board, Vibe project data
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ---- Goal-link column: tag a task to a pillar or a specific idea/framework node ----
// Cell value is "" (none), "pillar:<key>", or "idea:<ideaId>". Used by the Map
// (task appears under that pillar/idea) and Goals (counts toward the value).
function gsEnsureLoaded() {
  if (typeof GOALS === "undefined" || !GOALS) { try { loadGoals(); } catch (e) {} }
}
function goalColIds() {
  return STATE.columns.filter((x) => x.type === "goal").map((x) => x.id);
}
// A goal cell can hold multiple tags, stored "tag|tag|tag" (tags never contain |).
function parseGoalTags(v) {
  if (!v) return [];
  return String(v).split("|").map((s) => s.trim()).filter(Boolean);
}
function serializeGoalTags(arr) {
  return (arr || []).join("|");
}
function taskGoalTags(t) {
  // Flattened list of every tag across all goal columns on this task.
  const out = [];
  goalColIds().forEach((id) => parseGoalTags(t.cells[id]).forEach((tag) => out.push(tag)));
  return out;
}
function goalTagPillar(tag) {
  // Resolve a tag value to the pillar key it rolls up to.
  if (!tag) return "";
  if (tag.startsWith("pillar:")) return tag.slice(7);
  if (tag.startsWith("idea:")) {
    const idea = (GOALS && GOALS.ideas || []).find((i) => i.id === tag.slice(5));
    return idea ? idea.pillar : "";
  }
  return "";
}
function goalTagLabel(tag) {
  if (!tag) return "";
  if (tag.startsWith("pillar:")) { const p = gsP(tag.slice(7)); return p ? p.label : ""; }
  if (tag.startsWith("idea:")) { const i = (GOALS && GOALS.ideas || []).find((x) => x.id === tag.slice(5)); return i ? i.text : ""; }
  return "";
}
function buildGoalCell(col, task) {
  gsEnsureLoaded();
  const nm = String(col.name || "").toLowerCase();
  const scope = nm.includes("pillar") ? "pillars" : (nm.includes("idea") ? "ideas" : "both");
  const tags = parseGoalTags(task.cells[col.id]);
  const wrap = el("div", { class: "goal-cell-multi", title: "Click to choose — you can pick more than one" });
  if (!tags.length) {
    wrap.append(el("span", { class: "goal-empty" }, "+ tag"));
    wrap.addEventListener("click", () => openGoalPicker(col, task, scope));
    return wrap;
  }

  const collapsed = goalCellIsCollapsed(task.id, col.id);

  // Per-cell collapse caret — only meaningful when there's more than one tag,
  // since a single chip is already one line. Toggling flips THIS cell relative
  // to the global Pillar/Idea collapse state.
  if (tags.length > 1) {
    const caret = el("button", {
      class: "goal-collapse-caret",
      title: collapsed ? "Expand this cell" : "Collapse this cell to one line",
      onClick: (e) => {
        e.stopPropagation();
        const k = goalCellKey(task.id, col.id);
        if (goalCellOverrides.has(k)) goalCellOverrides.delete(k);
        else goalCellOverrides.add(k);
        render();
      },
    }, collapsed ? "▸" : "▾");
    wrap.append(caret);
  }

  const chips = el("span", { class: "goal-chips" });
  if (collapsed && tags.length > 1) {
    // Compact: first chip + a "+N" overflow badge, all on one line.
    chips.classList.add("collapsed");
    const tag = tags[0];
    const pk = goalTagPillar(tag);
    const color = pk ? gsP(pk).color : "#b3b3b3";
    chips.append(el("span", { class: "goal-chip", style: `border-left:3px solid ${color}`, title: goalTagLabel(tag) }, goalTagLabel(tag) || "?"));
    chips.append(el("span", { class: "goal-more", title: tags.slice(1).map((t) => goalTagLabel(t)).join(", ") }, "+" + (tags.length - 1)));
  } else {
    tags.forEach((tag) => {
      const pk = goalTagPillar(tag);
      const color = pk ? gsP(pk).color : "#b3b3b3";
      chips.append(el("span", { class: "goal-chip", style: `border-left:3px solid ${color}`, title: goalTagLabel(tag) }, goalTagLabel(tag) || "?"));
    });
  }
  chips.addEventListener("click", () => openGoalPicker(col, task, scope));
  wrap.append(chips);
  return wrap;
}

// ---- Win / Loss check cells ----------------------------------------------
// One bit, two columns: the Loss cell stores "1" when the outcome was a loss;
// the Win column just mirrors it (checked whenever Loss is empty — the
// default). Marking Loss files "<task> — missed: <goals>" into the
// Improvements board's Missed Goals section. Detected by type + name.
function checkColKind(col) {
  const n = String(col.name || "").trim().toLowerCase();
  return n === "win" ? "win" : n === "loss" ? "loss" : "plain";
}
function lossCol() {
  return STATE.columns.find((c) => c.type === "check" && checkColKind(c) === "loss");
}
function buildCheckCell(col, task) {
  const kind = checkColKind(col);
  const lc = lossCol();
  const lossOn = lc ? String(task.cells[lc.id] || "") === "1" : false;
  const checked = kind === "win" ? !lossOn
                : kind === "loss" ? lossOn
                : String(task.cells[col.id] || "") === "1";
  const wrap = el("label", { class: "check-cell" + (checked ? " on" : ""),
    title: kind === "win" ? "Win — the default outcome"
         : kind === "loss" ? "Loss — files this task and its missed goals into Improvements"
         : col.name });
  const cb = el("input", { type: "checkbox" });
  cb.checked = checked;
  cb.addEventListener("change", async () => {
    if (kind === "plain") {
      await updateCell(task.id, col.id, cb.checked ? "1" : "");
      task.cells[col.id] = cb.checked ? "1" : "";
      render();
      return;
    }
    if (!lc) return;
    const makeLoss = (kind === "loss" && cb.checked) || (kind === "win" && !cb.checked);
    await updateCell(task.id, lc.id, makeLoss ? "1" : "");
    task.cells[lc.id] = makeLoss ? "1" : "";
    if (makeLoss) await lossToImprovement(task);
    render();
  });
  wrap.append(cb);
  return wrap;
}
async function lossToImprovement(task) {
  const pc = primaryCol();
  const name = task.cells[pc.id] || "Untitled task";
  const gcol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  const goals = gcol ? parseGoalTags(task.cells[gcol.id]).map(goalTagLabel).filter(Boolean) : [];
  const entry = `${name} — missed: ${goals.length ? goals.join(", ") : "no goal tagged"}`;
  // One improvement entry per loss; re-marking the same task doesn't duplicate
  const exists = (STATE.imp_tasks || []).some((t) => {
    const p = (STATE.imp_columns || []).find((c) => c.is_primary);
    return p && String(t.cells[p.id] || "") === entry;
  });
  if (exists) return;
  try {
    const resp = await api("/api/imp/tasks", { method: "POST",
      body: JSON.stringify({ group: "Missed Goals", name: entry }) });
    STATE.imp_tasks = STATE.imp_tasks || [];
    STATE.imp_tasks.push(resp);
  } catch (err) { console.error("[loss] improvement entry failed:", err); }
}

// ---- Done-group review controls -------------------------------------------
// The Done group answers a different question than the rest of the board:
// "what did I actually finish, and what was it for?" These controls filter it
// by completion date, sort by it, and split by whether the work was tagged to
// a goal. A group qualifies when any of its tasks carries a __done_date, which
// the server stamps on completion and clears if the task leaves Done.
const DONE_WINDOWS = [
  { key: "all", label: "All time", days: 0 },
  { key: "7",   label: "Last 7 days",  days: 7 },
  { key: "30",  label: "Last 30 days", days: 30 },
  { key: "90",  label: "Last 90 days", days: 90 },
  { key: "365", label: "This year",    days: 365 },
];
function doneWindowKey() { return (STATE.settings && STATE.settings.done_window) || "all"; }
function doneSortDir()   { return (STATE.settings && STATE.settings.done_sort) || "new"; }
let doneGoalFilter = "all";           // all | tagged | untagged (session only)

function isDoneReviewGroup(list) {
  return (list || []).some((t) => t.cells["__done_date"]);
}
function doneDateOf(t) { return String(t.cells["__done_date"] || ""); }
function taskGoalTagList(t) {
  const gcol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  return gcol ? parseGoalTags(t.cells[gcol.id]) : [];
}
function taskPillarKeys(t) {
  const pcol = STATE.columns.find((c) => c.type === "goal" && /pillar|value/i.test(String(c.name || "")));
  const direct = pcol ? parseGoalTags(t.cells[pcol.id]).map((x) => x.replace(/^pillar:/, "")) : [];
  if (direct.length) return direct;
  // fall back to the sections of whatever goals are tagged
  const out = [];
  taskGoalTagList(t).forEach((tag) => {
    const pk = goalTagPillar(tag);
    if (pk && !out.includes(pk)) out.push(pk);
  });
  return out;
}
function doneCutoffYMD(days) {
  if (!days) return "";
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function doneReviewList(list) {
  const win = DONE_WINDOWS.find((w) => w.key === doneWindowKey()) || DONE_WINDOWS[0];
  const cutoff = doneCutoffYMD(win.days);
  let out = (list || []).filter((t) => {
    const d = doneDateOf(t);
    if (cutoff) { if (!d || d < cutoff) return false; }
    if (doneGoalFilter === "tagged" && !taskGoalTagList(t).length) return false;
    if (doneGoalFilter === "untagged" && taskGoalTagList(t).length) return false;
    return true;
  });
  const dir = doneSortDir();
  out = out.slice().sort((a, b) => {
    const da = doneDateOf(a), db = doneDateOf(b);
    if (da === db) return 0;
    if (!da) return 1;                      // undated sinks
    if (!db) return -1;
    return dir === "new" ? db.localeCompare(da) : da.localeCompare(db);
  });
  return out;
}
function buildDoneReviewBar(g, fullList, shownList) {
  const bar = el("div", { class: "done-bar" });

  const mkSel = (opts, cur, onPick, title) => {
    const s = el("select", { class: "done-sel", title: title });
    opts.forEach(([v, l]) => s.append(el("option", Object.assign({ value: v }, v === cur ? { selected: "selected" } : {}), l)));
    s.addEventListener("change", () => onPick(s.value));
    return s;
  };

  bar.append(el("span", { class: "done-lab" }, "Completed"));
  bar.append(mkSel(DONE_WINDOWS.map((w) => [w.key, w.label]), doneWindowKey(),
    (v) => { STATE.settings.done_window = v; saveSetting("done_window", v); render(); },
    "Only show work finished inside this window"));
  bar.append(mkSel([["new", "Newest first"], ["old", "Oldest first"]], doneSortDir(),
    (v) => { STATE.settings.done_sort = v; saveSetting("done_sort", v); render(); },
    "Sort by completion date"));
  bar.append(mkSel([["all", "Goal: any"], ["tagged", "Tagged to a goal"], ["untagged", "No goal tagged"]], doneGoalFilter,
    (v) => { doneGoalFilter = v; render(); },
    "Split finished work by whether it served a goal"));

  // Tally: how much, and how much of it was aimed at something
  const tagged = shownList.filter((t) => taskGoalTagList(t).length).length;
  const sum = el("span", { class: "done-sum" });
  sum.append(el("strong", {}, String(shownList.length)));
  sum.append(el("span", {}, ` of ${fullList.length} · `));
  sum.append(el("strong", { class: tagged ? "ok" : "" }, String(tagged)));
  sum.append(el("span", {}, " tagged to a goal"));
  bar.append(sum);

  // Which values the finished work actually served
  const byPillar = {};
  shownList.forEach((t) => taskPillarKeys(t).forEach((pk) => { byPillar[pk] = (byPillar[pk] || 0) + 1; }));
  const keys = Object.keys(byPillar).sort((a, b) => byPillar[b] - byPillar[a]);
  if (keys.length) {
    const chips = el("div", { class: "done-pillars" });
    keys.slice(0, 8).forEach((pk) => {
      let p = { label: pk, color: "#b3b3b3" };
      try { loadGoals(); p = gsP(pk) || p; } catch (e) { /* goals unavailable */ }
      const c = el("span", { class: "done-pchip", style: `border-color:${p.color};color:${p.color}` });
      c.append(el("span", { class: "done-pdot", style: `background:${p.color}` }));
      c.append(el("span", {}, `${p.label || pk} ${byPillar[pk]}`));
      chips.append(c);
    });
    bar.append(chips);
  }
  return bar;
}

function openGoalPicker(col, task, scope) {
  openTagPicker("Tag \u00B7 " + col.name, scope,
    parseGoalTags(task.cells[col.id]),
    async (working) => {
      const t = STATE.tasks.find((x) => x.id === task.id);
      if (t) t.cells[col.id] = serializeGoalTags(working); // optimistic
      await updateCell(task.id, col.id, serializeGoalTags(working));
      await syncPillarsFromGoals(task, col, working);
      await mirrorPillarsIntoGoals(task, col, working);
    },
    "Tick all that apply — these connect the task to your Map and Goals.");
}

// The reverse of syncPillarsFromGoals: tagging a pillar in the Pillar column
// also files that pillar in the Goal column, so a task attached to a value
// is visible from the goal side even before a specific goal is picked. Only
// pillar: tags are mirrored — existing idea: tags are left exactly as they are,
// and pillars already there aren't duplicated.
async function mirrorPillarsIntoGoals(task, editedCol, tags) {
  if (!/pillar|value/i.test(String(editedCol.name || ""))) return;   // only when the Pillar column was edited
  const goalCol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  if (!goalCol || goalCol.id === editedCol.id) return;
  const t = STATE.tasks.find((x) => x.id === task.id) || task;
  const existing = parseGoalTags(t.cells[goalCol.id]);
  const keep = existing.filter((x) => !x.startsWith("pillar:"));   // goals stay untouched
  const wanted = (tags || []).filter((x) => x.startsWith("pillar:"));
  const next = serializeGoalTags(keep.concat(wanted.filter((x) => !keep.includes(x))));
  const cur = serializeGoalTags(existing);
  if (cur === next) return;
  t.cells[goalCol.id] = next;                                   // optimistic
  await updateCell(task.id, goalCol.id, next);
}

// When the Goal column changes, the Pillar column auto-populates with the
// pillars those goals roll up to (deduped, in pillar order). Editing the
// Pillar column directly still works — it just re-syncs on the next Goal
// change. Detected by type + name ("pillar" vs the other), never by id.
async function syncPillarsFromGoals(task, editedCol, tags) {
  if (/pillar|value/i.test(String(editedCol.name || ""))) return;   // pillar edited directly — nothing to derive
  const pillarCol = STATE.columns.find((c) => c.type === "goal" && /pillar|value/i.test(String(c.name || "")));
  if (!pillarCol || pillarCol.id === editedCol.id) return;
  const order = (gsPillars() || []).map((p) => p.key);
  const derived = [];
  (tags || []).forEach((tag) => {
    const pk = goalTagPillar(tag);
    if (pk && !derived.includes(pk)) derived.push(pk);
  });
  derived.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const next = serializeGoalTags(derived.map((k) => "pillar:" + k));
  const cur = serializeGoalTags(parseGoalTags(task.cells[pillarCol.id]));
  if (cur === next) return;
  const t = STATE.tasks.find((x) => x.id === task.id);
  if (t) t.cells[pillarCol.id] = next;               // optimistic
  await updateCell(task.id, pillarCol.id, next);
}

// Generic multi-select picker for pillar/idea tags. commitFn(workingArray) is
// called (live) on each toggle. Used by task Goal cells and Vibe projects.
function openTagPicker(title, scope, initialTags, commitFn, blurb) {
  openModal(title, (body, close) => {
    let working = (initialTags || []).slice();
    body.append(el("p", { class: "muted", style: "margin-top:0;font-size:13px" }, blurb || "Tick all that apply — these connect to your Map and Goals."));
    const search = el("input", { class: "field", placeholder: "Search…", style: "width:100%;margin-bottom:10px" });
    body.append(search);

    // Values and goals inherit one of three buckets from their section. With
    // this many sections most are irrelevant to any one task, so let the list
    // be narrowed to the part of life the task is actually about. Anything
    // already ticked stays visible regardless, so a filter can never strand a
    // tag where it can't be removed.
    if (typeof gsInjectCss === "function") gsInjectCss();   // chip styles live with Goals
    const SCOPE_CHIPS = [["*", "All"]].concat(typeof GS_SCOPES === "undefined" ? [] : GS_SCOPES);
    let scopeFilter = "*";
    if (SCOPE_CHIPS.length > 1) {
      const scopeBar = el("div", { class: "gd-rolebar", style: "margin:-2px 0 10px" });
      SCOPE_CHIPS.forEach(([val, label]) => {
        scopeBar.append(el("button", { class: "gd-role" + (val === scopeFilter ? " on" : ""),
          onClick: () => {
            scopeFilter = val;
            [...scopeBar.children].forEach((b, i) => b.classList.toggle("on", SCOPE_CHIPS[i][0] === val));
            build(search.value);
          } }, label));
      });
      body.append(scopeBar);
    }
    const inScope = (pillarKey) => scopeFilter === "*"
      || (typeof gsScopeOf === "function" ? gsScopeOf(pillarKey) : "") === scopeFilter;

    const listWrap = el("div", { class: "goal-picker-list" });
    body.append(listWrap);
    // This picker gets the extra-large treatment: with this many goals, a
    // small modal is all scrolling. Near-fullscreen; the list still scrolls.
    const modalEl = body.closest(".modal");
    if (modalEl) modalEl.classList.add("modal-xl");

    const ideas = (GOALS && GOALS.ideas) || [];
    const depthOf = (idea) => { let d = 0, cur = idea; const seen = new Set(); while (cur && cur.parent && !seen.has(cur.parent)) { seen.add(cur.parent); cur = ideas.find((x) => x.id === cur.parent); d++; } return d; };
    const pillarOrder = (gsPillars() || []).map((p) => p.key);

    async function commit() {
      await commitFn(working);
    }


    function rowFor(tag, label, color, indent) {
      const on = working.includes(tag);
      const row = el("label", { class: "goal-pick-row" });
      const cb = el("input", { type: "checkbox" });
      cb.checked = on;
      cb.addEventListener("change", () => {
        if (cb.checked) { if (!working.includes(tag)) working.push(tag); }
        else { working = working.filter((x) => x !== tag); }
        commit();
        if (tag.startsWith("pillar:")) build(search.value);   // pillar-first: re-filter the goal list
      });
      row.append(cb);
      const sw = el("span", { class: "goal-pick-sw", style: `background:${color}` });
      row.append(sw);
      row.append(el("span", { class: "goal-pick-lab", style: indent ? `padding-left:${indent * 14}px` : "" }, label));
      // Hide control (eye). Toggling re-renders the picker list.
      const isPillar = tag.startsWith("pillar:");
      const eye = el("span", { class: "goal-pick-eye", title: "Hide this from the picker, Map and Goals", onClick: (e) => { e.preventDefault(); e.stopPropagation(); if (isPillar) gsToggleHidePillar(tag.slice(7)); else gsToggleHideIdea(tag.slice(5)); build(search.value); } }, "");
      row.append(eye);
      return row;
    }

    function tagHidden(tag) {
      return tag.startsWith("pillar:") ? gsPillarHidden(tag.slice(7)) : gsIdeaHidden(tag.slice(5));
    }

    function build(filter) {
      listWrap.innerHTML = "";
      const f = (filter || "").trim().toLowerCase();
      const hiddenItems = []; // {tag,label,color}
      if (scope !== "ideas") {
        const hdr = el("div", { class: "goal-pick-head" }, "Values");
        listWrap.append(hdr);
        let any = false;
        (gsPillars() || []).forEach((p) => {
          const tag = "pillar:" + p.key;
          if (gsPillarHidden(p.key) && !working.includes(tag)) { hiddenItems.push({ tag, label: p.label, color: p.color }); return; }
          if (!inScope(p.key) && !working.includes(tag)) return;
          if (f && !p.label.toLowerCase().includes(f)) return;
          any = true;
          listWrap.append(rowFor(tag, p.label, p.color, 0));
        });
        if (!any) hdr.remove();
      }
      if (scope !== "pillars" && ideas.length) {
        // Pillar-first: with one or more values checked, the goal list
        // narrows to just those areas' goals (already-checked goals stay).
        const checkedPillars = working.filter((t) => t.startsWith("pillar:")).map((t) => t.slice(7));
        const hdr = el("div", { class: "goal-pick-head" },
          checkedPillars.length ? "Goals in the ticked values" : "Goals already tagged");
        listWrap.append(hdr);
        const ordered = ideas.slice().sort((a, b) => (pillarOrder.indexOf(a.pillar) - pillarOrder.indexOf(b.pillar)));
        let any = false;
        ordered.forEach((idea) => {
          const tag = "idea:" + idea.id;
          const color = idea.pillar ? gsP(idea.pillar).color : "#b3b3b3";
          // Show a goal only when its value is ticked above, or when it's
          // already tagged on this task. With nothing ticked the list stays
          // short instead of dumping every goal in the system.
          if (!checkedPillars.includes(idea.pillar) && !working.includes(tag)) return;
          if (gsIdeaHidden(idea.id) && !working.includes(tag)) {
            // Only list as separately-unhide-able if the idea itself is hidden
            if (((GOALS && GOALS.hiddenIdeas) || []).includes(idea.id)) hiddenItems.push({ tag, label: idea.text, color });
            return;
          }
          if (!inScope(idea.pillar) && !working.includes(tag)) return;
          if (f && !idea.text.toLowerCase().includes(f)) return;
          any = true;
          listWrap.append(rowFor(tag, idea.text, color, f ? 0 : depthOf(idea)));
        });
        if (!any) {
          hdr.remove();
          if (!f) {
            listWrap.append(el("div", { class: "goal-pick-hint" },
              checkedPillars.length
                ? "No goals in the ticked values yet."
                : "Tick a value above to see its goals."));
          }
        }
      }
      if (!listWrap.children.length) listWrap.append(el("div", { class: "muted", style: "font-size:13px;padding:8px" }, "No matches."));
      // Hidden section — expandable, to unhide
      if (hiddenItems.length) {
        const sec = el("div", { class: "goal-hidden-sec" });
        const head = el("div", { class: "goal-hidden-head", onClick: () => sec.classList.toggle("open") }, `Hidden (${hiddenItems.length}) ▾`);
        sec.append(head);
        const list = el("div", { class: "goal-hidden-list" });
        hiddenItems.forEach((h) => {
          const isPillar = h.tag.startsWith("pillar:");
          list.append(el("div", { class: "goal-hidden-item", title: "Click to unhide", onClick: () => { if (isPillar) gsToggleHidePillar(h.tag.slice(7)); else gsToggleHideIdea(h.tag.slice(5)); build(search.value); } },
            el("span", { class: "goal-pick-sw", style: `background:${h.color}` }), el("span", {}, h.label + "  ↩")));
        });
        sec.append(list);
        listWrap.append(sec);
      }
    }
    build("");
    search.addEventListener("input", () => build(search.value));
    const done = el("button", { class: "tool-btn accent-teal", style: "margin-top:12px", onClick: () => { close(); render(); } }, "Done");
    body.append(done);
    setTimeout(() => search.focus(), 30);
  });
}

/** Rebuild just the value cells of one task's row, in place.
 *
 *  A cell edit changes one task, but re-rendering the board for it rebuilds
 *  every row and makes the browser lay all of them out again. On a full board
 *  that is most of a second of dead time between the click and anything
 *  visibly happening - which is what the lag actually was. This touches only
 *  the row that changed.
 *
 *  Returns false whenever a targeted update might not be the whole story, so
 *  the caller can fall back to a full render rather than leave the board
 *  showing something stale:
 *
 *   - not the table view (other views lay tasks out differently)
 *   - a search is running, so the edit may change whether the row belongs
 *   - a number column, which group footers total up
 *   - a row that is not currently on screen
 *
 *  Moving between groups is handled by the caller, which knows the old group.
 */
function refreshTaskCells(taskId, changedColId) {
  if (currentView !== "table") return false;
  if (typeof search !== "undefined" && search) return false;

  const t = STATE.tasks.find((x) => x.id === taskId);
  if (!t) return false;

  const changed = STATE.columns.find((c) => c.id === changedColId);
  if (changed && changed.type === "number") return false;   // group footers sum these

  const rows = document.querySelectorAll('tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(taskId) : taskId) + '"]');
  if (!rows.length) return false;

  const primaryIdx = STATE.columns.findIndex((c) => c.is_primary);
  rows.forEach((tr) => {
    STATE.columns.forEach((c, i) => {
      const td = tr.children[i + 1];        // children[0] is the drag-handle cell
      if (!td) return;
      // Only the contents go: the cell keeps the class and padding that mark
      // it as an indented subtask.
      td.textContent = "";
      td.append(renderCell(c, t));
      if (i === primaryIdx) {
        const prog = subtaskProgress(t.id);
        if (prog) {
          td.append(el("span", { class: "subtask-badge",
            title: prog.done + " of " + prog.total + " subtasks done" },
            prog.done + "/" + prog.total));
        }
      }
    });
  });
  return true;
}

function renderCell(col, task) {
  const value = task.cells[col.id];

  if (col.type === "status" || col.type === "priority") {
    return buildTagPill(col, task);
  }

  if (col.type === "date") {
    return buildDateCell(col, task);
  }

  if (col.type === "number") {
    const inp = el("input", { class: "cell-input", type: "number", value: value === "" || value == null ? "" : value, style: "text-align:right" });
    inp.addEventListener("change", () => updateCell(task.id, col.id, inp.value === "" ? "" : Number(inp.value)));
    return inp;
  }

  if (col.type === "check") {
    return buildCheckCell(col, task);
  }
  if (col.type === "goal") {
    // Personal group override: these columns display as Skill Lab Category /
    // Resource (display-layer only; the pillar/goal cell data is untouched)
    if (typeof sbGroupOverride === "function" && sbGroupOverride(task.group_name)) {
      return sbBoardCell(col, task);
    }
    return buildGoalCell(col, task);
  }

  // text / person
  const PLACEHOLDERS = ["New task", "New subtask"];
  const isPlaceholder = col.is_primary && PLACEHOLDERS.includes(value);
  const div = el("div", {
    class: "cell-text" + (value && !isPlaceholder ? "" : " empty") + (col.is_primary ? " cell-primary" : ""),
  }, value || (col.type === "person" ? "Unassigned" : "Click to edit"));
  div.addEventListener("click", () => {
    // For a freshly-created task still showing its placeholder name, start the
    // input EMPTY (with the placeholder as a ghost hint) so the user can type
    // straight away without deleting anything. Otherwise pre-fill + select-all.
    const startEmpty = isPlaceholder;
    const inp = el("input", {
      class: "cell-input",
      value: startEmpty ? "" : (value || ""),
      placeholder: startEmpty ? value : "",
      style: "border:1px solid var(--cyan);border-radius:4px;padding:2px 6px",
    });
    div.replaceWith(inp);
    inp.focus();
    if (!startEmpty) inp.select();  // highlight existing text so typing overwrites it
    const commit = () => {
      // If the user left it blank on a placeholder cell, keep the placeholder
      // rather than saving an empty name.
      const v = inp.value.trim();
      if (startEmpty && v === "") { render(); return; }
      updateCell(task.id, col.id, inp.value);
    };
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inp.blur();
      else if (e.key === "Escape") { inp.value = startEmpty ? "" : (value || ""); render(); }
    });
  });
  return div;
}

// ---------------- Views ----------------
// A search narrows the board but the search box lives up in the banner, easy to
// miss — especially when you arrive here by clicking a task from a goal, which
// sets it for you. This strip makes an active filter visible and one click to
// clear, so you can never be stuck in a narrowed view wondering why.
function buildFilterBar(shown, total) {
  if (!search) return null;
  const bar = el("div", { class: "filter-bar" });
  const txt = el("div", { class: "filter-what" });
  txt.append(el("span", { class: "filter-lab" }, "Filtered"));
  txt.append(el("span", { class: "filter-term" }, "\u201C" + search + "\u201D"));
  txt.append(el("span", { class: "filter-count" },
    `showing ${shown} of ${total} task${total === 1 ? "" : "s"}`));
  bar.append(txt);
  bar.append(el("button", { class: "filter-clear", title: "Clear the filter and show the whole board (Esc)",
    onClick: () => { const s = $("#search"); if (s) s.value = ""; search = ""; render(); } },
    "\u2715 Clear filter"));
  return bar;
}

function renderTable() {
  const board = $("#board");
  const tasks = filteredTasks();
  const fbar = buildFilterBar(tasks.filter((t) => !t.parent_id).length,
                              STATE.tasks.filter((t) => !t.parent_id).length);
  if (fbar) board.append(fbar);

  const groups = {};
  // Only TOP-LEVEL tasks define the group rows; subtasks render under their parent.
  tasks.filter((t) => !t.parent_id).forEach((t) => {
    (groups[t.group_name] = groups[t.group_name] || []).push(t);
  });
  // Make sure groups that contain ONLY a parent still appear even if filtered
  // subtasks matched search; and if a search matched a subtask, surface its parent.
  if (search) {
    tasks.filter((t) => t.parent_id).forEach((sub) => {
      const parent = STATE.tasks.find((p) => p.id === sub.parent_id);
      if (parent && !(groups[parent.group_name] || []).some((x) => x.id === parent.id)) {
        (groups[parent.group_name] = groups[parent.group_name] || []).push(parent);
        expandedParents.add(parent.id);
      }
    });
  }
  // Include groups that exist independently of any task (created via New Group,
  // or that became empty) so an empty group never silently disappears. We skip
  // this while a search is active, since an empty group can't match a query.
  if (!search) {
    knownGroupNames().forEach((name) => { if (!(name in groups)) groups[name] = []; });
  }

  // Nothing at all to show (no tasks AND no groups): show the empty-board prompt.
  if (Object.keys(groups).length === 0) { board.append(emptyBoard()); return; }

  // Order groups by their saved position (group_order); unknown groups sort to
  // the end in insertion order, so newly created groups appear last until moved.
  const orderedGroupNames = Object.keys(groups).sort((a, b) => {
    const pa = STATE.group_order[a];
    const pb = STATE.group_order[b];
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pa - pb;
  });

  orderedGroupNames.forEach((g, gi) => {
    // Defensive: never let an empty/undefined group name render as a blank or
    // the literal word "undefined" — show a clear placeholder instead.
    const safeOldName = g && g !== "undefined" && g !== "null" ? g : "(unnamed group)";
    const oldName = safeOldName;  // explicit snapshot for the closure (defense in depth)
    const color = groupColor(g, gi);
    const groupEl = el("div", { class: "group", "data-group": g });
    const isCollapsed = collapsedGroups.has(g);
    // Done-style groups get review controls; rows come from the filtered list.
    const isDoneGrp = isDoneReviewGroup(groups[g]);
    const rowList = isDoneGrp ? doneReviewList(groups[g]) : groups[g];

    // Group header — collapse caret, color dot, name, count, delete.
    // The header is draggable to reorder whole groups.
    const header = el("div", { class: "group-header", style: `border-left-color:${color}`, draggable: "true" });

    // Collapse/expand caret (hides the group's table, leaving just the header)
    const collapseCaret = el("button", { class: "group-collapse-caret", title: isCollapsed ? "Expand group" : "Collapse group" },
      isCollapsed ? "▸" : "▾");
    collapseCaret.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsedGroups.has(g)) collapsedGroups.delete(g);
      else collapsedGroups.add(g);
      render();
    });
    header.append(collapseCaret);

    // Color dot
    const dot = el("button", { class: "group-color-dot", title: "Change group color", style: `background:${color}` });
    dot.addEventListener("click", (e) => { e.stopPropagation(); openGroupColorPicker(g, dot); });
    header.append(dot);

    const gname = el("span", { class: "gname", style: `color:${color}`, title: "Click to rename" }, oldName);
    inlineRename(gname, () => oldName, async (newName) => {
      console.log("[rename group]", { oldName, newName, originalKey: g });
      if (!oldName || !newName || oldName === newName || newName === "undefined" || newName === "null") {
        console.warn("[rename group] skipped — invalid input:", { oldName, newName });
        return;
      }
      const dbOldName = g;
      try {
        const resp = await api("/api/groups/rename", {
          method: "PATCH",
          body: JSON.stringify({ old: dbOldName, new: newName }),
        });
        console.log("[rename group] server response:", resp);
        STATE.tasks.forEach((t) => { if (t.group_name === dbOldName) t.group_name = newName; });
        STATE.automations.forEach((a) => { if (a.action_type === "moveToGroup" && a.action_val === dbOldName) a.action_val = newName; });
        // carry custom color + order + collapse state to the new name locally
        if (STATE.group_colors[dbOldName]) {
          STATE.group_colors[newName] = STATE.group_colors[dbOldName];
          delete STATE.group_colors[dbOldName];
        }
        if (STATE.group_order[dbOldName] != null) {
          STATE.group_order[newName] = STATE.group_order[dbOldName];
          delete STATE.group_order[dbOldName];
        }
        if (collapsedGroups.has(dbOldName)) { collapsedGroups.delete(dbOldName); collapsedGroups.add(newName); }
        render();
      } catch (err) {
        console.error("[rename group] failed:", err);
      }
    });
    header.append(gname);
    header.append(el("span", { class: "gcount" },
      isDoneGrp && rowList.length !== groups[g].length
        ? `${rowList.length} of ${groups[g].length}`
        : `${groups[g].length} item${groups[g].length !== 1 ? "s" : ""}`));
    // Delete-group button (×) — confirms, then either deletes all its tasks or moves them
    const delGroupBtn = el("button", {
      class: "del-group-btn",
      title: `Delete group "${oldName}"`,
      onClick: (e) => { e.stopPropagation(); deleteGroup(oldName); },
    }, "×");
    header.append(delGroupBtn);

    // --- Group drag-to-reorder (whole groups) ---
    header.addEventListener("dragstart", (e) => {
      groupDragState = { name: g };
      groupEl.classList.add("group-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "group:" + g);
    });
    header.addEventListener("dragend", () => {
      groupEl.classList.remove("group-dragging");
      document.querySelectorAll(".group-drop-before, .group-drop-after").forEach((el2) =>
        el2.classList.remove("group-drop-before", "group-drop-after"));
      groupDragState = null;
    });
    header.addEventListener("dragover", (e) => {
      if (!groupDragState || groupDragState.name === g) return;
      // Only react to GROUP drags, not task drags
      e.preventDefault();
      const rect = groupEl.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      groupEl.classList.toggle("group-drop-after", after);
      groupEl.classList.toggle("group-drop-before", !after);
    });
    header.addEventListener("dragleave", () => {
      groupEl.classList.remove("group-drop-before", "group-drop-after");
    });
    header.addEventListener("drop", async (e) => {
      if (!groupDragState || groupDragState.name === g) return;
      e.preventDefault();
      const rect = groupEl.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      await reorderGroups(groupDragState.name, g, after);
    });

    groupEl.append(header);
    // Review controls sit between the header and the table, so they read as
    // "how am I looking at this group" rather than as another row.
    if (isDoneGrp && !isCollapsed) groupEl.append(buildDoneReviewBar(g, groups[g], rowList));

    if (isCollapsed) {
      // Collapsed: show only the header (with the count), skip the table entirely.
      board.append(groupEl);
      return;
    }

    const wrap = el("div", { class: "table-wrap" });
    // Total width = handle(28) + sum of column widths + actions(70). Setting it
    // explicitly makes per-column widths exact and enables horizontal scroll.
    const totalW = 86 + 190 + STATE.columns.reduce((s, c) => s + colWidth(c), 0);
    const table = el("table", { class: "fixed-cols", style: `width:${totalW}px;min-width:${totalW}px` });
    const thead = el("thead");
    const htr = el("tr", { class: "group-colored-head", style: `background:${color}` });
    htr.append(el("th", { class: "th-handle", style: "width:86px" }));
    // Column headers — drag the ⠿ handle to reorder; click name to rename; drag right edge to resize.
    STATE.columns.forEach((c) => {
      const w = colWidth(c);
      const th = el("th", { class: c.type === "number" ? "num" : "", style: `width:${w}px`, "data-col": c.id });

      // Reorder handle (not for the primary column — it stays first)
      if (!c.is_primary) {
        const movegrip = el("span", { class: "col-move-grip", title: "Drag to reorder column", draggable: "true" }, "⠿");
        attachColumnReorder(movegrip, th, c);
        th.append(movegrip);
      }

      // Personal group override: goal columns are titled Category / Resource
      // here. Renaming is disabled on these two headers in this group so a
      // click can't silently rename the board-wide Pillar/Goal columns.
      const sbOver = c.type === "goal" && typeof sbGroupOverride === "function" && sbGroupOverride(g);
      const label = el("span", { class: "th-label", title: sbOver ? "Skill Lab " + sbBoardHeaderLabel(c) : "Click to rename column" },
        sbOver ? sbBoardHeaderLabel(c) : c.name);
      if (!sbOver) {
        inlineRename(label, () => c.name, async (newName) => {
          await api(`/api/columns/${c.id}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
          c.name = newName;
          render();
        });
      }
      th.append(label);
      // Resize handle on the right edge
      const grip = el("span", { class: "col-resize-grip", title: "Drag to resize column" });
      attachColumnResize(grip, th, c);
      th.append(grip);
      htr.append(th);
    });
    htr.append(el("th", { class: "th-actions", style: "width:190px" }));
    thead.append(htr);
    table.append(thead);

    const tbody = el("tbody", { "data-group": g });

    // Builds one task row. `isSub` controls indentation/styling.
    const buildTaskRow = (t, depth) => {
      const isSub = depth > 0;
      const tr = el("tr", { draggable: "true", "data-id": t.id, class: isSub ? "subtask-row" : "" });

      // First cell groups the row controls together to keep rows compact:
      // drag grip, expand/collapse caret, and add-subtask button. Subtasks can
      // nest, so EVERY row gets a caret + add-subtask.
      const handleTd = el("td", { class: "drag-handle-cell" });
      const controls = el("div", { class: "row-controls" });
      const grip = el("span", { class: "row-grip", title: "Drag to reorder" }, "⠿");
      controls.append(grip);

      const kids = childrenOf(t.id);
      const caret = el("button", {
        class: "subtask-caret big" + (kids.length ? "" : " empty"),
        title: kids.length ? "Show / hide subtasks" : "No subtasks yet",
      }, expandedParents.has(t.id) ? "▾" : "▸");
      if (kids.length) {
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          if (expandedParents.has(t.id)) expandedParents.delete(t.id);
          else expandedParents.add(t.id);
          render();
        });
      }
      controls.append(caret);
      const addSub = el("button", { class: "add-sub-btn", title: "Add subtask",
        onClick: (e) => { e.stopPropagation(); addTask(t.group_name, t.id); } }, "+↳");
      controls.append(addSub);
      handleTd.append(controls);
      tr.append(handleTd);

      STATE.columns.forEach((c) => {
        const td = el("td", { class: c.type === "number" ? "num" : "" });
        td.append(renderCell(c, t));
        tr.append(td);
      });

      // Decorate the primary-column cell: progress badge when there are
      // children; depth-scaled indent for nested rows.
      const primaryIdx = STATE.columns.findIndex((c) => c.is_primary);
      if (primaryIdx >= 0) {
        const cellTd = tr.children[primaryIdx + 1]; // +1 for the handle cell
        const prog = subtaskProgress(t.id);
        if (prog) {
          cellTd.append(el("span", { class: "subtask-badge", title: `${prog.done} of ${prog.total} subtasks done` },
            `${prog.done}/${prog.total}`));
        }
        if (isSub) {
          cellTd.classList.add("subtask-cell");
          cellTd.style.paddingLeft = (8 + depth * 22) + "px";
        }
      }

      const delTd = el("td", { class: "row-actions", style: "text-align:center;white-space:nowrap" });
      delTd.append(buildTimer(t));
      delTd.append(buildRowMenu(t));
      delTd.append(el("button", { class: "del-btn", title: "Delete", onClick: () => deleteTask(t.id) }, "×"));
      tr.append(delTd);

      // --- drag events (reorder within a group OR move to another group) ---
      if (!isSub) {
        tr.addEventListener("dragstart", (e) => {
          dragState = { id: t.id, fromGroup: g };
          tr.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.id);
        });
        tr.addEventListener("dragend", () => {
          tr.classList.remove("dragging");
          document.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
          document.querySelectorAll("tbody.drop-target").forEach((b) => b.classList.remove("drop-target"));
          dragState = null;
        });
        tr.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (!dragState) return;
          const draggingEl = document.querySelector("tr.dragging");
          // Within the same group: live-reorder by moving the dragged row around.
          if (dragState.fromGroup === g && draggingEl && draggingEl !== tr) {
            const rect = tr.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            tbody.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
            tr.classList.add("drag-over");
            if (after) tr.after(draggingEl);
            else tr.before(draggingEl);
          }
        });
      } else {
        tr.setAttribute("draggable", "false");
      }

      tbody.append(tr);

      // Render this row's subtree beneath it when expanded (any depth).
      // Finished subtasks collapse out of the way; a summary row below keeps
      // them one click from view so nothing looks lost.
      if (expandedParents.has(t.id)) {
        visibleChildrenOf(t.id).forEach((sub) => buildTaskRow(sub, depth + 1));
        const nHidden = hiddenDoneCount(t.id);
        if (nHidden) {
          const htr = el("tr", { class: "subs-done-row" });
          const pad = el("td", { class: "handle-cell" });
          htr.append(pad);
          const td = el("td", { colspan: String(STATE.columns.length + 1) });
          const btn = el("button", { class: "subs-done-toggle",
            style: `margin-left:${18 + depth * 22}px`,
            title: "Show the finished subtasks again",
            onClick: (e) => { e.stopPropagation(); revealDoneSubs.add(t.id); render(); } },
            `\u2713 ${nHidden} done \u00B7 show`);
          td.append(btn);
          htr.append(td);
          tbody.append(htr);
        } else if (revealDoneSubs.has(t.id) && childrenOf(t.id).some(isDoneStatus)) {
          const htr = el("tr", { class: "subs-done-row" });
          htr.append(el("td", { class: "handle-cell" }));
          const td = el("td", { colspan: String(STATE.columns.length + 1) });
          td.append(el("button", { class: "subs-done-toggle",
            style: `margin-left:${18 + depth * 22}px`,
            title: "Collapse the finished subtasks again",
            onClick: (e) => { e.stopPropagation(); revealDoneSubs.delete(t.id); render(); } },
            "\u2713 hide done"));
          htr.append(td);
          tbody.append(htr);
        }
      }
    };

    rowList.forEach((t) => buildTaskRow(t, 0));

    // Allow dropping onto this group's body — highlights when a task from a
    // DIFFERENT group is hovering, so it's clear it'll move here.
    tbody.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragState && dragState.fromGroup !== g) {
        tbody.classList.add("drop-target");
      }
    });
    tbody.addEventListener("dragleave", (e) => {
      // Only clear when actually leaving the tbody (not moving between its rows)
      if (!tbody.contains(e.relatedTarget)) tbody.classList.remove("drop-target");
    });

    // On drop: if the task came from another group, move it here; otherwise
    // persist the reordered positions within this group.
    tbody.addEventListener("drop", async (e) => {
      e.preventDefault();
      tbody.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
      tbody.classList.remove("drop-target");
      if (dragState && dragState.fromGroup !== g) {
        const movedId = dragState.id;
        dragState = null;
        await moveTaskToGroup(movedId, g);  // reassign group + re-render
      } else {
        await persistGroupOrder(tbody, g);
      }
    });

    table.append(tbody);
    wrap.append(table);
    groupEl.append(wrap);
    groupEl.append(buildGroupTimeTotals(groups[g]));
    groupEl.append(el("div", { class: "add-task", onClick: () => addTask(g) }, "+ Add task"));
    board.append(groupEl);
  });
}

// A small footer under each group summarizing estimated vs. actual time and the
// difference, summed across the group's tasks AND their subtasks.
function buildGroupTimeTotals(parentTasks) {
  let estSec = 0, actSec = 0, anyEst = false, anyAct = false;
  const tally = (t) => {
    const e = estimateSeconds(t);
    if (e != null) { estSec += e; anyEst = true; }
    const a = taskElapsed(t);
    if (a > 0) { actSec += a; anyAct = true; }
    childrenOf(t.id).forEach(tally);
  };
  (parentTasks || []).forEach(tally);
  if (!anyEst && !anyAct) return el("span");  // nothing to show
  const diff = actSec - estSec;
  const foot = el("div", { class: "group-totals" });
  foot.append(el("span", { class: "gt-item" }, `Estimated: ${anyEst ? fmtHm(estSec) : "—"}`));
  foot.append(el("span", { class: "gt-item" }, `Actual: ${anyAct ? fmtHm(actSec) : "—"}`));
  if (anyEst && anyAct) {
    const over = diff > 0;
    foot.append(el("span", { class: "gt-item gt-diff" + (over ? " over" : " under") },
      `Difference: ${over ? "+" : "−"}${fmtHm(Math.abs(diff))} ${over ? "over" : "under"}`));
  }
  return foot;
}
// Hours:minutes style for longer totals (e.g. "3h 15m").
function fmtHm(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function laneWidth(label) {
  const v = STATE.settings && STATE.settings["kw_" + label];
  const n = v == null ? 280 : Number(v);
  return isNaN(n) ? 280 : Math.max(160, Math.min(700, n));
}

function renderKanban() {
  const board = $("#board");
  const statusCol = STATE.columns.find((c) => c.type === "status");
  if (!statusCol) { board.append(el("div", { class: "muted" }, "Add a Status column to use the Kanban view.")); return; }
  const tasks = filteredTasks().filter((t) => !t.parent_id);
  const kbar = buildFilterBar(tasks.length, STATE.tasks.filter((t) => !t.parent_id).length);
  if (kbar) board.append(kbar);
  const pCol = primaryCol();
  const lanes = [...valuesFor("status"), ""];

  const kanban = el("div", { class: "kanban" });
  lanes.forEach((label) => {
    const items = tasks.filter((t) => String(t.cells[statusCol.id] || "") === label);
    if (label === "" && items.length === 0) return;
    const color = label ? colorOf("status", label) : "#b3b3b3";
    const isReal = label !== "";  // the "No Status" lane isn't a palette entry
    const w = isReal ? laneWidth(label) : 280;
    const kcol = el("div", { class: "kcol", style: `width:${w}px;flex:0 0 ${w}px` });

    // Lane header: draggable to reorder (real lanes only)
    const head = el("div", { class: "kcol-head", style: `background:${color}`, draggable: isReal ? "true" : "false" });
    head.append(el("span", { class: "kcol-title" }, label || "No Status"));
    head.append(el("span", {}, String(items.length)));
    if (isReal) {
      head.title = "Drag to reorder lane";
      attachLaneReorder(head, label);
    }
    kcol.append(head);

    const body = el("div", { class: "kcol-body" });

    items.forEach((t) => {
      const statusVal = String(t.cells[statusCol.id] || "");
      const cardColor = statusVal ? colorOf("status", statusVal) : "#b3b3b3";
      const card = el("div", { class: "kcard", style: `border-left:4px solid ${cardColor}` });
      card.append(el("button", { class: "del-btn", onClick: () => deleteTask(t.id) }, "×"));

      // Editable title (same click-to-edit as the table's primary cell)
      const titleWrap = el("div", { class: "ktitle" });
      titleWrap.append(renderCell(pCol, t));
      titleWrap.append(buildTimer(t));
      card.append(titleWrap);

      // Every other column gets a labeled, editable control — full parity with
      // the table view (status & priority pills, date pickers, text/number/person).
      const fields = el("div", { class: "kfields" });
      STATE.columns.filter((c) => !c.is_primary).forEach((c) => {
        const row = el("div", { class: "kfield" });
        row.append(el("span", { class: "kfield-label" }, c.name));
        const ctrl = el("span", { class: "kfield-ctrl" }, renderCell(c, t));
        row.append(ctrl);
        fields.append(row);
      });
      card.append(fields);
      body.append(card);
    });
    if (items.length === 0) body.append(el("div", { class: "kempty" }, "No tasks"));
    kcol.append(body);

    // Resize grip on the lane's right edge (real lanes only)
    if (isReal) {
      const grip = el("div", { class: "lane-resize-grip", title: "Drag to resize lane" });
      attachLaneResize(grip, kcol, label);
      kcol.append(grip);
    }
    kanban.append(kcol);
  });
  board.append(kanban);
}

// Drag the lane's right edge to resize it; width saved per status value.
function attachLaneResize(grip, kcol, label) {
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = kcol.getBoundingClientRect().width;
    document.body.classList.add("col-resizing");
    let lastW = startW;
    const onMove = (ev) => {
      lastW = Math.max(160, Math.min(700, Math.round(startW + (ev.clientX - startX))));
      kcol.style.width = lastW + "px";
      kcol.style.flex = `0 0 ${lastW}px`;
    };
    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      if (Math.round(lastW) !== Math.round(startW)) {
        await saveSetting("kw_" + label, Math.round(lastW));
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// Drag a lane header onto another lane to reorder; persists the status palette order.
function attachLaneReorder(head, label) {
  head.addEventListener("dragstart", (e) => {
    laneDragState = { label };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "lane:" + label);
    head.classList.add("lane-dragging");
  });
  head.addEventListener("dragend", () => {
    head.classList.remove("lane-dragging");
    document.querySelectorAll(".lane-drop-before, .lane-drop-after").forEach((n) =>
      n.classList.remove("lane-drop-before", "lane-drop-after"));
    laneDragState = null;
  });
  head.addEventListener("dragover", (e) => {
    if (!laneDragState || laneDragState.label === label) return;
    e.preventDefault();
    const rect = head.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    head.classList.toggle("lane-drop-after", after);
    head.classList.toggle("lane-drop-before", !after);
  });
  head.addEventListener("dragleave", () => head.classList.remove("lane-drop-before", "lane-drop-after"));
  head.addEventListener("drop", async (e) => {
    if (!laneDragState || laneDragState.label === label) return;
    e.preventDefault();
    const rect = head.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    await reorderLanes(laneDragState.label, label, after);
  });
}

// Move status lane `movedLabel` before/after `targetLabel`, persisting palette order.
async function reorderLanes(movedLabel, targetLabel, after) {
  const list = STATE.palette.status.slice();
  const order = list.map((p) => p.label);
  const m = order.splice(order.indexOf(movedLabel), 1)[0];
  let idx = order.indexOf(targetLabel);
  if (after) idx += 1;
  order.splice(idx, 0, m);
  // Reorder STATE.palette.status to match + update positions
  STATE.palette.status.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  STATE.palette.status.forEach((p, i) => { p.position = i; });
  laneDragState = null;
  render();
  try {
    await api("/api/palette/reorder", { method: "PATCH", body: JSON.stringify({ kind: "status", order: STATE.palette.status.map((p) => p.id) }) });
  } catch (err) { console.error("[lane reorder] save failed:", err); }
}

let calMonth = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
// ---------------- Reward system ----------------
function pointsInfo() {
  return STATE.points || { earned: 0, redeemed: 0, balance: 0, points_col: null };
}
function updatePointsBadge() {
  const badge = document.getElementById("points-badge");
  if (!badge) return;
  const p = pointsInfo();
  badge.textContent = `★ ${p.balance} pts`;
  badge.title = `Balance ${p.balance} — earned ${p.earned}, spent ${p.redeemed}`;
}

// Ensure a number column named "Points" exists; create it once if missing.
async function ensurePointsColumn() {
  const existing = STATE.columns.find((c) => c.type === "number" && c.name.trim().toLowerCase() === "points");
  if (existing) return existing.id;
  const resp = await api("/api/columns", { method: "POST", body: JSON.stringify({ name: "Points", type: "number" }) });
  await loadState();
  return resp && resp.id;
}

// ---- Room for Improvements: a second, self-contained table board ----
async function impUpdateCell(tid, colId, value) {
  const resp = await api(`/api/imp/tasks/${tid}/cell`, { method: "PATCH", body: JSON.stringify({ col: colId, value }) });
  const t = (STATE.imp_tasks || []).find((x) => x.id === tid);
  if (t && resp && resp.cells) t.cells = resp.cells;
  render();
}
async function impAddTask(group) {
  const t = await api("/api/imp/tasks", { method: "POST", body: JSON.stringify({ group: group || "Current Weaknesses" }) });
  STATE.imp_tasks = STATE.imp_tasks || [];
  STATE.imp_tasks.push(t);
  render();
}
async function impDeleteTask(tid) {
  await api(`/api/imp/tasks/${tid}`, { method: "DELETE" });
  STATE.imp_tasks = (STATE.imp_tasks || []).filter((t) => t.id !== tid);
  render();
}
async function impAddGroup() {
  const name = prompt("New section name:", "New section");
  if (!name || !name.trim()) return;
  await impAddTask(name.trim());
}
async function impRenameGroup(oldName, newName) {
  if (!newName || oldName === newName) return;
  await api("/api/imp/groups/rename", { method: "PATCH", body: JSON.stringify({ old: oldName, new: newName }) });
  (STATE.imp_tasks || []).forEach((t) => { if (t.group_name === oldName) t.group_name = newName; });
  render();
}
function impAddColumn() {
  openModal("Add column", (body, close) => {
    const nameIn = el("input", { class: "field", placeholder: "Column name", style: "width:100%;margin-bottom:10px" });
    body.append(nameIn);
    const typeSel = el("select", { class: "field", style: "width:100%;margin-bottom:12px" });
    ["text", "status", "person", "date", "number", "priority"].forEach((t) => typeSel.append(el("option", { value: t }, t)));
    body.append(typeSel);
    body.append(el("button", { class: "tool-btn accent-teal", onClick: async () => {
      const col = await api("/api/imp/columns", { method: "POST", body: JSON.stringify({ name: nameIn.value || "New Column", type: typeSel.value }) });
      STATE.imp_columns = STATE.imp_columns || [];
      STATE.imp_columns.push(col);
      close(); render();
    } }, "Add column"));
    setTimeout(() => nameIn.focus(), 30);
  });
}
async function impDeleteColumn(col) {
  if (!confirm(`Delete the “${col.name}” column and its values?`)) return;
  await api(`/api/imp/columns/${col.id}`, { method: "DELETE" });
  STATE.imp_columns = (STATE.imp_columns || []).filter((c) => c.id !== col.id);
  render();
}

// Cell renderer for the improvements board (mirrors the main one, but writes to
// the imp endpoints and uses a plain date input).
function impCell(col, task) {
  const value = task.cells[col.id];
  if (col.type === "status" || col.type === "priority") {
    return buildTagPill(col, task, impUpdateCell);
  }
  if (col.type === "date") {
    const inp = el("input", { class: "cell-input", type: "date", value: value || "" });
    inp.addEventListener("change", () => impUpdateCell(task.id, col.id, inp.value));
    return inp;
  }
  if (col.type === "number") {
    const inp = el("input", { class: "cell-input", type: "number", value: value === "" || value == null ? "" : value, style: "text-align:right" });
    inp.addEventListener("change", () => impUpdateCell(task.id, col.id, inp.value === "" ? "" : Number(inp.value)));
    return inp;
  }
  // text / person — inline edit
  const isPlaceholder = col.is_primary && value === "New weakness";
  const div = el("div", { class: "cell-text" + (value && !isPlaceholder ? "" : " empty") + (col.is_primary ? " cell-primary" : "") },
    value || (col.type === "person" ? "Unassigned" : "Click to edit"));
  div.addEventListener("click", () => {
    const startEmpty = isPlaceholder;
    const inp = el("input", { class: "cell-input", value: startEmpty ? "" : (value || ""), placeholder: startEmpty ? value : "", style: "border:1px solid var(--cyan);border-radius:4px;padding:2px 6px" });
    div.replaceWith(inp); inp.focus(); if (!startEmpty) inp.select();
    const commit = () => { const v = inp.value.trim(); if (startEmpty && v === "") { render(); return; } impUpdateCell(task.id, col.id, inp.value); };
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") render(); });
  });
  return div;
}

function renderImprovements() {
  const board = $("#board");
  const cols = (STATE.imp_columns || []).slice().sort((a, b) => a.position - b.position);
  const rows = (STATE.imp_tasks || []).slice();

  const wrap = el("div", { class: "imp-wrap" });
  const head = el("div", { class: "vibe-head" });
  head.append(el("div", {}, el("div", { class: "vibe-title" }, "Room for Improvement"),
    el("div", { class: "vibe-sub" }, "Name a weakness, why it matters, and the concrete path to improving it.")));
  const actions = el("div", { style: "display:flex;gap:8px" });
  actions.append(el("button", { class: "tool-btn", onClick: impAddColumn }, "+ Column"));
  actions.append(el("button", { class: "tool-btn", onClick: impAddGroup }, "+ Section"));
  actions.append(el("button", { class: "tool-btn accent-teal", onClick: () => impAddTask("Current Weaknesses") }, "+ New weakness"));
  head.append(actions);
  wrap.append(head);

  // Group rows by section
  const groups = {};
  rows.forEach((t) => { (groups[t.group_name] = groups[t.group_name] || []).push(t); });
  if (!Object.keys(groups).length) groups["Current Weaknesses"] = [];

  Object.keys(groups).forEach((g, gi) => {
    const color = ["#00859b", "#38a66f", "#77b28c", "#c0782a", "#8e7cc3"][gi % 5];
    const groupEl = el("div", { class: "group" });
    const header = el("div", { class: "group-header", style: `border-left-color:${color}` });
    const gname = el("span", { class: "gname", style: `color:${color}`, title: "Click to rename", contenteditable: "true" }, g);
    gname.addEventListener("blur", () => { const v = gname.textContent.trim(); if (v && v !== g) impRenameGroup(g, v); });
    gname.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); gname.blur(); } });
    header.append(gname);
    header.append(el("span", { class: "group-count" }, `${groups[g].length}`));
    groupEl.append(header);

    const table = el("table", { class: "task-table" });
    const thead = el("thead"); const htr = el("tr");
    cols.forEach((c) => {
      const th = el("th", { style: c.width ? `width:${c.width}px` : "" });
      const nm = el("span", { class: "th-name", contenteditable: "true", title: "Rename column" }, c.name);
      nm.addEventListener("blur", async () => { const v = nm.textContent.trim(); if (v && v !== c.name) { c.name = v; await api(`/api/imp/columns/${c.id}`, { method: "PATCH", body: JSON.stringify({ name: v }) }); } });
      nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nm.blur(); } });
      th.append(nm);
      if (!c.is_primary) th.append(el("span", { class: "th-del", title: "Delete column", onClick: () => impDeleteColumn(c) }, " ✕"));
      htr.append(th);
    });
    htr.append(el("th", { style: "width:36px" }));
    thead.append(htr); table.append(thead);

    const tbody = el("tbody");
    groups[g].forEach((t) => {
      const tr = el("tr", { "data-id": t.id });
      cols.forEach((c) => { const td = el("td"); td.append(impCell(c, t)); tr.append(td); });
      const actTd = el("td", { style: "text-align:center" });
      actTd.append(el("span", { class: "imp-row-del", title: "Delete row", onClick: () => impDeleteTask(t.id) }, "✕"));
      tr.append(actTd);
      tbody.append(tr);
    });
    table.append(tbody);
    groupEl.append(table);

    const addRow = el("div", { class: "imp-addrow", onClick: () => impAddTask(g) }, "+ Add weakness");
    groupEl.append(addRow);
    wrap.append(groupEl);
  });

  board.append(wrap);
}

// ---- Vibe Coding projects ----
const VIBE_STAGES = [
  { key: "idea",     label: "Idea",        color: "#b3b3b3" },
  { key: "building", label: "Building",    color: "#00bfb8" },
  { key: "testing",  label: "Testing",     color: "#00859b" },
  { key: "shipped",  label: "Shipped",     color: "#38a66f" },
  { key: "parked",   label: "Parked",      color: "#c0782a" },
];
function vibeStage(key) { return VIBE_STAGES.find((s) => s.key === key) || VIBE_STAGES[0]; }

async function vibeAddProject() {
  // "New project" opens the plan template first — the brief is the entry point,
  // so you're forced to think the project through before it becomes a card.
  openProjectPlan(null);
}

// The planning template — the five elements of a complete brief from the guide,
// plus Approach (separate thinking from producing) and a Reference example
// (show what good looks like). Each carries the document's own guidance inline.
const PLAN_SECTIONS = [
  { key: "objective", label: "Objective — what & why", core: true,
    guide: "State the deliverable and the decision it serves. “Build X so I can decide Y” tells Claude far more than “do X.” The why lets it prioritize what matters and drop what doesn't.",
    ph: "e.g. Build a single-file expense categorizer so I can stop hand-sorting my card export each month." },
  { key: "context", label: "Context — what Claude needs to know", core: true,
    guide: "Supply the raw material: the data, background, audience, prior work. Paste the numbers, attach the file. If it's for a specific audience, say so — register and depth change completely.",
    ph: "e.g. Inputs are monthly CSV exports (columns: date, description, amount). Audience: just me. Existing app uses Flask + SQLite." },
  { key: "constraints", label: "Constraints — rules & boundaries", core: true,
    guide: "Conventions, limits, non-negotiables: house formatting, fixed assumptions, length caps, what to exclude, tools/sources to use or avoid. This is where the most silent rework hides.",
    ph: "e.g. Single-file HTML, no build step. Vanilla JS only. Must run offline. Don't add a backend. Use my color palette." },
  { key: "format", label: "Format — the shape of the output", core: true,
    guide: "Name the artifact and its structure: a one-page memo, a three-tab workbook, a React component, an inline answer. If you have a preferred section order or template, give it now.",
    ph: "e.g. One self-contained index.html with an upload button, a sortable table, and a category pie chart." },
  { key: "done", label: "Definition of done — the acceptance test", core: true,
    guide: "Describe what a finished, approvable version looks like. The single most-skipped element and the one that most reduces looping. Give Claude a target to self-check against.",
    ph: "e.g. Done means I can drop in a CSV and within 5 seconds see every transaction categorized with a running total per category, no console errors." },
  { key: "approach", label: "Approach / outline (optional)", core: false,
    guide: "Separate thinking from producing. If you already have a structure in mind, sketch it — or leave blank and ask Claude for the outline first before the full build.",
    ph: "e.g. 1) parse CSV  2) keyword→category map  3) render table  4) totals + chart. Ask me to confirm the category map before building." },
  { key: "reference", label: "Reference example (optional)", core: false,
    guide: "Show what good looks like. A prior artifact, a template, a link, or a description of one you liked — “match this” collapses several rounds of style correction into zero.",
    ph: "e.g. Match the look of my Credit Card dashboard (port 5400) — same cards, same palette, same density." },
];
const PLAN_CHECKLIST = [
  "Stated the objective and the decision it serves",
  "Pasted/attached the actual data, not a description of it",
  "Named every constraint and house convention",
  "Specified the artifact type and its structure",
  "Defined what a finished, approvable version looks like",
];

function planOf(proj) {
  if (proj && proj.plan) { try { return JSON.parse(proj.plan); } catch (e) {} }
  return { fields: {}, checklist: [], prompts: {} };
}
function planCoreCount(plan) {
  return PLAN_SECTIONS.filter((s) => s.core && (plan.fields[s.key] || "").trim()).length;
}
function planCoreTotal() { return PLAN_SECTIONS.filter((s) => s.core).length; }
function planComplete(proj) {
  const plan = planOf(proj);
  return PLAN_SECTIONS.some((s) => (plan.fields[s.key] || "").trim());  // any content = a plan exists
}
