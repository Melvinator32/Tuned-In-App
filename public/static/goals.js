/* Radio Station — goals.js
   Goals — operating system, pillars & framework, goal dashboard/detail, Map, momentum
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

/* ===========================================================
   Goals — the operating system behind the board
   A native Radio Station view. State persists as a single JSON
   blob in settings["goals_os"] via the existing /api/settings
   endpoint — no schema or backend changes.
   =========================================================== */

const GOALS_KEY = "goals_os";

// Personal content lives in the active profile, not in shared code: the seeds
// below differ between the personal build and the one handed out, and only the
// chosen profile is ever uploaded. A build with no profile — running from
// source, or the single-file demo — gets the generic fallback.
function gsSeed(key, fallback) {
  const s = (typeof window !== "undefined" && window.PROFILE && window.PROFILE.seeds) || {};
  return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : fallback;
}

const GS_PILLAR_SEED = gsSeed("GS_PILLAR_SEED", [
    { key: "craft",    label: "Craft",         color: "#00859b", weight: 25, why: "The work itself, done well.", base: true },
    { key: "growth",   label: "Growth",        color: "#77b28c", weight: 25, why: "Getting better on purpose rather than by accident.", base: true },
    { key: "people",   label: "People",        color: "#e2725b", weight: 25, why: "Relationships that outlast any one project.", base: true },
    { key: "wellbeing",label: "Wellbeing",     color: "#bce194", weight: 25, why: "The health and attention everything else runs on.", base: true },
  ]);
const GS_PILLAR_PALETTE = ["#bce194", "#e0a92a", "#d36b6b", "#6a8caf", "#a36ba8", "#4f9d7f"];
// Old pillar keys → new focus-area keys, for migrating saved assignments.
const GS_PILLAR_MIGRATE = { own: "auto", proc: "prof" };
function gsPillars() { if (!GOALS.pillars || !GOALS.pillars.length) GOALS.pillars = GS_PILLAR_SEED.map((p) => ({ ...p })); return GOALS.pillars; }
function gsPillarMap() { const m = {}; gsPillars().forEach((p) => (m[p.key] = p)); return m; }
function gsP(key) { return gsPillarMap()[key] || { key: key, label: key || "Unassigned", color: "#b3b3b3", weight: 0, why: "", base: false }; }
function gsNextPillarColor() { const used = new Set(gsPillars().map((p) => p.color)); return GS_PILLAR_PALETTE.find((c) => !used.has(c)) || ("#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")); }
// Count board tasks tagged (via the Goal column) to a pillar — directly, or to
// any idea that rolls up to it. Deduped by name. Used for the Goals tally.
// ---- Hide / unhide pillars and ideas (kept, not deleted) ----
function gsPillarHidden(key) { return ((GOALS && GOALS.hiddenPillars) || []).includes(key); }
function gsIdeaHidden(id) {
  // Effectively hidden if the idea itself or any ancestor idea is hidden.
  const hid = (GOALS && GOALS.hiddenIdeas) || [];
  const ideas = (GOALS && GOALS.ideas) || [];
  let cur = ideas.find((x) => x.id === id);
  const seen = new Set();
  while (cur) {
    if (hid.includes(cur.id)) return true;
    if (!cur.parent || seen.has(cur.parent)) break;
    seen.add(cur.parent);
    cur = ideas.find((x) => x.id === cur.parent);
  }
  return false;
}
function gsToggleHidePillar(key) {
  GOALS.hiddenPillars = GOALS.hiddenPillars || [];
  const i = GOALS.hiddenPillars.indexOf(key);
  if (i >= 0) GOALS.hiddenPillars.splice(i, 1); else GOALS.hiddenPillars.push(key);
  saveGoals(true);
}
function gsToggleHideIdea(id) {
  GOALS.hiddenIdeas = GOALS.hiddenIdeas || [];
  const i = GOALS.hiddenIdeas.indexOf(id);
  if (i >= 0) GOALS.hiddenIdeas.splice(i, 1); else GOALS.hiddenIdeas.push(id);
  saveGoals(true);
}

function gsPillarProjectTally(pk) {
  let n = 0;
  (STATE.projects || []).forEach((p) => {
    if (parseGoalTags(p.tags).some((tag) => goalTagPillar(tag) === pk)) n++;
  });
  return n;
}

function gsPillarTaskTally(pk) {
  if (!goalColIds().length) return { total: 0, done: 0 };
  const statusCol = STATE.columns.find((c) => c.type === "status");
  const pcol = STATE.columns.find((c) => c.is_primary) || STATE.columns[0];
  const seen = new Set();
  let total = 0, done = 0;
  STATE.tasks.filter((t) => !t.parent_id).forEach((t) => {
    const tags = taskGoalTags(t);
    if (!tags.some((tag) => goalTagPillar(tag) === pk)) return;
    const nm = (pcol ? String(t.cells[pcol.id] || "") : "").trim().toLowerCase();
    const key = nm || t.id;
    if (seen.has(key)) return;
    seen.add(key);
    total++;
    if (statusCol && t.cells[statusCol.id] === "Done") done++;
  });
  return { total, done };
}

function gsNormalizePillars() {
  const saved = Array.isArray(GOALS.pillars) ? GOALS.pillars : [];
  const byKey = {};
  saved.forEach((p) => {
    if (!p || !p.key) return;
    const k = GS_PILLAR_MIGRATE[p.key] || p.key;   // migrate old keys
    byKey[k] = { ...p, key: k };
  });
  const result = [];
  const seedKeys = new Set();
  // Sections the user deleted stay deleted, even the built-in ones — otherwise
  // the seed resurrects them on the next load.
  const gone = new Set(GOALS.deletedPillars || []);
  GS_PILLAR_SEED.forEach((seed) => {
    seedKeys.add(seed.key);
    if (gone.has(seed.key)) { delete byKey[seed.key]; return; }
    const s = byKey[seed.key];
    // For the seven base values, adopt the new seed's label/why/color (the
    // meaning changed in this redefinition), but keep a user-set weight if present.
    result.push({
      key: seed.key, label: seed.label, color: seed.color,
      weight: (s && typeof s.weight === "number" && s.key === seed.key && !s._migrated) ? s.weight : seed.weight,
      why: seed.why, base: true,
      scope: (s && s.scope) || undefined,          // personal / work stays put
    });
    delete byKey[seed.key];
  });
  // Preserve any user-added (non-seed) pillars.
  Object.keys(byKey).forEach((k) => {
    const p = byKey[k];
    if (seedKeys.has(k)) return;
    if (gone.has(k)) return;
    result.push({ key: k, label: p.label || "Values", color: p.color || "#b3b3b3", weight: (typeof p.weight === "number" ? p.weight : 10), why: p.why || "", base: false, scope: p.scope || undefined });
  });
  GOALS.pillars = result;
}

// Migrate saved pillar references on groups, ideas, and (implicitly) inputs so
// nothing assigned to the old pillars falls to "Unassigned" after the switch.
function gsMigrateRefs() {
  let changed = false;
  GOALS.groupPillars = GOALS.groupPillars || {};
  Object.keys(GOALS.groupPillars).forEach((g) => {
    const m = GS_PILLAR_MIGRATE[GOALS.groupPillars[g]];
    if (m) { GOALS.groupPillars[g] = m; changed = true; }
  });
  (GOALS.ideas || []).forEach((i) => {
    const m = GS_PILLAR_MIGRATE[i.pillar];
    if (m) { i.pillar = m; changed = true; }
  });
  if (changed) saveGoals(true);
}
function gsAddPillar() {
  loadGoals();
  const name = prompt("New pillar name:");
  if (!name || !name.trim()) return;
  gsPillars().push({ key: "p" + mmUid(), label: name.trim(), color: gsNextPillarColor(), weight: 10, why: "", base: false });
  saveGoals(true);
  $("#board").innerHTML = ""; renderGoals();
}
function gsRemovePillar(key) {
  const p = gsP(key); if (p.base) { alert("The four base pillars can't be removed."); return; }
  GOALS.pillars = gsPillars().filter((x) => x.key !== key);
  Object.keys(GOALS.groupPillars || {}).forEach((g) => { if (GOALS.groupPillars[g] === key) delete GOALS.groupPillars[g]; });
  (GOALS.ideas || []).forEach((i) => { if (i.pillar === key) i.pillar = ""; });
  saveGoals(true);
  $("#board").innerHTML = ""; renderGoals();
}

const GS_INPUTS = gsSeed("GS_INPUTS", []);

const GS_SETUP = gsSeed("GS_SETUP", []);

const GS_LOOP = [
  { n: "01", t: "Diagnose",              who: "Rumelt" },
  { n: "02", t: "Objective + Identity",  who: "Rumelt · Clear · Stoics" },
  { n: "03", t: "Inputs",                who: "Clear" },
  { n: "04", t: "Reflect",               who: "Dalio · Grant" },
  { n: "05", t: "Protect & Pivot",       who: "Taleb · McConaughey" },
];

const GS_CASE = gsSeed("GS_CASE", []);

const GS_FOCUS = gsSeed("GS_FOCUS", []);

const GS_EXPECTATIONS = gsSeed("GS_EXPECTATIONS", []);

const GS_PROTECT = gsSeed("GS_PROTECT", []);

const GS_LEDGER = gsSeed("GS_LEDGER", {});
const GS_LEDGER_ORDER = ["originate", "own", "build", "write", "defect"];
const GS_LEDGER_TAGS = { originate: "Originates", own: "Owns it", build: "Builds people", write: "Writes it", defect: "Zero defects" };

const GS_DEFAULTS = {
  v: 2,
  diagnosis: gsSeed("diagnosis", ""),
  crux: gsSeed("crux", ""),
  identity: "",     // set in the Operating System tab
  objective: "",    // set in the Operating System tab
  weekly: "",
  monthly: "",
  inputs: {},
  setup: {},
  ledgerAdds: [],
  links: {},
  expLinks: {},
  expDone: {},
  groupPillars: {},
  ideas: [],
  groupSeen: [],
  fwSeeded: 0,
  hiddenPillars: [],
  hiddenIdeas: [],
  mapDir: "h",
  impAbsorbed: 0,
};
GS_INPUTS.forEach((i) => (GS_DEFAULTS.inputs[i.id] = { done: false, streak: 0, warned: false }));
GS_SETUP.forEach((s) => (GS_DEFAULTS.setup[s.id] = { done: false }));
GS_DEFAULTS.pillars = GS_PILLAR_SEED.map((p) => ({ ...p }));

let GOALS = null;

const GS_ROLE_EXP = gsSeed("GS_ROLE_EXP", []);

// Seeds one goal per competency per role, and links each to the section that
// matches the competency on the scorecard. Runs in two stages:
//   v1 — created the 24 goals (already done on existing databases)
//   v2 — re-links every one of them to its competency section and refreshes
//        the bullets from the current scorecard
// Idempotent and non-destructive: goals are matched by their stable id, only
// `pillar` and `plan` are rewritten, and a goal's own title, role, tracking,
// notes, and task tags are left exactly as they are.
const GS_ROLE_EXP_REV = "v2";

function gsRoleExpSection(area, slug) {
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(area);
  const pillars = gsPillars();
  // Exact label match first, then a containment match, so an existing
  // scorecard section is reused rather than duplicated.
  let hit = pillars.find((p) => norm(p.label) === target);
  if (!hit) {
    hit = pillars.find((p) => {
      const n = norm(p.label);
      return n.length > 4 && (n.includes(target) || target.includes(n));
    });
  }
  if (hit) return hit.key;
  // Nothing suitable — create the section with a deterministic key so this
  // stays idempotent across runs.
  const key = "sc_" + slug;
  if (!pillars.some((p) => p.key === key)) {
    pillars.push({ key, label: area, color: gsNextPillarColor(), weight: 10,
                   why: "Scorecard competency.", base: false });
  }
  return key;
}

// ---- Section-level roles (reverted) ----------------------------------------
// Pinning a whole section to one rung was tried and undone: a value like
// Autonomy should hold goals at EVERY level — what you do autonomously as an
// analyst is not what you do as a VP. Roles belong on individual goals, not on
// the section. This migration undoes the pinning: it unmarks the sections and
// clears the role it forced onto their goals, leaving them free to be set one
// at a time.
const GS_SECTION_ROLE_UNPIN = ["autonomy", "leadership", "organization"];

function gsApplySectionRoles() {
  if (GOALS.secRoleRev === "v2") return;
  const norm = (x) => String(x || "").trim().toLowerCase();
  let unpinned = 0, cleared = 0;
  const wasPinned = GOALS.secRoleRev === "v1";
  gsPillars().forEach((p) => {
    if (!GS_SECTION_ROLE_UNPIN.includes(norm(p.label))) return;
    if (p.role) { delete p.role; unpinned++; }
    // Only undo what the pinning did — if the section was never pinned on this
    // database, leave every goal's role exactly as the user set it.
    if (!wasPinned) return;
    (GOALS.ideas || []).forEach((i) => {
      if (i.pillar === p.key && i.role === "associate") { i.role = ""; cleared++; }
    });
  });
  GOALS.secRoleRev = "v2";
  if (unpinned || cleared) {
    saveGoals(true);
    console.log(`[goals] section pinning reverted: ${unpinned} section(s), ${cleared} goal role(s) cleared`);
  }
}

function gsSectionRole() { return ""; }   // sections no longer fix a rung

// Sections that are about your life rather than the job. Marked once; toggle
// any of them in Manage sections.
const GS_PERSONAL_SEED = ["networking (personal)", "leverage", "self-investment", "future opportunities"];
function gsSeedPersonalScope() {
  if (GOALS.personalRev === "v2") return;   // v2: the Networking section was split in two
  let n = 0;
  gsPillars().forEach((p) => {
    if (GS_PERSONAL_SEED.includes(String(p.label || "").trim().toLowerCase()) && p.scope !== "personal") {
      p.scope = "personal"; n++;
    }
  });
  GOALS.personalRev = "v2";
  if (n) saveGoals(true);
}

const GS_AUTONOMY_MAP = gsSeed("GS_AUTONOMY_MAP", []);
// Goals whose parent was hidden come back with it; these are the three flags
// that actually need clearing.
const GS_AUTONOMY_UNHIDE = ["Ownership", "Resourcefulness", "Creativity"];
const GS_AUTONOMY_FALLBACK = "Proactiveness / Resourcefulness";

async function gsRetireAutonomy() {
  if (GOALS.autoRetired === "v1") return;
  const auto = gsPillars().find((p) => /^autonomy$/i.test(String(p.label || "").trim()));
  const orphans = (GOALS.ideas || []).filter((i) => i.pillar === (auto && auto.key));
  if (!auto && !orphans.length) { GOALS.autoRetired = "v1"; return; }
  const deadKey = auto ? auto.key : null;
  const starts = (t, p) => String(t || "").trim().toLowerCase().startsWith(p.toLowerCase());

  let moved = 0, roled = 0, unhidden = 0;
  (GOALS.ideas || []).forEach((g) => {
    if (g.pillar !== deadKey) return;
    const rule = GS_AUTONOMY_MAP.find(([pre]) => starts(g.text, pre));
    const destLabel = rule ? rule[1] : GS_AUTONOMY_FALLBACK;
    g.pillar = gsRoleExpSection(destLabel, destLabel.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 8));
    moved++;
    if (rule && rule[2] && !(g.role || "")) { g.role = rule[2]; roled++; }
    if (GS_AUTONOMY_UNHIDE.some((u) => starts(g.text, u))) {
      if (g.dashHidden) { g.dashHidden = false; unhidden++; }
      GOALS.hiddenIdeas = (GOALS.hiddenIdeas || []).filter((x) => x !== g.id);
    }
  });
  if (deadKey) GOALS.pillars = (GOALS.pillars || []).filter((p) => p.key !== deadKey);
  GOALS.autoRetired = "v1";
  saveGoals(true);

  // Rebuild Pillar cells from the goals each task is tagged to, so no task is
  // left pointing at a section that no longer exists.
  let retagged = 0;
  const gcol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  const pcol = STATE.columns.find((c) => c.type === "goal" && /pillar|value/i.test(String(c.name || "")));
  if (gcol && pcol) {
    const pillarOf = {};
    (GOALS.ideas || []).forEach((i) => { pillarOf[i.id] = i.pillar || ""; });
    // Work from a fresh read: startup automations can retire linked copies, and
    // writing to a task the server has already dropped is a guaranteed 404.
    let live = null;
    try {
      const fresh = await api("/api/state");
      live = new Set((fresh.tasks || []).map((x) => x.id));
    } catch (e) { live = null; }
    for (const t of STATE.tasks) {
      if (live && !live.has(t.id)) continue;
      const want = [];
      String(t.cells[gcol.id] || "").split("|").filter(Boolean).forEach((tag) => {
        if (!tag.startsWith("idea:")) return;
        const pk = pillarOf[tag.slice(5)];
        if (pk && !want.includes("pillar:" + pk)) want.push("pillar:" + pk);
      });
      const cur = String(t.cells[pcol.id] || "");
      const val = want.join("|");
      if (val !== cur && (cur || val)) {
        try { await updateCell(t.id, pcol.id, val); t.cells[pcol.id] = val; retagged++; }
        catch (e) {
          // Writing a cell fires the automations, which can retire a linked
          // copy — so a task earlier in this loop may already be gone by the
          // time we reach it. That's the engine working, not a failure.
          if (!/not found/i.test(String(e && e.message))) console.error("[goals] pillar rebuild failed:", e);
        }
      }
    }
  }
  console.log(`[goals] Autonomy retired: ${moved} goal(s) moved, ${roled} levelled, ${unhidden} unhidden, ${retagged} task pillar cell(s) rebuilt`);
  render();
}

// ---- Merge duplicate sections ---------------------------------------------
// "Technical Skills" (yours) and "Technical Capabilities" (the scorecard's
// bonus section) describe the same thing, so they collapse into one.
//
// The surviving key is whichever was created first — that's the one task
// Pillar tags already point at, and pillar:<key> tags are load-bearing. Goals
// move across, tags are re-pointed, and the emptied section is dropped. The
// survivor takes the scorecard's wording so the section resolver matches it
// from here on and can't recreate the split.
const GS_MERGE_SECTIONS = [
  { match: ["technical skills", "technical capabilities"], label: "Technical Capabilities" },
];

