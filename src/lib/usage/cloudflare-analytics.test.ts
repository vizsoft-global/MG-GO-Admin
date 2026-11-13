import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  queryCloudflareDataset,
  resetCloudflareAnalyticsMemo,
  type CloudflarePost,
} from "./cloudflare-analytics";

const WINDOW = {
  startMs: Date.parse("2026-11-13T00:00:00.000Z"),
  endMs: Date.parse("2026-11-13T01:00:00.000Z"),
};

function answer(dataset: string, groups: unknown[]) {
  return { data: { viewer: { accounts: [{ [dataset]: groups }] } } };
}

/** A fake API that rejects the given field names and filter forms, like the real one. */
function fakeApi(options: { unknownFields?: string[]; unknownFilters?: string[]; dataset: string }) {
  const queries: string[] = [];
  const variables: Array<Record<string, string>> = [];
  const post: CloudflarePost = async (query, sent) => {
    queries.push(query);
    variables.push(sent);
    for (const filter of options.unknownFilters ?? []) {
      if (query.includes(`${filter}_geq`)) {
        return { errors: [{ message: `unknown arg ${filter}_geq` }] };
      }
    }
    for (const field of options.unknownFields ?? []) {
      if (new RegExp(`\\b${field}\\b`).test(query)) {
        return { errors: [{ message: `unknown field "${field}"` }] };
      }
    }
    return answer(options.dataset, [{ sum: { requests: 42, cpuTime: "7" }, dimensions: { scriptName: "dpd-live" } }]);
  };
  return { post, queries, variables };
}

describe("Cloudflare analytics query fallbacks", () => {
  beforeEach(() => resetCloudflareAnalyticsMemo());

  it("returns rows as numbers when every field is accepted", async () => {
    const api = fakeApi({ dataset: "workersInvocationsAdaptive" });
    const result = await queryCloudflareDataset(api.post, "acct", {
      dataset: "workersInvocationsAdaptive",
      sum: ["requests"],
      optionalSum: ["cpuTime"],
      dimensions: ["scriptName"],
      ...WINDOW,
    });
    assert.ok(result.ok);
    assert.equal(api.queries.length, 1);
    assert.deepEqual(result.rows[0], {
      sum: { requests: 42, cpuTime: 7 },
      max: {},
      dimensions: { scriptName: "dpd-live" },
    });
    assert.deepEqual(result.missing, []);
    assert.equal(result.granularity, "exact");
  });

  it("drops a field the API refuses and reports it as missing, not zero", async () => {
    const api = fakeApi({ dataset: "durableObjectsPeriodicGroups", unknownFields: ["duration"] });
    const result = await queryCloudflareDataset(api.post, "acct", {
      dataset: "durableObjectsPeriodicGroups",
      sum: ["cpuTime"],
      optionalSum: ["duration", "rowsWritten"],
      ...WINDOW,
    });
    assert.ok(result.ok);
    assert.deepEqual(result.missing, ["duration"]);
    assert.equal(api.queries.length, 2, "one refusal, one retry");
    assert.ok(api.queries[1]!.includes("rowsWritten"), "the other optional field is kept");
    assert.ok(!/\bduration\b/.test(api.queries[1]!));
  });

  it("does not ask again for a field it was already refused", async () => {
    const api = fakeApi({ dataset: "durableObjectsPeriodicGroups", unknownFields: ["duration"] });
    const args = {
      dataset: "durableObjectsPeriodicGroups",
      sum: ["cpuTime"],
      optionalSum: ["duration"],
      ...WINDOW,
    };
    await queryCloudflareDataset(api.post, "acct", args);
    const before = api.queries.length;
    const again = await queryCloudflareDataset(api.post, "acct", args);
    assert.ok(again.ok);
    assert.equal(api.queries.length, before + 1, "the second call goes straight through");
    assert.deepEqual(again.missing, ["duration"]);
  });

  it("falls back from a datetime filter to whole days and says so", async () => {
    const api = fakeApi({
      dataset: "durableObjectsPeriodicGroups",
      unknownFilters: ["datetime", "datetimeHour"],
    });
    const result = await queryCloudflareDataset(api.post, "acct", {
      dataset: "durableObjectsPeriodicGroups",
      sum: ["cpuTime"],
      ...WINDOW,
    });
    assert.ok(result.ok);
    assert.equal(result.granularity, "day");
    const last = api.variables[api.variables.length - 1]!;
    assert.deepEqual(Object.keys(last).sort(), ["accountTag", "endDate", "startDate"]);
    assert.equal(last.startDate, "2026-11-13");
  });

  it("gives up with the API's own message when nothing can be dropped", async () => {
    const post: CloudflarePost = async () => ({ errors: [{ message: "not authorized" }] });
    const result = await queryCloudflareDataset(post, "acct", {
      dataset: "r2OperationsAdaptiveGroups",
      sum: ["requests"],
      ...WINDOW,
    });
    assert.deepEqual(result, { ok: false, message: "not authorized" });
  });

  it("retries without the optional fields when the error names none of them", async () => {
    let calls = 0;
    const post: CloudflarePost = async (query) => {
      calls += 1;
      if (query.includes("rowsRead")) return { errors: [{ message: "bad selection" }] };
      return answer("durableObjectsPeriodicGroups", [{ sum: { cpuTime: 3 } }]);
    };
    const result = await queryCloudflareDataset(post, "acct", {
      dataset: "durableObjectsPeriodicGroups",
      sum: ["cpuTime"],
      optionalSum: ["rowsRead"],
      ...WINDOW,
    });
    assert.ok(result.ok);
    assert.equal(calls, 2);
    assert.deepEqual(result.missing, ["rowsRead"]);
  });
});
