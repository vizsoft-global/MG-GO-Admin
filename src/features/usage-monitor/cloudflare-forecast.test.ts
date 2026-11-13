import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLOUDFLARE_PRICES,
  EMPTY_CLOUDFLARE_USAGE,
  billableDoRequests,
  classifyR2Action,
  forecastCloudflareMonthly,
} from "./cloudflare-forecast";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

describe("Cloudflare monthly forecast", () => {
  it("costs the plan minimum when nothing is used", () => {
    const forecast = forecastCloudflareMonthly(EMPTY_CLOUDFLARE_USAGE, 24, null);
    assert.equal(forecast.total, CLOUDFLARE_PRICES.baseMonthly);
  });

  it("stays at the minimum inside every included allowance", () => {
    // Per day: 300k worker requests (9M a month), 30k DO requests (0.9M a month).
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, workerRequests: 300_000, doRequests: 30_000 },
      24,
      5_000_000_000,
    );
    assert.equal(forecast.total, CLOUDFLARE_PRICES.baseMonthly);
  });

  it("prices worker requests beyond ten million a month", () => {
    // 1M a day -> 30M a month -> 20M paid x $0.30.
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, workerRequests: 1_000_000 },
      24,
      null,
    );
    close(forecast.workerRequests, 6);
  });

  it("bills incoming WebSocket messages at twenty to one", () => {
    const usage = { ...EMPTY_CLOUDFLARE_USAGE, doRequests: 1_000, doWebsocketMessages: 200_000 };
    assert.equal(billableDoRequests(usage), 11_000);

    // 7M messages a day -> 350k requests a day -> 10.5M a month -> 9.5M paid x $0.15.
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, doWebsocketMessages: 7_000_000 },
      24,
      null,
    );
    close(forecast.doRequests, 9.5 * 0.15);
  });

  it("prices rows written beyond fifty million a month", () => {
    // 2.5M a day -> 75M a month -> 25M paid x $1.
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, doRowsWritten: 2_500_000 },
      24,
      null,
    );
    close(forecast.doRows, 25);
  });

  it("prices Durable Object duration beyond 400k GB-seconds", () => {
    // 20k GB-s a day -> 600k a month -> 200k paid x $12.50 per million.
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, doDurationGbs: 20_000 },
      24,
      null,
    );
    close(forecast.doDuration, 2.5);
  });

  it("prices R2 operations by class and storage by level", () => {
    // Class A: 100k a day -> 3M a month -> 2M paid x $4.50 = $9.
    // Storage: 110 GB -> 100 GB paid x $0.015 = $1.50, the same for any window.
    const day = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, r2ClassA: 100_000 },
      24,
      110_000_000_000,
    );
    close(day.r2Operations, 9);
    close(day.r2Storage, 1.5);

    const hour = forecastCloudflareMonthly(EMPTY_CLOUDFLARE_USAGE, 1, 110_000_000_000);
    close(hour.r2Storage, 1.5);
  });

  it("gives the same answer for the same hourly rate through any window", () => {
    const perHour = 500_000;
    const one = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, workerRequests: perHour },
      1,
      null,
    );
    const five = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, workerRequests: perHour * 5 },
      5,
      null,
    );
    close(one.total, five.total);
  });

  it("leaves an unknown figure out instead of inventing a cost for it", () => {
    const forecast = forecastCloudflareMonthly(
      { ...EMPTY_CLOUDFLARE_USAGE, workerCpuMs: null, doDurationGbs: null },
      24,
      null,
    );
    assert.equal(forecast.workerCpu, 0);
    assert.equal(forecast.doDuration, 0);
  });
});

describe("R2 operation classes", () => {
  it("sorts writes, reads and free operations", () => {
    assert.equal(classifyR2Action("PutObject"), "A");
    assert.equal(classifyR2Action("ListObjects"), "A");
    assert.equal(classifyR2Action("LifecycleStorageTierTransition"), "A");
    assert.equal(classifyR2Action("GetObject"), "B");
    assert.equal(classifyR2Action("HeadObject"), "B");
    assert.equal(classifyR2Action("DeleteObject"), "free");
    assert.equal(classifyR2Action("SomethingNew"), "B", "an unlisted operation is priced as a read");
  });
});
