/* Tuned In — the day/calendar schedule API and the .ics importer.
   Ports the /api/schedule* routes and the _ics_* helpers from app.py.

   The one behavior that could not come across: the Flask build also scanned
   the app folder for a dropped .ics on every launch, and /api/schedule/rescan
   re-read it. A Worker has no app folder, so rescan now always answers
   "no file found" (the same JSON the Flask route returned on an empty folder,
   so the UI shows its normal toast) and the drag-and-drop / file-picker import
   is the way in. */

import {
  all, badRequest, batched, body, first, json, run, todayISO, uid, ymdInTz, hmInTz, tzOf,
} from "./lib.js";

// ---------------------------------------------------------------- blocks
export async function getSchedule(env, url) {
  const day = url.searchParams.get("day") || todayISO(env);
  const blocks = await all(
    env.DB, "SELECT * FROM schedule_blocks WHERE day = ? ORDER BY start", day);
  return json({ day, blocks });
}

/** All blocks between ?from= and ?to= (inclusive), for the Calendar month. */
export async function getScheduleRange(env, url) {
  const a = url.searchParams.get("from");
  const b = url.searchParams.get("to");
  if (!a || !b) return json({ blocks: [] });
  const blocks = await all(
    env.DB,
    "SELECT * FROM schedule_blocks WHERE day >= ? AND day <= ? ORDER BY day, start", a, b);
  return json({ blocks });
}

function clampMinutes(v, fallback = 30) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(15, Math.min(8 * 60, n));
}

/** Body: { day, start 'HH:MM', minutes, task_id?, label, color? }. */
export async function addScheduleBlock(env, request) {
  const data = await body(request);
  const day = (data.day || "").trim();
  const start = (data.start || "").trim();
  if (!day || !start) return badRequest("day and start required");
  const minutes = clampMinutes(data.minutes);
  const bid = "sb_" + uid();
  const label = (data.label || "").trim();
  await run(env.DB,
    "INSERT INTO schedule_blocks (id, day, start, minutes, task_id, label, color) VALUES (?,?,?,?,?,?,?)",
    bid, day, start, minutes, data.task_id ?? null, label, data.color ?? null);
  return json({ id: bid, day, start, minutes, task_id: data.task_id ?? null, label, color: data.color ?? null });
}

/** Move or resize a block. Body may include start, minutes, day, label. */
export async function updateScheduleBlock(env, request, bid) {
  const db = env.DB;
  const data = await body(request);
  const st = [];
  if ("start" in data) st.push(db.prepare("UPDATE schedule_blocks SET start = ? WHERE id = ?").bind(String(data.start), bid));
  if ("day" in data) st.push(db.prepare("UPDATE schedule_blocks SET day = ? WHERE id = ?").bind(String(data.day), bid));
  if ("minutes" in data) {
    const m = parseInt(data.minutes, 10);
    if (Number.isFinite(m)) {
      st.push(db.prepare("UPDATE schedule_blocks SET minutes = ? WHERE id = ?")
        .bind(Math.max(15, Math.min(8 * 60, m)), bid));
    }
  }
  if ("label" in data) st.push(db.prepare("UPDATE schedule_blocks SET label = ? WHERE id = ?").bind(String(data.label).trim(), bid));
  await batched(db, st);
  return json({ ok: true });
}

export async function deleteScheduleBlock(env, bid) {
  await run(env.DB, "DELETE FROM schedule_blocks WHERE id = ?", bid);
  return json({ ok: true });
}

// ---------------------------------------------------------------- auto-plan
function toMin(s, fallback) {
  const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return Math.max(0, Math.min(24 * 60, +m[1] * 60 + +m[2]));
}

const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Compute the free gaps inside [winA, winB) around a list of busy [a,b) spans.
 *  Exported for the unit tests — it is the whole substance of auto-planning. */
export function freeGaps(busy, winA, winB) {
  const sorted = [...busy].sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let cursor = winA;
  for (const [a, b] of sorted) {
    if (b <= cursor || a >= winB) continue;
    if (a > cursor) gaps.push([cursor, Math.min(a, winB)]);
    cursor = Math.max(cursor, b);
    if (cursor >= winB) break;
  }
  if (cursor < winB) gaps.push([cursor, winB]);
  return gaps.filter((g) => g[1] - g[0] >= 15);
}

