/* Apply migrations to every database in an environment.
 *
 *   node scripts/migrate-all.mjs app
 *   node scripts/migrate-all.mjs app --local
 *
 * A multi-user deployment has one database per person, and a migration that
 * reaches some of them and not others is worse than one that reaches none:
 * the Worker is one piece of code talking to schemas that no longer match. So
 * this walks every D1 binding declared for the environment and applies the
 * same migrations to each, stopping at the first failure and saying exactly
 * how far it got.
 *
 * Reads wrangler.jsonc rather than taking a list, so the databases it migrates
 * are by construction the ones the Worker is bound to.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** wrangler.jsonc allows comments; JSON.parse does not. Strips // and /* *\/
 *  outside of strings, which is all this file needs. */
function parseJsonc(text) {
  let out = "";
  let inString = false, inLine = false, inBlock = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i++; continue; }
    if (c === "/" && next === "*") { inBlock = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out);
}

const envName = process.argv[2];
const passthrough = process.argv.slice(3);
const remote = !passthrough.includes("--local");

if (!envName) {
  console.error("usage: node scripts/migrate-all.mjs <environment> [--local]");
  process.exit(1);
}

const config = parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const envConfig = (config.env || {})[envName];
if (!envConfig) {
  console.error(`no "${envName}" environment in wrangler.jsonc`);
  console.error(`available: ${Object.keys(config.env || {}).join(", ") || "(none)"}`);
  process.exit(1);
}

const databases = envConfig.d1_databases || [];
if (!databases.length) {
  console.error(`the "${envName}" environment has no d1_databases to migrate.`);
  console.error("Add one binding per person — see CLOUDFLARE.md.");
  process.exit(1);
}

console.log(`Migrating ${databases.length} database(s) in "${envName}" (${remote ? "remote" : "local"})\n`);

let done = 0;
// These names are concatenated into a shell command, so anything that is not a
// plain D1 name stops here rather than being passed along.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

for (const db of databases) {
  if (!SAFE_NAME.test(db.database_name || "")) {
    console.error(`refusing to run: "${db.database_name}" is not a valid D1 database name`);
    process.exit(1);
  }
  const label = `${db.binding} -> ${db.database_name}`;
  process.stdout.write(`  ${label} ... `);
  const args = ["wrangler", "d1", "migrations", "apply", db.database_name,
                "--env", envName, ...passthrough];
  if (remote && !passthrough.includes("--remote")) args.push("--remote");
  const res = spawnSync("npx", args, { cwd: root, encoding: "utf8", shell: true });
  if (res.status !== 0) {
    console.log("FAILED");
    console.error(`\n${res.stdout || ""}${res.stderr || ""}`);
    console.error(`Stopped after ${done} of ${databases.length}. `
      + `The rest are untouched, so fix this one and run it again — `
      + `already-applied migrations are skipped.`);
    process.exit(1);
  }
  console.log("ok");
  done++;
}

console.log(`\nAll ${done} database(s) are up to date.`);
