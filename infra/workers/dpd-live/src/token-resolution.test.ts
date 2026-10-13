import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  FIREBASE_JWKS_URL,
  WORKER_USER_AGENT,
  decodeJwtClaims,
  isJwtExpired,
  resetFirebaseJwksCacheForTests,
  resolveUserFromToken,
  setResolveUserFromTokenForTests,
} from "./supabase";

const PROJECT_ID = "musallam-delivery-prod";
const CONFIG = { projectId: PROJECT_ID };
const KID = "test-kid-1";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: Record<string, unknown>): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
}

function unsignedJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
): string {
  return `${b64urlJson(header)}.${b64urlJson(payload)}.sig`;
}

function signedJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
): string {
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = bytesToB64url(rsaSign("RSA-SHA256", Buffer.from(data), privateKey));
  return `${data}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: PROJECT_ID,
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function jwksBody() {
  return {
    keys: [
      {
        kty: "RSA",
        kid: KID,
        use: "sig",
        alg: "RS256",
        n: publicJwk.n,
        e: publicJwk.e,
      },
    ],
  };
}

const realFetch = globalThis.fetch;

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init)) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetFirebaseJwksCacheForTests();
  setResolveUserFromTokenForTests(null);
});

describe("decodeJwtClaims / isJwtExpired", () => {
  it("reads sub and exp from an unverified payload", () => {
    const claims = decodeJwtClaims(unsignedJwt({ sub: "u1", exp: 1_700_000_000 }));
    assert.deepEqual(claims, { sub: "u1", exp: 1_700_000_000 });
  });

  it("treats garbage as not-expired so verify stays the authority", () => {
    assert.equal(decodeJwtClaims("not-a-jwt"), null);
    assert.equal(isJwtExpired("not-a-jwt"), false);
    assert.equal(isJwtExpired(unsignedJwt({ sub: "u1" })), false);
  });

  it("flags a payload whose exp is in the past", () => {
    const now = 1_700_000_000_000;
    assert.equal(isJwtExpired(unsignedJwt({ exp: 1_699_999_999 }), now), true);
    assert.equal(isJwtExpired(unsignedJwt({ exp: 1_700_000_001 }), now), false);
  });
});

describe("resolveUserFromToken", () => {
  it("never fetches JWKS for a token that already expired", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const result = await resolveUserFromToken(CONFIG, unsignedJwt({ exp: 1 }));
    assert.deepEqual(result, { kind: "rejected" });
    assert.equal(calls, 0);
  });

  it("verifies a signed RS256 Firebase ID token and sends the Worker UA", async () => {
    let ua: string | null = null;
    let url = "";
    stubFetch((input, init) => {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify(jwksBody()), {
        status: 200,
        headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" },
      });
    });
    const result = await resolveUserFromToken(CONFIG, signedJwt(validClaims()));
    assert.deepEqual(result, { kind: "ok", user: { id: "u1" } });
    assert.equal(url, FIREBASE_JWKS_URL);
    assert.equal(ua, WORKER_USER_AGENT);
  });

  it("caches JWKS so a second ingest does not refetch Google", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response(JSON.stringify(jwksBody()), {
        status: 200,
        headers: { "cache-control": "max-age=3600" },
      });
    });
    const token = signedJwt(validClaims());
    assert.deepEqual(await resolveUserFromToken(CONFIG, token), { kind: "ok", user: { id: "u1" } });
    assert.deepEqual(await resolveUserFromToken(CONFIG, token), { kind: "ok", user: { id: "u1" } });
    assert.equal(calls, 1);
  });

  it("rejects a wrong aud without a JWKS fetch", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response(JSON.stringify(jwksBody()), { status: 200 });
    });
    const result = await resolveUserFromToken(
      CONFIG,
      unsignedJwt(validClaims({ aud: "other-project" })),
    );
    assert.deepEqual(result, { kind: "rejected" });
    assert.equal(calls, 0);
  });

  it("classifies JWKS 5xx as unavailable (never cached)", async () => {
    stubFetch(() => new Response("bad", { status: 503 }));
    assert.deepEqual(
      await resolveUserFromToken(CONFIG, unsignedJwt(validClaims())),
      { kind: "unavailable" },
    );
  });

  it("classifies a JWKS network throw as unavailable (never cached)", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(
      await resolveUserFromToken(CONFIG, unsignedJwt(validClaims())),
      { kind: "unavailable" },
    );
  });

  it("rejects a bad signature after a successful JWKS fetch", async () => {
    stubFetch(() => new Response(JSON.stringify(jwksBody()), { status: 200 }));
    assert.deepEqual(
      await resolveUserFromToken(CONFIG, unsignedJwt(validClaims())),
      { kind: "rejected" },
    );
  });
});
