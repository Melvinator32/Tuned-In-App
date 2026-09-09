/* Unit tests for the pure logic ported out of app.py.
 *
 * These are the parts where a translation slip would be silent: the automation
 * engine, the points sum, the Done stamp, the .ics parser (including the UTC
 * conversion and RRULE expansion) and the auto-plan gap finder. Anything that
 * needs D1 is covered by `wrangler dev` instead — see CLOUDFLARE.md.
 *
 *   node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyAutomations, computePoints, stampDone, ymdInTz, hmInTz, todayISO,
  parseNaiveISO, nowISO, uid, DONE_DATE_KEY,
} from "../src/lib.js";
import { icsUnfold, icsParseDT, icsEvents, expandRrule, freeGaps } from "../src/schedule.js";

// ---------------------------------------------------------------- automations
const AUTOS = [
  { enabled: 1, trigger_col: "c_status", trigger_val: "Done", action_col: "c_due", action_type: "moveToGroup", action_val: "Done" },
  { enabled: 1, trigger_col: "c_status", trigger_val: "Working On It", action_col: "c_due", action_type: "setToday", action_val: "" },
  { enabled: 0, trigger_col: "c_status", trigger_val: "Not Started", action_col: "c_due", action_type: "setValue", action_val: "nope" },
];

test("moveToGroup moves the task, leaving cells alone", () => {
  const res = applyAutomations(
    { cells: { c_status: "Done" }, group_name: "All Active Tasks" }, AUTOS, "2026-09-04");
  assert.equal(res.group_name, "Done");
  assert.equal(res.cells.c_due, undefined);
});

test("setToday stamps the action column with today", () => {
  const res = applyAutomations(
    { cells: { c_status: "Working On It" }, group_name: "G" }, AUTOS, "2026-09-04");
  assert.equal(res.cells.c_due, "2026-09-04");
  assert.equal(res.group_name, "G");
});

test("a disabled rule never fires", () => {
  const res = applyAutomations(
    { cells: { c_status: "Not Started" }, group_name: "G" }, AUTOS, "2026-09-04");
  assert.equal(res.cells.c_due, undefined);
});

test("trigger comparison is by string, matching the Python", () => {
  const rules = [{ enabled: 1, trigger_col: "n", trigger_val: "3", action_col: "x", action_type: "clear", action_val: "" }];
  const res = applyAutomations({ cells: { n: 3, x: "keep" }, group_name: "G" }, rules, "2026-09-04");
  assert.equal(res.cells.x, "");
});

// ---------------------------------------------------------------- done stamp
const COLS = [{ id: "c_status", type: "status" }, { id: "c_name", type: "text" }];

test("the done stamp is set once and preserved", () => {
  const cells = { c_status: "Done" };
  stampDone(cells, COLS, "2026-09-04");
  assert.equal(cells[DONE_DATE_KEY], "2026-09-04");
  stampDone(cells, COLS, "2026-09-05"); // a later edit must not re-stamp
  assert.equal(cells[DONE_DATE_KEY], "2026-09-04");
});

test("leaving Done clears the stamp", () => {
  const cells = { c_status: "Done" };
  stampDone(cells, COLS, "2026-09-04");
  cells.c_status = "Working On It";
  stampDone(cells, COLS, "2026-09-04");
  assert.equal(DONE_DATE_KEY in cells, false);
});

// ---------------------------------------------------------------- points
test("points count only Done tasks, minus redemptions", () => {
  const columns = [
    { id: "c_status", type: "status", name: "Status" },
    { id: "c_pts", type: "number", name: "Points" },
  ];
  const tasks = [
    { cells: { c_status: "Done", c_pts: 5 } },
    { cells: { c_status: "Done", c_pts: "2.9" } },   // truncated, as int(float(...)) did
    { cells: { c_status: "Working On It", c_pts: 100 } },
    { cells: { c_status: "Done", c_pts: "" } },      // blank contributes nothing
  ];
  const pts = computePoints(columns, tasks, [{ cost: 3 }]);
  assert.deepEqual(pts, { earned: 7, redeemed: 3, balance: 4, points_col: "c_pts" });
});

test("no Points column means no points", () => {
  const pts = computePoints([{ id: "s", type: "status", name: "Status" }],
    [{ cells: { s: "Done" } }], []);
  assert.deepEqual(pts, { earned: 0, redeemed: 0, balance: 0, points_col: null });
});

// ---------------------------------------------------------------- clock
test("ymdInTz / hmInTz convert a UTC instant into the target zone", () => {
  const d = new Date("2026-09-05T01:30:00Z"); // still Sept 4 in Central
  assert.equal(ymdInTz(d, "America/Chicago"), "2026-09-04");
  assert.equal(hmInTz(d, "America/Chicago"), "20:30");
  assert.equal(ymdInTz(d, "UTC"), "2026-09-05");
});

test("todayISO returns a plain YYYY-MM-DD", () => {
  assert.match(todayISO({ TZ: "America/Chicago" }), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(todayISO({}), /^\d{4}-\d{2}-\d{2}$/); // no TZ var → UTC
});

test("nowISO round-trips through parseNaiveISO", () => {
  const s = nowISO({ TZ: "UTC" }, { seconds: true });
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const ms = parseNaiveISO(s);
  assert.ok(Number.isFinite(ms));
  assert.ok(Math.abs(ms - Date.now()) < 5000);
  assert.ok(Number.isNaN(parseNaiveISO("not a date")));
});

test("uid is 10 hex characters, like os.urandom(5).hex()", () => {
  assert.match(uid(), /^[0-9a-f]{10}$/);
  assert.notEqual(uid(), uid());
});

// ---------------------------------------------------------------- ics
test("unfolding rejoins RFC 5545 continuation lines", () => {
  assert.deepEqual(icsUnfold("SUMMARY:Long\r\n  title\r\nUID:x"), ["SUMMARY:Long title", "UID:x"]);
});

test("a Z timestamp is converted into the configured zone", () => {
  // 20:00 UTC is 15:00 in Central on a summer date — the bug the parser fixes.
  assert.deepEqual(icsParseDT("20260904T200000Z", "America/Chicago"), ["2026-09-04", "15:00"]);
  // ...and the conversion can move the date too.
  assert.deepEqual(icsParseDT("20260905T013000Z", "America/Chicago"), ["2026-09-04", "20:30"]);
});

test("a floating / TZID timestamp is taken as written", () => {
  assert.deepEqual(icsParseDT("20260904T090000", "America/Chicago"), ["2026-09-04", "09:00"]);
});

test("an all-day value has no time", () => {
  assert.deepEqual(icsParseDT("20260904", "UTC"), ["2026-09-04", null]);
});

const SAMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:evt-1",
  "SUMMARY:Standup\\, daily",
  "DTSTART:20260904T140000Z",
  "DTEND:20260904T143000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-2",
  "SUMMARY:Company holiday",
  "DTSTART;VALUE=DATE:20260907",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("events parse with duration, escapes and the all-day flag", () => {
  const evs = icsEvents(SAMPLE_ICS, "UTC");
  assert.equal(evs.length, 2);
  assert.equal(evs[0].summary, "Standup, daily");
  assert.equal(evs[0].start, "14:00");
  assert.equal(evs[0].minutes, 30);
  assert.equal(evs[0].all_day, false);
  assert.equal(evs[1].all_day, true);
});

test("a missing DTEND falls back to 30 minutes", () => {
  const evs = icsEvents("BEGIN:VEVENT\nUID:a\nDTSTART:20260904T090000\nEND:VEVENT", "UTC");
  assert.equal(evs[0].minutes, 30);
});

// ---------------------------------------------------------------- rrule
test("no rrule yields the single day", () => {
  assert.deepEqual(expandRrule({ day: "2026-09-04" }, "2026-09-01", "2026-09-30"), ["2026-09-04"]);
});

test("DAILY with INTERVAL and COUNT", () => {
  assert.deepEqual(
    expandRrule({ day: "2026-09-01", rrule: "FREQ=DAILY;INTERVAL=2;COUNT=3" }, "2026-09-01", "2026-09-30"),
    ["2026-09-01", "2026-09-03", "2026-09-05"]);
});

test("DAILY stops at UNTIL", () => {
  assert.deepEqual(
    expandRrule({ day: "2026-09-01", rrule: "FREQ=DAILY;UNTIL=20260903" }, "2026-09-01", "2026-09-30"),
    ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("WEEKLY BYDAY emits the selected weekdays, never before the base day", () => {
  // 2026-09-02 is a Wednesday.
  const out = expandRrule(
    { day: "2026-09-02", rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4" }, "2026-09-01", "2026-09-30");
  assert.deepEqual(out, ["2026-09-02", "2026-09-07", "2026-09-09", "2026-09-14"]);
  assert.ok(out.every((d) => d >= "2026-09-02"));
});

test("MONTHLY clamps to the length of a short month, then keeps the clamped day", () => {
  // Matches _expand_rrule in the legacy app.py: it advances a mutable cursor,
  // so once Jan 31 clamps to Feb 28 the series stays on the 28th rather than
  // springing back. Faithful-to-the-original beats RFC-correct here — changing
  // it would move blocks on boards that already imported a monthly series.
  assert.deepEqual(
    expandRrule({ day: "2026-01-31", rrule: "FREQ=MONTHLY;COUNT=3" }, "2026-01-01", "2026-12-31"),
    ["2026-01-31", "2026-02-28", "2026-03-28"]);
});

test("occurrences outside the window are dropped", () => {
  const out = expandRrule(
    { day: "2026-09-01", rrule: "FREQ=DAILY;COUNT=20" }, "2026-09-05", "2026-09-07");
  assert.deepEqual(out, ["2026-09-05", "2026-09-06", "2026-09-07"]);
});

// ---------------------------------------------------------------- auto-plan
test("gaps are the free time around busy blocks", () => {
  // 08:00-18:00 window, meetings 09:00-10:00 and 13:00-14:00.
  assert.deepEqual(freeGaps([[540, 600], [780, 840]], 480, 1080),
    [[480, 540], [600, 780], [840, 1080]]);
});

test("overlapping blocks merge", () => {
  assert.deepEqual(freeGaps([[540, 660], [600, 720]], 480, 1080), [[480, 540], [720, 1080]]);
});

test("gaps shorter than 15 minutes are discarded", () => {
  assert.deepEqual(freeGaps([[490, 600]], 480, 600), []);
});

test("a fully free day is one gap", () => {
  assert.deepEqual(freeGaps([], 480, 1080), [[480, 1080]]);
});

test("blocks outside the window do not carve it up", () => {
  assert.deepEqual(freeGaps([[0, 60], [1200, 1300]], 480, 1080), [[480, 1080]]);
});
