/* Tuned In — the rest of the API: rewards, the Improvements board, Prompt
   Studio, Vibe Coding projects, settings (with write history), and the image
   uploads that used to be files on disk. */

import {
  all, badRequest, batched, body, computePoints, deleteTaskTree, first, json,
  nextPos, nowISO, parseJSON, parseNaiveISO, run, uid, COLUMN_TYPES,
} from "./lib.js";

// ---------------------------------------------------------------- rewards
export async function addReward(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = (data.name || "").trim();
  if (!name) return badRequest("name required");
  const n = parseFloat(data.cost);
  const cost = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  const rid = "r_" + uid();
  const pos = await nextPos(db, "rewards");
  await run(db, "INSERT INTO rewards (id, name, cost, position) VALUES (?,?,?,?)", rid, name, cost, pos);
  return json({ id: rid, name, cost, position: pos });
}

export async function updateReward(env, request, rid) {
  const db = env.DB;
  const data = await body(request);
  const st = [];
  if ("name" in data) {
    const nm = (data.name || "").trim();
    if (nm) st.push(db.prepare("UPDATE rewards SET name = ? WHERE id = ?").bind(nm, rid));
  }
  if ("cost" in data) {
    const n = parseFloat(data.cost);
    if (Number.isFinite(n)) {
      st.push(db.prepare("UPDATE rewards SET cost = ? WHERE id = ?")
        .bind(Math.max(0, Math.trunc(n)), rid));
    }
  }
  await batched(db, st);
  return json({ ok: true });
}

export async function deleteReward(env, rid) {
  await run(env.DB, "DELETE FROM rewards WHERE id = ?", rid);
  return json({ ok: true });
}

/** Logs a redemption (deducting its cost from the balance) only if the current
 *  balance can afford it. The balance is recomputed from state so it can't drift. */
export async function redeemReward(env, rid) {
  const db = env.DB;
  const reward = await first(db, "SELECT * FROM rewards WHERE id = ?", rid);
  if (!reward) return badRequest("not found", {}, 404);

  const columns = await all(db, "SELECT * FROM columns");
  const tasks = (await all(db, "SELECT * FROM tasks")).map((r) => ({ ...r, cells: parseJSON(r.cells) }));
  const redemptions = await all(db, "SELECT * FROM redemptions");
  const pts = computePoints(columns, tasks, redemptions);
  if (pts.balance < reward.cost) {
    return json({ error: "not enough points", balance: pts.balance }, 400);
  }
  await run(db, "INSERT INTO redemptions (id, reward_id, name, cost, ts) VALUES (?,?,?,?,?)",
    "rd_" + uid(), rid, reward.name, reward.cost, nowISO(env));
  return json({ ok: true });
}

/** Undo a redemption (refunds its points to the balance). */
export async function deleteRedemption(env, rdid) {
  await run(env.DB, "DELETE FROM redemptions WHERE id = ?", rdid);
  return json({ ok: true });
}

// ---------------------------------------------------------------- Improvements board
export async function impAddTask(env, request) {
  const db = env.DB;
  const data = await body(request);
  const group = (data.group || "Current Weaknesses").trim() || "Current Weaknesses";
  const primary = await first(db, "SELECT id FROM imp_columns WHERE is_primary = 1");
  const cells = {};
  if (primary) cells[primary.id] = (data.name || "New weakness").trim() || "New weakness";
  const tid = "i_" + uid();
  const pos = await nextPos(db, "imp_tasks");
  await run(db, "INSERT INTO imp_tasks (id, group_name, cells, position) VALUES (?,?,?,?)",
    tid, group, JSON.stringify(cells), pos);
  return json({ id: tid, group_name: group, cells, position: pos });
}

export async function impUpdateCell(env, request, tid) {
  const db = env.DB;
  const data = await body(request);
  const colId = data.col;
  const value = data.value ?? "";
  const row = await first(db, "SELECT cells FROM imp_tasks WHERE id = ?", tid);
  if (!row) return badRequest("not found", {}, 404);
  const cells = parseJSON(row.cells);
  if (value === "" || value === null) delete cells[colId];
  else cells[colId] = value;
  await run(db, "UPDATE imp_tasks SET cells = ? WHERE id = ?", JSON.stringify(cells), tid);
  return json({ ok: true, cells });
}

