/* Tuned In — the board API.
   Ports the /api/state, /api/tasks, /api/columns, /api/groups, /api/automations,
   /api/palette and /api/restore routes from the legacy Flask app.py. Behavior
   is intended to match one-for-one, including the linked-copy, dedup,
   parked-group and done-collapse rules, which are the subtle parts. */

import {
  all, badRequest, batched, body, computePoints, deleteTaskTree, descendantIds,
  first, getRevision, json, nextPos, parseJSON, placeholders, primaryColId, run,
  applyAutomations, fetchAutomations, stampDone, todayISO, uid,
  COLUMN_TYPES, SERVER_BUILD, TIME_SPENT, TIME_STARTED,
} from "./lib.js";
import { ensureSeeded } from "./seed.js";

// ---------------------------------------------------------------- /api/state
export async function apiState(env) {
  const db = env.DB;
  await ensureSeeded(env);

  const [columns, taskRows, automations, paletteRows, gcRows, goRows, setRows,
    rewards, redemptions, projects, impColumns, impTaskRows, promptRows] = await Promise.all([
    all(db, "SELECT * FROM columns ORDER BY position"),
    all(db, "SELECT * FROM tasks ORDER BY position, rowid"),
    fetchAutomations(db),
    all(db, "SELECT * FROM palette ORDER BY kind, position"),
    all(db, "SELECT * FROM group_colors"),
    all(db, "SELECT * FROM group_order"),
    all(db, "SELECT * FROM settings"),
    all(db, "SELECT * FROM rewards ORDER BY position, rowid"),
    all(db, "SELECT * FROM redemptions ORDER BY ts DESC"),
    all(db, "SELECT * FROM projects ORDER BY position, rowid"),
    all(db, "SELECT * FROM imp_columns ORDER BY position, rowid"),
    all(db, "SELECT * FROM imp_tasks ORDER BY position, rowid"),
    all(db, "SELECT * FROM prompts ORDER BY position, rowid"),
  ]);

  const tasks = taskRows.map((r) => ({ ...r, cells: parseJSON(r.cells) }));
  const imp_tasks = impTaskRows.map((r) => ({ ...r, cells: parseJSON(r.cells) }));
  const prompts = promptRows.map((r) => ({ ...r, fields: parseJSON(r.fields) }));

  const palette = { status: [], priority: [] };
  for (const r of paletteRows) {
    (palette[r.kind] ||= []).push(
      { id: r.id, label: r.label, color: r.color, position: r.position });
  }

  const group_colors = Object.fromEntries(gcRows.map((r) => [r.group_name, r.color]));
  const group_order = Object.fromEntries(goRows.map((r) => [r.group_name, r.position]));
  const settings = Object.fromEntries(setRows.map((r) => [r.key, r.value]));

  return json({
    columns, tasks, automations, palette, group_colors, group_order, settings,
    rewards, redemptions, projects, imp_columns: impColumns, imp_tasks,
    points: computePoints(columns, tasks, redemptions),
    prompts, server_build: SERVER_BUILD,
  });
}

// ---------------------------------------------------------------- tasks
export async function addTask(env, request) {
  const db = env.DB;
  const data = await body(request);
  let parentId = data.parent_id || null;
  let group = data.group ?? "All Active Tasks";

  // A subtask inherits its parent's group so the two never drift apart.
  if (parentId) {
    const prow = await first(db, "SELECT group_name FROM tasks WHERE id = ?", parentId);
    if (prow) group = prow.group_name;
    else parentId = null; // parent vanished; treat as top-level
  }

  const columns = await all(db, "SELECT * FROM columns");
  const cells = {};
  for (const c of columns) {
    if (c.type === "status") cells[c.id] = "Not Started";
    else if (c.type === "person") cells[c.id] = "James"; // default owner/assignee
    else cells[c.id] = "";
    if (c.is_primary) cells[c.id] = parentId ? "New subtask" : "New task";
  }

  const tid = uid();
  const pos = await nextPos(db, "tasks");
  const st = [db.prepare(
    "INSERT INTO tasks (id, group_name, cells, position, parent_id) VALUES (?,?,?,?,?)")
    .bind(tid, group, JSON.stringify(cells), pos, parentId)];

  // If the parent has linked copies in other groups, give those copies an
  // identical (linked) subtask too, so the hierarchy stays mirrored. The new
  // subtasks share a link_id, so future edits to any one sync to the rest.
  if (parentId) {
    const prow = await first(db, "SELECT link_id FROM tasks WHERE id = ?", parentId);
    const parentLink = prow ? prow.link_id : null;
    if (parentLink) {
      const siblingParents = await all(
        db, "SELECT id, group_name FROM tasks WHERE link_id = ? AND id != ?", parentLink, parentId);
      if (siblingParents.length) {
        const subLink = uid();
        st.push(db.prepare("UPDATE tasks SET link_id = ? WHERE id = ?").bind(subLink, tid));
        siblingParents.forEach((sp, i) => {
          st.push(db.prepare(
            "INSERT INTO tasks (id, group_name, cells, position, parent_id, link_id) VALUES (?,?,?,?,?,?)")
            .bind(uid(), sp.group_name, JSON.stringify(cells), pos + 1 + i, sp.id, subLink));
        });
      }
    }
  }

  await batched(db, st);
  return json({ id: tid, group_name: group, cells, position: pos, parent_id: parentId });
}

