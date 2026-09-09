/* Tuned In — shell.js
   Shell — modals, tags, edit menu, header, density, export, toolbar wire-up, focus timer, shortcuts, tab order
   Load order matters: see templates/index.html. Classic scripts share one global scope. */

// ---------------- Modals ----------------
// Sort/group state for the Vibe board and Prompt library (persisted in localStorage).
let psSort = (() => { try { return localStorage.getItem("rs_ps_sort") || "cat"; } catch (e) { return "cat"; } })();
let vibeGroup = (() => { try { return localStorage.getItem("rs_vibe_group") || "stage"; } catch (e) { return "stage"; } })();
let vibeSort = (() => { try { return localStorage.getItem("rs_vibe_sort") || "prio"; } catch (e) { return "prio"; } })();

function psInjectCss() {
  if (document.getElementById("ps-extra-css")) return;
  const css = `
  .ps-req{color:#c0392b;font-weight:800}
  .ps-help{font-size:11.5px;color:#9aa8a3;margin:4px 2px 0;line-height:1.4}
  .ps-reqmeter{font-size:12px;font-weight:700;color:#c0782a;margin:4px 0 10px}
  .ps-reqmeter.ok{color:#2f7a52}
  .ps-priorow{display:flex;align-items:center;gap:8px;margin:10px 0 4px}
  .ps-priochip,.vibe-prio,.ps-card-prio{font-size:11.5px;font-weight:700;border:1px solid var(--c,#d9d9d6);color:var(--c,#5d6b66);background:#fff;border-radius:20px;padding:2px 11px;cursor:pointer;font-family:inherit}
  .ps-priochip.on,.vibe-prio.on{color:#fff}
  .ps-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:2px 0 14px;font-size:12.5px;color:#5d6b66}
  .ps-bar .ps-barseg{display:flex;align-items:center;gap:6px}
  .ps-bar label{font-weight:700;color:#7a8a86;text-transform:uppercase;font-size:10.5px;letter-spacing:.4px}
  .ps-seg{display:inline-flex;border:1px solid #d9d9d6;border-radius:8px;overflow:hidden}
  .ps-seg button{border:none;background:#fff;color:#00859b;font-weight:600;font-size:12px;padding:5px 11px;cursor:pointer;font-family:inherit;border-left:1px solid #e6ece9}
  .ps-seg button:first-child{border-left:none}
  .ps-seg button.on{background:#00859b;color:#fff}
  .ps-card-prio{padding:1px 9px;cursor:default}
  .vibe-prio-row{display:flex;align-items:center;gap:7px;margin:8px 0 2px}
  .vibe-prio-row .vibe-prio-lab{font-size:10.5px;font-weight:700;color:#9aa8a3;text-transform:uppercase;margin-right:2px}
  .vibe-groupsec{margin-bottom:22px}
  .vibe-grouphead{display:flex;align-items:center;gap:9px;margin:0 0 10px}
  .vibe-groupdot{width:11px;height:11px;border-radius:50%}
  .vibe-groupname{font-size:14px;font-weight:800;color:#0c3b44}
  .vibe-groupcount{font-size:11px;color:#fff;background:#b3c0bb;border-radius:20px;padding:1px 8px;font-weight:700}
  `;
  const s = el("style", { id: "ps-extra-css" });
  s.textContent = css;
  document.head.append(s);
}

function openModal(title, buildBody, opts) {
  opts = opts || {};
  const root = $("#modal-root");
  const overlay = el("div", { class: "modal-overlay" });
  let closed = false;
  function doClose() {
    if (closed) return; closed = true;
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); doClose(); } }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) doClose(); });
  const modal = el("div", { class: "modal" });
  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, title));
  head.append(el("button", { class: "modal-close", onClick: doClose }, "×"));
  modal.append(head);
  const body = el("div");
  modal.append(body);
  overlay.append(modal);
  root.append(overlay);
  document.addEventListener("keydown", onKey, true);
  buildBody(body, doClose);
  return { body, close: doClose };
}

function openColumns() {
  openModal("Manage Columns", (body, close) => {
    const list = el("div", { style: "margin-bottom:16px" });
    const refresh = () => {
      list.innerHTML = "";
      STATE.columns.forEach((c) => {
        const row = el("div", { class: "row" });
        row.append(el("span", { class: "grow", style: "font-weight:600;font-size:14px" }, c.name));
        row.append(el("span", { class: "type-tag" }, c.type));
        if (c.is_primary) row.append(el("span", { class: "muted" }, "primary"));
        else row.append(el("button", { class: "remove-link", onClick: async () => {
          await api(`/api/columns/${c.id}`, { method: "DELETE" });
          STATE.columns = STATE.columns.filter((x) => x.id !== c.id);
          STATE.tasks.forEach((t) => delete t.cells[c.id]);
          refresh(); render();
        } }, "Remove"));
        list.append(row);
      });
    };
    refresh();
    body.append(list);

    const controls = el("div", { style: "display:flex;gap:8px;align-items:center" });
    const nameInp = el("input", { class: "field", placeholder: "New column name", style: "flex:1" });
    const typeSel = el("select", { class: "sel" });
    CFG.columnTypes.forEach((t) => typeSel.append(el("option", { value: t }, t)));
    const addBtn = el("button", { class: "tool-btn accent-teal", onClick: async () => {
      if (!nameInp.value.trim()) return;
      const col = await api("/api/columns", { method: "POST", body: JSON.stringify({ name: nameInp.value.trim(), type: typeSel.value }) });
      STATE.columns.push(col);
      const def = col.type === "status" ? "Not Started" : "";
      STATE.tasks.forEach((t) => { t.cells[col.id] = def; });
      nameInp.value = ""; refresh(); render();
    } }, "Add");
    nameInp.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
    controls.append(nameInp, typeSel, addBtn);
    body.append(controls);
  });
}

function colName(id) { const c = STATE.columns.find((x) => x.id === id); return c ? c.name : id; }
function colType(id) { const c = STATE.columns.find((x) => x.id === id); return c ? c.type : "text"; }

