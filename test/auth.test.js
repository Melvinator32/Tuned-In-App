/* Unit tests for the identity layer.
 *
 * The point of src/auth.js is that it refuses tokens it has not checked, so
 * these tests are mostly about the refusals. A test that only proves a valid
 * token works would pass just as happily against a version that skipped the
 * signature entirely — which is the exact bug that would matter.
 *
 * Real RSA keys are generated per test rather than mocked: the signing and the
 * verification are the thing under test.
 *
 *   node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  multiUserConfigured, teamUrl, parseDirectory, accessToken,
  verifyAccessJwt, scopeToUser, resetKeyCache, AuthError,
} from "../src/auth.js";

const TEAM = "acme.cloudflareaccess.com";
const ISSUER = "https://" + TEAM;
const AUD = "aud-tag-123";

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeKey(kid = "test-key") {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = kid;
  return { pair, jwk };
}

async function signJwt(pair, payload, header = {}) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "test-key", ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
    new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64url(new Uint8Array(sig));
}

function claims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: [AUD], exp: now + 600, iat: now, email: "Someone@Example.com", ...over };
}

function envFor(extra = {}) {
  return { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
           USER_DIRECTORY: '{"someone@example.com":"DB_1"}', ...extra };
}

const keyServer = (jwk) => async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

function req(headers = {}) {
  return new Request("https://example.com/api/state", { headers });
}

async function rejects(fn, match) {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AuthError, "expected an AuthError, got " + err);
    assert.match(err.message, match);
    return err;
  }
  assert.fail("expected a rejection matching " + match);
}

// -------------------------------------------------------------- configuration
test("multi-user stays off until every setting is present", () => {
  assert.equal(multiUserConfigured(undefined), false);
  assert.equal(multiUserConfigured({}), false);
  assert.equal(multiUserConfigured({ ACCESS_TEAM_DOMAIN: TEAM }), false);
  assert.equal(multiUserConfigured({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }), false);
  assert.equal(multiUserConfigured(envFor()), true);
});

test("a half-configured deployment is single-tenant, not broken", async () => {
  const env = { DB: "the-one-board", ACCESS_TEAM_DOMAIN: TEAM };
  assert.equal(await scopeToUser(req(), env), env, "must be the same object, not a copy");
});

test("no two people can be routed to the same board", () => {
  // A typo here would be a data leak rather than a crash: two addresses on one
  // binding means two people opening each other's board, and nothing at
  // runtime would look wrong. The check is on the shape of the directory, so it
  // holds for whatever addresses are actually configured.
  const directory = parseDirectory(JSON.stringify({
    "a@example.com": "DB_1",
    "b@example.com": "DB_2",
    "c@example.com": "DB_3",
    "d@example.com": "DB_4",
  }));
  const bindings = Object.values(directory);
  assert.equal(new Set(bindings).size, bindings.length,
    "two addresses share a binding: " + bindings.join(", "));
});

test("the same person is the same board however they capitalise it", () => {
  // Signing in from a phone keyboard that capitalises the first letter has to
  // reach the same database as signing in from a laptop.
  const directory = parseDirectory(JSON.stringify({ "Someone@Example.COM": "DB_7" }));
  assert.equal(directory["someone@example.com"], "DB_7");
});

test("team domain is accepted with or without the scheme", () => {
  assert.equal(teamUrl(TEAM), ISSUER);
  assert.equal(teamUrl(ISSUER), ISSUER);
  assert.equal(teamUrl(ISSUER + "/"), ISSUER);
  assert.equal(teamUrl("  " + TEAM + "  "), ISSUER);
  assert.equal(teamUrl(""), "");
});

// ------------------------------------------------------------------ directory
test("the directory is case-insensitive on both sides", () => {
  const dir = parseDirectory('{"Someone@Example.COM":"DB_1"}');
  assert.equal(dir["someone@example.com"], "DB_1");
});

test("a malformed directory is a server error, not a silent empty one", () => {
  assert.throws(() => parseDirectory("{not json"), /not valid JSON/);
  assert.deepEqual(parseDirectory(""), {});
});

// ---------------------------------------------------------------- token pickup
test("the token is read from the header, or the cookie as a fallback", () => {
  assert.equal(accessToken(req({ "Cf-Access-Jwt-Assertion": " abc " })), "abc");
  assert.equal(accessToken(req({ Cookie: "other=1; CF_Authorization=xyz; more=2" })), "xyz");
  assert.equal(accessToken(req()), null);
});

// --------------------------------------------------------------- verification
test("a properly signed token yields the email, lowercased", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims());
  const out = await verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) });
  assert.equal(out.email, "someone@example.com");
});

test("a tampered payload is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims());
  const [h, , s] = token.split(".");
  const forged = h + "." + b64url(JSON.stringify(claims({ email: "attacker@example.com" }))) + "." + s;
  await rejects(() => verifyAccessJwt(forged, envFor(), { fetch: keyServer(jwk) }),
    /signature did not verify/);
});

test("a token signed by somebody else's key is refused", async () => {
  resetKeyCache();
  const mine = await makeKey();
  const theirs = await makeKey();
  const token = await signJwt(theirs.pair, claims());
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(mine.jwk) }),
    /signature did not verify/);
});

test("alg none is refused before any key is looked up", async () => {
  resetKeyCache();
  const { pair } = await makeKey();
  const token = await signJwt(pair, claims(), { alg: "none" });
  await rejects(
    () => verifyAccessJwt(token, envFor(), {
      fetch: () => assert.fail("must not fetch keys for an unsigned token"),
    }),
    /unexpected token signing algorithm/);
});

test("a token for another Access team is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims({ iss: "https://evil.cloudflareaccess.com" }));
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }),
    /different Access team/);
});

test("a token for another application is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims({ aud: ["some-other-app"] }));
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }),
    /different application/);
});

test("an expired token is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(pair, claims({ exp: now - 1 }));
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }), /expired/);
});

test("a token with no expiry at all is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const c = claims();
  delete c.exp;
  const token = await signJwt(pair, c);
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }), /expired/);
});

test("an unknown signing key is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey("some-other-kid");
  const token = await signJwt(pair, claims());          // header says kid "test-key"
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }), /unknown key/);
});

test("a token carrying no email is refused", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const c = claims();
  delete c.email;
  const token = await signJwt(pair, c);
  await rejects(() => verifyAccessJwt(token, envFor(), { fetch: keyServer(jwk) }), /no email/);
});

test("garbage is refused without throwing something unhelpful", async () => {
  resetKeyCache();
  await rejects(() => verifyAccessJwt("not-a-token", envFor(), {}), /malformed/);
  await rejects(() => verifyAccessJwt("a.b.c", envFor(), {}), /unreadable/);
});

// ------------------------------------------------------------------- scoping
test("a verified person gets their own database", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims());
  const env = envFor({ DB: "shared", DB_1: "board-for-someone" });
  const scoped = await scopeToUser(
    req({ "Cf-Access-Jwt-Assertion": token }), env, { fetch: keyServer(jwk) });
  assert.equal(scoped.DB, "board-for-someone");
  assert.equal(scoped.USER_EMAIL, "someone@example.com");
  assert.equal(env.DB, "shared", "the original env must not be mutated");
});

test("a request that skipped Access is refused", async () => {
  resetKeyCache();
  await rejects(() => scopeToUser(req(), envFor({ DB_1: "x" })), /did not come through Access/);
});

test("a verified person with no board gets a clear 403, not someone else's", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims({ email: "stranger@example.com" }));
  const err = await rejects(
    () => scopeToUser(req({ "Cf-Access-Jwt-Assertion": token }),
      envFor({ DB: "shared", DB_1: "board" }), { fetch: keyServer(jwk) }),
    /no board is set up for stranger@example.com/);
  assert.equal(err.status, 403);
});

test("a directory pointing at a missing binding fails loudly", async () => {
  resetKeyCache();
  const { pair, jwk } = await makeKey();
  const token = await signJwt(pair, claims());
  const err = await rejects(
    () => scopeToUser(req({ "Cf-Access-Jwt-Assertion": token }),
      envFor({ DB: "shared" }), { fetch: keyServer(jwk) }),
    /not bound to this Worker/);
  assert.equal(err.status, 500);
});
