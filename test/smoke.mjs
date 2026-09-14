/* End-to-end smoke test against a running `wrangler dev`.
 *
 * Drives the real Worker over HTTP against a real (local) D1, so it covers the
 * parts the unit tests can't: seeding, the linked-copy and automation rules,
 * uploads, and every route the frontend calls.
 *
 *   npx wrangler d1 migrations apply tuned-in --local
 *   npx wrangler dev &
 *   node test/smoke.mjs [http://127.0.0.1:8787]
 *
 * It writes to whatever database `wrangler dev` is bound to, so point it at a
 * local one — never at a --remote session holding your real board.
 */

const BASE = process.argv[2] || "http://127.0.0.1:8787";

let pass = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: opts.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON (a static asset, say) */ }
  return { status: res.status, json, text, headers: res.headers };
}

const section = (t) => console.log("\n" + t);

// ---------------------------------------------------------------- static
section("static assets");
{
  const index = await api("/");
  check("GET / serves index.html", index.status === 200 && index.text.includes("<title>Tuned In</title>"));
  check("index.html has no Jinja left", !/\{\{|\{%/.test(index.text));
  for (const f of ["profile.js", "app.js", "board.js", "studio.js", "today.js", "shell.js", "goals.js",
    "zen.js", "skilllab.js", "ideas.js", "para.js", "notes.js", "career.js", "progress.js", "boot.js",
    "style.css", "xlsx.full.min.js", "bonsai_logo.svg"]) {
    const r = await api("/static/" + f);
    check(`GET /static/${f}`, r.status === 200 && r.text.length > 0, `status ${r.status}`);
  }
}

// ---------------------------------------------------------------- state + seed
section("state and first-run seed");
let state = (await api("/api/state")).json;
// Named rather than counted, so a change to the seed says which column moved
// instead of just that the number did.
check("columns seeded",
  state.columns.map((c) => c.name).join() ===
    "Task,Status,Owner,Due Date,Priority,Est. Hours,Values,Goal",
  state.columns.map((c) => c.name).join());
check("Values + Goal columns present",
  state.columns.some((c) => c.name === "Values" && c.type === "goal") &&
  state.columns.some((c) => c.name === "Goal" && c.type === "goal"));
check("no Win/Loss columns are created for you",
  state.columns.filter((c) => c.type === "check").length === 0,
  state.columns.filter((c) => c.type === "check").map((c) => c.name).join());
check("tasks seeded", state.tasks.length === 10, `${state.tasks.length} tasks`);
check("groups seeded", Object.keys(state.group_order).length === 7);
check("no Commercial Models group", !Object.keys(state.group_order).includes("Commercial Models"));

// The seeded board has to obey the automations it ships with. Every task whose
// status is not one of the parked/done ones belongs in All Active Tasks, and
// each such placement is a linked copy of the original rather than a duplicate.
{
  const PARKED = ["Done", "Holding Pattern", "In Someone Else' Court", "Waiting for Feedback"];
  const active = state.tasks.filter((t) => !PARKED.includes(t.cells.c_status));
  const inAll = new Set(
    active.filter((t) => t.group_name === "All Active Tasks").map((t) => t.cells.c_name));
  const missing = active.filter((t) => !inAll.has(t.cells.c_name)).map((t) => t.cells.c_name);
  check("every active task is in All Active Tasks", missing.length === 0, missing.join(", "));

  const elsewhere = active.filter((t) => t.group_name !== "All Active Tasks");
  check("those placements are linked, not duplicated",
    elsewhere.length > 0 && elsewhere.every((t) => t.link_id),
    `${elsewhere.filter((t) => !t.link_id).length} unlinked`);
}
check("automations seeded", state.automations.length === 6);
check("palette seeded", state.palette.status.length === 6 && state.palette.priority.length === 4);
check("improvements columns seeded", state.imp_columns.length === 6);
check("server_build reported", state.server_build === "2026-08-21-A", state.server_build);
check("points computed", state.points && state.points.balance === 0);

const seedCount = state.tasks.length;
const reseed = (await api("/api/state")).json;
check("seeding is idempotent", reseed.tasks.length === seedCount, `${reseed.tasks.length} tasks`);

const statusCol = state.columns.find((c) => c.type === "status").id;
const primaryCol = state.columns.find((c) => c.is_primary).id;
const dueCol = state.columns.find((c) => c.type === "date").id;

// ---------------------------------------------------------------- tasks
section("tasks");
const made = (await api("/api/tasks", { method: "POST", body: JSON.stringify({ group: "Personal Tasks" }) })).json;
check("POST /api/tasks", !!made.id && made.group_name === "Personal Tasks");
check("new task gets defaults", made.cells[statusCol] === "Not Started" && made.cells[primaryCol] === "New task");

const named = await api(`/api/tasks/${made.id}/cell`, {
  method: "PATCH", body: JSON.stringify({ col: primaryCol, value: "Smoke test task" }),
});
check("PATCH cell renames", named.json.cells[primaryCol] === "Smoke test task");

// "Not Started" triggers the copyToGroup automation into All Active Tasks.
check("copyToGroup automation fired", named.json.linked_changed === true);
state = (await api("/api/state")).json;
const copies = state.tasks.filter((t) => t.cells[primaryCol] === "Smoke test task");
check("linked copy exists in both groups",
  copies.length === 2 && new Set(copies.map((t) => t.group_name)).size === 2,
  copies.map((t) => t.group_name).join("+"));
check("copies share a link_id", copies.length === 2 && copies[0].link_id && copies[0].link_id === copies[1].link_id);

const sub = (await api("/api/tasks", { method: "POST", body: JSON.stringify({ parent_id: made.id }) })).json;
check("subtask inherits the parent's group", sub.group_name === made.group_name);
check("subtask is named as one", sub.cells[primaryCol] === "New subtask");

// Working On It -> the setToday-style rules and the parked-group sweep.
const working = await api(`/api/tasks/${made.id}/cell`, {
  method: "PATCH", body: JSON.stringify({ col: statusCol, value: "Working On It" }),
});
check("status change returns updated cells", working.json.cells[statusCol] === "Working On It");

// Done -> moveToGroup + the done stamp + the linked collapse.
const done = await api(`/api/tasks/${made.id}/cell`, {
  method: "PATCH", body: JSON.stringify({ col: statusCol, value: "Done" }),
});
check("Done moves the task to the Done group", done.json.group_name === "Done", done.json.group_name);
check("Done stamps __done_date", /^\d{4}-\d{2}-\d{2}$/.test(done.json.cells.__done_date || ""));
check("Done collapses the linked copies", done.json.collapsed === true);
state = (await api("/api/state")).json;
check("only one placement survives Done",
  state.tasks.filter((t) => t.cells[primaryCol] === "Smoke test task").length === 1);

// Un-Done clears the stamp — and relocates the task. Going back to "Working On
// It" fires the copyToGroup rule into All Active Tasks, which then makes the
// placement sitting in Done stale, so the parked-group sweep deletes it. The
// surviving placement is the new copy, under a new id. Same as the Flask build.
const undone = await api(`/api/tasks/${made.id}/cell`, {
  method: "PATCH", body: JSON.stringify({ col: statusCol, value: "Working On It" }),
});
check("leaving Done clears __done_date", !("__done_date" in undone.json.cells));
state = (await api("/api/state")).json;
const survivors = state.tasks.filter((t) => t.cells[primaryCol] === "Smoke test task");
check("un-Done leaves one placement, back in All Active Tasks",
  survivors.length === 1 && survivors[0].group_name === "All Active Tasks",
  survivors.map((t) => t.group_name).join("+"));
const taskId = survivors[0].id;

// Duplicate guard on copy.
const dup = await api(`/api/tasks/${taskId}/copy`, {
  method: "POST", body: JSON.stringify({ group: "Networking" }),
});
check("copy to a fresh group works", dup.json.ok === true && !!dup.json.id);
const dup2 = await api(`/api/tasks/${taskId}/copy`, {
  method: "POST", body: JSON.stringify({ group: "Networking" }),
});
check("second copy asks for confirmation", dup2.json.needs_confirm === true && dup2.json.kind === "link");
// `sub` went with its parent when the stale Done placement was deleted, so use
// a fresh subtask to check that a subtask can't be copied on its own.
const sub2 = (await api("/api/tasks", { method: "POST", body: JSON.stringify({ parent_id: taskId }) })).json;
check("a subtask cannot be copied directly",
  (await api(`/api/tasks/${sub2.id}/copy`, { method: "POST", body: JSON.stringify({ group: "Networking" }) })).status === 400);
check("the original subtask went with its deleted parent",
  !state.tasks.some((t) => t.id === sub.id));

const moved = await api(`/api/tasks/${taskId}/group`, {
  method: "PATCH", body: JSON.stringify({ group: "Commercial Models", force: true }),
});
check("PATCH task group", moved.json.group_name === "Commercial Models");

// Timer.
await api(`/api/tasks/${taskId}/timer`, { method: "POST", body: JSON.stringify({ action: "start" }) });
const timerSet = await api(`/api/tasks/${taskId}/timer`, {
  method: "POST", body: JSON.stringify({ action: "set", seconds: 125 }),
});
check("timer set", timerSet.json.time_spent === 125 && timerSet.json.time_started !== "");
const timerStop = await api(`/api/tasks/${taskId}/timer`, { method: "POST", body: JSON.stringify({ action: "stop" }) });
check("timer stop accumulates", timerStop.json.time_spent >= 125 && timerStop.json.time_started === "");
const timerReset = await api(`/api/tasks/${taskId}/timer`, { method: "POST", body: JSON.stringify({ action: "reset" }) });
check("timer reset", timerReset.json.time_spent === 0);
check("bad timer action is rejected",
  (await api(`/api/tasks/${taskId}/timer`, { method: "POST", body: JSON.stringify({ action: "nope" }) })).status === 400);

// Reorder + cleanup.
state = (await api("/api/state")).json;
const order = state.tasks.map((t) => t.id).reverse();
check("PATCH /api/tasks/reorder",
  (await api("/api/tasks/reorder", { method: "PATCH", body: JSON.stringify({ order }) })).json.ok === true);
const cleanup = await api("/api/tasks/cleanup-empty", { method: "POST" });
check("cleanup-empty removes placeholder rows", cleanup.json.ok === true && cleanup.json.deleted >= 1,
  `deleted ${cleanup.json.deleted}`);
state = (await api("/api/state")).json;
check("cleanup left the named tasks alone",
  state.tasks.some((t) => t.cells[primaryCol] === "Smoke test task") &&
  !state.tasks.some((t) => t.cells[primaryCol] === "New subtask"));

// ---------------------------------------------------------------- columns
section("columns");
const col = (await api("/api/columns", { method: "POST", body: JSON.stringify({ name: "Points", type: "number" }) })).json;
check("POST /api/columns", !!col.id && col.type === "number");
state = (await api("/api/state")).json;
check("new column backfilled onto every task", state.tasks.every((t) => col.id in t.cells));
check("points_col detected", state.points.points_col === col.id);

check("PATCH column width clamps",
  (await api(`/api/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ width: 5000 }) })).json.width === 900);
check("PATCH column rename",
  (await api(`/api/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ name: "Points" }) })).json.name === "Points");