export async function updateCell(env, request, taskId) {
  const db = env.DB;
  const data = await body(request);
  const colId = data.col;
  const value = data.value;
  const today = todayISO(env);

  const row = await first(
    db, "SELECT cells, group_name, link_id FROM tasks WHERE id = ?", taskId);
  if (!row) return badRequest("not found", {}, 404);

  const linkId = row.link_id;
  const automations = await fetchAutomations(db);

  // The set of placements to update: just this task, or all linked siblings.
  const siblings = linkId
    ? await all(db, "SELECT id, cells, group_name FROM tasks WHERE link_id = ?", linkId)
    : await all(db, "SELECT id, cells, group_name FROM tasks WHERE id = ?", taskId);

  // Is this a status column being set to "Done"? Drives the collapse rule.
  const col = await first(db, "SELECT type FROM columns WHERE id = ?", colId);
  const isStatus = !!col && col.type === "status";
  const becomingDone = isStatus && String(value) === "Done";

  const allColumns = await all(db, "SELECT id, type FROM columns");
  let resultForCaller = null;
  const writes = [];
  for (const sib of siblings) {
    const cells = parseJSON(sib.cells);
    cells[colId] = value; // the linked field change applies to every copy
    const res = applyAutomations({ cells, group_name: sib.group_name }, automations, today);
    stampDone(res.cells, allColumns, today); // record/clear the completion date
    writes.push(db.prepare("UPDATE tasks SET cells = ?, group_name = ? WHERE id = ?")
      .bind(JSON.stringify(res.cells), res.group_name, sib.id));
    if (sib.id === taskId) resultForCaller = res;
  }
  await batched(db, writes);

  // Dedup pass: after automations, two or more linked siblings may have landed
  // in the SAME group (e.g. a moveToGroup rule moved several copies into one).
  // A linked task in a group twice is meaningless, so collapse such collisions
  // to one placement — preferring the task the user acted on.
  if (linkId) {
    const sibsNow = await all(
      db, "SELECT id, group_name FROM tasks WHERE link_id = ? AND parent_id IS NULL", linkId);
    const seen = new Map();
    for (const s of sibsNow) {
      const g = s.group_name;
      if (!seen.has(g)) { seen.set(g, s.id); continue; }
      let keep = seen.get(g);
      let drop = s.id;
      if (drop === taskId) { [keep, drop] = [drop, keep]; seen.set(g, keep); }
      await deleteTaskTree(db, drop);
    }
  }

  // Copy-to-group automations: if the edited task now meets a copy rule's
  // trigger, make a linked copy in the destination — but only if one isn't
  // already there, so it copies at most once per destination group.
  let copied = false;
  const updatedCells = (resultForCaller || {}).cells || parseJSON(row.cells);
  const curGroup = (resultForCaller || {}).group_name ?? row.group_name;
  for (const a of automations) {
    if (!a.enabled || a.action_type !== "copyToGroup") continue;
    if (String(updatedCells[a.trigger_col] ?? "") !== String(a.trigger_val)) continue;
    const dest = (a.action_val || "").trim();
    if (!dest || dest === curGroup) continue;
    if (await createLinkedCopy(db, taskId, dest, true)) copied = true;
  }

  // Leaving a "parked" group: parked groups are the destinations of enabled
  // moveToGroup rules (Holding Pattern / Pending, Waiting for Feedback, ...).
  // If this status change means the task no longer qualifies to sit in one of
  // those groups, delete the stale placement(s) left behind — but only when
  // the task still lives in at least one other group, so it can never vanish
  // from the board entirely.
  if (isStatus) {
    const parked = new Map();
    for (const a of automations) {
      if (a.enabled && a.action_type === "moveToGroup" && a.action_val && a.trigger_col === colId) {
        parked.set(a.action_val, String(a.trigger_val));
      }
    }
    const lrow = await first(db, "SELECT link_id FROM tasks WHERE id = ?", taskId);
    const lidNow = lrow ? lrow.link_id : null;
    const placements = lidNow
      ? await all(db, "SELECT id, group_name FROM tasks WHERE link_id = ? AND parent_id IS NULL", lidNow)
      : await all(db, "SELECT id, group_name FROM tasks WHERE id = ? AND parent_id IS NULL", taskId);
    const stale = placements.filter(
      (p) => parked.has(p.group_name) && parked.get(p.group_name) !== String(value));
    if (stale.length && placements.length - stale.length >= 1) {
      for (const p of stale) await deleteTaskTree(db, p.id);
      copied = true; // force the client to reload the whole board
    }
  }

  // Done-collapse: if a linked task is marked Done, keep only the copy the user
  // acted on (and its subtasks); delete the other linked placements.
  let collapsed = false;
  if (becomingDone && linkId) {
    const others = await all(
      db, "SELECT id FROM tasks WHERE link_id = ? AND id != ?", linkId, taskId);
    for (const o of others) await deleteTaskTree(db, o.id);
    // The surviving copy is no longer linked to anything — clear its link_id.
    await run(db, "UPDATE tasks SET link_id = NULL WHERE id = ?", taskId);
    collapsed = true;
  }

  if (!resultForCaller) {
    resultForCaller = { cells: parseJSON(row.cells), group_name: row.group_name };
  }
  return json({
    id: taskId,
    cells: resultForCaller.cells,
    group_name: resultForCaller.group_name,
    linked_changed: !!linkId || copied, // refresh if linked or a copy was made
    collapsed,
  });
}