export async function impDeleteTask(env, tid) {
  await run(env.DB, "DELETE FROM imp_tasks WHERE id = ?", tid);
  return json({ ok: true });
}

export async function impAddColumn(env, request) {
  const db = env.DB;
  const data = await body(request);
  const name = (data.name || "New Column").trim() || "New Column";
  const type = COLUMN_TYPES.includes(data.type) ? data.type : "text";
  const cid = "ic_" + uid();
  const pos = await nextPos(db, "imp_columns");
  await run(db,
    "INSERT INTO imp_columns (id, name, type, is_primary, position, width) VALUES (?,?,?,0,?,?)",
    cid, name, type, pos, type === "text" ? 240 : null);
  return json({ id: cid, name, type, is_primary: 0, position: pos });
}

export async function impUpdateColumn(env, request, cid) {
  const db = env.DB;
  const data = await body(request);
  const st = [];
  if ("name" in data) {
    st.push(db.prepare("UPDATE imp_columns SET name = ? WHERE id = ?")
      .bind((data.name || "").trim() || "Column", cid));
  }
  if ("width" in data) {
    st.push(db.prepare("UPDATE imp_columns SET width = ? WHERE id = ?").bind(data.width ?? null, cid));
  }
  await batched(db, st);
  return json({ ok: true });
}

export async function impDeleteColumn(env, cid) {
  const db = env.DB;
  const row = await first(db, "SELECT is_primary FROM imp_columns WHERE id = ?", cid);
  if (row && row.is_primary) return badRequest("cannot delete primary column");
  const st = [db.prepare("DELETE FROM imp_columns WHERE id = ?").bind(cid)];
  // Strip the column's value from every row.
  for (const r of await all(db, "SELECT id, cells FROM imp_tasks")) {
    const cells = parseJSON(r.cells);
    if (!(cid in cells)) continue;
    delete cells[cid];
    st.push(db.prepare("UPDATE imp_tasks SET cells = ? WHERE id = ?")
      .bind(JSON.stringify(cells), r.id));
  }
  await batched(db, st);
  return json({ ok: true });
}

export async function impRenameGroup(env, request) {
  const data = await body(request);
  const oldName = data.old;
  const newName = (data.new || "").trim();
  if (!oldName || !newName) return badRequest("bad request");
  await run(env.DB, "UPDATE imp_tasks SET group_name = ? WHERE group_name = ?", newName, oldName);
  return json({ ok: true });
}

// ---------------------------------------------------------------- Prompt Studio
export async function addPrompt(env, request) {
  const db = env.DB;
  const data = await body(request);
  const pid = "pr_" + uid();
  const now = nowISO(env);
  const title = (data.title || "Untitled prompt").trim() || "Untitled prompt";
  const category = data.category || "general";
  const fields = data.fields || {};
  const pos = await nextPos(db, "prompts");
  await run(db,
    "INSERT INTO prompts (id, title, category, fields, position, created, updated) VALUES (?,?,?,?,?,?,?)",
    pid, title, category, JSON.stringify(fields), pos, now, now);
  return json({ id: pid, title, category, fields, position: pos, created: now, updated: now });
}

export async function updatePrompt(env, request, pid) {
  const db = env.DB;
  const data = await body(request);
  const st = [];
  if ("title" in data) {
    st.push(db.prepare("UPDATE prompts SET title = ? WHERE id = ?")
      .bind((data.title || "Untitled prompt").trim() || "Untitled prompt", pid));
  }
  if ("category" in data) {
    st.push(db.prepare("UPDATE prompts SET category = ? WHERE id = ?")
      .bind(data.category || "general", pid));
  }
  if ("fields" in data) {
    st.push(db.prepare("UPDATE prompts SET fields = ? WHERE id = ?")
      .bind(JSON.stringify(data.fields || {}), pid));
  }
  if ("priority" in data) {
    st.push(db.prepare("UPDATE prompts SET priority = ? WHERE id = ?").bind(data.priority || null, pid));
  }
  st.push(db.prepare("UPDATE prompts SET updated = ? WHERE id = ?").bind(nowISO(env), pid));
  await batched(db, st);
  return json({ ok: true });
}

