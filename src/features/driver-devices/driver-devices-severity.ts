/**
 * Severity for one driver's install, and the derivations the list sorts on.
 *
 * Pure and client-side on purpose: severity is a reading of two facts the page
 * already has — how far behind the build is, and how long ago the phone was
 * seen — so computing it in SQL would freeze today's thresholds into a stored
 * column and make "what does the fleet look like at a stricter gap" a migration
 * instead of an edit.
 */

import type {
  DriverDeviceListRow,
  DriverDeviceRow,
  DriverDeviceSeverity,
  DriverDevicesSnapshot,
  DriverDevicesTab,
} from "./driver-devices-types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Builds behind at which an install stops being merely late. */
export const CRITICAL_BUILD_GAP = 10;
export const HIGH_BUILD_GAP = 5;

/** Days of silence at which a phone stops being "recently active". */
export const CRITICAL_STALE_DAYS = 14;
export const HIGH_STALE_DAYS = 7;

export const SEVERITY_RANK: Record<DriverDeviceSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export type SeverityInput = {
  /** Build the phone reports. `null` = the install cannot say, which the server gate treats as below any minimum. */
  versionCode: number | null;
  /** Highest build observed in the field. */
  latestVersionCode: number | null;
  /** `app_settings.driver_app_min_version_code`, or `null` when no minimum is set. */
  minVersionCode: number | null;
  /** Whole days since the device session was last seen; `null` = never seen. */
  lastSeenDays: number | null;
  /** Whether the row carries any device profile at all. */
  hasDeviceData: boolean;
};

export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

/** Builds behind the latest known build. `null` when either side is unknown. */
export function buildGapOf(
  versionCode: number | null,
  latestVersionCode: number | null,
): number | null {
  if (versionCode == null || latestVersionCode == null) return null;
  return Math.max(0, latestVersionCode - versionCode);
}

export function isOutdatedBuild(input: SeverityInput): boolean {
  // An install that cannot report its versionCode is treated as below any
  // minimum — the same rule the force-update gate applies, and both sides have
  // to agree or the page shows a driver as fine who is refused at login.
  if (input.versionCode == null) return true;
  if (input.minVersionCode != null && input.versionCode < input.minVersionCode) return true;
  if (input.latestVersionCode != null && input.versionCode < input.latestVersionCode) return true;
  return false;
}

export function driverDeviceSeverity(input: SeverityInput): DriverDeviceSeverity {
  if (!isOutdatedBuild(input)) return "low";

  // On the latest build, or one build off the minimum the admin set: a fleet is
  // never uniformly on one build, and calling the trailing edge of a healthy
  // rollout "medium" would leave the page permanently amber.
  if (
    input.versionCode != null &&
    input.minVersionCode != null &&
    input.versionCode >= input.minVersionCode - 1
  ) {
    return "low";
  }

  const gap = buildGapOf(input.versionCode, input.latestVersionCode);
  const stale = input.lastSeenDays;

  if (
    (gap != null && gap >= CRITICAL_BUILD_GAP) ||
    // A phone that was never seen is not "recently active" — it is the most
    // stale state there is, not an unknown one.
    stale == null ||
    stale > CRITICAL_STALE_DAYS ||
    !input.hasDeviceData
  ) {
    return "critical";
  }

  if ((gap != null && gap >= HIGH_BUILD_GAP) || stale > HIGH_STALE_DAYS) return "high";

  return "medium";
}

export function rowHasDeviceData(row: DriverDeviceRow): boolean {
  return Boolean(
    row.device_meta ||
      row.device_model ||
      row.device_manufacturer ||
      row.os_version ||
      row.android_sdk_int != null ||
      row.app_version_code != null,
  );
}

export type SentryCounts = { events: number; issues: number };

/**
 * Default order: severity first, then the stalest phone within a severity —
 * two critical rows are not equally urgent, and the one nobody has heard from
 * is the one an operator should call.
 */
export function compareDriverDeviceRows(
  a: DriverDeviceListRow,
  b: DriverDeviceListRow,
): number {
  const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (bySeverity !== 0) return bySeverity;
  // `null` last_seen sorts first: never seen is older than any timestamp.
  const aSeen = a.last_seen_at ? new Date(a.last_seen_at).getTime() : -Infinity;
  const bSeen = b.last_seen_at ? new Date(b.last_seen_at).getTime() : -Infinity;
  if (aSeen !== bSeen) return aSeen - bSeen;
  return a.driver_code.localeCompare(b.driver_code);
}