export async function deleteTask(env, taskId) {
  await deleteTaskTree(env.DB, taskId); // deleting a parent removes its subtasks too
  return json({ ok: true });
}

/** Delete empty/placeholder task rows — ones whose name is blank or still the
 *  default AND that carry no other content. Skips any such row that still has
 *  subtasks, so a not-yet-named parent with real children is never removed. */
export async function cleanupEmptyTasks(env) {
  const db = env.DB;
  const columns = await all(db, "SELECT * FROM columns");
  const primary = (columns.find((c) => c.is_primary) || {}).id;
  const contentCols = columns.filter((c) => !c.is_primary).map((c) => c.id);
  const PLACEHOLDERS = new Set(["", "new task", "new subtask"]);

  const parentRows = await all(
    db, "SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL");
  const parents = new Set(parentRows.map((r) => r.parent_id));

  const toDelete = [];
  for (const r of await all(db, "SELECT * FROM tasks")) {
    const cells = parseJSON(r.cells);
    const nm = String(cells[primary] ?? "").trim().toLowerCase();
    if (!PLACEHOLDERS.has(nm)) continue;
    if (parents.has(r.id)) continue; // unnamed but has subtasks → keep
    let hasContent = false;
    for (const cid of contentCols) {
      if (cid.startsWith("__")) continue;
      const v = String(cells[cid] ?? "").trim();
      if (v && v !== "Not Started" && v !== "James") { hasContent = true; break; }
    }
    if (!hasContent) toDelete.push(r.id);
  }
  for (const tid of toDelete) await deleteTaskTree(db, tid);
  return json({ ok: true, deleted: toDelete.length });
}

/** Body: { order: [task_id, ...] }. Sets each task's position by array index.
 *  Used by drag-and-drop and by "Sort by Priority". */
export async function reorderTasks(env, request) {
  const db = env.DB;
  const { order = [] } = await body(request);
  await batched(db, order.map((tid, pos) =>
    db.prepare("UPDATE tasks SET position = ? WHERE id = ?").bind(pos, tid)));
  return json({ ok: true });
}

/** Body: { action: 'start' | 'stop' | 'reset' | 'set' }. Per-task time tracking,
 *  stored inside the task's cells JSON under reserved keys. */
