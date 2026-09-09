/* Tuned In — first-run seed.
   A port of the `if existing == 0` branch of init_db() in the legacy app.py,
   plus the small idempotent migrations that ran on every launch there.

   The Flask build did this at process start. A Worker has no process start, so
   it runs lazily: /api/state calls ensureSeeded() and it does nothing once the
   board has columns. */

import { all, batched, deleteTaskTree, first, uid, todayISO, DEFAULT_PALETTE } from "./lib.js";

const SEED_GROUPS = [
  "All Active Tasks", "Waiting for Feedback",
  "Someone Else' Court", "Holding Pattern / Pending",
  "Personal Tasks", "Networking", "Done",
];

// The two goal columns are what tie a task to the Goals system: "Goal" holds
// idea:<id> tags the user picks, and "Values" (historically "Pillar") is
// derived from those goals' sections. Both are detected by type + name
// elsewhere, never by id.
const SEED_COLUMNS = [
  ["c_name", "Task", "text", 1, 0],
  ["c_status", "Status", "status", 0, 1],
  ["c_owner", "Owner", "person", 0, 2],
  ["c_due", "Due Date", "date", 0, 3],
  ["c_priority", "Priority", "priority", 0, 4],
  ["c_hours", "Est. Hours", "number", 0, 5],
  ["c_pillar", "Values", "goal", 0, 6],
  ["c_goal", "Goal", "goal", 0, 7],
];

// Default automations — the same set enabled on the original board: Done parks
// in Done; active statuses copy into All Active Tasks; the waiting/parked
// statuses move the task to their groups.
const SEED_AUTOMATIONS = [
  ["When Done", "Done", "moveToGroup", "Done"],
  ["Active -> All Active", "Working On It", "copyToGroup", "All Active Tasks"],
  ["Someone else's court", "In Someone Else' Court", "moveToGroup", "Someone Else' Court"],
  ["New -> All Active", "Not Started", "copyToGroup", "All Active Tasks"],
  ["Holding pattern", "Holding Pattern", "moveToGroup", "Holding Pattern / Pending"],
  ["Waiting for feedback", "Waiting for Feedback", "moveToGroup", "Waiting for Feedback"],
];

// First-run demo board. Example tasks are deliberately generic — this seed
// ships to other people.
/** The rows to insert: the seeded tasks, plus the linked copies the seeded
 *  automations would have made.
 *
 *  Automations run when a status changes. Seeding writes statuses straight into
 *  the table, so nothing changes and nothing fires - which left a new board
 *  contradicting the rules printed in its own Automations panel. "New -> All
 *  Active" says every Not Started task belongs in All Active Tasks, yet "Book
 *  the dentist" sat in Personal Tasks alone, and the only way to make the rule
 *  take effect was to change the status to something else and back.
 *
 *  Deriving the copies from SEED_AUTOMATIONS rather than listing them by hand
 *  keeps one source of truth: edit an automation and the seeded board follows. */
function seedRows(today) {
  const copyTo = new Map();
  for (const [, trigger, action, dest] of SEED_AUTOMATIONS) {
    if (action === "copyToGroup" && dest) copyTo.set(trigger, dest);
  }
  const rows = [];
  for (const [group, cells] of seedTasks(today)) {
    const dest = copyTo.get(cells.c_status);
    if (!dest || dest === group) {
      rows.push({ group, cells, link_id: null });
      continue;
    }
    // Both placements share a link_id, exactly as copyToGroup would leave them,
    // so an edit to either one follows through to the other.
    const link = uid();
    rows.push({ group, cells, link_id: link });
    rows.push({ group: dest, cells, link_id: link });
  }
  return rows;
}

function seedTasks(today) {
  return [
    ["All Active Tasks", { c_name: "Draft the quarterly summary", c_status: "Working On It", c_owner: "Me", c_due: today, c_priority: "High", c_hours: 3 }],
    ["All Active Tasks", { c_name: "Pull last month's numbers", c_status: "Not Started", c_owner: "Me", c_due: "", c_priority: "Medium", c_hours: 2 }],
    ["All Active Tasks", { c_name: "Try changing a Status — watch the task move groups", c_status: "Not Started", c_owner: "Me", c_due: "", c_priority: "Low", c_hours: 0.25 }],
    ["Waiting for Feedback", { c_name: "Proposal sent — waiting on comments", c_status: "Waiting for Feedback", c_owner: "Me", c_due: "", c_priority: "Medium", c_hours: 1 }],
    ["Someone Else' Court", { c_name: "Vendor quote — with procurement", c_status: "In Someone Else' Court", c_owner: "Me", c_due: "", c_priority: "Medium", c_hours: 1 }],
    ["Holding Pattern / Pending", { c_name: "Office move logistics — parked until Q3", c_status: "Holding Pattern", c_owner: "Me", c_due: "", c_priority: "Low", c_hours: 4 }],
    ["Personal Tasks", { c_name: "Book the dentist", c_status: "Not Started", c_owner: "Me", c_due: "", c_priority: "Low", c_hours: 0.5 }],
    ["Networking", { c_name: "Coffee with a former colleague", c_status: "Not Started", c_owner: "Me", c_due: "", c_priority: "Medium", c_hours: 1 }],
  ];
}

// Columns for the "Room for Improvements" board.
const SEED_IMP_COLUMNS = [
  ["ic_weak", "Weakness", "text", 1, 0],
  ["ic_why", "Why It Matters", "text", 0, 1],
  ["ic_path", "Path to Improve", "text", 0, 2],
  ["ic_status", "Status", "status", 0, 3],
  ["ic_target", "Target Date", "date", 0, 4],
  ["ic_pri", "Priority", "priority", 0, 5],
];

