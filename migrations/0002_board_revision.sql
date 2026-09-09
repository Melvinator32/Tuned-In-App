-- A single monotonically-increasing counter bumped on every write to the board.
--
-- Undo/redo is whole-board: the browser keeps snapshots and POSTs an entire one
-- back to /api/restore, which wipes and rewrites seven tables. On the local
-- single-machine build that was safe, because nothing else could touch the
-- database. On Cloudflare it is not — a phone holding a snapshot from this
-- morning could silently overwrite an afternoon's work done on a laptop.
--
-- The counter is the fix. Every response carries the revision it left the board
-- at; the browser remembers it and hands it back with a restore. If the number
-- moved in between, some other device wrote, the snapshot is stale, and the
-- restore is refused instead of applied.
--
-- It deliberately lives outside the seven tables /api/restore wipes, so a
-- restore cannot roll the counter backwards and defeat the check.

CREATE TABLE IF NOT EXISTS board_meta (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO board_meta (id, revision) VALUES (1, 0);