async function gsMergePillars() {
  if (GOALS.mergeRev === "v1") return;
  const norm = (x) => String(x || "").trim().toLowerCase();
  let movedGoals = 0, retagged = 0, dropped = [];

  for (const rule of GS_MERGE_SECTIONS) {
    const hits = gsPillars().filter((p) => rule.match.includes(norm(p.label)));
    if (hits.length < 2) {
      // Nothing to merge — just make sure the survivor carries the agreed name,
      // so the scorecard's section resolver matches it instead of making a twin.
      if (hits.length === 1 && hits[0].label !== rule.label) hits[0].label = rule.label;
      continue;
    }
    const keep = hits[0];                       // created first == the tagged one
    const dead = hits.slice(1);
    dead.forEach((d) => {
      (GOALS.ideas || []).forEach((i) => {
        if (i.pillar === d.key) { i.pillar = keep.key; movedGoals++; }
      });
      dropped.push(d.key);
    });
    keep.label = rule.label;
    GOALS.pillars = GOALS.pillars.filter((p) => !dropped.includes(p.key));

    // Re-point Pillar-column tags on the board so nothing points at a section
    // that no longer exists.
    const pcol = STATE.columns.find((c) => c.type === "goal" && /pillar|value/i.test(String(c.name || "")));
    if (pcol) {
      for (const t of STATE.tasks) {
        const raw = String(t.cells[pcol.id] || "");
        if (!raw) continue;
        const tags = raw.split("|").filter(Boolean);
        if (!tags.some((tag) => dropped.includes(tag.replace(/^pillar:/, "")))) continue;
        const next = [];
        tags.forEach((tag) => {
          const k = tag.replace(/^pillar:/, "");
          const mapped = dropped.includes(k) ? "pillar:" + keep.key : tag;
          if (!next.includes(mapped)) next.push(mapped);      // dedupe the collapse
        });
        const val = next.join("|");
        if (val !== raw) {
          try { await updateCell(t.id, pcol.id, val); t.cells[pcol.id] = val; retagged++; }
          catch (e) { console.error("[goals] pillar re-tag failed:", e); }
        }
      }
    }
  }

  GOALS.mergeRev = "v1";
  saveGoals(true);
  if (movedGoals || retagged || dropped.length) {
    console.log(`[goals] merged sections: ${movedGoals} goal(s) moved, ${retagged} task tag(s) re-pointed, dropped ${dropped.join(", ") || "none"}`);
    render();
  }
}

const SC3_SECTIONS = gsSeed("SC3_SECTIONS", {});

const SC3_FIX = gsSeed("SC3_FIX", []);

const SC3_NEW = gsSeed("SC3_NEW", []);

function gsApplyScorecardV3() {
  if (GOALS.scV3 === "v1") return;
  let roled = 0, moved = 0, reworded = 0, added = 0;
  const byId = {};
  (GOALS.ideas || []).forEach((i) => { byId[i.id] = i; });

  SC3_FIX.forEach(([gid, role, slug, text]) => {
    const goal = byId[gid];
    if (!goal) return;
    const pillar = gsRoleExpSection(SC3_SECTIONS[slug], slug);
    if ((goal.role || "") !== role) { goal.role = role; moved++; } else roled++;
    if (goal.pillar !== pillar) goal.pillar = pillar;
    if (String(goal.text || "").trim() !== text) { goal.text = text; reworded++; }
  });

  SC3_NEW.forEach(([slug, role, text, n]) => {
    const id = "sc3_" + slug + "_" + role + "_" + n;
    if (byId[id]) return;
    GOALS.ideas.push({
      id, text, role,
      pillar: gsRoleExpSection(SC3_SECTIONS[slug], slug),
      plan: "", why: "", weaknessBoost: false, dashHidden: false, parent: "",
    });
    added++;
  });

  GOALS.scV3 = "v1";
  saveGoals(true);
  console.log(`[goals] scorecard v3: ${added} added, ${moved} re-levelled, ${reworded} reworded, ${roled} confirmed`);
}

// ---- Adopt roles from the per-bullet scorecard goals -----------------------
// The scorecard broken out one goal per bullet carries its level in the goal's
// own id (sc_<competency>_<role>_<n>) but was never given a role in the field
// the Analyst / Associate / Director / VP views read. That's why those tabs
// looked empty while the goals plainly existed. This copies the level out of
// the id into the role field — no guessing, no matching, exactly the
// organization already encoded on the scorecard.
//
// It also retires the competency-level goals seeded earlier (rexp_*), which
// say the same thing one level up and would double-count every role. They're
// hidden from the dashboard, never deleted: clear `dashHidden` on any of them
// to bring it back.
const GS_SC_ROLE_RE = /^sc_\d+_(analyst|associate|director|vp)_\d+$/;

function gsAdoptScorecardRoles() {
  if (GOALS.scRolesRev === "v1") return;
  const ideas = GOALS.ideas || [];
  const hasBulletSet = ideas.some((i) => GS_SC_ROLE_RE.test(String(i.id || "")));
  let roled = 0, retired = 0;
  ideas.forEach((i) => {
    const m = GS_SC_ROLE_RE.exec(String(i.id || ""));
    if (m && !(i.role || "")) { i.role = m[1]; roled++; }
  });
  if (hasBulletSet) {
    ideas.forEach((i) => {
      if (String(i.id || "").startsWith("rexp_") && !i.dashHidden) { i.dashHidden = true; retired++; }
    });
  }
  GOALS.scRolesRev = "v1";
  if (roled || retired) {
    saveGoals(true);
    console.log(`[goals] scorecard roles: ${roled} goals given their level, ${retired} duplicate(s) retired`);
  }
}

// ---- Hiding sections inside one view ---------------------------------------
// A section can be irrelevant in one view and central in another: Commercial
// Modeling means nothing under Personal, Never Eat Alone means nothing under
// Director. Hiding is therefore stored PER VIEW rather than on the section, so
// nothing disappears globally and the count of what's hidden is always on
// screen with a way back.
function gsRoleHidden(role) {
  const m = GOALS.roleHiddenPillars || {};
  return m[role || "_all"] || [];
}
function gsSectionHiddenHere(pillarKey) {
  return gsRoleHidden(gdRoleFilter).includes(pillarKey);
}
function gsSetSectionHiddenHere(pillarKey, hidden) {
  const key = gdRoleFilter || "_all";
  GOALS.roleHiddenPillars = GOALS.roleHiddenPillars || {};
  const cur = new Set(GOALS.roleHiddenPillars[key] || []);
  if (hidden) cur.add(pillarKey); else cur.delete(pillarKey);
  GOALS.roleHiddenPillars[key] = [...cur];
  saveGoals(true);
  $("#board").innerHTML = "";
  renderGoals();
}
function gsClearHiddenHere() {
  const key = gdRoleFilter || "_all";
  GOALS.roleHiddenPillars = GOALS.roleHiddenPillars || {};
  GOALS.roleHiddenPillars[key] = [];
  saveGoals(true);
  $("#board").innerHTML = "";
  renderGoals();
}
function gsViewLabel() {
  return gdRoleFilter ? gdRoleLabel(gdRoleFilter) : "All goals";
}

const SC_EXPORT_ORDER = gsSeed("SC_EXPORT_ORDER", []);
const SC_EXPORT_ROLES = [["analyst", "Analyst"], ["associate", "Associate"],
                         ["director", "Director"], ["vp", "VP"]];
const SC_RATING_CRITERIA = [
  ["1", "Unsatisfactory", "Consistently fails to meet job requirements. Does not demonstrate the knowledge, skills, abilities and commitments required for the position."],
  ["2", "Needs Improvement", "Demonstrates some, but not all, of the values and behaviors expected. Does not consistently meet expectations of the role."],
  ["3", "Successful", "Consistently demonstrates the values and behaviors expected. Consistently meets established performance expectations and goals."],
  ["4", "Exceptional", "Sets a new standard. Consistently exceeds expectations and delivers beyond the goals of the role. Leads or serves as a role model."],
];

function scIsScorecardGoal(g) {
  return /^sc3?_/.test(String(g.id || "")) && /_(analyst|associate|director|vp)(_|$)/.test(String(g.id || ""));
}

function scExportData(opts) {
  loadGoals();
  const sc = STATE.columns.find((c) => c.type === "status");
  const dcol = STATE.columns.filter((c) => c.type === "date").find((c) => /due/i.test(c.name));
  const pc = primaryCol();
  const bySection = [];
  // The export follows the scorecard's own order, not the dashboard's — the
  // document should read the way the sheet reads, with the two bonus/optional
  // sections last. Anything not on this list keeps its dashboard position and
  // sorts in after the named ones.
  const order = SC_EXPORT_ORDER.map((x) => x.toLowerCase());
  const rank = (p) => {
    const i = order.indexOf(String(p.label || "").trim().toLowerCase());
    return i === -1 ? order.length : i;
  };
  gsPillars().slice().sort((a, b) => rank(a) - rank(b)).forEach((p) => {
    const goals = (GOALS.ideas || []).filter((g) => g.pillar === p.key && scIsScorecardGoal(g));
    if (!goals.length) return;
    const roles = SC_EXPORT_ROLES.map(([rk, rlabel]) => {
      const items = goals.filter((g) => (g.role || "") === rk).map((g) => {
        let tasks = gsTiedTasks(g).map((t) => ({
          name: String(t.cells[pc.id] || "Untitled"),
          done: sc ? String(t.cells[sc.id] || "") === "Done" : false,
          status: sc ? String(t.cells[sc.id] || "") : "",
          when: String(t.cells["__done_date"] || (dcol ? t.cells[dcol.id] : "") || "").slice(0, 10),
          group: t.group_name || "",
        }));
        if (opts.doneOnly) tasks = tasks.filter((t) => t.done);
        tasks.sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || String(b.when).localeCompare(String(a.when)));
        return { text: g.text || "", tasks, done: tasks.filter((t) => t.done).length };
      });
      return { key: rk, label: rlabel, items };
    }).filter((r) => r.items.length);
    if (roles.length) bySection.push({ label: p.label, color: p.color, roles });
  });
  return bySection;
}

// The scorecard carries the same bonsai mark as the app. Kept as a constant so
// the export stays a single self-contained file.
const SC_BONSAI = `<g fill="#2b4034">`
  + `<path d="M83 160c-6-17 0-31 11-41 8-8 11-16 7-24-4-9-13-14-15-24-2-11 3-21 13-29l16 11c-8 6-12 13-10 20 2 9 11 14 15 24 5 12 1 23-8 32-9 9-13 17-11 27 1 2 1 3 2 4z"/>`
  + `<path d="M96 120c-8 3-17 2-25-3-7-4-13-9-21-10l1-11c11 1 19 7 26 12 6 4 13 6 19 4z"/>`
  + `<path d="M107 101c8 4 18 4 26-1 7-4 13-9 21-9l-1 11c-11 0-18 6-25 10-7 4-15 5-21 2z"/>`
  + `<ellipse cx="100" cy="48" rx="43" ry="26"/><ellipse cx="66" cy="58" rx="28" ry="19"/>`
  + `<ellipse cx="134" cy="58" rx="28" ry="19"/><ellipse cx="84" cy="36" rx="26" ry="19"/>`
  + `<ellipse cx="119" cy="38" rx="24" ry="18"/><rect x="58" y="46" width="84" height="27" rx="13"/>`
  + `<ellipse cx="52" cy="99" rx="31" ry="18"/><ellipse cx="32" cy="107" rx="21" ry="13"/>`
  + `<ellipse cx="72" cy="107" rx="21" ry="13"/><ellipse cx="45" cy="91" rx="20" ry="13"/>`
  + `<rect x="22" y="99" width="62" height="18" rx="9"/>`
  + `<ellipse cx="150" cy="101" rx="29" ry="17"/><ellipse cx="133" cy="109" rx="20" ry="12"/>`
  + `<ellipse cx="167" cy="109" rx="19" ry="12"/><ellipse cx="158" cy="93" rx="19" ry="13"/>`
  + `<rect x="123" y="101" width="57" height="18" rx="9"/>`
  + `<path d="M58 162c9-11 22-16 42-16s33 5 42 16z"/>`
  + `<path d="M38 162h124c5 0 9 4 9 9s-4 9-9 9h-6l-8 16c-3 6-9 10-16 10H66c-7 0-13-4-16-10l-8-16h-6c-5 0-9-4-9-9s4-9 9-9z"/>`
  + `<path d="M60 206h20l-4-10H64zM120 206h20l-4-10h-12z"/></g>`;