export async function taskTimer(env, request, taskId) {
  const db = env.DB;
  const row = await first(db, "SELECT * FROM tasks WHERE id = ?", taskId);
  if (!row) return badRequest("not found", {}, 404);
  const data = await body(request);
  const cells = parseJSON(row.cells);
  const nowMs = Date.now();
  let spent = parseInt(cells[TIME_SPENT], 10) || 0;
  const started = cells[TIME_STARTED] || "";

  switch (data.action) {
    case "start":
      if (!started) cells[TIME_STARTED] = new Date(nowMs).toISOString();
      break;
    case "stop":
      if (started) {
        const t = Date.parse(started);
        if (!Number.isNaN(t)) spent += Math.max(0, Math.trunc((nowMs - t) / 1000));
        cells[TIME_SPENT] = spent;
        cells[TIME_STARTED] = "";
      }
      break;
    case "reset":
      cells[TIME_SPENT] = 0;
      cells[TIME_STARTED] = "";
      break;
    case "set": {
      // Manually correct the tracked time (e.g. the timer was left running).
      // If the clock is running, it keeps running on top of the corrected total.
      const n = parseFloat(data.seconds);
      if (!Number.isFinite(n)) return badRequest("bad seconds");
      cells[TIME_SPENT] = Math.max(0, Math.trunc(n));
      if (started) cells[TIME_STARTED] = new Date(nowMs).toISOString();
      break;
    }
    default:
      return badRequest("bad action");
  }

  await run(db, "UPDATE tasks SET cells = ? WHERE id = ?", JSON.stringify(cells), taskId);
  return json({
    id: taskId,
    time_spent: parseInt(cells[TIME_SPENT], 10) || 0,
    time_started: cells[TIME_STARTED] || "",
  });
}

// ---------------------------------------------------------------- linked copies
/** Return a reason object if placing `taskId` into `destGroup` would create a
 *  duplicate there (same link_id, or same name), else null (port of _dup_reason). */
async function dupReason(db, taskId, destGroup) {
  const src = await first(db, "SELECT cells, link_id FROM tasks WHERE id = ?", taskId);
  if (!src) return null;
  const pcol = await primaryColId(db);
  const srcName = pcol ? String(parseJSON(src.cells)[pcol] ?? "").trim() : "";
  const srcLink = src.link_id;

  const rows = await all(
    db,
    "SELECT id, cells, link_id FROM tasks WHERE group_name = ? AND parent_id IS NULL AND id != ?",
    destGroup, taskId);

  for (const r of rows) {
    if (srcLink && r.link_id === srcLink) {
      return { kind: "link", name: srcName, group: destGroup };
    }
  }
  if (pcol && srcName) {
    for (const r of rows) {
      const other = String(parseJSON(r.cells)[pcol] ?? "").trim();
      if (other && other.toLowerCase() === srcName.toLowerCase()) {
        return { kind: "name", name: srcName, group: destGroup };
      }
    }
  }
  return null;
}

/** Create a LINKED copy of a top-level task in `dest`. Returns the new task id,
 *  or null if it couldn't/shouldn't copy. With `skipIfPresent`, does nothing if
 *  a copy already exists there — used by the copy-automation, which has no user
 *  to prompt (port of _create_linked_copy). */
async function createLinkedCopy(db, taskId, dest, skipIfPresent = false) {
  const src = await first(db, "SELECT * FROM tasks WHERE id = ?", taskId);
  if (!src || src.parent_id) return null;

  // Ensure the source has a link_id (assign one if this is its first link).
  let linkId = src.link_id;
  if (!linkId) {
    linkId = uid();
    await run(db, "UPDATE tasks SET link_id = ? WHERE id = ?", linkId, src.id);
    for (const s of await all(db, "SELECT id, link_id FROM tasks WHERE parent_id = ?", src.id)) {
      if (!s.link_id) await run(db, "UPDATE tasks SET link_id = ? WHERE id = ?", uid(), s.id);
    }
  }

  if (skipIfPresent) {
    const alreadyLink = await first(
      db, "SELECT 1 AS x FROM tasks WHERE link_id = ? AND group_name = ? AND parent_id IS NULL",
      linkId, dest);
    if (alreadyLink) return null;
    const pcol = await primaryColId(db);
    if (pcol) {
      const srcName = String(parseJSON(src.cells)[pcol] ?? "").trim().toLowerCase();
      if (srcName) {
        const rows = await all(
          db, "SELECT cells FROM tasks WHERE group_name = ? AND parent_id IS NULL", dest);
        for (const r of rows) {
          if (String(parseJSON(r.cells)[pcol] ?? "").trim().toLowerCase() === srcName) return null;
        }
      }
    }
  }

  const newId = uid();
  const pos = await nextPos(db, "tasks");
  await run(
    db,
    "INSERT INTO tasks (id, group_name, cells, position, parent_id, link_id) VALUES (?,?,?,?,?,?)",
    newId, dest, src.cells, pos, null, linkId);

  // Copy + link the whole subtask subtree (subtasks can nest).
  async function copySubtree(srcParentId, newParentId, depth = 0) {
    if (depth > 32) return;
    for (const sub of await all(db, "SELECT * FROM tasks WHERE parent_id = ?", srcParentId)) {
      const subLink = sub.link_id || uid();
      if (!sub.link_id) await run(db, "UPDATE tasks SET link_id = ? WHERE id = ?", subLink, sub.id);
      const spos = await nextPos(db, "tasks");
      const subNew = uid();
      await run(
        db,
        "INSERT INTO tasks (id, group_name, cells, position, parent_id, link_id) VALUES (?,?,?,?,?,?)",
        subNew, dest, sub.cells, spos, newParentId, subLink);
      await copySubtree(sub.id, subNew, depth + 1);
    }
  }
  await copySubtree(src.id, newId);
  return newId;
}