export async function deletePrompt(env, pid) {
  await run(env.DB, "DELETE FROM prompts WHERE id = ?", pid);
  return json({ ok: true });
}

// ---------------------------------------------------------------- Vibe Coding projects
export async function addProject(env, request) {
  const db = env.DB;
  const data = await body(request);
  const title = (data.title || "New project").trim() || "New project";
  const pid = "p_" + uid();
  const pos = await nextPos(db, "projects");
  await run(db,
    "INSERT INTO projects (id, title, description, stage, tags, position, created) VALUES (?,?,?,?,?,?,?)",
    pid, title, "", data.stage || "idea", data.tags || "", pos, nowISO(env));
  return json(await first(db, "SELECT * FROM projects WHERE id = ?", pid));
}

export async function updateProject(env, request, pid) {
  const db = env.DB;
  const data = await body(request);
  const st = [];
  for (const field of ["title", "description", "stage", "tags", "plan", "priority"]) {
    if (!(field in data)) continue;
    let val = data[field];
    if (field === "title") val = (val || "").trim() || "Untitled";
    st.push(db.prepare(`UPDATE projects SET ${field} = ? WHERE id = ?`)
      .bind(val === null || val === undefined ? "" : val, pid));
  }
  await batched(db, st);
  return json({ ok: true });
}

export async function deleteProject(env, pid) {
  await run(env.DB, "DELETE FROM projects WHERE id = ?", pid);
  return json({ ok: true });
}

/** Toggle a project on/off the to-do list. On → creates a task in
 *  'All Active Tasks' (title = project title, description → Notes, tags → the
 *  Values/Goal columns) and links it via projects.task_id. Off → deletes that
 *  task (and any linked copies). */
export async function projectToggleTodo(env, pid) {
  const db = env.DB;
  const proj = await first(db, "SELECT * FROM projects WHERE id = ?", pid);
  if (!proj) return badRequest("not found", {}, 404);

  // If already on the board, remove it (the task + any linked copies + subtrees).
  if (proj.task_id) {
    const trow = await first(db, "SELECT * FROM tasks WHERE id = ?", proj.task_id);
    if (trow) {
      let targets = [proj.task_id];
      if (trow.link_id) {
        targets = (await all(db, "SELECT id FROM tasks WHERE link_id = ?", trow.link_id)).map((r) => r.id);
      }
      for (const tid of targets) await deleteTaskTree(db, tid);
    }
    await run(db, "UPDATE projects SET task_id = NULL WHERE id = ?", pid);
    return json({ on: false });
  }

  const columns = await all(db, "SELECT * FROM columns");
  const primary = columns.find((c) => c.is_primary);
  const notesCol = columns.find((c) => String(c.name).trim().toLowerCase() === "notes");
  const goalCols = columns.filter((c) => c.type === "goal");
  // The Values column is historically named "Pillar"; both names are matched.
  const isValuesCol = (c) => /pillar|values/.test(String(c.name).toLowerCase());
  const pillarCol = goalCols.find(isValuesCol);
  const ideaCol = goalCols.find((c) => !isValuesCol(c));

  const cells = {};
  if (primary) cells[primary.id] = proj.title;
  if (notesCol && proj.description) cells[notesCol.id] = proj.description;

  const tags = String(proj.tags || "").split("|").filter(Boolean);
  const pillarTags = tags.filter((t) => t.startsWith("pillar:"));
  const ideaTags = tags.filter((t) => t.startsWith("idea:"));
  if (goalCols.length) {
    if (pillarCol && ideaCol) {
      if (pillarTags.length) cells[pillarCol.id] = pillarTags.join("|");
      if (ideaTags.length) cells[ideaCol.id] = ideaTags.join("|");
    } else if (tags.length) {
      // Single/unnamed goal column → put everything there.
      cells[goalCols[0].id] = tags.join("|");
    }
  }

  const tid = uid();
  const pos = await nextPos(db, "tasks");
  await batched(db, [
    db.prepare("INSERT INTO tasks (id, group_name, cells, position) VALUES (?,?,?,?)")
      .bind(tid, "All Active Tasks", JSON.stringify(cells), pos),
    db.prepare("UPDATE projects SET task_id = ? WHERE id = ?").bind(tid, pid),
  ]);
  return json({ on: true, task_id: tid });
}

