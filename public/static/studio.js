/* Radio Station — studio.js
   Studio — prompt generators, Prompt Studio library, Vibe cards, Rewards view
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ---- Prompt generators (deterministic; three flavors) ----
function planField(plan, key) { return (plan.fields[key] || "").trim(); }
function planBriefBody(plan, title) {
  const L = [];
  const add = (head, key) => { const v = planField(plan, key); if (v) L.push(`## ${head}\n${v}`); };
  if (title) L.push(`# Project: ${title}`);
  add("Objective (what & why)", "objective");
  add("Context", "context");
  add("Constraints", "constraints");
  add("Format / deliverable", "format");
  add("Definition of done", "done");
  add("Suggested approach / outline", "approach");
  add("Reference — what good looks like", "reference");
  return L.join("\n\n");
}
function genPromptChat(plan, title) {
  const missing = PLAN_SECTIONS.filter((s) => s.core && !planField(plan, s.key)).map((s) => s.label.split(" — ")[0]);
  const pre = "You are my expert pair on this project. Read the full brief below before responding.\n\n"
    + "First, do NOT build yet. Give me: (1) a short outline of how you'd approach it, (2) any assumptions you'll make if I don't specify, and (3) the single weakest part of this brief. Once I confirm, produce the deliverable to the Definition of done.\n";
  let out = pre + "\n" + planBriefBody(plan, title);
  if (missing.length) out += `\n\n## Note\nThe brief is light on: ${missing.join(", ")}. Ask me to fill these before building if they'd change the result.`;
  return out;
}
function genPromptCode(plan, title) {
  const pre = "You are working in Claude Code on my machine. This is a build task — read the brief, then before writing code, confirm the file/stack plan and flag anything ambiguous.\n\n"
    + "Operating rules: complete, runnable code (no placeholders); single-file unless I say otherwise; match the conventions of any file you edit; state what you checked before claiming it works.\n";
  let out = pre + "\n" + planBriefBody(plan, title);
  out += "\n\n## Build protocol\n- Propose the file layout + stack and wait for my OK if it's a one-way door.\n- Then implement to the Definition of done and tell me exactly how you verified it.";
  return out;
}
function genPromptQuestions(plan, title) {
  return "Before we build, I want to pressure-test this brief. Here it is:\n\n"
    + planBriefBody(plan, title)
    + "\n\n## Ask me\nReply with ONLY: (1) what you need from me to do this in one pass, (2) the assumptions you'd make if I don't specify, (3) the trade-offs in how we could structure it, and (4) the weakest part of this request. Don't build anything yet.";
}
function planPrompts(plan, title) {
  return { chat: genPromptChat(plan, title), code: genPromptCode(plan, title), questions: genPromptQuestions(plan, title) };
}
// Auto-description from the plan: first sentence of the objective (trimmed).
function planAutoDescription(plan) {
  const obj = planField(plan, "objective");
  if (!obj) return "";
  const firstSentence = obj.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length > 160 ? firstSentence.slice(0, 157) + "…" : firstSentence;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The plan template modal. proj === null → creating a new project.
function openProjectPlan(proj) {
  const creating = !proj;
  const plan = creating ? { fields: {}, checklist: [], prompts: {} } : planOf(proj);
  openModal(creating ? "Plan a new project" : "Plan · " + (proj && proj.title), (body, close) => {
    body.classList.add("plan-modal");
    // Autosave: persist typing so clicking out never loses work. For a new
    // project we lazily create a real (draft) project on the first keystroke,
    // then keep PATCHing it; the modal switches to editing that draft.
    let draft = proj;            // becomes the created project once it exists
    let saveTimer = null, dirty = false;
    const saveIndicator = el("span", { class: "plan-saved" }, "");
    async function persistNow() {
      if (!dirty) return;
      dirty = false;
      const planStr = JSON.stringify(plan);
      const autoDesc = planAutoDescription(plan);
      try {
        if (!draft) {
          draft = await api("/api/projects", { method: "POST", body: JSON.stringify({ title: titleVal || "New project" }) });
          STATE.projects = STATE.projects || [];
          STATE.projects.push(draft);
        }
        const patch = { plan: planStr, title: titleVal || draft.title };
        if (autoDesc && !(draft.description || "").trim()) patch.description = autoDesc;
        await api(`/api/projects/${draft.id}`, { method: "PATCH", body: JSON.stringify(patch) });
        draft.plan = planStr; if (patch.title) draft.title = patch.title;
        if (patch.description) draft.description = patch.description;
        saveIndicator.textContent = "✓ saved";
      } catch (e) { saveIndicator.textContent = ""; }
    }
    function scheduleSave() {
      dirty = true;
      saveIndicator.textContent = "saving…";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 700);
    }

    // Title (new projects only — existing edit title on the card)
    let titleVal = creating ? "" : proj.title;
    if (creating) {
      const tIn = el("input", { class: "field plan-title", placeholder: "Project name", style: "width:100%;font-weight:700;margin-bottom:6px" });
      tIn.addEventListener("input", () => { titleVal = tIn.value; scheduleSave(); });
      body.append(tIn);
    }
    const introRow = el("div", { style: "display:flex;align-items:baseline;justify-content:space-between;gap:10px" });
    introRow.append(el("p", { class: "muted", style: "margin:0 0 12px;font-size:12.5px" },
      "A good brief answers five things before Claude has to ask. Fill what you can — empty core sections are flagged, not blocked. Your typing autosaves."));
    introRow.append(saveIndicator);
    body.append(introRow);

    const meter = el("div", { class: "plan-meter" });
    body.append(meter);
    const fieldEls = {};
    function refreshMeter() {
      const n = planCoreCount(plan);
      meter.innerHTML = "";
      meter.append(el("span", { class: "plan-meter-lab" }, `Core elements: ${n}/${planCoreTotal()}`));
      const bar = el("div", { class: "plan-meter-bar" });
      bar.append(el("div", { class: "plan-meter-fill", style: `width:${(n / planCoreTotal()) * 100}%` }));
      meter.append(bar);
    }

    PLAN_SECTIONS.forEach((s) => {
      const sec = el("div", { class: "plan-sec" });
      const head = el("div", { class: "plan-sec-head" });
      head.append(el("span", { class: "plan-sec-label" }, s.label));
      const flag = el("span", { class: "plan-flag" }, "needs input");
      if (s.core) head.append(flag);
      sec.append(head);
      sec.append(el("div", { class: "plan-guide" }, s.guide));
      const ta = el("textarea", { class: "field plan-ta", placeholder: s.ph, rows: "3" });
      ta.value = plan.fields[s.key] || "";
      const syncFlag = () => { flag.style.display = (s.core && !ta.value.trim()) ? "inline" : "none"; };
      syncFlag();
      ta.addEventListener("input", () => { plan.fields[s.key] = ta.value; syncFlag(); refreshMeter(); scheduleSave(); });
      fieldEls[s.key] = ta;
      sec.append(ta);
      body.append(sec);
    });
    refreshMeter();

    // Pre-flight checklist
    const chk = el("div", { class: "plan-checklist" });
    chk.append(el("div", { class: "plan-sec-label", style: "margin-bottom:6px" }, "Pre-flight checklist"));
    PLAN_CHECKLIST.forEach((c, i) => {
      const row = el("label", { class: "plan-chk-row" });
      const cb = el("input", { type: "checkbox" });
      cb.checked = (plan.checklist || []).includes(i);
      cb.addEventListener("change", () => {
        plan.checklist = plan.checklist || [];
        if (cb.checked) { if (!plan.checklist.includes(i)) plan.checklist.push(i); }
        else plan.checklist = plan.checklist.filter((x) => x !== i);
        scheduleSave();
      });
      row.append(cb); row.append(el("span", {}, c));
      chk.append(row);
    });
    body.append(chk);

    // Generated prompts panel
    const promptWrap = el("div", { class: "plan-prompts" });
    body.append(promptWrap);
    function buildPrompts() {
      const title = (draft && draft.title) || titleVal || (proj && proj.title) || "Untitled project";
      const prompts = planPrompts(plan, title);
      promptWrap.innerHTML = "";
      promptWrap.append(el("div", { class: "plan-sec-label", style: "margin-bottom:6px" }, "Generated prompt"));
      const tabs = el("div", { class: "plan-ptabs" });
      const out = el("textarea", { class: "field plan-pout", rows: "10", readonly: "true" });
      const flavors = [["chat", "Claude chat"], ["code", "Claude Code"], ["questions", "Clarifying questions"]];
      let active = "chat";
      const showFlavor = (f) => { active = f; out.value = prompts[f]; tabs.querySelectorAll(".plan-ptab").forEach((b) => b.classList.toggle("on", b.dataset.f === f)); };
      flavors.forEach(([f, lab]) => {
        const b = el("button", { class: "plan-ptab", "data-f": f, onClick: () => showFlavor(f) }, lab);
        tabs.append(b);
      });
      promptWrap.append(tabs);
      promptWrap.append(out);
      const acts = el("div", { class: "plan-pacts" });
      acts.append(el("button", { class: "tool-btn", onClick: () => { navigator.clipboard && navigator.clipboard.writeText(out.value); showTimerToast("Prompt copied."); } }, "Copy"));
      acts.append(el("button", { class: "tool-btn", onClick: () => { const t = (draft && draft.title) || titleVal || "project"; downloadText(`${t.replace(/[^a-z0-9]+/gi, "_")}_${active}_prompt.md`, out.value); } }, "Download .md"));
      promptWrap.append(acts);
      showFlavor(active);
      plan.prompts = prompts;  // persist alongside the plan
    }
    const genBtn = el("button", { class: "tool-btn", style: "margin:6px 0", onClick: () => { buildPrompts(); scheduleSave(); } }, "Generate prompt");
    body.append(genBtn);
    if (plan.prompts && plan.prompts.chat) buildPrompts();

    // Save / create — autosave has already persisted; this flushes any pending
    // keystroke and closes.
    const footer = el("div", { class: "plan-footer" });
    const saveBtn = el("button", { class: "tool-btn accent-teal", onClick: async () => {
      buildPrompts();
      dirty = true;
      if (saveTimer) clearTimeout(saveTimer);
      await persistNow();
      close(); render();
      showTimerToast(creating ? "Project created from your plan." : "Plan saved.");
    } }, creating ? "Create project" : "Save plan");
    footer.append(saveBtn);
    body.append(footer);
    if (creating) setTimeout(() => { const ti = body.querySelector(".plan-title"); if (ti) ti.focus(); }, 30);
  });
}

async function vibePatch(proj, field, value) {
  proj[field] = value;
  await api(`/api/projects/${proj.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
}
// True if the project currently has a live to-do task on the board.
function vibeOnTodo(proj) {
  return !!(proj.task_id && (STATE.tasks || []).some((t) => t.id === proj.task_id));
}
async function vibeToggleTodo(proj) {
  await api(`/api/projects/${proj.id}/todo`, { method: "POST" });
  await loadState();   // refresh tasks + the project's task_id
  render();
}

async function vibeDelete(proj) {
  if (!confirm(`Delete project “${proj.title}”? This can't be undone.`)) return;
  await api(`/api/projects/${proj.id}`, { method: "DELETE" });
  STATE.projects = (STATE.projects || []).filter((p) => p.id !== proj.id);
  render();
}

// ================= PROMPT STUDIO =================
// A saved prompt library. Each category inherits a shared brief (objective/
// context/constraints/format/done) and adds 1-3 category-specific fields. Two
// deterministic flavors are generated: Execute and Clarify-first.
// A saved prompt library. Each category is a real framework: ordered sections,
// per-field guidance, required/optional flags, and a per-type output shape that
// is injected into the generated Execute prompt. Field KEYS are stable so
// previously-saved prompts keep mapping.
const PS_SHARED = [
  { key: "objective", label: "Objective — what & why", req: true, ph: "What you want, and the decision/outcome it serves.", help: "One or two sentences. Name the deliverable and the decision it feeds." },
  { key: "context", label: "Context — what Claude needs", req: false, ph: "Background, audience, the actual data/material (paste it).", help: "Paste the real material. Missing context is the #1 cause of a generic answer." },
  { key: "constraints", label: "Constraints — rules & limits", req: false, ph: "Conventions, length, what to exclude, tools/sources to use or avoid.", help: "Hard limits only — house style, length, sources to use/avoid." },
  { key: "format", label: "Format — shape of the output", req: false, ph: "The artifact and its structure (memo, table, email, list…).", help: "Name the artifact. The per-type output shape below fills the rest." },
  { key: "done", label: "Definition of done", req: true, ph: "What a finished, approvable version looks like.", help: "The bar for 'I'd send this.' Make it checkable." },
];
const PS_CATEGORIES = [
  { key: "finmodel", label: "Financial modeling & analysis", icon: "", color: "#00859b",
    output: "A working model or section: assumptions stated up front, formulas (not hard-codes), ties-out shown, units consistent, and a one-line base/upside/downside read.",
    specific: [
      { key: "drivers", label: "Key drivers / assumptions", req: true, ph: "The inputs that move the answer (volumes, rates, escalators, WACC…).", help: "List the handful of inputs the answer is most sensitive to." },
      { key: "sensitivities", label: "Sensitivities / scenarios", req: false, ph: "What to flex and the ranges (base/upside/downside).", help: "Name what to flex and the band for each case." },
      { key: "checks", label: "Sanity checks", req: false, ph: "Ties-out, ranges, units the model must respect.", help: "The checks a reviewer would run — so the model self-proves." },
    ] },
  { key: "deck", label: "Deck & memo drafting", icon: "", color: "#38a66f",
    output: "A structured draft: each section leads with its 'so what,' claims are backed, and the ask/recommendation lands at the end.",
    specific: [
      { key: "audience", label: "Audience & decision", req: true, ph: "Who reads it and what they must decide / approve.", help: "The reader and the single decision the document drives." },
      { key: "soswhat", label: "The 'so what'", req: true, ph: "The single takeaway each section must land.", help: "If they remember one line per section, what is it?" },
      { key: "structure", label: "Section order", req: false, ph: "Your preferred flow / template, if any.", help: "Leave blank to let the draft propose a structure." },
    ] },
  { key: "email", label: "Email & stakeholder comms", icon: "", color: "#00bfb8",
    output: "A send-ready message: subject line, the ask in the first two lines, right tone for the relationship, and a clear next step.",
    specific: [
      { key: "recipient", label: "Recipient & relationship", req: true, ph: "Who, and your standing with them (manager, commercial, exec…).", help: "Their seniority and your standing set the register." },
      { key: "ask", label: "The ask", req: true, ph: "The one action you need from them.", help: "Exactly one action. Two asks halve the reply rate." },
      { key: "tone", label: "Tone", req: false, ph: "Direct, warm, formal, apologetic, firm…", help: "One or two words; the draft calibrates." },
    ] },
  { key: "data", label: "Data & spreadsheet work", icon: "", color: "#77b28c",
    output: "A correct transformation: the operation applied, edge cases handled, and the result plus the exact steps/formulas to reproduce it.",
    specific: [
      { key: "shape", label: "Data shape", req: true, ph: "Columns, types, size, source (API pull, CSV export…).", help: "Columns, types, rough row count, and where it came from." },
      { key: "operation", label: "Operation", req: true, ph: "Clean / pivot / formula / chart — what transformation.", help: "The transformation, in plain terms, end to end." },
    ] },
  { key: "research", label: "Research & synthesis", icon: "", color: "#c0782a",
    output: "A grounded synthesis: each claim sourced, conflicts flagged, recency noted, and a short bottom-line answer to each question.",
    specific: [
      { key: "questions", label: "Questions to answer", req: true, ph: "The specific things you need to know.", help: "Concrete questions beat a vague topic." },
      { key: "sources", label: "Sources / scope", req: false, ph: "Where to look or avoid; recency; geography.", help: "Steer or fence the search; note how fresh it must be." },
      { key: "output", label: "Synthesis form", req: false, ph: "Bullets, table, brief, pros/cons…", help: "How you want it digested." },
    ] },
  { key: "learn", label: "Learning & explainers", icon: "", color: "#8e7cc3",
    output: "An explanation pitched to your level: builds from what you know, one worked example, and a check-for-understanding at the end.",
    specific: [
      { key: "level", label: "Your current level", req: true, ph: "What you already know — so it starts at the right place.", help: "Where to start so it neither bores nor loses you." },
      { key: "depth", label: "Depth & analogy", req: false, ph: "ELI5, working-level, or deep; analogies you like.", help: "How deep, and any analogy styles that click for you." },
    ] },
  { key: "writing", label: "Writing & editing", icon: "", color: "#5d7479",
    output: "A revised text that meets the editing goal, plus a short note on the substantive changes — not a silent rewrite.",
    specific: [
      { key: "text", label: "The text", req: true, ph: "Paste what to edit (or describe what to write).", help: "Paste the actual text — editing beats describing." },
      { key: "goal", label: "Editing goal", req: true, ph: "Tighten, restructure, fix tone, behavioral framing…", help: "What 'better' means here." },
    ] },
  { key: "career", label: "Career & professional development", icon: "", color: "#38a66f",
    output: "A concrete plan or script tied to the goal: specific moves, the words to use, and how you'll know it worked.",
    specific: [
      { key: "pillar", label: "Pillar / goal", req: true, ph: "Which value or goal this advances.", help: "Ties the ask to a goal you're tracking." },
      { key: "situation", label: "Situation", req: false, ph: "The review, conversation, or positioning at hand.", help: "The specific moment this is for." },
    ] },
  { key: "decision", label: "Decision & critique", icon: "", color: "#00859b",
    output: "A critique in the mode you chose: the strongest case against, the failure modes, and a clear bottom line — not reflexive agreement.",
    specific: [
      { key: "decision", label: "Decision / claim", req: true, ph: "What you're deciding or the argument to test.", help: "State the call or claim in one line." },
      { key: "options", label: "Options / reasoning", req: false, ph: "The paths you see and your current lean + why.", help: "Your current lean — so the critique can push on it." },
      { key: "mode", label: "Critique mode", req: false, ph: "Steelman, red-team, devil's advocate, blind spots…", help: "How you want it pressure-tested." },
    ] },
  { key: "improve", label: "Project improvements", icon: "", color: "#00859b",
    forProjects: true,
    output: "A minimal-diff change set: it fixes the named problem, preserves working state, leaves untouched what wasn't mentioned, and states any assumption inline.",
    specific: [
      { key: "project", label: "Which project", req: true, ph: "Pick one of your Vibe Coding projects.", help: "Its title, stage, description, plan, and tags are pulled in live at generate time." },
      { key: "problem", label: "What's not working / the improvement", req: true, ph: "The specific gap, bug, or upgrade you want.", help: "Be concrete — the symptom or the missing capability." },
      { key: "keep", label: "What's working — don't break it", req: false, ph: "The parts that must stay intact.", help: "Names the working state to preserve." },
      { key: "scope", label: "Scope signal", req: true, ph: "Minimal diff, or open exploration?", help: "'Minimal diff' vs 'open to refactor' changes how much gets touched." },
    ] },
];
// Priority levels shared by projects and saved prompts.
const PS_PRIORITIES = [
  { key: "high", label: "High", color: "#c0392b", rank: 0 },
  { key: "med",  label: "Med",  color: "#c0782a", rank: 1 },
  { key: "low",  label: "Low",  color: "#77b28c", rank: 2 },
];
function psPrio(key) { return PS_PRIORITIES.find((p) => p.key === key) || null; }
function psPrioRank(key) { const p = psPrio(key); return p ? p.rank : 99; }

function psCat(key) { return PS_CATEGORIES.find((c) => c.key === key) || PS_CATEGORIES[0]; }
function psFieldsFor(catKey) {
  const c = psCat(catKey);
  return PS_SHARED.concat(c.specific);
}
function psPromptOf(p) {
  let f = p.fields;
  if (typeof f === "string") { try { f = JSON.parse(f); } catch (e) { f = {}; } }
  return f || {};
}
function psReqFields(catKey) { return psFieldsFor(catKey).filter((s) => s.req); }
function psReqDone(catKey, fields) { return psReqFields(catKey).filter((s) => psFieldValue(catKey, s.key, fields).trim()); }
// The 'project' field stores an id; render its title for human-readable output.
function psFieldValue(catKey, key, fields) {
  if (catKey === "improve" && key === "project") {
    const pr = (STATE.projects || []).find((x) => x.id === fields.project);
    return pr ? pr.title : "";
  }
  return String(fields[key] || "");
}

// Live project context block for the Project Improvements type.
function psProjectContext(fields) {
  const pr = (STATE.projects || []).find((x) => x.id === fields.project);
  if (!pr) return "";
  const L = [`**${pr.title}** — stage: ${vibeStage(pr.stage).label}`];
  if (pr.description) L.push(`Description: ${pr.description}`);
  const tags = parseGoalTags(pr.tags).map((t) => goalTagLabel(t)).filter(Boolean);
  if (tags.length) L.push(`Advances: ${tags.join(", ")}`);
  let plan = pr.plan;
  if (typeof plan === "string") { try { plan = JSON.parse(plan); } catch (e) { plan = null; } }
  if (plan && typeof plan === "object") {
    Object.keys(plan).forEach((k) => { const v = String(plan[k] || "").trim(); if (v) L.push(`${k}: ${v}`); });
  }
  return L.join("\n");
}

// ---- Deterministic generators: Execute + Clarify-first ----
function psBriefBody(cat, fields) {
  const L = [];
  if (cat.key === "improve") {
    const ctx = psProjectContext(fields);
    if (ctx) L.push(`## Project (live context)\n${ctx}`);
  }
  const add = (head, key) => {
    if (cat.key === "improve" && key === "project") return; // shown in the context block above
    const v = psFieldValue(cat.key, key, fields).trim();
    if (v) L.push(`## ${head}\n${v}`);
  };
  PS_SHARED.forEach((s) => add(s.label.split(" — ")[0], s.key));
  cat.specific.forEach((s) => add(s.label, s.key));
  return L.join("\n\n");
}
function psGenExecute(cat, fields, title) {
  const head = `You are my expert collaborator on a ${cat.label.toLowerCase()} task.`;
  const body = psBriefBody(cat, fields);
  const shape = cat.output ? `\n\n## Deliverable shape\n${cat.output}` : "";
  return `${head}\n\nProduce the deliverable described below, matching the Definition of done. If a critical detail is missing, make the most reasonable assumption and state it at the top rather than stalling.\n\n${body || "(brief not yet filled in)"}${shape}`;
}
function psGenClarify(cat, fields, title) {
  const body = psBriefBody(cat, fields);
  const shape = cat.output ? `\n\n## Intended deliverable shape\n${cat.output}` : "";
  return `You are my expert collaborator on a ${cat.label.toLowerCase()} task. Before producing anything, pressure-test the brief.\n\n${body || "(brief not yet filled in)"}${shape}\n\n## Reply with ONLY\n1) What you need from me to do this in one pass\n2) The assumptions you'd make if I don't specify\n3) The trade-offs in how we could approach it\n4) The weakest part of this brief\nDon't produce the deliverable yet.`;
}
function psPrompts(catKey, fields, title) {
  const cat = psCat(catKey);
  return { execute: psGenExecute(cat, fields, title), clarify: psGenClarify(cat, fields, title) };
}
function psCoreCount(fields) {
  return PS_SHARED.filter((s) => (fields[s.key] || "").trim()).length;
}

async function psAddPrompt(catKey) {
  openPromptEditor(null, catKey);
}
async function psDeletePrompt(p) {
  if (!confirm(`Delete saved prompt “${p.title}”?`)) return;
  await api(`/api/prompts/${p.id}`, { method: "DELETE" });
  STATE.prompts = (STATE.prompts || []).filter((x) => x.id !== p.id);
  render();
}

// Editor modal with autosave (lazy-creates the saved prompt on first keystroke).
function openPromptEditor(p, presetCat) {
  const creating = !p;
  const fields = creating ? {} : Object.assign({}, psPromptOf(p));
  let catKey = creating ? (presetCat || PS_CATEGORIES[0].key) : p.category;
  let titleVal = creating ? "" : p.title;
  let prioVal = creating ? "" : (p.priority || "");
  const ed = {};

  openModal(creating ? "New prompt" : "Edit · " + p.title, (body, close) => {
    body.classList.add("plan-modal");
    let draft = p;
    let saveTimer = null, dirty = false;
    const saveIndicator = el("span", { class: "plan-saved" }, "");

    async function persistNow() {
      if (!dirty) return;
      dirty = false;
      const payload = { title: titleVal || "Untitled prompt", category: catKey, fields, priority: prioVal };
      try {
        if (!draft) {
          draft = await api("/api/prompts", { method: "POST", body: JSON.stringify(payload) });
          STATE.prompts = STATE.prompts || [];
          STATE.prompts.push(draft);
        } else {
          await api(`/api/prompts/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
          Object.assign(draft, payload);
        }
        saveIndicator.textContent = "✓ saved";
      } catch (e) { saveIndicator.textContent = ""; }
    }
    function scheduleSave() {
      dirty = true; saveIndicator.textContent = "saving…";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 700);
    }
    // Flush any pending edit on ANY close path (×, click-out, Esc).
    ed.flush = () => { if (saveTimer) clearTimeout(saveTimer); return persistNow(); };

    // Title + autosave indicator
    const titleRow = el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" });
    const tIn = el("input", { class: "field plan-title", placeholder: "Name this prompt (e.g. 'Monthly variance memo')", style: "flex:1;font-weight:700" });
    tIn.value = titleVal;
    tIn.addEventListener("input", () => { titleVal = tIn.value; scheduleSave(); });
    titleRow.append(tIn); titleRow.append(saveIndicator);
    body.append(titleRow);

    // Category picker
    const catWrap = el("div", { class: "ps-catpick" });
    function paintCats() {
      catWrap.innerHTML = "";
      PS_CATEGORIES.forEach((c) => {
        const chip = el("span", { class: "ps-catchip" + (c.key === catKey ? " on" : ""), style: c.key === catKey ? `background:${c.color};border-color:${c.color};color:#fff` : "", onClick: () => { catKey = c.key; paintCats(); paintFields(); buildPrompts(); scheduleSave(); } }, `${c.icon} ${c.label}`);
        catWrap.append(chip);
      });
    }
    body.append(el("div", { class: "plan-sec-label", style: "margin-bottom:6px" }, "Category"));
    body.append(catWrap);
    paintCats();

    // Priority
    const prioRow = el("div", { class: "ps-priorow" });
    function paintPrio() {
      prioRow.innerHTML = "";
      prioRow.append(el("span", { class: "plan-sec-label" }, "Priority"));
      PS_PRIORITIES.forEach((pr) => {
        prioRow.append(el("span", { class: "ps-priochip" + (prioVal === pr.key ? " on" : ""), style: prioVal === pr.key ? `background:${pr.color};border-color:${pr.color};color:#fff` : `--c:${pr.color}`, onClick: () => { prioVal = (prioVal === pr.key ? "" : pr.key); paintPrio(); scheduleSave(); } }, pr.label));
      });
    }
    body.append(prioRow); paintPrio();

    // Fields (shared + category-specific), repainted when category changes
    let meterEl = null;
    function updateMeter() {
      if (!meterEl) return;
      const t = psReqFields(catKey).length, d = psReqDone(catKey, fields).length;
      meterEl.textContent = `Required ${d}/${t} filled`;
      meterEl.classList.toggle("ok", d === t);
    }
    const fieldHost = el("div", {});
    body.append(fieldHost);
    function paintFields() {
      fieldHost.innerHTML = "";
      const cat = psCat(catKey);
      meterEl = el("div", { class: "ps-reqmeter" });
      fieldHost.append(meterEl);
      const mk = (s, specific) => {
        const sec = el("div", { class: "plan-sec" });
        const headRow = el("div", { class: "plan-sec-head" });
        const lab = el("span", { class: "plan-sec-label" }, s.label);
        if (s.req) lab.append(el("span", { class: "ps-req", title: "Required" }, " *"));
        headRow.append(lab);
        if (specific) headRow.append(el("span", { class: "ps-spec-tag", style: `background:${cat.color}` }, cat.label.split(" ")[0]));
        sec.append(headRow);
        if (cat.key === "improve" && s.key === "project") {
          const sel = el("select", { class: "field plan-ta", style: "min-height:auto;height:38px" });
          sel.append(el("option", { value: "" }, "— pick a project —"));
          (STATE.projects || []).slice().sort((a, b) => a.title.localeCompare(b.title)).forEach((pr) => {
            sel.append(el("option", Object.assign({ value: pr.id }, fields.project === pr.id ? { selected: "selected" } : {}), `${pr.title} · ${vibeStage(pr.stage).label}`));
          });
          sel.addEventListener("change", () => { fields.project = sel.value; buildPrompts(); updateMeter(); scheduleSave(); });
          sec.append(sel);
        } else {
          const ta = el("textarea", { class: "field plan-ta", placeholder: s.ph, rows: specific ? "2" : "3" });
          ta.value = fields[s.key] || "";
          ta.addEventListener("input", () => { fields[s.key] = ta.value; buildPrompts(); updateMeter(); scheduleSave(); });
          sec.append(ta);
        }
        if (s.help) sec.append(el("div", { class: "ps-help" }, s.help));
        fieldHost.append(sec);
      };
      fieldHost.append(el("div", { class: "ps-group-label" }, "Shared brief"));
      PS_SHARED.forEach((s) => mk(s, false));
      fieldHost.append(el("div", { class: "ps-group-label" }, `${cat.icon} ${cat.label} — specifics`));
      cat.specific.forEach((s) => mk(s, true));
      updateMeter();
    }
    paintFields();

    // Generated prompts (Execute + Clarify-first)
    const promptWrap = el("div", { class: "plan-prompts" });
    body.append(promptWrap);
    function buildPrompts() {
      const prompts = psPrompts(catKey, fields, titleVal);
      promptWrap.innerHTML = "";
      promptWrap.append(el("div", { class: "plan-sec-label", style: "margin:6px 0" }, "Generated prompt"));
      const tabs = el("div", { class: "plan-ptabs" });
      const out = el("textarea", { class: "field plan-pout", rows: "9", readonly: "true" });
      let active = "execute";
      const flavors = [["execute", "Execute"], ["clarify", "Clarify-first"]];
      const show = (f) => { active = f; out.value = prompts[f]; tabs.querySelectorAll(".plan-ptab").forEach((b) => b.classList.toggle("on", b.dataset.f === f)); };
      flavors.forEach(([f, lab]) => tabs.append(el("button", { class: "plan-ptab", "data-f": f, onClick: () => show(f) }, lab)));
      promptWrap.append(tabs); promptWrap.append(out);
      const acts = el("div", { class: "plan-pacts" });
      acts.append(el("button", { class: "tool-btn", onClick: () => { navigator.clipboard && navigator.clipboard.writeText(out.value); showTimerToast("Prompt copied."); } }, "Copy"));
      acts.append(el("button", { class: "tool-btn", onClick: () => { const t = (titleVal || psCat(catKey).label); downloadText(`${t.replace(/[^a-z0-9]+/gi, "_")}_${active}.md`, out.value); } }, "Download .md"));
      promptWrap.append(acts);
      show(active);
    }
    buildPrompts();

    const footer = el("div", { class: "plan-footer" });
    footer.append(el("button", { class: "tool-btn accent-teal", onClick: async () => {
      dirty = true; if (saveTimer) clearTimeout(saveTimer); await persistNow();
      close(); render(); showTimerToast(creating ? "Prompt saved to your library." : "Prompt updated.");
    } }, creating ? "Save to library" : "Save"));
    body.append(footer);
    setTimeout(() => tIn.focus(), 30);
  }, { onClose: () => { ed.flush && ed.flush(); render(); } });
}

async function psSetPriority(p, key) {
  p.priority = key;
  try { await api(`/api/prompts/${p.id}`, { method: "PATCH", body: JSON.stringify({ priority: key }) }); } catch (e) {}
  render();
}
function psCyclePriority(p) {
  const order = ["", "high", "med", "low"];
  const next = order[(order.indexOf(p.priority || "") + 1) % order.length];
  psSetPriority(p, next);
}
function psSortItems(items) {
  const byRecent = (a, b) => String(b.updated || b.created || "").localeCompare(String(a.updated || a.created || ""));
  if (psSort === "prio") return items.slice().sort((a, b) => psPrioRank(a.priority) - psPrioRank(b.priority) || byRecent(a, b));
  if (psSort === "recent") return items.slice().sort(byRecent);
  return items.slice();
}
function psSegBar(segs) {
  const seg = el("div", { class: "ps-seg" });
  segs.forEach(([val, lab, cur, set]) => seg.append(el("button", { class: cur === val ? "on" : "", onClick: () => set(val) }, lab)));
  return seg;
}
function psPromptCard(p) {
  const f = psPromptOf(p);
  const cat = psCat(p.category);
  const cardEl = el("div", { class: "ps-card", onClick: () => openPromptEditor(p) });
  const top = el("div", { class: "ps-card-top" });
  top.append(el("div", { class: "ps-card-title" }, p.title || "Untitled prompt"));
  const pr = psPrio(p.priority);
  top.append(el("span", { class: "ps-card-prio", style: pr ? `--c:${pr.color};background:${pr.color};color:#fff;border-color:${pr.color}` : "--c:#cdd6cf", title: "Click to set priority", onClick: (e) => { e.stopPropagation(); psCyclePriority(p); } }, pr ? pr.label : "— prio"));
  top.append(el("span", { class: "ps-card-del", title: "Delete", onClick: (e) => { e.stopPropagation(); psDeletePrompt(p); } }, "✕"));
  cardEl.append(top);
  const obj = (f.objective || "").trim();
  cardEl.append(el("div", { class: "ps-card-obj" }, obj ? (obj.length > 120 ? obj.slice(0, 117) + "…" : obj) : "No objective yet"));
  const rt = psReqFields(p.category).length, rd = psReqDone(p.category, f).length;
  cardEl.append(el("div", { class: "ps-card-meta" }, `${cat.icon} ${cat.label} · required ${rd}/${rt}`));
  const quick = el("div", { class: "ps-card-acts" });
  quick.append(el("button", { class: "tool-btn", onClick: (e) => { e.stopPropagation(); const x = psPrompts(p.category, f, p.title); navigator.clipboard && navigator.clipboard.writeText(x.execute); showTimerToast("Execute prompt copied."); } }, "Copy execute"));
  quick.append(el("button", { class: "tool-btn", onClick: (e) => { e.stopPropagation(); const x = psPrompts(p.category, f, p.title); navigator.clipboard && navigator.clipboard.writeText(x.clarify); showTimerToast("Clarify-first prompt copied."); } }, "Copy clarify"));
  cardEl.append(quick);
  return cardEl;
}

function renderPromptStudio() {
  psInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "vibe-wrap" });
  const head = el("div", { class: "vibe-head" });
  head.append(el("div", {}, el("div", { class: "vibe-title" }, "Prompt Studio"),
    el("div", { class: "vibe-sub" }, "Your reusable prompt library — a sharp brief for every kind of ask, saved and ready to re-copy.")));
  head.append(el("button", { class: "tool-btn accent-teal", onClick: () => psAddPrompt(PS_CATEGORIES[0].key) }, "+ New prompt"));
  wrap.append(head);

  // Category rail
  const rail = el("div", { class: "ps-rail" });
  const prompts = (STATE.prompts || []).slice();
  PS_CATEGORIES.forEach((c) => {
    const n = prompts.filter((p) => p.category === c.key).length;
    const card = el("div", { class: "ps-railcard", style: `--c:${c.color}`, onClick: () => psAddPrompt(c.key), title: `New ${c.label} prompt` });
    card.append(el("div", { class: "ps-rail-icon" }, c.icon));
    card.append(el("div", { class: "ps-rail-lab" }, c.label));
    card.append(el("div", { class: "ps-rail-n" }, n ? `${n} saved` : "+ new"));
    rail.append(card);
  });
  wrap.append(rail);

  if (!prompts.length) {
    wrap.append(el("div", { class: "vibe-empty" }, "No saved prompts yet. Pick a category above, or hit “+ New prompt”."));
    board.append(wrap); return;
  }

  // Sort bar
  const bar = el("div", { class: "ps-bar" });
  const setSort = (v) => { psSort = v; try { localStorage.setItem("rs_ps_sort", v); } catch (e) {} render(); };
  const seg = el("div", { class: "ps-barseg" });
  seg.append(el("label", {}, "Sort"));
  seg.append(psSegBar([
    ["cat", "Category", psSort, setSort],
    ["prio", "Priority", psSort, setSort],
    ["recent", "Recent", psSort, setSort],
  ]));
  bar.append(seg);
  wrap.append(bar);

  if (psSort === "cat") {
    PS_CATEGORIES.forEach((c) => {
      const items = psSortItems(prompts.filter((p) => p.category === c.key));
      if (!items.length) return;
      const sec = el("div", { class: "ps-libsec" });
      sec.append(el("div", { class: "ps-libhead", style: `border-left:4px solid ${c.color}` }, `${c.icon} ${c.label}`, el("span", { class: "ps-libcount" }, String(items.length))));
      const grid = el("div", { class: "ps-libgrid" });
      items.forEach((p) => grid.append(psPromptCard(p)));
      sec.append(grid);
      wrap.append(sec);
    });
  } else {
    const grid = el("div", { class: "ps-libgrid" });
    psSortItems(prompts).forEach((p) => grid.append(psPromptCard(p)));
    wrap.append(grid);
  }
  board.append(wrap);
}

function vibeBuildCard(proj) {
  const stage = vibeStage(proj.stage);
  const card = el("div", { class: "vibe-card", style: `--stage:${stage.color}` });

  const top = el("div", { class: "vibe-card-top" });
  const title = el("div", { class: "vibe-card-title gs-edit", contenteditable: "true", title: "Click to rename" }, proj.title);
  title.addEventListener("blur", () => { const v = title.textContent.trim(); if (v && v !== proj.title) vibePatch(proj, "title", v); });
  top.append(title);
  top.append(el("span", { class: "vibe-del", title: "Delete project", onClick: () => vibeDelete(proj) }, "✕"));
  card.append(top);

  // Stage selector
  const stageRow = el("div", { class: "vibe-stage-row" });
  VIBE_STAGES.forEach((s) => {
    const pill = el("span", { class: "vibe-stage" + (s.key === proj.stage ? " on" : ""), style: s.key === proj.stage ? `background:${s.color};border-color:${s.color}` : "", onClick: () => { vibePatch(proj, "stage", s.key); render(); } }, s.label);
    stageRow.append(pill);
  });
  card.append(stageRow);

  // Priority selector
  const prioRow = el("div", { class: "vibe-prio-row" });
  prioRow.append(el("span", { class: "vibe-prio-lab" }, "Priority"));
  PS_PRIORITIES.forEach((pr) => {
    prioRow.append(el("span", { class: "vibe-prio" + (proj.priority === pr.key ? " on" : ""), style: proj.priority === pr.key ? `background:${pr.color};border-color:${pr.color};color:#fff` : `--c:${pr.color}`, onClick: () => { vibePatch(proj, "priority", proj.priority === pr.key ? "" : pr.key); render(); } }, pr.label));
  });
  card.append(prioRow);

  // Description
  const desc = el("div", { class: "vibe-desc gs-edit", contenteditable: "true", "data-ph": "Add a description…" }, proj.description || "");
  desc.addEventListener("blur", () => { const v = desc.textContent.trim(); if (v !== (proj.description || "")) vibePatch(proj, "description", v); });
  card.append(desc);

  // Tags
  const tagWrap = el("div", { class: "vibe-tags" });
  const tags = parseGoalTags(proj.tags);
  if (!tags.length) tagWrap.append(el("span", { class: "goal-empty" }, "+ pillar / idea tag"));
  else tags.forEach((tag) => {
    const pk = goalTagPillar(tag);
    const color = pk ? gsP(pk).color : "#b3b3b3";
    tagWrap.append(el("span", { class: "goal-chip", style: `border-left:3px solid ${color}`, title: goalTagLabel(tag) }, goalTagLabel(tag) || "?"));
  });
  tagWrap.addEventListener("click", () => {
    openTagPicker("Tags · " + proj.title, "both", parseGoalTags(proj.tags), async (working) => {
      await vibePatch(proj, "tags", serializeGoalTags(working));
    }, "Tick the values and ideas this project advances — they’ll link it into your Map and Goals.");
  });
  card.append(el("div", { class: "vibe-tags-label" }, "Linked values & ideas"));
  card.append(tagWrap);

  // Plan button
  const hasPlan = planComplete(proj);
  card.append(el("button", {
    class: "vibe-plan-btn" + (hasPlan ? " has" : ""),
    title: hasPlan ? "View or edit this project's plan and prompts" : "Plan this project with the brief template",
    onClick: () => openProjectPlan(proj),
  }, hasPlan ? `View plan · ${planCoreCount(planOf(proj))}/${planCoreTotal()}` : "Create plan"));

  // To-do toggle
  const onTodo = vibeOnTodo(proj);
  card.append(el("button", {
    class: "vibe-todo-btn" + (onTodo ? " on" : ""),
    title: onTodo ? "Remove this project's task from All Active Tasks" : "Add this project as a task in All Active Tasks",
    onClick: () => vibeToggleTodo(proj),
  }, onTodo ? "✓ On to-do — remove" : "+ Add to to-do"));

  return card;
}

function vibeSortProjects(items) {
  if (vibeSort === "prio") return items.slice().sort((a, b) => psPrioRank(a.priority) - psPrioRank(b.priority) || (a.position || 0) - (b.position || 0));
  if (vibeSort === "recent") return items.slice().sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  return items.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
}

function renderVibe() {
  gsEnsureLoaded();
  psInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "vibe-wrap" });
  const head = el("div", { class: "vibe-head" });
  head.append(el("div", {}, el("div", { class: "vibe-title" }, "Vibe Coding Projects"),
    el("div", { class: "vibe-sub" }, "Your build pipeline — tag each to the values and ideas it advances.")));
  head.append(el("button", { class: "tool-btn accent-teal", onClick: vibeAddProject }, "+ New project"));
  wrap.append(head);

  const projects = (STATE.projects || []).slice();
  if (!projects.length) {
    wrap.append(el("div", { class: "vibe-empty" }, "No projects yet. Hit “+ New project” to start one."));
    board.append(wrap);
    return;
  }

  // Group / sort bar
  const bar = el("div", { class: "ps-bar" });
  const setGroup = (v) => { vibeGroup = v; try { localStorage.setItem("rs_vibe_group", v); } catch (e) {} render(); };
  const setSort = (v) => { vibeSort = v; try { localStorage.setItem("rs_vibe_sort", v); } catch (e) {} render(); };
  const g = el("div", { class: "ps-barseg" }); g.append(el("label", {}, "Group"));
  g.append(psSegBar([["stage", "Stage", vibeGroup, setGroup], ["prio", "Priority", vibeGroup, setGroup], ["none", "None", vibeGroup, setGroup]]));
  bar.append(g);
  const s = el("div", { class: "ps-barseg" }); s.append(el("label", {}, "Sort"));
  s.append(psSegBar([["prio", "Priority", vibeSort, setSort], ["recent", "Recent", vibeSort, setSort], ["manual", "Manual", vibeSort, setSort]]));
  bar.append(s);
  wrap.append(bar);

  // Build groups
  let groups = [];
  if (vibeGroup === "stage") {
    groups = VIBE_STAGES.map((st) => ({ name: st.label, color: st.color, items: projects.filter((p) => p.stage === st.key) }));
    const known = new Set(VIBE_STAGES.map((s2) => s2.key));
    const other = projects.filter((p) => !known.has(p.stage));
    if (other.length) groups.push({ name: "Other", color: "#b3b3b3", items: other });
  } else if (vibeGroup === "prio") {
    groups = PS_PRIORITIES.map((pr) => ({ name: pr.label + " priority", color: pr.color, items: projects.filter((p) => p.priority === pr.key) }));
    groups.push({ name: "No priority", color: "#b3b3b3", items: projects.filter((p) => !psPrio(p.priority)) });
  } else {
    groups = [{ name: "All projects", color: "#00859b", items: projects.slice() }];
  }

  groups.forEach((grp) => {
    if (!grp.items.length) return;
    const sec = el("div", { class: "vibe-groupsec" });
    const gh = el("div", { class: "vibe-grouphead" });
    gh.append(el("span", { class: "vibe-groupdot", style: `background:${grp.color}` }));
    gh.append(el("span", { class: "vibe-groupname" }, grp.name));
    gh.append(el("span", { class: "vibe-groupcount" }, String(grp.items.length)));
    sec.append(gh);
    const grid = el("div", { class: "vibe-grid" });
    vibeSortProjects(grp.items).forEach((proj) => grid.append(vibeBuildCard(proj)));
    sec.append(grid);
    wrap.append(sec);
  });

  board.append(wrap);
}

function renderRewards() {
  const board = $("#board");
  const p = pointsInfo();
  const wrap = el("div", { class: "rewards-view" });

  // Balance header
  const bal = el("div", { class: "rw-balance" });
  bal.append(el("div", { class: "rw-balance-num" }, `${p.balance}`));
  bal.append(el("div", { class: "rw-balance-lbl" }, `points available`));
  bal.append(el("div", { class: "rw-balance-sub" }, `Earned ${p.earned} · Spent ${p.redeemed}`));
  wrap.append(bal);

  // If there's no Points column yet, offer to set it up
  if (!p.points_col) {
    const setup = el("div", { class: "rw-setup" });
    setup.append(el("p", {}, "To award points, add a Points column to your tasks. Each task (and subtask) you complete adds its points to your balance."));
    setup.append(el("button", { class: "tool-btn accent-teal", onClick: async () => { await ensurePointsColumn(); } }, "+ Add Points column"));
    wrap.append(setup);
  } else {
    wrap.append(el("p", { class: "rw-hint" }, "Set a point value in the Points column on any task. Completing it (or its subtasks) adds those points here."));
  }

  // Rewards list
  const head = el("div", { class: "rw-head" });
  head.append(el("h2", {}, "Rewards"));
  head.append(el("button", { class: "tool-btn accent-teal", onClick: () => openRewardEditor() }, "+ Add reward"));
  wrap.append(head);

  const list = el("div", { class: "rw-list" });
  (STATE.rewards || []).forEach((r) => {
    const affordable = p.balance >= r.cost;
    const card = el("div", { class: "rw-card" + (affordable ? "" : " locked") });
    const info = el("div", { class: "rw-card-info" });
    info.append(el("div", { class: "rw-card-name" }, r.name));
    info.append(el("div", { class: "rw-card-cost" }, `${r.cost} pts`));
    card.append(info);
    const actions = el("div", { class: "rw-card-actions" });
    const redeem = el("button", { class: "rw-redeem" + (affordable ? "" : " disabled"),
      title: affordable ? "Redeem this reward" : "Not enough points yet",
      onClick: async () => {
        if (!affordable) return;
        try { await api(`/api/rewards/${r.id}/redeem`, { method: "POST" }); await loadState(); }
        catch (e) { alert("Not enough points for that yet."); }
      } }, affordable ? "Redeem" : "Locked");
    actions.append(redeem);
    actions.append(el("button", { class: "rw-mini", title: "Edit", onClick: () => openRewardEditor(r) }, ""));
    actions.append(el("button", { class: "rw-mini", title: "Delete", onClick: async () => {
      if (confirm(`Delete reward “${r.name}”?`)) { await api(`/api/rewards/${r.id}`, { method: "DELETE" }); await loadState(); }
    } }, "×"));
    card.append(actions);
    list.append(card);
  });
  if (!(STATE.rewards || []).length) {
    list.append(el("div", { class: "rw-empty" }, "No rewards yet — add something worth working toward."));
  }
  wrap.append(list);

  // Redemption history
  if ((STATE.redemptions || []).length) {
    wrap.append(el("h2", { style: "margin-top:24px" }, "Redeemed"));
    const hist = el("div", { class: "rw-history" });
    STATE.redemptions.slice(0, 20).forEach((rd) => {
      const row = el("div", { class: "rw-hist-row" });
      const when = rd.ts ? new Date(rd.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      row.append(el("span", {}, `${rd.name} · −${rd.cost} pts`));
      const right = el("span", { class: "rw-hist-right" });
      right.append(el("span", { class: "rw-hist-when" }, when));
      right.append(el("button", { class: "rw-mini", title: "Undo this redemption (refund points)",
        onClick: async () => { await api(`/api/redemptions/${rd.id}`, { method: "DELETE" }); await loadState(); } }, "↩"));
      row.append(right);
      hist.append(row);
    });
    wrap.append(hist);
  }

  board.append(wrap);
}

function openRewardEditor(reward) {
  openModal(reward ? "Edit reward" : "New reward", (body, close) => {
    const name = el("input", { class: "field", placeholder: "Reward name (e.g. Nice dinner out)", value: reward ? reward.name : "", style: "width:100%;margin-bottom:10px" });
    const cost = el("input", { class: "field", type: "number", min: "0", placeholder: "Cost in points", value: reward ? reward.cost : "", style: "width:100%;margin-bottom:14px" });
    body.append(el("label", { class: "rw-flabel" }, "Name"));
    body.append(name);
    body.append(el("label", { class: "rw-flabel" }, "Cost (points)"));
    body.append(cost);
    const save = el("button", { class: "tool-btn accent-teal", onClick: async () => {
      const nm = name.value.trim(); if (!nm) { name.focus(); return; }
      const c = Math.max(0, parseInt(cost.value || "0", 10) || 0);
      close();
      if (reward) await api(`/api/rewards/${reward.id}`, { method: "PATCH", body: JSON.stringify({ name: nm, cost: c }) });
      else await api("/api/rewards", { method: "POST", body: JSON.stringify({ name: nm, cost: c }) });
      await loadState();
    } }, reward ? "Save" : "Add reward");
    body.append(save);
    setTimeout(() => name.focus(), 30);
  });
}
