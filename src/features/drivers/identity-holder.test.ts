import assert from "node:assert/strict";
import { test } from "node:test";
import { holderIsReleasable, lockOwnerIsStale } from "./identity-holder";

test("a live driver with a profile keeps its identity", () => {
  assert.equal(holderIsReleasable({ archivedAt: null, hasProfile: true }), false);
});

test("an archived driver released its identity", () => {
  assert.equal(holderIsReleasable({ archivedAt: "2026-10-01T00:00:00.000Z", hasProfile: true }), true);
});

test("a driver row that never got a profile cannot hold an identity", () => {
  assert.equal(holderIsReleasable({ archivedAt: null, hasProfile: false }), true);
});

test("a lock whose owner record is gone is stale", () => {
  assert.equal(lockOwnerIsStale({ found: false, intakeArchived: false, driver: null }), true);
});

test("a lock on an archived intake is stale", () => {
  assert.equal(
    lockOwnerIsStale({ found: true, intakeArchived: true, driver: { archivedAt: null, hasProfile: true } }),
    true,
  );
});

test("a lock on a live driver without a profile is stale", () => {
  assert.equal(
    lockOwnerIsStale({ found: true, intakeArchived: false, driver: { archivedAt: null, hasProfile: false } }),
    true,
  );
});

test("an open intake awaiting its rider keeps the identity", () => {
  assert.equal(lockOwnerIsStale({ found: true, intakeArchived: false, driver: null }), false);
});

test("a live rider keeps the identity against a new claim", () => {
  assert.equal(
    lockOwnerIsStale({ found: true, intakeArchived: false, driver: { archivedAt: null, hasProfile: true } }),
    false,
  );
});