/** Move a task into a different group. Subtasks follow their parent. If the
 *  move would create a duplicate and force isn't set, returns needs_confirm. */
export async function moveTaskGroup(env, request, taskId) {
  const db = env.DB;
  const data = await body(request);
  const newGroup = (data.group || "").trim() || "General";
  if (!data.force) {
    const dup = await dupReason(db, taskId, newGroup);
    if (dup) return json({ needs_confirm: true, action: "move", ...dup });
  }
  const ids = [taskId, ...(await descendantIds(db, taskId))];
  await run(
    db, `UPDATE tasks SET group_name = ? WHERE id IN (${placeholders(ids.length)})`,
    newGroup, ...ids);
  return json({ id: taskId, group_name: newGroup });
}

/** Create a LINKED copy of a task in another group. All copies sharing a
 *  link_id are the same logical task: editing any field on one updates the
 *  others. Subtasks are copied (and linked) under the new placement too. */
export async function copyTaskToGroup(env, request, taskId) {
  const db = env.DB;
  const data = await body(request);
  const dest = (data.group || "").trim();
  if (!dest) return badRequest("group required");

  const src = await first(db, "SELECT parent_id FROM tasks WHERE id = ?", taskId);
  if (!src) return badRequest("not found", {}, 404);
  if (src.parent_id) return badRequest("cannot copy a subtask directly");

  if (!data.force) {
    const dup = await dupReason(db, taskId, dest);
    if (dup) return json({ needs_confirm: true, action: "copy", ...dup });
  }

  const newId = await createLinkedCopy(db, taskId, dest);
  if (!newId) return badRequest("could not copy");
  const row = await first(db, "SELECT link_id FROM tasks WHERE id = ?", newId);
  return json({ ok: true, id: newId, link_id: row ? row.link_id : null, group_name: dest });
}

// ---------------------------------------------------------------- columns
export async function reorderColumns(env, request) {
  const db = env.DB;
  const { order = [] } = await body(request);
  await batched(db, order.map((cid, pos) =>
    db.prepare("UPDATE columns SET position = ? WHERE id = ?").bind(pos, cid)));
  return json({ ok: true });
}

export async function addColumn(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = data.name;
  const type = COLUMN_TYPES.includes(data.type) ? data.type : "text";
  const cid = "c_" + uid();
  const pos = await nextPos(db, "columns");
  const def = type === "status" ? "Not Started" : "";

  const st = [db.prepare(
    "INSERT INTO columns (id, name, type, is_primary, position) VALUES (?,?,?,0,?)")
    .bind(cid, name, type, pos)];
  // Backfill the new cell on every task.
  for (const r of await all(db, "SELECT id, cells FROM tasks")) {
    const cells = parseJSON(r.cells);
    cells[cid] = def;
    st.push(db.prepare("UPDATE tasks SET cells = ? WHERE id = ?")
      .bind(JSON.stringify(cells), r.id));
  }
  await batched(db, st);
  return json({ id: cid, name, type, is_primary: 0, position: pos });
}

export async function deleteColumn(env, colId) {
  const db = env.DB;
  const primary = await first(db, "SELECT is_primary FROM columns WHERE id = ?", colId);
  if (primary && primary.is_primary) return badRequest("cannot delete primary column");

  const st = [db.prepare("DELETE FROM columns WHERE id = ?").bind(colId)];
  for (const r of await all(db, "SELECT id, cells FROM tasks")) {
    const cells = parseJSON(r.cells);
    if (!(colId in cells)) continue;
    delete cells[colId];
    st.push(db.prepare("UPDATE tasks SET cells = ? WHERE id = ?")
      .bind(JSON.stringify(cells), r.id));
  }
  await batched(db, st);
  return json({ ok: true });
}

