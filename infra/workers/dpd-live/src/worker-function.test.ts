import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { callWorkerFunction, workerFunctionUrls } from "./supabase";

const BASE = "https://example.test";
const env = (api?: string) => ({
  FIREBASE_FUNCTIONS_BASE_URL: `${BASE}/`,
  WORKER_SHARED_SECRET: "s",
  FIREBASE_WORKER_API: api,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch with one that answers each URL from the table and records the calls. */
function stubFetch(answers: Record<string, { status: number; body: unknown }>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const answer = answers[url] ?? { status: 500, body: { error: "unexpected url" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return calls;
}

describe("where the room sends a backend job", () => {
  it("goes to the shared function first, then to the job's own", () => {
    assert.deepEqual(workerFunctionUrls(env("workerApi"), "adminIngestDriverPositions"), [
      `${BASE}/workerApi/adminIngestDriverPositions`,
      `${BASE}/adminIngestDriverPositions`,
    ]);
    assert.deepEqual(workerFunctionUrls(env(" /workerApi/ "), "workerFleetRead")[0], `${BASE}/workerApi/workerFleetRead`);
  });

  it("goes straight to the job's own function when the switch is off", () => {
    assert.deepEqual(workerFunctionUrls(env(), "workerFleetRead"), [`${BASE}/workerFleetRead`]);
    assert.deepEqual(workerFunctionUrls(env(""), "workerFleetRead"), [`${BASE}/workerFleetRead`]);
    assert.deepEqual(workerFunctionUrls(env("  "), "workerFleetRead"), [`${BASE}/workerFleetRead`]);
  });

  it("uses the shared function's answer when it has one", async () => {
    const calls = stubFetch({ [`${BASE}/workerApi/adminRecordFleetEvents`]: { status: 200, body: { ok: true, inserted: 2 } } });
    const result = await callWorkerFunction<{ inserted: number }>(env("workerApi"), "adminRecordFleetEvents", { p_events: [] });
    assert.equal(result.inserted, 2);
    assert.deepEqual(calls, [`${BASE}/workerApi/adminRecordFleetEvents`]);
  });

  it("falls back to the job's own function only when the shared one is missing", async () => {
    const calls = stubFetch({
      [`${BASE}/workerApi/workerFleetRead`]: { status: 404, body: { error: "not found" } },
      [`${BASE}/workerFleetRead`]: { status: 200, body: { ok: true } },
    });
    const result = await callWorkerFunction<{ ok: boolean }>(env("workerApi"), "workerFleetRead", { op: "ops" });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [`${BASE}/workerApi/workerFleetRead`, `${BASE}/workerFleetRead`]);
  });

  it("does not send a job twice when the shared function refused or failed it", async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      const calls = stubFetch({ [`${BASE}/workerApi/adminIngestDriverPositions`]: { status, body: { ok: false } } });
      await assert.rejects(
        () => callWorkerFunction(env("workerApi"), "adminIngestDriverPositions", { p_events: [] }),
        new RegExp(`worker_adminIngestDriverPositions_failed_${status}`),
      );
      assert.equal(calls.length, 1, `status ${status}`);
    }
  });
});