function scExportHtml(opts) {
  const data = scExportData(opts);
  const esc = (x) => String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const today = todayYMD();
  let totalB = 0, coveredB = 0, totalT = 0, doneT = 0;
  data.forEach((s) => s.roles.forEach((r) => r.items.forEach((i) => {
    totalB++; if (i.tasks.length) coveredB++;
    totalT += i.tasks.length; doneT += i.done;
  })));

  // Evidence is the point of this document, so bullets WITH tasks get the room
  // and bullets without are collapsed to a compact list at the end of their
  // level — they're a gap list, not a reading list. Tasks run inline as one
  // wrapped line rather than a bulleted block, which is what turned 96
  // expectations into 21 pages.
  const evidence = (i) => {
    const names = i.tasks.map((t) =>
      `<span class="${t.done ? "d" : "o"}">${t.done ? "&#10003;" : "&#9675;"}&nbsp;${esc(t.name)}${
        (t.when && !opts.hideDates) ? `<span class="dt">${esc(t.when.slice(2))}</span>` : ""}</span>`);
    const n = i.tasks.length;
    // Collapsed by default so the document reads as a scorecard first and an
    // evidence log second. <details> needs no script, and the print rules below
    // force it open so a PDF still contains everything.
    return `<details class="evwrap"><summary>${n} task${n === 1 ? "" : "s"}${
      i.done ? ` &middot; ${i.done} done` : ""}</summary>`
      + `<div class="ev">${names.join('<span class="sep">&middot;</span>')}</div></details>`;
  };

  const sections = data.map((s, si) => {
    // Per-value totals, so each page can stand on its own.
    let b = 0, cov = 0, tk = 0, dn = 0;
    s.roles.forEach((r) => r.items.forEach((i) => {
      b++; if (i.tasks.length) cov++; tk += i.tasks.length; dn += i.done;
    }));
    return `
  <section class="comp${si === 0 ? " first" : ""}">
    <div class="sheet-head" style="border-left-color:${esc(s.color)}">
      <h2>${esc(s.label)}</h2>
      ${opts.hideCounts ? "" : `<span class="sheet-tally"><b>${cov}/${b}</b> evidenced${
        tk ? ` &middot; <b>${dn}</b> completed of <b>${tk}</b> tasks` : ""}</span>`}
    </div>
    <div class="sheet-body">
    ${s.roles.map((r) => {
      const withEv = r.items.filter((i) => i.tasks.length);
      const without = r.items.filter((i) => !i.tasks.length);
      return `<div class="role">
        <h3>${esc(r.label)}${opts.hideCounts ? "" : `<span class="rcount">${withEv.length}/${r.items.length} evidenced</span>`}</h3>
        ${withEv.map((i) => `
          <div class="bullet">
            <div class="btext">${esc(i.text)}${opts.hideCounts ? "" : `<span class="cnt">${i.done}/${i.tasks.length}</span>`}</div>
            ${evidence(i)}
          </div>`).join("")}
        ${without.length && !opts.hideGaps ? `<div class="gaps"><span class="glab">No evidence yet</span>${
          without.map((i) => esc(i.text)).join(" <span class='sep'>&middot;</span> ")}</div>` : ""}
      </div>`;
    }).join("")}
    </div>
  </section>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Role Expectations Scorecard &mdash; ${esc(today)}</title>
<style>
 @page { size: letter portrait; margin: 12mm; }
 *{box-sizing:border-box;margin:0;padding:0}
 body{font-family:"Outfit",-apple-system,"Segoe UI",system-ui,sans-serif;color:#2c2a26;line-height:1.5;font-size:9pt;padding:20px;max-width:1040px;margin:0 auto;background:#f5f4f1}
 header.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:2px solid #00859b;padding-bottom:9px;margin-bottom:13px}
 .mark{width:28px;height:29px;flex-shrink:0}
 h1{font-family:"Fraunces",Georgia,serif;font-size:16pt;letter-spacing:-.3px}
 .sub{color:#7a8a86;font-size:8.5pt}
 .tally{margin-left:auto;font-size:8.5pt;color:#5d6b64}
 .tally b{font-family:"Fraunces",Georgia,serif;font-size:11.5pt;color:#00859b}
 .crit{font-size:7.6pt;color:#8a978f;margin-bottom:16px;line-height:1.6;padding-bottom:11px;border-bottom:1px solid #ebe8e2}
 .crit b{color:#5d6b64}
 /* One value per page. On screen each section is a sheet with its own header
    so the document reads the same way it prints. */
 /* On screen each value is drawn as a sheet, so the page-per-value structure is
    visible before you print. In print the card styling falls away and the
    page break does the work. */
 section.comp{break-before:page;page-break-before:always;
   background:#fff;border:1px solid #e6e3db;border-radius:10px;
   padding:22px 26px 18px;margin:0 0 22px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
 section.comp.first{break-before:auto;page-break-before:auto}
 .sheet-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
   border-left:5px solid #00859b;padding:2px 0 8px 11px;margin-bottom:14px;
   border-bottom:1px solid #ebe8e2}
 .sheet-head h2{font-family:"Fraunces",Georgia,serif;font-size:14pt;letter-spacing:-.2px}
 .sheet-tally{margin-left:auto;font-size:8.5pt;color:#5d6b64}
 .sheet-tally b{font-family:"Fraunces",Georgia,serif;font-size:11pt;color:#00859b}
 .sheet-body{column-count:2;column-gap:28px}
 .role{margin:0 0 16px 0;break-inside:avoid;page-break-inside:avoid}
 .role h3{font-size:7.6pt;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#00859b;
   margin-bottom:7px;padding-bottom:3px;border-bottom:1px solid #cce7eb}
 .rcount{font-weight:700;color:#77b28c;margin-left:6px;letter-spacing:0;text-transform:none}
 .bullet{margin-bottom:11px;break-inside:avoid}
 .btext{font-size:9pt;font-weight:700;line-height:1.45}
 .cnt{font-size:7pt;font-weight:800;color:#38a66f;background:#ebf2e6;border-radius:8px;padding:1px 6px;margin-left:6px;white-space:nowrap}
 .evwrap{margin:4px 0 0 11px}
 .evwrap>summary{font-size:7.6pt;color:#8a978f;cursor:pointer;list-style:none;user-select:none;
   display:inline-flex;align-items:center;gap:5px;padding:1px 0}
 .evwrap>summary::-webkit-details-marker{display:none}
 .evwrap>summary::before{content:"\\25B8";font-size:7pt;color:#b3b3b3}
 .evwrap[open]>summary::before{content:"\\25BE"}
 .evwrap>summary:hover{color:#00859b}
 .ev{font-size:8pt;color:#5d6b64;margin:5px 0 2px 12px;line-height:1.9}
 .ev .d{color:#38a66f}
 .ev .o{color:#8a978f}
 .dt{color:#c2c2be;font-size:7.2pt;margin-left:4px}
 .sep{color:#d9d9d6;margin:0 6px}
 .gaps{font-size:7.8pt;color:#a89a7e;background:#fbf7ef;border-left:2px solid #e6d9bd;
   padding:6px 9px;margin:6px 0 0 11px;line-height:1.7;border-radius:0 5px 5px 0}
 .glab{font-weight:800;color:#8a6a12;text-transform:uppercase;font-size:6.8pt;letter-spacing:.4px;
   display:block;margin-bottom:2px}
 footer{margin-top:16px;padding-top:9px;border-top:1px solid #d9d9d6;font-size:7.4pt;color:#8a978f;column-span:all}
 @media print{
   body{padding:0;max-width:none;background:#fff}
   section.comp{margin:0;padding:0;border:none;border-radius:0;box-shadow:none}
   .evwrap>summary{display:none}
   .evwrap>.ev{display:block !important}
 }
</style></head><body>
<header class="top">
  <svg class="mark" viewBox="0 0 200 210" aria-hidden="true">${SC_BONSAI}</svg>
  <h1>Role Expectations Scorecard</h1>
  <span class="sub">${gsSeed("roleTitle", "") ? esc(gsSeed("roleTitle", "")) + " &middot; " : ""}${esc(today)}${opts.doneOnly ? " &middot; completed only" : ""}</span>
  ${opts.hideCounts ? "" : `<span class="tally"><b>${coveredB}/${totalB}</b> expectations evidenced &middot; <b>${doneT}</b> completed of <b>${totalT}</b> tasks cited</span>`}
</header>
<div class="crit"><b>Rating:</b> 1 Unsatisfactory &middot; 2 Needs Improvement &middot; 3 Successful (reliably performs at the level the role requires) &middot; 4 Exceptional (sets a new standard, delivers beyond the role). &#10003; completed &middot; &#9675; in progress.</div>
${sections}
<footer>Generated from Radio Station on ${esc(today)}.</footer>
</body></html>`;
}

function gsExportScorecard() {
  loadGoals();
  openModal("Export scorecard", (body, close) => {
    body.append(el("p", { class: "ms-intro" },
      "The scorecard with your evidence under each bullet \u2014 every task tagged to it, completed work first. "
      + "Downloads as a web page you can read in any browser and print to PDF."));
    let doneOnly = false;
    const opt = el("label", { class: "ms-toggle", style: "margin-bottom:12px" });
    const cb = el("input", { type: "checkbox" });
    cb.addEventListener("change", () => { doneOnly = cb.checked; });
    opt.append(cb, el("span", {}, "Completed tasks only (leave off to show work in progress too)"));
    body.append(opt);
    let hideDates = false;
    const opt3 = el("label", { class: "ms-toggle", style: "margin-bottom:12px" });
    const cb3 = el("input", { type: "checkbox" });
    cb3.addEventListener("change", () => { hideDates = cb3.checked; });
    opt3.append(cb3, el("span", {}, "Leave dates out"));
    body.append(opt3);
    let hideCounts = false;
    const opt4 = el("label", { class: "ms-toggle", style: "margin-bottom:12px" });
    const cb4 = el("input", { type: "checkbox" });
    cb4.addEventListener("change", () => { hideCounts = cb4.checked; });
    opt4.append(cb4, el("span", {}, "Leave the evidenced counts out"));
    body.append(opt4);
    let hideGaps = false;
    const opt2 = el("label", { class: "ms-toggle", style: "margin-bottom:12px" });
    const cb2 = el("input", { type: "checkbox" });
    cb2.addEventListener("change", () => { hideGaps = cb2.checked; });
    opt2.append(cb2, el("span", {}, "Hide expectations with no evidence (shortest version)"));
    body.append(opt2);

    const preview = el("div", { class: "ms-intro" });
    const d = scExportData({ doneOnly: false });
    let bullets = 0, covered = 0;
    d.forEach((s) => s.roles.forEach((r) => r.items.forEach((i) => { bullets++; if (i.tasks.length) covered++; })));
    preview.textContent = `${d.length} competencies \u00B7 ${bullets} expectations \u00B7 ${covered} with at least one task tagged.`;
    body.append(preview);

    const btns = el("div", { class: "ra-actions" });
    btns.append(el("button", { class: "tool-btn accent-teal", onClick: () => {
      const html = scExportHtml({ doneOnly, hideGaps, hideDates, hideCounts });
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Role_Expectations_Scorecard_${todayYMD()}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      close();
    } }, "\u2193 Download"));
    btns.append(el("button", { class: "tool-btn", onClick: () => {
      const w = window.open("", "_blank");
      if (!w) { alert("Your browser blocked the popup \u2014 use Download instead."); return; }
      w.document.write(scExportHtml({ doneOnly, hideGaps, hideDates, hideCounts }));
      w.document.close();
    } }, "Open in a new tab"));
    body.append(btns);
  });
}

// ---- Manage sections: personal/work scope, and deletion --------------------
// Deleting a section is the most destructive thing in Goals, so the confirm
// spells out exactly what hangs off it — goals, and the completed work tagged
// to them — and never deletes a goal as a side effect. Goals are moved to a
// section you choose; only the section itself goes.
async function gsRebuildPillarTags() {
  const gcol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  const pcol = STATE.columns.find((c) => c.type === "goal" && /pillar|value/i.test(String(c.name || "")));
  if (!gcol || !pcol) return 0;
  const pillarOf = {};
  (GOALS.ideas || []).forEach((i) => { pillarOf[i.id] = i.pillar || ""; });
  let n = 0;
  for (const t of STATE.tasks) {
    const want = [];
    String(t.cells[gcol.id] || "").split("|").filter(Boolean).forEach((tag) => {
      if (!tag.startsWith("idea:")) return;
      const pk = pillarOf[tag.slice(5)];
      if (pk && !want.includes("pillar:" + pk)) want.push("pillar:" + pk);
    });
    const cur = String(t.cells[pcol.id] || "");
    const val = want.join("|");
    if (val !== cur && (cur || val)) {
      try { await updateCell(t.id, pcol.id, val); t.cells[pcol.id] = val; n++; }
      catch (e) { if (!/not found/i.test(String(e && e.message))) console.error("[goals] pillar rebuild:", e); }
    }
  }
  return n;
}

function gsSectionStats(key) {
  const goals = (GOALS.ideas || []).filter((i) => i.pillar === key);
  const ids = new Set(goals.map((i) => i.id));
  const gcol = STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
  const sc = STATE.columns.find((c) => c.type === "status");
  let tagged = 0, done = 0;
  if (gcol) {
    STATE.tasks.forEach((t) => {
      const hit = String(t.cells[gcol.id] || "").split("|").some((tag) => tag.startsWith("idea:") && ids.has(tag.slice(5)));
      if (!hit) return;
      tagged++;
      if (sc && String(t.cells[sc.id] || "") === "Done") done++;
    });
  }
  return { goals: goals.length, withRole: goals.filter((g) => g.role).length, tagged, done };
}

async function gsDeleteSection(p) {
  const st = gsSectionStats(p.key);
  const others = gsPillars().filter((x) => x.key !== p.key);

  if (!st.goals) {
    if (!confirm(`Delete the section "${p.label}"?\n\nIt has no goals in it, so nothing else is affected.`)) return;
  } else {
    // Draw out the consequences before asking where the goals should land.
    const lines = [
      `"${p.label}" holds ${st.goals} goal${st.goals === 1 ? "" : "s"}.`,
      "",
      `\u2022 ${st.tagged} task${st.tagged === 1 ? "" : "s"} are tagged to those goals, ${st.done} of them completed.`,
      st.withRole ? `\u2022 ${st.withRole} of the goals carry a role, so they count on the role ladder.` : "",
      "",
      "No goal and no task will be deleted \u2014 the goals move to another section and keep every tag.",
      "",
      "Continue?",
    ].filter((x) => x !== "");
    if (!confirm(lines.join("\n"))) return;

    const menu = others.map((x, i) => `${i + 1}. ${x.label}`).join("\n");
    const pick = prompt(`Move the ${st.goals} goal${st.goals === 1 ? "" : "s"} to which section?\n\n${menu}\n\nType a number, or leave blank to leave them unassigned.`, "");
    let dest = "";
    if (pick && pick.trim()) {
      const idx = parseInt(pick.trim(), 10) - 1;
      if (isNaN(idx) || !others[idx]) { alert("That isn't one of the numbers listed \u2014 nothing was changed."); return; }
      dest = others[idx].key;
    } else if (!confirm(`Leave ${st.goals} goal${st.goals === 1 ? "" : "s"} with no section?\n\nThey'll still exist and keep their tags, but they'll sit under "Unassigned" on the dashboard.`)) {
      return;
    }
    (GOALS.ideas || []).forEach((i) => { if (i.pillar === p.key) i.pillar = dest; });
  }

  GOALS.deletedPillars = [...new Set([...(GOALS.deletedPillars || []), p.key])];
  GOALS.pillars = (GOALS.pillars || []).filter((x) => x.key !== p.key);
  saveGoals(true);
  const n = await gsRebuildPillarTags();
  alert(`"${p.label}" deleted.` + (st.goals ? ` ${st.goals} goal${st.goals === 1 ? "" : "s"} moved, ${st.tagged} task tag${st.tagged === 1 ? "" : "s"} preserved.` : "")
        + (n ? ` ${n} task Pillar cell${n === 1 ? "" : "s"} updated.` : "")
        + "\n\nIf that was wrong, Edit \u2192 Data history has the version from before this change.");
  $("#board").innerHTML = "";
  renderGoals();
}

function gsManageSections() {
  loadGoals();
  openModal("Manage sections", (body, close) => {
    body.classList.add("ms-modal");
    body.append(el("p", { class: "ms-intro" },
      "Mark a section personal to keep it out of the career ladder, or delete one you no longer track against. "
      + "Deleting never removes goals \u2014 it asks where they should go."));
    const list = el("div", { class: "ms-list" });
    gsPillars().forEach((p) => {
      const st = gsSectionStats(p.key);
      const row = el("div", { class: "ms-row" });
      row.append(el("span", { class: "ms-dot", style: `background:${p.color}` }));
      const nm = el("div", { class: "ms-name" });
      nm.append(el("span", {}, p.label));
      nm.append(el("span", { class: "ms-meta" },
        `${st.goals} goal${st.goals === 1 ? "" : "s"}${st.tagged ? ` \u00B7 ${st.tagged} tagged, ${st.done} done` : ""}`));
      row.append(nm);
      const tog = el("label", { class: "ms-toggle", title: "Personal sections are sorted out of the Analyst\u2013VP views" });
      const sel = el("select", { class: "field", style: "font-size:12px;padding:2px 5px" });
      GS_SCOPES.forEach(([val, label]) => {
        const o = el("option", {}, label);
        o.value = val;
        if ((p.scope || "") === val) o.selected = true;
        sel.append(o);
      });
      sel.addEventListener("change", () => {
        p.scope = sel.value || undefined;
        saveGoals(true);
        body.innerHTML = ""; close(); gsManageSections();
      });
      tog.append(sel);
      row.append(tog);
      row.append(el("button", { class: "ms-del", title: "Delete this section",
        onClick: async () => { close(); await gsDeleteSection(p); } }, "Delete"));
      list.append(row);
    });
    body.append(list);
  });
}

// ---- Bulk role assignment --------------------------------------------------
// Sorting every goal onto a rung of the scorecard ladder. The rubric below is
// distilled from the Role Expectations Scorecard: what separates the levels is
// not the topic but the VERB — an analyst executes and prepares, an associate
// owns and originates, a director sets standards for others, a VP decides what
// the function does at all. Suggestions score a goal's wording against these
// markers; they're a first pass to accept or override, never applied silently.
const GS_ROLE_RUBRIC = [
  { key: "analyst", label: "Analyst", gist: "Executes well: prepares, coordinates, keeps it clean and error-free.",
    marks: ["prepare", "preparing", "coordinat", "taking notes", "note", "follow-up", "organiz", "file",
            "format", "label", "typo", "free of error", "no error", "error-free", "accura", "diligent",
            "review his", "review my", "review own", "checklist for own", "participant", "attend",
            "prioritize workload", "resources at hand", "prior art", "learn", "study", "understand",
            "proactive approach", "ask", "support", "assist", "help the team", "responsive", "timely",
            "quick", "consistent with resources", "detail", "quality of my", "clean"] },
  { key: "associate", label: "Associate", gist: "Owns a workstream: originates, structures, defends, judges priorities.",
    marks: ["own", "ownership", "structure", "set assumptions", "limited guidance", "minimal direction",
            "independent", "autonom", "originate", "drive", "driving", "run the", "runs the", "lead the",
            "stress-test", "defend", "walk senior", "present to", "narrative", "story", "anticipate",
            "catch errors in others", "qc", "trusted", "escalate", "judge priorit", "protect timeline",
            "solve problem", "initiative", "improve how", "reliance", "without being asked", "end-to-end",
            "end to end", "creativity", "idea"] },
  { key: "director", label: "Director", gist: "Sets the standard others work to: reviews, allocates, builds the system.",
    marks: ["standard", "template", "sign off", "signs off", "review the team", "before leadership",
            "house style", "manage multiple", "manages multiple", "cross-functional", "operating cadence",
            "final review", "quality bar", "second-order", "allocate", "capacity", "re-sequence",
            "shape", "point of view", "sponsor", "resourced", "team's", "the team", "mentor", "coach",
            "train", "develop others", "delegate", "process", "system", "scale", "playbook", "governance"] },
  { key: "vp", label: "VP", gist: "Decides what the function does: strategy, board, agenda, positioning.",
    marks: ["strategy", "strategic", "board", "decides which", "decide which", "messaging strategy",
            "drive decision", "deal outcome", "set the agenda", "sets the agenda", "represent",
            "integrity of", "sets the pace", "positioning", "competitive advantage", "sources the",
            "function", "org-wide", "organization", "external counterpart", "leadership level", "vision"] },
];

const GS_ROLE_STRONG = {
  analyst: ["typo", "free of error", "error-free", "takes notes", "taking notes", "files organized",
            "keeps files", "properly formatted", "labeled with units", "follow-ups", "prior art"],
  associate: ["stress-test", "stress test", "originate", "originates", "qc checklist", "limited guidance",
              "minimal direction", "runs the project", "run my own workstream", "escalate only",
              "judges priorities", "judge priorities", "anticipates crunch", "anticipate crunch"],
  director: ["standards and templates", "modeling standards", "quality bar", "final reviewer",
             "operating cadence", "house style", "signs off", "sign off", "allocate team",
             "allocates the team", "team capacity", "mentor", "train the", "second-order",
             "cross-functional", "reviews decks"],
  vp: ["board", "deal outcome", "commercial strategy", "strategic agenda", "sets the pace",
       "positioning", "messaging strategy", "decides which", "represent corp", "represents corporate",
       "external counterpart", "sources the opportunities", "sets the agenda", "point of view on"],
};

function gsSuggestRole(g) {
  const hay = [g.text, g.why, g.plan].map((x) => String(x || "").toLowerCase()).join(" \n ");
  if (!hay.trim()) return "";
  let best = "", bestScore = 0, runnerUp = 0;
  GS_ROLE_RUBRIC.forEach((r) => {
    let score = 0;
    r.marks.forEach((m) => { if (hay.includes(m)) score += m.length > 8 ? 2 : 1; });
    // Decisive phrases outrank any pile-up of generic verbs.
    (GS_ROLE_STRONG[r.key] || []).forEach((m) => { if (hay.includes(m)) score += 5; });
    if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = r.key; }
    else if (score > runnerUp) { runnerUp = score; }
  });
  // Too weak, or too close to call — leave it for a human.
  if (bestScore < 2 || bestScore === runnerUp) return "";
  return best;
}

function gsRoleAssignTargets() {
  const counts = { analyst: 0, associate: 0, director: 0, vp: 0, "": 0 };
  gsAllGoals().forEach((g) => { counts[g.role || ""] = (counts[g.role || ""] || 0) + 1; });
  return counts;
}

const GS_ROLE_TARGET = 12;

function renderRoleAssign() {
  loadGoals();
  const board = $("#board");
  const wrap = el("div", { class: "ra-wrap" });

  const head = el("div", { class: "ra-head" });
  const ht = el("div", {});
  ht.append(el("h2", { class: "ra-h2" }, "Assign goals to roles"));
  ht.append(el("div", { class: "ra-sub" },
    "Put every goal on a rung of the scorecard ladder. Suggestions come from the wording of the Role Expectations Scorecard \u2014 accept them, or set any goal yourself."));
  head.append(ht);
  head.append(el("button", { class: "tool-btn", onClick: () => { goalsSubview = "dash"; board.innerHTML = ""; renderGoals(); } }, "\u2190 Back to goals"));
  wrap.append(head);

  // Live counts against the ~12 target
  const counts = gsRoleAssignTargets();
  const tally = el("div", { class: "ra-tally" });
  GS_ROLE_RUBRIC.forEach((r) => {
    const n = counts[r.key] || 0;
    const cls = n >= GS_ROLE_TARGET - 2 && n <= GS_ROLE_TARGET + 3 ? " good" : n > GS_ROLE_TARGET + 3 ? " over" : " under";
    const c = el("div", { class: "ra-tally-cell" + cls });
    c.append(el("div", { class: "ra-tally-role" }, r.label));
    c.append(el("div", { class: "ra-tally-n" }, String(n)));
    c.append(el("div", { class: "ra-tally-t" }, "target ~" + GS_ROLE_TARGET));
    c.append(el("div", { class: "ra-tally-gist" }, r.gist));
    tally.append(c);
  });
  const un = el("div", { class: "ra-tally-cell unassigned" });
  un.append(el("div", { class: "ra-tally-role" }, "No role"));
  un.append(el("div", { class: "ra-tally-n" }, String(counts[""] || 0)));
  un.append(el("div", { class: "ra-tally-t" }, "to sort"));
  tally.append(un);
  wrap.append(tally);

  // Bulk apply
  const goals = gsAllGoals().slice().sort((a, b) => String(a.text || "").localeCompare(String(b.text || "")));
  const suggestable = goals.filter((g) => !(g.role || "") && gsSuggestRole(g));
  const actions = el("div", { class: "ra-actions" });
  actions.append(el("button", { class: "tool-btn accent-teal",
    onClick: () => {
      if (!suggestable.length) { alert("No confident suggestions left \u2014 set the rest by hand below."); return; }
      if (!confirm(`Apply ${suggestable.length} suggested role${suggestable.length === 1 ? "" : "s"}?\n\n`
        + `Only goals that currently have NO role are touched. Anything you've already set stays as it is, `
        + `and you can change any of them afterwards.`)) return;
      suggestable.forEach((g) => { g.role = gsSuggestRole(g); });
      saveGoals(true);
      board.innerHTML = ""; renderRoleAssign();
    } }, `\u2713 Apply ${suggestable.length} suggestion${suggestable.length === 1 ? "" : "s"}`));
  actions.append(el("button", { class: "tool-btn",
    onClick: () => {
      const withRole = gsAllGoals().filter((g) => g.role);
      if (!withRole.length) return;
      if (!confirm(`Clear the role on all ${withRole.length} goals that have one?\n\nThis only clears the role field \u2014 no goal is deleted.`)) return;
      withRole.forEach((g) => { g.role = ""; });
      saveGoals(true);
      board.innerHTML = ""; renderRoleAssign();
    } }, "Clear all roles"));
  wrap.append(actions);

  // The list
  const table = el("div", { class: "ra-list" });
  const hdr = el("div", { class: "ra-row ra-hdr" });
  hdr.append(el("div", { class: "ra-c-name" }, "Goal"));
  hdr.append(el("div", { class: "ra-c-sec" }, "Section"));
  hdr.append(el("div", { class: "ra-c-sug" }, "Suggested"));
  hdr.append(el("div", { class: "ra-c-set" }, "Role"));
  table.append(hdr);

  goals.forEach((g) => {
    const row = el("div", { class: "ra-row" + (g.role ? "" : " none") });
    const nm = el("div", { class: "ra-c-name" });
    nm.append(el("span", { class: "ra-name" }, g.text || "(untitled)"));
    if (String(g.id || "").startsWith("rexp_")) nm.append(el("span", { class: "ra-badge" }, "scorecard"));
    row.append(nm);
    const p = gsP(g.pillar);
    const sec = el("div", { class: "ra-c-sec" });
    if (p && p.label) {
      sec.append(el("span", { class: "ra-dot", style: `background:${p.color}` }));
      sec.append(el("span", {}, p.label));
    } else sec.append(el("span", { class: "ra-muted" }, "\u2014"));
    row.append(sec);
    const sug = gsSuggestRole(g);
    const sc = el("div", { class: "ra-c-sug" });
    if (sug && sug !== (g.role || "")) {
      sc.append(el("button", { class: "ra-sugbtn", title: "Set this role",
        onClick: () => { g.role = sug; saveGoals(true); board.innerHTML = ""; renderRoleAssign(); } },
        gdRoleLabel(sug)));
    } else sc.append(el("span", { class: "ra-muted" }, sug ? "\u2713" : "\u2014"));
    row.append(sc);
    const setc = el("div", { class: "ra-c-set" });
    [["", "\u2014"], ["analyst", "A"], ["associate", "As"], ["director", "D"], ["vp", "VP"]].forEach(([k, lab]) => {
      setc.append(el("button", { class: "ra-pick" + ((g.role || "") === k ? " on" : ""), title: k ? gdRoleLabel(k) : "No role",
        onClick: () => { g.role = k; saveGoals(true); board.innerHTML = ""; renderRoleAssign(); } }, lab));
    });
    row.append(setc);
    table.append(row);
  });
  wrap.append(table);
  board.append(wrap);
}

// ---- Role ladder ----------------------------------------------------------
// How much completed work actually checks the boxes of each role. Counts the
// tasks tagged to that role's scorecard expectations, deduped (one task can
// serve several expectations but should only be counted once), split into done
// and outstanding. This is the answer to "am I already operating a level up?"
function gsRoleTally(role) {
  const goals = gsAllGoals().filter((g) => (g.role || "") === role && !gsIsPersonal(g));
  const sc = STATE.columns.find((c) => c.type === "status");
  const seen = new Set();
  let done = 0, total = 0, covered = 0;
  goals.forEach((g) => {
    const tied = gsTiedTasks(g);
    if (tied.length) covered++;
    tied.forEach((t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      total++;
      if (sc && String(t.cells[sc.id] || "") === "Done") done++;
    });
  });
  return { expectations: goals.length, covered, tasks: total, done };
}

function buildRoleLadder() {
  // "Completed work by role expectation" only means something on the career
  // ladder. Any other view (Personal, Ventures) has no rungs to compare.
  if (gdRoleFilter && !GD_LADDER_ROLES.includes(gdRoleFilter)) return null;
  const rows = GD_ROLES.filter(([k]) => GD_LADDER_ROLES.includes(k)).map(([k, label]) => [k, label, gsRoleTally(k)]);
  if (!rows.some((r) => r[2].expectations)) return null;   // no scorecard goals
  const bar = el("div", { class: "gd-ladder" });
  bar.append(el("div", { class: "gd-ladder-h" }, "Completed work by role expectation"));
  const grid = el("div", { class: "gd-ladder-grid" });
  rows.forEach(([k, label, t]) => {
    const cell = el("div", { class: "gd-ladder-cell" + (gdRoleFilter === k ? " on" : ""),
      title: `${t.done} completed task${t.done === 1 ? "" : "s"} tagged to ${label} expectations`
             + ` \u00B7 ${t.covered} of ${t.expectations} expectations have any task tagged`,
      onClick: () => { gdRoleFilter = k; try { localStorage.setItem("rs_gd_role", k); } catch (e) {} $("#board").innerHTML = ""; renderGoals(); } });
    cell.append(el("div", { class: "gd-ladder-role" }, label));
    cell.append(el("div", { class: "gd-ladder-done" }, String(t.done)));
    cell.append(el("div", { class: "gd-ladder-sub" }, t.tasks ? `done of ${t.tasks} tagged` : "no tasks tagged yet"));
    const pct = t.expectations ? Math.round(100 * t.covered / t.expectations) : 0;
    const barw = el("div", { class: "gd-ladder-bar" });
    barw.append(el("div", { class: "gd-ladder-fill", style: `width:${pct}%` }));
    cell.append(barw);
    cell.append(el("div", { class: "gd-ladder-cov" }, `${t.covered}/${t.expectations} expectations covered`));
    grid.append(cell);
  });
  bar.append(grid);
  return bar;
}

function gsSeedRoleExpectations() {
  if (GOALS.roleExpSeed === GS_ROLE_EXP_REV) return;
  if (!GS_ROLE_EXP.length) { GOALS.roleExpSeed = GS_ROLE_EXP_REV; return; }
  let added = 0, relinked = 0;
  GS_ROLE_EXP.forEach(([slug, area, note, roles]) => {
    const pillar = gsRoleExpSection(area, slug);
    ["analyst", "associate", "director", "vp"].forEach((role) => {
      const id = "rexp_" + slug + "_" + role;
      const bullets = roles[role] || [];
      const plan = bullets.map((b) => "\u2022 " + b).join("\n");
      const existing = (GOALS.ideas || []).find((i) => i.id === id);
      if (existing) {
        if (existing.pillar !== pillar) { existing.pillar = pillar; relinked++; }
        existing.plan = plan;                      // refresh from the scorecard
        if (note && !existing.why) existing.why = note;
        if (!existing.role) existing.role = role;
      } else {
        GOALS.ideas.push({
          id, text: area, pillar, role, plan, why: note || "",
          weaknessBoost: false, dashHidden: false, parent: "",
        });
        added++;
      }
    });
  });
  GOALS.roleExpSeed = GS_ROLE_EXP_REV;
  saveGoals(true);
  if (added || relinked) console.log(`[goals] role expectations: ${added} added, ${relinked} re-linked to sections`);
}

function loadGoals() {
  if (GOALS) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[GOALS_KEY]) || "{}"); } catch (e) { saved = {}; }
  GOALS = JSON.parse(JSON.stringify(GS_DEFAULTS));
  for (const k in saved) {
    if (k === "inputs" || k === "setup") Object.assign(GOALS[k], saved[k] || {});
    else GOALS[k] = saved[k];
  }
  // Make sure any newly-added input/setup ids exist.
  GS_INPUTS.forEach((i) => { if (!GOALS.inputs[i.id]) GOALS.inputs[i.id] = { done: false, streak: 0, warned: false }; });
  GS_SETUP.forEach((s) => { if (!GOALS.setup[s.id]) GOALS.setup[s.id] = { done: false }; });
  gsNormalizePillars();
  gsMigrateRefs();
  // Fresh installs start with empty values — no seeded goal set.
  // Existing databases keep whatever they already saved.
  if (GOALS.fwSeeded || (GOALS.ideas && GOALS.ideas.length)) {
    gsSeedFramework();
    gsSeedRoleExpectations();
  gsAdoptScorecardRoles();
  gsApplySectionRoles();
  gsMergePillars();
  gsRetireAutonomy();
  gsSeedPersonalScope();
  gsApplyScorecardV3();
  }
  gsMigrateImprovements();
}

