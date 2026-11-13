/**
 * Shared router lanes. This file is the one source of truth for the functions
 * package and the admin app.
 *
 * functions/tsconfig.json sets rootDir to src, so the app cannot own the file
 * (tsc would refuse to compile it). The Next tsconfig excludes the functions
 * directory, but an import still typechecks and bundles. The module imports
 * nothing from firebase-functions, so the Next compiler can load it.
 *
 * Lane runtime options apply only to the three new onCall exports. Existing
 * callable options stay on the legacy functions.
 *
 * Membership notes:
 * - There is no deliveries list/search callable. Scan covers the two count
 *   callables only.
 * - adminPayrollMonthSnapshot is the second unbounded payroll snapshot, so it
 *   sits with adminPayrollRuleSnapshot.
 * - cleanup* retention deletes are unbounded batch work, so they sit on heavy.
 * - esignComposeSignedDocument sits on heavy because that lane is a superset of
 *   cpu 1, 1GiB, and 120s, and it declares no secret, service account, App
 *   Check, or CORS of its own. The superset test drops it if a built endpoint
 *   disagrees.
 * - workerFleetRead, adminIngestDriverPositions, and adminRecordFleetEvents stay
 *   off every lane (onRequest + WORKER_SHARED_SECRET).
 * - onSchedule functions are off every lane as well (see SCHEDULED_FUNCTIONS).
 * - Firestore triggers are not callables at all, so `assertPartition` here does not
 *   see them. There are none left: see the note in `index.ts`.
 * - Names that start with `driver` are the rider app's legacy callables, except
 *   driverOpsAuditHealth, which the admin cron calls.
 */
import { allLegacyNames, moduleForFunction } from "./legacy-modules";

export const FUNCTIONS_REGION = "me-central1";

/**
 * Stays 0 until router logs show isolate boot, not the scan, is the p95.
 * A warm instance does not make a collection scan cheaper. Decision 2026-10-23.
 */
export const SCAN_MIN_INSTANCES = 0;

export const LANE_EXPORT_NAMES = ["adminApi", "adminApiScan", "adminApiHeavy"] as const;

export type LaneExportName = (typeof LANE_EXPORT_NAMES)[number];

export type LaneId = "light" | "scan" | "heavy";

export type LaneRuntimeOptions = {
  region: string;
  cpu: number;
  memory: "2GiB" | "4GiB";
  concurrency: number;
  minInstances: number;
  maxInstances: number;
  timeoutSeconds?: number;
};

export const WORKER_HTTP_FUNCTIONS = [
  "workerFleetRead",
  "adminIngestDriverPositions",
  "adminRecordFleetEvents",
] as const;

/**
 * Exports that are neither callables nor HTTP handlers.
 *
 * `bitesMirrorSweep`, `deliveryProximitySweep`, `serviceOdometerSync` and
 * `serviceVehicleDistanceSweep` are `onSchedule` functions: Cloud Scheduler
 * invokes them, so they must not be reachable through a lane and must not carry
 * callable options. They are listed in `LEGACY_MODULES` only so `index.ts`
 * publishes them — every other module there is a callable the light lane serves.
 */
export const SCHEDULED_FUNCTIONS = [
  "bitesMirrorSweep",
  "homeSnapshotRepair",
  "deliveryProximitySweep",
  "serviceOdometerSync",
  "serviceVehicleDistanceSweep",
] as const;

export const SCAN_FUNCTIONS = [
  "adminPerformanceOpsSnapshot",
  /**
   * Order Comparison joins `order_recon_rows` with `deliveries`, `drivers`,
   * `profiles` and `restaurants` for a month window.
   *
   * Measured on production 2026-11-02: October 2026 is **85,878** AM rows (31s)
   * plus **175,584** deliveries read as day slices (110s), and they run
   * together. The scan lane's 180s is what this read needs; its five-minute
   * read-through snapshot means only the first open of a window pays it.
   */
  "adminOrderComparisonSnapshot",
  /**
   * Import Compare is the same `loadDeliveriesByDay` scan as the snapshot,
   * plus the uploaded Excel rows. A 20-day sheet on the light lane's 60s
   * abort never finished; the scan lane is the one that can.
   */
  "adminOrderReconCompare",
  "adminDeliveriesStatusCounts",
  "adminDeliveriesCountsByFilters",
  "adminListDriversPage",
  "adminDriversFilterValues",
  "adminLiveFleetSnapshot",
  "adminPayrollRuleSnapshot",
  "adminPayrollMonthSnapshot",
  "adminHrPayrollSnapshot",
  /** A month of `driver_sessions`, unioned per rider per day. Display only. */
  "adminHrAppHours",
  "adminListAttendanceDaily",
  "adminAttendanceKpis",
  "adminIncentiveDailyReport",
  "adminEmployeesDashboard",
  /** Roster-wide status, leave and job-end scans. Leave list/upsert stay on the light lane. */
  "adminOperationsDashboard",
  "adminClientPortalDashboard",
  /**
   * Month-to-date level for the fleet: one attendance window, one rollup
   * window, and the roster joined in. The single-rider call from a detail page
   * narrows all three, but the fleet view is the same shape as the other
   * roster snapshots above.
   */
  "adminListDriverLevels",
] as const;

