import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  GpsArchive,
  gunzipText,
  gzipText,
  importHourKey,
  inGpsRollout,
  kuwaitParts,
  parsePointLines,
  riderHourKey,
  rolloutBucket,
  type ArchivePoint,
  type BucketLike,
  type SqlLike,
} from "./gps-archive";

function memorySql(): SqlLike {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...(bindings as never[])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}

function memoryBucket(): BucketLike & { objects: Map<string, ArrayBuffer> } {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    async put(key, value) {
      objects.set(
        key,
        typeof value === "string" ? (new TextEncoder().encode(value).buffer as ArrayBuffer) : value,
      );
      return {};
    },
    async get(key) {
      const body = objects.get(key);
      return body ? { arrayBuffer: async () => body } : null;
    },
  };
}

// 2026-10-17 09:00:00 Kuwait = 06:00Z
const BASE = Date.UTC(2026, 9, 17, 6, 0, 0);
const DAY = "2026-10-17";

function point(t: number, la: number, lo: number, extra: Partial<ArchivePoint> = {}): ArchivePoint {
  return {
    t,
    la,
    lo,
    s: 5,
    a: 10,
    h: 90,
    b: 80,
    m: 0,
    st: "moving",
    d: null,
    ad: null,
    r: 0,
    ...extra,
  };
}

async function readObject(bucket: ReturnType<typeof memoryBucket>, key: string) {
  const body = bucket.objects.get(key);
  assert.ok(body, `missing ${key}`);
  return parsePointLines(await gunzipText(body));
}

test("kuwaitParts uses fixed UTC+3", () => {
  assert.deepEqual(kuwaitParts(Date.UTC(2026, 9, 17, 22, 30)), {
    day: "2026-10-18",
    hour: "01",
    minute: "30",
  });
});

test("rollout hash is stable and percent-bounded", () => {
  assert.equal(rolloutBucket("driver-a"), rolloutBucket("driver-a"));
  assert.ok(rolloutBucket("driver-a") >= 0 && rolloutBucket("driver-a") < 100);
  assert.equal(inGpsRollout("driver-a", 0), false);
  assert.equal(inGpsRollout("driver-a", 100), true);
  const ids = Array.from({ length: 2000 }, (_, i) => `rider-${i}`);
  const share = ids.filter((id) => inGpsRollout(id, 10)).length / ids.length;
  assert.ok(share > 0.06 && share < 0.14, `share ${share}`);
});

test("buffer appends across flushes and compaction writes one object per rider-hour", async () => {
  const sql = memorySql();
  const bucket = memoryBucket();
  const archive = new GpsArchive(sql, bucket);

  archive.record("r1", [point(BASE, 29.37, 47.97), point(BASE + 5_000, 29.3701, 47.97)], true);
  await archive.maybeFlush(BASE + 10_000, true);
  archive.record("r1", [point(BASE + 70_000, 29.3702, 47.97)], true);
  await archive.maybeFlush(BASE + 80_000, true);

  assert.equal(archive.bufferedPoints("r1", DAY).length, 3);
  assert.ok([...bucket.objects.keys()].some((key) => key.startsWith(`raw/${DAY}/0900`)));
  assert.equal(bucket.objects.has(riderHourKey("r1", DAY, "09")), false);

  await archive.maybeFlush(BASE + 3_600_000 + 1_000, true);
  const stored = await readObject(bucket, riderHourKey("r1", DAY, "09"));
  assert.deepEqual(
    stored.map((p) => p.t),
    [BASE, BASE + 5_000, BASE + 70_000],
  );
  assert.equal(archive.bufferedPoints("r1", DAY).length, 0);
  const [index] = archive.dayIndex("r1");
  assert.deepEqual(index?.keys, [riderHourKey("r1", DAY, "09")]);
  assert.equal(index?.points, 3);
});

test("readDay merges compacted R2 hours with the open buffer in time order", async () => {
  const archive = new GpsArchive(memorySql(), memoryBucket());
  archive.record("r1", [point(BASE, 29.37, 47.97), point(BASE + 5_000, 29.3701, 47.97)], true);
  await archive.maybeFlush(BASE + 3_600_000 + 1_000, true);
  archive.record("r1", [point(BASE + 3_600_000 + 2_000, 29.3702, 47.97)], true);
  const day = await archive.readDay("r1", DAY);
  assert.deepEqual(
    day.map((p) => p.t),
    [BASE, BASE + 5_000, BASE + 3_600_000 + 2_000],
  );
  assert.deepEqual(await archive.readDay("r2", DAY), []);
});