const GS_FRAMEWORK = gsSeed("GS_FRAMEWORK", []);
function gsSeedFramework() {
  if (GOALS.fwSeeded) return;
  GOALS.ideas = GOALS.ideas || [];
  const have = new Set(GOALS.ideas.map((i) => i.id));
  const add = (node, pk, parentId, path) => {
    const id = "fw_" + path;
    if (!have.has(id)) GOALS.ideas.push({ id, text: node.t, pillar: pk, parent: parentId || null, seed: true });
    (node.children || []).forEach((ch, i) => add(ch, pk, id, path + "_" + i));
  };
  Object.keys(GS_FRAMEWORK).forEach((pk) => {
    GS_FRAMEWORK[pk].forEach((node, i) => add(node, pk, null, pk + "_" + i));
  });
  GOALS.fwSeeded = 1;
  saveGoals(true);
}
let gsSaveT;
function saveGoals(immediate) {
  const blob = JSON.stringify(GOALS);
  if (STATE.settings) STATE.settings[GOALS_KEY] = blob;
  clearTimeout(gsSaveT);
  if (immediate) saveSetting(GOALS_KEY, blob);
  else gsSaveT = setTimeout(() => saveSetting(GOALS_KEY, blob), 400);
  const flag = document.getElementById("gs-saved");
  if (flag) { flag.classList.add("show"); setTimeout(() => flag.classList.remove("show"), 1000); }
}

function gsPillarChip(key) {
  const p = gsP(key);
  return el("span", { class: "gs-pill", style: `--pc:${p.color}` }, p.label);
}

function gsEditable(field, cls) {
  const node = el("div", { class: "gs-edit " + (cls || ""), contenteditable: "true", "data-field": field });
  node.textContent = GOALS[field] || "";
  node.addEventListener("blur", () => {
    const v = node.textContent.trim();
    if (v !== GOALS[field]) { GOALS[field] = v; saveGoals(); }
  });
  return node;
}

function gsInputsDoneCount() {
  return GS_INPUTS.filter((i) => GOALS.inputs[i.id] && GOALS.inputs[i.id].done).length;
}

// ============================================================================
// GOALS OVERHAUL (2026-06-27-A) — dashboard + per-goal template/tracking,
// priority scoring (pillar weight x gap x weakness boost), Improvements
// absorbed as weakness mini-goals, Map nested under Goals. Frontend-only:
// every goal is an "idea" in GOALS.ideas, extended with plan/tracking/status/
// weaknessBoost/pin. Persisted via the existing goals_os blob.
// ============================================================================

const GS_WEAKNESS_BOOST = 1.6;

// ---- Improvements -> mini-goals (one-time, non-destructive: imp_tasks kept) ----
function gsImpCols() {
  const m = {};
  (STATE.imp_columns || []).forEach((c) => { m[String(c.name).trim().toLowerCase()] = c.id; });
  return m;
}
function gsMigrateImprovements() {
  if (GOALS.impAbsorbed) return;
  const c = gsImpCols();
  GOALS.ideas = GOALS.ideas || [];
  const have = new Set(GOALS.ideas.map((i) => i.id));
  let added = 0;
  (STATE.imp_tasks || []).forEach((t) => {
    const id = "imp_" + t.id;
    if (have.has(id)) return;
    const cell = (cid) => (cid && t.cells ? String(t.cells[cid] || "") : "");
    const title = cell(c["weakness"]).trim();
    if (!title) return;
    const sr = cell(c["status"]).toLowerCase();
    const status = (sr.includes("done") || sr.includes("complete")) ? "done"
                 : sr.includes("block") ? "blocked" : "active";
    const deadline = cell(c["target date"]).trim();
    GOALS.ideas.push({
      id, text: title, pillar: "", parent: null, seed: false, fromImp: true,
      why: cell(c["why it matters"]).trim(),
      plan: cell(c["path to improve"]).trim(),
      status, weaknessBoost: true,
      tracking: deadline ? { type: "deadline", deadline } : null,
    });
    added++;
  });
  GOALS.impAbsorbed = 1;
  saveGoals(true);
  if (added) console.log("[goals] absorbed " + added + " improvement(s) as weakness goals");
}

// ---- Scoring -------------------------------------------------------------
function gsTiedTasks(idea) {
  if (!goalColIds().length) return [];
  const tag = "idea:" + idea.id;
  const hits = STATE.tasks.filter((t) => !t.parent_id && taskGoalTags(t).includes(tag));
  // A task copied into several groups by the automations is ONE piece of work
  // wearing several rows — they share a link_id. Counting every placement would
  // inflate progress and the task list, so collapse each link group to a single
  // entry, preferring a completed placement so a finished task never reads as
  // outstanding. Tasks with no link_id are unique already and pass through.
  const seen = new Map();
  const out = [];
  hits.forEach((t) => {
    if (!t.link_id) { out.push(t); return; }
    const prev = seen.get(t.link_id);
    if (!prev) { seen.set(t.link_id, t); out.push(t); return; }
    if (isDoneStatus(t) && !isDoneStatus(prev)) {
      out[out.indexOf(prev)] = t;          // keep the finished placement
      seen.set(t.link_id, t);
    }
  });
  return out;
}
function gsGoalProgress(idea) {
  const tr = idea.tracking;
  if (tr) {
    if (tr.type === "percent") return Math.max(0, Math.min(1, Number(tr.current || 0) / 100));
    if (tr.type === "metric" || tr.type === "streak") {
      const tg = Number(tr.target || 0);
      if (tg > 0) return Math.max(0, Math.min(1, Number(tr.current || 0) / tg));
    }
    if (tr.type === "milestone") {
      const ms = tr.milestones || [];
      if (ms.length) return ms.filter((m) => m.done).length / ms.length;
    }
  }
  const tasks = gsTiedTasks(idea);
  if (tasks.length) {
    const sc = STATE.columns.find((cl) => cl.type === "status");
    const done = sc ? tasks.filter((t) => t.cells[sc.id] === "Done").length : 0;
    return done / tasks.length;
  }
  return idea.status === "done" ? 1 : 0;
}
function gsEffWeight(idea) {
  if (idea.weight != null && idea.weight !== "" && !isNaN(Number(idea.weight))) return Number(idea.weight);
  return gsP(idea.pillar).weight || 1;
}
function gsGoalScore(idea) {
  if (idea.status === "done") return 0;
  const gap = 1 - gsGoalProgress(idea);
  return gsEffWeight(idea) * gap * (idea.weaknessBoost ? GS_WEAKNESS_BOOST : 1);
}
function gsGoalById(id) { return (GOALS.ideas || []).find((i) => i.id === id); }
function gsAllGoals() { loadGoals(); return (GOALS.ideas || []).filter((i) => !gsIdeaHidden(i.id) && !i.dashHidden); }
function gsActiveGoals() { return gsAllGoals().filter((i) => i.status !== "done"); }
function gsTopGoals(n) {
  const active = gsActiveGoals();
  const pinned = active.filter((i) => i.pin).sort((a, b) => (a.pinOrder || 0) - (b.pinOrder || 0));
  const rest = active.filter((i) => !i.pin).sort((a, b) => gsGoalScore(b) - gsGoalScore(a));
  return [...pinned, ...rest].slice(0, n || 3);
}

// ---- Hub: sub-nav + dispatch --------------------------------------------

/** Whether a goals subview exists in this build.
 *
 *  Two mechanisms decide it and both have to be consulted: the single-file demo
 *  sets GS_HIDDEN_SUBVIEWS, a deployed build lists what it keeps in its profile.
 *  Anything checking only one gets the answer wrong in the other build - which
 *  is how the North Star came to render as a link to an Operating System the
 *  distribution build does not ship. */
function gsSubviewShown(key) {
  const hidden = (typeof GS_HIDDEN_SUBVIEWS !== "undefined") ? GS_HIDDEN_SUBVIEWS : [];
  if (hidden.includes(key)) return false;
  const keep = (window.PROFILE || {}).goalSubviews;
  return !Array.isArray(keep) || keep.includes(key);
}

function gsSubNav(active) {
  const nav = el("div", { class: "gs-subnav" });
  // With everything but the dashboard hidden there's nothing to navigate.
  // The single-file demo build sets GS_HIDDEN_SUBVIEWS; a deployed build lists
  // the subviews it keeps in its profile. Both are honoured.
  [["dash", "\u25CE Dashboard"], ["progress", "\u25F7 Progress"], ["improve", "\u25B2 Improvements"], ["os", "\u2699 Operating System"]]
    .filter(([k]) => gsSubviewShown(k))
    .forEach(([k, label]) => {
    nav.append(el("button", {
      class: "gs-subbtn" + (active === k ? " active" : ""),
      onClick: () => { goalsSubview = k; $("#board").innerHTML = ""; renderGoals(); },
    }, label));
  });
  if (nav.children.length < 2) return el("div", { style: "display:none" });
  return nav;
}
function renderGoals() {
  gsInjectCss();
  loadGoals();
  const board = $("#board");
  board.innerHTML = "";
  board.append(gsSubNav(goalsSubview === "detail" ? "dash" : goalsSubview));
  if (goalsSubview === "improve") { renderImprovements(); return; }
  if (goalsSubview === "os") { renderGoalsOS(); return; }
  if (goalsSubview === "progress") { renderProgress(); return; }
  if (goalsSubview === "roles") { renderRoleAssign(); return; }
  if (goalsSubview === "detail") { renderGoalDetail(gsDetailId); return; }
  renderGoalsDashboard();
}
function gsOpenGoal(id) { goalsSubview = "detail"; gsDetailId = id; $("#board").innerHTML = ""; renderGoals(); }
function gsBackToDash() { goalsSubview = "dash"; $("#board").innerHTML = ""; renderGoals(); }