/** Drops the items into the day's free gaps, in the order given, working around
 *  every block already on that day (imported events, blocked-off time, and
 *  blocks placed by hand). Any previous auto-planned blocks for the day are
 *  cleared first, so re-planning replaces rather than stacks. An item that
 *  doesn't fit anywhere is reported back in `unplaced`. */
export async function autoplanDay(env, request) {
  const db = env.DB;
  const data = await body(request);
  const day = (data.day || "").trim();
  if (!day) return badRequest("day required");

  const winA = toMin(data.window_start, 8 * 60);
  const winB = toMin(data.window_end, 18 * 60);
  if (winB <= winA) return badRequest("window_end must be after window_start");

  // Clear this day's previous auto-plan, then read what's left as obstacles.
  await run(db, "DELETE FROM schedule_blocks WHERE day = ? AND auto = 1", day);
  const busy = [];
  for (const r of await all(db, "SELECT start, minutes FROM schedule_blocks WHERE day = ?", day)) {
    const a = toMin(r.start, null);
    if (a === null) continue;
    busy.push([a, a + Math.max(15, parseInt(r.minutes, 10) || 30)]);
  }
  const gaps = freeGaps(busy, winA, winB);

  const placed = [];
  const unplaced = [];
  const st = [];
  for (const item of data.items || []) {
    let mins = clampMinutes(item.minutes);
    mins = Math.floor(mins / 15) * 15 || 15; // snap to the 15-minute grid
    const spot = gaps.find((g) => g[1] - g[0] >= mins);
    if (!spot) { unplaced.push(item.label || ""); continue; }
    const start = spot[0];
    spot[0] += mins;
    const bid = "sb_" + uid();
    const label = (item.label || "").trim();
    st.push(db.prepare(
      "INSERT INTO schedule_blocks (id, day, start, minutes, task_id, label, color, auto) VALUES (?,?,?,?,?,?,?,1)")
      .bind(bid, day, hhmm(start), mins, item.task_id ?? null, label, item.color ?? null));
    placed.push({ id: bid, start: hhmm(start), minutes: mins, label });
  }
  await batched(db, st);
  return json({ ok: true, placed, unplaced, day });
}

/** Remove the auto-planned blocks for ?day= (leaves everything else). */
export async function clearAutoplan(env, url) {
  const day = (url.searchParams.get("day") || "").trim();
  if (!day) return badRequest("day required");
  const row = await first(
    env.DB, "SELECT COUNT(*) AS n FROM schedule_blocks WHERE day = ? AND auto = 1", day);
  await run(env.DB, "DELETE FROM schedule_blocks WHERE day = ? AND auto = 1", day);
  return json({ ok: true, removed: row ? row.n : 0 });
}