test("a late point reopens a compacted hour without losing earlier points", async () => {
  const bucket = memoryBucket();
  const archive = new GpsArchive(memorySql(), bucket);
  archive.record("r1", [point(BASE, 29.37, 47.97)], true);
  await archive.maybeFlush(BASE + 3_600_000 + 1_000, true);
  archive.record("r1", [point(BASE + 1_000, 29.37, 47.97, { r: 1 })], true);
  await archive.maybeFlush(BASE + 3_700_000, true);
  const stored = await readObject(bucket, riderHourKey("r1", DAY, "09"));
  assert.deepEqual(
    stored.map((p) => p.t),
    [BASE, BASE + 1_000],
  );
  assert.equal(archive.dayIndex("r1")[0]?.points, 2);
});

test("distance guards drop coarse fixes, jumps, and replays", async () => {
  const archive = new GpsArchive(memorySql(), memoryBucket());
  archive.record(
    "r1",
    [
      point(BASE, 29.37, 47.97),
      point(BASE + 10_000, 29.3709, 47.97), // ~100 m
      point(BASE + 20_000, 29.38, 47.97, { a: 300 }), // coarse
      point(BASE + 30_000, 29.39, 47.97), // ~2 km jump
      point(BASE + 40_000, 29.3718, 47.97, { r: 1 }), // replay
    ],
    true,
  );
  const stats = archive.dayStats("r1", DAY);
  assert.ok(stats);
  assert.ok(stats.distanceM > 95 && stats.distanceM < 105, `distance ${stats.distanceM}`);
  assert.equal(stats.points, 4);
});

test("day stats split moving, idle, dwell, out of zone, and mocked", async () => {
  const archive = new GpsArchive(memorySql(), memoryBucket());
  const idle = { s: 0, st: "idle" };
  archive.record("r1", [point(BASE, 29.37, 47.97), point(BASE + 60_000, 29.3705, 47.97)], true);
  const idlePoints: ArchivePoint[] = [];
  for (let i = 1; i <= 8; i += 1) {
    idlePoints.push(point(BASE + 60_000 + i * 60_000, 29.3705, 47.97, idle));
  }
  archive.record("r1", idlePoints, false);
  archive.record("r1", [point(BASE + 600_000, 29.3705, 47.97, { m: 1 })], true);

  const stats = archive.dayStats("r1", DAY);
  assert.ok(stats);
  assert.equal(stats.movingS, 60 + 60);
  assert.equal(stats.idleS, 480);
  assert.equal(stats.dwellS, 240);
  assert.equal(stats.outOfZoneS, 480);
  assert.equal(stats.mockedCount, 1);

  await archive.maybeFlush(BASE + 700_000, true);
  const unsynced = archive.unsyncedDayStats(10);
  assert.equal(unsynced.length, 1);
  archive.markDayStatsSynced(unsynced, BASE + 700_000);
  assert.equal(archive.unsyncedDayStats(10).length, 0);
});

test("imported hours merge into day_index and dedupe against compacted fixes", async () => {
  const bucket = memoryBucket();
  const archive = new GpsArchive(memorySql(), bucket);
  archive.record("r1", [point(BASE, 29.37, 47.97), point(BASE + 5_000, 29.3701, 47.97)], true);
  await archive.maybeFlush(BASE + 3_600_000 + 1_000, true);

  const imported = [point(BASE, 29.37, 47.97), point(BASE - 60_000, 29.369, 47.97)];
  const key = importHourKey("r1", DAY, "08");
  await bucket.put(key, await gzipText(imported.map((p) => JSON.stringify(p)).join("\n")));
  const row = { driverId: "r1", day: DAY, keys: [key], points: 2, distanceM: 50, firstTs: BASE - 60_000, lastTs: BASE };
  archive.registerImported(row);
  archive.registerImported(row);

  const [index] = archive.dayIndex("r1");
  assert.deepEqual(index?.keys, [key, riderHourKey("r1", DAY, "09")].sort());
  assert.equal(index?.points, 2);
  assert.equal(index?.firstTs, BASE - 60_000);
  assert.deepEqual(
    (await archive.readDay("r1", DAY)).map((p) => p.t),
    [BASE - 60_000, BASE, BASE + 5_000],
  );
});

test("latest pin survives a new archive instance on the same SQLite", async () => {
  const sql = memorySql();
  const first = new GpsArchive(sql, memoryBucket());
  first.record("r1", [point(BASE, 29.37, 47.97), point(BASE + 10_000, 29.3709, 47.97)], false);
  await first.maybeFlush(BASE + 20_000, true);

  const second = new GpsArchive(sql, memoryBucket());
  const [pin] = second.latestPins();
  assert.equal(pin?.driverId, "r1");
  assert.equal(pin?.t, BASE + 10_000);
  assert.equal(pin?.outOfZoneSince, BASE);
  assert.ok((pin?.distanceTodayM ?? 0) > 95);

  second.record("r1", [point(BASE + 20_000, 29.3718, 47.97)], false);
  assert.ok((second.dayStats("r1", DAY)?.distanceM ?? 0) > 190);
});
