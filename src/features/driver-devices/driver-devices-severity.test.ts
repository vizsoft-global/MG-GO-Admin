import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGapOf,
  compareDriverDeviceRows,
  daysSince,
  decorateDriverDeviceRows,
  driverDeviceMatchesSearch,
  driverDeviceMatchesTab,
  driverDeviceSeverity,
  driverDevicesKpis,
  driverDevicesSortDirection,
  isOutdatedBuild,
  nextDriverDevicesSortKey,
  sortDriverDeviceRows,
  type SeverityInput,
} from "./driver-devices-severity";
import {
  batteryNeedsAttention,
  formatProcessor,
  formatRam,
  parseDriverDevicesSnapshot,
  type DriverDeviceRow,
} from "./driver-devices-types";

const NOW = Date.parse("2026-09-05T09:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function severity(overrides: Partial<SeverityInput>) {
  return driverDeviceSeverity({
    versionCode: 85,
    latestVersionCode: 85,
    minVersionCode: 83,
    lastSeenDays: 0,
    hasDeviceData: true,
    ...overrides,
  });
}

test("an install on the latest build is low whatever else is true", () => {
  assert.equal(severity({}), "low");
  assert.equal(severity({ lastSeenDays: 90 }), "low");
  assert.equal(severity({ hasDeviceData: false }), "low");
});

test("one build off the minimum is low — the trailing edge of a rollout is not a problem", () => {
  assert.equal(severity({ versionCode: 82, lastSeenDays: 30 }), "low");
  assert.equal(severity({ versionCode: 83, lastSeenDays: 30 }), "low");
});

test("outdated but recently active is medium", () => {
  assert.equal(severity({ versionCode: 81, minVersionCode: 84, lastSeenDays: 1 }), "medium");
});

test("high needs either a 5-build gap or a week of silence", () => {
  assert.equal(
    severity({ versionCode: 80, latestVersionCode: 85, minVersionCode: 84, lastSeenDays: 1 }),
    "high",
  );
  assert.equal(
    severity({ versionCode: 83, latestVersionCode: 85, minVersionCode: 85, lastSeenDays: 8 }),
    "high",
  );
  assert.equal(
    severity({ versionCode: 83, latestVersionCode: 85, minVersionCode: 85, lastSeenDays: 7 }),
    "medium",
  );
});

test("critical needs a 10-build gap, a fortnight of silence, or no device data", () => {
  assert.equal(
    severity({ versionCode: 75, latestVersionCode: 85, minVersionCode: 84, lastSeenDays: 1 }),
    "critical",
  );
  assert.equal(
    severity({ versionCode: 83, latestVersionCode: 85, minVersionCode: 85, lastSeenDays: 15 }),
    "critical",
  );
  assert.equal(
    severity({
      versionCode: 83,
      latestVersionCode: 85,
      minVersionCode: 85,
      lastSeenDays: 1,
      hasDeviceData: false,
    }),
    "critical",
  );
});

test("a phone that was never seen is critical, not unknown", () => {
  assert.equal(
    severity({ versionCode: 83, latestVersionCode: 85, minVersionCode: 85, lastSeenDays: null }),
    "critical",
  );
});

test("an install that cannot report its build is outdated and critical, matching the login gate", () => {
  const input: SeverityInput = {
    versionCode: null,
    latestVersionCode: 85,
    minVersionCode: 83,
    lastSeenDays: 0,
    hasDeviceData: false,
  };
  assert.equal(isOutdatedBuild(input), true);
  assert.equal(driverDeviceSeverity(input), "critical");
});

test("with no minimum set, being behind the newest build in the field still counts as outdated", () => {
  assert.equal(
    isOutdatedBuild({
      versionCode: 70,
      latestVersionCode: 85,
      minVersionCode: null,
      lastSeenDays: 0,
      hasDeviceData: true,
    }),
    true,
  );
  assert.equal(severity({ versionCode: 70, minVersionCode: null }), "critical");
});