// ---------------------------------------------------------------- .ics parsing
/** RFC 5545 line folding: a CRLF followed by a space/tab continues the line. */
export function icsUnfold(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if ((line[0] === " " || line[0] === "\t") && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** Return [ 'YYYY-MM-DD', 'HH:MM' | null ] — null time means all-day.
 *
 *  Timestamps ending in 'Z' are UTC (Outlook exports this way) and are
 *  converted to the configured display zone — otherwise every event reads hours
 *  off, e.g. 20:00Z showing as 8 PM instead of 3 PM in Central. The conversion
 *  can move the DATE as well as the time, so both are recomputed together.
 *  Timestamps without 'Z' (TZID or floating) are already wall-clock and are
 *  taken as written.
 *
 *  On the Flask build the target zone was the host machine's. Here it is the
 *  TZ var (defaulting to UTC), which is what makes an imported Outlook
 *  calendar land at the right hour on a Worker. */
export function icsParseDT(val, tz = "UTC") {
  const v = String(val).trim();
  if (!v.includes("T")) { // all-day (VALUE=DATE)
    if (v.length >= 8 && /^\d{8}$/.test(v.slice(0, 8))) {
      return [`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, null];
    }
    return [null, null];
  }
  const i = v.indexOf("T");
  const datePart = v.slice(0, i);
  const timePart = v.slice(i + 1);
  if (datePart.length < 8 || !/^\d{8}$/.test(datePart.slice(0, 8))) return [null, null];
  const day = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  const hh = timePart.slice(0, 2).padStart(2, "0");
  const mm = (timePart.slice(2, 4) || "00").padStart(2, "0");

  if (timePart.trim().toUpperCase().endsWith("Z")) {
    const ms = Date.UTC(+datePart.slice(0, 4), +datePart.slice(4, 6) - 1, +datePart.slice(6, 8), +hh, +mm);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      try {
        return [ymdInTz(d, tz), hmInTz(d, tz)];
      } catch {
        /* unknown zone — fall through and take the timestamp as written */
      }
    }
  }
  return [day, `${hh}:${mm}`];
}

/** Parse .ics text into { uid, summary, day, start, minutes, all_day, rrule }. */
export function icsEvents(text, tz = "UTC") {
  const events = [];
  let cur = null;
  for (const raw of icsUnfold(text)) {
    if (raw === "BEGIN:VEVENT") { cur = {}; continue; }
    if (raw === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur || !raw.includes(":")) continue;
    const idx = raw.indexOf(":");
    const key = raw.slice(0, idx);
    const value = raw.slice(idx + 1);
    const name = key.split(";")[0].toUpperCase();
    if (name === "SUMMARY") {
      cur.summary = value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
    } else if (name === "UID") {
      cur.uid = value.trim();
    } else if (name === "DTSTART") {
      const [d, t] = icsParseDT(value, tz);
      cur.day = d; cur.start = t; cur.all_day = t === null;
    } else if (name === "DTEND") {
      const [d, t] = icsParseDT(value, tz);
      cur.end_day = d; cur.end_start = t;
    } else if (name === "RRULE") {
      cur.rrule = value.trim();
    }
  }

  const out = [];
  for (const e of events) {
    if (!e.day) continue;
    let mins = 30;
    if (e.start && e.end_start) {
      const [sh, sm] = e.start.split(":").map(Number);
      const [eh, em] = e.end_start.split(":").map(Number);
      let base = (eh * 60 + em) - (sh * 60 + sm);
      if (e.end_day && e.end_day !== e.day) base += 24 * 60; // spans midnight; clamped below
      if (Number.isFinite(base)) mins = Math.max(15, Math.min(8 * 60, base || 30));
    }
    e.minutes = mins;
    out.push(e);
  }
  return out;
}

const DAY_MS = 86400000;
const toDate = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toYMD = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Expand a simple RRULE (DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, weekly
 *  BYDAY) into occurrence dates within the window. Returns [base_day] when
 *  there's no rrule. Port of _expand_rrule. */
export function expandRrule(e, windowStart, windowEnd, cap = 200) {
  const base = toDate(e.day);
  const wStart = toDate(windowStart);
  const wEnd = toDate(windowEnd);
  if (!e.rrule) {
    if (base >= wStart && base <= wEnd) return [e.day];
    return base >= wStart ? [e.day] : [];
  }

  const parts = {};
  for (const kv of e.rrule.split(";")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).toUpperCase();
  }
  const freq = parts.FREQ || "";
  const interval = parseInt(parts.INTERVAL || "1", 10) || 1;
  const count = /^\d+$/.test(parts.COUNT || "") ? parseInt(parts.COUNT, 10) : null;
  let until = null;
  if (parts.UNTIL && /^\d{8}/.test(parts.UNTIL)) {
    const u = parts.UNTIL;
    until = Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8));
  }
  const DOW = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
  const bydays = (parts.BYDAY || "").split(",").filter((x) => x in DOW).map((x) => DOW[x]);

  const dates = [];
  let produced = 0;
  let guard = 0;

  if (freq === "WEEKLY" && bydays.length) {
    // Walk week by week from the base week start, emitting selected weekdays.
    // getUTCDay() is Sunday-0; the Python used Monday-0, so shift it.
    const baseDow = (new Date(base).getUTCDay() + 6) % 7;
    const weekStart = base - baseDow * DAY_MS;
    let wk = 0;
    while (guard++ < 4000 && dates.length < cap) {
      if (wk % interval === 0) {
        for (const dow of [...bydays].sort((a, b) => a - b)) {
          const d = weekStart + (dow + wk * 7) * DAY_MS;
          if (d < base) continue;
          if (until && d > until) return dates;
          produced++;
          if (count && produced > count) return dates;
          if (d >= wStart && d <= wEnd) dates.push(toYMD(d));
        }
      }
      wk++;
      const weekAt = weekStart + wk * 7 * DAY_MS;
      if (weekAt > wEnd && (!until || weekAt > until)) break;
    }
    return dates;
  }

  // DAILY / WEEKLY (no byday) / MONTHLY
  let cur = base;
  while (guard++ < 4000 && dates.length < cap) {
    if (until && cur > until) break;
    produced++;
    if (count && produced > count) break;
    if (cur >= wStart && cur <= wEnd) dates.push(toYMD(cur));
    if (cur > wEnd && !until) break;
    if (freq === "DAILY") cur += interval * DAY_MS;
    else if (freq === "WEEKLY") cur += interval * 7 * DAY_MS;
    else if (freq === "MONTHLY") {
      const d = new Date(cur);
      const m = d.getUTCMonth() + interval;
      const y = d.getUTCFullYear() + Math.floor(m / 12);
      const mo = ((m % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      cur = Date.UTC(y, mo, Math.min(d.getUTCDate(), lastDay));
    } else break;
  }
  return dates;
}

/** Parse .ics text and (re)populate imported schedule blocks. Replaces any
 *  previous import. Port of _do_ics_import. */
async function doIcsImport(env, text) {
  const db = env.DB;
  const tz = tzOf(env);
  const events = icsEvents(text, tz);
  const todayMs = toDate(todayISO(env));
  const winStart = toYMD(todayMs - 14 * DAY_MS);
  const winEnd = toYMD(todayMs + 120 * DAY_MS);

  // Clear any previous import so this one replaces it.
  await run(db, "DELETE FROM schedule_blocks WHERE src_uid IS NOT NULL");

  let added = 0;
  let skippedAllday = 0;
  const TOTAL_CAP = 3000;
  const st = [];
  for (const e of events) {
    if (e.all_day) { skippedAllday++; continue; }
    if (!e.start) continue;
    const srcUid = e.uid || ("ics_" + uid());
    const label = e.summary || "(no title)";
    for (const day of expandRrule(e, winStart, winEnd)) {
      if (added >= TOTAL_CAP) break;
      st.push(db.prepare(
        "INSERT INTO schedule_blocks (id, day, start, minutes, task_id, label, color, src_uid) VALUES (?,?,?,?,?,?,?,?)")
        .bind("sb_" + uid(), day, e.start, e.minutes ?? 30, null, label, "#5d7479", srcUid));
      added++;
    }
  }
  await batched(db, st);
  return { added, events: events.length, skipped_allday: skippedAllday };
}

/** Body: { ics: '<file text>' }. Parses timed events into schedule blocks on
 *  both Today and Calendar. Re-importing replaces the previous import. */
export async function importScheduleIcs(env, request) {
  const data = await body(request);
  const text = data.ics || "";
  if (!text.includes("BEGIN:VEVENT")) {
    return badRequest("That doesn't look like a calendar (.ics) file.");
  }
  const res = await doIcsImport(env, text);
  return json({ ok: true, ...res });
}

export async function clearImportedSchedule(env) {
  const row = await first(
    env.DB, "SELECT COUNT(*) AS n FROM schedule_blocks WHERE src_uid IS NOT NULL");
  await run(env.DB, "DELETE FROM schedule_blocks WHERE src_uid IS NOT NULL");
  return json({ ok: true, removed: row ? row.n : 0 });
}

/** The local build re-read an .ics saved into the app folder. A Worker has no
 *  app folder, so this answers exactly what the Flask route answered when the
 *  folder held no .ics — the UI already handles that case with a toast. */
export async function rescanCalendarFolder() {
  return json({ ok: true, added: 0, found: false, name: null });
}