check("primary column cannot be deleted",
  (await api(`/api/columns/${primaryCol}`, { method: "DELETE" })).status === 400);
check("PATCH /api/columns/reorder",
  (await api("/api/columns/reorder", { method: "PATCH", body: JSON.stringify({ order: state.columns.map((c) => c.id) }) })).json.ok === true);

// Points now actually score.
await api(`/api/tasks/${taskId}/cell`, { method: "PATCH", body: JSON.stringify({ col: col.id, value: 7 }) });
await api(`/api/tasks/${taskId}/cell`, { method: "PATCH", body: JSON.stringify({ col: statusCol, value: "Done" }) });
state = (await api("/api/state")).json;
check("points earned from a Done task", state.points.earned === 7, JSON.stringify(state.points));

// ---------------------------------------------------------------- groups
section("groups");
check("POST /api/groups/create",
  (await api("/api/groups/create", { method: "POST", body: JSON.stringify({ name: "Smoke Group" }) })).json.ok === true);
check("PATCH /api/groups/color",
  (await api("/api/groups/color", { method: "PATCH", body: JSON.stringify({ name: "Smoke Group", color: "#123456" }) })).json.color === "#123456");
check("PATCH /api/groups/rename",
  (await api("/api/groups/rename", { method: "PATCH", body: JSON.stringify({ old: "Smoke Group", new: "Smoke Group 2" }) })).json.ok === true);