test("buildGapOf never goes negative and needs both sides", () => {
  assert.equal(buildGapOf(80, 85), 5);
  assert.equal(buildGapOf(90, 85), 0);
  assert.equal(buildGapOf(null, 85), null);
  assert.equal(buildGapOf(80, null), null);
});

test("daysSince floors to whole days and refuses an unparseable timestamp", () => {
  assert.equal(daysSince(daysAgo(3), NOW), 3);
  assert.equal(daysSince(new Date(NOW + 60_000).toISOString(), NOW), 0);
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince("not a date", NOW), null);
});

function row(overrides: Partial<DriverDeviceRow>): Record<string, unknown> {
  return {
    driver_id: `00000000-0000-4000-8000-${String(overrides.driver_code ?? "10001").padStart(12, "0")}`,
    driver_code: "10001",
    employee_id: "4001",
    full_name: "Driver One",
    phone: "+96550001111",
    status: "active",
    is_on_duty: false,
    is_blocked: false,
    avatar_object_key: null,
    zone_id: null,
    zone_name: "Hawally",
    active_device_id: "device-1",
    session_id: "session-1",
    device_model: "Redmi Note 12",
    device_manufacturer: "Xiaomi",
    os_version: "14",
    android_sdk_int: 34,
    app_version_name: "1.1.20",
    app_version_code: 85,
    device_meta: null,
    device_meta_at: null,
    last_seen_at: daysAgo(0),
    first_seen_at: daysAgo(60),
    force_app_update_at: null,
    force_app_update_min_code: null,
    ...overrides,
  };
}

test("the snapshot's latest build is the highest one seen in the field", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 80,
    min_version_name: "1.1.18",
    rows: [row({ app_version_code: 76 }), row({ driver_code: "10002", app_version_code: 85 })],
  });
  assert.equal(snapshot.latestVersionCode, 85);
  assert.equal(snapshot.minVersionCode, 80);
  assert.equal(snapshot.rows.length, 2);
});

test("a minimum above every install still sets the latest, so the gap is not understated", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 90,
    rows: [row({ app_version_code: 70 })],
  });
  assert.equal(snapshot.latestVersionCode, 90);
});

test("a malformed payload yields an empty snapshot rather than throwing", () => {
  const snapshot = parseDriverDevicesSnapshot(null);
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.latestVersionCode, null);
  assert.deepEqual(parseDriverDevicesSnapshot({ rows: [{}, { driver_id: null }] }).rows, []);
});

test("rows are decorated, joined to Sentry counts and sorted severity-then-stalest", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 85, last_seen_at: daysAgo(0) }),
      row({ driver_code: "10002", app_version_code: 70, last_seen_at: daysAgo(2) }),
      row({ driver_code: "10003", app_version_code: 70, last_seen_at: daysAgo(40) }),
      row({ driver_code: "10004", app_version_code: 82, last_seen_at: daysAgo(9) }),
    ],
  });
  const sentry = new Map([[snapshot.rows[1].driver_id, { events: 12, issues: 3 }]]);
  const decorated = decorateDriverDeviceRows(snapshot, sentry, NOW);

  assert.deepEqual(
    decorated.map((r) => [r.driver_code, r.severity]),
    [
      ["10003", "critical"],
      ["10002", "critical"],
      ["10004", "high"],
      ["10001", "low"],
    ],
  );
  assert.equal(decorated[1].sentryEvents, 12);
  assert.equal(decorated[1].sentryIssues, 3);
  assert.equal(decorated[0].sentryEvents, 0);
  assert.equal(decorated[3].buildGap, 0);
  assert.equal(decorated[1].buildGap, 15);
});

