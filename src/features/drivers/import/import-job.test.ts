import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IMPORT_HEARTBEAT_MS,
  IMPORT_JOB_STALE_MS,
  canCancelImportJob,
  canPauseImportJob,
  canResumeImportJob,
  importJobProgress,
  isImportJobStale,
  nextImportJobStatus,
  shouldAutoContinueImport,
  shouldBeatImportJob,
} from "./import-job";

describe("nextImportJobStatus", () => {
  it("pauses a running job and resumes a paused one", () => {
    assert.equal(nextImportJobStatus("running", "pause"), "paused");
    assert.equal(nextImportJobStatus("paused", "resume"), "running");
    assert.equal(canPauseImportJob("running"), true);
    assert.equal(canResumeImportJob("paused"), true);
  });

  it("cancels running or paused, and refuses a finished job", () => {
    assert.equal(nextImportJobStatus("running", "cancel"), "cancelled");
    assert.equal(nextImportJobStatus("paused", "cancel"), "cancelled");
    assert.equal(nextImportJobStatus("applied", "cancel"), null);
    assert.equal(canCancelImportJob("applied"), false);
  });

  it("finishes only a running job", () => {
    assert.equal(nextImportJobStatus("running", "finish"), "applied");
    assert.equal(nextImportJobStatus("paused", "finish"), null);
  });
});

describe("isImportJobStale", () => {
  it("treats a silent running job as stale so Resume can take it", () => {
    const now = Date.parse("2026-08-31T12:00:00.000Z");
    assert.equal(
      isImportJobStale("running", "2026-08-31T11:59:00.000Z", now),
      false,
    );
    assert.equal(
      isImportJobStale(
        "running",
        new Date(now - IMPORT_JOB_STALE_MS - 1).toISOString(),
        now,
      ),
      true,
    );
    assert.equal(isImportJobStale("paused", "2026-08-31T11:00:00.000Z", now), false);
  });
});

describe("long import chunk", () => {
  it("beats often enough that a chunk longer than the stale window stays running", () => {
    let lastBeat = 0;
    const chunkMs = IMPORT_JOB_STALE_MS * 3;
    assert.ok(chunkMs > IMPORT_JOB_STALE_MS);
    assert.ok(IMPORT_HEARTBEAT_MS < IMPORT_JOB_STALE_MS);
    for (let now = 0; now <= chunkMs; now += 1_000) {
      if (now === 0 || shouldBeatImportJob(lastBeat, now)) lastBeat = now;
      assert.ok(now - lastBeat <= IMPORT_JOB_STALE_MS);
    }
  });

  it("continues a stale pause and leaves a Pause click stopped", () => {
    assert.equal(shouldAutoContinueImport("paused", false, 40), true);
    assert.equal(shouldAutoContinueImport("paused", true, 40), false);
    assert.equal(shouldAutoContinueImport("paused", false, 0), false);
    assert.equal(shouldAutoContinueImport("running", false, 40), false);
  });
});

describe("importJobProgress", () => {
  it("counts processed ready rows", () => {
    assert.deepEqual(importJobProgress(80, 20), { done: 60, total: 80 });
    assert.deepEqual(importJobProgress(0, 0), { done: 0, total: 0 });
  });
});