state = (await api("/api/state")).json;
check("rename carried the color across", state.group_colors["Smoke Group 2"] === "#123456");
check("rename carried the order position across", "Smoke Group 2" in state.group_order);
check("PATCH /api/groups/reorder",
  (await api("/api/groups/reorder", { method: "PATCH", body: JSON.stringify({ order: Object.keys(state.group_order) }) })).json.ok === true);
check("POST /api/groups/delete",
  (await api("/api/groups/delete", { method: "POST", body: JSON.stringify({ name: "Smoke Group 2", mode: "delete" }) })).json.ok === true);
state = (await api("/api/state")).json;
check("deleted group is gone", !("Smoke Group 2" in state.group_order));

// ---------------------------------------------------------------- automations + palette
section("automations and palette");
const auto = (await api("/api/automations", {
  method: "POST",
  body: JSON.stringify({ name: "Smoke rule", trigger_col: statusCol, trigger_val: "Nope", action_col: dueCol, action_type: "setToday" }),
})).json;
check("POST /api/automations", !!auto.id);
check("PATCH toggle", (await api(`/api/automations/${auto.id}/toggle`, { method: "PATCH" })).json.ok === true);
state = (await api("/api/state")).json;
check("toggle flipped enabled", state.automations.find((a) => a.id === auto.id).enabled === 0);
check("DELETE automation", (await api(`/api/automations/${auto.id}`, { method: "DELETE" })).json.ok === true);