// ---- Role view: filter the dashboard to one career level's goals ----------
// Analyst..VP are rungs of the scorecard ladder. "Personal" is a different
// axis entirely — it sorts life goals out of the career view — so it sits in
// the same switcher for convenience but never appears on the role ladder.
const GD_ROLES = gsSeed("GD_ROLES", [["", "All goals"], ["personal", "Personal"]]);
const GD_LADDER_ROLES = ["analyst", "associate", "director", "vp"];
// Every section sits in exactly one of three buckets. "" is the default and
// means the career ladder; the other two are sorted out of the Analyst-VP
// views because they are not role expectations. The bucket lives on the
// SECTION, so its goals inherit it and nothing has to be tagged twice.
const GS_SCOPES = [["", "Professional"], ["personal", "Personal"], ["ventures", "Side Hustle"]];
function gsScopeOf(pillarKey) { const p = gsP(pillarKey); return (p && p.scope) || ""; }
function gsScopeLabel(sc) { const e = GS_SCOPES.find((x) => x[0] === (sc || "")); return e ? e[1] : sc; }

// A goal is personal if its section is marked personal, or the goal itself is.
function gsIsPersonal(g) {
  if (!g) return false;
  if (g.personal) return true;
  return gsScopeOf(g.pillar) === "personal";
}
let gdRoleFilter = (() => { try { return localStorage.getItem("rs_gd_role") || ""; } catch (e) { return ""; } })();
function gdRoleMatch(g) {
  if (!gdRoleFilter) return true;
  if (gdRoleFilter === "personal") return gsIsPersonal(g);
  if (gdRoleFilter === "ventures") return gsScopeOf(g.pillar) === "ventures";
  // The career rungs exclude anything scoped out of the career view: personal
  // life and side ventures aren't role expectations.
  return (g.role || "") === gdRoleFilter && !gsScopeOf(g.pillar) && !g.personal;
}
function gdRoleLabel(key) { const r = GD_ROLES.find((x) => x[0] === key); return r ? r[1] : key; }

// ---- Dashboard -----------------------------------------------------------
function renderGoalsDashboard() {
  const board = $("#board");
  try { gsReconcile(); } catch (e) {}
  const wrap = el("div", { class: "gd-wrap" });

  const head = el("div", { class: "gd-head" });
  const ht = el("div", {});
  ht.append(el("div", { class: "gd-eyebrow" }, "Active goals"));
  ht.append(el("div", { class: "gd-title" }, "What am I moving forward?"));
  head.append(ht);
  // Sections (values) group your goals. Creating one was previously only
  // reachable from the Operating System tab; surface it where the goals are.
  head.append(el("button", { class: "tool-btn", title: "Create a new goal section (value) to group goals under",
    onClick: gsAddPillar }, "+ New Section"));
  head.append(el("button", { class: "tool-btn", title: "Rename, mark personal, or delete sections",
    onClick: gsManageSections }, "\u2699 Sections"));
  head.append(el("button", { class: "tool-btn", title: "Export the scorecard with the tasks that evidence each expectation",
    onClick: gsExportScorecard }, "\u2193 Scorecard"));
  head.append(el("button", { class: "tool-btn accent-teal", onClick: () => gsNewGoalForm(null) }, "+ New Goal"));
  wrap.append(head);

  // Role view switcher — tag each goal with a role in its detail page
  const roleBar = el("div", { class: "gd-rolebar" });
  GD_ROLES.forEach(([key, label]) => {
    roleBar.append(el("button", { class: "gd-role" + (gdRoleFilter === key ? " on" : ""),
      onClick: () => {
        gdRoleFilter = key;
        try { localStorage.setItem("rs_gd_role", key); } catch (e) {}
        $("#board").innerHTML = ""; renderGoals();
      } }, label));
  });
  const untagged = gsAllGoals().filter((g) => g.status !== "done" && !(g.role || "")).length;
  roleBar.append(el("button", { class: "gd-role-assign",
    title: "Sort every goal onto a rung of the scorecard ladder",
    onClick: () => { goalsSubview = "roles"; $("#board").innerHTML = ""; renderGoals(); } },
    untagged ? `\u21C6 Assign roles (${untagged} unset)` : "\u21C6 Assign roles"));
  wrap.append(roleBar);

  const ladder = buildRoleLadder();
  if (ladder) wrap.append(ladder);

  // North Star is the Operating System surfaced as one goal - a doorway into
  // it. A build that does not ship the Operating System has nothing behind that
  // door, so the card is left out rather than shown inert, telling people to go
  // and set an identity somewhere they cannot reach.
  if (gsSubviewShown("os")) {
    const ns = el("div", { class: "gd-northstar",
      onClick: () => { goalsSubview = "os"; $("#board").innerHTML = ""; renderGoals(); } });
    ns.append(el("div", { class: "gd-ns-eyebrow" }, "\u2605 North Star \u00B7 this quarter"));
    ns.append(el("div", { class: "gd-ns-identity" }, GOALS.identity || "Set your identity in the Operating System \u2192"));
    if (GOALS.objective) ns.append(el("div", { class: "gd-ns-obj" }, GOALS.objective));
    ns.append(el("div", { class: "gd-ns-link" }, "Open Operating System \u2192"));
    wrap.append(ns);
  }

  // Top 3
  const topSec = el("div", { class: "gd-section" });
  topSec.append(el("div", { class: "gd-sec-h" }, "Top 3 priorities"));
  topSec.append(el("div", { class: "gd-sec-sub" }, "Pinned first, then highest score = focus weight \u00D7 how far you still have to go (weaknesses boosted)."));
  const top = gdRoleFilter ? gsTopGoals(999).filter(gdRoleMatch).slice(0, 3) : gsTopGoals(3);
  const topRow = el("div", { class: "gd-top3" });
  if (!top.length) topRow.append(el("div", { class: "gd-empty" }, "No active goals yet \u2014 add one to start prioritizing."));
  top.forEach((g, i) => topRow.append(gsGoalCard(g, { rank: i + 1, big: true })));
  topSec.append(topRow);
  wrap.append(topSec);

  // All goals by pillar
  const allSec = el("div", { class: "gd-section" });
  allSec.append(el("div", { class: "gd-sec-h" }, "All goals by value"));
  const active = gsActiveGoals();
  const byPillar = {};
  active.forEach((g) => { (byPillar[g.pillar || ""] = byPillar[g.pillar || ""] || []).push(g); });
  const order = gsPillars().map((p) => p.key).concat([""]);
  const seen = new Set();
  let hiddenHere = 0;
  order.forEach((pk) => {
    if (seen.has(pk)) return; seen.add(pk);
    const list = (byPillar[pk] || []).filter(gdRoleMatch);
    // An empty section still renders (with a prompt) so a section you just
    // created is visible and can be filled. The catch-all "" bucket stays
    // hidden when empty — there's nothing to unassign to.
    if (!list.length && pk === "") return;
    list.sort((a, b) => gsGoalScore(b) - gsGoalScore(a));
    const p = gsP(pk);
    const grp = el("div", { class: "gd-pgroup" });
    if (pk && gsSectionHiddenHere(pk)) { hiddenHere++; return; }
    const gh = el("div", { class: "gd-pgroup-h" });
    gh.append(el("span", { class: "gd-pdot", style: `background:${p.color}` }));
    gh.append(el("span", { class: "gd-pname" }, p.label || "Unassigned"));
    if (p.weight) gh.append(el("span", { class: "gd-pweight" }, "weight " + p.weight));
    gh.append(el("span", { class: "gd-pcount" }, list.length + ""));
    if (pk) {
      gh.append(el("button", { class: "gd-phide",
        title: `Hide ${p.label} from the ${gsViewLabel()} view (it stays everywhere else)`,
        onClick: (e) => { e.stopPropagation(); gsSetSectionHiddenHere(pk, true); } }, "\u2715"));
    }
    grp.append(gh);
    const cards = el("div", { class: "gd-cards" });
    if (list.length) {
      list.forEach((g) => cards.append(gsGoalCard(g, {})));
    } else {
      const empty = el("div", { class: "gd-pempty" });
      const lvl = gdRoleFilter ? gdRoleLabel(gdRoleFilter) : "";
      empty.append(el("span", {}, lvl ? `No ${lvl}-level goals here yet.` : "No goals in this section yet."));
      empty.append(el("button", { class: "gd-pempty-add",
        title: lvl ? `Add a ${lvl}-level goal to this section` : "Add a goal to this section",
        onClick: () => gsNewGoalForm(null, pk, gdRoleFilter) },
        lvl ? `+ Add a ${lvl} goal` : "+ Add one"));
      cards.append(empty);
    }
    grp.append(cards);
    allSec.append(grp);
  });
  if (hiddenHere) {
    const note = el("div", { class: "gd-hidden-note" });
    note.append(el("span", {}, `${hiddenHere} section${hiddenHere === 1 ? "" : "s"} hidden in the ${gsViewLabel()} view`));
    note.append(el("button", { class: "gd-hidden-show", onClick: gsClearHiddenHere }, "Show them"));
    allSec.append(note);
  }
  const doneN = gsAllGoals().filter((i) => i.status === "done").length;
  if (doneN) allSec.append(el("div", { class: "gd-donecount" }, doneN + " completed goal" + (doneN > 1 ? "s" : "") + " hidden from the board"));
  const hiddenGoals = (GOALS.ideas || []).filter((i) => i.dashHidden && !gsIdeaHidden(i.id));
  if (hiddenGoals.length) {
    const hwrap = el("div", { class: "gd-hidden" });
    hwrap.append(el("button", { class: "gd-hidetoggle", onClick: () => { gdShowHidden = !gdShowHidden; $("#board").innerHTML = ""; renderGoals(); } }, (gdShowHidden ? "\u25BE Hide" : "\u25B8 Show") + " removed goals (" + hiddenGoals.length + ")"));
    if (gdShowHidden) {
      const hl = el("div", { class: "gd-hidelist" });
      hiddenGoals.forEach((g) => {
        const row = el("div", { class: "gd-hiderow" });
        row.append(el("span", { class: "gd-hidename" }, g.text || "Untitled"));
        row.append(el("button", { class: "gd-restore", onClick: () => { g.dashHidden = false; saveGoals(true); $("#board").innerHTML = ""; renderGoals(); } }, "restore"));
        hl.append(row);
      });
      hwrap.append(hl);
    }
    allSec.append(hwrap);
  }
  wrap.append(allSec);

  board.append(wrap);
}

function gsGoalCard(g, opt) {
  opt = opt || {};
  const p = gsP(g.pillar);
  const prog = gsGoalProgress(g);
  const card = el("div", { class: "gd-card" + (opt.big ? " big" : ""), style: `--pc:${p.color}`, onClick: () => gsOpenGoal(g.id) });
  if (opt.rank) card.append(el("div", { class: "gd-rank" }, "#" + opt.rank));
  card.append(el("button", { class: "gd-hidex", title: "Remove from the dashboard (the goal itself is kept)", onClick: (e) => { e.stopPropagation(); g.dashHidden = true; saveGoals(true); gsBackToDash(); } }, "\u00D7"));
  const top = el("div", { class: "gd-card-top" });
  top.append(el("span", { class: "gd-pill", style: `background:${p.color}` }, p.label || "Unassigned"));
  if (g.weaknessBoost) top.append(el("span", { class: "gd-wk" }, "\u26A1 weakness"));
  if (g.fromImp) top.append(el("span", { class: "gd-imp" }, "from Improvements"));
  if (g.role) top.append(el("span", { class: "gd-rolechip" }, gdRoleLabel(g.role)));
  card.append(top);
  card.append(el("div", { class: "gd-card-title" }, g.text || "Untitled goal"));
  const bar = el("div", { class: "gd-bar" });
  bar.append(el("div", { class: "gd-bar-fill", style: `width:${Math.round(prog * 100)}%;background:${p.color}` }));
  card.append(bar);
  const meta = el("div", { class: "gd-card-meta" });
  meta.append(el("span", {}, Math.round(prog * 100) + "% advanced"));
  meta.append(el("span", { class: "gd-score" }, "score " + Math.round(gsGoalScore(g))));
  meta.append(el("span", { class: "gd-wt" }, "w " + gsEffWeight(g)));
  if (!g.plan || !g.plan.trim()) meta.append(el("span", { class: "gd-noplan" }, "\u2691 plan needed"));
  card.append(meta);
  return card;
}

// ---- Detail page ---------------------------------------------------------
function gsField(label, node) { const w = el("div", { class: "gd-field" }); w.append(el("label", {}, label)); w.append(node); return w; }
function gsBlock(title, node) { const b = el("div", { class: "gd-block" }); b.append(el("div", { class: "gd-block-h" }, title)); b.append(node); return b; }
function gsAutoText(obj, field, ph) {
  const node = el("div", { class: "gd-text", contenteditable: "true", "data-ph": ph });
  node.textContent = obj[field] || "";
  node.addEventListener("blur", () => { const v = node.textContent.trim(); if (v !== (obj[field] || "")) { obj[field] = v; saveGoals(); } });
  return node;
}
function gsNum(label, val, onCommit) {
  const w = el("div", { class: "gd-mini" }); w.append(el("label", {}, label));
  const i = el("input", { type: "number", class: "gd-input" }); i.value = String(val == null ? 0 : val);
  i.addEventListener("change", () => onCommit(Number(i.value) || 0)); w.append(i); return w;
}
function gsTxt(label, val, onCommit) {
  const w = el("div", { class: "gd-mini" }); w.append(el("label", {}, label));
  const i = el("input", { type: "text", class: "gd-input" }); i.value = val || "";
  i.addEventListener("change", () => onCommit(i.value)); w.append(i); return w;
}

function renderGoalDetail(id) {
  const board = $("#board");
  const g = gsGoalById(id);
  if (!g) { gsBackToDash(); return; }
  const p = gsP(g.pillar);
  const wrap = el("div", { class: "gd-detail", style: `--pc:${p.color}` });

  wrap.append(el("button", { class: "gd-back", onClick: gsBackToDash }, "\u2190 All goals"));

  const title = el("div", { class: "gd-d-title", contenteditable: "true", "data-ph": "Name this goal" });
  title.textContent = g.text || "";
  title.addEventListener("blur", () => { const v = title.textContent.trim(); if (v && v !== g.text) { g.text = v; saveGoals(); } });
  wrap.append(title);

  const metaRow = el("div", { class: "gd-d-meta" });
  // value
  const psel = el("select", { class: "gd-sel", onChange: (e) => { g.pillar = e.target.value; saveGoals(); gsOpenGoal(id); } });
  gsPillars().forEach((pp) => psel.append(el("option", Object.assign({ value: pp.key }, pp.key === g.pillar ? { selected: "selected" } : {}), pp.label)));
  psel.append(el("option", Object.assign({ value: "" }, !g.pillar ? { selected: "selected" } : {}), "Unassigned"));
  metaRow.append(gsField("Value", psel));
  // status
  const ssel = el("select", { class: "gd-sel", onChange: (e) => { g.status = e.target.value; saveGoals(); gsOpenGoal(id); } });
  [["active", "Active"], ["blocked", "Blocked"], ["done", "Done"]].forEach(([v, l]) => {
    const cur = g.status || "active";
    ssel.append(el("option", Object.assign({ value: v }, cur === v ? { selected: "selected" } : {}), l));
  });
  metaRow.append(gsField("Status", ssel));
  // role (analyst / associate / director / vp) — feeds the dashboard's role views
  const rsel = el("select", { class: "gd-sel", onChange: (e) => { g.role = e.target.value; saveGoals(); gsOpenGoal(id); } });
  [["", "\u2014"], ["analyst", "Analyst"], ["associate", "Associate"], ["director", "Director"], ["vp", "VP"]].forEach(([v, l]) => {
    rsel.append(el("option", Object.assign({ value: v }, (g.role || "") === v ? { selected: "selected" } : {}), l));
  });
  metaRow.append(gsField("Role", rsel));
  // weakness boost
  const wkBtn = el("button", { class: "gd-toggle" + (g.weaknessBoost ? " on" : ""), onClick: () => { g.weaknessBoost = !g.weaknessBoost; saveGoals(); gsOpenGoal(id); } }, g.weaknessBoost ? "\u26A1 Weakness \u2014 boosted" : "Mark as weakness");
  metaRow.append(gsField("Priority boost", wkBtn));
  // pin
  const pinBtn = el("button", { class: "gd-toggle" + (g.pin ? " on" : ""), onClick: () => { if (g.pin) { g.pin = false; } else { g.pin = true; g.pinOrder = Date.now(); } saveGoals(); gsOpenGoal(id); } }, g.pin ? "\uD83D\uDCCC Pinned to Top" : "Pin to Top 3");
  metaRow.append(gsField("Pin", pinBtn));
  // manual weight (blank inherits the focus-area weight)
  const inh = gsP(g.pillar).weight || 0;
  const wInput = el("input", { type: "number", class: "gd-input", style: "width:86px", placeholder: String(inh) });
  wInput.value = (g.weight != null && g.weight !== "") ? String(g.weight) : "";
  wInput.addEventListener("change", () => { const v = wInput.value.trim(); g.weight = (v === "") ? null : Number(v); saveGoals(); gsOpenGoal(id); });
  metaRow.append(gsField("Weight \u00B7 blank = " + inh, wInput));
  // score
  metaRow.append(gsField("Priority score", el("div", { class: "gd-bigscore" }, String(Math.round(gsGoalScore(g))))));
  wrap.append(metaRow);
  const rmRow = el("div", { class: "gd-rmrow" });
  rmRow.append(el("button", { class: "gd-rm", onClick: () => { g.dashHidden = true; saveGoals(true); gsBackToDash(); } }, "\u2716 Remove from Goals dashboard"));
  rmRow.append(el("span", { class: "gd-muted" }, "The goal itself is kept."));
  wrap.append(rmRow);

  wrap.append(gsBlock("Why this matters", gsAutoText(g, "why", "What makes this goal worth pursuing?")));

  const planWrap = el("div", { class: "gd-block" + ((!g.plan || !g.plan.trim()) ? " gd-need" : "") });
  planWrap.append(el("div", { class: "gd-block-h" }, "Plan to advance it" + ((!g.plan || !g.plan.trim()) ? "  \u2014 required" : "")));
  planWrap.append(gsAutoText(g, "plan", "Concrete steps: the next move, and the move after that."));
  wrap.append(planWrap);

  wrap.append(gsTrackingBlock(g, id));
  wrap.append(gsSubGoalsBlock(g, id));
  wrap.append(gsTiedTasksBlock(g));

  board.append(wrap);
}

