/* Radio Station — notes.js
   Notebook — freeform thoughts, reflections, and ideas that don't belong to a
   task, a goal, or a skill. A list on the left, the note on the right.
   Notes can be tagged, pinned, linked to a PARA item, and archived (never
   silently deleted). Everything autosaves as you type.
   State persists in settings["notebook"].
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

const NOTES_KEY = "notebook";
let NOTES = null;
let notesSaveT = null;
let notesSel = null;          // selected note id
let notesSearch = "";
let notesTagFilter = "";      // "" = all tags
let notesShowArchived = false;

function notesLoad() {
  if (NOTES) return;
  let saved = {};
  try { saved = JSON.parse((STATE.settings && STATE.settings[NOTES_KEY]) || "{}"); } catch (e) { saved = {}; }
  NOTES = Object.assign({ list: [] }, saved);
  if (!Array.isArray(NOTES.list)) NOTES.list = [];
}
function notesSave() {
  clearTimeout(notesSaveT);
  notesSaveT = setTimeout(() => {
    STATE.settings[NOTES_KEY] = JSON.stringify(NOTES);
    saveSetting(NOTES_KEY, STATE.settings[NOTES_KEY]);
  }, 500);
}
function notesUid() { return "n_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function noteById(id) { return (NOTES.list || []).find((n) => n.id === id) || null; }
function noteTags(n) {
  return String(n.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
}
function notesAllTags() {
  const s = new Set();
  (NOTES.list || []).forEach((n) => noteTags(n).forEach((t) => s.add(t)));
  return [...s].sort();
}
function notesVisible() {
  const q = notesSearch.trim().toLowerCase();
  return (NOTES.list || [])
    .filter((n) => (notesShowArchived ? n.archived : !n.archived))
    .filter((n) => !notesTagFilter || noteTags(n).includes(notesTagFilter))
    .filter((n) => !q || ((n.title || "") + " " + (n.body || "") + " " + nbPlain(n.bodyHtml || "") + " " + (n.tags || "")).toLowerCase().includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
                 || String(b.updated || "").localeCompare(String(a.updated || "")));
}

function notesNew() {
  notesLoad();
  const now = new Date().toISOString();
  const n = { id: notesUid(), title: "", body: "", tags: "", para: "",
              pinned: false, archived: false, created: now, updated: now };
  NOTES.list.unshift(n);
  notesSel = n.id;
  notesSave();
  render();
  setTimeout(() => { const t = document.querySelector(".nb-title"); if (t) t.focus(); }, 60);
}
function notesTouch(n) { n.updated = new Date().toISOString(); notesSave(); }
function notesDelete(id) {
  const n = noteById(id);
  if (!n) return;
  if (!confirm(`Delete "${n.title || "this note"}" permanently?\n\nArchiving keeps it instead.`)) return;
  NOTES.list = NOTES.list.filter((x) => x.id !== id);
  if (notesSel === id) notesSel = null;
  notesSave();
  render();
}

function nbWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---- Notebook shell --------------------------------------------------------
// Notes, Ideas and Career Notes are all "writing about the work rather than
// doing it", so they share one tab instead of three. This draws the sub-nav and
// hands the rest of the board to whichever one is selected. Each sub-view still
// owns its own state and renders into #board exactly as before.
let notebookTab = "notes";                 // notes | ideas | career
const NOTEBOOK_TABS = [
  ["notes",  "Notes"],
  ["ideas",  "Ideas"],
  ["studio", "Prompt Studio"],
  ["vibe",   "Vibe Coding"],
  ["career", "Career Notes"],
];

function renderNotebookShell() {
  const board = $("#board");
  const nav = el("div", { class: "nbk-nav" });
  NOTEBOOK_TABS.forEach(([k, label]) => {
    const btn = el("button", { class: "nbk-navbtn" + (notebookTab === k ? " on" : ""),
      onClick: () => {
        if (notebookTab === "career" && typeof careerFlush === "function") careerFlush();
        notebookTab = k;
        try { localStorage.setItem("rs_notebook_tab", k); } catch (e) {}
        render();
      } }, label);
    if (k === "notes") {
      try { notesLoad(); const n = (NOTES.list || []).filter((x) => !x.archived).length;
            if (n) btn.append(el("span", { class: "nbk-n" }, String(n))); } catch (e) {}
    }
    if (k === "career") {
      try { normalizeCareer(); const n = (CAREER.entries || []).length;
            if (n) btn.append(el("span", { class: "nbk-n" }, String(n))); } catch (e) {}
    }
    nav.append(btn);
  });
  board.append(nav);

  if (notebookTab === "ideas" && typeof renderIdeas === "function") renderIdeas();
  else if (notebookTab === "studio" && typeof renderPromptStudio === "function") renderPromptStudio();
  else if (notebookTab === "vibe" && typeof renderVibe === "function") renderVibe();
  else if (notebookTab === "career" && typeof renderCareer === "function") renderCareer();
  else renderNotes();
}
try {
  const saved = localStorage.getItem("rs_notebook_tab");
  if (saved && NOTEBOOK_TABS.some(([k]) => k === saved)) notebookTab = saved;
} catch (e) {}

// ---- Rich text -------------------------------------------------------------
// Note bodies were plain text; they're now HTML so they can carry bold, italic,
// underline and photos. `bodyHtml` is the new field — the old `body` is left
// untouched on disk so nothing is lost, and is converted on first read.
function nbEscape(x) {
  return String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function nbBodyHtml(n) {
  if (typeof n.bodyHtml === "string") return n.bodyHtml;
  // Migrate: plain text becomes escaped HTML with line breaks preserved.
  const txt = String(n.body || "");
  return txt ? nbEscape(txt).replace(/\n/g, "<br>") : "";
}
function nbPlain(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  d.querySelectorAll("img").forEach((i) => i.replaceWith(document.createTextNode("[photo] ")));
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}
// Paste as plain text so pasted web content can't drag in fonts, colours and
// scripts — formatting is applied with the toolbar instead.
function nbHandlePaste(e, editor, onChange) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith("image/")) {
      const file = it.getAsFile();
      if (file) { e.preventDefault(); nbInsertImageFile(file, editor, onChange); return; }
    }
  }
  e.preventDefault();
  const txt = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, txt);
}
async function nbInsertImageFile(file, editor, onChange) {
  if (!file || !/^image\//.test(file.type)) return;
  if (file.size > 8 * 1024 * 1024) { alert("That image is over 8 MB \u2014 try a smaller one."); return; }
  const fd = new FormData();
  fd.append("file", file, file.name || "paste.png");
  try {
    const res = await fetch("/api/notes/image", { method: "POST", body: fd });
    const d = await res.json();
    if (!d.ok) { alert("Couldn't add that image: " + (d.error || "unknown error")); return; }
    editor.focus();
    // Collapse any selection first: the toolbar preserves the selection for the
    // formatting buttons, and inserting into a live selection would REPLACE the
    // selected text with the photo instead of adding it.
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.collapseToEnd();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);                       // end of the note
      sel.removeAllRanges(); sel.addRange(r);
    }
    document.execCommand("insertHTML", false, `<img src="${d.url}" alt=""><br>`);
    onChange();
  } catch (err) { alert("Couldn't upload that image."); }
}
function nbCmd(editor, cmd, onChange) {
  editor.focus();
  document.execCommand(cmd, false, null);
  onChange();
}

// ---- Render ---------------------------------------------------------------
function renderNotes() {
  notesLoad();
  const board = $("#board");
  const wrap = el("div", { class: "nb-wrap" });

  const head = el("div", { class: "nb-head" });
  const htext = el("div", {});
  htext.append(el("h2", { class: "nb-h2" }, "Notebook"));
  htext.append(el("div", { class: "nb-sub" }, "Thoughts, reflections, and ideas \u2014 kept and searchable."));
  head.append(htext);
  const hb = el("div", { class: "nb-headbtns" });
  const search = el("input", { class: "nb-search", type: "search", placeholder: "Search notes\u2026", value: notesSearch });
  search.addEventListener("input", () => { notesSearch = search.value; renderNotesList(listCol); });
  hb.append(search);
  hb.append(el("button", { class: "tool-btn accent-teal", onClick: notesNew }, "+ New note"));
  head.append(hb);
  wrap.append(head);

  // Tag filter + archive toggle
  const bar = el("div", { class: "nb-bar" });
  const tags = notesAllTags();
  if (tags.length) {
    bar.append(el("button", { class: "nb-tag" + (notesTagFilter === "" ? " on" : ""),
      onClick: () => { notesTagFilter = ""; render(); } }, "All"));
    tags.forEach((t) => bar.append(el("button", { class: "nb-tag" + (notesTagFilter === t ? " on" : ""),
      onClick: () => { notesTagFilter = t; render(); } }, t)));
  }
  bar.append(el("span", { style: "flex:1" }));
  const arch = el("label", { class: "nb-archtoggle" });
  const cb = el("input", { type: "checkbox" });
  cb.checked = notesShowArchived;
  cb.addEventListener("change", () => { notesShowArchived = cb.checked; notesSel = null; render(); });
  arch.append(cb, el("span", {}, "Archived"));
  bar.append(arch);
  wrap.append(bar);

  const cols = el("div", { class: "nb-cols" });
  const listCol = el("div", { class: "nb-list" });
  const editCol = el("div", { class: "nb-edit" });
  cols.append(listCol, editCol);
  wrap.append(cols);
  board.append(wrap);

  renderNotesList(listCol);
  renderNoteEditor(editCol);
}

function renderNotesList(host) {
  host.innerHTML = "";
  const list = notesVisible();
  if (!list.length) {
    host.append(el("div", { class: "nb-empty" },
      notesShowArchived ? "No archived notes." : "No notes yet \u2014 start one with \u201C+ New note\u201D."));
    return;
  }
  list.forEach((n) => {
    const card = el("div", { class: "nb-card" + (notesSel === n.id ? " sel" : ""),
      onClick: () => { notesSel = n.id; render(); } });
    const top = el("div", { class: "nb-card-top" });
    if (n.pinned) top.append(el("span", { class: "nb-pin" }, "\u2605"));
    top.append(el("span", { class: "nb-card-title" }, n.title || "(untitled)"));
    top.append(el("span", { class: "nb-card-when" }, nbWhen(n.updated)));
    card.append(top);
    const preview = (n.body ? String(n.body) : nbPlain(nbBodyHtml(n))).replace(/\s+/g, " ").trim().slice(0, 96);
    if (preview) card.append(el("div", { class: "nb-card-prev" }, preview));
    const tg = noteTags(n);
    if (tg.length) {
      const row = el("div", { class: "nb-card-tags" });
      tg.slice(0, 4).forEach((t) => row.append(el("span", { class: "nb-chip" }, t)));
      card.append(row);
    }
    host.append(card);
  });
}

function renderNoteEditor(host) {
  host.innerHTML = "";
  const n = notesSel ? noteById(notesSel) : null;
  if (!n) {
    host.append(el("div", { class: "nb-empty" }, "Select a note, or start a new one."));
    return;
  }

  const titleI = el("input", { class: "nb-title", type: "text", placeholder: "Title" });
  titleI.value = n.title || "";
  titleI.addEventListener("input", () => { n.title = titleI.value; notesTouch(n); });
  titleI.addEventListener("change", () => renderNotesList(document.querySelector(".nb-list")));
  host.append(titleI);

  const meta = el("div", { class: "nb-meta" });
  const pin = el("button", { class: "nb-metabtn" + (n.pinned ? " on" : ""), title: "Pin to the top of the list",
    onClick: () => { n.pinned = !n.pinned; notesTouch(n); render(); } }, n.pinned ? "\u2605 Pinned" : "\u2606 Pin");
  meta.append(pin);
  meta.append(el("span", { class: "nb-when" }, "Updated " + nbWhen(n.updated)));
  host.append(meta);

  const editor = el("div", { class: "nb-body", contenteditable: "true", spellcheck: "true",
    "data-ph": "Write it down\u2026" });
  editor.innerHTML = nbBodyHtml(n);
  const onChange = () => {
    n.bodyHtml = editor.innerHTML;
    n.body = nbPlain(editor.innerHTML);      // keep a plain copy for search + previews
    notesTouch(n);
  };
  editor.addEventListener("input", onChange);
  editor.addEventListener("blur", () => { onChange(); notesSave(); });
  editor.addEventListener("paste", (e) => nbHandlePaste(e, editor, onChange));
  editor.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) { e.preventDefault(); nbInsertImageFile(f, editor, onChange); }
  });
  editor.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "i" || k === "u") {
      e.preventDefault();
      nbCmd(editor, k === "b" ? "bold" : k === "i" ? "italic" : "underline", onChange);
    }
  });

  const bar = el("div", { class: "nb-toolbar" });
  [["bold", "B", "Bold (Ctrl+B)", "nb-b"], ["italic", "I", "Italic (Ctrl+I)", "nb-i"],
   ["underline", "U", "Underline (Ctrl+U)", "nb-u"]].forEach(([cmd, label, title, cls]) => {
    bar.append(el("button", { class: "nb-tb " + cls, title,
      onMouseDown: (e) => e.preventDefault(),          // keep the selection
      onClick: () => nbCmd(editor, cmd, onChange) }, label));
  });
  bar.append(el("span", { class: "nb-tb-sep" }));
  [["insertUnorderedList", "\u2022 List", "Bullet list"],
   ["removeFormat", "\u2718", "Clear formatting"]].forEach(([cmd, label, title]) => {
    bar.append(el("button", { class: "nb-tb", title,
      onMouseDown: (e) => e.preventDefault(),
      onClick: () => nbCmd(editor, cmd, onChange) }, label));
  });
  const fileIn = el("input", { type: "file", accept: "image/*", style: "display:none" });
  fileIn.addEventListener("change", () => {
    const f = fileIn.files && fileIn.files[0];
    if (f) nbInsertImageFile(f, editor, onChange);
    fileIn.value = "";
  });
  bar.append(el("button", { class: "nb-tb", title: "Add a photo (or just paste / drag one in)",
    onMouseDown: (e) => e.preventDefault(), onClick: () => fileIn.click() }, "+ Photo"));
  bar.append(fileIn);
  host.append(bar);
  host.append(editor);

  const tagsI = el("input", { class: "nb-tags", type: "text", placeholder: "Tags, comma separated" });
  tagsI.value = n.tags || "";
  tagsI.addEventListener("input", () => { n.tags = tagsI.value; notesTouch(n); });
  tagsI.addEventListener("change", () => render());
  host.append(tagsI);

  // Optional link into PARA, so a note can live under a project or area
  try {
    paraLoad();
    const opts = (PARA.items || []).filter((i) => !i.archived);
    const sel = el("select", { class: "nb-para" });
    sel.append(el("option", { value: "" }, "\u2014 not filed under PARA \u2014"));
    opts.forEach((i) => {
      const kind = (PARA_BUCKETS.find((b) => b.key === i.kind) || {}).label || "";
      sel.append(el("option", Object.assign({ value: i.id }, i.id === n.para ? { selected: "selected" } : {}),
        kind.replace(/s$/, "") + " \u00B7 " + i.name));
    });
    sel.addEventListener("change", () => { n.para = sel.value; notesTouch(n); });
    host.append(sel);
  } catch (e) { /* PARA not available — the note simply isn't filed */ }

  const btns = el("div", { class: "nb-btns" });
  btns.append(el("button", { class: "tool-btn", onClick: () => { n.archived = !n.archived; notesTouch(n); notesSel = null; render(); } },
    n.archived ? "\u21A9 Restore" : "\u25AA Archive"));
  btns.append(el("button", { class: "tool-btn danger", onClick: () => notesDelete(n.id) }, "Delete"));
  host.append(btns);
}