const pal = (await api("/api/palette", { method: "POST", body: JSON.stringify({ kind: "status", label: "Smoke", color: "#abcdef" }) })).json;
check("POST /api/palette", !!pal.id && pal.position === 6);
// Tag a different task, so this doesn't disturb the Done task the points
// assertions below depend on.
state = (await api("/api/state")).json;
const tagged = state.tasks.find((t) => t.id !== taskId && !t.parent_id).id;
await api(`/api/tasks/${tagged}/cell`, { method: "PATCH", body: JSON.stringify({ col: statusCol, value: "Smoke" }) });
check("PATCH palette renames",
  (await api(`/api/palette/${pal.id}`, { method: "PATCH", body: JSON.stringify({ label: "Smoked" }) })).json.label === "Smoked");
state = (await api("/api/state")).json;
check("palette rename rewrote task cells",
  state.tasks.find((t) => t.id === tagged).cells[statusCol] === "Smoked");
check("PATCH /api/palette/reorder",
  (await api("/api/palette/reorder", { method: "PATCH", body: JSON.stringify({ order: state.palette.status.map((p) => p.id) }) })).json.ok === true);
check("DELETE palette", (await api(`/api/palette/${pal.id}`, { method: "DELETE" })).json.ok === true);

// ---------------------------------------------------------------- rewards
section("rewards");
const rw = (await api("/api/rewards", { method: "POST", body: JSON.stringify({ name: "Coffee", cost: 5 }) })).json;
check("POST /api/rewards", !!rw.id && rw.cost === 5);
check("PATCH reward", (await api(`/api/rewards/${rw.id}`, { method: "PATCH", body: JSON.stringify({ cost: 3 }) })).json.ok === true);
check("redeem within balance", (await api(`/api/rewards/${rw.id}/redeem`, { method: "POST" })).json.ok === true);
state = (await api("/api/state")).json;
check("redemption deducted", state.points.redeemed === 3 && state.points.balance === 4, JSON.stringify(state.points));

const expensive = (await api("/api/rewards", { method: "POST", body: JSON.stringify({ name: "Yacht", cost: 999 }) })).json;
check("redeem beyond balance is refused",
  (await api(`/api/rewards/${expensive.id}/redeem`, { method: "POST" })).status === 400);