function openAutomations() {
  openModal("Automations", (body) => {
    body.append(el("p", { class: "muted", style: "margin-top:0" }, "Rules run automatically whenever a task's cell changes."));
    const list = el("div", { style: "margin-bottom:16px" });
    const editorHost = el("div");

    const describe = (a) => {
      let act;
      if (a.action_type === "setToday") act = `set ${colName(a.action_col)} to today`;
      else if (a.action_type === "clear") act = `clear ${colName(a.action_col)}`;
      else if (a.action_type === "moveToGroup") act = `move to group "${a.action_val || "—"}"`;
      else if (a.action_type === "copyToGroup") act = `copy to group "${a.action_val || "—"}"`;
      else act = `set ${colName(a.action_col)} = ${a.action_val}`;
      return `When ${colName(a.trigger_col)} = ${a.trigger_val} → ${act}`;
    };

    const refresh = () => {
      list.innerHTML = "";
      if (STATE.automations.length === 0) list.append(el("div", { class: "muted" }, "No automations yet."));
      STATE.automations.forEach((a) => {
        const row = el("div", { class: "row" });
        const chk = el("input", { type: "checkbox" });
        chk.checked = !!a.enabled;
        chk.addEventListener("change", async () => {
          await api(`/api/automations/${a.id}/toggle`, { method: "PATCH" });
          a.enabled = a.enabled ? 0 : 1;
        });
        row.append(chk);
        const mid = el("div", { class: "grow" });
        mid.append(el("div", { style: "font-weight:600;font-size:13px" }, a.name || describe(a)));
        mid.append(el("div", { class: "auto-desc" }, describe(a)));
        row.append(mid);
        row.append(el("button", { class: "tool-btn", style: "padding:4px 10px", onClick: () => buildEditor(a) }, "Edit"));
        row.append(el("button", { class: "remove-link", onClick: async () => {
          await api(`/api/automations/${a.id}`, { method: "DELETE" });
          STATE.automations = STATE.automations.filter((x) => x.id !== a.id);
          refresh();
        } }, "×"));
        list.append(row);
      });
    };

    const buildEditor = (existing) => {
      editorHost.innerHTML = "";
      const statusColId = (STATE.columns.find((c) => c.type === "status") || STATE.columns[0]).id;
      const dateColId = (STATE.columns.find((c) => c.type === "date") || STATE.columns[0]).id;
      const draft = existing ? { ...existing } : {
        id: null, enabled: true, name: "",
        trigger_col: statusColId, trigger_val: "Done",
        action_col: dateColId, action_type: "setToday", action_val: "",
      };

      const ed = el("div", { class: "auto-editor" });
      const nameInp = el("input", { class: "field", placeholder: "Automation name (optional)", style: "width:100%;margin-bottom:12px" });
      nameInp.value = draft.name || "";
      nameInp.addEventListener("input", () => draft.name = nameInp.value);
      ed.append(nameInp);

      // trigger line
      const tline = el("div", { class: "auto-line" });
      tline.append(el("span", {}, "When"));
      const tcol = el("select", { class: "sel" });
      STATE.columns.forEach((c) => tcol.append(el("option", { value: c.id }, c.name)));
      tcol.value = draft.trigger_col;
      tline.append(tcol, el("span", {}, "="));
      const tvalHost = el("span");
      tline.append(tvalHost);
      ed.append(tline);

      // action line
      const aline = el("div", { class: "auto-line" });
      aline.append(el("span", {}, "Then"));
      const atype = el("select", { class: "sel" });
      [
        ["setToday", "set date to today"],
        ["setValue", "set value"],
        ["clear", "clear value"],
        ["moveToGroup", "move to group"],
        ["copyToGroup", "copy to group (linked)"],
      ].forEach(([v, l]) => atype.append(el("option", { value: v }, l)));
      atype.value = draft.action_type;
      aline.append(atype);
      const onLabel = el("span", {}, "on");
      aline.append(onLabel);
      const acol = el("select", { class: "sel" });
      STATE.columns.forEach((c) => acol.append(el("option", { value: c.id }, c.name)));
      acol.value = draft.action_col;
      aline.append(acol);
      const avalHost = el("span");
      aline.append(avalHost);
      ed.append(aline);

      const renderTriggerVal = () => {
        tvalHost.innerHTML = "";
        const vals = valuesFor(colType(draft.trigger_col));
        if (vals.length) {
          const s = el("select", { class: "sel" });
          vals.forEach((v) => s.append(el("option", { value: v }, v)));
          s.value = vals.includes(draft.trigger_val) ? draft.trigger_val : vals[0];
          draft.trigger_val = s.value;
          s.addEventListener("change", () => draft.trigger_val = s.value);
          tvalHost.append(s);
        } else {
          const i = el("input", { class: "sel", style: "width:110px", value: draft.trigger_val });
          i.addEventListener("input", () => draft.trigger_val = i.value);
          tvalHost.append(i);
        }
      };
      const renderActionVal = () => {
        avalHost.innerHTML = "";
        // move/copy to group: hide column picker; show a group-name input
        const isGroupAction = draft.action_type === "moveToGroup" || draft.action_type === "copyToGroup";
        onLabel.style.display = isGroupAction ? "none" : "";
        acol.style.display = isGroupAction ? "none" : "";
        if (isGroupAction) {
          const inp = el("input", { class: "sel", style: "width:160px", placeholder: "group name", value: draft.action_val, list: "rs-group-list" });
          inp.addEventListener("input", () => draft.action_val = inp.value);
          avalHost.append(inp);
          // datalist of existing groups for autocomplete
          if (!document.getElementById("rs-group-list")) {
            const dl = el("datalist", { id: "rs-group-list" });
            document.body.append(dl);
          }
          const dl = document.getElementById("rs-group-list");
          dl.innerHTML = "";
          allGroupNames().forEach((g) => dl.append(el("option", { value: g })));
          return;
        }
        if (draft.action_type !== "setValue") return;
        const vals = valuesFor(colType(draft.action_col));
        if (vals.length) {
          const s = el("select", { class: "sel" });
          s.append(el("option", { value: "" }, "—"));
          vals.forEach((v) => s.append(el("option", { value: v }, v)));
          s.value = draft.action_val || "";
          s.addEventListener("change", () => draft.action_val = s.value);
          avalHost.append(s);
        } else {
          const i = el("input", { class: "sel", style: "width:110px", placeholder: "value", value: draft.action_val });
          i.addEventListener("input", () => draft.action_val = i.value);
          avalHost.append(i);
        }
      };

      tcol.addEventListener("change", () => { draft.trigger_col = tcol.value; renderTriggerVal(); });
      atype.addEventListener("change", () => { draft.action_type = atype.value; renderActionVal(); });
      acol.addEventListener("change", () => { draft.action_col = acol.value; renderActionVal(); });
      renderTriggerVal();
      renderActionVal();

      const btns = el("div", { style: "display:flex;gap:8px;margin-top:14px" });
      btns.append(el("button", { class: "tool-btn accent-green", onClick: async () => {
        const payload = { ...draft };
        const resp = await api("/api/automations", { method: "POST", body: JSON.stringify(payload) });
        if (draft.id) {
          const idx = STATE.automations.findIndex((x) => x.id === draft.id);
          STATE.automations[idx] = { ...draft, enabled: draft.enabled ? 1 : 0 };
        } else {
          STATE.automations.push({ ...draft, id: resp.id, enabled: 1 });
        }
        editorHost.innerHTML = "";
        refresh();
      } }, "Save rule"));
      btns.append(el("button", { class: "tool-btn", onClick: () => editorHost.innerHTML = "" }, "Cancel"));
      ed.append(btns);
      editorHost.append(ed);
    };

    refresh();
    body.append(list);
    const newBtn = el("button", { class: "tool-btn accent-teal", onClick: () => buildEditor(null) }, "+ New Automation");
    body.append(newBtn);
    body.append(editorHost);
  });
}

// ---------------- Tags modal (custom status / priority) ----------------
async function reorderPalette(kind) {
  const order = paletteFor(kind).map((p) => p.id);
  await api("/api/palette/reorder", { method: "PATCH", body: JSON.stringify({ kind, order }) });
}

function openTags() {
  openModal("Edit Tags", (body) => {
    const buildSection = (kind, heading, hint) => {
      const section = el("div", { style: "margin-bottom:22px" });
      section.append(el("h3", { style: "margin:0 0 4px;font-family:Georgia,serif;font-size:17px;color:var(--ink)" }, heading));
      section.append(el("div", { class: "muted", style: "margin-bottom:10px" }, hint));
      const list = el("div");
      section.append(list);

      const refresh = () => {
        list.innerHTML = "";
        const entries = paletteFor(kind);
        entries.forEach((p, i) => {
          const row = el("div", { class: "row" });

          // reorder (priority ranking) — top = highest severity
          if (kind === "priority") {
            const arrows = el("div", { style: "display:flex;flex-direction:column;line-height:1" });
            const up = el("button", { class: "remove-link", style: "color:var(--mid-gray);font-size:12px", title: "Higher priority",
              onClick: async () => { if (i === 0) return; entries.splice(i - 1, 0, entries.splice(i, 1)[0]); await reorderPalette(kind); refresh(); render(); } }, "▲");
            const down = el("button", { class: "remove-link", style: "color:var(--mid-gray);font-size:12px", title: "Lower priority",
              onClick: async () => { if (i === entries.length - 1) return; entries.splice(i + 1, 0, entries.splice(i, 1)[0]); await reorderPalette(kind); refresh(); render(); } }, "▼");
            arrows.append(up, down);
            row.append(arrows);
          }

          const swatch = el("input", { type: "color", value: p.color, style: "width:32px;height:28px;border:none;background:none;cursor:pointer;padding:0" });
          swatch.addEventListener("change", async () => {
            p.color = swatch.value;
            await api(`/api/palette/${p.id}`, { method: "PATCH", body: JSON.stringify({ color: swatch.value }) });
            render();
          });
          row.append(swatch);

          const labelInp = el("input", { class: "field grow", value: p.label, style: "padding:5px 10px" });
          const commit = async () => {
            const newLabel = labelInp.value.trim();
            if (!newLabel || newLabel === p.label) { labelInp.value = p.label; return; }
            const old = p.label;
            p.label = newLabel;
            await api(`/api/palette/${p.id}`, { method: "PATCH", body: JSON.stringify({ label: newLabel }) });
            // reflect the rename in any task cells currently held in memory
            const kindCols = STATE.columns.filter((c) => c.type === kind).map((c) => c.id);
            STATE.tasks.forEach((t) => kindCols.forEach((cid) => { if (t.cells[cid] === old) t.cells[cid] = newLabel; }));
            render();
          };
          labelInp.addEventListener("blur", commit);
          labelInp.addEventListener("keydown", (e) => { if (e.key === "Enter") labelInp.blur(); });
          row.append(labelInp);

          if (kind === "priority") row.append(el("span", { class: "muted", style: "font-size:11px;min-width:54px;text-align:right" }, i === 0 ? "highest" : i === entries.length - 1 ? "lowest" : `rank ${i + 1}`));

          row.append(el("button", { class: "remove-link", onClick: async () => {
            await api(`/api/palette/${p.id}`, { method: "DELETE" });
            const idx = paletteFor(kind).findIndex((x) => x.id === p.id);
            paletteFor(kind).splice(idx, 1);
            refresh(); render();
          } }, "×"));

          list.append(row);
        });
      };
      refresh();

      const controls = el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" });
      const newLabel = el("input", { class: "field", placeholder: `New ${kind} tag`, style: "flex:1" });
      const newColor = el("input", { type: "color", value: kind === "priority" ? "#00859b" : "#00bfb8", style: "width:38px;height:34px;border:none;background:none;cursor:pointer;padding:0" });
      const addBtn = el("button", { class: "tool-btn accent-teal", onClick: async () => {
        if (!newLabel.value.trim()) return;
        const entry = await api("/api/palette", { method: "POST", body: JSON.stringify({ kind, label: newLabel.value.trim(), color: newColor.value }) });
        paletteFor(kind).push(entry);
        newLabel.value = ""; refresh(); render();
      } }, "Add");
      newLabel.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
      controls.append(newColor, newLabel, addBtn);
      section.append(controls);
      return section;
    };

    body.append(buildSection("status", "Statuses", "Custom status labels and colors for any Status column."));
    body.append(buildSection("priority", "Priorities", "Order sets ranking — top is highest. Used by “Sort by Priority.”"));
  });
}

// ---------------- Edit dropdown menu ----------------
// Remove empty/placeholder task rows (blank or still-"New task" with no other
// content). Undoable with a single Ctrl+Z since it's one mutation via api().
async function cleanupEmptyTasks() {
  const resp = await api("/api/tasks/cleanup-empty", { method: "POST" });
  await loadState();
  const n = resp && resp.deleted ? resp.deleted : 0;
  if (n === 0) {
    showTimerToast("No empty tasks to clean up.");
  } else {
    showTimerToast(`Removed ${n} empty task${n === 1 ? "" : "s"}. Press Ctrl+Z to undo.`);
  }
}


