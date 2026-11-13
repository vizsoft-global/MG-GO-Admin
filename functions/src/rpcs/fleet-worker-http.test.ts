import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKER_HTTP_FUNCTIONS } from "../router/lanes";
import { moduleForFunction } from "../router/legacy-modules";
import { WORKER_API_HANDLERS, workerApiTarget } from "./fleet-worker-http";
import { WORKER_HTTP_CAPACITY, WORKER_HTTP_STANDBY_CAPACITY } from "./worker-http-capacity";

describe("workerApi, the tracking server's one door", () => {
  it("serves every job the three single-purpose doors serve, under the same names", () => {
    const singles = WORKER_HTTP_FUNCTIONS.filter((name) => name !== "workerApi");
    assert.deepEqual([...singles].sort(), Object.keys(WORKER_API_HANDLERS).sort());
  });

  it("reads the job from the last segment of the path", () => {
    assert.equal(workerApiTarget("/adminIngestDriverPositions"), "adminIngestDriverPositions");
    assert.equal(workerApiTarget("/workerApi/workerFleetRead"), "workerFleetRead");
    assert.equal(workerApiTarget("/adminRecordFleetEvents/"), "adminRecordFleetEvents");
    assert.equal(workerApiTarget("/adminRecordFleetEvents?x=1"), "adminRecordFleetEvents");
  });

  it("refuses a name that is not one of its jobs", () => {
    assert.equal(workerApiTarget("/"), null);
    assert.equal(workerApiTarget(""), null);
    assert.equal(workerApiTarget(undefined), null);
    assert.equal(workerApiTarget("/adminApi"), null);
    assert.equal(workerApiTarget("/workerApi"), null);
    // An inherited property name is not a job.
    assert.equal(workerApiTarget("/constructor"), null);
    assert.equal(workerApiTarget("/__proto__"), null);
  });

  it("is published, and off every lane like the doors it replaces", () => {
    assert.equal(moduleForFunction("workerApi"), "./rpcs/fleet-worker-http");
    assert.ok((WORKER_HTTP_FUNCTIONS as readonly string[]).includes("workerApi"));
  });

  it("keeps one instance warm; the standby doors keep none", () => {
    assert.equal(WORKER_HTTP_CAPACITY.minInstances, 1);
    assert.equal(WORKER_HTTP_STANDBY_CAPACITY.minInstances, 0);
    // Same room for a burst, should the tracking server be pointed back at them.
    assert.equal(WORKER_HTTP_STANDBY_CAPACITY.maxInstances, WORKER_HTTP_CAPACITY.maxInstances);
    assert.equal(WORKER_HTTP_STANDBY_CAPACITY.concurrency, WORKER_HTTP_CAPACITY.concurrency);
    assert.equal(WORKER_HTTP_STANDBY_CAPACITY.cpu, 1);

    const source = readFileSync(new URL("./fleet-worker-http.ts", import.meta.url), "utf8");
    assert.match(source, /export const workerApi = onRequest\(workerHttp,/);
    assert.match(source, /return onRequest\(workerHttpStandby,/);
  });
});
