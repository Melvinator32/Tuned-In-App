/* Tuned In — Cloudflare Worker entry point.
 *
 * Replaces the Flask app in the legacy app.py. Routing is explicit rather than
 * decorator-driven, but the URL surface is identical, so the frontend in
 * public/ calls exactly the same endpoints it always did.
 *
 * Requests for files that exist under public/ never reach this Worker — the
 * static-assets binding serves them first. Everything else lands here: the
 * /api/* surface, the two upload paths that used to be files on disk, and a
 * fallback that hands anything else back to the assets binding.
 */

import { bumpRevision, getRevision, json } from "./lib.js";
import * as board from "./board.js";
import * as schedule from "./schedule.js";
import * as extras from "./extras.js";
import { scopeToUser } from "./auth.js";

/** Answer one /api/* request.
 *
 *  Split out of the fetch handler so it can be called with any object that
 *  behaves like a D1 database. That is the whole of what a local-first build
 *  needs: give this a SQLite running in the browser as env.DB and every route
 *  below works unchanged, so the API exists once rather than once per runtime.
 *  See public/static/localdb.js. */
export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    // Whose board is this? A single-tenant deployment gets env straight back,
    // so this is a no-op until Access is configured. See src/auth.js.
    let scoped;
    try {
      scoped = await scopeToUser(request, env);
    } catch (err) {
      if (err && err.isAuthError) {
        console.error("[tuned-in] auth", path, err.message);
        return json({ error: err.message }, err.status || 403);
      }
      throw err;
    }

    if (!scoped.DB) {
      return json({
        error: "No D1 binding. Create the database and bind it as DB — see CLOUDFLARE.md.",
      }, 500);
    }
    const res = await route(request, scoped, url, path);
    if (res) return await stampRevision(scoped, request, res);
    return json({ error: "not found" }, 404);
  } catch (err) {
    // Flask's debug=False turned an unhandled error into a 500 with no body.
    // Log it (visible in `wrangler tail` / the dashboard) and say so plainly:
    // app.js surfaces the response text in its thrown Error.
    console.error("[tuned-in]", path, err && err.stack ? err.stack : err);
    return json({ error: "server error", detail: String(err && err.message ? err.message : err) }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api" || path.startsWith("/api/")) {
      return handleApiRequest(request, env);
    }

    try {
      // Images that used to live in static/uploads/ next to the exe.
      if (path.startsWith("/static/uploads/")) {
        return await extras.serveUpload(env, decodeURIComponent(path.slice("/static/uploads/".length)));
      }
      if (path === "/static/zen_backdrop.png") {
        return await extras.serveUpload(env, "zen_backdrop.png");
      }
    } catch (err) {
      // Flask's debug=False turned an unhandled error into a 500 with no body.
      // Log it (visible in `wrangler tail` / the dashboard) and say so plainly:
      // app.js surfaces the response text in its thrown Error.
      console.error("[tuned-in]", path, err && err.stack ? err.stack : err);
      return json({ error: "server error", detail: String(err && err.message ? err.message : err) }, 500);
    }

    // Anything else: a static asset, or the 404 the assets binding produces.
    return env.ASSETS.fetch(request);
  },
};

/** Tag every API response with the board revision it left the board at, and
 *  advance that revision when the request actually changed something.
 *
 *  Doing it here rather than in each handler means one place to reason about:
 *  any successful write bumps, and every response tells the browser where the
 *  board now stands. The browser hands that number back with a whole-board
 *  restore so a stale one can be refused — see restoreState in board.js.
 *
 *  A failed write is not a change, so it neither bumps nor stamps; the client
 *  keeps whatever revision it already had. */
async function stampRevision(env, request, res) {
  const changed = request.method !== "GET" && res.ok;
  if (!changed && request.method !== "GET") return res;
  const revision = changed ? await bumpRevision(env.DB) : await getRevision(env.DB);
  const out = new Response(res.body, res);
  out.headers.set("X-Board-Revision", String(revision));
  return out;
}

/** Match a request to a handler. Returns null when nothing matches, so the
 *  caller can answer 404. */