export const HEAVY_FUNCTIONS = [
  "adminPurgeFilterColumns",
  "adminPurgePreviewAll",
  "adminPurgeFilteredValues",
  "adminPurgeFilteredPreview",
  "adminPurgeFilteredPage",
  "adminPurgeRunAll",
  "adminPurgeFilteredRun",
  /** Clear all on a list page: deletes the ticked rows, one batch per round. */
  "adminPurgeSelected",
  "adminPreviewPurge",
  "adminPurgeDeliveries",
  "adminPurgeDrivers",
  "adminPurgeIntakes",
  "adminPurgeRestaurants",
  "adminPurgeZones",
  "adminPurgeDeliveryRules",
  "adminPurgeIncentiveRules",
  "adminPurgeAssetCatalog",
  "recalculateDriverEarnings",
  "recalculateEarningsForDate",
  "recalculateEarningsForRange",
  "claimDriverImportChunk",
  "resolveImportDriverIds",
  "cleanupDriverLocationEvents",
  "cleanupDriverOperationEvents",
  "cleanupDriverTelemetryEvents",
  "cleanupStaleDriverLocations",
  "esignComposeSignedDocument",
  /**
   * Writes one snapshot per rider and, when asked, one notification per rider
   * whose level changed into D. Sequential writes and FCM sends behind a whole
   * roster: concurrency 1 and 300s, not the scan lane's 120s.
   */
  "adminEvaluateDriverLevelsSweep",
] as const;

const SCAN = new Set<string>(SCAN_FUNCTIONS);
const HEAVY = new Set<string>(HEAVY_FUNCTIONS);
const WORKER = new Set<string>(WORKER_HTTP_FUNCTIONS);
const SCHEDULED = new Set<string>(SCHEDULED_FUNCTIONS);

export const LANE_FUNCTION_NAME: Record<LaneId, LaneExportName> = {
  light: "adminApi",
  scan: "adminApiScan",
  heavy: "adminApiHeavy",
};

/** Client abort must be at least the lane's server timeout. Light uses the 60s platform default. */
export const LANE_CLIENT_TIMEOUT_MS: Record<LaneId, number> = {
  light: 60_000,
  scan: 180_000,
  heavy: 300_000,
};

export function isDriverAppCallable(name: string): boolean {
  return name.startsWith("driver") && name !== "driverOpsAuditHealth";
}

export function laneOf(name: string): LaneId | null {
  if (WORKER.has(name) || SCHEDULED.has(name) || isDriverAppCallable(name)) return null;
  if (SCAN.has(name)) return "scan";
  if (HEAVY.has(name)) return "heavy";
  if (moduleForFunction(name)) return "light";
  return null;
}

export function functionsForLane(lane: LaneId): readonly string[] {
  switch (lane) {
    case "scan":
      return SCAN_FUNCTIONS;
    case "heavy":
      return HEAVY_FUNCTIONS;
    case "light":
      return allLegacyNames().filter((name) => laneOf(name) === "light");
    default: {
      const unexpected: never = lane;
      throw new Error(`unknown lane ${String(unexpected)}`);
    }
  }
}

export function callableOptionsForLane(lane: LaneId): LaneRuntimeOptions {
  switch (lane) {
    case "light":
      return {
        region: FUNCTIONS_REGION,
        cpu: 1,
        memory: "2GiB",
        concurrency: 8,
        minInstances: 0,
        maxInstances: 8,
      };
    case "scan":
      return {
        region: FUNCTIONS_REGION,
        cpu: 1,
        memory: "4GiB",
        concurrency: 2,
        minInstances: SCAN_MIN_INSTANCES,
        maxInstances: 6,
        /**
         * 180s, not 120s.
         *
         * Order Comparison is the widest reader on this lane: October 2026 is
         * 85,878 AM rows (31s) plus 175,584 deliveries read as day slices
         * (110s), and they run together. At 120s the pair landed within a
         * second of the ceiling, so one more month of growth would turn a legal
         * "Last month" into a timeout. The five-minute read-through snapshot
         * keeps only the first open of a window paying this.
         */
        timeoutSeconds: 180,
      };
    case "heavy":
      return {
        region: FUNCTIONS_REGION,
        cpu: 1,
        memory: "4GiB",
        concurrency: 1,
        minInstances: 0,
        maxInstances: 3,
        timeoutSeconds: 300,
      };
    default: {
      const unexpected: never = lane;
      throw new Error(`unknown lane ${String(unexpected)}`);
    }
  }
}

export function laneIdForExport(name: string): LaneId | null {
  switch (name) {
    case "adminApi":
      return "light";
    case "adminApiScan":
      return "scan";
    case "adminApiHeavy":
      return "heavy";
    default:
      return null;
  }
}

function assertPartition(): void {
  const names = allLegacyNames();
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate legacy export ${name}`);
    seen.add(name);
  }
  for (const name of [...SCAN_FUNCTIONS, ...HEAVY_FUNCTIONS]) {
    if (!seen.has(name)) throw new Error(`lane member is not an export: ${name}`);
    if (WORKER.has(name) || SCHEDULED.has(name) || isDriverAppCallable(name)) {
      throw new Error(`excluded callable is on a lane: ${name}`);
    }
  }
  for (const name of SCAN_FUNCTIONS) {
    if (HEAVY.has(name)) throw new Error(`function is on two lanes: ${name}`);
  }
}

assertPartition();