check("a redemption was logged", state.redemptions.length === 1);
check("DELETE redemption refunds",
  state.redemptions.length === 1 &&
  (await api(`/api/redemptions/${state.redemptions[0].id}`, { method: "DELETE" })).json.ok === true);
check("balance recovers after the refund", (await api("/api/state")).json.points.redeemed === 0);
check("DELETE reward", (await api(`/api/rewards/${rw.id}`, { method: "DELETE" })).json.ok === true);
await api(`/api/rewards/${expensive.id}`, { method: "DELETE" });

// ---------------------------------------------------------------- improvements board
section("improvements board");
const imp = (await api("/api/imp/tasks", { method: "POST", body: JSON.stringify({ name: "Impatience" }) })).json;
check("POST /api/imp/tasks", !!imp.id && imp.cells.ic_weak === "Impatience");
check("PATCH imp cell",
  (await api(`/api/imp/tasks/${imp.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: "ic_why", value: "Matters" }) })).json.cells.ic_why === "Matters");
const impCol = (await api("/api/imp/columns", { method: "POST", body: JSON.stringify({ name: "Notes", type: "text" }) })).json;
check("POST /api/imp/columns", !!impCol.id && impCol.position === 6);
check("PATCH imp column", (await api(`/api/imp/columns/${impCol.id}`, { method: "PATCH", body: JSON.stringify({ width: 300 }) })).json.ok === true);
check("imp primary column cannot be deleted", (await api("/api/imp/columns/ic_weak", { method: "DELETE" })).status === 400);
check("DELETE imp column", (await api(`/api/imp/columns/${impCol.id}`, { method: "DELETE" })).json.ok === true);
check("PATCH imp group rename",
  (await api("/api/imp/groups/rename", { method: "PATCH", body: JSON.stringify({ old: "Current Weaknesses", new: "Weaknesses" }) })).json.ok === true);
check("DELETE imp task", (await api(`/api/imp/tasks/${imp.id}`, { method: "DELETE" })).json.ok === true);

// ---------------------------------------------------------------- prompts + projects
section("prompt studio and projects");
const pr = (await api("/api/prompts", { method: "POST", body: JSON.stringify({ title: "Draft", category: "writing", fields: { a: 1 } }) })).json;
check("POST /api/prompts", !!pr.id && pr.fields.a === 1 && !!pr.created);
check("PATCH prompt", (await api(`/api/prompts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ title: "Draft 2", priority: "High" }) })).json.ok === true);
state = (await api("/api/state")).json;
const savedPrompt = state.prompts.find((p) => p.id === pr.id);
check("prompt fields round-trip as JSON", savedPrompt.fields.a === 1 && savedPrompt.title === "Draft 2");
check("DELETE prompt", (await api(`/api/prompts/${pr.id}`, { method: "DELETE" })).json.ok === true);

const proj = (await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "Side project", stage: "idea" }) })).json;
check("POST /api/projects", !!proj.id && proj.title === "Side project");
await api(`/api/projects/${proj.id}`, {
  method: "PATCH", body: JSON.stringify({ description: "Notes here", tags: "pillar:auto|idea:x1" }),
});
const on = (await api(`/api/projects/${proj.id}/todo`, { method: "POST" })).json;
check("project onto the board", on.on === true && !!on.task_id);
state = (await api("/api/state")).json;
const projTask = state.tasks.find((t) => t.id === on.task_id);
const valuesCol = state.columns.find((c) => c.type === "goal" && /values|pillar/i.test(c.name)).id;
const goalCol = state.columns.find((c) => c.type === "goal" && c.id !== valuesCol).id;
check("project tags split across the goal columns",
  projTask.cells[valuesCol] === "pillar:auto" && projTask.cells[goalCol] === "idea:x1",
  JSON.stringify({ v: projTask.cells[valuesCol], g: projTask.cells[goalCol] }));
const off = (await api(`/api/projects/${proj.id}/todo`, { method: "POST" })).json;
check("project off the board", off.on === false);
state = (await api("/api/state")).json;
check("the project's task was removed", !state.tasks.some((t) => t.id === on.task_id));
check("DELETE project", (await api(`/api/projects/${proj.id}`, { method: "DELETE" })).json.ok === true);

