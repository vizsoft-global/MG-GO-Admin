import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "../core/fs";
import {
  applyGuard,
  BACKFILL_BATCH,
  buildApplyPlan,
  driverDayNumbers,
  FIXTURE_SOURCE,
  formatDryRunCounts,
  mismatchCount,
  planApplyWrites,
  planRollupDocuments,
  planSearchWrites,
  resumeSlice,
  scanPlanMismatches,
  scanRollupFacts,
  searchWriteUsesPrefixFields,
  syntheticComparisonFixture,
  SYNTHETIC_SAMPLE_DAYS,
  zoneMonthNumbers,
} from "../core/backfill-plan";
import { deliveryFactFromData, driverZoneMap } from "../core/backfill-apply";
import { COLLECTIONS } from "../core/collections";
import { applyAttendanceRollup, applyDeliveryRollup, driverDayId, zoneMonthId } from "../core/rollups";
import { createMemoryFirestore } from "./memory-firestore";

describe("backfill planner", () => {
  it("plans absolute search sets from the shared stamp helpers", () => {
    const fixture = syntheticComparisonFixture();
    assert.equal(fixture.source, FIXTURE_SOURCE);
    const once = planSearchWrites(fixture.searchDocs);
    const twice = planSearchWrites(fixture.searchDocs);
    assert.deepEqual(once, twice);
    assert.equal(once.length, 7);
    for (const write of once) {
      assert.equal(searchWriteUsesPrefixFields(write), true);
      for (const value of Object.values(write.set)) assert.equal(typeof value, "string");
    }
    const delivery = once.find((write) => write.collection === COLLECTIONS.deliveries);
    assert.equal(delivery?.set.order_id_lower, "ord-42");
    assert.equal(delivery?.set.rider_name_lower, "jenson doe");
    const driver = once.find((write) => write.collection === COLLECTIONS.drivers);
    assert.equal(driver?.set.name_lower, "jenson doe");
  });

  it("resumes in batches of 400 and stops at the end", () => {
    const rows = Array.from({ length: 900 }, (_, index) => ({ id: `row-${String(index).padStart(4, "0")}` }));
    const first = resumeSlice(rows, null);
    assert.equal(first.batch.length, BACKFILL_BATCH);
    assert.equal(first.checkpoint, "row-0399");
    const second = resumeSlice(rows, first.checkpoint);
    assert.equal(second.batch.length, BACKFILL_BATCH);
    assert.equal(second.batch[0]?.id, "row-0400");
    const third = resumeSlice(rows, second.checkpoint);
    assert.equal(third.batch.length, 100);
    assert.equal(third.checkpoint, null);
    const done = resumeSlice(rows, third.batch[third.batch.length - 1]?.id ?? null);
    assert.equal(done.batch.length, 0);
    const again = planRollupDocuments(
      [{ id: "d", driverId: "drv", zoneId: "z", day: "2026-01-01", status: "verified" }],
      [],
    );
    assert.equal(again.driverDays[0]?.data.partial, false);
    assert.deepEqual(again, planRollupDocuments(
      [{ id: "d", driverId: "drv", zoneId: "z", day: "2026-01-01", status: "verified" }],
      [],
    ));
  });

  it("refuses apply unless the scan matches and a snapshot id is set", () => {
    assert.deepEqual(
      applyGuard({ apply: false, confirm: undefined, snapshotId: undefined, scanMismatches: null }),
      { ok: true },
    );
    assert.deepEqual(
      applyGuard({ apply: true, confirm: undefined, snapshotId: "snap", scanMismatches: 0 }),
      { ok: false, code: 2, reason: "confirm_required" },
    );
    assert.deepEqual(
      applyGuard({ apply: true, confirm: "yes", snapshotId: "  ", scanMismatches: 0 }),
      { ok: false, code: 2, reason: "snapshot_required" },
    );
    assert.deepEqual(
      applyGuard({ apply: true, confirm: "yes", snapshotId: "snap", scanMismatches: null }),
      { ok: false, code: 2, reason: "comparison_required" },
    );
    const blocked = applyGuard({
      apply: true,
      confirm: "yes",
      snapshotId: "snap",
      scanMismatches: 2,
    });
    assert.deepEqual(blocked, { ok: false, code: 1, reason: "comparison_mismatch" });
    assert.deepEqual(
      applyGuard({ apply: true, confirm: "yes", snapshotId: "snap", scanMismatches: 0 }),
      { ok: true },
    );
    const text = formatDryRunCounts({
      source: "none",
      searchWrites: 0,
      driverDaySets: 0,
      zoneMonthSets: 0,
      byCollection: {},
    });
    assert.match(text, /dry_run=true/);
    assert.match(text, /writes=0/);
    assert.equal(text.includes("Jenson"), false);
    assert.equal(text.includes("{"), false);
  });
});

