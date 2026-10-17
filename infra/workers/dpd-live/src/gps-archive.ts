import { haversineMeters } from "./geo";

/** Compact on-disk point. Keys are short because they repeat ~360k times an hour. */
export type ArchivePoint = {
  t: number;
  la: number;
  lo: number;
  s: number | null;
  a: number | null;
  h: number | null;
  b: number | null;
  m: 0 | 1;
  st: string;
  d: string | null;
  ad: string | null;
  r: 0 | 1;
};

export type SqlLike = {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
};

export type BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
};

export type LatestPin = {
  driverId: string;
  lat: number;
  lng: number;
  t: number;
  speedMps: number | null;
  headingDeg: number | null;
  accuracyM: number | null;
  batteryPct: number | null;
  isMocked: boolean;
  trackingStatus: string;
  distanceTodayM: number;
  outOfZoneSince: number | null;
  day: string;
};

export type DayStats = {
  movingS: number;
  idleS: number;
  dwellS: number;
  outOfZoneS: number;
  mockedCount: number;
  points: number;
  distanceM: number;
};

export type DayIndexRow = {
  driverId: string;
  day: string;
  keys: string[];
  points: number;
  distanceM: number;
  firstTs: number | null;
  lastTs: number | null;
};

const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
export const ARCHIVE_FLUSH_MS = 60_000;
const MAX_STAT_GAP_MS = 120_000;
const DWELL_AFTER_MS = 300_000;
const MOVING_MIN_MPS = 1.5;
const MAX_ACCURACY_M = 50;
const MAX_SEGMENT_M = 500;
const MAX_SEGMENT_MPS = 40;
const COMPACT_ROWS_PER_FLUSH = 200;

export function kuwaitParts(ms: number): { day: string; hour: string; minute: string } {
  const iso = new Date(ms + KUWAIT_OFFSET_MS).toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13), minute: iso.slice(14, 16) };
}