export function decorateDriverDeviceRows(
  snapshot: DriverDevicesSnapshot,
  sentryByDriver: Map<string, SentryCounts> = new Map(),
  now: number = Date.now(),
): DriverDeviceListRow[] {
  const decorated = snapshot.rows.map((row) => {
    const lastSeenDays = daysSince(row.last_seen_at, now);
    const hasDeviceData = rowHasDeviceData(row);
    const input: SeverityInput = {
      versionCode: row.app_version_code,
      latestVersionCode: snapshot.latestVersionCode,
      minVersionCode: snapshot.minVersionCode,
      lastSeenDays,
      hasDeviceData,
    };
    const sentry = sentryByDriver.get(row.driver_id);
    return {
      ...row,
      severity: driverDeviceSeverity(input),
      buildGap: buildGapOf(row.app_version_code, snapshot.latestVersionCode),
      outdated: isOutdatedBuild(input),
      lastSeenDays,
      hasDeviceData,
      forced: row.force_app_update_at != null,
      sentryEvents: sentry?.events ?? 0,
      sentryIssues: sentry?.issues ?? 0,
    } satisfies DriverDeviceListRow;
  });
  return decorated.sort(compareDriverDeviceRows);
}

export function driverDeviceMatchesTab(
  row: DriverDeviceListRow,
  tab: DriverDevicesTab,
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "critical":
      return row.severity === "critical";
    case "high":
      return row.severity === "high";
    case "outdated":
      return row.outdated;
    case "latest":
      return !row.outdated;
    case "errors":
      return row.sentryEvents > 0;
    case "no-device":
      return !row.hasDeviceData;
    case "forced":
      return row.forced;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}

export function driverDeviceMatchesSearch(
  row: DriverDeviceListRow,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.full_name,
    row.driver_code,
    row.employee_id,
    row.phone,
    row.zone_name,
    row.device_model,
    row.device_manufacturer,
    row.app_version_name,
    row.app_version_code == null ? null : String(row.app_version_code),
    row.device_meta?.soc_model,
  ].some((value) => value != null && value.toLowerCase().includes(needle));
}

export type DriverDevicesKpis = {
  total: number;
  critical: number;
  high: number;
  outdated: number;
  latest: number;
  noDevice: number;
  withErrors: number;
  forced: number;
};

export function driverDevicesKpis(rows: DriverDeviceListRow[]): DriverDevicesKpis {
  const kpis: DriverDevicesKpis = {
    total: rows.length,
    critical: 0,
    high: 0,
    outdated: 0,
    latest: 0,
    noDevice: 0,
    withErrors: 0,
    forced: 0,
  };
  for (const row of rows) {
    if (row.severity === "critical") kpis.critical += 1;
    if (row.severity === "high") kpis.high += 1;
    if (row.outdated) kpis.outdated += 1;
    else kpis.latest += 1;
    if (!row.hasDeviceData) kpis.noDevice += 1;
    if (row.sentryEvents > 0) kpis.withErrors += 1;
    if (row.forced) kpis.forced += 1;
  }
  return kpis;
}

/**
 * Builds in the field, for the settings panel. Sorted oldest first so the
 * installs a minimum would lock out read top-down, matching the existing
 * force-update block.
 */
export type DriverBuildRollupRow = {
  versionCode: number | null;
  versionName: string | null;
  installs: number;
  lastSeenAt: string | null;
  outdated: boolean;
};

export function rollUpBuilds(
  rows: DriverDeviceListRow[],
  minVersionCode: number | null,
): DriverBuildRollupRow[] {
  const byCode = new Map<number | null, DriverBuildRollupRow>();
  for (const row of rows) {
    const code = row.app_version_code;
    const entry = byCode.get(code) ?? {
      versionCode: code,
      versionName: row.app_version_name,
      installs: 0,
      lastSeenAt: null,
      outdated: code == null || (minVersionCode != null && code < minVersionCode),
    };
    entry.installs += 1;
    if (!entry.versionName && row.app_version_name) entry.versionName = row.app_version_name;
    if (
      row.last_seen_at &&
      (entry.lastSeenAt == null ||
        new Date(row.last_seen_at).getTime() > new Date(entry.lastSeenAt).getTime())
    ) {
      entry.lastSeenAt = row.last_seen_at;
    }
    byCode.set(code, entry);
  }
  return [...byCode.values()].sort((a, b) => {
    // Unknown builds first: they are treated as below any minimum, same as the gate.
    if (a.versionCode == null) return -1;
    if (b.versionCode == null) return 1;
    return a.versionCode - b.versionCode;
  });
}
