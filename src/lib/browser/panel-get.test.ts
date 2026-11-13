import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { panelGet } from "./panel-get";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe("the shell's reads are plain GETs", () => {
  it("returns the route's answer and sends the session cookie", async () => {
    const calls = answer(200, { count: 3 });
    assert.deepEqual(await panelGet<{ count: number }>("/api/nav/badges?kind=verifications"), { count: 3 });
    assert.equal(calls[0]?.url, "/api/nav/badges?kind=verifications");
    assert.equal(calls[0]?.init?.method, "GET");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
  });

  it("throws the route's own error code, or the status when there is none", async () => {
    answer(403, { error: "not_authorized" });
    await assert.rejects(() => panelGet("/api/drivers/import-jobs"), /not_authorized/);
    answer(503, "upstream is down");
    await assert.rejects(() => panelGet("/api/drivers/import-jobs"), /http_503/);
  });

  it("is what the sidebar badges and the import banner use, not a server action", () => {
    // A server action here queues ahead of the page's own data on every page load.
    const badges = readFileSync(new URL("../../hooks/use-nav-badges.ts", import.meta.url), "utf8");
    assert.doesNotMatch(badges, /-actions"/);
    assert.match(badges, /panelGet<RequestTypeCounts>\("\/api\/nav\/badges\?kind=requests"\)/);
    const banner = readFileSync(
      new URL("../../features/drivers/import/driver-import-job-provider.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(banner, /\blistDriverImportJobs\b/);
    assert.match(banner, /panelGet<\{ jobs: DriverImportJobSummary\[\] \}>\("\/api\/drivers\/import-jobs"\)/);
  });
});
