/* Radio Station — para.js
   PARA Method — Projects, Areas, Resources, Archives (Tiago Forte).
     Projects  — short-term efforts with a finish line. Can point at a board
                 group, so the live task count comes from the real board.
     Areas     — ongoing responsibilities with a standard to maintain. Can
                 point at a Goal section, so it inherits that value.
     Resources — reference material and links you want to find again.
     Archives  — anything from the three above, set aside but not deleted.
   Archiving is a status change, never a delete: nothing is lost, and
   restoring puts an item back in its original bucket.
   State persists in settings["para_os"].
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

const PARA_KEY = "para_os";
let PARA = null;
let paraSaveT = null;
let paraBucket = "project";        // which bucket the main column shows
let paraSearch = "";
let paraSel = null;                // id of the item open in the detail pane

const PARA_BUCKETS = [
  { key: "project",  label: "Projects",  blurb: "Short-term efforts with a finish line.",           icon: "▸" },
  { key: "area",     label: "Areas",     blurb: "Ongoing responsibilities with a standard to hold.", icon: "◈" },
  { key: "resource", label: "Resources", blurb: "Reference material worth finding again.",           icon: "◇" },
  { key: "archive",  label: "Archives",  blurb: "Set aside, not deleted. Restore any time.",         icon: "▪" },
];

function paraLoad() {
  if (PARA) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[PARA_KEY]) || "{}"); } catch (e) { saved = {}; }
  PARA = Object.assign({ items: [] }, saved);
  if (!Array.isArray(PARA.items)) PARA.items = [];
}
function paraSave() {
  clearTimeout(paraSaveT);
  paraSaveT = setTimeout(() => {
    STATE.settings[PARA_KEY] = JSON.stringify(PARA);
    saveSetting(PARA_KEY, STATE.settings[PARA_KEY]);
  }, 400);
}
function paraUid() { return "pa_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function paraById(id) { return (PARA.items || []).find((i) => i.id === id) || null; }

// Items live in one list; `kind` is the bucket and `archived` overrides it.
function paraInBucket(bucket) {
  const q = paraSearch.trim().toLowerCase();
  return (PARA.items || [])
    .filter((i) => (bucket === "archive" ? i.archived : !i.archived && i.kind === bucket))
    .filter((i) => !q || (i.name + " " + (i.note || "")).toLowerCase().includes(q))
    .sort((a, b) => (a.pos || 0) - (b.pos || 0) || String(a.name).localeCompare(String(b.name)));
}

// ---- Live counts pulled from the real board / goals ------------------------
function paraGroupTally(group) {
  if (!group) return null;
  const sc = STATE.columns.find((c) => c.type === "status");
  const rows = STATE.tasks.filter((t) => !t.parent_id && t.group_name === group);
  const done = sc ? rows.filter((t) => String(t.cells[sc.id] || "") === "Done").length : 0;
  return { total: rows.length, done: done };
}
function paraGoalLabel(tag) {
  if (!tag) return "";
  try { loadGoals(); } catch (e) { return ""; }
  if (tag.startsWith("pillar:")) { const p = gsP(tag.slice(7)); return p ? p.label : ""; }
  if (tag.startsWith("idea:")) {
    const g = (GOALS.ideas || []).find((i) => i.id === tag.slice(5));
    return g ? g.text : "";
  }
  return "";
}

function paraAdd(kind) {
  paraLoad();
  const name = prompt(PARA_BUCKETS.find((b) => b.key === kind).label.replace(/s$/, "") + " name:");
  if (!name || !name.trim()) return;
  const item = {
    id: paraUid(), kind: kind, name: name.trim(), note: "",
    group: "", goal: "", url: "", due: "", standard: "",
    archived: false, pos: (PARA.items || []).length,
    created: new Date().toISOString().slice(0, 10),
  };
  PARA.items.push(item);
  paraSel = item.id;
  paraSave();
  render();
}
function paraSetArchived(id, on) {
  const it = paraById(id);
  if (!it) return;
  it.archived = !!on;                    // status flip, never a delete
  paraSave();
  render();
}
function paraDelete(id) {
  const it = paraById(id);
  if (!it) return;
  if (!confirm(`Delete "${it.name}" permanently?\n\nArchiving keeps it and hides it instead.`)) return;
  PARA.items = PARA.items.filter((x) => x.id !== id);
  if (paraSel === id) paraSel = null;
  paraSave();
  render();
}

// ---- Render ---------------------------------------------------------------
function renderPara() {
  paraLoad();
  const board = $("#board");
  const wrap = el("div", { class: "para-wrap" });

  const head = el("div", { class: "para-head" });
  const htext = el("div", {});
  htext.append(el("h2", { class: "para-title" }, "PARA"));
  htext.append(el("div", { class: "para-sub" }, "Organize everything by how actionable it is \u2014 Projects, Areas, Resources, Archives."));
  head.append(htext);
  const hbtns = el("div", { class: "para-headbtns" });
  const search = el("input", { class: "para-search", type: "search", placeholder: "Search PARA\u2026", value: paraSearch });
  search.addEventListener("input", () => { paraSearch = search.value; renderParaList(listCol); });
  hbtns.append(search);
  if (paraBucket !== "archive") {
    hbtns.append(el("button", { class: "tool-btn accent-teal", onClick: () => paraAdd(paraBucket) },
      "+ New " + PARA_BUCKETS.find((b) => b.key === paraBucket).label.replace(/s$/, "")));
  }
  head.append(hbtns);
  wrap.append(head);

  // Bucket switcher, with counts
  const tabs = el("div", { class: "para-tabs" });
  PARA_BUCKETS.forEach((b) => {
    const n = paraInBucket(b.key).length;
    const t = el("button", { class: "para-tab" + (paraBucket === b.key ? " on" : ""),
      onClick: () => { paraBucket = b.key; paraSel = null; render(); } });
    t.append(el("span", { class: "para-tab-ic" }, b.icon));
    t.append(el("span", { class: "para-tab-l" }, b.label));
    t.append(el("span", { class: "para-tab-n" }, String(n)));
    tabs.append(t);
  });
  wrap.append(tabs);
  wrap.append(el("div", { class: "para-blurb" }, PARA_BUCKETS.find((b) => b.key === paraBucket).blurb));

  const cols = el("div", { class: "para-cols" });
  const listCol = el("div", { class: "para-list" });
  const detailCol = el("div", { class: "para-detail" });
  cols.append(listCol, detailCol);
  wrap.append(cols);
  board.append(wrap);

  renderParaList(listCol);
  renderParaDetail(detailCol);
}

function renderParaList(host) {
  host.innerHTML = "";
  const items = paraInBucket(paraBucket);
  if (!items.length) {
    host.append(el("div", { class: "para-empty" },
      paraBucket === "archive" ? "Nothing archived yet."
        : "Nothing here yet \u2014 use the button above to add one."));
    return;
  }
  items.forEach((it) => {
    const card = el("div", { class: "para-card" + (paraSel === it.id ? " sel" : ""),
      onClick: () => { paraSel = it.id; render(); } });
    const top = el("div", { class: "para-card-top" });
    top.append(el("span", { class: "para-card-name" }, it.name));
    if (it.archived) top.append(el("span", { class: "para-badge arch" }, PARA_BUCKETS.find((b) => b.key === it.kind) ? PARA_BUCKETS.find((b) => b.key === it.kind).label.replace(/s$/, "") : "Item"));
    card.append(top);
    if (it.note) card.append(el("div", { class: "para-card-note" }, it.note));
    const meta = el("div", { class: "para-card-meta" });
    const tally = paraGroupTally(it.group);
    if (tally) meta.append(el("span", { class: "para-chip live" }, `${it.group} \u00B7 ${tally.done}/${tally.total} done`));
    const gl = paraGoalLabel(it.goal);
    if (gl) meta.append(el("span", { class: "para-chip goal" }, "\u2726 " + gl));
    if (it.due) meta.append(el("span", { class: "para-chip" + (it.due < todayYMD() ? " over" : "") }, "\u25F4 " + it.due));
    if (it.url) meta.append(el("span", { class: "para-chip" }, "\u{1F517} link"));
    if (meta.children.length) card.append(meta);
    host.append(card);
  });
}

function renderParaDetail(host) {
  host.innerHTML = "";
  const it = paraSel ? paraById(paraSel) : null;
  if (!it) {
    host.append(el("div", { class: "para-empty" }, "Select an item to edit it."));
    return;
  }
  const kindLabel = (PARA_BUCKETS.find((b) => b.key === it.kind) || {}).label || "Item";
  host.append(el("div", { class: "para-d-eyebrow" }, kindLabel.replace(/s$/, "").toUpperCase() + (it.archived ? " \u00B7 ARCHIVED" : "")));

  const nameI = el("input", { class: "para-d-name", type: "text", value: it.name });
  nameI.addEventListener("change", () => { it.name = nameI.value.trim() || it.name; paraSave(); render(); });
  host.append(nameI);

  const field = (label, node) => {
    const f = el("div", { class: "para-f" });
    f.append(el("label", {}, label));
    f.append(node);
    host.append(f);
  };

  const noteI = el("textarea", { class: "para-d-note", rows: "4", placeholder: "What is this, and what does done look like?" });
  noteI.value = it.note || "";
  noteI.addEventListener("input", () => { it.note = noteI.value; paraSave(); });
  field("Notes", noteI);

  if (it.kind === "area") {
    const stdI = el("input", { class: "para-d-in", type: "text", placeholder: "e.g. Every model reviewed before it leaves my hands", value: it.standard || "" });
    stdI.addEventListener("input", () => { it.standard = stdI.value; paraSave(); });
    field("Standard to maintain", stdI);
  }

  if (it.kind === "project") {
    // Link to a real board group so the project shows live task progress
    const groups = [...new Set(STATE.tasks.filter((t) => !t.parent_id).map((t) => t.group_name))].sort();
    const gsel = el("select", { class: "para-d-in" });
    gsel.append(el("option", { value: "" }, "\u2014 not linked \u2014"));
    groups.forEach((g) => gsel.append(el("option", Object.assign({ value: g }, g === it.group ? { selected: "selected" } : {}), g)));
    gsel.addEventListener("change", () => { it.group = gsel.value; paraSave(); render(); });
    field("Board group (live task count)", gsel);

    const dueI = el("input", { class: "para-d-in", type: "date", value: it.due || "" });
    dueI.addEventListener("change", () => { it.due = dueI.value; paraSave(); render(); });
    field("Target date", dueI);
  }

  if (it.kind === "project" || it.kind === "area") {
    // Link to a goal or a goal section, using the existing load-bearing tags
    let opts = [];
    try {
      loadGoals();
      opts = gsPillars().map((p) => ["pillar:" + p.key, "Section \u00B7 " + p.label])
        .concat((GOALS.ideas || []).slice(0, 300).map((g) => ["idea:" + g.id, "Goal \u00B7 " + g.text]));
    } catch (e) { opts = []; }
    const sel = el("select", { class: "para-d-in" });
    sel.append(el("option", { value: "" }, "\u2014 not linked \u2014"));
    opts.forEach(([v, l]) => sel.append(el("option", Object.assign({ value: v }, v === it.goal ? { selected: "selected" } : {}), l)));
    sel.addEventListener("change", () => { it.goal = sel.value; paraSave(); render(); });
    field("Linked goal / section", sel);
  }

  if (it.kind === "resource") {
    const urlI = el("input", { class: "para-d-in", type: "url", placeholder: "https://\u2026", value: it.url || "" });
    urlI.addEventListener("input", () => { it.url = urlI.value; paraSave(); });
    field("Link", urlI);
    if (it.url) {
      const a = el("a", { class: "para-open", href: it.url, target: "_blank", rel: "noopener noreferrer" }, "Open link \u2192");
      host.append(a);
    }
  }

  // Notes from the Notebook that point at this item
  try {
    notesLoad();
    const linked = (NOTES.list || []).filter((n) => n.para === it.id && !n.archived);
    if (linked.length) {
      host.append(el("div", { class: "para-d-eyebrow", style: "margin-top:16px" }, "NOTEBOOK \u00B7 " + linked.length));
      const list = el("div", { class: "para-linknotes" });
      linked.slice(0, 8).forEach((n) => {
        list.append(el("button", { class: "para-linknote",
          onClick: () => { notesSel = n.id; currentView = "notes"; render(); } },
          n.title || "(untitled note)"));
      });
      host.append(list);
    }
  } catch (e) { /* notebook not loaded yet — fine */ }

  const btns = el("div", { class: "para-d-btns" });
  btns.append(el("button", { class: "tool-btn", onClick: () => paraSetArchived(it.id, !it.archived) },
    it.archived ? "\u21A9 Restore" : "\u25AA Archive"));
  btns.append(el("button", { class: "tool-btn danger", onClick: () => paraDelete(it.id) }, "Delete"));
  host.append(btns);
  host.append(el("div", { class: "para-d-created" }, "Added " + (it.created || "\u2014")));
}
