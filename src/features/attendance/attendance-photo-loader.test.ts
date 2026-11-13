import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTENDANCE_PHOTO_BATCH,
  ATTENDANCE_PHOTO_CACHE_MS,
  createAttendancePhotoLoader,
  type AttendancePhotoBatch,
} from "./attendance-photo-loader";

/** A loader whose flush the test triggers by hand, and a record of what was fetched. */
function harness(answer: (keys: string[]) => AttendancePhotoBatch = (keys) =>
  Object.fromEntries(keys.map((key) => [key, { url: `https://signed/${key}`, contentType: "image/jpeg" }]))) {
  const calls: string[][] = [];
  const flushes: Array<() => void> = [];
  let clock = 1_000_000;
  const loader = createAttendancePhotoLoader(
    async (keys) => {
      calls.push(keys);
      return answer(keys);
    },
    { now: () => clock, schedule: (flush) => flushes.push(flush) },
  );
  return {
    loader,
    calls,
    flush: async () => {
      const pending = flushes.splice(0);
      for (const run of pending) run();
      await new Promise((resolve) => setImmediate(resolve));
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("attendance photo loader", () => {
  it("sends a page of rows as one request", async () => {
    const { loader, calls, flush } = harness();
    const pending = Array.from({ length: 80 }, (_, index) => loader.load(`drivers/d${index}/check-in.jpg`));
    await flush();
    const photos = await Promise.all(pending);
    assert.equal(calls.length, 1, "eighty rows, one server action");
    assert.equal(calls[0]!.length, 80);
    assert.equal(photos[3]!.url, "https://signed/drivers/d3/check-in.jpg");
  });

  it("asks once for a key two rows share", async () => {
    const { loader, calls, flush } = harness();
    const a = loader.load("drivers/x/p.jpg");
    const b = loader.load("drivers/x/p.jpg");
    await flush();
    assert.deepEqual(await a, await b);
    assert.deepEqual(calls, [["drivers/x/p.jpg"]]);
  });

  it("does not ask again while the answer is fresh, and does once it is old", async () => {
    const { loader, calls, flush, advance } = harness();
    const first = loader.load("drivers/x/p.jpg");
    await flush();
    await first;

    await loader.load("drivers/x/p.jpg");
    assert.equal(calls.length, 1, "a re-render or the page poll reuses the link");

    advance(ATTENDANCE_PHOTO_CACHE_MS);
    const later = loader.load("drivers/x/p.jpg");
    await flush();
    await later;
    assert.equal(calls.length, 2);
  });

  it("remembers that a photo is missing", async () => {
    const { loader, calls, flush } = harness(() => ({}));
    const first = loader.load("drivers/x/gone.jpg");
    await flush();
    assert.equal(await first, null);
    assert.equal(await loader.load("drivers/x/gone.jpg"), null);
    assert.equal(calls.length, 1);
  });

  it("does not remember a failed request", async () => {
    let fail = true;
    const calls: string[][] = [];
    const flushes: Array<() => void> = [];
    const loader = createAttendancePhotoLoader(
      async (keys) => {
        calls.push(keys);
        if (fail) throw new Error("network");
        return { [keys[0]!]: { url: "https://signed/ok", contentType: null } };
      },
      { schedule: (flush) => flushes.push(flush) },
    );
    const run = async () => {
      for (const flush of flushes.splice(0)) flush();
      await new Promise((resolve) => setImmediate(resolve));
    };

    // The handler is attached before the flush, as a row's own `.catch` is.
    const first = loader.load("drivers/x/p.jpg").then(
      () => "loaded",
      () => "failed",
    );
    await run();
    assert.equal(await first, "failed");

    fail = false;
    const second = loader.load("drivers/x/p.jpg");
    await run();
    assert.equal((await second)!.url, "https://signed/ok");
    assert.equal(calls.length, 2);
  });

  it("splits a very long page into turns", async () => {
    const { loader, calls, flush } = harness();
    const total = ATTENDANCE_PHOTO_BATCH + 20;
    const pending = Array.from({ length: total }, (_, index) => loader.load(`drivers/d${index}/p.jpg`));
    await flush();
    await Promise.all(pending);
    assert.deepEqual(calls.map((keys) => keys.length), [ATTENDANCE_PHOTO_BATCH, 20]);
  });
});
