/* Radio Station — ideas.js
   Ideas — future projects, personal and work. A list of ideas on the left,
   a brainstorm space for the selected idea on the right: dated brainstorm
   notes you keep adding to, plus a one-line "next step".
   State persists in settings["ideas_lab"].
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

const IDEAS_KEY = "ideas_lab";
let IDEAS = null;
let ideasSaveT = null;
let ideasSel = null;          // selected idea id
let ideasFilter = "";         // "" | "personal" | "work"

const IDEA_KINDS = [["personal", "Personal"], ["work", "Work"]];
const IDEA_STATUSES = [["spark", "Spark"], ["exploring", "Exploring"], ["ready", "Ready to build"], ["parked", "Parked"]];

function ideasLoad() {
  if (IDEAS) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[IDEAS_KEY]) || "{}"); } catch (e) { saved = {}; }
  IDEAS = Object.assign({ list: [] }, saved);
  if (!Array.isArray(IDEAS.list)) IDEAS.list = [];
}
function ideasSave() {
  clearTimeout(ideasSaveT);
  ideasSaveT = setTimeout(() => {
    STATE.settings[IDEAS_KEY] = JSON.stringify(IDEAS);
    saveSetting(IDEAS_KEY, STATE.settings[IDEAS_KEY]);
  }, 400);
}
function ideasUid() { return "i" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function ideasFmtDate(iso) {
  try {
    const [y, mo, dd] = iso.split("-").map(Number);
    return new Date(y, mo - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (e) { return iso; }
}

function renderIdeas() {
  ideasLoad();
  ideasInjectCss();
  const board = $("#board");
  const wrap = el("div", { class: "id-wrap" });

  const head = el("div", { class: "vibe-head" });
  head.append(el("div", {},
    el("div", { class: "vibe-title" }, "Ideas"),
    el("div", { class: "vibe-sub" }, "Future projects, personal and work. Park a spark, then brainstorm it.")));
  wrap.append(head);

  const cols = el("div", { class: "id-cols" });
  cols.append(ideasListPane());
  cols.append(ideasBrainstormPane());
  wrap.append(cols);
  board.append(wrap);
}

// ---- Left: the idea list --------------------------------------------------
function ideasListPane() {
  const pane = el("div", { class: "id-list-pane" });

  // Filter chips + new-idea composer
  const bar = el("div", { class: "id-bar" });
  [["", "All"], ...IDEA_KINDS].forEach(([key, label]) => {
    bar.append(el("button", { class: "id-chip" + (ideasFilter === key ? " on" : ""),
      onClick: () => { ideasFilter = key; render(); } }, label));
  });
  pane.append(bar);

  const compose = el("div", { class: "id-compose" });
  const inp = el("input", { class: "id-inp", placeholder: "New idea…" });
  const kindSel = el("select", { class: "id-sel" });
  IDEA_KINDS.forEach(([v, l]) => kindSel.append(el("option", { value: v }, l)));
  if (ideasFilter === "work") kindSel.value = "work";
  const add = () => {
    const v = inp.value.trim();
    if (!v) return;
    const idea = { id: ideasUid(), title: v, kind: kindSel.value, status: "spark",
                   created: todayStr(), next: "", notes: [] };
    IDEAS.list.unshift(idea);
    ideasSel = idea.id;
    inp.value = "";
    ideasSave(); render();
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  compose.append(inp, kindSel, el("button", { class: "id-add", onClick: add }, "+ Add"));
  pane.append(compose);

  // The list
  const list = el("div", { class: "id-list" });
  const shown = IDEAS.list.filter((i) => !ideasFilter || i.kind === ideasFilter);
  if (!shown.length) list.append(el("div", { class: "id-empty" }, "No ideas yet — write one down above."));
  shown.forEach((idea) => {
    const row = el("div", { class: "id-row" + (ideasSel === idea.id ? " sel" : ""),
      onClick: () => { ideasSel = idea.id; render(); } });
    row.append(el("span", { class: "id-kind k-" + idea.kind }, idea.kind === "work" ? "W" : "P"));
    const mid = el("div", { class: "id-row-mid" });
    mid.append(el("div", { class: "id-row-title" }, idea.title));
    const st = IDEA_STATUSES.find((s) => s[0] === idea.status) || IDEA_STATUSES[0];
    mid.append(el("div", { class: "id-row-meta" },
      `${st[1]} · ${(idea.notes || []).length} note${(idea.notes || []).length === 1 ? "" : "s"} · ${ideasFmtDate(idea.created)}`));
    row.append(mid);
    list.append(row);
  });
  pane.append(list);
  return pane;
}

// ---- Right: brainstorm space for the selected idea ------------------------
function ideasBrainstormPane() {
  const pane = el("div", { class: "id-brain-pane" });
  const idea = IDEAS.list.find((i) => i.id === ideasSel);
  if (!idea) {
    pane.append(el("div", { class: "id-empty id-brain-empty" },
      "Pick an idea on the left — or add one — and brainstorm it here."));
    return pane;
  }

  // Title (editable) + kind + status + delete
  const top = el("div", { class: "id-brain-top" });
  const title = el("div", { class: "id-brain-title", contenteditable: "true" });
  title.textContent = idea.title;
  title.addEventListener("blur", () => {
    const v = title.textContent.trim();
    if (v && v !== idea.title) { idea.title = v; ideasSave(); render(); }
  });
  top.append(title);
  const controls = el("div", { class: "id-brain-controls" });
  const kindSel = el("select", { class: "id-sel" });
  IDEA_KINDS.forEach(([v, l]) => kindSel.append(el("option", Object.assign({ value: v }, idea.kind === v ? { selected: "selected" } : {}), l)));
  kindSel.addEventListener("change", () => { idea.kind = kindSel.value; ideasSave(); render(); });
  controls.append(kindSel);
  const stSel = el("select", { class: "id-sel" });
  IDEA_STATUSES.forEach(([v, l]) => stSel.append(el("option", Object.assign({ value: v }, idea.status === v ? { selected: "selected" } : {}), l)));
  stSel.addEventListener("change", () => { idea.status = stSel.value; ideasSave(); render(); });
  controls.append(stSel);
  controls.append(el("button", { class: "id-del", title: "Delete this idea and its brainstorm",
    onClick: () => {
      if (!confirm(`Delete "${idea.title}" and its brainstorm?`)) return;
      IDEAS.list = IDEAS.list.filter((i) => i.id !== idea.id);
      ideasSel = null;
      ideasSave(); render();
    } }, "Delete"));
  top.append(controls);
  pane.append(top);

  // Next step — the one line that makes an idea actionable
  const nextRow = el("div", { class: "id-next" });
  nextRow.append(el("label", {}, "Next step"));
  const nextInp = el("input", { class: "id-inp", placeholder: "If this became real, what would you do first?" });
  nextInp.value = idea.next || "";
  nextInp.addEventListener("change", () => { idea.next = nextInp.value.trim(); ideasSave(); });
  nextRow.append(nextInp);
  pane.append(nextRow);

  // Brainstorm composer — keep adding thoughts over time
  const compose = el("div", { class: "id-note-compose" });
  const ta = el("textarea", { class: "id-note-inp", rows: "2", placeholder: "Brainstorm — angles, risks, features, who to ask, why it might work…" });
  const logBtn = el("button", { class: "id-add", onClick: () => {
    const v = ta.value.trim();
    if (!v) return;
    idea.notes = idea.notes || [];
    idea.notes.unshift({ id: ideasUid(), d: todayStr(), text: v });
    ta.value = "";
    ideasSave(); render();
  } }, "Add thought");
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) logBtn.click(); });
  compose.append(ta, logBtn);
  pane.append(compose);

  // The brainstorm log
  const log = el("div", { class: "id-notes" });
  if (!(idea.notes || []).length) {
    log.append(el("div", { class: "id-empty" }, "No thoughts yet — every angle you jot lands here, dated."));
  }
  (idea.notes || []).forEach((n) => {
    const row = el("div", { class: "id-note" });
    row.append(el("span", { class: "id-note-date" }, ideasFmtDate(n.d)));
    const txt = el("span", { class: "id-note-text", contenteditable: "true" });
    txt.textContent = n.text;
    txt.addEventListener("blur", () => {
      const v = txt.textContent.trim();
      if (v && v !== n.text) { n.text = v; ideasSave(); }
    });
    row.append(txt);
    row.append(el("span", { class: "id-note-x", title: "Delete this thought",
      onClick: () => { idea.notes = idea.notes.filter((x) => x.id !== n.id); ideasSave(); render(); } }, "✕"));
    log.append(row);
  });
  pane.append(log);
  return pane;
}

function ideasInjectCss() {
  if (document.getElementById("ideas-extra-css")) return;
  const css = `
  .id-wrap{padding:20px 28px;max-width:1400px;margin:0 auto}
  .id-cols{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}
  @media (max-width: 860px){ .id-cols{grid-template-columns:1fr} }
  .id-list-pane,.id-brain-pane{background:var(--surface);border:1px solid var(--light-gray);border-radius:14px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .id-bar{display:flex;gap:6px;margin-bottom:10px}
  .id-chip{border:1px solid var(--light-gray);background:var(--surface);color:#5d6b66;font-size:12px;font-weight:700;border-radius:20px;padding:3px 13px;cursor:pointer;font-family:inherit}
  .id-chip.on{background:var(--teal);border-color:var(--teal);color:#fff}
  .id-compose{display:flex;gap:6px;margin-bottom:12px}
  .id-inp{flex:1;border:1px solid var(--light-gray);border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;min-width:0}
  .id-inp:focus{outline:none;border-color:var(--teal)}
  .id-sel{border:1px solid var(--light-gray);border-radius:8px;padding:5px 8px;font-size:12px;font-family:inherit;background:var(--surface);color:var(--ink)}
  .id-add{border:none;background:var(--teal);color:#fff;font-weight:700;font-size:12.5px;border-radius:8px;padding:6px 14px;cursor:pointer;font-family:inherit;flex-shrink:0}
  .id-add:hover{filter:brightness(1.06)}
  .id-list{display:flex;flex-direction:column;gap:5px;max-height:62vh;overflow-y:auto}
  .id-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--off-white);border-radius:10px;cursor:pointer}
  .id-row:hover{background:var(--off-white)}
  .id-row.sel{border-color:var(--teal);background:var(--pale-teal)}
  .id-kind{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;flex-shrink:0}
  .id-kind.k-personal{background:var(--sage)}
  .id-kind.k-work{background:var(--teal)}
  .id-row-mid{min-width:0}
  .id-row-title{font-size:13px;font-weight:700;color:var(--ink);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .id-row-meta{font-size:10.5px;color:var(--text-3);margin-top:1px}
  .id-empty{font-size:12.5px;color:#9aa8a3;font-style:italic;padding:6px 2px}
  .id-brain-empty{padding:40px 10px;text-align:center}
  .id-brain-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}
  .id-brain-title{font-size:19px;font-weight:800;color:var(--ink);flex:1;min-width:200px;outline:none;border-bottom:1px dashed transparent}
  .id-brain-title:focus{border-bottom-color:var(--teal)}
  .id-brain-controls{display:flex;gap:6px;align-items:center}
  .id-del{border:1px solid var(--light-gray);background:var(--surface);color:#c0392b;font-size:12px;font-weight:700;border-radius:8px;padding:5px 11px;cursor:pointer;font-family:inherit}
  .id-next{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .id-next label{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--text-2);flex-shrink:0}
  .id-note-compose{display:flex;gap:8px;align-items:stretch;margin-bottom:12px}
  .id-note-inp{flex:1;border:1px solid var(--light-gray);border-radius:9px;padding:8px 11px;font-size:13px;font-family:inherit;resize:vertical}
  .id-note-inp:focus{outline:none;border-color:var(--teal)}
  .id-notes{display:flex;flex-direction:column;gap:6px}
  .id-note{display:flex;gap:10px;align-items:baseline;padding:6px 4px;border-bottom:1px solid var(--off-white);font-size:13px}
  .id-note:last-of-type{border-bottom:none}
  .id-note-date{font-size:11px;font-weight:700;color:var(--teal);white-space:nowrap;min-width:46px}
  .id-note-text{flex:1;color:var(--ink);line-height:1.5;outline:none}
  .id-note-x{color:var(--mid-gray);cursor:pointer;font-size:11px}
  .id-note-x:hover{color:#c0392b}
  `;
  const st = document.createElement("style"); st.id = "ideas-extra-css"; st.textContent = css;
  document.head.appendChild(st);
}