/** Update a column's display name and/or width. The id stays stable, so task
 *  cells don't need rewriting. */
export async function updateColumn(env, request, colId) {
  const db = env.DB;
  const data = await body(request);
  const updated = {};
  const st = [];
  if ("name" in data) {
    const newName = (data.name || "").trim();
    if (!newName) return badRequest("name required");
    st.push(db.prepare("UPDATE columns SET name = ? WHERE id = ?").bind(newName, colId));
    updated.name = newName;
  }
  if ("width" in data) {
    const w = data.width;
    if (w === null || w === "") {
      st.push(db.prepare("UPDATE columns SET width = NULL WHERE id = ?").bind(colId));
      updated.width = null;
    } else {
      const wi = parseInt(w, 10);
      if (!Number.isFinite(wi)) return badRequest("bad width");
      const clamped = Math.max(60, Math.min(900, wi)); // clamp to a sane range
      st.push(db.prepare("UPDATE columns SET width = ? WHERE id = ?").bind(clamped, colId));
      updated.width = clamped;
    }
  }
  await batched(db, st);
  return json({ id: colId, ...updated });
}

// ---------------------------------------------------------------- groups
/** Body: { old, new }. Updates every task in the old group and rewrites any
 *  automation rule, color and order position that targeted it. */
export async function renameGroup(env, request) {
  const db = env.DB;
  const data = await body(request);
  const oldName = (data.old || "").trim();
  const newName = (data.new || "").trim();
  if (!oldName || !newName || oldName === newName) return badRequest("invalid names");

  const st = [
    db.prepare("UPDATE tasks SET group_name = ? WHERE group_name = ?").bind(newName, oldName),
    // Keep moveToGroup automations pointing at the renamed group.
    db.prepare("UPDATE automations SET action_val = ? WHERE action_type = 'moveToGroup' AND action_val = ?")
      .bind(newName, oldName),
  ];
  const color = await first(db, "SELECT color FROM group_colors WHERE group_name = ?", oldName);
  if (color) {
    st.push(db.prepare("DELETE FROM group_colors WHERE group_name = ?").bind(oldName));
    st.push(db.prepare(
      "INSERT INTO group_colors (group_name, color) VALUES (?, ?) " +
      "ON CONFLICT(group_name) DO UPDATE SET color = excluded.color").bind(newName, color.color));
  }
  const order = await first(db, "SELECT position FROM group_order WHERE group_name = ?", oldName);
  if (order) {
    st.push(db.prepare("DELETE FROM group_order WHERE group_name = ?").bind(oldName));
    st.push(db.prepare(
      "INSERT INTO group_order (group_name, position) VALUES (?, ?) " +
      "ON CONFLICT(group_name) DO UPDATE SET position = excluded.position")
      .bind(newName, order.position));
  }
  await batched(db, st);
  return json({ ok: true, old: oldName, new: newName });
}

/** Body: { name, mode: "delete" | "merge", merge_into }. Either way,
 *  moveToGroup automations targeting the group are repointed or disabled so
 *  they don't silently misroute future tasks. */
export async function deleteGroup(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = (data.name || "").trim();
  const mode = data.mode || "delete";
  if (!name) return badRequest("name required");

  const st = [];
  if (mode === "merge") {
    const target = (data.merge_into || "").trim();
    if (!target || target === name) return badRequest("merge target required");
    st.push(db.prepare("UPDATE tasks SET group_name = ? WHERE group_name = ?").bind(target, name));
    st.push(db.prepare(
      "UPDATE automations SET action_val = ? WHERE action_type = 'moveToGroup' AND action_val = ?")
      .bind(target, name));
  } else {
    st.push(db.prepare("DELETE FROM tasks WHERE group_name = ?").bind(name));
    // Keep the rule around in case it just needs re-targeting, but off so it
    // doesn't silently recreate the group on the next status flip.
    st.push(db.prepare(
      "UPDATE automations SET enabled = 0 WHERE action_type = 'moveToGroup' AND action_val = ?")
      .bind(name));
  }
  st.push(db.prepare("DELETE FROM group_colors WHERE group_name = ?").bind(name));
  st.push(db.prepare("DELETE FROM group_order WHERE group_name = ?").bind(name));
  await batched(db, st);
  return json({ ok: true });
}