function gsTrackingBlock(g, id) {
  const block = el("div", { class: "gd-block" });
  block.append(el("div", { class: "gd-block-h" }, "How I'll track it"));
  const tr = g.tracking || { type: "" };
  const types = [["", "\u2014 none \u2014"], ["metric", "Number \u2192 target"], ["percent", "Percent complete"], ["milestone", "Milestone checklist"], ["streak", "Habit / streak"], ["deadline", "Deadline"]];
  const sel = el("select", { class: "gd-sel", onChange: (e) => {
    const t = e.target.value;
    g.tracking = t ? {
      type: t,
      current: (g.tracking && g.tracking.current) || 0,
      target: (g.tracking && g.tracking.target) || 0,
      unit: (g.tracking && g.tracking.unit) || "",
      milestones: (g.tracking && g.tracking.milestones) || [],
      deadline: (g.tracking && g.tracking.deadline) || "",
    } : null;
    saveGoals(); gsOpenGoal(id);
  } });
  types.forEach(([v, l]) => sel.append(el("option", Object.assign({ value: v }, tr.type === v ? { selected: "selected" } : {}), l)));
  block.append(sel);

  const body = el("div", { class: "gd-track-body" });
  if (tr.type === "metric" || tr.type === "streak") {
    if (tr.type === "metric") {
      body.append(gsNum("Current", tr.current, (v) => { tr.current = v; saveGoals(); gsOpenGoal(id); }));
      body.append(gsNum("Target", tr.target, (v) => { tr.target = v; saveGoals(); gsOpenGoal(id); }));
      body.append(gsTxt("Unit", tr.unit, (v) => { tr.unit = v; saveGoals(); }));
    } else {
      body.append(gsNum("Current streak", tr.current, (v) => { tr.current = v; saveGoals(); gsOpenGoal(id); }));
      body.append(gsNum("Target", tr.target, (v) => { tr.target = v; saveGoals(); gsOpenGoal(id); }));
    }
    // A counted goal is usually counting tasks, so show how many are actually
    // tagged to it — and let that number become the current value in one click
    // rather than being kept by hand.
    const tied = gsTiedTasks(g);
    const sc = STATE.columns.find((c) => c.type === "status");
    const doneN = sc ? tied.filter((t) => String(t.cells[sc.id] || "") === "Done").length : 0;
    const cnt = el("div", { class: "gd-tagcount" });
    if (!tied.length) {
      cnt.append(el("span", { class: "gd-tagcount-n" }, "0"));
      cnt.append(el("span", {}, "tasks tagged to this goal yet \u2014 tag some on the board and they'll be counted here."));
    } else {
      cnt.append(el("span", { class: "gd-tagcount-n" }, String(tied.length)));
      cnt.append(el("span", {}, `task${tied.length === 1 ? "" : "s"} tagged \u00B7 `));
      cnt.append(el("span", { class: "gd-tagcount-done" }, String(doneN)));
      cnt.append(el("span", {}, " completed"));
      const cur = Number(tr.current || 0);
      if (doneN !== cur) {
        cnt.append(el("button", { class: "gd-tagcount-use",
          title: "Set Current to the number of completed tasks tagged to this goal",
          onClick: () => { tr.current = doneN; saveGoals(); gsOpenGoal(id); } },
          `Use ${doneN}`));
      }
      if (tied.length !== cur && tied.length !== doneN) {
        cnt.append(el("button", { class: "gd-tagcount-use alt",
          title: "Set Current to every task tagged, finished or not",
          onClick: () => { tr.current = tied.length; saveGoals(); gsOpenGoal(id); } },
          `Use ${tied.length}`));
      }
    }
    body.append(cnt);
  } else if (tr.type === "percent") {
    const r = el("input", { type: "range", min: "0", max: "100", class: "gd-range" }); r.value = String(tr.current || 0);
    const lab = el("span", { class: "gd-rangeval" }, (tr.current || 0) + "%");
    r.addEventListener("input", () => { lab.textContent = r.value + "%"; });
    r.addEventListener("change", () => { tr.current = Number(r.value); saveGoals(); gsOpenGoal(id); });
    body.append(el("div", { class: "gd-rangewrap" }, r, lab));
  } else if (tr.type === "deadline") {
    const d = el("input", { type: "date", class: "gd-date" }); d.value = tr.deadline || "";
    d.addEventListener("change", () => { tr.deadline = d.value; saveGoals(); gsOpenGoal(id); });
    body.append(d);
    if (tr.deadline) {
      const days = Math.ceil((new Date(tr.deadline) - new Date()) / 86400000);
      body.append(el("span", { class: "gd-days" }, days >= 0 ? days + " days left" : Math.abs(days) + " days overdue"));
    }
  } else if (tr.type === "milestone") {
    tr.milestones = tr.milestones || [];
    tr.milestones.forEach((m, i) => {
      const row = el("div", { class: "gd-ms" });
      const chk = el("input", Object.assign({ type: "checkbox" }, m.done ? { checked: "checked" } : {}));
      chk.addEventListener("change", () => { m.done = chk.checked; saveGoals(); gsOpenGoal(id); });
      row.append(chk);
      row.append(el("span", { class: "gd-ms-t" + (m.done ? " done" : "") }, m.text));
      row.append(el("button", { class: "gd-ms-x", onClick: () => { tr.milestones.splice(i, 1); saveGoals(); gsOpenGoal(id); } }, "\u00D7"));
      body.append(row);
    });
    const add = el("input", { type: "text", class: "gd-ms-add", placeholder: "Add a milestone + Enter" });
    add.addEventListener("keydown", (e) => { if (e.key === "Enter" && add.value.trim()) { tr.milestones.push({ text: add.value.trim(), done: false }); saveGoals(); gsOpenGoal(id); } });
    body.append(add);
  } else {
    body.append(el("div", { class: "gd-muted" }, "No tracker \u2014 progress falls back to the share of tied tasks marked Done."));
  }
  block.append(body);
  return block;
}

function gsSubGoalsBlock(g, id) {
  const block = el("div", { class: "gd-block" });
  block.append(el("div", { class: "gd-block-h" }, "Sub-goals"));
  const kids = (GOALS.ideas || []).filter((i) => i.parent === g.id && !gsIdeaHidden(i.id));
  if (!kids.length) block.append(el("div", { class: "gd-muted" }, "No sub-goals yet \u2014 break this into the parts that make it up."));
  kids.forEach((k) => {
    const row = el("div", { class: "gd-subrow", onClick: () => gsOpenGoal(k.id) });
    const prog = gsGoalProgress(k);
    row.append(el("span", { class: "gd-sub-t" }, k.text));
    const bar = el("div", { class: "gd-bar mini" });
    bar.append(el("div", { class: "gd-bar-fill", style: `width:${Math.round(prog * 100)}%;background:${gsP(k.pillar).color}` }));
    row.append(bar);
    block.append(row);
  });
  block.append(el("button", { class: "gd-addsub", onClick: () => gsNewGoalForm(g.id) }, "+ Add sub-goal"));
  return block;
}

function gsTiedTasksBlock(g) {
  const block = el("div", { class: "gd-block" });
  const tasks = gsTiedTasks(g);
  block.append(el("div", { class: "gd-block-h" }, "Tasks advancing this (" + tasks.length + ")"));
  // Completed work on this goal over the last 12 weeks. Absent entirely when
  // there is none, rather than drawing a flat line that looks like data.
  if (typeof gpGoalActivity === "function") {
    const spark = gpGoalActivity(g);
    if (spark) block.append(spark);
  }

  const sc = STATE.columns.find((c) => c.type === "status");
  const pcol = STATE.columns.find((c) => c.is_primary) || STATE.columns[0];

  if (!tasks.length) {
    block.append(el("div", { class: "gd-muted" },
      "No tasks tagged yet \u2014 search below to tag one, or set a task's Goal column on the board."));
  }
  tasks.forEach((t) => {
    const done = sc ? t.cells[sc.id] === "Done" : false;
    const row = el("div", { class: "gd-task" + (done ? " done" : "") });
    row.append(el("span", { class: "gd-task-dot" }, done ? "\u2713" : "\u25CB"));
    const nameEl = el("span", { class: "gd-task-name", title: "Find this task on the board",
      onClick: () => { const nm = pcol ? String(t.cells[pcol.id] || "") : ""; setView("table");
                       const s2 = $("#search"); if (s2) { s2.value = nm; search = nm; render(); } } },
      (pcol ? t.cells[pcol.id] : "") || "Untitled");
    row.append(nameEl);
    row.append(el("button", { class: "gd-task-untag", title: "Remove this goal from that task",
      onClick: async (e) => { e.stopPropagation(); await gsUntagTask(t, g); gsOpenGoal(g.id); } }, "\u2715"));
    block.append(row);
  });

  // Tag a task straight from here rather than hunting for it on the board.
  block.append(gsTagTaskSearch(g));
  return block;
}

// Find the board's goal-link column (the one that isn't the Pillar column).
function gsGoalLinkCol() {
  return STATE.columns.find((c) => c.type === "goal" && !/pillar|value/i.test(String(c.name || "")));
}
async function gsTagTask(task, goal) {
  const col = gsGoalLinkCol();
  if (!col) return;
  const tag = "idea:" + goal.id;
  const tags = parseGoalTags(task.cells[col.id]);
  if (tags.includes(tag)) return;
  const next = tags.concat([tag]);
  const val = serializeGoalTags(next);
  task.cells[col.id] = val;
  await updateCell(task.id, col.id, val);
  // Keep the Pillar column in step, exactly as tagging on the board would.
  if (typeof syncPillarsFromGoals === "function") await syncPillarsFromGoals(task, col, next);
}
async function gsUntagTask(task, goal) {
  const col = gsGoalLinkCol();
  if (!col) return;
  const tag = "idea:" + goal.id;
  const next = parseGoalTags(task.cells[col.id]).filter((x) => x !== tag);
  const val = serializeGoalTags(next);
  task.cells[col.id] = val;
  await updateCell(task.id, col.id, val);
  if (typeof syncPillarsFromGoals === "function") await syncPillarsFromGoals(task, col, next);
}

function gsTagTaskSearch(g) {
  const wrap = el("div", { class: "gd-tagsearch" });
  if (!gsGoalLinkCol()) {
    wrap.append(el("div", { class: "gd-muted" }, "No Goal column on the board to tag into."));
    return wrap;
  }
  const inp = el("input", { class: "gd-tagsearch-in", type: "search",
    placeholder: "Search tasks to tag to this goal\u2026" });
  const results = el("div", { class: "gd-tagsearch-res" });
  wrap.append(inp, results);

  const pcol = STATE.columns.find((c) => c.is_primary) || STATE.columns[0];
  const sc = STATE.columns.find((c) => c.type === "status");
  const col = gsGoalLinkCol();

  const run = () => {
    results.innerHTML = "";
    const q = inp.value.trim().toLowerCase();
    if (!q) return;
    const tag = "idea:" + g.id;
    // One row per piece of work: linked copies share a link_id, so show one.
    const seen = new Set();
    const hits = [];
    STATE.tasks.forEach((t) => {
      if (t.parent_id) return;
      if (parseGoalTags(t.cells[col.id]).includes(tag)) return;      // already tagged
      const nm = String(t.cells[pcol.id] || "");
      if (!nm.toLowerCase().includes(q)) return;
      const key = t.link_id || t.id;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(t);
    });
    if (!hits.length) {
      results.append(el("div", { class: "gd-muted" }, "No matching task \u2014 or it's already tagged."));
      return;
    }
    hits.slice(0, 8).forEach((t) => {
      const done = sc ? String(t.cells[sc.id] || "") === "Done" : false;
      const row = el("div", { class: "gd-tagsearch-row" + (done ? " done" : "") });
      row.append(el("span", { class: "gd-tagsearch-name" }, String(t.cells[pcol.id] || "Untitled")));
      row.append(el("span", { class: "gd-tagsearch-grp" }, t.group_name || ""));
      row.append(el("button", { class: "gd-tagsearch-add", title: "Tag this goal onto that task",
        onClick: async () => { await gsTagTask(t, g); gsOpenGoal(g.id); } }, "+ tag"));
      results.append(row);
    });
    if (hits.length > 8) {
      results.append(el("div", { class: "gd-muted" }, `${hits.length - 8} more \u2014 keep typing to narrow it.`));
    }
  };
  inp.addEventListener("input", run);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { inp.value = ""; run(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results.querySelector(".gd-tagsearch-add");
      if (first) first.click();
    }
  });
  return wrap;
}

// ---- New-goal template ---------------------------------------------------
function gsFormRow(label, node) { const r = el("div", { class: "gd-formrow" }); r.append(el("label", {}, label)); r.append(node); return r; }
function gsNewGoalForm(parentId, presetPillar, presetRole) {
  loadGoals();
  openModal(parentId ? "New sub-goal" : "New goal", (body, close) => {
    body.classList.add("gd-form");
    const parent = parentId ? gsGoalById(parentId) : null;
    const defPillar = presetPillar || (parent && parent.pillar) || (gsPillars()[0] || {}).key || "";
    const defRole = gsSectionRole(defPillar);
    const titleI = el("input", { type: "text", class: "gd-input", placeholder: "The goal, in one line" });
    body.append(gsFormRow("Goal", titleI));
    const psel = el("select", { class: "gd-sel" });
    gsPillars().forEach((p) => psel.append(el("option", Object.assign({ value: p.key }, p.key === defPillar ? { selected: "selected" } : {}), p.label)));
    psel.append(el("option", { value: "" }, "Unassigned"));
    body.append(gsFormRow("Value", psel));
    const whyI = el("textarea", { class: "gd-input", rows: "2", placeholder: "Why it matters" });
    body.append(gsFormRow("Why", whyI));
    const planI = el("textarea", { class: "gd-input", rows: "3", placeholder: "Plan \u2014 the next concrete moves (required)" });
    body.append(gsFormRow("Plan", planI));
    const wk = el("input", { type: "checkbox" });
    const wkL = el("label", { class: "gd-chk" }); wkL.append(wk); wkL.append(document.createTextNode(" This targets a weakness (boosts its priority)"));
    body.append(wkL);
    if (parent) body.append(el("div", { class: "gd-muted", style: "margin-top:6px" }, "Sub-goal of: " + parent.text));
    const err = el("div", { class: "gd-err" });
    body.append(err);
    const save = el("button", { class: "tool-btn accent-teal", onClick: () => {
      const text = titleI.value.trim(); const plan = planI.value.trim();
      if (!text) { err.textContent = "Give the goal a title."; return; }
      if (!plan) { err.textContent = "A plan is required \u2014 what are the next moves?"; return; }
      const id = "g_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      GOALS.ideas = GOALS.ideas || [];
      GOALS.ideas.push({ id, text, pillar: psel.value, parent: parentId || null, seed: false,
        why: whyI.value.trim(), plan, status: "active", weaknessBoost: wk.checked, tracking: null,
        role: presetRole || (parent && parent.role) || "" });
      saveGoals(true); close(); gsOpenGoal(id);
    } }, "Create goal");
    const actions = el("div", { class: "gd-actions" });
    actions.append(el("button", { class: "tool-btn", onClick: close }, "Cancel"));
    actions.append(save);
    body.append(actions);
  });
}

