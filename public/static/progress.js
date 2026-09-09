/* Tuned In — progress over time.

   Nothing new is recorded to make this work. The server already stamps
   __done_date on a task the moment its status reads Done, and tasks already
   carry idea:/pillar: tags, so where the effort actually went has been on
   record all along — it has just never been drawn. These charts read that
   history, which is why they are full the first time they are opened instead
   of starting empty from today.

   Two things live here:
     - renderProgress(), the Progress subview of Goals: momentum, week by week
     - gpGoalActivity(), the sparkline the goal detail page shows

   Counting rules, which differ from the goal tallies elsewhere in Goals for a
   reason: a subtask counts as its own piece of finished work (on a real board
   half the completions are subtasks, so dropping them loses most of the
   picture) and inherits its parent's values when it carries none of its own.
   A task the automations copied into three groups is still one piece of work,
   as it is everywhere else.
*/

const GP_DAY = 86400000;
const GP_RANGES = [[12, "12 weeks"], [26, "26 weeks"], [52, "1 year"]];

// Colours for the three buckets, taken from the app's existing palette so they
// sit correctly in both themes.
const GP_SCOPE_COLORS = { "": "#00859b", personal: "#77b28c", ventures: "#e0a92a" };
const GP_UNTAGGED = { key: "__none", label: "Untagged", color: "#b3b3b3" };
// Work filed under a section that has since been deleted. Rolling it into
// Untagged would be a lie — it WAS tagged — and showing the bare key is noise,
// so it gets its own row.
const GP_RETIRED = { key: "__retired", label: "Retired values", color: "#c2ad97" };

let gpWeeks = (() => { try { return Number(localStorage.getItem("rs_gp_weeks")) || 12; } catch (e) { return 12; } })();
let gpSplit = (() => { try { return localStorage.getItem("rs_gp_split") || "scope"; } catch (e) { return "scope"; } })();

function gpEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------- dates
function gpTodayYMD() {
  if (typeof todayYMD === "function") return todayYMD();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Monday of the week containing a YYYY-MM-DD, as YYYY-MM-DD. Weeks are
 *  the bucket because a day is too noisy to read and a month is too coarse to
 *  act on. */
function gpWeekStart(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7;     // Monday = 0
  return new Date(t - dow * GP_DAY).toISOString().slice(0, 10);
}

/** The last `n` week-start keys, oldest first, ending with the current week. */
function gpWeekKeys(n) {
  const t0 = Date.parse(gpWeekStart(gpTodayYMD()) + "T00:00:00Z");
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t0 - i * 7 * GP_DAY).toISOString().slice(0, 10));
  return out;
}

function gpDaysAgo(ymd) {
  const t = Date.parse(String(ymd).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.parse(gpTodayYMD() + "T00:00:00Z") - t) / GP_DAY));
}

function gpWhenLabel(ymd) {
  const n = gpDaysAgo(ymd);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 7) return n + " days ago";
  if (n < 14) return "last week";
  if (n < 60) return Math.round(n / 7) + " weeks ago";
  return Math.round(n / 30) + " months ago";
}

// ---------------------------------------------------------------- the data
function gpPillarExists(key) {
  return !!key && (gsPillars() || []).some((p) => p.key === key);
}

/** The tags that apply to a task: its own, or the nearest ancestor's if it has
 *  none of its own.
 *
 *  A subtask created under a tagged parent starts with empty goal columns, but
 *  finishing it plainly advances the parent's goals. On a real board half the
 *  completed work is subtasks, so treating them as untagged would throw away
 *  most of the picture. */
