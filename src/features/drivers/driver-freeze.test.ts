import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  freezeUiState,
  freezeWindowIsActive,
  formatFreezeLoginReason,
  resolvePasscodeLookup,
  resolvePasscodeLookupLegacy,
  type PasscodeLookupDriver,
} from "./driver-freeze";

const TODAY = "2026-09-22";

function rider(overrides: Partial<PasscodeLookupDriver> = {}): PasscodeLookupDriver {
  return {
    id: "d1",
    driver_code: "10001",
    status: "active",
    archived_at: null,
    is_blocked: false,
    blocked_reason: null,
    frozen_from: null,
    frozen_until: null,
    freeze_reason: null,
    ...overrides,
  };
}

/** Old APK in-session read: only `is_blocked` / `blocked_reason`. */
function oldApkInSession(row: {
  is_blocked: boolean;
  blocked_reason: string | null;
}): { blocked: boolean; reason: string | null } {
  if (!row.is_blocked) return { blocked: false, reason: null };
  return { blocked: true, reason: row.blocked_reason?.trim() || null };
}

describe("freezeWindowIsActive", () => {
  it("is inactive when either bound is missing", () => {
    assert.equal(freezeWindowIsActive(null, "2026-09-30", TODAY), false);
    assert.equal(freezeWindowIsActive("2026-09-01", null, TODAY), false);
    assert.equal(freezeWindowIsActive(null, null, TODAY), false);
  });

  it("is inclusive of start and end Kuwait days", () => {
    assert.equal(freezeWindowIsActive("2026-09-22", "2026-09-22", TODAY), true);
    assert.equal(freezeWindowIsActive("2026-09-20", "2026-09-22", TODAY), true);
    assert.equal(freezeWindowIsActive("2026-09-22", "2026-09-25", TODAY), true);
    assert.equal(freezeWindowIsActive("2026-09-23", "2026-09-25", TODAY), false);
    assert.equal(freezeWindowIsActive("2026-09-01", "2026-09-21", TODAY), false);
  });
});

describe("freezeUiState", () => {
  it("schedules a future window, activates today, expires after until", () => {
    assert.equal(freezeUiState("2026-09-23", "2026-09-24", TODAY), "scheduled");
    assert.equal(freezeUiState("2026-09-20", "2026-09-25", TODAY), "active");
    assert.equal(freezeUiState("2026-09-01", "2026-09-21", TODAY), "expired");
    assert.equal(freezeUiState(null, null, TODAY), "inactive");
  });
});

describe("login regression vs legacy / old APK", () => {
  it("NULL freeze window is byte-identical to the pre-freeze gate", () => {
    const cases = [
      rider(),
      rider({ is_blocked: true, blocked_reason: "Pending documents" }),
      rider({ archived_at: "2026-01-01T00:00:00Z" }),
      rider({ status: "suspended" }),
      rider({ status: "pending" }),
    ];
    for (const d of cases) {
      assert.deepEqual(resolvePasscodeLookup(d, TODAY), resolvePasscodeLookupLegacy(d));
    }
  });

  it("expired or future freeze does not change an otherwise-ok login", () => {
    const expired = rider({
      frozen_from: "2026-09-01",
      frozen_until: "2026-09-21",
      freeze_reason: "Leave",
    });
    assert.deepEqual(resolvePasscodeLookup(expired, TODAY), resolvePasscodeLookupLegacy(expired));

    const future = rider({
      frozen_from: "2026-09-23",
      frozen_until: "2026-09-30",
      freeze_reason: "Leave",
    });
    assert.deepEqual(resolvePasscodeLookup(future, TODAY), resolvePasscodeLookupLegacy(future));
  });

  it("old APK login still receives driver_blocked when the server freezes", () => {
    const frozen = rider({
      frozen_from: "2026-09-20",
      frozen_until: "2026-09-25",
      freeze_reason: "Investigation",
    });
    const server = resolvePasscodeLookup(frozen, TODAY);
    assert.equal(server.ok, false);
    if (!server.ok) {
      assert.equal(server.error, "driver_blocked");
      assert.equal(server.reason, formatFreezeLoginReason("Investigation", "2026-09-25"));
    }
  });

  it("old APK in-session select (no freeze columns) misses an active freeze — Play required", () => {
    const row = {
      is_blocked: false,
      blocked_reason: null,
      frozen_from: "2026-09-20",
      frozen_until: "2026-09-25",
      freeze_reason: "Leave",
    };
    assert.deepEqual(oldApkInSession(row), { blocked: false, reason: null });
    assert.equal(freezeWindowIsActive(row.frozen_from, row.frozen_until, TODAY), true);
  });
});

describe("precedence Block + Freeze", () => {
  it("block reason wins on login when both are active", () => {
    const both = rider({
      is_blocked: true,
      blocked_reason: "Policy violation",
      frozen_from: "2026-09-20",
      frozen_until: "2026-09-25",
      freeze_reason: "Leave",
    });
    const result = resolvePasscodeLookup(both, TODAY);
    assert.deepEqual(result, {
      ok: false,
      error: "driver_blocked",
      reason: "Policy violation",
    });
    assert.deepEqual(result, resolvePasscodeLookupLegacy(both));
  });
});
