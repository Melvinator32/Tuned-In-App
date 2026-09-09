/* Check that a deploy actually landed, and landed the right build.
 *
 *   node scripts/verify-deploy.mjs <url> <expected-profile>
 *
 * This exists because of a failure that happened twice. `wrangler deploy`
 * reported success both times, and both times the deployed site was missing
 * public/static/profile.js — the one file that carries which sections, goals
 * and views a build shows. The app came up looking almost right, kept working,
 * lost nothing, and quietly showed none of the personal content. Nobody noticed
 * for two days.
 *
 * A deploy that reports success while serving the wrong thing is worse than one
 * that fails, so this turns it into a non-zero exit. It runs after every deploy
 * script in package.json.
 *
 * Cloudflare's edge takes a moment to propagate, so a 404 is retried a few
 * times before it counts as a failure — the earlier "404 bug" in this project
 * turned out to be exactly that lag.
 */

// Targets live in personal-config.json rather than here, because a workers.dev
// subdomain is the account holder's name and this file is shared with the
// distribution copy of the project.
//
//   node scripts/verify-deploy.mjs --target local
//   node scripts/verify-deploy.mjs <url> <expected-profile>
//   node scripts/verify-deploy.mjs <url> --gated
//
// "gated" is the opposite assertion: the Worker must NOT be reachable without a
// session. It is the check from the multi-device setup, moved somewhere it runs
// every time rather than once by hand.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target");

let url, expected, mustBeGated;

if (targetIndex !== -1) {
  const name = args[targetIndex + 1];
  let targets;
  try {
    const configPath = new URL("../personal-config.json", import.meta.url);
    targets = JSON.parse(readFileSync(configPath, "utf8")).targets || {};
  } catch (err) {
    console.error("cannot read personal-config.json - it holds the deploy targets");
    process.exit(1);
  }
  const target = targets[name];
  if (!target) {
    console.error(`no target "${name}" in personal-config.json`);
    console.error(`available: ${Object.keys(targets).join(", ")}`);
    process.exit(1);
  }
  ({ url, profile: expected } = target);
  mustBeGated = !!target.gated;
} else {
  mustBeGated = args.includes("--gated");
  [url, expected] = args.filter((a) => a !== "--gated");
}

if (!url || (!expected && !mustBeGated)) {
  console.error("usage: node scripts/verify-deploy.mjs --target <name>");
  console.error("       node scripts/verify-deploy.mjs <url> <expected-profile>");
  console.error("       node scripts/verify-deploy.mjs <url> --gated");
  process.exit(1);
}

const PROFILE_PATH = "/static/profile.js";
const ATTEMPTS = 5;
const GAP_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An Access-protected Worker answers every request with a redirect to the
 *  login page, including its static assets. That is the gate working, not a
 *  broken deploy, and it cannot be checked from a shell without a session. */
function isAccessRedirect(res) {
  const location = res.headers.get("location") || "";
  return (res.status === 302 || res.status === 301)
    && location.includes("cloudflareaccess.com");
}

async function check() {
  const res = await fetch(url.replace(/\/$/, "") + PROFILE_PATH, { redirect: "manual" });

  if (isAccessRedirect(res)) {
    return { done: true, gated: true };
  }
  if (res.status !== 200) {
    return { done: false, why: `profile.js returned ${res.status}` };
  }

  const body = await res.text();
  const found = (body.match(/name:\s*["']([^"']+)["']/) || [])[1];
  if (found !== expected) {
    return { done: false, why: `serving profile "${found || "(none)"}", expected "${expected}"` };
  }
  return { done: true, profile: found, bytes: body.length };
}

let last = "no attempt made";
for (let i = 1; i <= ATTEMPTS; i++) {
  let result;
  try {
    result = await check();
  } catch (err) {
    result = { done: false, why: err.message };
  }

  if (result.done && result.gated) {
    console.log(`  verify: ${url} is behind Access${mustBeGated ? " — as required" : " — cannot check the build from here"}`);
    process.exit(0);
  }
  if (mustBeGated && result.done) {
    console.error(`\n  SECURITY CHECK FAILED: ${url}`);
    console.error(`  It answered without a session. Access is meant to be in front of this`);
    console.error(`  Worker, so anyone with the URL can currently read and write the board.`);
    console.error(`  Re-attach the Access application before using it.\n`);
    process.exit(1);
  }
  if (result.done) {
    console.log(`  verify: ${url} is serving the "${result.profile}" build (${result.bytes} bytes)`);
    process.exit(0);
  }

  last = result.why;
  if (i < ATTEMPTS) await sleep(GAP_MS);
}

console.error(`\n  DEPLOY VERIFICATION FAILED: ${url}`);
console.error(`  ${last}`);
console.error(`\n  The deploy reported success but the site is not serving the "${expected}" build.`);
console.error(`  Most likely something else deployed over it — check whether a GitHub`);
console.error(`  integration is rebuilding this Worker, since that build has no profile file.`);
console.error(`  Re-run the deploy and watch this check pass before trusting it.\n`);
process.exit(1);