// ---- Data history ----------------------------------------------------------
// Every write to a qualitative JSON blob (goals, notebook, PARA, skill lab,
// ideas) snapshots the previous value server-side. This browses those
// snapshots and restores one. Restores are themselves snapshotted, so there's
// no dead end.
function hbKB(n) {
  if (n == null) return "\u2014";
  return n < 10240 ? (n / 1024).toFixed(1) + " KB" : Math.round(n / 1024) + " KB";
}
function hbWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const HB_LABELS = {
  goals_os: "Goals \u2014 goals, sections, identity, ledger",
  notebook: "Notebook \u2014 notes",
  para_os: "PARA \u2014 projects, areas, resources",
  sb_state: "Skill Lab \u2014 categories, resources, TIL",
  ideas_lab: "Ideas \u2014 ideas and brainstorms",
  career_notes: "Career notes",
};

async function openDataHistory() {
  openModal("Data history", async (body, close) => {
    body.classList.add("hb-modal");
    body.append(el("p", { class: "hb-intro" },
      "Each of these is stored as one block of text that the app rewrites as you work. "
      + "The previous version is kept every time it changes \u2014 up to 20, at most one per hour \u2014 so a bad save can be undone."));
    const host = el("div", { class: "hb-body" }, "Loading\u2026");
    body.append(host);

    let summary;
    try {
      summary = await api("/api/settings/history");
    } catch (err) {
      host.textContent = "Couldn't load history: " + err.message;
      return;
    }
    host.innerHTML = "";
    const keys = (summary.keys || []).filter((k) => k.versions > 0);
    if (!keys.length) {
      host.append(el("div", { class: "hb-empty" },
        "No versions recorded yet. They start accumulating the next time one of these changes."));
      return;
    }

    keys.forEach((k) => {
      const sec = el("div", { class: "hb-key" });
      const head = el("div", { class: "hb-key-head" });
      head.append(el("span", { class: "hb-key-name" }, HB_LABELS[k.key] || k.key));
      head.append(el("span", { class: "hb-key-meta" },
        `now ${hbKB(k.current_bytes)} \u00B7 ${k.versions} saved version${k.versions === 1 ? "" : "s"}`));
      sec.append(head);

      const list = el("div", { class: "hb-vers" }, "\u2026");
      sec.append(list);
      host.append(sec);

      api("/api/settings/history?key=" + encodeURIComponent(k.key)).then((d) => {
        list.innerHTML = "";
        (d.versions || []).forEach((v, i) => {
          const row = el("div", { class: "hb-ver" });
          row.append(el("span", { class: "hb-ver-when" }, hbWhen(v.saved_at)));
          const delta = k.current_bytes ? v.bytes - k.current_bytes : 0;
          const sizeCls = delta > 0 ? "hb-bigger" : delta < 0 ? "hb-smaller" : "";
          row.append(el("span", { class: "hb-ver-size " + sizeCls }, hbKB(v.bytes)));
          if (i === 0) row.append(el("span", { class: "hb-ver-tag" }, "most recent"));
          row.append(el("span", { style: "flex:1" }));
          row.append(el("button", { class: "hb-btn", title: "Show the first part of this version",
            onClick: () => previewVersion(v.id) }, "Preview"));
          row.append(el("button", { class: "hb-btn warn", title: "Put this version back",
            onClick: () => restoreVersion(v, k, close) }, "Restore"));
          list.append(row);
        });
      }).catch((e) => { list.textContent = "Couldn't load versions."; });
    });
  });
}

async function previewVersion(id) {
  try {
    const d = await api("/api/settings/history?id=" + encodeURIComponent(id));
    const v = d.version || {};
    let pretty = v.value || "";
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch (e) { /* not JSON */ }
    openModal("Version from " + hbWhen(v.saved_at), (body2) => {
      body2.append(el("div", { class: "hb-key-meta", style: "margin-bottom:8px" },
        `${v.key} \u00B7 ${hbKB(v.bytes)}`));
      const pre = el("pre", { class: "hb-pre" }, pretty.slice(0, 12000) + (pretty.length > 12000 ? "\n\u2026 truncated" : ""));
      body2.append(pre);
    });
  } catch (err) { alert("Couldn't load that version: " + err.message); }
}

async function restoreVersion(v, k, closeParent) {
  const msg = `Restore ${HB_LABELS[k.key] || k.key} to the version from ${hbWhen(v.saved_at)}?\n\n`
    + `That version is ${hbKB(v.bytes)}; the current one is ${hbKB(k.current_bytes)}.\n\n`
    + `The current version is saved to history first, so you can undo this.`;
  if (!confirm(msg)) return;
  try {
    await api("/api/settings/restore", { method: "POST", body: JSON.stringify({ id: v.id }) });
    if (typeof closeParent === "function") closeParent();
    await loadState();
    // Drop cached blobs so each view re-reads what was just restored
    if (typeof GOALS !== "undefined") GOALS = null;
    if (typeof PARA !== "undefined") PARA = null;
    if (typeof NOTES !== "undefined") NOTES = null;
    if (typeof SB !== "undefined") SB = null;
    render();
    alert("Restored. If that wasn't what you wanted, Data history now holds the version you just replaced.");
  } catch (err) { alert("Restore failed: " + err.message); }
}

// ---- Appearance ------------------------------------------------------------
// One palette (Shore) in two grounds: light, and Wet Slate dark. The switch
// only changes CSS custom properties and the painted banner — status, group
// and pillar colours are records and are never rewritten by it.
function isDark() { return ((STATE.settings && STATE.settings.theme) || "") === "dark"; }
function applyTheme() {
  document.body.classList.toggle("theme-dark", isDark());
  const btn = document.getElementById("btn-theme");
  if (btn) {
    btn.innerHTML = "";
    btn.append(icon(isDark() ? "sun" : "moon", 13));
    btn.append(el("span", {}, isDark() ? "Light" : "Dark"));
    btn.title = isDark() ? "Switch to light" : "Switch to dark";
  }
  if (typeof zenPaintBanner === "function") zenPaintBanner();
}
async function toggleTheme() {
  const next = isDark() ? "" : "dark";
  STATE.settings.theme = next;
  applyTheme();
  await saveSetting("theme", next);
  render();
}

// Group colours are records, so matching them to the palette is offered here
// rather than done automatically by the switch.
function openAppearance() {
  openModal("Appearance", (body, close) => {
    body.append(el("p", { class: "ms-intro" },
      "Tuned In uses one palette \u2014 beach tones \u2014 in a light ground or a Wet Slate dark ground. "
      + "Use the Dark/Light button in the banner to switch."));
    body.append(el("p", { class: "ms-intro" },
      "Your group colours are data, so switching grounds leaves them alone. You can repaint them to match the palette \u2014 that changes saved values."));
    const pal = ["#59251f", "#77785a", "#535958", "#806a27", "#a69c89", "#6f8f7a", "#b5523c", "#292d28"];
    const sw = el("div", { class: "th-sw", style: "margin-bottom:12px" });
    pal.forEach((c) => sw.append(el("span", { style: `background:${c}` })));
    body.append(sw);
    body.append(el("button", { class: "tool-btn", onClick: async () => {
      const groups = [...new Set(STATE.tasks.filter((t) => !t.parent_id).map((t) => t.group_name))];
      if (!confirm(`Repaint ${groups.length} group colour${groups.length === 1 ? "" : "s"} to match the palette?\n\n`
        + "This changes saved colours and isn't undone by switching light/dark.")) return;
      for (let i = 0; i < groups.length; i++) {
        const color = pal[i % pal.length];
        STATE.group_colors[groups[i]] = color;
        try { await api("/api/groups/color", { method: "PATCH", body: JSON.stringify({ name: groups[i], color }) }); }
        catch (e) { console.error("[theme] group recolour failed:", e); }
      }
      close();
      render();
    } }, "Repaint group colours to match"));
  });
}

function openEditMenu() {
  closeAllPopovers();
  const menu = el("div", { class: "row-menu floating", style: "min-width:180px" });
  menu.append(el("div", { class: "row-menu-head" }, "Settings"));
  // Each entry carries an inline SVG icon rather than an emoji, so it renders
  // the same on every platform and takes the theme's colour.
  const item = (ic, label, fn) => {
    const row = el("div", { class: "row-menu-opt", onClick: () => { menu.remove(); fn(); } });
    row.append(icon(ic, 14));
    row.append(el("span", {}, label));
    return row;
  };
  menu.append(item("columns", "Columns", openColumns));
  menu.append(item("sliders", "Display", openDisplay));
  menu.append(item("bolt", "Automations", openAutomations));
  menu.append(item("header", "Header", openHeaderSettings));
  menu.append(item("contrast", "Appearance", openAppearance));
  menu.append(item("keyboard", "Shortcuts", openShortcuts));
  menu.append(item("history", "Data history", openDataHistory));
  menu.append(el("div", { class: "row-menu-sep" }));
  menu.append(item("broom", "Clean up empty tasks", cleanupEmptyTasks));
  const anchor = document.getElementById("btn-edit");
  positionFloatingMenu(menu, anchor, "below-right");
  attachOutsideClose(menu, anchor);
}

