/* Tuned In — first-run seed.
   A port of the `if existing == 0` branch of init_db() in the legacy app.py,
   plus the small idempotent migrations that ran on every launch there.

   The Flask build did this at process start. A Worker has no process start, so
   it runs lazily: /api/state calls ensureSeeded() and it does nothing once the
   board has columns. */

import { all, batched, deleteTaskTree, first, uid, todayISO, DEFAULT_PALETTE } from "./lib.js";
import { demoGoalsBlob, demoTasks, DEMO_TODAY_BLOCKS } from "./demo.js";

const SEED_GROUPS = [
  "All Active Tasks", "Waiting for Feedback",
  "Someone Else' Court", "Holding Pattern / Pending",
  "Personal Tasks", "Networking", "Done",
];
// The coaching demo files its tasks by life area instead.
const DEMO_GROUPS = [
  "All Active Tasks", "Waiting for Feedback",
  "Someone Else' Court", "Holding Pattern / Pending",
  "Health & Home", "Career & Money", "Relationships", "Side Venture", "Done",
];

/** Whether this deployment seeds the coaching demo (src/demo.js) rather than
 *  the plain starter board. Only the demo deployment turns it on: the Worker
 *  through the DEMO_SEED var in wrangler.jsonc, the local-first build through
 *  its profile. A real board must never open on an invented person's life. */
export function wantsDemoSeed(env) {
  return String((env && env.DEMO_SEED) || "").trim().toLowerCase() === "coach";
}

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

// The plain starter board. Example tasks are deliberately generic — this seed
// ships to other people. [group, cells, subtasks].
function starterTasks(today) {
  const t = (group, c_name, c_status, c_due, c_priority, c_hours) =>
    [group, { c_name, c_status, c_owner: "Me", c_due, c_priority, c_hours }, []];
  return [
    t("All Active Tasks", "Draft the quarterly summary", "Working On It", today, "High", 3),
    t("All Active Tasks", "Pull last month's numbers", "Not Started", "", "Medium", 2),
    t("All Active Tasks", "Try changing a Status — watch the task move groups", "Not Started", "", "Low", 0.25),
    t("Waiting for Feedback", "Proposal sent — waiting on comments", "Waiting for Feedback", "", "Medium", 1),
    t("Someone Else' Court", "Vendor quote — with procurement", "In Someone Else' Court", "", "Medium", 1),
    t("Holding Pattern / Pending", "Office move logistics — parked until Q3", "Holding Pattern", "", "Low", 4),
    t("Personal Tasks", "Book the dentist", "Not Started", "", "Low", 0.5),
    t("Networking", "Coffee with a former colleague", "Not Started", "", "Medium", 1),
  ];
}

/** The rows to insert: the seeded tasks, plus the linked copies the seeded
 *  automations would have made, plus each task's subtasks.
 *
 *  Automations run when a status changes. Seeding writes statuses straight into
 *  the table, so nothing changes and nothing fires - which left a new board
 *  contradicting the rules printed in its own Automations panel. "New -> All
 *  Active" says every Not Started task belongs in All Active Tasks, yet a
 *  seeded task could sit in its own group alone, and the only way to make the
 *  rule take effect was to change the status to something else and back.
 *
 *  Deriving the copies from SEED_AUTOMATIONS rather than listing them by hand
 *  keeps one source of truth: edit an automation and the seeded board follows. */
function seedRows(today, demo) {
  const copyTo = new Map();
  for (const [, trigger, action, dest] of SEED_AUTOMATIONS) {
    if (action === "copyToGroup" && dest) copyTo.set(trigger, dest);
  }
  const rows = [];
  for (const [group, cells, subs = []] of (demo ? demoTasks(today) : starterTasks(today))) {
    const id = uid();
    const dest = copyTo.get(cells.c_status);
    if (!dest || dest === group) {
      rows.push({ id, group, cells, link_id: null, parent_id: null });
    } else {
      // Both placements share a link_id, exactly as copyToGroup would leave
      // them, so an edit to either one follows through to the other.
      const link = uid();
      rows.push({ id, group, cells, link_id: link, parent_id: null });
      rows.push({ id: uid(), group: dest, cells, link_id: link, parent_id: null });
    }
    // Subtasks hang off the first placement and share its group.
    for (const sub of subs) rows.push({ id: uid(), group, cells: sub, link_id: null, parent_id: id });
  }
  return rows;
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

/** The demo's goals and first-day schedule, as statements. */
function demoExtras(db, today, rows) {
  const st = [];
  // Values and goals for the Goals view. OR IGNORE: a board imported before
  // its first request keeps its own goals.
  st.push(db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('goals_os', ?)")
    .bind(JSON.stringify(demoGoalsBlob(today))));
  // A planned first day, so Today opens on a schedule rather than a blank page.
  const byName = new Map(rows.filter((r) => !r.parent_id).map((r) => [r.cells.c_name, r.id]));
  for (const [start, minutes, label, taskName, color] of DEMO_TODAY_BLOCKS) {
    st.push(db.prepare(
      "INSERT INTO schedule_blocks (id, day, start, minutes, task_id, label, color) VALUES (?,?,?,?,?,?,?)")
      .bind("sb_" + uid(), today, start, minutes, taskName ? byName.get(taskName) ?? null : null,
            label || taskName, color));
  }
  return st;
}

/** Seed an empty database and run the every-launch repairs. Cheap and
 *  idempotent: on an already-populated board it issues one small UPDATE and
 *  two counting queries. */
export async function ensureSeeded(env) {
  const db = env.DB;
  const today = todayISO(env);
  const demo = wantsDemoSeed(env);

  const colCount = await first(db, "SELECT COUNT(*) AS n FROM columns");
  if (!colCount || colCount.n === 0) {
    const st = [];
    for (const [id, name, type, isPrimary, pos] of SEED_COLUMNS) {
      st.push(db.prepare(
        "INSERT INTO columns (id, name, type, is_primary, position) VALUES (?,?,?,?,?)")
        .bind(id, name, type, isPrimary, pos));
    }
    (demo ? DEMO_GROUPS : SEED_GROUPS).forEach((grp, pos) => {
      st.push(db.prepare(
        "INSERT OR IGNORE INTO group_order (group_name, position) VALUES (?,?)").bind(grp, pos));
    });
    const rows = seedRows(today, demo);
    rows.forEach((row, i) => {
      st.push(db.prepare(
        "INSERT INTO tasks (id, group_name, cells, position, link_id, parent_id) VALUES (?,?,?,?,?,?)")
        .bind(row.id, row.group, JSON.stringify(row.cells), i, row.link_id, row.parent_id));
    });
    if (demo) st.push(...demoExtras(db, today, rows));
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

  // No Win / Loss columns. They used to be created here, and re-created on every
  // request whenever they were missing - which also meant deleting them in the
  // app did not stick, because the next page load put them back.
  //
  // Check columns themselves still work: add one called "Loss" and the outcome
  // handling in public/static/board.js picks it up by type and name, exactly as
  // before. This only stops the app deciding for you that you wanted them.

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