// ---------------------------------------------------------------- schedule
section("schedule");
const DAY = "2026-09-10";
const blk = (await api("/api/schedule", {
  method: "POST", body: JSON.stringify({ day: DAY, start: "09:00", minutes: 60, label: "Meeting" }),
})).json;
check("POST /api/schedule", !!blk.id && blk.minutes === 60);
check("GET /api/schedule?day=", (await api(`/api/schedule?day=${DAY}`)).json.blocks.length === 1);
check("GET /api/schedule (no day) defaults to today", Array.isArray((await api("/api/schedule")).json.blocks));
check("GET /api/schedule/range", (await api(`/api/schedule/range?from=2026-09-01&to=2026-09-30`)).json.blocks.length === 1);
check("PATCH block", (await api(`/api/schedule/${blk.id}`, { method: "PATCH", body: JSON.stringify({ minutes: 30, label: "Standup" }) })).json.ok === true);
check("block minutes clamp low", (await api("/api/schedule", { method: "POST", body: JSON.stringify({ day: DAY, start: "23:00", minutes: 1 }) })).json.minutes === 15);

const plan = (await api("/api/schedule/autoplan", {
  method: "POST",
  body: JSON.stringify({
    day: DAY, window_start: "08:00", window_end: "12:00",
    items: [{ label: "Deep work", minutes: 60 }, { label: "Email", minutes: 30 }, { label: "Huge", minutes: 480 }],
  }),
})).json;
check("autoplan places what fits", plan.placed.length === 2, JSON.stringify(plan.placed));
check("autoplan starts at the window start", plan.placed[0].start === "08:00", plan.placed[0].start);
check("autoplan works around the existing meeting", plan.placed[1].start === "09:30", plan.placed[1].start);
check("autoplan reports what did not fit", plan.unplaced.length === 1 && plan.unplaced[0] === "Huge");
const replan = (await api("/api/schedule/autoplan", {
  method: "POST", body: JSON.stringify({ day: DAY, window_start: "08:00", window_end: "12:00", items: [{ label: "Only", minutes: 30 }] }),
})).json;
check("re-planning replaces rather than stacks", replan.placed.length === 1);
check("autoplan rejects a backwards window",
  (await api("/api/schedule/autoplan", { method: "POST", body: JSON.stringify({ day: DAY, window_start: "18:00", window_end: "08:00" }) })).status === 400);
check("DELETE autoplan", (await api(`/api/schedule/autoplan?day=${DAY}`, { method: "DELETE" })).json.removed === 1);

const ICS = [
  "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:smoke-1", "SUMMARY:Imported meeting",
  `DTSTART:${DAY.replace(/-/g, "")}T140000Z`, `DTEND:${DAY.replace(/-/g, "")}T150000Z`,
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");
const imported = (await api("/api/schedule/import", { method: "POST", body: JSON.stringify({ ics: ICS }) })).json;
check("POST /api/schedule/import", imported.ok === true && imported.added === 1, JSON.stringify(imported));
const dayBlocks = (await api(`/api/schedule?day=${DAY}`)).json.blocks;
const importedBlock = dayBlocks.find((b) => b.src_uid === "smoke-1");
check("imported event converted 14:00Z into America/Chicago", importedBlock && importedBlock.start === "09:00",
  importedBlock && importedBlock.start);
check("imported event kept its duration", importedBlock && importedBlock.minutes === 60);
check("non-calendar text is rejected",
  (await api("/api/schedule/import", { method: "POST", body: JSON.stringify({ ics: "hello" }) })).status === 400);
check("POST /api/schedule/clear-imported",
  (await api("/api/schedule/clear-imported", { method: "POST" })).json.removed === 1);
const rescan = (await api("/api/schedule/rescan", { method: "POST" })).json;
check("rescan degrades to 'no folder'", rescan.ok === true && rescan.found === false);
check("DELETE block", (await api(`/api/schedule/${blk.id}`, { method: "DELETE" })).json.ok === true);

// ---------------------------------------------------------------- settings
section("settings and write history");
check("PATCH a small setting",
  (await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "density", value: 60 }) })).json.value === "60");