test("a driver who has never been seen sorts above one seen long ago", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 70, last_seen_at: daysAgo(100) }),
      row({
        driver_code: "10002",
        app_version_code: null,
        app_version_name: null,
        device_model: null,
        device_manufacturer: null,
        os_version: null,
        android_sdk_int: null,
        session_id: null,
        active_device_id: null,
        last_seen_at: null,
      }),
    ],
  });
  const decorated = decorateDriverDeviceRows(snapshot, new Map(), NOW);
  assert.equal(decorated[0].driver_code, "10002");
  assert.equal(decorated[0].hasDeviceData, false);
});

test("compareDriverDeviceRows falls back to driver code so the order is stable", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10009", app_version_code: 85, last_seen_at: daysAgo(1) }),
      row({ driver_code: "10002", app_version_code: 85, last_seen_at: daysAgo(1) }),
    ],
  });
  const decorated = decorateDriverDeviceRows(snapshot, new Map(), NOW);
  assert.deepEqual(
    decorated.map((r) => r.driver_code),
    ["10002", "10009"],
  );
  assert.equal(compareDriverDeviceRows(decorated[0], decorated[0]), 0);
});

test("tabs partition the list the way their labels claim", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 85 }),
      row({ driver_code: "10002", app_version_code: 60, last_seen_at: daysAgo(30) }),
      row({ driver_code: "10003", app_version_code: 80, last_seen_at: daysAgo(9) }),
      row({
        driver_code: "10004",
        app_version_code: null,
        app_version_name: null,
        device_model: null,
        device_manufacturer: null,
        os_version: null,
        android_sdk_int: null,
        last_seen_at: null,
      }),
      row({ driver_code: "10005", app_version_code: 85, force_app_update_at: daysAgo(1) }),
    ],
  });
  const rows = decorateDriverDeviceRows(
    snapshot,
    new Map([[snapshot.rows[2].driver_id, { events: 4, issues: 1 }]]),
    NOW,
  );
  const codesIn = (tab: Parameters<typeof driverDeviceMatchesTab>[1]) =>
    rows.filter((r) => driverDeviceMatchesTab(r, tab)).map((r) => r.driver_code).sort();

  assert.deepEqual(codesIn("all").length, 5);
  assert.deepEqual(codesIn("critical"), ["10002", "10004"]);
  assert.deepEqual(codesIn("high"), ["10003"]);
  assert.deepEqual(codesIn("outdated"), ["10002", "10003", "10004"]);
  assert.deepEqual(codesIn("latest"), ["10001", "10005"]);
  assert.deepEqual(codesIn("errors"), ["10003"]);
  assert.deepEqual(codesIn("no-device"), ["10004"]);
  assert.deepEqual(codesIn("forced"), ["10005"]);
});

test("KPI counts agree with the tabs they head", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 85 }),
      row({ driver_code: "10002", app_version_code: 60, last_seen_at: daysAgo(30) }),
      row({ driver_code: "10003", app_version_code: 80, last_seen_at: daysAgo(9) }),
    ],
  });
  const rows = decorateDriverDeviceRows(
    snapshot,
    new Map([[snapshot.rows[1].driver_id, { events: 1, issues: 1 }]]),
    NOW,
  );
  assert.deepEqual(driverDevicesKpis(rows), {
    total: 3,
    critical: 1,
    high: 1,
    outdated: 2,
    latest: 1,
    noDevice: 0,
    withErrors: 1,
    forced: 0,
  });
});

test("search reaches identity, device and build without matching on nothing", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [row({ full_name: "Amir Haddad", device_meta: { soc_model: "SM8550" } })],
  });
  const [r] = decorateDriverDeviceRows(snapshot, new Map(), NOW);
  for (const needle of ["amir", "10001", "4001", "50001111", "hawally", "redmi", "1.1.20", "85", "sm8550"]) {
    assert.equal(driverDeviceMatchesSearch(r, needle), true, needle);
  }
  assert.equal(driverDeviceMatchesSearch(r, "  "), true);
  assert.equal(driverDeviceMatchesSearch(r, "nokia"), false);
});

