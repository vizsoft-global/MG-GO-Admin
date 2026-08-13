import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatClockSkew,
  humanizeTelemetryCategory,
  humanizeTelemetryEvent,
  telemetryCategoryTone,
  telemetryMessageKey,
} from "./telemetry-labels";

describe("telemetryMessageKey", () => {
  it("strips the dot next-intl would read as nesting", () => {
    assert.equal(telemetryMessageKey("screen.open"), "screen_open");
    assert.equal(
      telemetryMessageKey("permission.location_denied"),
      "permission_location_denied",
    );
  });
});

describe("humanizeTelemetryEvent", () => {
  it("drops the prefix and reads as a sentence", () => {
    assert.equal(humanizeTelemetryEvent("permission.location_denied"), "Location denied");
    assert.equal(humanizeTelemetryEvent("queue.flushed"), "Flushed");
    assert.equal(humanizeTelemetryEvent("app.client_info"), "Client info");
  });

  it("handles a name with no prefix and keeps an empty tail readable", () => {
    assert.equal(humanizeTelemetryEvent("startup"), "Startup");
    assert.equal(humanizeTelemetryEvent("queue."), "queue.");
  });
});

describe("humanizeTelemetryCategory", () => {
  it("reads underscored categories as words", () => {
    assert.equal(humanizeTelemetryCategory("client_error"), "Client error");
    assert.equal(humanizeTelemetryCategory("network"), "Network");
  });
});

describe("telemetryCategoryTone", () => {
  it("marks client errors red and falls back to neutral", () => {
    assert.equal(telemetryCategoryTone("client_error"), "danger");
    assert.equal(telemetryCategoryTone("permission"), "warning");
    assert.equal(telemetryCategoryTone("something_new"), "neutral");
  });
});

describe("formatClockSkew", () => {
  it("scales the unit so minutes of skew are obvious and jitter is not", () => {
    assert.equal(formatClockSkew(null), "—");
    assert.equal(formatClockSkew(420), "420 ms");
    assert.equal(formatClockSkew(-420), "-420 ms");
    assert.equal(formatClockSkew(2500), "2.5 s");
    assert.equal(formatClockSkew(-180_000), "-3 min");
  });
});