check("a key is required",
  (await api("/api/settings", { method: "PATCH", body: JSON.stringify({ value: "x" }) })).status === 400);

const big = JSON.stringify({ notes: "x".repeat(4000) });
await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "notebook", value: big }) });
const bigger = JSON.stringify({ notes: "y".repeat(5000) });
await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "notebook", value: bigger }) });
const shrink = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "notebook", value: "{}" }) });
check("shrink guard refuses a collapsing write", shrink.status === 409 && shrink.json.error === "shrink_guard");
check("force overrides the shrink guard",
  (await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "notebook", value: "{}", force: true }) })).json.ok === true);

const hist = (await api("/api/settings/history?key=notebook")).json;
check("history records versions", hist.ok === true && hist.versions.length >= 1, `${hist.versions.length} versions`);
const one = (await api(`/api/settings/history?id=${hist.versions[0].id}`)).json;
check("a single version can be previewed", one.ok === true && typeof one.version.value === "string");
const summary = (await api("/api/settings/history")).json;
check("history summarizes every key", summary.ok === true && summary.keys.some((k) => k.key === "notebook"));
const restored = (await api("/api/settings/restore", { method: "POST", body: JSON.stringify({ id: hist.versions[0].id }) })).json;
check("a version can be restored", restored.ok === true && restored.key === "notebook");
check("restoring a missing version 404s",
  (await api("/api/settings/restore", { method: "POST", body: JSON.stringify({ id: 999999 }) })).status === 404);

// ---------------------------------------------------------------- uploads
section("images");
// A 1x1 PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

const zen = (await api("/api/zen-backdrop", {
  method: "POST", body: JSON.stringify({ dataUrl: "data:image/png;base64," + PNG_B64 }),
})).json;
check("POST /api/zen-backdrop", zen.ok === true && /^\d+$/.test(zen.value));
const backdrop = await fetch(BASE + "/static/zen_backdrop.png");
check("backdrop serves from D1",
  backdrop.status === 200 && backdrop.headers.get("content-type") === "image/png");
check("a non-image data URL is rejected",
  (await api("/api/zen-backdrop", { method: "POST", body: JSON.stringify({ dataUrl: "data:text/plain;base64,aGk=" }) })).status === 400);
check("DELETE /api/zen-backdrop", (await api("/api/zen-backdrop", { method: "DELETE" })).json.value === "");

const fd = new FormData();
fd.append("file", new Blob([pngBytes], { type: "image/png" }), "icon.png");
const icon = (await api("/api/header/icon", { method: "POST", body: fd })).json;
check("POST /api/header/icon", icon.ok === true && icon.url === "/static/uploads/icon.png");
check("uploaded icon serves back", (await fetch(BASE + icon.url)).status === 200);
state = (await api("/api/state")).json;
check("icon url saved to settings", state.settings.hdr_icon_url === "/static/uploads/icon.png");

const fd2 = new FormData();
fd2.append("file", new Blob([pngBytes], { type: "image/png" }), "photo.png");
const noteImg = (await api("/api/notes/image", { method: "POST", body: fd2 })).json;
check("POST /api/notes/image", noteImg.ok === true && /^\/static\/uploads\/note_[0-9a-f]{10}\.png$/.test(noteImg.url));
check("note image serves back", (await fetch(BASE + noteImg.url)).status === 200);

const fd3 = new FormData();
fd3.append("file", new Blob([pngBytes], { type: "application/octet-stream" }), "bad.exe");
check("an unsupported extension is rejected", (await api("/api/notes/image", { method: "POST", body: fd3 })).status === 400);

const fd4 = new FormData();
fd4.append("file", new Blob([new Uint8Array(1_600_000)], { type: "image/png" }), "huge.png");
const tooBig = await api("/api/notes/image", { method: "POST", body: fd4 });
check("an oversized upload is rejected", tooBig.status === 400 && /too large/.test(tooBig.json.error));

check("DELETE /api/header/icon", (await api("/api/header/icon", { method: "DELETE" })).json.ok === true);
check("removed icon 404s", (await fetch(BASE + "/static/uploads/icon.png")).status === 404);

// ---------------------------------------------------------------- restore (undo)
section("restore / undo");