// ---------------------------------------------------------------- settings
// The qualitative side of the app lives in JSON blobs under settings: goals,
// notebook, PARA, skill lab, ideas. They're autosaved, they grow for years, and
// a single bad write would otherwise be unrecoverable short of a whole-database
// restore. These constants govern how that's protected.
const SETTING_VERSIONED_KEYS = new Set([
  "goals_os",     // goals, sections, identity, diagnosis, evidence ledger
  "notebook",     // freeform notes
  "para_os",      // projects / areas / resources / archives
  "sb_state",     // skill lab: categories, resources, TIL, streak
  "ideas_lab",    // ideas + brainstorm logs
  "career_notes",
]);
// Anything this large gets versioned too, so a future blob is protected the day
// it starts holding real content rather than the day someone remembers to list it.
const SETTING_VERSION_MIN_BYTES = 512;
const SETTING_HISTORY_KEEP = 20;        // versions retained per key
const SETTING_HISTORY_THROTTLE_MIN = 60; // at most one version per key per hour
const SETTING_GUARD_MIN_BYTES = 2048;   // only guard blobs with real content
const SETTING_GUARD_RATIO = 0.5;        // refuse a write below half the stored size

function isVersionedSetting(key, oldVal, newVal) {
  if (SETTING_VERSIONED_KEYS.has(key)) return true;
  if (oldVal && oldVal.length >= SETTING_VERSION_MIN_BYTES) return true;
  return !!newVal && newVal.length >= SETTING_VERSION_MIN_BYTES;
}

/** Push `value` onto this key's history, then prune to the newest N.
 *
 *  Two things keep the 20 slots meaningful rather than filled by one editing
 *  session: identical consecutive values are skipped, and versions are
 *  throttled to one per hour per key unless forced. Twenty hourly snapshots
 *  span weeks of real use instead of twenty minutes of typing. */
async function recordSettingVersion(env, key, value, force = false) {
  const db = env.DB;
  const last = await first(db,
    "SELECT id, value, saved_at FROM setting_history WHERE key = ? ORDER BY id DESC LIMIT 1", key);
  if (last && last.value === value) return; // nothing changed since the last snapshot
  if (last && !force) {
    const prev = parseNaiveISO(last.saved_at);
    if (Number.isFinite(prev)) {
      const ageMin = (parseNaiveISO(nowISO(env)) - prev) / 60000;
      if (ageMin < SETTING_HISTORY_THROTTLE_MIN) return; // already snapshotted recently
    }
  }
  await batched(db, [
    db.prepare("INSERT INTO setting_history (key, value, bytes, saved_at) VALUES (?,?,?,?)")
      .bind(key, value, value.length, nowISO(env, { seconds: true })),
    db.prepare(
      "DELETE FROM setting_history WHERE key = ? AND id NOT IN " +
      "(SELECT id FROM setting_history WHERE key = ? ORDER BY id DESC LIMIT ?)")
      .bind(key, key, SETTING_HISTORY_KEEP),
  ]);
}

/** Body: { key, value, force? }. Upserts an app-wide setting.
 *
 *  Two safeguards sit in front of the frontend's autosave:
 *    1. The previous value is copied into setting_history before the overwrite.
 *    2. A write that would shrink a substantial blob to a fraction of its size
 *       is refused with 409 unless force=true. That's the signature of a bad
 *       in-memory state being flushed, and it's silent otherwise.
 *  Small UI settings are exempt from both — they'd only add noise. */