/** Register a group so it persists even with no tasks. */
export async function createGroup(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = (data.name || "").trim();
  if (!name) return badRequest("name required");
  const existing = await first(db, "SELECT 1 AS x FROM group_order WHERE group_name = ?", name);
  const hasTasks = await first(db, "SELECT 1 AS x FROM tasks WHERE group_name = ? LIMIT 1", name);
  if (!existing) {
    const row = await first(db, "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM group_order");
    await run(db, "INSERT INTO group_order (group_name, position) VALUES (?, ?)", name, row.p);
  }
  return json({ ok: true, name, already_existed: !!(existing || hasTasks) });
}

export async function reorderGroups(env, request) {
  const db = env.DB;
  const { order = [] } = await body(request);
  await batched(db, order.map((name, pos) => db.prepare(
    "INSERT INTO group_order (group_name, position) VALUES (?, ?) " +
    "ON CONFLICT(group_name) DO UPDATE SET position = excluded.position").bind(name, pos)));
  return json({ ok: true });
}

/** Body: { name, color }. An empty color resets the group to the default
 *  rotating color. */
export async function setGroupColor(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = (data.name || "").trim();
  const color = (data.color || "").trim();
  if (!name) return badRequest("name required");
  if (color) {
    await run(db,
      "INSERT INTO group_colors (group_name, color) VALUES (?, ?) " +
      "ON CONFLICT(group_name) DO UPDATE SET color = excluded.color", name, color);
  } else {
    await run(db, "DELETE FROM group_colors WHERE group_name = ?", name);
  }
  return json({ ok: true, name, color: color || null });
}

// ---------------------------------------------------------------- automations
export async function saveAutomation(env, request) {
  const db = env.DB;
  const a = await body(request);
  const aid = a.id || uid();
  const exists = await first(db, "SELECT 1 AS x FROM automations WHERE id = ?", aid);
  const fields = [
    a.enabled === undefined || a.enabled ? 1 : 0,
    a.name ?? "",
    a.trigger_col, a.trigger_val ?? "",
    a.action_col, a.action_type ?? "setToday", a.action_val ?? "",
  ];
  if (exists) {
    await run(db,
      `UPDATE automations SET enabled=?, name=?, trigger_col=?, trigger_val=?,
         action_col=?, action_type=?, action_val=? WHERE id=?`, ...fields, aid);
  } else {
    const pos = await nextPos(db, "automations");
    await run(db,
      `INSERT INTO automations
         (id, enabled, name, trigger_col, trigger_val, action_col, action_type, action_val, position)
       VALUES (?,?,?,?,?,?,?,?,?)`, aid, ...fields, pos);
  }
  return json({ id: aid });
}

export async function toggleAutomation(env, autoId) {
  await run(env.DB, "UPDATE automations SET enabled = 1 - enabled WHERE id = ?", autoId);
  return json({ ok: true });
}

export async function deleteAutomation(env, autoId) {
  await run(env.DB, "DELETE FROM automations WHERE id = ?", autoId);
  return json({ ok: true });
}

// ---------------------------------------------------------------- palette
export async function addPalette(env, request) {
  const db = env.DB;
  const data = await body(request);
  const kind = data.kind;
  const color = data.color ?? "#00859b";
  const pid = uid();
  const row = await first(
    db, "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM palette WHERE kind = ?", kind);
  const pos = row ? row.p : 0;
  await run(db, "INSERT INTO palette (id, kind, label, color, position) VALUES (?,?,?,?,?)",
    pid, kind, data.label, color, pos);
  return json({ id: pid, kind, label: data.label, color, position: pos });
}

/** Renaming a value rewrites it across every task cell of that kind's columns,
 *  so existing rows keep their tag instead of silently going blank. */
export async function updatePalette(env, request, pid) {
  const db = env.DB;
  const data = await body(request);
  const old = await first(db, "SELECT * FROM palette WHERE id = ?", pid);
  if (!old) return badRequest("not found", {}, 404);
  const newLabel = data.label ?? old.label;
  const newColor = data.color ?? old.color;

  const st = [db.prepare("UPDATE palette SET label = ?, color = ? WHERE id = ?")
    .bind(newLabel, newColor, pid)];
  if (newLabel !== old.label) {
    const kindCols = (await all(db, "SELECT id FROM columns WHERE type = ?", old.kind))
      .map((r) => r.id);
    if (kindCols.length) {
      for (const r of await all(db, "SELECT id, cells FROM tasks")) {
        const cells = parseJSON(r.cells);
        let touched = false;
        for (const cid of kindCols) {
          if (cells[cid] === old.label) { cells[cid] = newLabel; touched = true; }
        }
        if (touched) {
          st.push(db.prepare("UPDATE tasks SET cells = ? WHERE id = ?")
            .bind(JSON.stringify(cells), r.id));
        }
      }
    }
  }
  await batched(db, st);
  return json({ id: pid, label: newLabel, color: newColor });
}