// The board revision is what stops one device's undo from silently wiping
// another device's work. Every response carries it; a restore has to quote the
// one it saw or it is refused.
const revBefore = Number((await api("/api/state")).headers.get("X-Board-Revision"));
check("GET reports a board revision", Number.isFinite(revBefore), String(revBefore));
const writeRes = await api("/api/settings", {
  method: "PATCH", body: JSON.stringify({ key: "smoke_rev_probe", value: "1" }),
});
const revAfterWrite = Number(writeRes.headers.get("X-Board-Revision"));
check("a write advances the revision", revAfterWrite === revBefore + 1,
  `${revBefore} -> ${revAfterWrite}`);
const revAfterRead = Number((await api("/api/state")).headers.get("X-Board-Revision"));
check("a read does not advance it", revAfterRead === revAfterWrite,
  `${revAfterWrite} -> ${revAfterRead}`);
const failed = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ value: "no key" }) });
check("a rejected write does not advance it", failed.status === 400 &&
  Number((await api("/api/state")).headers.get("X-Board-Revision")) === revAfterRead);

const snapshot = (await api("/api/state")).json;
const snapRev = Number((await api("/api/state")).headers.get("X-Board-Revision"));

check("a restore with no revision is refused",
  (await api("/api/restore", { method: "POST", body: JSON.stringify(snapshot) })).status === 409);

const staleTry = await api("/api/restore", {
  method: "POST", body: JSON.stringify({ ...snapshot, base_revision: snapRev - 5 }),
});
check("a restore quoting a stale revision is refused",
  staleTry.status === 409 && staleTry.json.error === "stale_revision", `status ${staleTry.status}`);
check("the refusal says what the board is actually at", staleTry.json.current === snapRev);

// Simulate the real hazard: this page holds a snapshot, another device writes,
// then this page tries to undo. It must not be allowed to win.
await api("/api/tasks", { method: "POST", body: JSON.stringify({ group: "Personal Tasks" }) });
const otherDeviceCount = (await api("/api/state")).json.tasks.length;
const clobber = await api("/api/restore", {
  method: "POST", body: JSON.stringify({ ...snapshot, base_revision: snapRev }),
});
check("an undo cannot overwrite another device's write", clobber.status === 409);
check("the other device's work is still there",
  (await api("/api/state")).json.tasks.length === otherDeviceCount);

// With an up-to-date revision it goes through as normal.
const freshSnap = (await api("/api/state")).json;
const freshRev = Number((await api("/api/state")).headers.get("X-Board-Revision"));
await api("/api/tasks", { method: "POST", body: JSON.stringify({ group: "Personal Tasks" }) });
check("board grew before the restore",
  (await api("/api/state")).json.tasks.length === freshSnap.tasks.length + 1);
const okRev = Number((await api("/api/state")).headers.get("X-Board-Revision"));
check("POST /api/restore with a current revision succeeds",
  (await api("/api/restore", { method: "POST", body: JSON.stringify({ ...freshSnap, base_revision: okRev }) })).json.ok === true);
const snapshot2 = freshSnap;
check("restore left the counter moving forward, not backward",
  Number((await api("/api/state")).headers.get("X-Board-Revision")) > okRev);
const after = (await api("/api/state")).json;
check("restore put the task count back", after.tasks.length === snapshot2.tasks.length,
  `${after.tasks.length} vs ${snapshot2.tasks.length}`);
check("restore preserved the columns", after.columns.length === snapshot2.columns.length);
check("restore preserved the settings", after.settings.density === snapshot2.settings.density);
check("restore preserved the palette", after.palette.status.length === snapshot2.palette.status.length);

// ---------------------------------------------------------------- routing
section("routing");
check("an unknown /api path 404s", (await api("/api/nope")).status === 404);
check("a wrong method 404s", (await api("/api/state", { method: "DELETE" })).status === 404);
check("a missing upload 404s", (await fetch(BASE + "/static/uploads/nothing.png")).status === 404);
check("API responses are marked no-store",
  (await fetch(BASE + "/api/state")).headers.get("cache-control") === "no-store");

// ----------------------------------------------------------------
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
