/* Tuned In — who is asking, and whose board they get.
 *
 * The Worker is single-tenant by default and stays that way unless three
 * settings are present. That is deliberate: the personal deployment and the
 * distribution demo both run this code, and neither should change behaviour
 * because a multi-user feature exists. No configuration, no tenancy — every
 * request gets env.DB exactly as before.
 *
 * When it IS configured, Cloudflare Access sits in front of the Worker and
 * handles the whole sign-in dance. It sends a signed token with every request
 * naming the person who got through. All this file does is check the signature
 * really is Cloudflare's, and translate the email into a database binding.
 *
 * The signature check is not optional politeness. Access injects the identity
 * as an ordinary header, and an ordinary header can be typed by anyone able to
 * reach the Worker by a route that bypasses Access. Trusting it unverified
 * would be worse than having no login at all, because it would look like one.
 *
 * Configuration (see CLOUDFLARE.md):
 *   ACCESS_TEAM_DOMAIN  yourteam.cloudflareaccess.com
 *   ACCESS_AUD          the Access application's Audience tag
 *   USER_DIRECTORY      {"someone@example.com": "DB_1"} — set as a secret, so
 *                       no one's email address is committed to the repository
 */

/** Thrown for anything that should become a 401/403 rather than a 500. */
export class AuthError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = "AuthError";
    this.isAuthError = true;
    this.status = status;
  }
}

/** Multi-user mode is off unless every piece of it is present. Half-configured
 *  counts as off rather than as broken, so a missing secret can never quietly
 *  turn identity checking into a no-op while still handing out boards. */
export function multiUserConfigured(env) {
  return !!(env && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.USER_DIRECTORY);
}

/** Accepts "yourteam.cloudflareaccess.com" or the full URL — both are what
 *  people copy out of the dashboard. */
export function teamUrl(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (String(s).length % 4)) % 4);
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// Cloudflare rotates these keys, so they are fetched rather than pinned, and
// cached per isolate so a busy Worker is not refetching them constantly.
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: null, at: 0, keys: null };

async function accessKeys(issuer, fetchImpl) {
  const url = issuer + "/cdn-cgi/access/certs";
  const now = Date.now();
  if (jwksCache.keys && jwksCache.url === url && now - jwksCache.at < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await (fetchImpl || fetch)(url);
  if (!res.ok) throw new AuthError("could not fetch the Access signing keys", 502);
  const body = await res.json();
  const keys = body && Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new AuthError("Access returned no signing keys", 502);
  jwksCache = { url, at: now, keys };
  return keys;
}

/** Only for tests, which must not inherit a cache from one case to the next. */
export function resetKeyCache() {
  jwksCache = { url: null, at: 0, keys: null };
}

/** The token Access puts on every request it lets through. The header is the
 *  normal path; the cookie is what a browser sends when the Worker is reached
 *  directly on a hostname Access protects. */
export function accessToken(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("Cookie") || "";
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Verify the token really was signed by this Access team for this application,
 *  and return the email inside it. Every failure is an AuthError: there is no
 *  path through this function that returns an identity it did not check. */
export async function verifyAccessJwt(token, env, opts = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new AuthError("malformed Access token", 401);

  let header, payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch (err) {
    throw new AuthError("unreadable Access token", 401);
  }

  // Reject "none" and everything else before a key is ever looked up.
  if (header.alg !== "RS256") throw new AuthError("unexpected token signing algorithm", 401);

  const issuer = teamUrl(env.ACCESS_TEAM_DOMAIN);
  if (payload.iss !== issuer) throw new AuthError("token came from a different Access team", 401);

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.ACCESS_AUD)) {
    throw new AuthError("token was issued for a different application", 401);
  }

  const now = Math.floor((opts.now || Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new AuthError("Access token has expired", 401);
  }
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) {
    throw new AuthError("Access token is not valid yet", 401);
  }

  const key = (await accessKeys(issuer, opts.fetch)).find((k) => k.kid === header.kid);
  if (!key) throw new AuthError("token was signed with an unknown key", 401);

  const cryptoKey = await crypto.subtle.importKey(
    "jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", cryptoKey, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new AuthError("Access token signature did not verify", 401);

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) throw new AuthError("Access token carries no email address", 401);
  return { email, payload };
}

/** email -> binding name. Emails are lowercased on both sides so the directory
 *  is not quietly case-sensitive. */
export function parseDirectory(raw) {
  if (!raw) return {};
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    throw new AuthError("USER_DIRECTORY is not valid JSON", 500);
  }
  const out = {};
  for (const [email, binding] of Object.entries(obj || {})) {
    const key = String(email).trim().toLowerCase();
    if (key) out[key] = String(binding);
  }
  return out;
}

/** The whole point of the file: hand back the env the handlers should use.
 *
 *  Single-tenant deployments get the same object they passed in — not a copy,
 *  so there is no doubt nothing changed. Multi-user deployments get one whose
 *  DB points at that person's own database, which is why every route can go on
 *  reading env.DB without knowing any of this exists. */
export async function scopeToUser(request, env, opts = {}) {
  if (!multiUserConfigured(env)) return env;

  const token = accessToken(request);
  if (!token) throw new AuthError("this request did not come through Access", 401);

  const { email } = await verifyAccessJwt(token, env, opts);
  const binding = parseDirectory(env.USER_DIRECTORY)[email];
  if (!binding) throw new AuthError("no board is set up for " + email, 403);

  const db = env[binding];
  if (!db) throw new AuthError("the board for " + email + " is not bound to this Worker", 500);

  return { ...env, DB: db, USER_EMAIL: email };
}