export async function deletePalette(env, pid) {
  await run(env.DB, "DELETE FROM palette WHERE id = ?", pid);
  return json({ ok: true });
}

export async function reorderPalette(env, request) {
  const db = env.DB;
  const { order = [] } = await body(request);
  await batched(env.DB, order.map((pid, pos) =>
    db.prepare("UPDATE palette SET position = ? WHERE id = ?").bind(pos, pid)));
  return json({ ok: true });
}

// ---------------------------------------------------------------- restore
/** Replace the board with a provided full-state snapshot (the shape /api/state
 *  returns). Used by undo/redo.
 *
 *  The Flask version wrapped this in BEGIN/COMMIT. D1 has no interactive
 *  transactions, so it runs as a batch — atomic, except that a board too large
 *  for one batch is split into atomic chunks (see batched()). */
export async function restoreState(env, request) {
  const db = env.DB;
  const s = await body(request);

  // Stale-snapshot guard. A restore replaces the whole board, so it is only
  // safe when the caller has actually seen everything currently on it. The
  // browser sends the revision it last observed; if the board has moved since,
  // another device wrote and this snapshot predates that work.
  //
  // Refusing without a revision is deliberate: a page cached from before this
  // check shipped would otherwise keep silently overwriting. Losing undo until
  // a reload is a far smaller cost than losing the other device's edits.
  const current = await getRevision(db);
  const claimed = s.base_revision;
  if (claimed === undefined || claimed === null || Number.isNaN(Number(claimed))) {
    return json({
      ok: false, error: "stale_revision", current,
      message: "This page is running an older version of Tuned In. Reload it before undoing.",
    }, 409);
  }
  if (Number(claimed) !== current) {
    return json({
      ok: false, error: "stale_revision", claimed: Number(claimed), current,
      message: "The board changed on another device since this page loaded, " +
               "so undoing would overwrite that work. Reload to catch up.",
    }, 409);
  }

  try {
    const st = [];
    for (const tbl of ["columns", "tasks", "automations", "palette",
      "group_colors", "group_order", "settings"]) {
      st.push(db.prepare(`DELETE FROM ${tbl}`));
    }
    for (const c of s.columns || []) {
      st.push(db.prepare(
        "INSERT INTO columns (id, name, type, is_primary, position, width) VALUES (?,?,?,?,?,?)")
        .bind(c.id, c.name, c.type, c.is_primary ?? 0, c.position ?? 0, c.width ?? null));
    }
    for (const t of s.tasks || []) {
      st.push(db.prepare(
        "INSERT INTO tasks (id, group_name, cells, position, parent_id, link_id) VALUES (?,?,?,?,?,?)")
        .bind(t.id, t.group_name ?? "General", JSON.stringify(t.cells ?? {}),
          t.position ?? 0, t.parent_id ?? null, t.link_id ?? null));
    }
    for (const a of s.automations || []) {
      st.push(db.prepare(
        "INSERT INTO automations (id, enabled, name, trigger_col, trigger_val, action_col, action_type, action_val, position) " +
        "VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(a.id, a.enabled ?? 1, a.name ?? "", a.trigger_col, a.trigger_val ?? "",
          a.action_col, a.action_type ?? "setToday", a.action_val ?? "", a.position ?? 0));
    }
    for (const kind of ["status", "priority"]) {
      for (const p of (s.palette || {})[kind] || []) {
        st.push(db.prepare(
          "INSERT INTO palette (id, kind, label, color, position) VALUES (?,?,?,?,?)")
          .bind(p.id, kind, p.label, p.color, p.position ?? 0));
      }
    }
    for (const [name, color] of Object.entries(s.group_colors || {})) {
      st.push(db.prepare("INSERT INTO group_colors (group_name, color) VALUES (?,?)")
        .bind(name, color));
    }
    for (const [name, pos] of Object.entries(s.group_order || {})) {
      st.push(db.prepare("INSERT INTO group_order (group_name, position) VALUES (?,?)")
        .bind(name, pos));
    }
    for (const [k, v] of Object.entries(s.settings || {})) {
      st.push(db.prepare("INSERT INTO settings (key, value) VALUES (?,?)").bind(k, String(v)));
    }
    await batched(db, st);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e) }, 400);
  }
  return json({ ok: true });
}
