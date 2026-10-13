import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearIdTokenCache, idTokenCacheKey, loadCachedIdToken } from "./callable-token";

const uid = "super-admin-uid";

function fakeFetch(hits: string[], token = "id-token-1"): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    hits.push(String(input));
    return new Response(JSON.stringify({ idToken: token }), { status: 200 });
  }) as typeof fetch;
}

describe("callable ID token cache", () => {
  it("does not call identitytoolkit on the second cron mint", async () => {
    clearIdTokenCache();
    const hits: string[] = [];
    let minted = 0;
    const input = {
      uid,
      kind: "cron" as const,
      apiKey: "test-key",
      createCustomToken: async () => {
        minted += 1;
        return "custom-token";
      },
      fetchImpl: fakeFetch(hits),
      now: () => 1_000,
    };

    const first = await loadCachedIdToken(input);
    const second = await loadCachedIdToken(input);

    assert.equal(first, "id-token-1");
    assert.equal(second, "id-token-1");
    assert.equal(minted, 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.includes("identitytoolkit.googleapis.com"), true);
    assert.equal(idTokenCacheKey(uid, "cron"), `cron:${uid}`);
    clearIdTokenCache();
  });

  it("does not reuse a session token for the cron key", async () => {
    clearIdTokenCache();
    const hits: string[] = [];
    const fetchImpl = fakeFetch(hits);
    await loadCachedIdToken({
      uid,
      kind: "session",
      apiKey: "test-key",
      createCustomToken: async () => "session-custom",
      fetchImpl,
      now: () => 1_000,
    });
    await loadCachedIdToken({
      uid,
      kind: "cron",
      apiKey: "test-key",
      createCustomToken: async () => "cron-custom",
      fetchImpl,
      now: () => 1_000,
    });
    assert.equal(hits.length, 2);
    clearIdTokenCache();
  });
});