async function route(request, env, url, path) {
  const method = request.method;
  const seg = path.split("/").filter(Boolean); // ["api", "tasks", "<id>", ...]

  const is = (m, ...parts) =>
    method === m && seg.length === parts.length + 1 &&
    parts.every((p, i) => p === "*" || p === seg[i + 1]);

  // ---- board state ----
  if (is("GET", "state")) return board.apiState(env);
  if (is("POST", "restore")) return board.restoreState(env, request);

  // ---- tasks ----
  if (is("POST", "tasks")) return board.addTask(env, request);
  if (is("POST", "tasks", "cleanup-empty")) return board.cleanupEmptyTasks(env);
  if (is("PATCH", "tasks", "reorder")) return board.reorderTasks(env, request);
  if (is("PATCH", "tasks", "*", "cell")) return board.updateCell(env, request, seg[2]);
  if (is("PATCH", "tasks", "*", "group")) return board.moveTaskGroup(env, request, seg[2]);
  if (is("POST", "tasks", "*", "copy")) return board.copyTaskToGroup(env, request, seg[2]);
  if (is("POST", "tasks", "*", "timer")) return board.taskTimer(env, request, seg[2]);
  if (is("DELETE", "tasks", "*")) return board.deleteTask(env, seg[2]);

  // ---- columns ----
  if (is("POST", "columns")) return board.addColumn(env, request);
  if (is("PATCH", "columns", "reorder")) return board.reorderColumns(env, request);
  if (is("PATCH", "columns", "*")) return board.updateColumn(env, request, seg[2]);
  if (is("DELETE", "columns", "*")) return board.deleteColumn(env, seg[2]);

  // ---- groups ----
  if (is("PATCH", "groups", "rename")) return board.renameGroup(env, request);
  if (is("POST", "groups", "delete")) return board.deleteGroup(env, request);
  if (is("POST", "groups", "create")) return board.createGroup(env, request);
  if (is("PATCH", "groups", "reorder")) return board.reorderGroups(env, request);
  if (is("PATCH", "groups", "color")) return board.setGroupColor(env, request);

  // ---- automations ----
  if (is("POST", "automations")) return board.saveAutomation(env, request);
  if (is("PATCH", "automations", "*", "toggle")) return board.toggleAutomation(env, seg[2]);
  if (is("DELETE", "automations", "*")) return board.deleteAutomation(env, seg[2]);

  // ---- palette ----
  if (is("POST", "palette")) return board.addPalette(env, request);
  if (is("PATCH", "palette", "reorder")) return board.reorderPalette(env, request);
  if (is("PATCH", "palette", "*")) return board.updatePalette(env, request, seg[2]);
  if (is("DELETE", "palette", "*")) return board.deletePalette(env, seg[2]);

  // ---- rewards ----
  if (is("POST", "rewards")) return extras.addReward(env, request);
  if (is("PATCH", "rewards", "*")) return extras.updateReward(env, request, seg[2]);
  if (is("DELETE", "rewards", "*")) return extras.deleteReward(env, seg[2]);
  if (is("POST", "rewards", "*", "redeem")) return extras.redeemReward(env, seg[2]);
  if (is("DELETE", "redemptions", "*")) return extras.deleteRedemption(env, seg[2]);

  // ---- Room for Improvements board ----
  if (is("POST", "imp", "tasks")) return extras.impAddTask(env, request);
  if (is("PATCH", "imp", "tasks", "*", "cell")) return extras.impUpdateCell(env, request, seg[3]);
  if (is("DELETE", "imp", "tasks", "*")) return extras.impDeleteTask(env, seg[3]);
  if (is("POST", "imp", "columns")) return extras.impAddColumn(env, request);
  if (is("PATCH", "imp", "columns", "*")) return extras.impUpdateColumn(env, request, seg[3]);
  if (is("DELETE", "imp", "columns", "*")) return extras.impDeleteColumn(env, seg[3]);
  if (is("PATCH", "imp", "groups", "rename")) return extras.impRenameGroup(env, request);

  // ---- Prompt Studio ----
  if (is("POST", "prompts")) return extras.addPrompt(env, request);
  if (is("PATCH", "prompts", "*")) return extras.updatePrompt(env, request, seg[2]);
  if (is("DELETE", "prompts", "*")) return extras.deletePrompt(env, seg[2]);

  // ---- Vibe Coding projects ----
  if (is("POST", "projects")) return extras.addProject(env, request);
  if (is("PATCH", "projects", "*")) return extras.updateProject(env, request, seg[2]);
  if (is("DELETE", "projects", "*")) return extras.deleteProject(env, seg[2]);
  if (is("POST", "projects", "*", "todo")) return extras.projectToggleTodo(env, seg[2]);

  // ---- schedule ----
  if (is("GET", "schedule")) return schedule.getSchedule(env, url);
  if (is("POST", "schedule")) return schedule.addScheduleBlock(env, request);
  if (is("GET", "schedule", "range")) return schedule.getScheduleRange(env, url);
  if (is("POST", "schedule", "autoplan")) return schedule.autoplanDay(env, request);
  if (is("DELETE", "schedule", "autoplan")) return schedule.clearAutoplan(env, url);
  if (is("POST", "schedule", "import")) return schedule.importScheduleIcs(env, request);
  if (is("POST", "schedule", "clear-imported")) return schedule.clearImportedSchedule(env);
  if (is("POST", "schedule", "rescan")) return schedule.rescanCalendarFolder();
  if (is("PATCH", "schedule", "*")) return schedule.updateScheduleBlock(env, request, seg[2]);
  if (is("DELETE", "schedule", "*")) return schedule.deleteScheduleBlock(env, seg[2]);

  // ---- settings ----
  if (is("PATCH", "settings")) return extras.setSetting(env, request);
  if (is("GET", "settings", "history")) return extras.settingHistory(env, url);
  if (is("POST", "settings", "restore")) return extras.restoreSetting(env, request);

  // ---- images ----
  if (is("POST", "zen-backdrop") || is("DELETE", "zen-backdrop")) {
    return extras.zenBackdrop(env, request);
  }
  if (is("POST", "notes", "image")) return extras.uploadNoteImage(env, request);
  if (is("POST", "header", "icon")) return extras.uploadIcon(env, request);
  if (is("DELETE", "header", "icon")) return extras.resetIcon(env);

  return null;
}