test("battery is flagged on poor health or a hot cell, and not otherwise", () => {
  assert.equal(batteryNeedsAttention(null), false);
  const snapshot = parseDriverDevicesSnapshot({
    rows: [
      row({ driver_code: "10001", device_meta: { battery_health: "good", battery_temp_c: 31.5 } }),
      row({ driver_code: "10002", device_meta: { battery_health: "overheat" } }),
      row({ driver_code: "10003", device_meta: { battery_health: "good", battery_temp_c: 44 } }),
    ],
  });
  assert.equal(batteryNeedsAttention(snapshot.rows[0].device_meta), false);
  assert.equal(batteryNeedsAttention(snapshot.rows[1].device_meta), true);
  assert.equal(batteryNeedsAttention(snapshot.rows[2].device_meta), true);
});

test("RAM and processor read from the profile, and say nothing when it is absent", () => {
  const snapshot = parseDriverDevicesSnapshot({
    rows: [
      row({
        driver_code: "10001",
        device_meta: { ram_total_mb: 8192, ram_free_mb: 2048, soc_model: "SM8550", cpu_cores: 8 },
      }),
      row({ driver_code: "10002", device_meta: { ram_total_mb: 512 } }),
      row({ driver_code: "10003" }),
    ],
  });
  assert.equal(formatRam(snapshot.rows[0].device_meta), "8.0 GB · 2.0 GB free");
  assert.equal(formatProcessor(snapshot.rows[0].device_meta), "SM8550 · 8 cores");
  assert.equal(formatRam(snapshot.rows[1].device_meta), "512 MB");
  assert.equal(formatRam(snapshot.rows[2].device_meta), "—");
  assert.equal(formatProcessor(snapshot.rows[2].device_meta), "—");
});

test("an all-null device_meta object is read as absent, not as an empty profile", () => {
  const snapshot = parseDriverDevicesSnapshot({
    rows: [row({ device_meta: { model: null, battery_pct: null } })],
  });
  assert.equal(snapshot.rows[0].device_meta, null);
});

test("header sort cycles and defaults to the ops-useful direction", () => {
  assert.equal(nextDriverDevicesSortKey("default", "severity"), "severity_desc");
  assert.equal(nextDriverDevicesSortKey("severity_desc", "severity"), "severity_asc");
  assert.equal(nextDriverDevicesSortKey("severity_asc", "severity"), "severity_desc");
  assert.equal(nextDriverDevicesSortKey("default", "build"), "build_asc");
  assert.equal(nextDriverDevicesSortKey("build_asc", "build"), "build_desc");
  assert.equal(driverDevicesSortDirection("build_asc", "build"), "asc");
  assert.equal(driverDevicesSortDirection("build_asc", "severity"), false);
});

test("build sort puts unknown and oldest first on asc", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 85 }),
      row({ driver_code: "10002", app_version_code: 70 }),
      row({
        driver_code: "10003",
        app_version_code: null,
        app_version_name: null,
        session_id: null,
        active_device_id: null,
        device_model: null,
        last_seen_at: null,
      }),
    ],
  });
  const rows = decorateDriverDeviceRows(snapshot, new Map(), NOW);
  assert.deepEqual(
    sortDriverDeviceRows(rows, "build_asc").map((r) => r.driver_code),
    ["10003", "10002", "10001"],
  );
  assert.deepEqual(
    sortDriverDeviceRows(rows, "build_desc").map((r) => r.driver_code),
    ["10001", "10002", "10003"],
  );
});

test("severity sort desc puts critical above low", () => {
  const snapshot = parseDriverDevicesSnapshot({
    min_version_code: 85,
    rows: [
      row({ driver_code: "10001", app_version_code: 85 }),
      row({ driver_code: "10002", app_version_code: 60, last_seen_at: daysAgo(30) }),
    ],
  });
  const rows = decorateDriverDeviceRows(snapshot, new Map(), NOW);
  assert.deepEqual(
    sortDriverDeviceRows(rows, "severity_desc").map((r) => r.driver_code),
    ["10002", "10001"],
  );
});