// ---------------- Header customization ----------------
// Banner parts can be shown/hidden, and the title/subtitle text, background &
// text colors, and icon image can all be customized. Everything persists in
// settings (icon via a file upload stored under static/uploads).
const HEADER_PARTS = [
  { key: "hdr_banner", label: "Background banner", el: "app-banner" },
  { key: "hdr_logo", label: "Icon", el: "banner-logo" },
  { key: "hdr_title", label: "Title", el: "banner-title" },
  { key: "hdr_tagline", label: "Subtitle", el: "banner-tagline" },
];
const HDR_DEFAULTS = {
  title: "Tuned In",
  tagline: "",   // no default subtitle; click the banner to add one
  bg: "#77785a",
  text: "#e1e2d8",
  icon: (typeof DEMO_ICON !== "undefined" ? DEMO_ICON : "/static/bonsai_logo.svg"),
};
function headerPartOn(key) {
  const v = STATE.settings && STATE.settings[key];
  if (v == null) return true;  // default ON
  return String(v).toLowerCase() !== "false";
}
function hdrGet(key, fallback) {
  const v = STATE.settings && STATE.settings[key];
  return (v == null || v === "") ? fallback : v;
}
function applyHeaderSettings() {
  // Visibility
  HEADER_PARTS.forEach((p) => {
    const node = document.getElementById(p.el);
    if (node) node.style.display = headerPartOn(p.key) ? "" : "none";
  });
  // Text content
  const titleEl = document.getElementById("banner-title");
  const tagEl = document.getElementById("banner-tagline");
  if (titleEl) titleEl.textContent = hdrGet("hdr_title_text", HDR_DEFAULTS.title);
  if (tagEl) tagEl.textContent = hdrGet("hdr_tagline_text", HDR_DEFAULTS.tagline);
  // Colors — the banner is now raked sand (painted by zenPaintBanner over any
  // background color). Custom colors from the header settings still win for
  // text; with nothing saved, the stylesheet's ink-on-sand defaults apply.
  const banner = document.getElementById("app-banner");
  const bg = hdrGet("hdr_bg_color", "");
  const text = hdrGet("hdr_text_color", "");
  if (banner) {
    banner.style.background = bg || "";
    banner.style.color = text || "";
    if (titleEl) titleEl.style.color = text || "";
    if (tagEl) tagEl.style.color = text || "";
  }
  if (typeof zenPaintBanner === "function") setTimeout(zenPaintBanner, 0);
  // Icon
  const logo = document.getElementById("banner-logo");
  if (logo) logo.src = hdrGet("hdr_icon_url", HDR_DEFAULTS.icon);
  // Size: 0..100 slider -> scale 0.6..1.6
  const sizeVal = Number(hdrGet("hdr_size", "40"));
  const scale = (0.6 + (Math.max(0, Math.min(100, sizeVal)) / 100) * 1.0).toFixed(3);
  document.documentElement.style.setProperty("--hdr-scale", scale);
}

// Click the banner title or subtitle to edit it in place (also editable in
// Header settings). Saves on blur; Enter commits, Escape cancels.
function initBannerInlineEdit() {
  [["banner-title", "hdr_title_text"], ["banner-tagline", "hdr_tagline_text"]].forEach(([id, key]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.inlineEdit) return;
    node.dataset.inlineEdit = "1";
    node.title = "Click to edit";
    node.style.cursor = "text";
    node.addEventListener("click", () => {
      if (node.isContentEditable) return;
      node.contentEditable = "true";
      node.focus();
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(node); sel.removeAllRanges(); sel.addRange(r);
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); node.blur(); }
      if (e.key === "Escape") { node.textContent = hdrGet(key, ""); node.blur(); }
    });
    node.addEventListener("blur", () => {
      node.contentEditable = "false";
      const v = node.textContent.trim();
      if (v && v !== hdrGet(key, "")) saveSetting(key, v);
      else node.textContent = hdrGet(key, key === "hdr_title_text" ? HDR_DEFAULTS.title : HDR_DEFAULTS.tagline);
    });
  });
}
initBannerInlineEdit();

async function saveSetting(key, value) {
  STATE.settings = STATE.settings || {};
  STATE.settings[key] = String(value);
  applyHeaderSettings();
  const body = { key, value: String(value) };
  try {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
  } catch (err) {
    // The server refuses a write that would shrink a substantial JSON blob to a
    // fraction of its size — that's the fingerprint of a bad in-memory state
    // being autosaved. Ask before proceeding; declining leaves the stored copy
    // intact and keeps what's on screen, so nothing is lost either way.
    let info = null;
    try { info = JSON.parse(String(err.message || "")); } catch (e) { info = null; }
    if (info && info.error === "shrink_guard") {
      const kb = (n) => (n / 1024 < 10 ? (n / 1024).toFixed(1) : Math.round(n / 1024)) + " KB";
      const ok = confirm(
        `Tuned In stopped a save that looked wrong.\n\n` +
        `"${info.key}" would shrink from ${kb(info.old_bytes)} to ${kb(info.new_bytes)}.\n\n` +
        `If you just deleted a lot on purpose, click OK to save.\n` +
        `If that's a surprise, click Cancel — nothing has been overwritten, and ` +
        `you can recover earlier versions from Edit \u2192 Data history.`
      );
      if (!ok) {
        console.warn("[settings] shrink guard: save declined for", info.key, info);
        return false;
      }
      try {
        await api("/api/settings", { method: "PATCH", body: JSON.stringify({ ...body, force: true }) });
        return true;
      } catch (e2) { console.error("[settings] forced save failed:", e2); return false; }
    }
    console.error("[settings] save failed:", err);
    return false;
  }
  return true;
}

function openHeaderSettings() {
  closeAllPopovers();
  const pop = el("div", { class: "color-pop floating", style: "min-width:260px;max-height:80vh;overflow:auto" });
  pop.append(el("div", { class: "row-menu-head" }, "Header"));

  // --- Show / hide parts ---
  pop.append(el("div", { style: "font-size:11px;font-weight:700;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.5px;margin:4px 0" }, "Show / hide"));
  HEADER_PARTS.forEach((p) => {
    const id = "hdr_chk_" + p.key;
    const chk = el("input", { type: "checkbox", id });
    chk.checked = headerPartOn(p.key);
    chk.addEventListener("change", () => saveSetting(p.key, chk.checked ? "true" : "false"));
    pop.append(el("label", { for: id, style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:2px 0" },
      chk, el("span", {}, p.label)));
  });

  // --- Size ---
  pop.append(el("div", { style: "font-size:11px;font-weight:700;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;border-top:1px solid var(--off-white);padding-top:8px" }, "Size"));
  const sizeRow = el("div", { style: "display:flex;align-items:center;gap:8px" });
  const sizeSlider = el("input", { type: "range", min: "0", max: "100", step: "1",
    value: hdrGet("hdr_size", "40"), style: "flex:1;cursor:pointer;accent-color:var(--teal)" });
  sizeSlider.addEventListener("input", () => {
    STATE.settings = STATE.settings || {};
    STATE.settings["hdr_size"] = sizeSlider.value;
    applyHeaderSettings();   // live preview
  });
  sizeSlider.addEventListener("change", () => saveSetting("hdr_size", sizeSlider.value));
  sizeRow.append(el("span", { style: "font-size:11px;color:var(--mid-gray)" }, "Small"));
  sizeRow.append(sizeSlider);
  sizeRow.append(el("span", { style: "font-size:11px;color:var(--mid-gray)" }, "Large"));
  pop.append(sizeRow);

  // --- Text ---
  pop.append(el("div", { style: "font-size:11px;font-weight:700;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;border-top:1px solid var(--off-white);padding-top:8px" }, "Text"));
  const titleInp = el("input", { class: "field", style: "width:100%;margin-bottom:6px", value: hdrGet("hdr_title_text", HDR_DEFAULTS.title), placeholder: "Title" });
  titleInp.addEventListener("input", () => saveSetting("hdr_title_text", titleInp.value));
  pop.append(el("div", { style: "font-size:11px;color:var(--mid-gray)" }, "Title"));
  pop.append(titleInp);
  const tagInp = el("input", { class: "field", style: "width:100%;margin-bottom:6px", value: hdrGet("hdr_tagline_text", HDR_DEFAULTS.tagline), placeholder: "Subtitle" });
  tagInp.addEventListener("input", () => saveSetting("hdr_tagline_text", tagInp.value));
  pop.append(el("div", { style: "font-size:11px;color:var(--mid-gray)" }, "Subtitle"));
  pop.append(tagInp);

  // --- Colors ---
  pop.append(el("div", { style: "font-size:11px;font-weight:700;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;border-top:1px solid var(--off-white);padding-top:8px" }, "Colors"));
  const colorRow = (labelText, key, fallback) => {
    const row = el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin:4px 0" });
    row.append(el("span", { style: "font-size:13px" }, labelText));
    const right = el("div", { style: "display:flex;align-items:center;gap:8px" });
    const picker = el("input", { type: "color", class: "color-input", value: hdrGet(key, fallback) });
    picker.addEventListener("input", () => saveSetting(key, picker.value));
    right.append(picker);
    right.append(el("button", { class: "color-reset", onClick: () => { picker.value = fallback; saveSetting(key, fallback); } }, "Reset"));
    row.append(right);
    return row;
  };
  pop.append(colorRow("Background", "hdr_bg_color", HDR_DEFAULTS.bg));
  pop.append(colorRow("Text", "hdr_text_color", HDR_DEFAULTS.text));

  // --- Icon ---
  pop.append(el("div", { style: "font-size:11px;font-weight:700;color:var(--mid-gray);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;border-top:1px solid var(--off-white);padding-top:8px" }, "Icon"));
  const iconRow = el("div", { style: "display:flex;align-items:center;gap:10px" });
  const preview = el("img", { src: hdrGet("hdr_icon_url", HDR_DEFAULTS.icon), style: "width:36px;height:36px;object-fit:contain;border-radius:6px;background:var(--off-white)" });
  iconRow.append(preview);
  const fileInp = el("input", { type: "file", accept: "image/*", style: "display:none" });
  const uploadBtn = el("button", { class: "tool-btn", onClick: () => fileInp.click() }, "Upload image");
  const status = el("span", { style: "font-size:11px;color:var(--mid-gray)" }, "");
  fileInp.addEventListener("change", async () => {
    const file = fileInp.files && fileInp.files[0];
    if (!file) return;
    status.textContent = "Uploading…";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/header/icon", { method: "POST", body: fd }).then((r) => r.json());
      if (resp.ok) {
        STATE.settings = STATE.settings || {};
        STATE.settings["hdr_icon_url"] = resp.url + "?t=" + Date.now(); // cache-bust
        preview.src = STATE.settings["hdr_icon_url"];
        applyHeaderSettings();
        status.textContent = "Updated";
      } else {
        status.textContent = resp.error || "Upload failed";
      }
    } catch (err) {
      console.error("[icon upload]", err);
      status.textContent = "Upload failed";
    }
  });
  iconRow.append(uploadBtn);
  pop.append(iconRow);
  pop.append(fileInp);
  const iconReset = el("div", { style: "display:flex;align-items:center;gap:8px;margin-top:6px" });
  iconReset.append(el("button", { class: "color-reset", onClick: async () => {
    try { await fetch("/api/header/icon", { method: "DELETE" }); } catch (e) {}
    if (STATE.settings) delete STATE.settings["hdr_icon_url"];
    preview.src = HDR_DEFAULTS.icon;
    applyHeaderSettings();
    status.textContent = "Reset to default";
  } }, "Reset to default streetcar"));
  iconReset.append(status);
  pop.append(iconReset);

  const anchor = document.getElementById("btn-edit");
  positionFloatingMenu(pop, anchor, "below-right");
  attachOutsideClose(pop, anchor);
}

