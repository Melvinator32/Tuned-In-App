/* Put one profile in place for the build.
 *
 *   node scripts/build-profile.mjs personal
 *   node scripts/build-profile.mjs default
 *
 * Copies profiles/<name>.js to public/static/profile.js, which is the only
 * profile the deploy uploads. Selecting at build time rather than at runtime is
 * deliberate: if every profile shipped as an asset, a distribution deployment
 * would still be serving the personal one to anyone who guessed the URL.
 *
 * public/static/profile.js is generated and gitignored. The npm dev and deploy
 * scripts run this first, so it is always current.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const available = existsSync(join(root, "profiles"))
  ? readdirSync(join(root, "profiles")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3))
  : [];

const name = process.argv[2];
if (!name) {
  console.error(`usage: node scripts/build-profile.mjs <${available.join("|") || "name"}>`);
  process.exit(1);
}
const src = join(root, "profiles", `${name}.js`);
if (!existsSync(src)) {
  console.error(`no such profile: ${name}\navailable: ${available.join(", ") || "(none)"}`);
  process.exit(1);
}

const body = readFileSync(src, "utf8");
const header =
  `/* GENERATED — do not edit.\n` +
  `   Copied from profiles/${name}.js by scripts/build-profile.mjs.\n` +
  `   Edit that file instead; this one is overwritten on every build. */\n\n`;

writeFileSync(join(root, "public", "static", "profile.js"), header + body, "utf8");

// A local-first build runs the API in the browser, so it needs the API source
// and the schema as assets. A server build must not carry either: that code is
// already running on the Worker, and shipping it twice is dead weight.
const apiDir = join(root, "public", "static", "api");
const migrationsOut = join(root, "public", "static", "migrations.js");
const wantsLocal = /storage:\s*["']local["']/.test(body);

rmSync(apiDir, { recursive: true, force: true });
rmSync(migrationsOut, { force: true });

// A build that is not the personal one must carry none of the personal content.
// Build-time profile selection is what guarantees that, and it has held - but
// it guards only profile.js. Personal material has reached a shared file before
// in this project: GD_ROLES still named the venture after a sweep that missed
// it, and nothing would have caught that on the way out.
//
// The strings to look for live in personal-config.json, which is untracked -
// they name the person, so a copy of this project meant for other people should
// not contain them either. That file is required whenever profiles/personal.js
// exists, so deleting it cannot quietly switch this check off.
if (name !== "personal") {
  const configPath = join(root, "personal-config.json");
  const hasPersonalProfile = existsSync(join(root, "profiles", "personal.js"));

  if (!existsSync(configPath)) {
    if (hasPersonalProfile) {
      console.error("\nREFUSING TO BUILD: personal-config.json is missing.");
      console.error("This project still has profiles/personal.js, so a distribution build");
      console.error("must be checked for personal content and cannot be.\n");
      process.exit(1);
    }
    // No personal profile and no config: a distribution-only copy, with
    // nothing to leak and nothing to check.
  } else {
    const markers = JSON.parse(readFileSync(configPath, "utf8")).markers || [];
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|html|css|json|md|txt)$/i.test(entry.name)) continue;
        const body = readFileSync(full, "utf8");
        for (const marker of markers) {
          if (body.includes(marker)) offenders.push(`${full} contains "${marker}"`);
        }
      }
    };
    walk(join(root, "public"));
    if (offenders.length) {
      console.error(`\nREFUSING TO BUILD "${name}": personal content found in the output\n`);
      for (const o of offenders) console.error("  " + o);
      console.error(`\nA distribution build must carry none of it. Fix the file above, or`);
      console.error(`remove the leftover from public/ and build again.\n`);
      process.exit(1);
    }
  }
}

if (wantsLocal) {
  // The handlers import each other by relative path, so copying the directory
  // as-is is all the browser's module loader needs.
  mkdirSync(apiDir, { recursive: true });
  for (const f of readdirSync(join(root, "src")).filter((f) => f.endsWith(".js"))) {
    copyFileSync(join(root, "src", f), join(apiDir, f));
  }
  // One source of schema truth: the same migration files wrangler applies.
  const migrations = readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(root, "migrations", f), "utf8"));
  writeFileSync(migrationsOut,
    "/* GENERATED from migrations/*.sql by scripts/build-profile.mjs. */\n" +
    "window.RS_MIGRATIONS = " + JSON.stringify(migrations, null, 2) + ";\n", "utf8");
  console.log(`profile: ${name}  (+ api/ and migrations.js for in-browser storage)`);
} else {
  console.log(`profile: ${name}`);
}
