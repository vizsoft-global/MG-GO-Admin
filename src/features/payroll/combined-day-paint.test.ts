import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PAYROLL_DAY_PAINT, type DayStatus } from "./payroll-formulas";

/**
 * `dayClass()` returns Tailwind literals (the scanner needs the literal), so it
 * cannot be built from `PAYROLL_DAY_PAINT` at runtime. This is the guard that the
 * two lists stay one palette — a day cannot look green on one grid and red on the
 * other, and the Excel fill follows `PAYROLL_DAY_PAINT` directly.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/features/payroll/payroll-grid.tsx"), "utf8");

function classFor(status: DayStatus): string {
  const match = new RegExp(`case "${status}":`).exec(SOURCE);
  assert.ok(match, `dayClass has no case for ${status}`);
  // Shared cases fall through, so read to the first `return "…"` after this case.
  const returned = /return "([^"]+)"/.exec(SOURCE.slice(match.index));
  assert.ok(returned, `dayClass case for ${status} returns nothing`);
  return returned[1]!;
}

function classHexes(status: DayStatus): string[] {
  return classFor(status).match(/#[0-9A-Fa-f]{6}/g) ?? [];
}

describe("dayClass uses the shared day palette", () => {
  const statuses: DayStatus[] = [
    "work",
    "reduced3",
    "half",
    "actual",
    "off",
    "sick",
    "leave",
    "accident",
    "new_hire",
    "training",
    "absent",
    "terminated",
    "phone_issue",
    "id_suspended",
    "vehicle",
    // `cancelled` is decided per row (tile colour), so the dedicated test below
    // reads its branch instead of guessing the first literal.
    "abs_lh",
    "abs_lo",
    "custom",
  ];

  for (const status of statuses) {
    it(`${status} paints ${PAYROLL_DAY_PAINT[status].fill}`, () => {
      const paint = PAYROLL_DAY_PAINT[status];
      if (paint.fill === "#FFFFFF") {
        assert.match(classFor(status), /bg-white/, status);
      } else {
        assert.ok(
          classHexes(status).map((hex) => hex.toUpperCase()).includes(paint.fill.toUpperCase()),
          `${status} → ${classFor(status)}`,
        );
      }
      if (paint.border) {
        assert.ok(
          classHexes(status).map((hex) => hex.toUpperCase()).includes(paint.border.toUpperCase()),
          `${status} border ${paint.border} → ${classFor(status)}`,
        );
      }
    });
  }

  it("draws a border as a ring wherever the paint asks for one", () => {
    // SOP §3: Active is plain white — no ring at all.
    assert.doesNotMatch(classFor("work"), /ring-1 ring-inset/);
    assert.match(classFor("half"), /ring-1 ring-inset/);
    assert.match(classFor("abs_lo"), /ring-1 ring-inset/);
  });

  it("paints Cancelled with the tile colour, green on an End of Contract", () => {
    assert.match(SOURCE, /case "cancelled":[\s\S]{0,220}isEndOfContract/);
    assert.match(SOURCE, /bg-\[#1E6B3A\] text-white/);
    assert.match(SOURCE, /bg-\[#D13B3B\] text-white/);
  });
});
