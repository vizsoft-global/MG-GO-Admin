import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  WORKER_USER_AGENT,
  decodeJwtClaims,
  isJwtExpired,
  resolveUserFromToken,
} from "./supabase";

const CONFIG = {
  url: "https://example.supabase.co",
  serviceRoleKey: "service",
  anonKey: "anon",
};

function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: string) =>
    Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "HS256" }))}.${b64(JSON.stringify(payload))}.sig`;
}

const realFetch = globalThis.fetch;

function stubFetch(handler: (init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    handler(init)) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("decodeJwtClaims / isJwtExpired", () => {
  it("reads sub and exp from an unverified payload", () => {
    const claims = decodeJwtClaims(jwt({ sub: "u1", exp: 1_700_000_000 }));
    assert.deepEqual(claims, { sub: "u1", exp: 1_700_000_000 });
  });

  it("treats garbage as not-expired so GoTrue stays the authority", () => {
    assert.equal(decodeJwtClaims("not-a-jwt"), null);
    assert.equal(isJwtExpired("not-a-jwt"), false);
    assert.equal(isJwtExpired(jwt({ sub: "u1" })), false);
  });

  it("flags a payload whose exp is in the past", () => {
    const now = 1_700_000_000_000;
    assert.equal(isJwtExpired(jwt({ exp: 1_699_999_999 }), now), true);
    assert.equal(isJwtExpired(jwt({ exp: 1_700_000_001 }), now), false);
  });
});

describe("resolveUserFromToken", () => {
  it("never calls GoTrue for a token that already expired", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const result = await resolveUserFromToken(CONFIG, jwt({ exp: 1 }));
    assert.deepEqual(result, { kind: "rejected" });
    assert.equal(calls, 0);
  });

  it("sends a User-Agent and returns the user on 200", async () => {
    let ua: string | null = null;
    stubFetch((init) => {
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
    });
    const result = await resolveUserFromToken(CONFIG, "opaque-token");
    assert.deepEqual(result, { kind: "ok", user: { id: "u1" } });
    assert.equal(ua, WORKER_USER_AGENT);
  });

  it("classifies 401/403 as rejected (cacheable)", async () => {
    stubFetch(() => new Response("{}", { status: 403 }));
    assert.deepEqual(await resolveUserFromToken(CONFIG, "t"), { kind: "rejected" });
    stubFetch(() => new Response("{}", { status: 401 }));
    assert.deepEqual(await resolveUserFromToken(CONFIG, "t"), { kind: "rejected" });
  });

  it("classifies 5xx and network failures as unavailable (never cached)", async () => {
    stubFetch(() => new Response("bad", { status: 522 }));
    assert.deepEqual(await resolveUserFromToken(CONFIG, "t"), { kind: "unavailable" });
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await resolveUserFromToken(CONFIG, "t"), { kind: "unavailable" });
  });
});