// ---------------- Display density popover ----------------
function openDisplay() {
  closeAllPopovers();
  const pop = el("div", { class: "color-pop floating", style: "min-width:240px" });
  pop.append(el("div", { class: "row-menu-head" }, "Display density"));

  let current = getDensity();

  const labelRow = el("div", { style: "display:flex;justify-content:space-between;font-size:11px;color:var(--mid-gray);margin:4px 2px" });
  labelRow.append(el("span", {}, "Compact"));
  labelRow.append(el("span", {}, "Comfortable"));
  pop.append(labelRow);

  const slider = el("input", {
    type: "range", min: "0", max: "100", step: "1", value: String(current),
    style: "width:100%;cursor:pointer;accent-color:var(--teal)",
  });
  pop.append(slider);

  const preview = el("div", { style: "font-size:11px;color:var(--mid-gray);text-align:center;margin-top:6px" }, "");
  const setPreview = (v) => { preview.textContent = `Size ${(0.85 + (v/100)*0.60).toFixed(2)}×`; };
  setPreview(current);
  pop.append(preview);

  // Live-apply while dragging (no save yet — feels responsive)
  slider.addEventListener("input", () => {
    current = Number(slider.value);
    applyDensity(current);
    setPreview(current);
  });
  // Persist when the user releases / commits
  const save = async () => {
    STATE.settings = STATE.settings || {};
    STATE.settings[DENSITY_KEY] = String(current);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: DENSITY_KEY, value: current }) });
    } catch (err) { console.error("[density] save failed:", err); }
  };
  slider.addEventListener("change", save);

  // Reset link
  const resetRow = el("div", { style: "display:flex;justify-content:flex-end;margin-top:8px" });
  resetRow.append(el("button", { class: "color-reset", onClick: async () => {
    current = 40; slider.value = "40"; applyDensity(40); setPreview(40); await save();
  } }, "Reset to default"));
  pop.append(resetRow);

  const anchor = document.getElementById("btn-edit");
  positionFloatingMenu(pop, anchor, "below-right");
  attachOutsideClose(pop, anchor);
}

// ---------------- Export ----------------

/** True on a build whose board lives in this browser rather than on a server.
 *  Both halves matter: the profile says what kind of build this is, RS_LOCAL
 *  says the database actually opened. */
function isLocalBuild() {
  return ((window.PROFILE || {}).storage) === "local" && !!window.RS_LOCAL;
}

/** Whole-board backup — local-first builds only.
 *
 *  A hosted board is backed up on the server; this one exists in this browser
 *  and nowhere else, so getting the file out is the only backup there is. The
 *  .xlsx below is a report rather than a backup: it carries the rows and
 *  columns you pick and none of the automations, groups, schedule, rewards,
 *  images or settings around them, so a board cannot be rebuilt from it. */
function buildBackupSection(body) {
  body.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px" }, "Back up this board"));
  body.append(el("p", { style: "margin-top:0;font-size:13px;color:var(--mid-gray)" },
    "This board lives in this browser and nowhere else. Download a copy to keep it safe, "
    + "or to move it to another browser or device."));

  const row = el("div", { style: "display:flex;gap:8px;margin-bottom:16px" });

  row.append(el("button", { class: "tool-btn accent-teal", onClick: () => {
    try {
      downloadBoardBackup();
    } catch (err) {
      alert("Could not build the backup: " + (err && err.message ? err.message : err));
    }
  } }, "Download backup"));

  // A hidden file input rather than a drop zone: one button to match, and the
  // browser's own picker does the filtering.
  const picker = el("input", {
    type: "file",
    accept: ".sqlite,.db,application/x-sqlite3",
    style: "display:none",
  });
  picker.addEventListener("change", () => {
    const file = picker.files && picker.files[0];
    picker.value = "";   // so choosing the same file twice still fires change
    if (file) restoreBoardBackup(file);
  });
  row.append(el("button", { class: "tool-btn", onClick: () => picker.click() }, "Restore from file"));
  row.append(picker);

  body.append(row);
  buildAutoBackupRow(body);
  body.append(el("div", { style: "border-top:1px solid var(--off-white);margin-bottom:16px" }));
}

/** The automatic half: keep a file on disk up to date without asking again.
 *
 *  Status depends on a permission query and so is asynchronous. The row is
 *  built empty and filled in once the answer arrives, and re-filled after any
 *  action changes it. */
function buildAutoBackupRow(body) {
  const wrap = el("div", { style: "margin-bottom:16px;font-size:13px" });
  body.append(wrap);
  refreshAutoBackupRow(wrap);
}

async function refreshAutoBackupRow(wrap) {
  const b = window.RS_LOCAL.backup;
  wrap.innerHTML = "";

  if (!b.supported()) {
    wrap.append(el("p", { style: "margin:0;color:var(--mid-gray)" },
      "Saving automatically needs Chrome or Edge on a computer. Everywhere else "
      + "Tuned In will remind you instead."));
    return;
  }

  const status = await b.status();
  const line = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" });

  if (status === "connected") {
    line.append(el("span", { style: "color:var(--mid-gray)" },
      "Saving automatically to " + b.fileName()));
    line.append(el("button", { class: "color-reset", onClick: async () => {
      await b.disconnect();
      refreshAutoBackupRow(wrap);
    } }, "Turn off"));
  } else if (status === "needs-permission") {
    // The handle outlived the permission, which is normal after a restart.
    line.append(el("span", { style: "color:var(--mid-gray)" },
      "Saving automatically is paused — your browser needs permission again."));
    line.append(el("button", { class: "tool-btn", onClick: async () => {
      try { await b.resume(); } catch (err) { /* refused; the row will say so */ }
      refreshAutoBackupRow(wrap);
    } }, "Resume"));
  } else {
    line.append(el("button", { class: "tool-btn", onClick: async () => {
      try {
        await b.connect();
      } catch (err) {
        // AbortError just means they closed the file picker.
        if (!err || err.name !== "AbortError") {
          alert("Could not set up automatic saving: " + (err && err.message ? err.message : err));
        }
      }
      refreshAutoBackupRow(wrap);
    } }, "Save automatically"));
    line.append(el("span", { style: "color:var(--mid-gray)" },
      "Choose a file once; Tuned In keeps it up to date."));
  }
  wrap.append(line);
}

// ---------------- Backup reminder ----------------
// Saving automatically only exists on desktop Chrome and Edge. Everywhere else
// the honest fallback is to ask - but only when there is something to save, and
// never while it is already being saved. A prompt that fires when nothing has
// changed is the kind people learn to dismiss without reading, which costs you
// the one time it mattered.

const BACKUP_REMINDER_MS = 60 * 60 * 1000;
let backupReminderTimer = null;

function startBackupReminder() {
  if (!isLocalBuild()) return;
  clearTimeout(backupReminderTimer);
  backupReminderTimer = setTimeout(runBackupReminder, BACKUP_REMINDER_MS);
}

async function runBackupReminder() {
  try {
    const b = window.RS_LOCAL.backup;
    if (b.changedSinceBackup() && (await b.status()) !== "connected") {
      showBackupPrompt();
      return;                 // rescheduled when the card goes away
    }
  } catch (err) {
    /* asking failed; try again next hour rather than giving up */
  }
  startBackupReminder();
}

/** A card in the corner rather than a modal: an hourly dialog across the board
 *  would be closed on reflex, and this one has to still mean something on the
 *  day it matters. */
function showBackupPrompt() {
  if (document.getElementById("backup-prompt")) return;
  const b = window.RS_LOCAL.backup;
  const card = el("div", { id: "backup-prompt", class: "backup-prompt" });
  const close = () => { card.remove(); startBackupReminder(); };

  card.append(el("div", { class: "backup-prompt-title" }, "Save a backup?"));
  card.append(el("p", {},
    "This board only exists in this browser, and it has changes that are not "
    + "saved anywhere else."));

  const row = el("div", { class: "backup-prompt-actions" });
  row.append(el("button", { class: "tool-btn accent-teal", onClick: () => {
    try {
      downloadBoardBackup();
      b.markSaved();
    } catch (err) {
      alert("Could not build the backup: " + (err && err.message ? err.message : err));
    }
    close();
  } }, "Save"));

  if (b.supported()) {
    row.append(el("button", { class: "tool-btn", onClick: async () => {
      try {
        await b.connect();
        close();
      } catch (err) {
        /* cancelled or refused; leave the card up so they can still Save */
      }
    } }, "Save automatically"));
  }

  row.append(el("button", { class: "color-reset", onClick: close }, "Not now"));
  card.append(row);
  document.body.append(card);
}

