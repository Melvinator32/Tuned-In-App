"""Export an existing radio_station.db into SQL that D1 can import.

The local build kept everything in a SQLite file next to the app. D1 speaks
SQLite, so moving the board over is a matter of replaying the rows — but
`wrangler d1 execute --file` wants plain INSERT statements, and the schema is
created by migrations/0001_init.sql rather than by the dump.

Usage:

    python scripts/sqlite_to_d1.py radio_station.db > seed.sql
    npx wrangler d1 execute tuned-in --remote --file seed.sql

Run `wrangler d1 migrations apply` FIRST so the tables exist, and run this
against a database the app is not currently writing to.

Notes:
  * Only the tables the Worker reads are exported, in dependency-free order.
    Anything else in the file (an old table from a previous build) is skipped.
  * Columns the source database lacks (an older file predating `plan` or
    `auto`) fall back to the schema default, so an old .db still imports.
  * `uploads` has no source rows — the local build kept those images as files
    in static/uploads/. Re-upload the header icon and re-save the zen backdrop
    from the app once, or add them by hand.
"""

import argparse
import os
import sqlite3
import sys

# table -> the columns migrations/0001_init.sql declares, in order.
TABLES = {
    "columns": ["id", "name", "type", "is_primary", "position", "width"],
    "tasks": ["id", "group_name", "cells", "position", "parent_id", "link_id"],
    "automations": ["id", "enabled", "name", "trigger_col", "trigger_val",
                    "action_col", "action_type", "action_val", "position"],
    "palette": ["id", "kind", "label", "color", "position"],
    "group_colors": ["group_name", "color"],
    "group_order": ["group_name", "position"],
    "settings": ["key", "value"],
    "setting_history": ["id", "key", "value", "bytes", "saved_at"],
    "rewards": ["id", "name", "cost", "position"],
    "redemptions": ["id", "reward_id", "name", "cost", "ts"],
    "schedule_blocks": ["id", "day", "start", "minutes", "task_id", "label",
                        "color", "src_uid", "auto"],
    "projects": ["id", "title", "description", "stage", "tags", "position",
                 "created", "task_id", "plan", "priority"],
    "imp_columns": ["id", "name", "type", "is_primary", "position", "width"],
    "imp_tasks": ["id", "group_name", "cells", "position"],
    "prompts": ["id", "title", "category", "fields", "position", "created",
                "updated", "priority"],
}

# Statements are emitted in this order; nothing here has foreign keys, so it is
# only about readability.
ORDER = list(TABLES)

# `wrangler d1 execute --file` rejects an over-long statement with
# SQLITE_TOOBIG. Measured against wrangler 4.x, ~55 KB goes through and 100 KB
# does not, so batch by byte budget rather than by row count — a real board's
# `settings.value` blobs blow past any sensible row count long before this.
MAX_STMT_BYTES = 40_000
MAX_ROWS_PER_INSERT = 200
# A row bigger than the budget is emitted on its own. Past roughly this size
# even a lone row stops going through, so say so rather than fail opaquely.
SINGLE_ROW_WARN_BYTES = 60_000


def quote(v):
    """SQL literal for a Python value out of sqlite3."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, bytes):
        return "X'" + v.hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def table_exists(db, name):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="path to radio_station.db")
    ap.add_argument("-o", "--out", help="write here instead of stdout")
    ap.add_argument("--wipe", action="store_true",
                    help="emit DELETE FROM for each table first (replace, not merge)")
    args = ap.parse_args(argv)

    if not os.path.exists(args.db):
        sys.exit("no such file: %s" % args.db)

    db = sqlite3.connect("file:%s?mode=ro" % args.db, uri=True)
    db.row_factory = sqlite3.Row
    out = open(args.out, "w", encoding="utf-8", newline="\n") if args.out else sys.stdout

    w = out.write
    w("-- Tuned In — generated from %s by scripts/sqlite_to_d1.py\n" % os.path.basename(args.db))
    w("-- Apply migrations first:  npx wrangler d1 migrations apply tuned-in --remote\n")
    w("-- Then:                    npx wrangler d1 execute tuned-in --remote --file <this file>\n\n")

    if args.wipe:
        for name in reversed(ORDER):
            if table_exists(db, name):
                w("DELETE FROM %s;\n" % name)
        w("\n")

    total = 0
    for name in ORDER:
        if not table_exists(db, name):
            print("  [skip] %s (not in source)" % name, file=sys.stderr)
            continue
        present = {r["name"] for r in db.execute("PRAGMA table_info(%s)" % name)}
        cols = [c for c in TABLES[name] if c in present]
        missing = [c for c in TABLES[name] if c not in present]
        if missing:
            print("  [note] %s: source lacks %s — using schema defaults"
                  % (name, ", ".join(missing)), file=sys.stderr)

        quoted = ", ".join('"%s"' % c for c in cols)
        rows = db.execute("SELECT %s FROM %s" % (quoted, name)).fetchall()
        if not rows:
            continue

        w("-- %s (%d rows)\n" % (name, len(rows)))
        head = "INSERT INTO %s (%s) VALUES\n  " % (name, quoted)
        batch, size = [], 0
        for r in rows:
            tup = "(" + ", ".join(quote(r[c]) for c in cols) + ")"
            if len(tup) > SINGLE_ROW_WARN_BYTES:
                print("  [warn] %s: one row is %d bytes, which is past what "
                      "`wrangler d1 execute --file` reliably accepts. If the "
                      "import fails with SQLITE_TOOBIG, that row is why — see "
                      "CLOUDFLARE.md." % (name, len(tup)), file=sys.stderr)
            if batch and (size + len(tup) > MAX_STMT_BYTES
                          or len(batch) >= MAX_ROWS_PER_INSERT):
                w(head + ",\n  ".join(batch) + ";\n")
                batch, size = [], 0
            batch.append(tup)
            size += len(tup) + 4       # + the ",\n  " separator
        if batch:
            w(head + ",\n  ".join(batch) + ";\n")
        w("\n")
        total += len(rows)
        print("  %-16s %d rows" % (name, len(rows)), file=sys.stderr)

    if args.out:
        out.close()
    print("\n  %d rows exported" % total, file=sys.stderr)


if __name__ == "__main__":
    main()