function gpTagsFor(t, byId) {
  let cur = t;
  let guard = 0;
  while (cur && guard++ < 32) {
    const tags = typeof taskGoalTags === "function" ? taskGoalTags(cur) : [];
    if (tags.length) return tags;
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return [];
}

/** Every completed, dated piece of work, with the values and goals it carries.
 *  Subtasks count as their own piece of work; a task the automations copied
 *  into several groups counts once. */
function gpCompletions() {
  const byId = new Map((STATE.tasks || []).map((t) => [t.id, t]));
  const out = [];
  const seenLink = new Set();
  (STATE.tasks || []).forEach((t) => {
    const when = String(t.cells["__done_date"] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) return; // never finished, or finished before stamping existed
    if (t.link_id) {                               // one task, several placements
      if (seenLink.has(t.link_id)) return;
      seenLink.add(t.link_id);
    }
    const tags = gpTagsFor(t, byId);
    const all = [...new Set(tags.map((x) => goalTagPillar(x)).filter(Boolean))];
    const pillars = all.filter(gpPillarExists);
    const ideas = [...new Set(tags.filter((x) => x.startsWith("idea:")).map((x) => x.slice(5)))];
    // Tagged, but every section it pointed at has been deleted since.
    const retired = !pillars.length && all.length > 0;
    out.push({ when, week: gpWeekStart(when), pillars, ideas, retired, task: t });
  });
  return out;
}

/** Which bucket a completion counts toward. A task tagged across two sections
 *  counts once, under the first — otherwise the bars would total more than the
 *  work actually done. */
function gpSeriesKey(c) {
  if (!c.pillars.length) return c.retired ? GP_RETIRED.key : GP_UNTAGGED.key;
  if (gpSplit === "section") return c.pillars[0];
  return typeof gsScopeOf === "function" ? gsScopeOf(c.pillars[0]) : "";
}

/** [{key,label,color,counts[],total}] aligned to `weeks`, biggest first. */
function gpSeries(weeks, completions) {
  const idx = Object.fromEntries(weeks.map((w, i) => [w, i]));
  const rows = new Map();
  const blank = () => new Array(weeks.length).fill(0);

  const meta = (key) => {
    if (key === GP_UNTAGGED.key) return GP_UNTAGGED;
    if (key === GP_RETIRED.key) return GP_RETIRED;
    if (gpSplit === "section") { const p = gsP(key); return { key, label: p.label, color: p.color }; }
    return {
      key,
      label: typeof gsScopeLabel === "function" ? gsScopeLabel(key) : (key || "Professional"),
      color: GP_SCOPE_COLORS[key] || GP_UNTAGGED.color,
    };
  };

  completions.forEach((c) => {
    const i = idx[c.week];
    if (i === undefined) return;                   // outside the window
    const key = gpSeriesKey(c);
    if (!rows.has(key)) rows.set(key, { ...meta(key), counts: blank(), total: 0 });
    const row = rows.get(key);
    row.counts[i]++;
    row.total++;
  });

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------- drawing
// SVG is built as markup rather than through el(), which uses createElement and
// so cannot make SVG nodes. Everything interpolated is escaped.

/** A stacked weekly bar chart. Returns an <svg> string sized by viewBox, so it
 *  scales to whatever width the column gives it. */
function gpBarsSvg(weeks, series) {
  const W = 760, H = 210, padL = 30, padR = 6, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const totals = weeks.map((_, i) => series.reduce((s, r) => s + r.counts[i], 0));
  const max = Math.max(1, ...totals);
  const step = plotW / weeks.length;
  const bw = Math.max(3, Math.min(26, step * 0.68));

  // A gridline at the top and the middle is enough to read height off.
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  let g = ticks.map((v) => {
    const y = padT + plotH - (v / max) * plotH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="gp-grid"/>` +
           `<text x="${padL - 6}" y="${y + 3.5}" class="gp-ytick">${v}</text>`;
  }).join("");

  weeks.forEach((wk, i) => {
    const x = padL + i * step + (step - bw) / 2;
    let y = padT + plotH;
    if (!totals[i]) {
      // A week with nothing in it is information too — show the baseline.
      g += `<rect x="${x}" y="${y - 1.5}" width="${bw}" height="1.5" class="gp-empty"><title>${gpEsc(wk)} · nothing completed</title></rect>`;
      return;
    }
    series.forEach((r) => {
      const n = r.counts[i];
      if (!n) return;
      const h = (n / max) * plotH;
      y -= h;
      g += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${gpEsc(r.color)}" class="gp-bar">` +
           `<title>${gpEsc(r.label)} · ${n} completed · week of ${gpEsc(wk)}</title></rect>`;
    });
  });

  // Month labels under the first week of each month, so a long range stays legible.
  let seenMonth = "";
  weeks.forEach((wk, i) => {
    const m = wk.slice(0, 7);
    if (m === seenMonth) return;
    seenMonth = m;
    const d = new Date(Date.parse(wk + "T00:00:00Z"));
    const label = d.toLocaleString(undefined, { month: "short", timeZone: "UTC" });
    g += `<text x="${padL + i * step + step / 2}" y="${H - 8}" class="gp-xtick">${gpEsc(label)}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="gp-svg" preserveAspectRatio="none" role="img">${g}</svg>`;
}

/** A small bar sparkline — used on goal detail pages. */
function gpSparklineSvg(counts, color) {
  const W = 104, H = 22, n = Math.max(1, counts.length);
  const max = Math.max(1, ...counts);
  const step = W / n, bw = Math.max(1.5, step * 0.68);
  const bars = counts.map((v, i) => {
    const h = v ? Math.max(2, (v / max) * (H - 3)) : 1;
    const x = i * step + (step - bw) / 2;
    return `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" fill="${gpEsc(v ? color : "#d8ddda")}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="gp-spark" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

function gpSvgBox(markup, cls) {
  const d = el("div", { class: cls || "" });
  d.innerHTML = markup;
  return d;
}

// ---------------------------------------------------------------- goal detail
/** Sparkline + last-activity line for one goal. Returns null when the goal has
 *  no completed work, so the detail page shows nothing rather than an empty
 *  chart pretending to be data. */
function gpGoalActivity(g) {
  gpInjectCss();
  const weeks = gpWeekKeys(12);
  const idx = Object.fromEntries(weeks.map((w, i) => [w, i]));
  const counts = new Array(weeks.length).fill(0);
  let total = 0, last = "";

  gpCompletions().forEach((c) => {
    if (!c.ideas.includes(g.id)) return;
    total++;
    if (c.when > last) last = c.when;
    const i = idx[c.week];
    if (i !== undefined) counts[i]++;
  });

  if (!total) return null;
  const color = (gsP(g.pillar) || {}).color || "#00859b";
  const row = el("div", { class: "gp-goalact" });
  row.append(gpSvgBox(gpSparklineSvg(counts, color), "gp-spark-wrap"));
  row.append(el("span", { class: "gp-goalact-txt" },
    `${total} completed · last ${gpWhenLabel(last)}`));
  row.append(el("span", { class: "gp-goalact-sub" }, "12 weeks"));
  return row;
}

// ---------------------------------------------------------------- the subview
function renderProgress() {
  gpInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "gp-wrap" });

  const head = el("div", { class: "gp-head" });
  head.append(el("div", {},
    el("div", { class: "gd-eyebrow" }, "PROGRESS"),
    el("h1", { class: "gp-h1" }, "Where the work actually went")));
  wrap.append(head);

  const completions = gpCompletions();
  if (!completions.length) {
    wrap.append(el("p", { class: "gp-empty-msg" },
      "Nothing to chart yet. A task is counted here once its status reads Done — " +
      "the date is stamped automatically, so this fills in as you finish work."));
    board.append(wrap);
    return;
  }

  // --- controls ---
  const bar = el("div", { class: "gd-rolebar" });
  GP_RANGES.forEach(([n, label]) => {
    bar.append(el("button", { class: "gd-role" + (gpWeeks === n ? " on" : ""),
      onClick: () => { gpWeeks = n; try { localStorage.setItem("rs_gp_weeks", String(n)); } catch (e) {} board.innerHTML = ""; renderGoals(); } }, label));
  });
  bar.append(el("span", { class: "gp-sep" }));
  [["scope", "By area"], ["section", "By value"]].forEach(([k, label]) => {
    bar.append(el("button", { class: "gd-role" + (gpSplit === k ? " on" : ""),
      onClick: () => { gpSplit = k; try { localStorage.setItem("rs_gp_split", k); } catch (e) {} board.innerHTML = ""; renderGoals(); } }, label));
  });
  wrap.append(bar);

  const weeks = gpWeekKeys(gpWeeks);
  const series = gpSeries(weeks, completions);
  const inRange = series.reduce((s, r) => s + r.total, 0);
  const perWeek = weeks.map((_, i) => series.reduce((s, r) => s + r.counts[i], 0));
  const active = perWeek.filter((n) => n).length;
  const best = Math.max(0, ...perWeek);

  // --- headline numbers ---
  const stats = el("div", { class: "gp-stats" });
  const stat = (n, label, hint) => {
    const c = el("div", { class: "gp-stat", title: hint || "" });
    c.append(el("div", { class: "gp-stat-n" }, String(n)));
    c.append(el("div", { class: "gp-stat-l" }, label));
    return c;
  };
  stats.append(stat(inRange, "completed", "Tasks finished in this window"));
  stats.append(stat((inRange / weeks.length).toFixed(1), "per week", "Average across the whole window, quiet weeks included"));
  stats.append(stat(best, "best week", "The most finished in any one week"));
  stats.append(stat(`${active}/${weeks.length}`, "weeks active", "Weeks with at least one task finished"));
  wrap.append(stats);

  // --- the chart ---
  wrap.append(gpSvgBox(gpBarsSvg(weeks, series), "gp-chart"));

  const legend = el("div", { class: "gp-legend" });
  series.forEach((r) => {
    const item = el("span", { class: "gp-leg" });
    item.append(el("span", { class: "gp-leg-sw", style: `background:${r.color}` }));
    item.append(el("span", {}, `${r.label} · ${r.total}`));
    legend.append(item);
  });
  wrap.append(legend);

  // --- per-value breakdown, always by section regardless of the split above ---
  const bySection = gpSectionRows(weeks, completions);
  if (bySection.length) {
    wrap.append(el("div", { class: "gp-block-h" }, "By value"));
    const table = el("div", { class: "gp-table" });
    bySection.forEach((r) => {
      const row = el("div", { class: "gp-row" });
      row.append(el("span", { class: "gp-row-sw", style: `background:${r.color}` }));
      const nm = el("span", { class: "gp-row-name" }, r.label);
      if (r.scopeLabel) nm.append(el("span", { class: "gd-rolechip", style: "margin-left:7px" }, r.scopeLabel));
      row.append(nm);
      row.append(gpSvgBox(gpSparklineSvg(r.counts, r.color), "gp-spark-wrap"));
      row.append(el("span", { class: "gp-row-n" }, String(r.total)));
      row.append(el("span", { class: "gp-row-when" }, r.last ? gpWhenLabel(r.last) : "—"));
      table.append(row);
    });
    wrap.append(table);
  }

  wrap.append(el("p", { class: "gp-note" },
    "Counts finished tasks by the day they were marked Done. A subtask counts as its own piece of " +
    "work and inherits its parent's values when it has none of its own; a task the automations copied " +
    "into several groups counts once. Work tagged only to a section you have since deleted shows as " +
    "Retired values, and work never tagged shows as Untagged."));

  board.append(wrap);
}

/** One row per value that has any completed work in the window, plus Untagged. */
function gpSectionRows(weeks, completions) {
  const idx = Object.fromEntries(weeks.map((w, i) => [w, i]));
  const rows = new Map();
  const ensure = (key) => {
    if (rows.has(key)) return rows.get(key);
    const synthetic = key === GP_UNTAGGED.key || key === GP_RETIRED.key;
    const p = key === GP_UNTAGGED.key ? GP_UNTAGGED : (key === GP_RETIRED.key ? GP_RETIRED : gsP(key));
    const scope = synthetic ? null : (typeof gsScopeOf === "function" ? gsScopeOf(key) : "");
    const r = {
      key, label: p.label, color: p.color,
      scopeLabel: scope === null ? "" : (typeof gsScopeLabel === "function" ? gsScopeLabel(scope) : ""),
      counts: new Array(weeks.length).fill(0), total: 0, last: "",
    };
    rows.set(key, r);
    return r;
  };

  completions.forEach((c) => {
    const i = idx[c.week];
    if (i === undefined) return;
    const key = c.pillars.length ? c.pillars[0] : (c.retired ? GP_RETIRED.key : GP_UNTAGGED.key);
    const r = ensure(key);
    r.counts[i]++;
    r.total++;
    if (c.when > r.last) r.last = c.when;
  });

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------- styles
function gpInjectCss() {
  if (document.getElementById("gp-css")) return;
  const css = `
  .gp-wrap{padding:16px 18px 60px;max-width:1180px;margin:0 auto}
  .gp-head{margin:8px 0 14px}
  .gp-h1{font-family:Georgia,serif;font-size:26px;margin:2px 0 0;color:var(--ink);font-weight:400}
  .gp-sep{width:1px;height:20px;background:var(--light-gray);margin:0 4px}
  .gp-stats{display:flex;gap:26px;flex-wrap:wrap;margin:16px 0 12px}
  .gp-stat{min-width:78px}
  .gp-stat-n{font-family:Georgia,serif;font-size:25px;color:var(--ink);line-height:1.1}
  .gp-stat-l{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9aa8a3;margin-top:2px}
  .gp-chart{border:1px solid var(--light-gray);border-radius:10px;background:var(--surface);padding:10px 8px 4px}
  .gp-svg{width:100%;height:210px;display:block}
  .gp-grid{stroke:var(--light-gray);stroke-width:1;opacity:.7}
  .gp-ytick{fill:#9aa8a3;font-size:10px;text-anchor:end;font-family:inherit}
  .gp-xtick{fill:#9aa8a3;font-size:10px;text-anchor:middle;font-family:inherit}
  .gp-bar{opacity:.92}
  .gp-bar:hover{opacity:1}
  .gp-empty{fill:var(--light-gray)}
  .gp-legend{display:flex;gap:14px;flex-wrap:wrap;margin:9px 2px 0;font-size:12px;color:#5d6b66}
  .gp-leg{display:inline-flex;align-items:center;gap:6px}
  .gp-leg-sw{width:10px;height:10px;border-radius:3px;display:inline-block}
  .gp-block-h{font-family:Georgia,serif;font-size:17px;color:var(--ink);margin:26px 0 8px}
  .gp-table{border:1px solid var(--light-gray);border-radius:10px;background:var(--surface);overflow:hidden}
  .gp-row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-top:1px solid var(--light-gray);font-size:13px;color:var(--ink)}
  .gp-row:first-child{border-top:none}
  .gp-row-sw{width:9px;height:9px;border-radius:3px;flex:none}
  .gp-row-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gp-row-n{width:34px;text-align:right;font-weight:700}
  .gp-row-when{width:92px;text-align:right;font-size:11.5px;color:#9aa8a3}
  .gp-spark-wrap{width:104px;flex:none;line-height:0}
  .gp-spark{width:104px;height:22px;display:block}
  .gp-note{font-size:11.5px;color:#9aa8a3;margin-top:14px;line-height:1.55;max-width:760px}
  .gp-empty-msg{font-size:13.5px;color:#5d6b66;max-width:620px;line-height:1.6}
  .gp-goalact{display:flex;align-items:center;gap:10px;margin:-2px 0 10px}
  .gp-goalact-txt{font-size:12.5px;color:#5d6b66}
  .gp-goalact-sub{font-size:11px;color:#9aa8a3}
  body.theme-dark .gp-empty{fill:#3a4441}
  body.theme-dark .gp-ytick,body.theme-dark .gp-xtick{fill:#7d8b86}
  `;
  const tag = document.createElement("style");
  tag.id = "gp-css";
  tag.textContent = css;
  document.head.append(tag);
}