/** Hand the current board over as a .sqlite file. */
function downloadBoardBackup() {
  const d = new Date();
  const stamp = d.getFullYear()
    + "-" + String(d.getMonth() + 1).padStart(2, "0")
    + "-" + String(d.getDate()).padStart(2, "0");
  const blob = new Blob([window.RS_LOCAL.exportBytes()], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: "tuned-in-board-" + stamp + ".sqlite" });
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking straight away cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Replace this board with a backup file, once the user confirms.
 *
 *  Reloads rather than re-rendering: every view is holding data read from the
 *  outgoing database, and starting clean is simpler and safer than refreshing
 *  each of them in place. */
async function restoreBoardBackup(file) {
  const ok = confirm("Restoring replaces everything on this board with the contents of "
    + file.name + ".\n\nThis cannot be undone. Download a backup first if you want to keep "
    + "the current board.");
  if (!ok) return;
  try {
    await window.RS_LOCAL.importBytes(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    alert(err && err.message ? err.message : String(err));
    return;
  }
  location.reload();
}

function openExport() {
  openModal(isLocalBuild() ? "Export" : "Export to Excel", (body, close) => {
    // On a local-first build the backup is the point of this dialog and the
    // spreadsheet is the sideline, so it goes first and says which is which.
    if (isLocalBuild()) {
      buildBackupSection(body);
      body.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px" }, "Export to Excel"));
    }
    // Build the list of exportable fields: Group (special) + every real column.
    // Each entry: { key, label, get(task) }
    const fields = [
      { key: "__group", label: "Group", get: (t) => t.group_name },
      ...STATE.columns.map((c) => ({
        key: c.id,
        label: c.name,
        get: (t) => {
          const v = t.cells[c.id];
          return v === undefined || v === null ? "" : v;
        },
      })),
    ];

    body.append(el("p", { style: "margin-top:0;font-size:13px;color:var(--mid-gray)" },
      "Choose what to include, then download an .xlsx file you can open in Excel."));

    // --- Scope ---
    body.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px" }, "Rows to export"));
    const scopeWrap = el("div", { style: "display:flex;gap:14px;margin-bottom:16px;font-size:13px" });
    const filteredCount = filteredTasks().length;
    const totalCount = STATE.tasks.length;
    let scope = "all";
    const mkRadio = (val, label) => {
      const id = "scope_" + val;
      const r = el("input", { type: "radio", name: "exp_scope", id, value: val });
      if (val === "all") r.checked = true;
      r.addEventListener("change", () => { if (r.checked) scope = val; });
      const lbl = el("label", { for: id, style: "display:flex;align-items:center;gap:5px;cursor:pointer" }, r, el("span", {}, label));
      return lbl;
    };
    scopeWrap.append(mkRadio("all", `All tasks (${totalCount})`));
    // Only offer "filtered" when a search is active and it actually narrows things
    if (search && filteredCount !== totalCount) {
      scopeWrap.append(mkRadio("filtered", `Current search results (${filteredCount})`));
    }
    body.append(scopeWrap);

    // --- Columns ---
    body.append(el("div", { style: "font-weight:600;font-size:13px;margin-bottom:6px" }, "Columns to include"));
    const colBox = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-bottom:8px" });
    const checks = {};
    fields.forEach((f) => {
      const id = "exp_col_" + f.key;
      const chk = el("input", { type: "checkbox", id });
      chk.checked = true;
      checks[f.key] = chk;
      const lbl = el("label", { for: id, style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px" },
        chk, el("span", {}, f.label));
      colBox.append(lbl);
    });
    body.append(colBox);

    // Select all / none helpers
    const toggles = el("div", { style: "display:flex;gap:10px;margin-bottom:16px;font-size:12px" });
    toggles.append(el("button", { class: "color-reset", onClick: () => fields.forEach((f) => checks[f.key].checked = true) }, "Select all"));
    toggles.append(el("button", { class: "color-reset", onClick: () => fields.forEach((f) => checks[f.key].checked = false) }, "Select none"));
    body.append(toggles);

    // --- Action buttons ---
    const btns = el("div", { style: "display:flex;gap:8px;justify-content:flex-end" });
    btns.append(el("button", { class: "tool-btn", onClick: () => close() }, "Cancel"));
    const dl = el("button", { class: "tool-btn accent-teal", onClick: () => {
      const chosen = fields.filter((f) => checks[f.key].checked);
      if (chosen.length === 0) { alert("Pick at least one column to export."); return; }
      const rows = (scope === "filtered" ? filteredTasks() : STATE.tasks);
      exportXlsx(chosen, rows);
      close();
    } }, "Download .xlsx");
    btns.append(dl);
    body.append(btns);
  });
}

/** Build and download an .xlsx from the chosen fields and rows using SheetJS. */
function exportXlsx(fields, rows) {
  if (typeof XLSX === "undefined") {
    alert("The spreadsheet library didn't load. Try reloading the page.");
    return;
  }
  // Header row + data rows as an array-of-arrays (preserves column order)
  const header = fields.map((f) => f.label);
  const data = rows.map((t) => fields.map((f) => f.get(t)));
  const aoa = [header, ...data];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Reasonable column widths based on content length
  ws["!cols"] = fields.map((f, i) => {
    const maxLen = Math.max(
      f.label.length,
      ...data.map((r) => String(r[i] ?? "").length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 48) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tasks");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `radio-station-${stamp}.xlsx`);
}

// ---------------- Wire up ----------------
document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    try { localStorage.setItem("rs_view", currentView); } catch (e) {}
    if (currentView === "today") { scheduleBlocks = null; todayGridScroll = null; }  // fresh open
    render();
  });
});
$("#search").addEventListener("input", (e) => { search = e.target.value; render(); });
$("#btn-new-task").addEventListener("click", () => addTask("All Active Tasks"));
$("#btn-new-group").addEventListener("click", () => {
  openModal("New Group", (body, close) => {
    body.append(el("p", { style: "margin-top:0;font-size:13px;color:var(--mid-gray)" },
      "Name the new group. It will appear on the board even before you add any tasks."));
    const inp = el("input", { class: "field", placeholder: "Group name", autofocus: "autofocus", style: "width:100%;margin-bottom:12px" });
    const create = async () => {
      const name = (inp.value || "").trim();
      if (!name) { inp.focus(); return; }
      close();
      await api("/api/groups/create", { method: "POST", body: JSON.stringify({ name }) });
      STATE.group_order = STATE.group_order || {};
      if (STATE.group_order[name] == null) {
        const max = Math.max(-1, ...Object.values(STATE.group_order).map(Number));
        STATE.group_order[name] = max + 1;
      }
      await loadState();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); create(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    const btns = el("div", { style: "display:flex;gap:8px;justify-content:flex-end" });
    btns.append(el("button", { class: "tool-btn", onClick: () => close() }, "Cancel"));
    btns.append(el("button", { class: "tool-btn accent-teal", onClick: create }, "Create"));
    body.append(inp);
    body.append(btns);
    // Reliable focus: try immediately, then in the next frame as a fallback
    // (the immediate call usually works; rAF catches any layout/timing edge cases)
    inp.focus();
    requestAnimationFrame(() => { if (document.activeElement !== inp) inp.focus(); });
  });
});
$("#btn-export").addEventListener("click", openExport);
$("#btn-edit").addEventListener("click", openEditMenu);
const _themeBtn = document.getElementById("btn-theme");
if (_themeBtn) _themeBtn.addEventListener("click", toggleTheme);
const _undoBtn = document.getElementById("btn-undo");
if (_undoBtn) _undoBtn.addEventListener("click", doUndo);
const _redoBtn = document.getElementById("btn-redo");
if (_redoBtn) _redoBtn.addEventListener("click", doRedo);
if (typeof updateUndoButtons === "function") updateUndoButtons();
$("#btn-tags").addEventListener("click", openTags);
// Shift-click the Subtasks button toggles whether FINISHED subtasks collapse
// out of the way (on by default). Persisted, so it survives a reload.
$("#btn-toggle-subs").addEventListener("click", (ev) => {
  if (ev.shiftKey) {
    const now = hideDoneSubs() ? "0" : "1";
    STATE.settings.hide_done_subs = now;
    saveSetting("hide_done_subs", now);
    if (now === "1") revealDoneSubs.clear();
    render();
    return;
  }
  // Parents that actually have subtasks
  const parentsWithKids = STATE.tasks
    .filter((t) => !t.parent_id && STATE.tasks.some((s) => s.parent_id === t.id))
    .map((t) => t.id);
  // If any are currently expanded, collapse all; otherwise expand all.
  const anyExpanded = parentsWithKids.some((id) => expandedParents.has(id));
  // (shift-click handled above: toggles hiding of finished subtasks)
  if (anyExpanded) {
    parentsWithKids.forEach((id) => expandedParents.delete(id));
  } else {
    parentsWithKids.forEach((id) => expandedParents.add(id));
  }
  render();
});

// Collapse/expand every Pillar & Idea cell at once. A global action, so it also
// clears any per-cell overrides. Persists across reloads via settings.
function updateCollapseGoalsBtn() {
  const b = document.getElementById("btn-collapse-goals");
  if (!b) return;
  b.classList.toggle("active", goalCellsCollapsed);
  b.textContent = goalCellsCollapsed ? "⊞ Values/Goal" : "⊟ Values/Goal";
  b.title = goalCellsCollapsed
    ? "Pillar & Idea cells are collapsed to one line. Click to expand all (a cell's ▸ caret expands just that one)."
    : "Collapse the Pillar & Idea cells to one line each to shrink row height (a cell's ▾ caret collapses just that one).";
}
$("#btn-collapse-goals").addEventListener("click", () => {
  goalCellsCollapsed = !goalCellsCollapsed;
  goalCellOverrides.clear();   // global action wins — drop per-cell overrides
  saveSetting("goal_collapsed", goalCellsCollapsed ? "true" : "false");
  updateCollapseGoalsBtn();
  if (currentView !== "table") setView("table");
  else render();
});

// ---------------- Focus countdown timer (top bar, shared across all tabs) ----------------
// Adjustable duration (default 2 min) with Start / Pause / Reset. When it hits
// zero, the page flashes red a few times (no sound) and the timer returns to idle
// showing 00:00 until Start or Reset is pressed. The bar lives outside #board, so
// it persists when switching tabs (render() only redraws the board).
const FT = { durationSec: 120, remainingMs: 120000, state: "idle", endAt: 0, raf: null };

function ftLoadDuration() {
  let mins = 2;
  try { const v = parseFloat(localStorage.getItem("rs_timer_minutes")); if (!isNaN(v) && v > 0) mins = v; } catch (e) {}
  FT.durationSec = Math.max(1, Math.round(mins * 60));
  FT.remainingMs = FT.durationSec * 1000;
}
function ftFmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function ftRender() {
  const out = document.getElementById("ft-readout");
  if (out) {
    out.textContent = ftFmt(FT.remainingMs);
    out.classList.toggle("low", FT.state === "running" && FT.remainingMs <= 10000);
  }
  const startBtn = document.getElementById("ft-start");
  const pauseBtn = document.getElementById("ft-pause");
  const minInp = document.getElementById("ft-minutes");
  const bar = document.getElementById("focus-timer-bar");
  if (startBtn) {
    const lab = document.getElementById("ft-start-lab");
    if (lab) lab.textContent = FT.state === "paused" ? "Resume" : "Start";
    else startBtn.textContent = FT.state === "paused" ? "▶ Resume" : "▶ Start"; // pre-update HTML fallback
    startBtn.disabled = FT.state === "running";
  }
  if (pauseBtn) pauseBtn.disabled = FT.state !== "running";
  if (minInp) minInp.disabled = FT.state === "running";
  if (bar) bar.classList.toggle("running", FT.state === "running");
}
function ftTick() {
  if (FT.state !== "running") return;
  FT.remainingMs = FT.endAt - performance.now();
  if (FT.remainingMs <= 0) {
    FT.remainingMs = 0;
    FT.state = "idle";
    cancelAnimationFrame(FT.raf);
    ftRender();
    flashPageRed();
    return;
  }
  ftRender();
  FT.raf = requestAnimationFrame(ftTick);
}
function ftStart() {
  if (FT.state === "running") return;
  if (FT.remainingMs <= 0) FT.remainingMs = FT.durationSec * 1000; // restart after finishing
  FT.endAt = performance.now() + FT.remainingMs;
  FT.state = "running";
  ftRender();
  cancelAnimationFrame(FT.raf);
  FT.raf = requestAnimationFrame(ftTick);
}
function ftPause() {
  if (FT.state !== "running") return;
  FT.remainingMs = FT.endAt - performance.now();
  FT.state = "paused";
  cancelAnimationFrame(FT.raf);
  ftRender();
}
function ftReset() {
  FT.state = "idle";
  cancelAnimationFrame(FT.raf);
  FT.remainingMs = FT.durationSec * 1000;
  ftRender();
}
function ftSetMinutes(mins) {
  const v = parseFloat(mins);
  if (isNaN(v) || v <= 0) return;
  FT.durationSec = Math.max(1, Math.round(v * 60));
  try { localStorage.setItem("rs_timer_minutes", String(v)); } catch (e) {}
  if (FT.state === "idle") { FT.remainingMs = FT.durationSec * 1000; ftRender(); }
}
function flashPageRed() {
  const old = document.getElementById("ft-flash");
  if (old) old.remove();
  const ov = document.createElement("div");
  ov.id = "ft-flash";
  ov.className = "ft-flash";
  document.body.appendChild(ov);
  ov.addEventListener("animationend", () => ov.remove());
  setTimeout(() => { if (ov.parentElement) ov.remove(); }, 2500); // safety net
}
function initFocusTimer() {
  ftLoadDuration();
  const startBtn = document.getElementById("ft-start");
  const pauseBtn = document.getElementById("ft-pause");
  const resetBtn = document.getElementById("ft-reset");
  const minInp = document.getElementById("ft-minutes");
  if (!startBtn) return; // bar not present (defensive)
  if (minInp) {
    minInp.value = String(FT.durationSec / 60);
    minInp.addEventListener("change", () => ftSetMinutes(minInp.value));
  }
  startBtn.addEventListener("click", ftStart);
  if (pauseBtn) pauseBtn.addEventListener("click", ftPause);
  if (resetBtn) resetBtn.addEventListener("click", ftReset);
  ftRender();
}
initFocusTimer();

$("#btn-sort").addEventListener("click", async () => {
  // Composite sort: completed tasks sink to the bottom, then by priority.
  // Applies to subtasks among their siblings too. Works even without a priority
  // column (then it's purely Done-to-the-bottom). One-time arrangement — you can
  // still drag rows afterward and those drags persist.
  const groups = {};
  STATE.tasks.forEach((t) => { (groups[t.group_name] = groups[t.group_name] || []).push(t); });
  const newOrder = [];
  Object.values(groups).forEach((arr) => {
    arr.sort(taskSortCompare);
    arr.forEach((t) => newOrder.push(t.id));
  });
  // Reassign positions in memory so the immediate re-render reflects it
  newOrder.forEach((id, i) => { const t = STATE.tasks.find((x) => x.id === id); if (t) t.position = i; });
  STATE.tasks.sort((a, b) => a.position - b.position);
  await api("/api/tasks/reorder", { method: "PATCH", body: JSON.stringify({ order: newOrder }) });
  if (currentView !== "table") {
    currentView = "table";
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === "table"));
  }
  render();
});