/** FNV-1a; stable across the Worker and Cloud Functions so both agree who is in the rollout. */
export function rolloutBucket(driverId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < driverId.length; i += 1) {
    hash ^= driverId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function inGpsRollout(driverId: string, percent: number): boolean {
  if (!(percent > 0)) return false;
  if (percent >= 100) return true;
  return rolloutBucket(driverId) < percent;
}

export async function gzipText(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function gunzipText(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export function riderHourKey(driverId: string, day: string, hour: string): string {
  return `rider/${driverId}/${day}/${hour}.jsonl.gz`;
}

/** Export prefix, kept apart from `rider/` so an import can never overwrite a compacted hour. */
export function importHourKey(driverId: string, day: string, hour: string): string {
  return `import/${driverId}/${day}/${hour}.jsonl.gz`;
}

export function parsePointLines(text: string): ArchivePoint[] {
  const out: ArchivePoint[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ArchivePoint;
      if (typeof parsed.t === "number" && typeof parsed.la === "number") out.push(parsed);
    } catch {
      // A torn line from a crashed append is skipped, not fatal to the hour.
    }
  }
  return out;
}

type RiderState = {
  day: string;
  lastLat: number | null;
  lastLng: number | null;
  lastT: number | null;
  distanceM: number;
  outOfZoneSince: number | null;
  idleSince: number | null;
  pin: LatestPin | null;
};

function emptyStats(): DayStats {
  return { movingS: 0, idleS: 0, dwellS: 0, outOfZoneS: 0, mockedCount: 0, points: 0, distanceM: 0 };
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class GpsArchive {
  private readonly sql: SqlLike;
  private readonly bucket: BucketLike | null;
  private schemaReady = false;
  private readonly riders = new Map<string, RiderState>();
  private readonly stats = new Map<string, DayStats>();
  private readonly dirtyStats = new Set<string>();
  private readonly dirtyLatest = new Set<string>();
  /** driverId -> `day|hour` -> JSONL lines not yet in SQLite. */
  private readonly pendingRows = new Map<string, Map<string, string[]>>();
  private minuteLines: string[] = [];
  private lastFlushAt = 0;
  private lastMinuteKey = "";
  private minuteSeq = 0;
  private flushing: Promise<void> | null = null;

  constructor(sql: SqlLike, bucket: BucketLike | null) {
    this.sql = sql;
    this.bucket = bucket;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS latest (
      driver_id TEXT PRIMARY KEY,
      lat REAL NOT NULL, lng REAL NOT NULL, t INTEGER NOT NULL,
      speed REAL, heading REAL, accuracy REAL, battery REAL,
      mocked INTEGER NOT NULL DEFAULT 0, tracking TEXT NOT NULL DEFAULT 'idle',
      distance_today_m REAL NOT NULL DEFAULT 0, out_of_zone_since INTEGER, day TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS buffer (
      driver_id TEXT NOT NULL, day TEXT NOT NULL, hour TEXT NOT NULL,
      points TEXT NOT NULL, n INTEGER NOT NULL,
      PRIMARY KEY (driver_id, day, hour))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS day_stats (
      driver_id TEXT NOT NULL, day TEXT NOT NULL,
      moving_s REAL NOT NULL DEFAULT 0, idle_s REAL NOT NULL DEFAULT 0,
      dwell_s REAL NOT NULL DEFAULT 0, out_of_zone_s REAL NOT NULL DEFAULT 0,
      mocked_count INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (driver_id, day))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS day_index (
      driver_id TEXT NOT NULL, day TEXT NOT NULL,
      keys TEXT NOT NULL DEFAULT '[]', points INTEGER NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL DEFAULT 0, first_ts INTEGER, last_ts INTEGER,
      PRIMARY KEY (driver_id, day))`);
    this.schemaReady = true;
  }

  latestPins(): LatestPin[] {
    this.ensureSchema();
    return this.sql.exec("SELECT * FROM latest").toArray().map((row) => ({
      driverId: String(row.driver_id),
      lat: Number(row.lat),
      lng: Number(row.lng),
      t: Number(row.t),
      speedMps: num(row.speed),
      headingDeg: num(row.heading),
      accuracyM: num(row.accuracy),
      batteryPct: num(row.battery),
      isMocked: Number(row.mocked) === 1,
      trackingStatus: String(row.tracking ?? "idle"),
      distanceTodayM: Number(row.distance_today_m ?? 0),
      outOfZoneSince: num(row.out_of_zone_since),
      day: String(row.day),
    }));
  }

  /** Odometer for the rider's current Kuwait day, or null when the archive has not seen that day. */
  distanceTodayM(driverId: string, day: string): number | null {
    const pin = this.riders.get(driverId)?.pin;
    return pin && pin.day === day ? pin.distanceTodayM : null;
  }

  dayStats(driverId: string, day: string): DayStats | null {
    this.ensureSchema();
    const cached = this.stats.get(`${driverId}|${day}`);
    if (cached) return { ...cached };
    const row = this.sql
      .exec("SELECT * FROM day_stats WHERE driver_id = ? AND day = ?", driverId, day)
      .toArray()[0];
    return row ? statsFromRow(row) : null;
  }

  /** Stats rows changed since their last sync; the caller marks them synced after writing. */
  unsyncedDayStats(limit: number): Array<{ driverId: string; day: string; stats: DayStats }> {
    this.ensureSchema();
    return this.sql
      .exec(
        "SELECT * FROM day_stats WHERE synced_at = 0 ORDER BY day, driver_id LIMIT ?",
        limit,
      )
      .toArray()
      .map((row) => ({ driverId: String(row.driver_id), day: String(row.day), stats: statsFromRow(row) }));
  }

  markDayStatsSynced(rows: Array<{ driverId: string; day: string }>, nowMs: number): void {
    this.ensureSchema();
    for (const row of rows) {
      this.sql.exec(
        "UPDATE day_stats SET synced_at = ? WHERE driver_id = ? AND day = ?",
        nowMs,
        row.driverId,
        row.day,
      );
    }
  }

  dayIndex(driverId: string, fromDay?: string, toDay?: string): DayIndexRow[] {
    this.ensureSchema();
    return this.sql
      .exec(
        "SELECT * FROM day_index WHERE driver_id = ? AND day >= ? AND day <= ? ORDER BY day",
        driverId,
        fromDay ?? "0000-00-00",
        toDay ?? "9999-99-99",
      )
      .toArray()
      .map(indexFromRow);
  }

  /**
   * Adds hour files written outside the room (the one-time Firestore export) to a rider-day.
   * Points and distance take the larger side because dual-write days hold the same fixes
   * in both copies; `readDay` dedupes them by timestamp.
   */
  registerImported(row: DayIndexRow): void {
    this.ensureSchema();
    const existing = this.dayIndex(row.driverId, row.day, row.day)[0];
    const keys = [...new Set([...(existing?.keys ?? []), ...row.keys])].sort();
    const first = [existing?.firstTs, row.firstTs].filter((v): v is number => v != null);
    const last = [existing?.lastTs, row.lastTs].filter((v): v is number => v != null);
    this.sql.exec(
      `INSERT INTO day_index (driver_id, day, keys, points, distance_m, first_ts, last_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (driver_id, day) DO UPDATE SET
         keys = excluded.keys, points = excluded.points, distance_m = excluded.distance_m,
         first_ts = excluded.first_ts, last_ts = excluded.last_ts`,
      row.driverId,
      row.day,
      JSON.stringify(keys),
      Math.max(existing?.points ?? 0, row.points),
      Math.max(existing?.distanceM ?? 0, row.distanceM),
      first.length ? Math.min(...first) : null,
      last.length ? Math.max(...last) : null,
    );
  }

  /** Points still in SQLite (current hour, or not yet compacted) for one rider-day. */
  bufferedPoints(driverId: string, day: string): ArchivePoint[] {
    this.ensureSchema();
    const rows = this.sql
      .exec("SELECT points FROM buffer WHERE driver_id = ? AND day = ? ORDER BY hour", driverId, day)
      .toArray();
    const pending = this.pendingRows.get(driverId);
    const memory: string[] = [];
    if (pending) {
      for (const [bucket, lines] of pending) {
        if (bucket.startsWith(`${day}|`)) memory.push(...lines);
      }
    }
    return parsePointLines([...rows.map((row) => String(row.points)), ...memory].join("\n"));
  }

  /** Every archived point for one rider-day: compacted R2 hours plus what is still in SQLite. */
  async readDay(driverId: string, day: string): Promise<ArchivePoint[]> {
    const index = this.dayIndex(driverId, day, day)[0];
    const fromR2: ArchivePoint[] = [];
    if (index && this.bucket) {
      for (const key of index.keys) {
        const object = await this.bucket.get(key);
        if (object) fromR2.push(...parsePointLines(await gunzipText(await object.arrayBuffer())));
      }
    }
    const byTs = new Map<number, ArchivePoint>();
    for (const point of [...fromR2, ...this.bufferedPoints(driverId, day)]) byTs.set(point.t, point);
    return [...byTs.values()].sort((a, b) => a.t - b.t);
  }

  record(driverId: string, points: ArchivePoint[], inAssignedZone: boolean | null): void {
    if (points.length === 0) return;
    this.ensureSchema();
    const rider = this.riderState(driverId, points[0]!.t);
    let rows = this.pendingRows.get(driverId);
    if (!rows) {
      rows = new Map();
      this.pendingRows.set(driverId, rows);
    }

    for (const point of points) {
      const { day, hour } = kuwaitParts(point.t);
      const line = JSON.stringify(point);
      const bucketKey = `${day}|${hour}`;
      const lines = rows.get(bucketKey) ?? [];
      lines.push(line);
      rows.set(bucketKey, lines);
      this.minuteLines.push(`{"id":${JSON.stringify(driverId)},${line.slice(1)}`);

      // Replayed points fill the archive but never move the odometer or the pin.
      if (point.r === 1) continue;
      if (rider.lastT != null && point.t < rider.lastT) continue;

      if (rider.day !== day) {
        rider.day = day;
        rider.distanceM = 0;
        rider.idleSince = null;
        rider.lastT = null;
      }

      const stats = this.statsFor(driverId, day);
      stats.points += 1;
      if (point.m === 1) stats.mockedCount += 1;

      if (rider.lastT != null) {
        const dtMs = Math.min(point.t - rider.lastT, MAX_STAT_GAP_MS);
        const dtS = dtMs / 1000;
        const moving = (point.s ?? 0) >= MOVING_MIN_MPS;
        if (moving) {
          stats.movingS += dtS;
          rider.idleSince = null;
        } else {
          stats.idleS += dtS;
          rider.idleSince ??= rider.lastT;
          if (point.t - rider.idleSince >= DWELL_AFTER_MS) stats.dwellS += dtS;
        }
        if (inAssignedZone === false) stats.outOfZoneS += dtS;
      }

      const accurate = point.a == null || point.a <= MAX_ACCURACY_M;
      if (accurate && rider.lastLat != null && rider.lastLng != null && rider.lastT != null) {
        const seg = haversineMeters(rider.lastLat, rider.lastLng, point.la, point.lo);
        const dt = (point.t - rider.lastT) / 1000;
        if (dt > 0 && seg <= MAX_SEGMENT_M && seg / dt <= MAX_SEGMENT_MPS) {
          rider.distanceM += seg;
        }
      }
      if (accurate) {
        rider.lastLat = point.la;
        rider.lastLng = point.lo;
      }
      rider.lastT = point.t;
      stats.distanceM = rider.distanceM;

      if (inAssignedZone === false) rider.outOfZoneSince ??= point.t;
      else if (inAssignedZone === true) rider.outOfZoneSince = null;

      rider.pin = {
        driverId,
        lat: point.la,
        lng: point.lo,
        t: point.t,
        speedMps: point.s,
        headingDeg: point.h,
        accuracyM: point.a,
        batteryPct: point.b,
        isMocked: point.m === 1,
        trackingStatus: point.st,
        distanceTodayM: rider.distanceM,
        outOfZoneSince: rider.outOfZoneSince,
        day,
      };
      this.dirtyLatest.add(driverId);
      this.dirtyStats.add(`${driverId}|${day}`);
    }
  }

  /** Persists to SQLite, writes the minute file, compacts finished hours. Idempotent per minute. */
  async maybeFlush(nowMs: number, force = false): Promise<void> {
    if (!force && nowMs - this.lastFlushAt < ARCHIVE_FLUSH_MS) return;
    if (this.flushing) return this.flushing;
    this.lastFlushAt = nowMs;
    this.flushing = this.flush(nowMs).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flush(nowMs: number): Promise<void> {
    this.ensureSchema();
    this.persistBuffers();
    this.persistLatest();
    this.persistStats();

    const minute = this.minuteLines;
    this.minuteLines = [];
    if (minute.length > 0 && this.bucket) {
      const { day, hour, minute: mm } = kuwaitParts(nowMs);
      const base = `raw/${day}/${hour}${mm}`;
      this.minuteSeq = base === this.lastMinuteKey ? this.minuteSeq + 1 : 0;
      this.lastMinuteKey = base;
      const key = this.minuteSeq === 0 ? `${base}.jsonl.gz` : `${base}_${this.minuteSeq}.jsonl.gz`;
      try {
        await this.bucket.put(key, await gzipText(minute.join("\n") + "\n"), {
          httpMetadata: { contentType: "application/x-ndjson" },
        });
      } catch (error) {
        // The minute file is a fleet-wide audit copy; the per-rider buffer in SQLite
        // still holds these points, so a failed put loses nothing the history reads.
        console.error("gps_minute_put_failed", String(error));
      }
    }

    await this.compact(nowMs);
  }

  private persistBuffers(): void {
    for (const [driverId, rows] of this.pendingRows) {
      for (const [bucketKey, lines] of rows) {
        const [day, hour] = bucketKey.split("|") as [string, string];
        const text = lines.join("\n") + "\n";
        this.sql.exec(
          `INSERT INTO buffer (driver_id, day, hour, points, n) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (driver_id, day, hour) DO UPDATE SET
             points = buffer.points || excluded.points, n = buffer.n + excluded.n`,
          driverId,
          day,
          hour,
          text,
          lines.length,
        );
      }
    }
    this.pendingRows.clear();
  }

  private persistLatest(): void {
    for (const driverId of this.dirtyLatest) {
      const pin = this.riders.get(driverId)?.pin;
      if (!pin) continue;
      this.sql.exec(
        `INSERT INTO latest (driver_id, lat, lng, t, speed, heading, accuracy, battery, mocked,
           tracking, distance_today_m, out_of_zone_since, day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (driver_id) DO UPDATE SET
           lat = excluded.lat, lng = excluded.lng, t = excluded.t, speed = excluded.speed,
           heading = excluded.heading, accuracy = excluded.accuracy, battery = excluded.battery,
           mocked = excluded.mocked, tracking = excluded.tracking,
           distance_today_m = excluded.distance_today_m,
           out_of_zone_since = excluded.out_of_zone_since, day = excluded.day`,
        driverId,
        pin.lat,
        pin.lng,
        pin.t,
        pin.speedMps,
        pin.headingDeg,
        pin.accuracyM,
        pin.batteryPct,
        pin.isMocked ? 1 : 0,
        pin.trackingStatus,
        pin.distanceTodayM,
        pin.outOfZoneSince,
        pin.day,
      );
    }
    this.dirtyLatest.clear();
  }

  private persistStats(): void {
    for (const key of this.dirtyStats) {
      const stats = this.stats.get(key);
      if (!stats) continue;
      const [driverId, day] = key.split("|") as [string, string];
      this.sql.exec(
        `INSERT INTO day_stats (driver_id, day, moving_s, idle_s, dwell_s, out_of_zone_s,
           mocked_count, points, distance_m, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (driver_id, day) DO UPDATE SET
           moving_s = excluded.moving_s, idle_s = excluded.idle_s, dwell_s = excluded.dwell_s,
           out_of_zone_s = excluded.out_of_zone_s, mocked_count = excluded.mocked_count,
           points = excluded.points, distance_m = excluded.distance_m, synced_at = 0`,
        driverId,
        day,
        stats.movingS,
        stats.idleS,
        stats.dwellS,
        stats.outOfZoneS,
        stats.mockedCount,
        stats.points,
        stats.distanceM,
      );
    }
    this.dirtyStats.clear();
    const today = kuwaitParts(Date.now()).day;
    for (const key of this.stats.keys()) {
      if (!key.endsWith(`|${today}`)) this.stats.delete(key);
    }
  }

  /** Moves every finished hour from `buffer` to `rider/{id}/{day}/{HH}.jsonl.gz`. */
  async compact(nowMs: number): Promise<number> {
    this.ensureSchema();
    if (!this.bucket) return 0;
    const { day, hour } = kuwaitParts(nowMs);
    const current = `${day}T${hour}`;
    const rows = this.sql
      .exec(
        `SELECT driver_id, day, hour, points, n FROM buffer
         WHERE (day || 'T' || hour) < ? ORDER BY day, hour LIMIT ?`,
        current,
        COMPACT_ROWS_PER_FLUSH,
      )
      .toArray();

    let written = 0;
    for (const row of rows) {
      const driverId = String(row.driver_id);
      const rowDay = String(row.day);
      const rowHour = String(row.hour);
      const key = riderHourKey(driverId, rowDay, rowHour);
      const index = this.sql
        .exec("SELECT * FROM day_index WHERE driver_id = ? AND day = ?", driverId, rowDay)
        .toArray()[0];
      const indexRow = index ? indexFromRow(index) : null;

      const fresh = parsePointLines(String(row.points));
      let combined = fresh;
      try {
        // Late (replayed) points can reopen an hour that was already compacted.
        if (indexRow?.keys.includes(key)) {
          const existing = await this.bucket.get(key);
          if (existing) {
            combined = [...parsePointLines(await gunzipText(await existing.arrayBuffer())), ...fresh];
          }
        }
        combined.sort((a, b) => a.t - b.t);
        const body = combined.map((point) => JSON.stringify(point)).join("\n") + "\n";
        await this.bucket.put(key, await gzipText(body), {
          httpMetadata: { contentType: "application/x-ndjson" },
          customMetadata: { points: String(combined.length) },
        });
      } catch (error) {
        console.error("gps_compact_failed", key, String(error));
        continue;
      }

      const keys = indexRow ? [...indexRow.keys] : [];
      if (!keys.includes(key)) keys.push(key);
      keys.sort();
      const added = fresh.length;
      const firstTs = Math.min(indexRow?.firstTs ?? Infinity, ...fresh.map((p) => p.t));
      const lastTs = Math.max(indexRow?.lastTs ?? -Infinity, ...fresh.map((p) => p.t));
      const distance = this.dayStats(driverId, rowDay)?.distanceM ?? indexRow?.distanceM ?? 0;
      this.sql.exec(
        `INSERT INTO day_index (driver_id, day, keys, points, distance_m, first_ts, last_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (driver_id, day) DO UPDATE SET
           keys = excluded.keys, points = excluded.points, distance_m = excluded.distance_m,
           first_ts = excluded.first_ts, last_ts = excluded.last_ts`,
        driverId,
        rowDay,
        JSON.stringify(keys),
        (indexRow?.points ?? 0) + added,
        distance,
        Number.isFinite(firstTs) ? firstTs : null,
        Number.isFinite(lastTs) ? lastTs : null,
      );
      this.sql.exec(
        "DELETE FROM buffer WHERE driver_id = ? AND day = ? AND hour = ?",
        driverId,
        rowDay,
        rowHour,
      );
      written += 1;
    }
    return written;
  }

  private riderState(driverId: string, t: number): RiderState {
    const existing = this.riders.get(driverId);
    if (existing) return existing;
    const row = this.sql.exec("SELECT * FROM latest WHERE driver_id = ?", driverId).toArray()[0];
    const day = kuwaitParts(t).day;
    const sameDay = row != null && String(row.day) === day;
    const state: RiderState = {
      day,
      lastLat: row ? Number(row.lat) : null,
      lastLng: row ? Number(row.lng) : null,
      lastT: sameDay ? Number(row!.t) : null,
      distanceM: sameDay ? Number(row!.distance_today_m ?? 0) : 0,
      outOfZoneSince: row ? num(row.out_of_zone_since) : null,
      idleSince: null,
      pin: null,
    };
    this.riders.set(driverId, state);
    return state;
  }

  private statsFor(driverId: string, day: string): DayStats {
    const key = `${driverId}|${day}`;
    const cached = this.stats.get(key);
    if (cached) return cached;
    const row = this.sql
      .exec("SELECT * FROM day_stats WHERE driver_id = ? AND day = ?", driverId, day)
      .toArray()[0];
    const stats = row ? statsFromRow(row) : emptyStats();
    this.stats.set(key, stats);
    return stats;
  }
}

function statsFromRow(row: Record<string, unknown>): DayStats {
  return {
    movingS: Number(row.moving_s ?? 0),
    idleS: Number(row.idle_s ?? 0),
    dwellS: Number(row.dwell_s ?? 0),
    outOfZoneS: Number(row.out_of_zone_s ?? 0),
    mockedCount: Number(row.mocked_count ?? 0),
    points: Number(row.points ?? 0),
    distanceM: Number(row.distance_m ?? 0),
  };
}

function indexFromRow(row: Record<string, unknown>): DayIndexRow {
  let keys: string[] = [];
  try {
    const parsed = JSON.parse(String(row.keys ?? "[]"));
    if (Array.isArray(parsed)) keys = parsed.map(String);
  } catch {
    keys = [];
  }
  return {
    driverId: String(row.driver_id),
    day: String(row.day),
    keys,
    points: Number(row.points ?? 0),
    distanceM: Number(row.distance_m ?? 0),
    firstTs: num(row.first_ts),
    lastTs: num(row.last_ts),
  };
}
