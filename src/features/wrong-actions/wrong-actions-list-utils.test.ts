import { describe, expect, it } from "vitest";
import { WRONG_ACTION_SEVERITY_WEIGHT, type WrongActionRow } from "./types";
import {
  isWithinLastDays,
  kuwaitDayIndex,
  parseWrongActionTab,
  wrongActionKpis,
  wrongActionMatchesSearch,
  wrongActionMatchesTab,
} from "./wrong-actions-list-utils";

function row(overrides: Partial<WrongActionRow> = {}): WrongActionRow {
  return {
    id: "a",
    driver_id: "d1",
    action_type: "delay",
    severity: "low",
    details: null,
    occurred_at: "2026-08-20T09:00:00.000Z",
    source: "admin",
    created_at: "2026-08-20T09:05:00.000Z",
    created_by: null,
    driver_name: "Jenson Doe",
    driver_code: "10021",
    driver_zone_name: "Hawally",
    created_by_name: null,
    ...overrides,
  };
}

describe("parseWrongActionTab", () => {
  it("defaults anything unrecognised to all", () => {
    expect(parseWrongActionTab(undefined)).toBe("all");
    expect(parseWrongActionTab("nonsense")).toBe("all");
  });

  it("keeps the known tabs", () => {
    expect(parseWrongActionTab("high")).toBe("high");
    expect(parseWrongActionTab("week")).toBe("week");
  });
});

describe("kuwaitDayIndex", () => {
  it("puts 22:00 UTC on the next Kuwait day", () => {
    // 22:00 UTC is 01:00 Kuwait the following morning. A browser reading UTC
    // would file this incident against the wrong day, and the score would then
    // disagree with the rollup that computed it in Kuwait time.
    const late = kuwaitDayIndex("2026-08-20T22:00:00.000Z");
    const earlier = kuwaitDayIndex("2026-08-20T09:00:00.000Z");
    expect(late).toBe(earlier + 1);
  });

  it("returns NaN for an unreadable date rather than a plausible day", () => {
    expect(Number.isNaN(kuwaitDayIndex("not-a-date"))).toBe(true);
  });
});

describe("isWithinLastDays", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("counts today", () => {
    expect(isWithinLastDays("2026-08-20T05:00:00.000Z", 7, now)).toBe(true);
  });

  it("excludes the eighth day back", () => {
    expect(isWithinLastDays("2026-08-13T05:00:00.000Z", 7, now)).toBe(false);
    expect(isWithinLastDays("2026-08-14T05:00:00.000Z", 7, now)).toBe(true);
  });

  it("excludes the future", () => {
    expect(isWithinLastDays("2026-08-25T05:00:00.000Z", 7, now)).toBe(false);
  });
});

describe("wrongActionMatchesTab", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("matches everything on all", () => {
    expect(wrongActionMatchesTab(row({ severity: "high" }), "all", now)).toBe(true);
  });

  it("filters by severity", () => {
    expect(wrongActionMatchesTab(row({ severity: "high" }), "high", now)).toBe(true);
    expect(wrongActionMatchesTab(row({ severity: "low" }), "high", now)).toBe(false);
  });

  it("filters the week by the Kuwait day", () => {
    expect(
      wrongActionMatchesTab(row({ occurred_at: "2026-08-18T05:00:00.000Z" }), "week", now),
    ).toBe(true);
    expect(
      wrongActionMatchesTab(row({ occurred_at: "2026-07-18T05:00:00.000Z" }), "week", now),
    ).toBe(false);
  });
});

describe("wrongActionMatchesSearch", () => {
  it("matches an empty query", () => {
    expect(wrongActionMatchesSearch(row(), "  ")).toBe(true);
  });

  it("matches the driver code and the details", () => {
    expect(wrongActionMatchesSearch(row(), "10021")).toBe(true);
    expect(wrongActionMatchesSearch(row({ details: "Late at Salmiya" }), "salmiya")).toBe(true);
  });

  it("does not match an unrelated needle", () => {
    expect(wrongActionMatchesSearch(row(), "zzz")).toBe(false);
  });
});

describe("wrongActionKpis", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("weights severity rather than counting rows", () => {
    const rows = [
      row({ id: "1", severity: "high" }),
      row({ id: "2", severity: "low" }),
      row({ id: "3", severity: "low" }),
    ];
    const kpis = wrongActionKpis(rows, now);
    expect(kpis.total).toBe(3);
    // One high outweighs two lows, which is the whole reason the conduct
    // component weights instead of counting.
    expect(kpis.weighted).toBe(
      WRONG_ACTION_SEVERITY_WEIGHT.high + WRONG_ACTION_SEVERITY_WEIGHT.low * 2,
    );
    expect(kpis.high).toBe(1);
    expect(kpis.low).toBe(2);
    expect(kpis.medium).toBe(0);
  });

  it("counts a driver once however many incidents they have", () => {
    const rows = [
      row({ id: "1", driver_id: "d1" }),
      row({ id: "2", driver_id: "d1" }),
      row({ id: "3", driver_id: "d2" }),
    ];
    expect(wrongActionKpis(rows, now).driversInvolved).toBe(2);
  });

  it("counts this week on the Kuwait day", () => {
    const rows = [
      row({ id: "1", occurred_at: "2026-08-19T05:00:00.000Z" }),
      row({ id: "2", occurred_at: "2026-06-01T05:00:00.000Z" }),
    ];
    expect(wrongActionKpis(rows, now).thisWeek).toBe(1);
  });

  it("is all zeroes on an empty ledger", () => {
    const kpis = wrongActionKpis([], now);
    expect(kpis.total).toBe(0);
    expect(kpis.weighted).toBe(0);
    expect(kpis.driversInvolved).toBe(0);
  });
});
