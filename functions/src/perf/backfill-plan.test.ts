import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "../core/fs";
import {
  applyGuard,
  BACKFILL_BATCH,
  driverDayNumbers,
  FIXTURE_SOURCE,
  formatDryRunCounts,
  mismatchCount,
  planRollupDocuments,
  planSearchWrites,
  resumeSlice,
  searchWriteUsesPrefixFields,
  syntheticComparisonFixture,
  SYNTHETIC_SAMPLE_DAYS,
  zoneMonthNumbers,
  type AttendanceFact,
  type DeliveryFact,
} from "../core/backfill-plan";
import { COLLECTIONS } from "../core/collections";
import { applyAttendanceRollup, applyDeliveryRollup, driverDayId, zoneMonthId } from "../core/rollups";
import { createMemoryFirestore } from "./memory-firestore";

const STATUSES = ["verified", "pending", "in_transit", "under_review", "rejected", "cancelled"] as const;

function scanFixture(deliveries: readonly DeliveryFact[], attendance: readonly AttendanceFact[]) {
  const days = new Map<string, { zoneId: string | null; counts: Record<string, number> }>();
  const ensure = (driverId: string, day: string, zoneId: string | null) => {
    const id = `${driverId}_${day}`;
    const existing = days.get(id);
    if (existing) {
      if (existing.zoneId === null) existing.zoneId = zoneId;
      return existing;
    }
    const counts: Record<string, number> = {
      verified: 0,
      pending: 0,
      in_transit: 0,
      under_review: 0,
      rejected: 0,
      cancelled: 0,
      orders: 0,
      attendance_present: 0,
    };
    const created = { zoneId, counts };
    days.set(id, created);
    return created;
  };

  for (const row of deliveries) {
    if (!(STATUSES as readonly string[]).includes(row.status)) continue;
    const bucket = ensure(row.driverId, row.day, row.zoneId);
    bucket.counts[row.status] = (bucket.counts[row.status] ?? 0) + 1;
    bucket.counts.orders = bucket.counts.verified ?? 0;
  }
  for (const row of attendance) {
    if (!row.present) continue;
    const bucket = ensure(row.driverId, row.day, row.zoneId);
    bucket.counts.attendance_present = (bucket.counts.attendance_present ?? 0) + 1;
  }

  const zones = new Map<string, Record<string, number>>();
  for (const [id, bucket] of days) {
    if (!bucket.zoneId) continue;
    const day = id.slice(id.lastIndexOf("_") + 1);
    const month = day.slice(0, 7);
    const zoneId = `${bucket.zoneId}_${month}`;
    const zone = zones.get(zoneId) ?? {
      verified: 0,
      pending: 0,
      in_transit: 0,
      under_review: 0,
      rejected: 0,
      cancelled: 0,
      orders: 0,
      attendance_present: 0,
      verified_driver_days: 0,
      attendance_days: 0,
    };
    for (const status of STATUSES) zone[status] = (zone[status] ?? 0) + (bucket.counts[status] ?? 0);
    zone.orders = (zone.orders ?? 0) + (bucket.counts.verified ?? 0);
    if ((bucket.counts.verified ?? 0) > 0) zone.verified_driver_days = (zone.verified_driver_days ?? 0) + 1;
    if ((bucket.counts.attendance_present ?? 0) > 0) zone.attendance_days = (zone.attendance_days ?? 0) + 1;
    zones.set(zoneId, zone);
  }

  const driverDays = new Map<string, Record<string, number>>();
  for (const [id, bucket] of days) driverDays.set(id, bucket.counts);
  return { driverDays, zones };
}

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

  it("refuses apply when the comparison mismatches", () => {
    assert.deepEqual(applyGuard({ apply: false, confirm: undefined, report: null }), { ok: true });
    assert.equal(applyGuard({ apply: true, confirm: undefined, report: null }).ok, false);
    assert.equal(applyGuard({ apply: true, confirm: "yes", report: null }).ok, false);
    const blocked = applyGuard({
      apply: true,
      confirm: "yes",
      report: { source: FIXTURE_SOURCE, mismatches: 2, driverDays: 1, zoneMonths: 1 },
    });
    assert.deepEqual(blocked, { ok: false, code: 1, reason: "comparison_mismatch" });
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

    const scanned = scanFixture(fixture.deliveries, fixture.attendance);
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
      report: { source: FIXTURE_SOURCE, mismatches, driverDays: broken.size, zoneMonths: plannedZones.size },
    });
    assert.equal(guard.ok, false);
    if (!guard.ok) assert.equal(guard.code, 1);
  });
});