/** Seed an empty database and run the every-launch repairs. Cheap and
 *  idempotent: on an already-populated board it issues one small UPDATE and
 *  two counting queries. */
export async function ensureSeeded(env) {
  const db = env.DB;
  const today = todayISO(env);

  const colCount = await first(db, "SELECT COUNT(*) AS n FROM columns");
  if (!colCount || colCount.n === 0) {
    const st = [];
    for (const [id, name, type, isPrimary, pos] of SEED_COLUMNS) {
      st.push(db.prepare(
        "INSERT INTO columns (id, name, type, is_primary, position) VALUES (?,?,?,?,?)")
        .bind(id, name, type, isPrimary, pos));
    }
    SEED_GROUPS.forEach((grp, pos) => {
      st.push(db.prepare(
        "INSERT OR IGNORE INTO group_order (group_name, position) VALUES (?,?)").bind(grp, pos));
    });
    seedRows(today).forEach((row, i) => {
      st.push(db.prepare(
        "INSERT INTO tasks (id, group_name, cells, position, link_id) VALUES (?,?,?,?,?)")
        .bind(uid(), row.group, JSON.stringify(row.cells), i, row.link_id));
    });
    SEED_AUTOMATIONS.forEach(([name, trig, action, dest], pos) => {
      st.push(db.prepare(
        `INSERT INTO automations
           (id, enabled, name, trigger_col, trigger_val, action_col, action_type, action_val, position)
         VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(uid(), 1, name, "c_status", trig, "c_due", action, dest, pos));
    });
    for (const [kind, entries] of Object.entries(DEFAULT_PALETTE)) {
      entries.forEach(([label, color], pos) => {
        st.push(db.prepare(
          "INSERT INTO palette (id, kind, label, color, position) VALUES (?,?,?,?,?)")
          .bind(uid(), kind, label, color, pos));
      });
    }
    await batched(db, st);
  }

  // Migration: the app is now called Tuned In. The banner title is user data,
  // so only the untouched default is renamed — a custom title is left alone.
  // Guarded by a flag, as in init_db, so a user who renames it back to "Radio
  // Station" isn't overridden on the next request.
  const renamed = await first(db, "SELECT 1 AS x FROM settings WHERE key = 'tunedin_rename'");
  if (!renamed) {
    await batched(db, [
      db.prepare("UPDATE settings SET value = 'Tuned In' WHERE key = 'hdr_title_text' AND value = 'Radio Station'"),
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tunedin_rename', 'v1')"),
    ]);
  }

  // Migration: the Pillar column is displayed as "Values". Display-only — the
  // `pillar:` tag prefix stored in task cells is untouched, and the frontend
  // finds the column by type + either name. (Ported from init_db; harmless to
  // repeat, so it runs unguarded rather than costing a settings lookup.)
  await db.prepare(
    "UPDATE columns SET name = 'Values' WHERE type = 'goal' AND lower(name) = 'pillar'").run();

  // Win / Loss check columns for closing out goals. Detected by type + name,
  // appended after existing columns, no rows touched.
  const checks = await all(db, "SELECT name FROM columns WHERE type = 'check'");
  const have = new Set(checks.map((r) => String(r.name).trim().toLowerCase()));
  if (!have.has("win") || !have.has("loss")) {
    const row = await first(db, "SELECT COALESCE(MAX(position), 0) AS p FROM columns");
    let pos = row ? row.p : 0;
    const st = [];
    if (!have.has("win")) {
      st.push(db.prepare("INSERT INTO columns (id, name, type, is_primary, position) VALUES (?,?,?,0,?)")
        .bind("c_win_" + uid(), "Win", "check", ++pos));
    }
    if (!have.has("loss")) {
      st.push(db.prepare("INSERT INTO columns (id, name, type, is_primary, position) VALUES (?,?,?,0,?)")
        .bind("c_loss_" + uid(), "Loss", "check", ++pos));
    }
    await batched(db, st);
  }

  // Rescue cleanup: earlier frontend code could in rare cases write a corrupted
  // group_name (empty string, the literal text "undefined", or "null"). Sweep
  // those into a visible recovery group so they can be found and fixed.
  await db.prepare(
    `UPDATE tasks SET group_name = 'Recovered (was unnamed)'
      WHERE group_name IS NULL OR group_name IN ('', 'undefined', 'null')`).run();

  // Rescue: collapse linked-duplicate placements within a group. If a task
  // shows up more than once in the same group via the same link_id, keep one
  // and remove the extras (and their subtasks). Self-heals databases that
  // accumulated duplicates before the dedup fix.
  const dupes = await all(
    db,
    `SELECT link_id, group_name, GROUP_CONCAT(id) AS ids, COUNT(*) AS n
       FROM tasks
      WHERE parent_id IS NULL AND link_id IS NOT NULL
      GROUP BY link_id, group_name HAVING n > 1`);
  for (const r of dupes) {
    const ids = String(r.ids).split(",");
    for (const extra of ids.slice(1)) await deleteTaskTree(db, extra); // keep the first
  }

  // Seed the Improvements board's columns on first run.
  const impCount = await first(db, "SELECT COUNT(*) AS n FROM imp_columns");
  if (!impCount || impCount.n === 0) {
    await batched(db, SEED_IMP_COLUMNS.map(([id, name, type, isPrimary, pos]) =>
      db.prepare(
        "INSERT INTO imp_columns (id, name, type, is_primary, position, width) VALUES (?,?,?,?,?,?)")
        .bind(id, name, type, isPrimary, pos, type === "text" ? 240 : null)));
  }
}
