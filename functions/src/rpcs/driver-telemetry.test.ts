import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEEDED_TELEMETRY_EVENT_TYPES,
  pickTelemetryEvents,
  sanitizeTelemetryContext,
  stageTelemetryItems,
} from "./driver-telemetry";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID_B = "22222222-2222-4222-8222-222222222222";

function item(over: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    event_name: "screen.open",
    client_ts: "2026-10-09T12:00:00.000Z",
    severity: "info",
    context: { screen: "home", from_screen: "login", load_ms: 40 },
    ...over,
  };
}

describe("sanitizeTelemetryContext", () => {
  const allowed = SEEDED_TELEMETRY_EVENT_TYPES["screen.open"]!.context_keys;

  it("keeps allowlisted scalars and strips the rest", () => {
    const out = sanitizeTelemetryContext(
      {
        screen: "home",
        from_screen: "login",
        load_ms: 12,
        token: "secret",
        nested: { a: 1 },
        extra: true,
      },
      allowed,
    );
    assert.deepEqual(out.context, { screen: "home", from_screen: "login", load_ms: 12 });
    assert.equal(out.stripped, 3);
  });

  it("rejects identifier keys that are not snake tokens", () => {
    const out = sanitizeTelemetryContext(
      { screen: "Home Screen", from_screen: "login", load_ms: 1 },
      allowed,
    );
    assert.deepEqual(out.context, { from_screen: "login", load_ms: 1 });
    assert.equal(out.stripped, 1);
  });

  it("truncates strings at 120", () => {
    const long = "a".repeat(200);
    const out = sanitizeTelemetryContext({ screen: "home", load_ms: long }, ["screen", "load_ms"]);
    assert.equal((out.context["load_ms"] as string).length, 120);
  });
});

describe("pickTelemetryEvents", () => {
  it("accepts p_events, events, or a bare array", () => {
    assert.deepEqual(pickTelemetryEvents({ p_events: [1] }), [1]);
    assert.deepEqual(pickTelemetryEvents({ events: [2] }), [2]);
    assert.deepEqual(pickTelemetryEvents([3]), [3]);
  });
});

describe("stageTelemetryItems", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  const types = SEEDED_TELEMETRY_EVENT_TYPES;

  it("rejects invalid, unknown, inactive, and skewed events", () => {
    const catalog = {
      ...types,
      "qa.inactive": { category: "lifecycle", is_active: false, context_keys: [] as const },
    };
    const { staged, rejects } = stageTelemetryItems(
      [
        { event_name: "screen.open" },
        item({ event_id: EVENT_ID_B, event_name: "not.a.real.event" }),
        item({
          event_id: "44444444-4444-4444-8444-444444444444",
          event_name: "qa.inactive",
        }),
        item({
          event_id: "33333333-3333-4333-8333-333333333333",
          client_ts: "2010-01-01T00:00:00.000Z",
        }),
      ],
      { now, types: catalog, fallbackVersionCode: 90 },
    );
    assert.equal(staged.length, 0);
    assert.deepEqual(
      rejects.map((row) => row.reason),
      ["invalid_event", "unknown_event_name", "event_name_inactive", "client_ts_out_of_range"],
    );
  });

  it("forces client.error severity and keeps two same-id rows staged", () => {
    const { staged, rejects } = stageTelemetryItems(
      [
        item({
          event_name: "client.error",
          severity: "info",
          context: { code: "timeout", screen: "home", retryable: true },
        }),
        item({
          event_name: "client.error",
          severity: "warn",
          context: { code: "timeout", screen: "home" },
        }),
      ],
      { now, types, fallbackVersionCode: 83 },
    );
    assert.equal(rejects.length, 0);
    assert.equal(staged.length, 2);
    assert.equal(staged[0]?.severity, "error");
    assert.equal(staged[0]?.app_version_code, 83);
  });

  it("rejects sanitised context over 1024 chars", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `k${index}`);
    const fat: Record<string, string> = {};
    for (const key of keys) fat[key] = "x".repeat(120);
    const { rejects } = stageTelemetryItems(
      [item({ context: fat, event_name: "app.startup" })],
      {
        now,
        types: {
          ...types,
          "app.startup": { category: "lifecycle", is_active: true, context_keys: keys },
        },
        fallbackVersionCode: null,
      },
    );
    assert.equal(rejects[0]?.reason, "context_too_large");
  });
});