export async function setSetting(env, request) {
  const db = env.DB;
  const data = await body(request);
  const key = (data.key || "").trim();
  if (!key) return badRequest("key required");
  const newVal = String(data.value);

  const prev = await first(db, "SELECT value FROM settings WHERE key = ?", key);
  const oldVal = prev ? prev.value : null;

  if (isVersionedSetting(key, oldVal, newVal)) {
    if (oldVal && !data.force) {
      const oldN = oldVal.length;
      const newN = newVal.length;
      if (oldN >= SETTING_GUARD_MIN_BYTES && newN < oldN * SETTING_GUARD_RATIO) {
        return json({
          ok: false, error: "shrink_guard", key, old_bytes: oldN, new_bytes: newN,
          message: `This save would shrink ${key} from ${oldN} to ${newN} bytes. ` +
                   "Re-send with force=true to proceed.",
        }, 409);
      }
    }
    if (oldVal !== null) await recordSettingVersion(env, key, oldVal);
  }

  await run(db,
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, newVal);
  return json({ ok: true, key, value: newVal });
}

/** ?key=goals_os — versions for one key, newest first. Values are omitted from
 *  the list (they're large); fetch one with ?id= to preview it. */
export async function settingHistory(env, url) {
  const db = env.DB;
  const key = (url.searchParams.get("key") || "").trim();
  const vid = url.searchParams.get("id");

  if (vid) {
    const row = await first(db,
      "SELECT id, key, value, bytes, saved_at FROM setting_history WHERE id = ?", vid);
    if (!row) return badRequest("not found", {}, 404);
    return json({ ok: true, version: row });
  }
  if (key) {
    const versions = await all(db,
      "SELECT id, key, bytes, saved_at FROM setting_history WHERE key = ? ORDER BY id DESC", key);
    const cur = await first(db, "SELECT value FROM settings WHERE key = ?", key);
    return json({ ok: true, key, current_bytes: cur ? cur.value.length : 0, versions });
  }
  // No key: summarize every versioned setting, for the history browser.
  const rows = await all(db,
    "SELECT key, COUNT(*) AS n, MAX(saved_at) AS newest FROM setting_history GROUP BY key ORDER BY key");
  const keys = [];
  for (const r of rows) {
    const cur = await first(db, "SELECT value FROM settings WHERE key = ?", r.key);
    keys.push({
      key: r.key, versions: r.n, newest: r.newest,
      current_bytes: cur ? cur.value.length : 0,
    });
  }
  return json({ ok: true, keys });
}

/** Body: { id }. Puts a historical version back. The value being replaced is
 *  pushed into history first, so a restore is itself undoable. */
export async function restoreSetting(env, request) {
  const db = env.DB;
  const data = await body(request);
  const vid = data.id;
  if (!vid) return badRequest("id required");
  const row = await first(db, "SELECT key, value FROM setting_history WHERE id = ?", vid);
  if (!row) return badRequest("not found", {}, 404);
  const cur = await first(db, "SELECT value FROM settings WHERE key = ?", row.key);
  if (cur) await recordSettingVersion(env, row.key, cur.value, true);
  await run(db,
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", row.key, row.value);
  return json({ ok: true, key: row.key, value: row.value, bytes: row.value.length });
}

// ---------------------------------------------------------------- uploads
// The Flask build wrote these to static/uploads/ next to the exe. A Worker has
// no writable filesystem, so the bytes go into the D1 `uploads` table and are
// served back from /static/uploads/<name> by the router.
//
// D1 caps a row at 2 MB, so the size limits are lower here than the 3 MB icon /
// 8 MB note-image caps the local build allowed. See CLOUDFLARE.md.
export const MAX_UPLOAD_BYTES = 1_500_000;

const MIME_BY_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
};
const ALLOWED_IMG_EXT = new Set(Object.keys(MIME_BY_EXT));

function extOf(filename) {
  const i = String(filename).lastIndexOf(".");
  return i === -1 ? "" : String(filename).slice(i).toLowerCase();
}

async function putUpload(env, name, mime, bytes) {
  await run(env.DB,
    "INSERT INTO uploads (name, mime, bytes, updated) VALUES (?,?,?,?) " +
    "ON CONFLICT(name) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated = excluded.updated",
    name, mime, bytes, nowISO(env));
}

/** Serve /static/uploads/<name> and /static/zen_backdrop.png out of D1. */
export async function serveUpload(env, name) {
  const row = await first(env.DB, "SELECT mime, bytes FROM uploads WHERE name = ?", name);
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(row.bytes, {
    headers: {
      "Content-Type": row.mime,
      // Every URL the frontend builds for these carries a cache-busting query
      // (?t= for the icon, ?v= for the backdrop), so a long cache is safe.
      "Cache-Control": "public, max-age=31536000",
    },
  });
}