describe("synthetic rollup comparison", () => {
  it("matches the scan, the increment writer, and the set planner", async () => {
    const fixture = syntheticComparisonFixture();
    assert.ok(SYNTHETIC_SAMPLE_DAYS.length >= 7);
    const days = new Set(fixture.deliveries.map((row) => row.day));
    for (const month of [1, 2]) {
      const last = new Date(Date.UTC(2026, month, 0)).getUTCDate();
      for (let day = 1; day <= last; day += 1) {
        const key = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        assert.equal(days.has(key), true);
      }
    }
    assert.equal(fixture.deliveries.some((row) => row.status === "cancelled"), true);
    assert.equal(fixture.deliveries.some((row) => row.status === "rejected"), true);

    const scanned = scanRollupFacts(fixture.deliveries, fixture.attendance);
    assert.equal(scanPlanMismatches(fixture.deliveries, fixture.attendance), 0);
    const planned = planRollupDocuments(fixture.deliveries, fixture.attendance);
    const plannedDays = new Map(planned.driverDays.map((doc) => [doc.id, driverDayNumbers(doc.data)]));
    const plannedZones = new Map(planned.zoneMonths.map((doc) => [doc.id, zoneMonthNumbers(doc.data)]));
    assert.equal(mismatchCount(scanned.driverDays, plannedDays), 0);
    assert.equal(mismatchCount(scanned.zones, plannedZones), 0);
    assert.equal(planned.zoneMonths.some((doc) => doc.id === "zone-a_2026-01"), true);
    assert.equal(planned.zoneMonths.some((doc) => doc.id === "zone-a_2026-02"), true);

    for (const doc of planned.driverDays) {
      const driverId = doc.data.driver_id;
      const day = doc.data.day;
      assert.equal(typeof driverId, "string");
      assert.equal(typeof day, "string");
      assert.equal(doc.id, driverDayId(driverId as string, day as string));
      assert.equal(doc.data.partial, false);
    }
    for (const doc of planned.zoneMonths) {
      assert.equal(doc.id, zoneMonthId(doc.data.zone_id as string, doc.data.month as string));
      assert.equal(doc.data.partial, false);
    }

    const db = createMemoryFirestore();
    const firestore = db as unknown as Firestore;
    for (const row of fixture.deliveries) {
      await applyDeliveryRollup(firestore, {
        deliveryId: row.id,
        driverId: row.driverId,
        zoneId: row.zoneId,
        day: row.day,
        status: row.status,
      });
    }
    for (const row of fixture.attendance) {
      await applyAttendanceRollup(firestore, {
        driverId: row.driverId,
        zoneId: row.zoneId,
        day: row.day,
        logId: row.id,
        present: row.present,
      });
    }

    const writtenDays = new Map<string, Record<string, number>>();
    const writtenZones = new Map<string, Record<string, number>>();
    for (const [path, data] of db.dump()) {
      const parts = path.split("/");
      if (parts.length !== 2) continue;
      if (parts[0] === COLLECTIONS.rollupsDriverDay) writtenDays.set(parts[1] ?? "", driverDayNumbers(data));
      if (parts[0] === COLLECTIONS.rollupsZoneMonth) writtenZones.set(parts[1] ?? "", zoneMonthNumbers(data));
    }
    assert.equal(mismatchCount(scanned.driverDays, writtenDays), 0);
    assert.equal(mismatchCount(scanned.zones, writtenZones), 0);

    const broken = new Map(plannedDays);
    const first = broken.keys().next().value;
    assert.ok(first);
    const poisoned = { ...broken.get(first) };
    poisoned.verified = (poisoned.verified ?? 0) + 1;
    broken.set(first, poisoned);
    const mismatches = mismatchCount(scanned.driverDays, broken);
    assert.ok(mismatches > 0);
    const guard = applyGuard({
      apply: true,
      confirm: "yes",
      snapshotId: "snap",
      scanMismatches: mismatches,
    });
    assert.equal(guard.ok, false);
    if (!guard.ok) assert.equal(guard.code, 1);

    const built = buildApplyPlan(fixture);
    assert.equal(built.mismatches, 0);
    assert.deepEqual(built.writes, planApplyWrites({
      search: planSearchWrites(fixture.searchDocs),
      rollups: planned,
      deliveries: fixture.deliveries,
      attendance: fixture.attendance,
    }));
    const searchWrite = built.writes.find((write) => write.path.startsWith(`${COLLECTIONS.deliveries}/`));
    assert.equal(searchWrite?.merge, true);
    const parent = built.writes.find((write) => write.path === `${COLLECTIONS.rollupsDriverDay}/${planned.driverDays[0]?.id}`);
    assert.equal(parent?.merge, false);
    assert.equal(parent?.data.partial, false);
    const sample = fixture.deliveries[0];
    assert.ok(sample);
    const marker = built.writes.find((write) => write.path.endsWith(`/applied/${sample.id}`));
    assert.equal(marker?.merge, false);
    assert.equal(marker?.data.status, sample.status);
    const ids = new Set(built.writes.map((write) => write.id));
    assert.equal(ids.size, built.writes.length);
  });
});

describe("production fact mapping", () => {
  it("uses the driver zone and skips a missing driver", () => {
    const zones = driverZoneMap([
      { id: "drv", data: { zone_id: "driver-zone", archived_at: null } },
      { id: "gone", data: { zone_id: "old", archived_at: "2026-01-01" } },
    ]);
    const fact = deliveryFactFromData(
      "del-1",
      { driver_id: "drv", shift_date: "2026-01-05", status: "verified", zone_id: "delivery-zone" },
      zones,
    );
    assert.equal(fact?.zoneId, "driver-zone");
    assert.equal(
      deliveryFactFromData("del-2", { driver_id: "gone", shift_date: "2026-01-05", status: "verified" }, zones),
      null,
    );
    assert.equal(
      deliveryFactFromData("del-3", { driver_id: "missing", shift_date: "2026-01-05", status: "verified" }, zones),
      null,
    );
  });
});
