/* Tuned In — shared Worker helpers.
   Small utilities every route module needs: responses, ids, "today" in the
   configured timezone, and the D1 patterns that replace sqlite3's cursor API. */

export const SERVER_BUILD = "2026-08-21-A"; // must equal EXPECTED_SERVER_BUILD in public/static/app.js

export const COLUMN_TYPES = ["text", "status", "person", "date", "number", "priority", "goal", "check"];

// Reserved cell key (not a visible column) recording the day a task was marked
// Done. Set when a status column reads "Done"; cleared when it stops.
export const DONE_DATE_KEY = "__done_date";
export const TIME_SPENT = "__time_spent";
export const TIME_STARTED = "__time_started";

// Defaults used only to seed the palette on first run.
export const DEFAULT_PALETTE = {
  status: [
    ["Working On It", "#00bfb8"],
    ["Not Started", "#b3b3b3"],
    ["Waiting for Feedback", "#0052bd"],
    ["In Someone Else' Court", "#8a00bd"],
    ["Holding Pattern", "#e2725b"],
    ["Done", "#38a66f"],
  ],
  priority: [
    ["Critical", "#7a1f1f"],
    ["High", "#e2725b"],
    ["Medium", "#00859b"],
    ["Low", "#bce194"],
  ],
};

// ---------------------------------------------------------------- responses
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Single-user app served from the edge: never let a proxy or the browser
      // cache an API response, the way the Flask build set SEND_FILE_MAX_AGE 0.
      "Cache-Control": "no-store",
    },
  });
}

export function badRequest(error, extra = {}, status = 400) {
  return json({ ok: false, error, ...extra }, status);
}

// ---------------------------------------------------------------- ids
/** Same shape as app.py's `os.urandom(5).hex()` — 10 hex characters. */
export function uid() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ---------------------------------------------------------------- clock
// Workers run in UTC. The Flask build used the machine's local clock for
// `date.today()` (the Done stamp, the setToday automation, the default
// schedule day) and for the UTC->local conversion when importing an .ics.
// TZ (a wrangler var) restores that: set it to your IANA zone, e.g.
// "America/Chicago". Unset means UTC, which is what a bare Worker would do.
export function tzOf(env) {
  return (env && env.TZ) || "UTC";
}

/** 'YYYY-MM-DD' for right now in the configured zone. */
export function todayISO(env, at = new Date()) {
  return ymdInTz(at, tzOf(env));
}