// ---- Styles (injected once) ---------------------------------------------
function gsInjectCss() {
  if (document.getElementById("gd-css")) return;
  const css = `
  .gs-subnav{display:flex;gap:8px;padding:14px 18px 0;flex-wrap:wrap}
  .gs-subbtn{border:1px solid #d9d9d6;background:var(--surface);color:#00859b;font-weight:600;font-size:13px;padding:8px 16px;border-radius:9px 9px 0 0;cursor:pointer;font-family:inherit}
  .gs-subbtn:hover{background:#ebf2e6}
  .gs-subbtn.active{background:#00859b;color:#fff;border-color:#00859b}
  .gd-wrap{padding:16px 18px 60px;max-width:1180px;margin:0 auto}
  .gd-head{display:flex;align-items:flex-end;justify-content:space-between;margin:8px 0 18px}
  .gd-rolebar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:-6px 0 16px}
  .gd-role{border:1px solid var(--light-gray);background:var(--surface);color:#5d6b66;font-size:12px;font-weight:700;border-radius:20px;padding:4px 13px;cursor:pointer;font-family:inherit}
  .gd-role:hover{background:var(--off-white)}
  .gd-role.on{background:var(--teal);border-color:var(--teal);color:#fff}
  .gd-role-note{font-size:11px;color:#9aa8a3;font-style:italic}
  .gd-rolechip{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--teal);background:var(--pale-teal);border-radius:5px;padding:1px 6px}
  .gd-eyebrow{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#77b28c}
  .gd-title{font-size:26px;font-weight:800;color:#0c3b44;font-family:Fraunces,Georgia,serif}
  .gd-northstar{background:linear-gradient(120deg,#00859b,#00bfb8);color:#fff;border-radius:14px;padding:18px 20px;cursor:pointer;margin-bottom:22px;box-shadow:0 4px 14px rgba(0,133,155,.22)}
  .gd-northstar:hover{filter:brightness(1.04)}
  .gd-ns-eyebrow{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;opacity:.9}
  .gd-ns-identity{font-size:17px;font-weight:700;margin:6px 0 4px;line-height:1.35}
  .gd-ns-obj{font-size:13.5px;opacity:.95;line-height:1.45}
  .gd-ns-link{font-size:12px;font-weight:700;margin-top:8px;opacity:.95}
  .gd-section{margin-bottom:26px}
  .gd-sec-h{font-size:15px;font-weight:800;color:#0c3b44;margin-bottom:3px}
  .gd-sec-sub{font-size:12px;color:var(--text-2);margin-bottom:12px;max-width:760px}
  .gd-top3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  @media(max-width:900px){.gd-top3{grid-template-columns:1fr}}
  .gd-empty{color:var(--text-2);font-size:13px;padding:14px;background:#ebf2e6;border-radius:10px;grid-column:1/-1}
  .gd-card{position:relative;background:var(--surface);border:1px solid #e3ece4;border-left:5px solid var(--pc,#77b28c);border-radius:11px;padding:13px 15px;cursor:pointer;transition:transform .08s,box-shadow .12s}
  .gd-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.08)}
  .gd-card.big{padding:16px 17px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
  .gd-rank{position:absolute;top:10px;right:13px;font-size:20px;font-weight:800;color:#cce7eb;font-family:Fraunces,serif}
  .gd-card-top{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:7px}
  .gd-pill{color:#fff;font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:20px;letter-spacing:.3px}
  .gd-wk{font-size:10.5px;font-weight:700;color:#b9520a;background:#fbe6cf;padding:2px 8px;border-radius:20px}
  .gd-imp{font-size:10px;font-weight:600;color:var(--text-2);background:#f1f4ef;padding:2px 8px;border-radius:20px}
  .gd-card-title{font-size:15px;font-weight:700;color:var(--ink);line-height:1.3;margin-bottom:10px}
  .gd-card.big .gd-card-title{font-size:16.5px}
  .gd-bar{height:7px;background:#eef2ec;border-radius:6px;overflow:hidden;margin-bottom:9px}
  .gd-bar.mini{height:5px;margin:0 0 0 0;flex:0 0 90px}
  .gd-bar-fill{height:100%;border-radius:6px;transition:width .3s}
  .gd-card-meta{display:flex;gap:12px;align-items:center;font-size:11.5px;color:var(--text-2);flex-wrap:wrap}
  .gd-score{font-weight:700;color:#00859b}
  .gd-noplan{font-weight:700;color:#b9520a}
  .gd-pgroup{margin-bottom:18px}
  .gd-pgroup-h{display:flex;align-items:center;gap:9px;margin:0 0 10px}
  .gd-pdot{width:11px;height:11px;border-radius:50%}
  .gd-pname{font-size:13.5px;font-weight:800;color:#0c3b44}
  .gd-pweight{font-size:11px;color:#9aa8a3;font-weight:600}
  .gd-pcount{font-size:11px;color:#fff;background:#b3c0bb;border-radius:20px;padding:1px 8px;font-weight:700}
  .gd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:11px}
  .gd-donecount{font-size:12px;color:#9aa8a3;margin-top:6px}
  /* detail */
  .gd-detail{padding:16px 20px 70px;max-width:840px;margin:0 auto;border-top:4px solid var(--pc,#77b28c)}
  .gd-back{background:none;border:none;color:#00859b;font-weight:700;font-size:13px;cursor:pointer;padding:8px 0 4px;font-family:inherit}
  .gd-back:hover{text-decoration:underline}
  .gd-d-title{font-size:26px;font-weight:800;color:#0c3b44;font-family:Fraunces,serif;outline:none;border-bottom:2px dashed transparent;padding:4px 0;margin-bottom:14px}
  .gd-d-title:focus{border-bottom-color:#cce7eb}
  .gd-d-meta{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;background:#f6f9f4;border:1px solid #e3ece4;border-radius:11px;padding:13px 16px;margin-bottom:18px}
  .gd-field{display:flex;flex-direction:column;gap:5px}
  .gd-field>label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#9aa8a3}
  .gd-sel,.gd-input,.gd-date,.gd-toggle{font-family:inherit;font-size:13px;border:1px solid #d9d9d6;border-radius:8px;padding:7px 10px;background:var(--surface);color:var(--ink)}
  .gd-sel{cursor:pointer}
  .gd-toggle{cursor:pointer;font-weight:600;white-space:nowrap}
  .gd-toggle.on{background:#00859b;color:#fff;border-color:#00859b}
  .gd-bigscore{font-size:26px;font-weight:800;color:#00859b;font-family:Fraunces,serif;line-height:1}
  .gd-block{margin-bottom:16px}
  .gd-block-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#00859b;margin-bottom:8px}
  .gd-need .gd-block-h{color:#b9520a}
  .gd-need .gd-text{border-color:#f0c08a;background:#fffaf3}
  .gd-text{min-height:46px;border:1px solid #e3ece4;border-radius:9px;padding:10px 12px;font-size:14px;line-height:1.5;color:var(--ink);outline:none;background:var(--surface)}
  .gd-text:focus{border-color:#00bfb8}
  .gd-text:empty:before{content:attr(data-ph);color:#b3b3b3}
  .gd-d-title:empty:before{content:attr(data-ph);color:#cdd6cf}
  .gd-track-body{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:10px}
  .gd-mini{display:flex;flex-direction:column;gap:4px}
  .gd-mini>label{font-size:10.5px;font-weight:700;color:#9aa8a3;text-transform:uppercase}
  .gd-mini .gd-input{width:120px}
  .gd-rangewrap{display:flex;align-items:center;gap:12px;width:100%}
  .gd-range{flex:1;accent-color:#00bfb8}
  .gd-rangeval{font-weight:800;color:#00859b;font-size:15px;min-width:48px}
  .gd-days{font-weight:700;color:#00859b;font-size:13px;align-self:center}
  .gd-ms{display:flex;align-items:center;gap:9px;width:100%;padding:4px 0}
  .gd-ms input[type=checkbox]{accent-color:#38a66f;width:16px;height:16px}
  .gd-ms-t{font-size:14px;color:var(--ink);flex:1}
  .gd-ms-t.done{text-decoration:line-through;color:#9aa8a3}
  .gd-ms-x{background:none;border:none;color:#c98;cursor:pointer;font-size:17px;line-height:1}
  .gd-ms-add{width:100%;margin-top:6px}
  .gd-muted{font-size:13px;color:#9aa8a3}
  .gd-subrow{display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid #e3ece4;border-radius:9px;margin-bottom:7px;cursor:pointer;background:var(--surface)}
  .gd-subrow:hover{background:#f6f9f4}
  .gd-sub-t{flex:1;font-size:14px;color:var(--ink)}
  .gd-addsub{margin-top:6px;background:#ebf2e6;border:1px dashed #9ec4ab;color:#2f7a52;font-weight:700;font-size:12.5px;border-radius:8px;padding:8px 14px;cursor:pointer;font-family:inherit}
  .gd-addsub:hover{background:#e0ecd8}
  .gd-task{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:14px;color:var(--ink)}
  .gd-task:hover{background:#f6f9f4}
  .gd-task.done{color:#9aa8a3}
  .gd-task-dot{color:#38a66f;font-weight:800}
  .gd-form .gd-formrow{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
  .gd-form .gd-formrow>label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#9aa8a3}
  .gd-form .gd-input,.gd-form .gd-sel{width:100%}
  .gd-form textarea.gd-input{resize:vertical;font-family:inherit;line-height:1.5}
  .gd-chk{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);margin:4px 0}
  .gd-chk input{accent-color:#38a66f;width:16px;height:16px}
  .gd-err{color:#c0392b;font-size:12.5px;font-weight:600;min-height:18px;margin-top:6px}
  .gd-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
  .gd-wt{font-weight:600;color:var(--text-2)}
  .gd-hidex{position:absolute;top:8px;right:11px;background:none;border:none;color:#c3ccc6;font-size:17px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s}
  .gd-card:hover .gd-hidex{opacity:1}
  .gd-hidex:hover{color:#b9520a}
  .gd-rmrow{display:flex;align-items:center;gap:10px;margin:2px 0 16px}
  .gd-rm{background:#fbe9e7;border:1px solid #f1c4bd;color:#b0392b;font-weight:600;font-size:12.5px;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit}
  .gd-rm:hover{background:#f7ddd9}
  .gd-hidden{margin-top:14px}
  .gd-hidetoggle{background:none;border:none;color:var(--text-2);font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;padding:4px 0}
  .gd-hidelist{margin-top:6px;display:flex;flex-direction:column;gap:6px}
  .gd-hiderow{display:flex;align-items:center;gap:12px;background:#f4f6f3;border:1px solid #e3ece4;border-radius:8px;padding:7px 12px}
  .gd-hidename{flex:1;font-size:13px;color:#5d6b66}
  .gd-restore{background:#ebf2e6;border:1px solid #9ec4ab;color:#2f7a52;font-weight:700;font-size:11.5px;border-radius:7px;padding:4px 10px;cursor:pointer;font-family:inherit}
  .calw{padding:6px 18px 50px;max-width:1180px;margin:0 auto}
  .calw-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
  .calw-title{font-weight:800;color:#0c3b44;font-size:16px;font-family:Fraunces,Georgia,serif;min-width:150px;text-align:center}
  .calw-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
  @media(max-width:760px){.calw-grid{grid-template-columns:repeat(2,1fr)}}
  .calw-col{background:var(--surface);border:1px solid #e3ece4;border-radius:10px;min-height:150px;padding:8px;display:flex;flex-direction:column;gap:5px}
  .calw-col.today{border-color:#00bfb8;box-shadow:0 0 0 2px #cfeeec}
  .calw-dow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#9aa8a3}
  .calw-date{font-size:18px;font-weight:800;color:var(--ink);font-family:Fraunces,serif;margin-bottom:2px}
  .calw-ev{font-size:11.5px;border-left:3px solid #5d7479;padding:2px 6px;border-radius:4px;background:#f6f9f4;cursor:pointer;line-height:1.3}
  .calw-ev b{color:#00859b;font-weight:700;margin-right:4px}
  .calw-task{font-size:11.5px;color:#fff;border-radius:5px;padding:2px 7px}
  .calw-more{font-size:11px;color:#9aa8a3}
  `;
  const s = el("style", { id: "gd-css" });
  s.textContent = css;
  document.head.append(s);
}

function renderGoalsOS() {
  loadGoals();
  gsReconcile();
  gsReconcileExpectations();
  const board = $("#board");
  const wrap = el("div", { class: "gs-wrap" });

  // ---- Header strip: identity-as-headline + lagging scoreboard + week counter ----
  const head = el("div", { class: "gs-head" });
  const hl = el("div", {});
  hl.append(el("div", { class: "gs-eyebrow" }, gsSeed("GS_OS_EYEBROW", "Operating system")));
  hl.append(el("div", { class: "gs-headline" }, "Run the loop, not the goal"));
  head.append(hl);
  const counter = el("div", { class: "gs-weekcount" });
  counter.append(el("span", { class: "gs-weekcount-n", id: "gs-week-n" }, `${gsInputsDoneCount()}/${GS_INPUTS.length}`));
  counter.append(el("span", { class: "gs-weekcount-l" }, "inputs this week"));
  head.append(counter);
  wrap.append(head);

  const score = el("div", { class: "gs-score" });
  score.append(el("span", { class: "gs-score-lab" }, "Lagging scoreboard — review monthly, don't aim your days at it:"));
  gsSeed("GS_OS_TARGETS", []).forEach((s) =>
    score.append(el("span", { class: "gs-chip-lag" }, s)));
  wrap.append(score);

  // ---- The loop ----
  const loop = el("div", { class: "gs-loop" });
  GS_LOOP.forEach((node, i) => {
    const n = el("div", { class: "gs-node" + (i === GS_LOOP.length - 1 ? " gs-node-last" : "") });
    n.append(el("div", { class: "gs-node-n" }, node.n));
    n.append(el("div", { class: "gs-node-t" }, node.t));
    n.append(el("div", { class: "gs-node-who" }, node.who));
    loop.append(n);
  });
  wrap.append(loop);
  wrap.append(el("div", { class: "gs-loopband" }, "The outcome is a lagging output of this loop — it depends on others and timing, so it isn't the thing you aim at."));

  // ---- 01 Diagnose ----
  wrap.append(gsSectionHead("01 / Diagnose", "Start with the problem", "Rumelt — \u201Cgoals are not strategy\u201D"));
  const diagCard = el("div", { class: "gs-card" });
  diagCard.append(el("div", { class: "gs-kicker" }, "The honest read · click to edit"));
  diagCard.append(gsEditable("diagnosis", "gs-diag"));
  const crux = el("div", { class: "gs-crux" });
  crux.append(el("div", { class: "gs-crux-lab" }, "The crux"));
  crux.append(gsEditable("crux", "gs-crux-text"));
  diagCard.append(crux);
  wrap.append(diagCard);

  // ---- 02 Objective + Identity ----
  wrap.append(gsSectionHead("02 / Objective + Identity", "One proximate target you control", "Rumelt · Clear · the Stoics"));
  const oi = el("div", { class: "gs-2col" });
  const idCard = el("div", { class: "gs-card" });
  idCard.append(el("div", { class: "gs-kicker" }, "Identity — who I'm becoming"));
  idCard.append(gsEditable("identity", "gs-identity"));
  idCard.append(el("div", { class: "gs-hint" }, "Clear: you fall to your systems and rise to your identity — actions vote for the person you've decided to be."));
  oi.append(idCard);
  const objCard = el("div", { class: "gs-card" });
  objCard.append(el("div", { class: "gs-kicker" }, "Proximate objective — close enough to know how to hit it"));
  objCard.append(gsEditable("objective", "gs-objective"));
  objCard.append(el("div", { class: "gs-hint" }, "Set on effort and conduct, not the decision itself. Epictetus: aim only at what's up to you."));
  oi.append(objCard);
  wrap.append(oi);

  // ---- 03 Inputs ----
  wrap.append(gsSectionHead("03 / Inputs you control", "Track the behavior, not the outcome", "Clear — never miss twice"));
  const inCard = el("div", { class: "gs-card" });
  const inHead = el("div", { class: "gs-inhead" });
  const savedFlag = el("span", { class: "gs-saved", id: "gs-saved" }, "saved ✓");
  inHead.append(el("div", { class: "gs-muted" }, "Tap the box when you do it this week.", savedFlag));
  inHead.append(el("button", { class: "tool-btn", onClick: () => { gsCloseWeek(); } }, "Close out the week →"));
  inCard.append(inHead);
  GS_INPUTS.forEach((it) => inCard.append(gsInputRow(it)));
  wrap.append(inCard);

  // ---- Environment design / setup ----
  wrap.append(gsSectionHead("03b / Environment design", "Shape the surroundings so the right work is the default", "Clear — make the cue invisible"));
  const envCard = el("div", { class: "gs-card" });
  envCard.append(el("div", { class: "gs-kicker" }, "One-time builds · a setup checklist, not a streak"));
  GS_SETUP.forEach((s) => envCard.append(gsSetupRow(s)));
  wrap.append(envCard);

  // ---- The case: what it rests on, and where to spend time ----
  wrap.append(gsSectionHead(gsSeed("GS_OS_PATH_LABEL", "04 / The case"), gsSeed("GS_OS_PATH_SUB", "What it rests on"), "the case, and where to spend time"));
  const caseRow = el("div", { class: "gs-case" });
  GS_CASE.forEach((c) => {
    const card = el("div", { class: "gs-case-card" });
    card.append(el("div", { class: "gs-case-t" }, c.t));
    card.append(el("div", { class: "gs-case-d" }, c.d));
    caseRow.append(card);
  });
  wrap.append(caseRow);

  const focusCard = el("div", { class: "gs-card" });
  const fhead = el("div", { class: "gs-focus-head" });
  fhead.append(el("div", { class: "gs-kicker" }, "Pillars & where to spend the time — editable"));
  fhead.append(el("button", { class: "gs-addpillar", onClick: gsAddPillar }, "+ Add pillar"));
  focusCard.append(fhead);
  let pTotal = 0;
  gsPillars().forEach((p) => {
    if (gsPillarHidden(p.key)) return;   // hidden values drop out of the bars
    pTotal += Number(p.weight) || 0;
    const row = el("div", { class: "gs-bar-row" });
    const top = el("div", { class: "gs-bar-top" });
    const sw = el("input", { type: "color", class: "gs-swatch", value: p.color, title: "Pillar color" });
    sw.addEventListener("input", () => { p.color = sw.value; fill.style.background = sw.value; saveGoals(true); });
    top.append(sw);
    const nm = el("span", { class: "gs-bar-name gs-edit", contenteditable: "true", title: "Rename" }, p.label);
    nm.addEventListener("blur", () => { const v = nm.textContent.trim(); if (v) { p.label = v; saveGoals(true); } });
    top.append(nm);
    const wIn = el("input", { type: "number", class: "gs-weight", min: "0", max: "100", value: String(p.weight) });
    wIn.addEventListener("change", () => { const v = Math.max(0, Math.min(100, parseInt(wIn.value || "0", 10) || 0)); p.weight = v; wIn.value = String(v); fill.style.width = v + "%"; saveGoals(true); });
    top.append(wIn);
    top.append(el("span", { class: "gs-bar-pct" }, "%"));
    top.append(el("span", { class: "gs-eye", title: "Hide this value (from the Map, these bars, and the cell pickers)", onClick: () => { gsToggleHidePillar(p.key); $("#board").innerHTML = ""; renderGoals(); } }, ""));
    if (!p.base) top.append(el("span", { class: "gs-x", title: "Remove pillar", onClick: () => gsRemovePillar(p.key) }, "✕"));
    const tally = gsPillarTaskTally(p.key);
    if (tally.total) {
      top.append(el("span", { class: "gs-bar-tasks", title: "Tasks tagged to this value via the Goal column", onClick: () => setView("table") },
        `${tally.done}/${tally.total} tasks`));
    }
    const projN = gsPillarProjectTally(p.key);
    if (projN) {
      top.append(el("span", { class: "gs-bar-tasks", title: "Vibe Coding projects linked to this value", onClick: () => { if (typeof notebookTab !== "undefined") notebookTab = "vibe"; setView("notes"); } },
        `${projN} project${projN === 1 ? "" : "s"}`));
    }
    row.append(top);
    const track = el("div", { class: "gs-track" });
    const fill = el("div", { class: "gs-fill", style: `width:${Math.min(100, p.weight)}%;background:${p.color}` });
    track.append(fill);
    row.append(track);
    const why = el("div", { class: "gs-bar-why gs-edit", contenteditable: "true", title: "Why this matters" }, p.why || "");
    why.addEventListener("blur", () => { p.why = why.textContent.trim(); saveGoals(true); });
    row.append(why);
    focusCard.append(row);
  });
  // Hidden values — click a chip to bring it back.
  const hiddenP = gsPillars().filter((p) => gsPillarHidden(p.key));
  if (hiddenP.length) {
    const hr = el("div", { class: "gs-hidden-row" });
    hr.append(el("span", { class: "gs-hidden-lab" }, `Hidden (${hiddenP.length}):`));
    hiddenP.forEach((p) => {
      hr.append(el("span", { class: "gs-hidden-chip", style: `border-left:3px solid ${p.color}`, title: "Click to unhide", onClick: () => { gsToggleHidePillar(p.key); $("#board").innerHTML = ""; renderGoals(); } }, p.label + " ↩"));
    });
    focusCard.append(hr);
  }
  focusCard.append(el("div", { class: "gs-focus-total" }, `Total weighting: ${pTotal}%${pTotal === 100 ? "" : " — a rough guide; it doesn't have to sum to 100"}`));
  wrap.append(focusCard);

  // ---- 04b Role expectations ----
  wrap.append(gsSectionHead("04b / Role expectations", "The standard the work is held to", gsSeed("roleTitle", "")));
  const expIntro = el("div", { class: "gs-muted", style: "margin-bottom:14px" },
    "What the role demands, by competency. Tick one when you're living it, or press “+ board” to spin it into a real task — completion syncs back here.");
  wrap.append(expIntro);
  const expWrap = el("div", { class: "gs-exp-grid" });
  GS_EXPECTATIONS.forEach((comp) => {
    const card = el("div", { class: "gs-exp-card", style: `--pc:${gsP(comp.pillar).color}` });
    const ch = el("div", { class: "gs-exp-head" });
    ch.append(el("span", { class: "gs-exp-title" }, comp.t));
    ch.append(gsPillarChip(comp.pillar));
    card.append(ch);
    comp.items.forEach((item) => card.append(gsExpItemRow(comp, item)));
    expWrap.append(card);
  });
  wrap.append(expWrap);

  // ---- 05 Evidence ledger ----
  wrap.append(gsSectionHead("05 / The record", "Evidence ledger", "Dalio & McConaughey — keep a record"));
  const ledCard = el("div", { class: "gs-card" });
  ledCard.append(el("div", { class: "gs-muted", style: "margin-bottom:14px" }, "Banked proof the inputs are working — and the case a committee reads. ASSOC marks evidence you're already operating a level up."));
  ledCard.append(gsLedgerBody());
  // add row
  const add = el("div", { class: "gs-addrow" });
  const inp = el("input", { class: "gs-add-input", type: "text", placeholder: "Log a new win as it happens…" });
  const sel = el("select", { class: "gs-add-sel" });
  GS_LEDGER_ORDER.forEach((k) => sel.append(el("option", { value: k }, GS_LEDGER_TAGS[k])));
  const addBtn = el("button", { class: "tool-btn accent-green", onClick: () => {
    const t = inp.value.trim(); if (!t) return;
    GOALS.ledgerAdds.push({ t, tag: sel.value }); saveGoals(); renderGoals();
  }}, "Log it");
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
  add.append(inp, sel, addBtn);
  ledCard.append(add);
  wrap.append(ledCard);

  // ---- 06 Reflect ----
  wrap.append(gsSectionHead("06 / Reflect", "Close the gap", "Dalio · Grant"));
  const refl = el("div", { class: "gs-2col" });
  refl.append(gsReflectCard("Weekly review", "Friday · ~15 min · Pain + Reflection = Progress",
    ["Where did a deliverable slip or a question catch me flat?", "Which input did I miss, and why?", "One thing to do differently next week."], "weekly", "This week's reflection…"));
  refl.append(gsReflectCard("Monthly rethink", "Month-end · is this still the goal?",
    ["Is the diagnosis still true? Has the crux moved?", "Am I gritting on something I should drop? (Grant: grit ≠ stubbornness)", "Persist, pivot, or concede? (McConaughey)"], "monthly", "This month's rethink…"));
  wrap.append(refl);

  // ---- 07 Protect & pivot ----
  wrap.append(gsSectionHead("07 / Protect & pivot", "Survive first, optimize second", "Taleb · McConaughey"));
  const prot = el("div", { class: "gs-protect" });
  GS_PROTECT.forEach((p) => {
    const item = el("div", { class: "gs-prot-item" });
    item.append(el("span", { class: "gs-prot-dn" }, p.dn));
    const txt = el("div", {});
    txt.append(el("div", { class: "gs-prot-t" }, p.t));
    txt.append(el("div", { class: "gs-prot-s" }, p.s));
    item.append(txt);
    prot.append(item);
  });
  wrap.append(prot);

  wrap.append(el("div", { class: "gs-foot" }, "Living kernel — re-run the loop weekly, re-diagnose monthly. Inputs are leading indicators; the scoreboard is lagging."));

  board.append(wrap);
}

