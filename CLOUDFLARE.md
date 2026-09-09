# Running Tuned In on Cloudflare

Tuned In used to be a Flask app you launched on your own machine, keeping
everything in `radio_station.db` next to the exe. This branch runs the same app
on Cloudflare: the frontend is served as static assets, the API is a Worker, and
the board lives in D1.

Nothing about the UI changed. The frontend calls the same `/api/*` endpoints it
always did — they are answered by JavaScript in `src/` instead of Python in
`app.py`.

> **Status:** this is deployed and running with the real board imported. The
> Worker's URL is deliberately not written down here, because this repo is
> public and the app currently has no login. See
> [Putting a login in front of it](#putting-a-login-in-front-of-it).

---

## What lives where now

```
public/              the frontend, served straight from Cloudflare's edge
  index.html         was templates/index.html (Jinja removed)
  static/            was static/
src/                 the Worker — replaces app.py
  index.js           routing, the revision stamp, the two upload paths
  lib.js             shared helpers: ids, the clock, D1 patterns, automations
  seed.js            first-run seed (was init_db)
  board.js           /api/state, tasks, columns, groups, automations, palette, restore
  schedule.js        /api/schedule*, the .ics importer
  extras.js          rewards, improvements, prompts, projects, settings, images
migrations/          the D1 schema, applied in order
scripts/             sqlite_to_d1.py — move an existing radio_station.db over
test/                logic.test.js (unit) and smoke.mjs (end-to-end)
wrangler.jsonc       Worker config: assets, D1 binding, TZ
```

The Python files at the repo root (`app.py`, `build_dist.py`, the `.bat` /
`.command` launchers, `RadioStation.spec`, `requirements.txt`) are the old local
build. Nothing on Cloudflare reads them, and they can't run from this layout
anyway — they expect `templates/` and `static/` at the root, which are now under
`public/`. They're kept as a reference for the behavior the Worker reproduces.

---

## Everyday commands

Run these from the repo root.

| | |
|---|---|
| `npx wrangler deploy` | push the current working tree to Cloudflare |
| `npm run dev` | run locally at `http://127.0.0.1:8787` against a *local* D1 |
| `npm run build` | build without deploying (`wrangler deploy --dry-run`) |
| `npm test` | unit tests for the ported logic |
| `npx wrangler tail` | watch live requests and `console.error` output |
| `npm run db:migrate` | apply migrations to the **remote** database |
| `npm run db:migrate:local` | apply them to the local one |

`wrangler dev` uses a separate local database under `.wrangler/`, so you can
experiment without touching the real board.

### Wrangler's prompts default to *no*

`wrangler d1 migrations apply` asks for confirmation. Pressing Enter accepts the
default, which is **no** — the migration is skipped and you get a normal shell
prompt back. If you then type `y`, PowerShell tries to run `y` as a command and
tells you it isn't a cmdlet. That error means the migration never ran.

Press `y` while the prompt is still waiting, or sidestep it entirely — piping
anything in makes wrangler treat the run as non-interactive and answer yes:

```bash
"y" | npx wrangler d1 migrations apply tuned-in --remote
```

---

## Setting it up from scratch

Only needed for a fresh Cloudflare account — the existing deployment is already
past this. You need a Cloudflare account (free plan is enough) and Node 18+.

### 1. Install and sign in

```bash
npm install
```

```bash
npx wrangler login
```

This opens a browser for consent. `npx wrangler whoami` confirms it worked.

### 2. Create the database

```bash
npx wrangler d1 create tuned-in
```

It prints a `database_id`. Put it in `wrangler.jsonc` on the entry whose
`binding` is `DB`.

**Watch for a duplicate binding.** Depending on how it's invoked, this can
*append a second `d1_databases` entry* rather than filling in the existing one —
leaving the `DB` binding on its placeholder and the real id under some other
binding name. Wrangler matches the first entry it finds, so you get:

```
Invalid property: databaseId => Invalid uuid [code: 7400]
```

The Worker reads `env.DB`, so there must be exactly one entry and its `binding`
must be `DB`. Check the file after running this command.

### 3. Set your timezone

`vars.TZ` in `wrangler.jsonc`. Workers run in UTC, and this is what keeps
"today" meaning your today — see [Timezone](#timezone).

### 4. Create the tables

```bash
npx wrangler d1 migrations apply tuned-in --remote
```

`d1 create` gives you an empty database — no tables at all. This builds the 16
the app expects. Skip it and the deploy succeeds but every request 500s with
`no such table: columns`.

`--remote` matters: without it you migrate a throwaway local copy and the real
database stays empty.

Verify:

```bash
npx wrangler d1 execute tuned-in --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

### 5. Deploy

```bash
npx wrangler deploy
```

It prints your `*.workers.dev` URL.

### 6. Put a login in front of it

Do this before real data goes in. See below.

---

## Putting a login in front of it

**The app has no login and never did.** That was fine when it only listened on
`127.0.0.1`. On a public URL, anyone with the link can read and edit the whole
board — tasks, goals, career notes, everything.

Cloudflare Access fixes this without touching the code. It authenticates before
a request reaches the Worker, and as of August 2026 it works directly on
`workers.dev` URLs — no custom domain needed, which used to be the blocker.

### The two-minute version

Dashboard → **Workers & Pages** → `tuned-in` → **Access** tab →
**Protect this Worker behind Access** → scope **All traffic** → policy
**Cloudflare account members** → apply.

That covers every route the Worker answers on: the `workers.dev` hostname,
preview URLs, and any custom domain added later. No code change, no redeploy.

Access also offers **one-time PIN** (a code emailed to you), which needs no
external setup and works with any address rather than only your Cloudflare login.

### Adding "Sign in with Google"

Configuration only, still no code, but it needs a Google Cloud OAuth client:

1. In Zero Trust, pick a team name — you get `yourteam.cloudflareaccess.com`,
   and it forms part of the Google redirect URL, so choose it first.
2. In Google Cloud Console: create a project, configure the OAuth consent screen
   (audience **External**), create an OAuth client of type **Web application**,
   and set the authorized origin and redirect URI to your team domain callback.
3. Copy the **Client ID** and **Client Secret** into Zero Trust → Settings →
   Authentication → Google.
4. Edit the Access application's policy to *Emails → is → your address*.

Step 4 is the one that matters. Without it, "sign in with Google" means *anyone
with a Google account*. The identity provider proves who someone is; the policy
decides who is allowed.

Free for up to 50 users. Zero Trust onboarding sometimes asks for a card on file
even to select the $0 plan.

Everything above puts one lock on one shared board: everyone who gets past Access
sees the same tasks. If you want each person to have their *own* board instead,
that is implemented and documented under **Multi-device** at the end of this
file — same Access setup, plus a database per person.

---

## Bringing an existing board over

`scripts/sqlite_to_d1.py` turns a `radio_station.db` into SQL that D1 can
execute. Close the local app first so nothing is mid-write.

```bash
python scripts/sqlite_to_d1.py radio_station.db --wipe -o board-import.sql
```

```bash
npx wrangler d1 execute tuned-in --remote --file board-import.sql
```

Run the migrations first — the script emits `INSERT`s only, not the schema.

**`--wipe` is usually what you want.** The first request to a fresh deployment
seeds a demo board, and its column ids (`c_name`, `c_status`, …) collide with a
real board's on import. `--wipe` clears the tables first. Check what you're
about to overwrite before using it:

```bash
npx wrangler d1 execute tuned-in --remote --command "SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM settings) AS settings"
```

Nine tasks, ten columns and two settings is the untouched demo seed. Anything
else is real and worth keeping.

**Pick the newest source file.** The repo carries dated backups alongside
`radio_station.db`; they are not always in the order the names suggest. Compare
before importing:

```bash
python -c "import sqlite3,sys; [print(p, sqlite3.connect('file:%s?mode=ro'%p,uri=True).execute('SELECT COUNT(*) FROM tasks').fetchone()[0]) for p in sys.argv[1:]]" radio_station.db radio_station_*.db
```

Afterwards, delete the generated `.sql` — it is a plaintext copy of the entire
board.

Two things don't come across:

- **Uploaded images.** The local build kept the header icon, note photos and the
  zen backdrop as files in `static/uploads/`. Re-upload the icon and re-save the
  backdrop from the app once. Note images show as broken until re-added.
- **Anything past ~60 KB in a single row.** `wrangler d1 execute --file` rejects
  an over-long statement with `SQLITE_TOOBIG`. Measured against wrangler 4.x,
  ~55 KB goes through and 100 KB does not, so the script batches by byte budget
  and warns when a single row exceeds it. If you hit the wall, the culprit is a
  large `settings` blob (goals, notebook); paste that one value in through the
  app's UI instead.

---

## Deploying from GitHub

Optional — `npx wrangler deploy` from your machine needs no dashboard setup at
all.

If you do connect the repo (**Workers & Pages → Create → Import a repository**),
**check which branch it builds.** It defaults to the repository's default
branch, which is `main`, and `main` has none of this work on it. The symptom is
unmistakable: the page loads completely unstyled with a broken logo, because
what's being served is the old `index.html` with its unrendered Flask
placeholders — the stylesheet URL is literally `{{ url_for(...) }}`, which 404s.

Build command `npm install`, deploy command `npx wrangler deploy`.
`wrangler.jsonc` supplies the bindings, so there is nothing else to configure.

There are **no secrets** in this project. A D1 `database_id` is an identifier
rather than a credential and has to be in the committed config for deploys to
work. If you add a real secret later, use `npx wrangler secret put NAME`.

---

## Testing before you merge

```bash
npm test
```

Then the end-to-end suite, which drives the real Worker over HTTP:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

and in another terminal:

```bash
node test/smoke.mjs
```

170 checks across every route the frontend calls. It writes as it goes and
expects a **freshly migrated local database**, so delete `.wrangler/state` and
re-apply migrations between runs. Never point it at a `--remote` session.

To exercise real Cloudflare without risking the live board, deploy to a
throwaway: add a `staging` environment to `wrangler.jsonc` with its own
`database_name`/`database_id`, then `npx wrangler deploy --env staging` and
`node test/smoke.mjs https://tuned-in-staging.<subdomain>.workers.dev`. Note that
wrangler does **not** inherit `vars` or `d1_databases` into a named environment —
both must be redeclared in the `staging` block or the bindings come up empty.

---

## Applying a later migration

Migrations are additive and the running Worker ignores tables it doesn't know
about, so **migrate first, then deploy**:

```bash
npx wrangler d1 migrations apply tuned-in --remote
```

```bash
npx wrangler deploy
```

The other order breaks the site for as long as it takes to run the migration:
new code querying a table that doesn't exist yet 500s every request.

---

## What changed in behavior, and why

Everything below is a consequence of the platform, not a redesign.

### Timezone

The Flask app used the host machine's clock for `date.today()` — the completion
stamp on a Done task, the `setToday` automation, the day the schedule opens on —
and for converting UTC timestamps when importing an Outlook `.ics`.

Workers run in UTC. `vars.TZ` in `wrangler.jsonc` restores the old behavior. Get
it wrong and tasks you finish in the evening get stamped with tomorrow's date,
and imported meetings land at the wrong hour.

### Undo is guarded across devices

Undo is whole-board: the browser holds snapshots and POSTs an entire one to
`/api/restore`, which wipes and rewrites seven tables from the payload. That was
safe when only one machine could reach the database. It is not once a phone and
a laptop can both open the board — a page holding this morning's snapshot would
silently revert an afternoon of work done elsewhere.

`migrations/0002` adds a revision counter, bumped on every successful write. The
router stamps it on every API response as `X-Board-Revision`; the browser
remembers the last value it saw and quotes it when restoring. `/api/restore`
compares, and answers **409** when the board has moved on. The client then drops
its undo history — every snapshot it holds is equally stale — and offers a
reload.

A restore with *no* revision is refused too, so a page cached from before this
shipped can't keep overwriting. If you see "This page is running an older
version of Tuned In", reload.

The counter lives in its own table, outside the seven that `/api/restore` wipes,
so a restore can't roll it backwards and defeat the check.

One residual: if another device writes in the narrow window between a page
loading state and taking its snapshot, the revisions still match and the restore
is allowed. That's inherent to optimistic concurrency; closing it fully needs
per-entity versioning rather than whole-board snapshots.

### Images are rows, not files

There is no writable filesystem, so the header icon, note photos and the zen
backdrop go into a D1 `uploads` table and are served back from
`/static/uploads/<name>` and `/static/zen_backdrop.png` by the Worker.

D1 caps a row at 2 MB, so uploads are capped at **1.5 MB** — the local build
allowed 3 MB for the icon and 8 MB for note photos. The zen garden falls back to
JPEG when its PNG would be too big.

### The .ics folder scan is gone

The local app scanned its own folder for a dropped `.ics` on every launch, and
the **sync folder** link in Today and Calendar re-read it on demand. A Worker
has no folder, so that link is gone rather than left as a button that can never
do anything. Dropping an `.ics` on the import zone, or clicking it to pick a
file, works exactly as before and is now the only way in.

`POST /api/schedule/rescan` still exists and still answers "no file found" — the
same JSON the Flask route returned for an empty folder — so a stale cached page
that still calls it gets a clean answer instead of a 404.

The same applies to the `*.tasks.json` drop-in importer, which had no UI.

### Backups

`backup_db()` wrote a dated snapshot to `backups/` at every launch. D1 has
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
instead — any point in the last 30 days, on the free plan, with no setup:

```bash
npx wrangler d1 time-travel restore tuned-in --timestamp 2026-09-01T12:00:00Z
```

Per-setting write history (the 20 versions behind **Settings → Data history**)
is unchanged — it lives in the database, not on disk.

### Startup work happens on the first request

`init_db()` ran at process start. A Worker has no process start, so seeding and
the small self-healing migrations run inside `/api/state` and no-op once the
board has columns.

### Transactions

D1 has no interactive transactions, so the `BEGIN`/`COMMIT` in `/api/restore`
is a D1 batch. Batches are atomic, but a board too large for one request is
split into several atomic chunks. In practice a normal board is one chunk.

### Not carried over

`SERVER_BUILD` still has to match `EXPECTED_SERVER_BUILD` in
`public/static/app.js`, but the "please relaunch the app" banner it drives can't
really fire any more — a deploy replaces both halves at once. The `?v=` stamp on
the asset URLs in `index.html` is a separate cache-buster; bump it when shipping
frontend changes so browsers don't run stale JavaScript against new server code.

The PyInstaller build (`build_dist.py`), the desktop launchers, and the
single-file demo build are local-only tooling and are untouched.

---

## Still open

- **No login.** See [above](#putting-a-login-in-front-of-it).
- **Self-serve signup.** Adding a person is a config edit and a deploy (see
  *Multi-device* below). Letting strangers sign themselves up means a database
  per user created on demand — a Durable Object rather than a static binding.

## Multi-device: one board per person

The default deployment is single-tenant — one database, one board, shared by
anyone who can reach it. Set the three things below and the same Worker starts
handing each signed-in person their own database instead.

It stays off until all three are present. A half-finished setup counts as "not
configured" rather than "configured badly", so there is no window where identity
checking is skipped while boards are still being handed out.

### How it works

Cloudflare Access sits in front of the Worker and runs the entire sign-in. Every
request it lets through carries a signed token naming the person who got in.
`src/auth.js` verifies that signature against Cloudflare's published keys, reads
the email, and looks up which database binding belongs to them.
`handleApiRequest` then hands that database to the route handlers as `env.DB`.

Nothing else changes. Every route goes on reading `env.DB` without knowing any of
this exists — which is why this was a small change and not a rewrite. Two devices
editing the same board was already handled by the revision guard (see *Undo is
guarded across devices* above); multi-device did not add that problem, it
inherited a solution.

**The signature check is the entire security boundary.** Access injects the
identity as an ordinary HTTP header, and an ordinary header can be typed by
anyone who can reach the Worker by some route that bypasses Access. Trusting it
unverified would be worse than having no login, because it would look like one.

### 1. A database for each person

```
npx wrangler d1 create tuned-in-alex
```

Bind it under `env.app` in `wrangler.jsonc`, using the id it prints:

```jsonc
{ "binding": "DB_1", "database_name": "tuned-in-alex",
  "database_id": "<the id it printed>", "migrations_dir": "migrations" }
```

One entry per person. This list is the authoritative answer to "who has a board",
and `npm run db:migrate:app` walks exactly these entries — so nobody's schema can
drift behind the Worker's.

### 2. Create the tables in all of them

```
npm run db:migrate:app
```

It stops at the first failure and tells you how far it got. Migrations already
applied are skipped, so running it again after a fix is safe.

### 3. Turn on Access with Google

In the Cloudflare dashboard, under **Zero Trust → Access**:

1. Add **Google** as a login method (Settings → Authentication). Cloudflare walks
   you through the Google side; it is free and has no user limit.
2. Create an **Access application** pointing at the Worker. Protecting the Worker
   itself rather than a hostname covers every route, Custom Domain and preview URL
   at once — including `workers.dev`, so there is no forgotten back door.
3. Add a policy allowing the email addresses you intend to let in.

Then copy two values out of the dashboard:

- **Team domain** — `yourteam.cloudflareaccess.com`
- **Application Audience (AUD) tag** — on the application's overview page

Put both in `env.app.vars` in `wrangler.jsonc` as `ACCESS_TEAM_DOMAIN` and
`ACCESS_AUD`. Neither is secret.

### 4. Say who gets which board

```
npx wrangler secret put USER_DIRECTORY --env app
```

Paste a JSON object mapping each email to its binding:

```json
{"alex@example.com": "DB_1", "sam@example.com": "DB_2"}
```

A secret rather than a var deliberately: nobody's email address ends up in the
repository. Emails are compared case-insensitively.

### 5. Deploy

```
npm run deploy:app
```

### 6. Check the gate actually closed

The one test worth doing by hand, because getting it wrong is silent:

```
curl -i https://<your-app-url>/api/state
```

Without a session you must get **401**, not a board. If you get data back, the
Worker is reachable by a route Access is not covering — fix that before telling
anyone it has a login.

### Adding somebody later

Create their database, add a binding, add them to `USER_DIRECTORY` and the Access
policy, then `npm run db:migrate:app && npm run deploy:app`. Roughly two minutes,
but it is a deploy — which is fine for tens of people and tiresome at fifty. Past
that, a Durable Object per person removes the per-signup deploy, and Access
starts charging per seat so a direct Google OAuth flow becomes worth its ~150
lines.

### Moving someone's local board in

Someone who has been using a local-first build already has their whole board in a
file. On their new account: **Export → Restore from file**. It is the same
whole-board restore path the undo system uses, so it arrives complete.