/** 'YYYY-MM-DD' for a Date in a given IANA zone. */
export function ymdInTz(date, tz) {
  // en-CA formats as YYYY-MM-DD, which is exactly what we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** 'HH:MM' for a Date in a given IANA zone. */
export function hmInTz(date, tz) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

/** Naive local ISO timestamp, matching Python's `datetime.now().isoformat()`.
 *  Stored in projects.created, prompts.updated, redemptions.ts and
 *  setting_history.saved_at, and compared against itself for the history
 *  throttle — so the only requirement is that it stays self-consistent. */
export function nowISO(env, { seconds = false } = {}) {
  const d = new Date();
  const tz = tzOf(env);
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
  const base = `${ymdInTz(d, tz)}T${t}`;
  if (seconds) return base;
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}000`;
}

/** Parse a naive ISO timestamp produced by nowISO back into epoch ms. Returns
 *  NaN when it can't, so callers can fall through the way the Python did. */
export function parseNaiveISO(s) {
  if (!s) return NaN;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

// ---------------------------------------------------------------- D1 helpers
export async function all(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

export async function first(db, sql, ...params) {
  return await db.prepare(sql).bind(...params).first();
}

export async function run(db, sql, ...params) {
  return await db.prepare(sql).bind(...params).run();
}

/** COALESCE(MAX(position), 0) + 1 — the "next position" idiom used all over app.py. */
export async function nextPos(db, table, where = "", ...params) {
  const row = await first(
    db, `SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} ${where}`, ...params);
  return row ? row.p : 1;
}

/** Same, but starting at 0 (group_order and palette count from zero). */
export async function nextPosZero(db, table, where = "", ...params) {
  const row = await first(
    db, `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} ${where}`, ...params);
  return row ? row.p : 0;
}

/** Run statements as one atomic D1 batch, in chunks.
 *
 *  D1 has no interactive transactions, so the `BEGIN ... COMMIT` blocks in
 *  app.py become batches. A batch is atomic, but a very large one exceeds the
 *  request limit, so oversized work is split — meaning a restore of a huge
 *  board is atomic per chunk rather than as a whole. Everything except
 *  /api/restore fits in a single chunk. */
export async function batched(db, statements, size = 100) {
  const out = [];
  for (let i = 0; i < statements.length; i += size) {
    const slice = statements.slice(i, i + size);
    if (slice.length) out.push(...(await db.batch(slice)));
  }
  return out;
}

// ---------------------------------------------------------------- board revision
// Guards whole-board restores against a stale client. See
// migrations/0002_board_revision.sql for why this exists.

/** The board's current revision. */
export async function getRevision(db) {
  const row = await first(db, "SELECT revision FROM board_meta WHERE id = 1");
  return row ? row.revision : 0;
}

/** Increment the revision and return the new value. */
export async function bumpRevision(db) {
  const row = await first(
    db,
    "INSERT INTO board_meta (id, revision) VALUES (1, 1) " +
    "ON CONFLICT(id) DO UPDATE SET revision = revision + 1 " +
    "RETURNING revision");
  return row ? row.revision : 0;
}

/** Parse a task/prompt JSON text column, tolerating anything unparseable the
 *  way the Python `try/except` did. */
export function parseJSON(text, fallback = {}) {
  if (!text) return fallback;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Read a JSON request body, tolerating an empty one (Flask's force=True). */
export async function body(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Build a `?,?,?` placeholder list for an IN clause. */
export function placeholders(n) {
  return new Array(n).fill("?").join(",");
}

// ---------------------------------------------------------------- task trees
/** All descendant task ids of a task. Subtasks nest, so cascades walk the
 *  whole subtree (port of _descendant_ids). */
export async function descendantIds(db, taskId) {
  const out = [];
  let frontier = [taskId];
  let guard = 0;
  while (frontier.length && guard++ < 64) {
    const rows = await all(
      db, `SELECT id FROM tasks WHERE parent_id IN (${placeholders(frontier.length)})`, ...frontier);
    frontier = rows.map((r) => r.id);
    out.push(...frontier);
  }
  return out;
}

/** Delete a task and its entire subtree (port of _delete_task_tree). */
export async function deleteTaskTree(db, taskId) {
  const ids = [taskId, ...(await descendantIds(db, taskId))];
  await run(db, `DELETE FROM tasks WHERE id IN (${placeholders(ids.length)})`, ...ids);
  return ids.length;
}

/** Set or clear the completion-date stamp based on whether any status column
 *  reads "Done" (port of _stamp_done). Mutates and returns `cells`. */
export function stampDone(cells, columns, today) {
  const isDone = columns.some(
    (c) => c.type === "status" && String(cells[c.id] ?? "") === "Done");
  if (isDone) {
    if (!cells[DONE_DATE_KEY]) cells[DONE_DATE_KEY] = today;
  } else {
    delete cells[DONE_DATE_KEY];
  }
  return cells;
}

// ---------------------------------------------------------------- automations
/** Mutate and return { cells, group_name } per the enabled rules.
 *  Direct port of apply_automations. */
export function applyAutomations(task, automations, today) {
  const cells = task.cells;
  let group = task.group_name;
  for (const a of automations) {
    if (!a.enabled) continue;
    if (String(cells[a.trigger_col] ?? "") !== String(a.trigger_val)) continue;
    switch (a.action_type) {
      case "setToday": cells[a.action_col] = today; break;
      case "setValue": cells[a.action_col] = a.action_val; break;
      case "clear": cells[a.action_col] = ""; break;
      case "moveToGroup": if (a.action_val) group = a.action_val; break;
    }
  }
  return { cells, group_name: group };
}

export async function fetchAutomations(db) {
  return await all(db, "SELECT * FROM automations ORDER BY position");
}

/** The id of the number column named "Points", if any (port of _points_col_id). */
export function pointsColId(columns) {
  for (const c of columns) {
    if (c.type === "number" && String(c.name).trim().toLowerCase() === "points") return c.id;
  }
  return null;
}

/** Points earned = sum of the Points cell over every task whose status is
 *  "Done". Balance = earned − redeemed (port of _compute_points). */
export function computePoints(columns, tasks, redemptions) {
  const pcol = pointsColId(columns);
  const statusIds = columns.filter((c) => c.type === "status").map((c) => c.id);
  let earned = 0;
  if (pcol) {
    for (const t of tasks) {
      const cells = t.cells;
      if (!statusIds.some((sid) => String(cells[sid] ?? "") === "Done")) continue;
      const n = parseFloat(cells[pcol]);
      if (Number.isFinite(n)) earned += Math.trunc(n);
    }
  }
  const redeemed = redemptions.reduce((s, r) => s + (parseInt(r.cost, 10) || 0), 0);
  return { earned, redeemed, balance: earned - redeemed, points_col: pcol };
}

/** The primary column's id, falling back to the first column (_primary_col_id). */
export async function primaryColId(db) {
  const row = await first(db, "SELECT id FROM columns WHERE is_primary = 1 LIMIT 1");
  if (row) return row.id;
  const any = await first(db, "SELECT id FROM columns ORDER BY position LIMIT 1");
  return any ? any.id : null;
}
