-- Tuned In — D1 schema.
--
-- A direct port of the CREATE TABLE statements in init_db() (legacy app.py),
-- with every later ALTER TABLE migration already folded in, so a fresh D1
-- database starts at the shape the 2026-08-21 build expects.
--
-- Differences from the SQLite original, all forced by D1:
--   * No PRAGMA foreign_keys — D1 has foreign keys on and the original schema
--     declared none, so nothing changes.
--   * `uploads` is new. The Flask app wrote the header icon, note images and
--     the zen backdrop to static/uploads/ on disk; Workers have no writable
--     filesystem, so the bytes live here instead.
--   * First-run seed data is NOT here. The Worker seeds on the first request
--     that finds an empty `columns` table, mirroring init_db()'s
--     `if existing == 0` branch. Keeping it out of the migration means you can
--     apply migrations and then import an existing radio_station.db without
--     the seed rows colliding with your own.

CREATE TABLE IF NOT EXISTS columns (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    width      INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    group_name TEXT NOT NULL DEFAULT 'General',
    cells      TEXT NOT NULL DEFAULT '{}',
    position   INTEGER NOT NULL DEFAULT 0,
    parent_id  TEXT DEFAULT NULL,
    link_id    TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_link   ON tasks (link_id);
CREATE INDEX IF NOT EXISTS idx_tasks_group  ON tasks (group_name);

CREATE TABLE IF NOT EXISTS automations (
    id          TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL DEFAULT '',
    trigger_col TEXT NOT NULL,
    trigger_val TEXT NOT NULL DEFAULT '',
    action_col  TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'setToday',
    action_val  TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

-- Editable values for status / priority columns.
-- `position` defines rank order (for priority: 0 = highest severity).
CREATE TABLE IF NOT EXISTS palette (
    id       TEXT PRIMARY KEY,
    kind     TEXT NOT NULL,          -- 'status' or 'priority'
    label    TEXT NOT NULL,
    color    TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

-- Custom color per group (groups are otherwise just a name on each task).
CREATE TABLE IF NOT EXISTS group_colors (
    group_name TEXT PRIMARY KEY,
    color      TEXT NOT NULL
);

-- Persisted display order for groups (lower position = higher on the board).
CREATE TABLE IF NOT EXISTS group_order (
    group_name TEXT PRIMARY KEY,
    position   INTEGER NOT NULL DEFAULT 0
);

-- Generic app-wide settings (e.g. display density). Key-value store.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Per-setting write history, so a bad autosave of a JSON blob (goals,
-- notebook, PARA, skill lab) can be rolled back without restoring everything.
CREATE TABLE IF NOT EXISTS setting_history (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL,
    bytes    INTEGER NOT NULL,
    saved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_setting_history_key ON setting_history (key, id DESC);

-- Reward system: things you can spend points on, and a log of redemptions.
CREATE TABLE IF NOT EXISTS rewards (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    cost     INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS redemptions (
    id        TEXT PRIMARY KEY,
    reward_id TEXT,
    name      TEXT NOT NULL,
    cost      INTEGER NOT NULL DEFAULT 0,
    ts        TEXT NOT NULL
);

-- Daily time-block schedule. Each block places a task (or a free note) on a
-- given day at a start time for some number of minutes. Scheduling a task here
-- does NOT move or change the task itself.
--   src_uid : set on blocks that came from an imported .ics, so a re-import
--             can cleanly replace the previous one.
--   auto    : set on blocks placed by Today > Auto-plan, so re-planning
--             replaces them and leaves meetings and hand-placed blocks alone.
CREATE TABLE IF NOT EXISTS schedule_blocks (
    id      TEXT PRIMARY KEY,
    day     TEXT NOT NULL,
    start   TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 30,
    task_id TEXT,
    label   TEXT NOT NULL DEFAULT '',
    color   TEXT,
    src_uid TEXT DEFAULT NULL,
    auto    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedule_day ON schedule_blocks (day, start);
CREATE INDEX IF NOT EXISTS idx_schedule_src ON schedule_blocks (src_uid);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'New project',
    description TEXT NOT NULL DEFAULT '',
    stage       TEXT NOT NULL DEFAULT 'idea',
    tags        TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created     TEXT,
    task_id     TEXT DEFAULT NULL,
    plan        TEXT DEFAULT NULL,
    priority    TEXT DEFAULT NULL
);

-- "Room for Improvements" board — a second, smaller board with its own columns.
CREATE TABLE IF NOT EXISTS imp_columns (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'text',
    is_primary INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    width      INTEGER DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS imp_tasks (
    id         TEXT PRIMARY KEY,
    group_name TEXT NOT NULL DEFAULT 'Current Weaknesses',
    cells      TEXT NOT NULL DEFAULT '{}',
    position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL DEFAULT 'Untitled prompt',
    category TEXT NOT NULL DEFAULT 'general',
    fields   TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    created  TEXT,
    updated  TEXT,
    priority TEXT DEFAULT NULL
);

-- Replaces static/uploads/ and static/zen_backdrop.png on the local build.
-- `name` is the filename the frontend stores in a note or in
-- settings.hdr_icon_url, and is what /static/uploads/<name> serves.
CREATE TABLE IF NOT EXISTS uploads (
    name    TEXT PRIMARY KEY,
    mime    TEXT NOT NULL,
    bytes   BLOB NOT NULL,
    updated TEXT NOT NULL
);