async function readUploadedFile(request) {
  const form = await request.formData();
  const f = form.get("file");
  if (!f || typeof f === "string" || !f.name) return { error: "no file" };
  const ext = extOf(f.name);
  if (!ALLOWED_IMG_EXT.has(ext)) return { error: "unsupported file type" };
  const buf = new Uint8Array(await f.arrayBuffer());
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return { error: `file too large (max ${Math.round(MAX_UPLOAD_BYTES / 1000)} KB — Cloudflare D1 caps a row at 2 MB)` };
  }
  return { ext, mime: MIME_BY_EXT[ext], bytes: buf };
}

/** Accept an image for a Notebook note and return its URL. Notes live in a JSON
 *  settings blob that is versioned on every write, so embedding photos as data
 *  URLs would copy megabytes into each of the 20 retained versions. */
export async function uploadNoteImage(env, request) {
  const f = await readUploadedFile(request);
  if (f.error) return badRequest(f.error);
  const name = `note_${uid()}${f.ext}`;
  await putUpload(env, name, f.mime, f.bytes);
  return json({ ok: true, url: "/static/uploads/" + name });
}

/** Accept an uploaded image and store it as the banner icon. */
export async function uploadIcon(env, request) {
  const f = await readUploadedFile(request);
  if (f.error) return badRequest(f.error);
  // Remove any previous custom icon so the store doesn't accumulate them.
  await run(env.DB, "DELETE FROM uploads WHERE name LIKE 'icon.%'");
  const name = "icon" + f.ext;
  await putUpload(env, name, f.mime, f.bytes);
  const url = "/static/uploads/" + name;
  await run(env.DB,
    "INSERT INTO settings (key, value) VALUES ('hdr_icon_url', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", url);
  return json({ ok: true, url });
}

/** Reset the banner icon back to the default. */
export async function resetIcon(env) {
  await batched(env.DB, [
    env.DB.prepare("DELETE FROM uploads WHERE name LIKE 'icon.%'"),
    env.DB.prepare("DELETE FROM settings WHERE key = 'hdr_icon_url'"),
  ]);
  return json({ ok: true });
}

/** POST { dataUrl } saves the rendered zen garden and stamps
 *  settings['zen_backdrop'] with a cache-busting timestamp. DELETE clears it. */
export async function zenBackdrop(env, request) {
  const db = env.DB;
  if (request.method === "DELETE") {
    await run(db,
      "INSERT INTO settings (key, value) VALUES ('zen_backdrop', '') " +
      "ON CONFLICT(key) DO UPDATE SET value = ''");
    return json({ ok: true, value: "" });
  }

  const data = await body(request);
  const dataUrl = data.dataUrl || "";
  // The local build only accepted PNG. The canvas can also hand us a JPEG now
  // (zen.js falls back to one when the PNG would be too big for a D1 row).
  const m = /^data:(image\/(?:png|jpeg));base64,/.exec(dataUrl);
  if (!m) return badRequest("expected a PNG or JPEG data URL", { ok: false });

  let raw;
  try {
    const b64 = dataUrl.slice(m[0].length);
    const bin = atob(b64);
    raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  } catch {
    return badRequest("bad base64 payload", { ok: false });
  }
  if (raw.byteLength > MAX_UPLOAD_BYTES) {
    return badRequest(
      `image too large (max ${Math.round(MAX_UPLOAD_BYTES / 1000)} KB — Cloudflare D1 caps a row at 2 MB)`,
      { ok: false });
  }

  // The frontend always requests /static/zen_backdrop.png; the stored mime is
  // what the browser actually honors, so a JPEG under that name is fine.
  await putUpload(env, "zen_backdrop.png", m[1], raw);
  const stamp = String(Math.floor(Date.now() / 1000));
  await run(db,
    "INSERT INTO settings (key, value) VALUES ('zen_backdrop', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", stamp);
  return json({ ok: true, value: stamp });
}