// ---------------- View + bulk helpers (used by buttons and shortcuts) ----------------
function setView(view) {
  // A shortcut, a stale rs_view or cycleView could all name a view this
  // build dropped; sending the user nowhere is worse than ignoring it.
  if (typeof profileHasView === "function" && !profileHasView(view)) return;
  currentView = view;
  try { localStorage.setItem("rs_view", view); } catch (e) {}
  if (view === "today") { scheduleBlocks = null; todayGridScroll = null; }
  document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  render();
}
function cycleView() {
  // "calendar" was once a view of its own. It is now the Day Plan's month
  // subview and has no branch in render(), so cycling onto it left the board
  // blank — it is out of the rotation. Views this build does not ship are
  // skipped, and a currentView outside the list (Goals, say) starts at the top.
  const all = ["table", "kanban", "today", "matrix", "rewards"];
  const order = typeof profileHasView === "function" ? all.filter((v) => profileHasView(v)) : all;
  if (!order.length) return;
  setView(order[(order.indexOf(currentView) + 1) % order.length]);
}
function toggleAllSubtasks() { $("#btn-toggle-subs").click(); }
function runSortByPriority() { $("#btn-sort").click(); }
function newTaskShortcut() { addTask("All Active Tasks"); }
function newGroupShortcut() { $("#btn-new-group").click(); }
function focusSearch() { const s = $("#search"); s.focus(); s.select(); }
function clearSearch() { const s = $("#search"); if (s.value) { s.value = ""; search = ""; render(); } }
function setAllGroupsCollapsed(collapsed) {
  const names = new Set(STATE.tasks.filter((t) => !t.parent_id).map((t) => t.group_name));
  collapsedGroups.clear();
  if (collapsed) names.forEach((n) => collapsedGroups.add(n));
  render();
}
function bumpDensity(delta) {
  const v = Math.max(0, Math.min(100, getDensity() + delta));
  STATE.settings = STATE.settings || {};
  STATE.settings[DENSITY_KEY] = String(v);
  applyDensity(v);
  api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: DENSITY_KEY, value: v }) }).catch(() => {});
}

