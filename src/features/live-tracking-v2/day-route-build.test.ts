import assert from "node:assert/strict";
import { test } from "node:test";

import type { EdgeArchivePoint } from "@/lib/fleet/edge-read";

import { mergeArchivePoints } from "./day-route-build";

function point(t: number, la: number, lo: number): EdgeArchivePoint {
  return { t, la, lo, s: 0, a: 5, h: 90, b: 80, m: 0, st: "moving", d: null, ad: null, r: 0 };
}

// A night shift crossing Kuwait midnight.
const LATE = Date.parse("2026-10-19T23:50:00+03:00");
const EARLY = Date.parse("2026-10-20T00:10:00+03:00");

test("merges the two Kuwait days a night shift crosses", () => {
  const first = point(LATE, 29.37, 47.98);
  const second = point(LATE + 5 * 60_000, 29.371, 47.98);
  const third = point(EARLY, 29.372, 47.98);

  const merged = mergeArchivePoints(
    [[first, second], [third]],
    LATE - 60_000,
    EARLY + 60_000,
  );

  assert.deepEqual(
    merged.map((entry) => entry.t),
    [first.t, second.t, third.t],
  );
});

test("drops points outside the shift window", () => {
  const before = point(LATE - 3_600_000, 29.3, 47.9);
  const inside = point(LATE, 29.37, 47.98);
  const after = point(EARLY + 3_600_000, 29.4, 47.9);

  const merged = mergeArchivePoints([[before, inside], [after]], LATE - 60_000, EARLY);

  assert.deepEqual(
    merged.map((entry) => entry.t),
    [inside.t],
  );
});

test("dedupes a fix present in both day files", () => {
  const duplicated = point(LATE, 29.37, 47.98);
  const later = point(LATE + 1_000, 29.371, 47.98);

  const merged = mergeArchivePoints(
    [[duplicated, later], [duplicated]],
    LATE - 1,
    LATE + 2_000,
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((entry) => entry.t),
    [duplicated.t, later.t],
  );
});
