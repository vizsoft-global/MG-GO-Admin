import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { panelGet, panelPost } from "./panel-get";

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

  it("sends a question that does not belong in the address as a JSON body", async () => {
    const calls = answer(200, { rows: [], filteredTotal: 0 });
    await panelPost("/api/drivers/page", { query: { search: "Ali" }, offset: 0, limit: 500 });
    assert.equal(calls[0]?.url, "/api/drivers/page");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { query: { search: "Ali" }, offset: 0, limit: 500 });
    answer(403, { error: "not_authorized" });
    await assert.rejects(() => panelPost("/api/drivers/page", {}), /not_authorized/);
  });

  it("is how the Employees list itself loads, so it is not ninth in the action queue", () => {
    const list = readFileSync(new URL("../../features/drivers/use-drivers-page.ts", import.meta.url), "utf8");
    assert.match(list, /panelPost<DriversPageResult>\("\/api\/drivers\/page", \{/);
    assert.doesNotMatch(list, /\bfetchDriversPage\(/);
    // The search text travels in the body: the route is a POST and reads JSON.
    const route = readFileSync(new URL("../../app/api/drivers/page/route.ts", import.meta.url), "utf8");
    assert.match(route, /export async function POST\(request: Request\)/);
    assert.match(route, /await fetchDriversPage\(/);
  });

  it("is how Employees loads the fleet's levels: once, and advancing by what came back", () => {
    const levels = readFileSync(new URL("../../features/drivers/use-driver-levels.ts", import.meta.url), "utf8");
    assert.match(levels, /panelGet<LevelsAnswer>\(\s*`\/api\/drivers\/levels\?limit=\$\{PAGE\}&offset=\$\{offset\}`/);
    assert.match(levels, /const PAGE = 2000;/);
    // A backend that still caps the answer at 500 must not make the loop skip riders.
    assert.match(levels, /offset \+= data\.rows\.length;/);
    assert.doesNotMatch(levels, /offset \+= PAGE;/);
    const backend = readFileSync(new URL("../../../functions/src/rpcs/driver-levels.ts", import.meta.url), "utf8");
    assert.match(backend, /const LIST_MAX = 2000;/);
  });
});