// ---------------- Keyboard shortcuts ----------------
const SHORTCUTS = [
  { id: "undo",        combo: "Ctrl+Z",        label: "Undo",                        run: doUndo,                    ctrl: true,  key: "z" },
  { id: "redo",        combo: "Ctrl+Y",        label: "Redo",                        run: doRedo,                    ctrl: true,  key: "y" },
  { id: "redo_alt",    combo: "Ctrl+Shift+Z",  label: "Redo (alternate)",            run: doRedo,                    ctrl: true,  shift: true, key: "z" },
  { id: "new_task",    combo: "N",             label: "New task",                    run: newTaskShortcut,           key: "n" },
  { id: "new_group",   combo: "Shift+N",       label: "New group",                   run: newGroupShortcut,          shift: true, key: "n" },
  { id: "search",      combo: "/",             label: "Focus search",                run: focusSearch,               key: "/" },
  { id: "clear_search",combo: "Esc",           label: "Close menus / clear search",  run: () => {
      // Priority: close an open popover or modal first; only clear the search
      // box if nothing was open to dismiss.
      const hadPopover = document.querySelector(".row-menu, .pill-menu, .color-pop");
      if (hadPopover) { closeAllPopovers(); return; }
      if (closeTopModal()) return;
      clearSearch();
    }, key: "escape", whenTyping: true },
  { id: "view_table",  combo: "1",             label: "List view",                   run: () => setView("table"),    key: "1" },
  { id: "view_kanban", combo: "2",             label: "Kanban view",                 run: () => setView("kanban"),   key: "2" },
  { id: "view_cal",    combo: "3",             label: "Calendar view",               run: () => { setView("today"); todaySub = "month"; render(); }, key: "3" },
  { id: "cycle_view",  combo: "V",             label: "Cycle through views",         run: cycleView,                 key: "v" },
  { id: "edit_menu",   combo: "E",             label: "Open Edit menu",              run: openEditMenu,              key: "e" },
  { id: "columns",     combo: "C",             label: "Open Columns",                run: openColumns,               key: "c" },
  { id: "automations", combo: "A",             label: "Open Automations",            run: openAutomations,           key: "a" },
  { id: "tags",        combo: "T",             label: "Open Edit Tags",                   run: openTags,                  key: "t" },
  { id: "display",     combo: "D",             label: "Open Display",                run: openDisplay,               key: "d" },
  { id: "header",      combo: "H",             label: "Open Header settings",        run: openHeaderSettings,        key: "h" },
  { id: "export",      combo: "X",             label: "Export to Excel",             run: openExport,                key: "x" },
  { id: "sort_prio",   combo: "P",             label: "Sort by priority",            run: runSortByPriority,         key: "p" },
  { id: "toggle_subs", combo: "B",             label: "Collapse/expand all subtasks",run: toggleAllSubtasks,         key: "b" },
  { id: "collapse_groups", combo: "K",         label: "Collapse all groups",         run: () => setAllGroupsCollapsed(true),  key: "k" },
  { id: "expand_groups",   combo: "Shift+K",   label: "Expand all groups",           run: () => setAllGroupsCollapsed(false), shift: true, key: "k" },
  { id: "density_up",  combo: "=",             label: "Increase density (bigger)",   run: () => bumpDensity(10),     key: "=" },
  { id: "density_down",combo: "-",             label: "Decrease density (smaller)",  run: () => bumpDensity(-10),    key: "-" },
  { id: "help",        combo: "?",             label: "Show shortcuts help",         run: () => openShortcuts(),     key: "?" },
];
function shortcutOn(id) {
  const v = STATE.settings && STATE.settings["sc_" + id];
  if (v == null) return true;  // enabled by default
  return String(v).toLowerCase() !== "false";
}
// True while the user is actively in any editable field on the page. We track
// this with focus events (more reliable than checking activeElement at keydown,
// which can momentarily be <body> during re-renders) so single-key shortcuts
// never fire while editing a cell or filling a form.
let editingActive = false;
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (!t) return;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) editingActive = true;
});
document.addEventListener("focusout", (e) => {
  // Defer: focus may be moving to another field; re-check on the next tick.
  setTimeout(() => {
    const a = document.activeElement;
    const tag = a && a.tagName;
    editingActive = !!(a && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable));
  }, 0);
});

function typingInField() {
  if (editingActive) return true;
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable;
}
document.addEventListener("keydown", (e) => {
  const key = (e.key || "").toLowerCase();
  for (const sc of SHORTCUTS) {
    if (!!sc.ctrl !== (e.ctrlKey || e.metaKey)) continue;
    if (!!sc.shift !== e.shiftKey) continue;
    if (sc.key !== key) continue;
    if (!shortcutOn(sc.id)) continue;
    // While typing in a field: only Esc (whenTyping) is allowed; let native
    // Ctrl+Z/Y handle text editing, and don't fire letter/number shortcuts.
    if (typingInField()) {
      if (sc.whenTyping) { /* allow Esc */ }
      else continue;
    }
    e.preventDefault();
    sc.run();
    return;
  }
});

// Shortcuts panel: list all, toggle each, persisted.
function openShortcuts() {
  closeAllPopovers();
  openModal("Keyboard shortcuts", (body) => {
    body.append(el("p", { style: "margin-top:0;font-size:13px;color:var(--mid-gray)" },
      "Toggle any shortcut on or off. Shortcuts only fire when you're not editing a cell or field — they stay out of your way while you type. (Esc still works while editing, to cancel.)"));
    const list = el("div", { style: "display:flex;flex-direction:column;gap:2px;max-height:55vh;overflow:auto" });
    SHORTCUTS.forEach((sc) => {
      const rowId = "sc_chk_" + sc.id;
      const chk = el("input", { type: "checkbox", id: rowId });
      chk.checked = shortcutOn(sc.id);
      chk.addEventListener("change", () => saveSetting("sc_" + sc.id, chk.checked ? "true" : "false"));
      const row = el("label", { for: rowId, style: "display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--off-white);cursor:pointer;font-size:13px" });
      row.append(chk);
      row.append(el("kbd", { class: "sc-key" }, sc.combo));
      row.append(el("span", { style: "flex:1" }, sc.label));
      list.append(row);
    });
    body.append(list);
  });
}

// Reflect the restored view (from localStorage) on the toolbar buttons at startup.
document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));

// ---------------- Draggable tab order ----------------
// Drag a view tab onto another to reorder; the order persists (settings key
// "tab_order") and is applied on every load.
let tabDragState = null;
function applyTabOrder() {
  const saved = STATE.settings && STATE.settings["tab_order"];
  if (!saved) return;
  let order;
  try { order = JSON.parse(saved); } catch (e) { return; }
  if (!Array.isArray(order) || !order.length) return;
  const anchor = document.getElementById("points-badge");
  const parent = anchor && anchor.parentElement;
  if (!parent) return;
  order.forEach((v) => {
    const b = parent.querySelector(`.view-btn[data-view="${v}"]`);
    if (b) parent.insertBefore(b, anchor);
  });
}
function saveTabOrder() {
  const order = [...document.querySelectorAll(".view-btn")].map((b) => b.dataset.view);
  saveSetting("tab_order", JSON.stringify(order));
}
document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.setAttribute("draggable", "true");
  btn.addEventListener("dragstart", (e) => {
    tabDragState = { view: btn.dataset.view };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "tab:" + btn.dataset.view);
    btn.classList.add("tab-dragging");
  });
  btn.addEventListener("dragend", () => {
    btn.classList.remove("tab-dragging");
    document.querySelectorAll(".tab-drop-before, .tab-drop-after").forEach((b) =>
      b.classList.remove("tab-drop-before", "tab-drop-after"));
    tabDragState = null;
  });
  btn.addEventListener("dragover", (e) => {
    if (!tabDragState || tabDragState.view === btn.dataset.view) return;
    e.preventDefault();
    const r = btn.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    btn.classList.toggle("tab-drop-after", after);
    btn.classList.toggle("tab-drop-before", !after);
  });
  btn.addEventListener("dragleave", () => btn.classList.remove("tab-drop-before", "tab-drop-after"));
  btn.addEventListener("drop", (e) => {
    if (!tabDragState || tabDragState.view === btn.dataset.view) return;
    e.preventDefault();
    const moved = document.querySelector(`.view-btn[data-view="${tabDragState.view}"]`);
    const r = btn.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    if (after) btn.after(moved); else btn.before(moved);
    btn.classList.remove("tab-drop-before", "tab-drop-after");
    tabDragState = null;
    saveTabOrder();
  });
});

// Alarm on/off toggle (persisted in settings). Turning it on also asks the
// browser for notification permission so system banners can show too.
const alarmBtn = document.getElementById("alarm-toggle");
if (alarmBtn) {
  alarmBtn.addEventListener("click", async () => {
    const next = alarmEnabled() ? "off" : "on";
    STATE.settings = STATE.settings || {};
    STATE.settings["timer_alarm"] = next;
    updateAlarmToggle();
    saveSetting("timer_alarm", next);
    if (next === "on") {
      playAlarmBeep();   // user gesture: unlocks audio and confirms it's audible
      try {
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      } catch (e) {}
    }
  });
}

// ---------------- Profile ----------------
// One codebase, two deployments: the personal build and the one handed out.
// They differ in which parts of the app exist and what it looks like, not in
// behaviour, so the difference is data — see profiles/ and
// scripts/build-profile.mjs. A missing profile means "everything, unskinned",
// which is what running from source without a build step should do.
function profileGet() {
  return (typeof window !== "undefined" && window.PROFILE) || {};
}

/** Is this view part of the current build? */
function profileHasView(view) {
  const list = profileGet().views;
  if (!Array.isArray(list)) return true;          // null/absent = keep them all
  return list.includes(view);
}

/** Remove the tabs this build doesn't ship, re-skin, and set branding
 *  defaults. Called from loadState before the first render, so nothing the
 *  profile drops is ever painted. */
function applyProfile() {
  const p = profileGet();

  // Colours first: they are just overrides on :root, so the whole stylesheet
  // and both themes follow without any rule being duplicated.
  const tokens = p.tokens || {};
  Object.keys(tokens).forEach((k) => document.documentElement.style.setProperty(k, tokens[k]));

  // Views are removed rather than hidden, so nothing can tab to them, and the
  // points badge goes with Rewards because a balance means nothing without it.
  if (Array.isArray(p.views)) {
    document.querySelectorAll(".view-btn").forEach((b) => {
      if (!p.views.includes(b.dataset.view)) b.remove();
    });
    if (!p.views.includes("rewards")) {
      const pts = document.getElementById("points-badge");
      if (pts) pts.remove();
    }
    // A saved rs_view, a keyboard shortcut, or cycleView could all still point
    // at a view this build dropped. Fall back to the first one that exists.
    if (!profileHasView(currentView)) {
      currentView = p.views[0] || "table";
      try { localStorage.setItem("rs_view", currentView); } catch (e) {}
      document.querySelectorAll(".view-btn").forEach(
        (b) => b.classList.toggle("active", b.dataset.view === currentView));
    }
  }

  // Branding defaults. Anything set in the app is a saved setting and wins, so
  // this only fills in what the user has never touched.
  const brand = p.branding || {};
  if (typeof HDR_DEFAULTS === "object" && HDR_DEFAULTS) {
    if (brand.title) HDR_DEFAULTS.title = brand.title;
    if (brand.tagline !== undefined) HDR_DEFAULTS.tagline = brand.tagline;
    if (brand.icon) HDR_DEFAULTS.icon = brand.icon;
  }
}

// Run as soon as this file loads rather than from loadState: the profile
// decides what the chrome looks like, and that must hold even if the API never
// answers. Idempotent, so the call in loadState's place is not missed.
applyProfile();
