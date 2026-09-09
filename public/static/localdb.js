/* Tuned In — the board, in your browser.
 *
 * A local-first build keeps everything on the device: no account, no server
 * holding your data, nothing shared with anyone else who opens the same URL.
 *
 * The trick is that it reuses the real API rather than reimplementing it. The
 * Worker touches its database through only six methods — prepare, bind, first,
 * all, run and batch — so this file provides those over a SQLite compiled to
 * WebAssembly, hands it to the same route handlers in src/, and intercepts
 * fetch("/api/...") to call them. One implementation of the API, two places it
 * can run. The alternative was a second copy of every endpoint, which is the
 * thing that rots.
 *
 * Storage: SQLite lives in memory and is serialised to IndexedDB after writes,
 * debounced. That is durable across reloads and restarts, and it is per-browser
 * — clearing site data erases it, and there is no sync to another device. The
 * app says so on first run rather than letting anyone assume otherwise.
 */
(function () {
  "use strict";

  const DB_NAME = "tuned-in-local";
  const STORE = "kv";
  const KEY = "sqlite";
  const SAVE_DEBOUNCE_MS = 400;

  const NATIVE_FETCH = window.fetch.bind(window);
  window.RS_NATIVE_FETCH = NATIVE_FETCH;

  // ------------------------------------------------------------------ IndexedDB
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbPut(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ------------------------------------------------------------------ D1 shim
  // D1's shapes, exactly: prepare().bind().first()/.all()/.run(), plus
  // db.batch(). Anything the handlers rely on has to look the same here or the
  // shared code would need to know which runtime it is in — which is the
  // coupling this whole file exists to avoid.
  class LocalStatement {
    constructor(owner, sql) {
      this.owner = owner;
      this.sql = sql;
      this.params = [];
    }

    bind(...params) {
      const s = new LocalStatement(this.owner, this.sql);
      // undefined is not a SQLite value; D1 treats a missing bind as NULL.
      s.params = params.map((p) => (p === undefined ? null : p));
      return s;
    }

    _rows() {
      const out = [];
      const stmt = this.owner.db.prepare(this.sql);
      try {
        stmt.bind(this.params);
        while (stmt.step()) out.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return out;
    }

    async all() {
      const results = this.owner.readonly(this.sql) ? this._rows() : this.owner.exec(this);
      return { results: results || [], success: true, meta: {} };
    }

    async first(column) {
      const rows = this.owner.readonly(this.sql) ? this._rows() : this.owner.exec(this);
      const row = rows && rows.length ? rows[0] : null;
      if (!row) return null;
      return column === undefined ? row : row[column];
    }

    async run() {
      const rows = this.owner.exec(this);
      return { success: true, results: rows || [], meta: { changes: this.owner.db.getRowsModified() } };
    }
  }

  class LocalD1 {
    constructor(db) {
      this.db = db;
      this.dirty = false;
      this._saveTimer = null;
    }

    prepare(sql) { return new LocalStatement(this, sql); }

    /** Statements that only read. RETURNING makes a write produce rows too, so
     *  it is deliberately excluded here and handled by exec(). */
    readonly(sql) {
      return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
    }

    /** Run a writing statement, collecting any RETURNING rows. */
    exec(stmt) {
      const out = [];
      const s = this.db.prepare(stmt.sql);
      try {
        s.bind(stmt.params);
        while (s.step()) out.push(s.getAsObject());
      } finally {
        s.free();
      }
      this.touch();
      return out;
    }

    /** D1 batches are atomic; SQLite gives that with a transaction. */
    async batch(statements) {
      const results = [];
      this.db.exec("BEGIN");
      try {
        for (const st of statements) {
          const rows = this.readonly(st.sql) ? st._rows() : this.exec(st);
          results.push({ success: true, results: rows || [], meta: {} });
        }
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
      this.touch();
      return results;
    }

    /** Serialising the whole database on every write would be wasteful, and
     *  doing it never would lose work. Debounced, plus a flush on page hide so
     *  a close mid-timer still persists. */
    touch() {
      this.dirty = true;
      changedSinceBackup = true;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
      scheduleAutoBackup(this);
    }

    async save() {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        await idbPut(KEY, this.db.export());
      } catch (err) {
        this.dirty = true;
        console.error("[local] could not save the board:", err);
      }
    }
  }

  // ------------------------------------------------------------------ boot
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("could not load " + src));
      document.head.append(s);
    });
  }

  let SQLJS = null;

  async function loadSqlJs() {
    // Vendored rather than fetched from a CDN, so a local-first build has
    // nothing to reach the network for. Loaded on demand: a server build never
    // pays for the 640 KB of WebAssembly. Cached because a restore opens the
    // incoming file to check it before committing to it.
    if (SQLJS) return SQLJS;
    if (!window.initSqlJs) await loadScript("/static/vendor/sql-wasm.js");
    SQLJS = await window.initSqlJs({ locateFile: (f) => "/static/vendor/" + f });
    return SQLJS;
  }

  async function open() {
    const SQL = await loadSqlJs();
    const saved = await idbGet(KEY);
    const db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    const fresh = !saved;
    if (fresh) {
      // The same migrations the Worker applies, generated into
      // public/static/migrations.js by scripts/build-profile.mjs so both
      // runtimes create identical schemas from one source.
      if (!window.RS_MIGRATIONS) await loadScript("/static/migrations.js");
      for (const sql of (window.RS_MIGRATIONS || [])) db.exec(sql);
    }
    return { db, fresh };
  }

  // ------------------------------------------------------------------ backup
  // The board is a SQLite file and nothing else, so a backup is that file
  // verbatim rather than a re-export through the API. That matters: a rebuilt
  // export can only carry what whoever wrote it remembered to include, and
  // silently loses the rest. Bytes out, bytes back in — a restore is exactly
  // what was there.

  const SQLITE_MAGIC = "SQLite format 3";
  // Enough of the schema to tell a Tuned In board from any other SQLite file,
  // so a restore refuses up front instead of leaving someone on a blank board.
  const REQUIRED_TABLES = ["tasks", "columns", "settings"];

  function looksLikeSqlite(bytes) {
    // Every SQLite file opens with the magic string and a terminating NUL.
    if (!bytes || bytes.length < 16 || bytes[15] !== 0) return false;
    for (let i = 0; i < SQLITE_MAGIC.length; i++) {
      if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
    }
    return true;
  }

  function tableNames(db) {
    const names = [];
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'");
    try {
      while (stmt.step()) names.push(stmt.getAsObject().name);
    } finally {
      stmt.free();
    }
    return names;
  }

  /** SQLite's own verdict on whether the file is internally consistent. Worth
   *  the pass: a restored file becomes someone's only copy of their board, and
   *  half-written downloads are the common way that goes wrong. */
  function integrityOk(db) {
    const stmt = db.prepare("PRAGMA integrity_check");
    try {
      if (!stmt.step()) return false;
      const row = stmt.getAsObject();
      return row[Object.keys(row)[0]] === "ok";
    } finally {
      stmt.free();
    }
  }

  /** Replace this browser's board with the contents of a backup file.
   *
   *  Checks the file before touching anything, so a wrong pick fails with an
   *  explanation and the existing board is still there. The caller reloads once
   *  this resolves — the running page holds the outgoing database in memory and
   *  every view has already rendered from it. */
  async function importBytes(local, bytes) {
    if (!looksLikeSqlite(bytes)) {
      throw new Error("That does not look like a Tuned In backup. Choose the .sqlite file you downloaded.");
    }
    const SQL = await loadSqlJs();
    let candidate;
    try {
      candidate = new SQL.Database(bytes);
    } catch (err) {
      throw new Error("That backup file is damaged and could not be opened.");
    }
    // Damage does not show up when the file is opened — sql.js reads lazily, so
    // a truncated backup opens cleanly and only fails on the first real read.
    // Both checks below are therefore where corruption actually surfaces, and
    // SQLite's own wording ("database disk image is malformed") is not much use
    // to someone who just picked the wrong file.
    let present;
    try {
      present = tableNames(candidate);
      if (!integrityOk(candidate)) {
        throw new Error("That backup file is damaged and could not be read.");
      }
    } catch (err) {
      throw new Error("That backup file is damaged and could not be read.");
    } finally {
      candidate.close();
    }
    const missing = REQUIRED_TABLES.filter((t) => !present.includes(t));
    if (missing.length) {
      throw new Error("That file is a database, but not a Tuned In board.");
    }
    // A debounced save still pending from the outgoing board would land on top
    // of what we are about to write. Cancel it, and mark clean so the flush on
    // pagehide during the reload does not resurrect it either.
    clearTimeout(local._saveTimer);
    local.dirty = false;
    await idbPut(KEY, bytes);
  }

  // ------------------------------------------------------ backup to a real file
  // Browsers do not let a page write to disk unprompted, and rightly so. The
  // File System Access API is the one way round that is not a trick: the person
  // picks a file once, and from then on the page may keep writing to that exact
  // file with no further clicks. It turns "remember to export" into something
  // that actually happens.
  //
  // Chrome and Edge on the desktop support it. Firefox, Safari and every phone
  // browser do not, which is why shell.js still carries a reminder for everyone
  // else - see startBackupReminder there.
  //
  // The permission does not survive a browser restart. The handle does, but it
  // comes back needing permission again, and asking for it requires a click -
  // hence three states rather than two: off, connected, needs-permission.

  const HANDLE_KEY = "backup-file-handle";
  const AUTO_WRITE_DEBOUNCE_MS = 60000;

  let backupHandle = null;
  let changedSinceBackup = false;
  let autoWriteTimer = null;

  function fsaSupported() {
    return typeof window.showSaveFilePicker === "function";
  }

  /** What we are allowed to do with the chosen file. Requesting rather than
   *  only checking needs a user gesture, so the caller says which it wants. */
  async function handlePermission(handle, request) {
    if (!handle || typeof handle.queryPermission !== "function") return "granted";
    const opts = { mode: "readwrite" };
    let state = await handle.queryPermission(opts);
    if (state !== "granted" && request) state = await handle.requestPermission(opts);
    return state;
  }

  async function autoBackupStatus() {
    if (!backupHandle) return "off";
    return (await handlePermission(backupHandle, false)) === "granted"
      ? "connected"
      : "needs-permission";
  }

  /** Overwrite the chosen file with the board as it stands. */
  async function writeBackupNow(local) {
    if (!backupHandle) return false;
    if ((await handlePermission(backupHandle, false)) !== "granted") return false;
    const writable = await backupHandle.createWritable();
    try {
      await writable.write(local.db.export());
    } finally {
      await writable.close();
    }
    changedSinceBackup = false;
    return true;
  }

  /** Debounced, so a burst of edits produces one write rather than dozens. */
  function scheduleAutoBackup(local) {
    if (!backupHandle) return;
    clearTimeout(autoWriteTimer);
    autoWriteTimer = setTimeout(() => {
      writeBackupNow(local).catch((err) => console.warn("[local] auto-backup failed:", err));
    }, AUTO_WRITE_DEBOUNCE_MS);
  }

  async function connectAutoBackup(local) {
    const handle = await window.showSaveFilePicker({
      suggestedName: backupFileName(),
      types: [{
        description: "Tuned In backup",
        accept: { "application/x-sqlite3": [".sqlite"] },
      }],
    });
    backupHandle = handle;
    await idbPut(HANDLE_KEY, handle);
    await writeBackupNow(local);
    return handle.name;
  }

  /** Re-grant permission after a browser restart. Must run from a click. */
  async function resumeAutoBackup(local) {
    if (!backupHandle) return "off";
    if ((await handlePermission(backupHandle, true)) !== "granted") return "needs-permission";
    await writeBackupNow(local);
    return "connected";
  }

  async function disconnectAutoBackup() {
    backupHandle = null;
    clearTimeout(autoWriteTimer);
    await idbPut(HANDLE_KEY, null);
  }

  /** The name a fresh backup gets, dated in local time so a folder of them
   *  sorts the way anyone would expect. */
  function backupFileName() {
    const d = new Date();
    return "tuned-in-board-" + d.getFullYear()
      + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0") + ".sqlite";
  }

  // A server build has a real API behind it and must not be touched. The
  // profile decides, and this file costs it one no-op.
  if (((window.PROFILE || {}).storage) !== "local") return;

  const readyPromise = (async () => {
    const { db, fresh } = await open();
    const local = new LocalD1(db);
    if (fresh) await local.save();

    // The env the shared handlers expect. TZ matches the Worker's var; here it
    // comes from the browser so "today" is the user's today wherever they are.
    const env = {
      DB: local,
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };

    // A file chosen on an earlier visit. The handle survives; permission to
    // write through it usually does not, which shell.js surfaces as something
    // to resume rather than silently doing nothing.
    try {
      backupHandle = (await idbGet(HANDLE_KEY)) || null;
    } catch (err) {
      backupHandle = null;
    }

    const { handleApiRequest } = await import("/static/api/index.js");
    const { serveUpload } = await import("/static/api/extras.js");

    // Everything the app does goes through fetch(), so intercepting it is the
    // whole integration — no view's code changes at all. Two path families are
    // ours: the API, and the images. Uploads are rows in this database, not
    // files on a server, exactly as they are rows in D1 on the hosted build —
    // so the same paths have to be answered here or every note photo and the
    // header icon would 404 against a server that does not have them.
    const UPLOAD_PREFIX = "/static/uploads/";
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];

      if (path.startsWith("/api/")) {
        return handleApiRequest(new Request(new URL(url, location.origin), init), env);
      }
      if (path.startsWith(UPLOAD_PREFIX)) {
        return serveUpload(env, decodeURIComponent(path.slice(UPLOAD_PREFIX.length)));
      }
      if (path === "/static/zen_backdrop.png") {
        return serveUpload(env, "zen_backdrop.png");
      }
      return NATIVE_FETCH(input, init);
    };

    // A close or a tab switch should not lose the last few hundred ms of work.
    addEventListener("visibilitychange", () => { if (document.hidden) local.save(); });
    addEventListener("pagehide", () => local.save());

    window.RS_LOCAL = {
      db: local,
      env,
      fresh,
      // The whole board as a SQLite file, and the way back in. shell.js builds
      // the download button and the file picker on top of these.
      exportBytes: () => local.db.export(),
      importBytes: (bytes) => importBytes(local, bytes),
      backupFileName,

      // Writing the board straight to a file picked once. shell.js builds the
      // buttons; everything that touches the database stays here.
      backup: {
        supported: fsaSupported,
        status: autoBackupStatus,
        fileName: () => (backupHandle ? backupHandle.name : null),
        connect: () => connectAutoBackup(local),
        resume: () => resumeAutoBackup(local),
        disconnect: disconnectAutoBackup,
        writeNow: () => writeBackupNow(local),
        changedSinceBackup: () => changedSinceBackup,
        markSaved: () => { changedSinceBackup = false; },
      },
    };
    return window.RS_LOCAL;
  })();

  // boot.js waits on this before its first load, so nothing calls the API
  // before there is a database behind it.
  window.RS_LOCAL_READY = readyPromise;
})();