function gsSectionHead(eyebrow, title, src) {
  const h = el("div", { class: "gs-sechead" });
  h.append(el("span", { class: "gs-eyebrow" }, eyebrow));
  h.append(el("span", { class: "gs-h2" }, title));
  if (src) h.append(el("span", { class: "gs-src" }, src));
  return h;
}

function gsInputRow(it) {
  const s = GOALS.inputs[it.id] || { done: false, streak: 0, warned: false };
  GOALS.links = GOALS.links || {};
  const linkedId = GOALS.links[it.id];
  const linkedTask = linkedId ? STATE.tasks.find((t) => t.id === linkedId) : null;
  const statusCol = STATE.columns.find((c) => c.type === "status");
  const isDone = linkedTask && statusCol ? linkedTask.cells[statusCol.id] === "Done" : s.done;

  const row = el("div", { class: "gs-inrow" });
  const check = el("div", { class: "gs-check" + (isDone ? " on" : ""), role: "checkbox", tabindex: "0", "aria-checked": String(isDone) });
  const refreshCounter = () => { const n = document.getElementById("gs-week-n"); if (n) n.textContent = `${gsInputsDoneCount()}/${GS_INPUTS.length}`; };
  const toggle = async () => {
    if (linkedTask && statusCol) {
      // Linked: the checkbox is a remote control for the board task's status.
      const nowDone = linkedTask.cells[statusCol.id] === "Done";
      const newVal = nowDone ? "Not Started" : "Done";
      try {
        const res = await api(`/api/tasks/${linkedTask.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: statusCol.id, value: newVal }) });
        if (res && res.cells) { linkedTask.cells = res.cells; if (res.group_name) linkedTask.group_name = res.group_name; }
      } catch (e) {}
      s.done = newVal === "Done";
    } else {
      s.done = !s.done;
    }
    GOALS.inputs[it.id] = s;
    check.classList.toggle("on", s.done); check.setAttribute("aria-checked", String(s.done));
    saveGoals(true); refreshCounter();
  };
  check.addEventListener("click", toggle);
  check.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
  row.append(check);

  const body = el("div", { class: "gs-inbody" });
  const titleRow = el("div", { class: "gs-intitle-row" });
  titleRow.append(el("span", { class: "gs-intitle" }, it.t));
  if (linkedTask) {
    titleRow.append(el("span", { class: "gs-onboard", title: "Tracked as a task on your board — open the List view", onClick: () => setView("table") }, "on board ↗"));
  } else {
    titleRow.append(el("button", { class: "gs-addboard", title: "Create a task for this in your 'Goals — This Week' group", onClick: () => gsSpawn(it) }, "+ board"));
  }
  body.append(titleRow);
  body.append(el("div", { class: "gs-innote" }, it.note));
  const meta = el("div", { class: "gs-inmeta" });
  meta.append(el("span", { class: "gs-cad" }, it.cad));
  meta.append(gsPillarChip(it.pillar));
  if (it.core) meta.append(el("span", { class: "gs-core" }, "core"));
  meta.append(el("span", { class: "gs-streak" }, `streak: ${s.streak} wk`));
  if (s.warned) meta.append(el("span", { class: "gs-miss" }, "1 miss · don't skip twice"));
  body.append(meta);
  row.append(body);
  return row;
}

function gsSetupRow(item) {
  const s = GOALS.setup[item.id] || { done: false };
  const row = el("div", { class: "gs-setrow" + (s.done ? " done" : "") });
  const check = el("div", { class: "gs-check" + (s.done ? " on" : ""), role: "checkbox", tabindex: "0", "aria-checked": String(s.done) });
  const toggle = () => {
    s.done = !s.done; GOALS.setup[item.id] = s; saveGoals();
    check.classList.toggle("on", s.done); check.setAttribute("aria-checked", String(s.done));
    row.classList.toggle("done", s.done);
  };
  check.addEventListener("click", toggle);
  check.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
  row.append(check);
  const body = el("div", { class: "gs-inbody" });
  body.append(el("div", { class: "gs-intitle" }, item.t));
  body.append(el("div", { class: "gs-innote" }, item.note));
  row.append(body);
  return row;
}

function gsLedgerBody() {
  const host = el("div", {});
  let mutated = false;
  (GOALS.ledgerAdds || []).forEach((a) => { if (!a.id) { a.id = mmUid(); mutated = true; } });
  if (mutated) saveGoals(true);
  const rerender = () => { $("#board").innerHTML = ""; renderGoals(); };
  GS_LEDGER_ORDER.forEach((key) => {
    const g = GS_LEDGER[key];
    const grp = el("div", { class: "gs-lgroup" });
    const gh = el("div", { class: "gs-lghead" });
    gh.append(el("span", { class: "gs-lgt" }, g.label));
    gh.append(el("span", { class: "gs-lgc" }, g.caption));
    grp.append(gh);
    g.items.forEach((it) => {
      const d = el("div", { class: "gs-litem" });
      d.append(el("span", { class: "gs-bul" }, "▸"));
      const sp = el("span", {}, it.t);
      if (it.a) sp.append(el("span", { class: "gs-assoc" }, "ASSOC"));
      d.append(sp);
      grp.append(d);
    });
    (GOALS.ledgerAdds || []).filter((a) => a.tag === key).forEach((a) => {
      const d = el("div", { class: "gs-litem gs-litem-add" });
      d.append(el("span", { class: "gs-bul" }, "▸"));
      d.append(el("span", { class: "gs-add-text" }, a.t));
      const sel = el("select", { class: "gs-ledsel", title: "Re-file this win", onChange: (e) => { a.tag = e.target.value; saveGoals(true); rerender(); } });
      GS_LEDGER_ORDER.forEach((k) => { const o = el("option", { value: k }, GS_LEDGER_TAGS[k]); if (k === a.tag) o.selected = true; sel.append(o); });
      d.append(sel);
      d.append(el("span", { class: "gs-x", title: "Remove", onClick: () => { GOALS.ledgerAdds = (GOALS.ledgerAdds || []).filter((x) => x.id !== a.id); saveGoals(true); rerender(); } }, "✕"));
      grp.append(d);
    });
    host.append(grp);
  });
  return host;
}

function gsReflectCard(title, cadence, prompts, field, placeholder) {
  const card = el("div", { class: "gs-card gs-rcard" });
  card.append(el("div", { class: "gs-rtitle" }, title));
  card.append(el("div", { class: "gs-rcad" }, cadence));
  const ul = el("ul", { class: "gs-rlist" });
  prompts.forEach((p) => ul.append(el("li", {}, p)));
  card.append(ul);
  const ta = el("textarea", { class: "gs-rta", placeholder });
  ta.value = GOALS[field] || "";
  ta.addEventListener("input", () => { GOALS[field] = ta.value; saveGoals(); });
  card.append(ta);
  return card;
}

// Pull board reality into the goals state: a linked input mirrors its task's
// done-ness; if the task was deleted, drop the link.
function gsReconcile() {
  GOALS.links = GOALS.links || {};
  const statusCol = STATE.columns.find((c) => c.type === "status");
  let changed = false;
  for (const inId of Object.keys(GOALS.links)) {
    const task = STATE.tasks.find((t) => t.id === GOALS.links[inId]);
    if (!task) { delete GOALS.links[inId]; changed = true; continue; }
    const done = statusCol ? task.cells[statusCol.id] === "Done" : false;
    if (GOALS.inputs[inId] && GOALS.inputs[inId].done !== done) { GOALS.inputs[inId].done = done; changed = true; }
  }
  if (changed) saveGoals(true);
}

// Keep role-expectation done-state in sync with their linked board tasks, and
// drop links to tasks that were deleted.
function gsReconcileExpectations() {
  GOALS.expLinks = GOALS.expLinks || {};
  GOALS.expDone = GOALS.expDone || {};
  const statusCol = STATE.columns.find((c) => c.type === "status");
  let changed = false;
  for (const itemId of Object.keys(GOALS.expLinks)) {
    const task = STATE.tasks.find((t) => t.id === GOALS.expLinks[itemId]);
    if (!task) { delete GOALS.expLinks[itemId]; changed = true; continue; }
    const set = STATE.tasks.filter((t) => t.id === task.id || (task.link_id && t.link_id === task.link_id));
    const done = statusCol ? set.some((t) => t.cells[statusCol.id] === "Done") : false;
    if (GOALS.expDone[itemId] !== done) { GOALS.expDone[itemId] = done; changed = true; }
  }
  if (changed) saveGoals(true);
}

// Date string (YYYY-MM-DD) for the coming Friday — the weekly review anchor.
function gsEndOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// Goals → Board: create a real task for this input in the "Goals — This Week"
// group, due Friday, and remember the link so completion syncs back.
async function gsSpawn(it) {
  const group = "Goals — This Week";
  try {
    const t = await api("/api/tasks", { method: "POST", body: JSON.stringify({ group }) });
    const primary = STATE.columns.find((c) => c.is_primary) || STATE.columns[0];
    if (primary) { await api(`/api/tasks/${t.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: primary.id, value: it.t }) }); t.cells[primary.id] = it.t; }
    const dueCol = STATE.columns.find((c) => c.type === "date");
    if (dueCol) { const due = gsEndOfWeek(); await api(`/api/tasks/${t.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: dueCol.id, value: due }) }); t.cells[dueCol.id] = due; }
    const priCol = STATE.columns.find((c) => c.type === "priority");
    if (priCol) { const pv = it.core ? "High" : "Medium"; await api(`/api/tasks/${t.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: priCol.id, value: pv }) }); t.cells[priCol.id] = pv; }
    STATE.tasks.push(t);
    GOALS.links = GOALS.links || {}; GOALS.links[it.id] = t.id; saveGoals(true);
    try { await api("/api/groups/color", { method: "PATCH", body: JSON.stringify({ name: group, color: "#00859b" }) }); } catch (e) {}
  } catch (e) {}
  $("#board").innerHTML = ""; renderGoals();
}

// ---- Role expectations: assign a bullet to the board as a real task ----
// Mirrors gsSpawn but tracks its own link map (GOALS.expLinks) and done state
// (GOALS.expDone), so completion on the board syncs back to the checkbox.
async function gsSpawnExpectation(comp, item) {
  const group = "Role Expectations";
  try {
    const t = await api("/api/tasks", { method: "POST", body: JSON.stringify({ group }) });
    const primary = STATE.columns.find((c) => c.is_primary) || STATE.columns[0];
    if (primary) { await api(`/api/tasks/${t.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: primary.id, value: item.t }) }); t.cells[primary.id] = item.t; }
    STATE.tasks.push(t);
    GOALS.expLinks = GOALS.expLinks || {};
    GOALS.expLinks[item.id] = t.id;
    // Tie this group to the expectation's pillar so it threads through the Map.
    GOALS.groupPillars = GOALS.groupPillars || {};
    if (!(group in GOALS.groupPillars)) GOALS.groupPillars[group] = comp.pillar;
    saveGoals(true);
    try { await api("/api/groups/color", { method: "PATCH", body: JSON.stringify({ name: group, color: gsP(comp.pillar).color }) }); } catch (e) {}
  } catch (e) {}
  $("#board").innerHTML = ""; renderGoals();
}

function gsExpItemRow(comp, item) {
  GOALS.expLinks = GOALS.expLinks || {};
  GOALS.expDone = GOALS.expDone || {};
  const linkedId = GOALS.expLinks[item.id];
  const linkedTask = linkedId ? STATE.tasks.find((t) => t.id === linkedId) : null;
  const statusCol = STATE.columns.find((c) => c.type === "status");
  // A spawned task may have linked copies (via automations). Treat the whole
  // linked set as one: it's "done" if any copy is Done.
  const linkSet = linkedTask
    ? STATE.tasks.filter((t) => t.id === linkedTask.id || (linkedTask.link_id && t.link_id === linkedTask.link_id))
    : [];
  const anyDone = linkSet.length && statusCol ? linkSet.some((t) => t.cells[statusCol.id] === "Done") : false;
  const isDone = linkedTask ? anyDone : !!GOALS.expDone[item.id];

  const row = el("div", { class: "gs-exprow" });
  const check = el("div", { class: "gs-check" + (isDone ? " on" : ""), role: "checkbox", tabindex: "0", "aria-checked": String(isDone) });
  const toggle = async () => {
    if (linkedTask && statusCol) {
      const nowDone = linkedTask.cells[statusCol.id] === "Done";
      const newVal = nowDone ? "Not Started" : "Done";
      try {
        const res = await api(`/api/tasks/${linkedTask.id}/cell`, { method: "PATCH", body: JSON.stringify({ col: statusCol.id, value: newVal }) });
        if (res && res.cells) { linkedTask.cells = res.cells; if (res.group_name) linkedTask.group_name = res.group_name; }
      } catch (e) {}
      GOALS.expDone[item.id] = newVal === "Done";
    } else {
      GOALS.expDone[item.id] = !GOALS.expDone[item.id];
    }
    check.classList.toggle("on", GOALS.expDone[item.id]);
    check.setAttribute("aria-checked", String(GOALS.expDone[item.id]));
    saveGoals(true);
  };
  check.addEventListener("click", toggle);
  check.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
  row.append(check);

  const body = el("div", { class: "gs-inbody" });
  const titleRow = el("div", { class: "gs-intitle-row" });
  titleRow.append(el("span", { class: "gs-exptext" }, item.t));
  if (linkedTask) {
    titleRow.append(el("span", { class: "gs-onboard", title: "Tracked as a task on your board — open the List view", onClick: () => setView("table") }, "on board ↗"));
  } else {
    titleRow.append(el("button", { class: "gs-addboard", title: "Create a task for this in your 'Role Expectations' group", onClick: () => gsSpawnExpectation(comp, item) }, "+ board"));
  }
  body.append(titleRow);
  row.append(body);
  return row;
}

function gsCloseWeek() {
  GS_INPUTS.forEach((it) => {
    const s = GOALS.inputs[it.id];
    if (s.done) { s.streak++; s.warned = false; }
    else if (s.warned) { s.streak = 0; s.warned = false; }   // missed twice → reset
    else { s.warned = true; }                                  // first miss → streak held, flagged
    s.done = false;
  });
  GOALS.links = {};   // this week's spawned tasks stay on the board; start fresh links
  saveGoals(true);
  $("#board").innerHTML = "";
  renderGoals();
}

/* ===========================================================
   Map — a mind map of tasks & ideas and how they feed goals.
   Objective at the root; pillars branch off; under each pillar:
   inputs, board groups (expand to tasks), and free-form ideas.
   Group→pillar assignments and ideas persist in goals_os.
   Dependency-free SVG (foreignObject nodes + bezier edges).
   =========================================================== */

const MM_COLW = 250;   // horizontal spacing between depth levels
const MM_NODEW = 216;  // node width
const MM_NODEH = 56;   // node height (also the layout slot height)
const MM_GAPY = 12;    // vertical gap between stacked leaves (horizontal layout)
const MM_GAPX = 18;    // horizontal gap between stacked leaves (vertical layout)
const MM_ROWV = 122;   // level spacing in vertical layout
const MM_PAD = 30;     // canvas padding
const MM_SVGNS = "http://www.w3.org/2000/svg";
// Pillar dropdown options are built dynamically from the live pillar list.

let mmScale = 1;
const mmCollapsed = new Set();
const mmSeen = new Set();

// Retained from the removed Mind Map: ids for new goals are minted here.
function mmUid() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Task nodes for tasks directly tagged (via the Goal column) to a given tag —
// "pillar:<k>" or "idea:<id>". Deduped by name so linked copies show once.
// Project nodes for Vibe projects tagged to a given pillar/idea tag.

// Build a (possibly nested) idea node. Children are ideas whose parent === id;
// the whole sub-tree inherits the top-level pillar's color via effPillar.

/* Map helpers: name→pillar suggestion and promoting a done task to the ledger. */
