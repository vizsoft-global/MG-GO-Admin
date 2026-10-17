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
 * - Names that start with `driver` are the rider app's legacy callables, except
 *   driverOpsAuditHealth, which the admin cron calls.
 */
import { allLegacyNames, moduleForFunction } from "./legacy-modules";

export const FUNCTIONS_REGION = "me-central1";

/** Phase 5 sets this to 0. Until then the scan lane stays warm. */
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

export const SCAN_FUNCTIONS = [
  "adminPerformanceOpsSnapshot",
  "adminDeliveriesStatusCounts",
  "adminDeliveriesCountsByFilters",
  "adminListDriversPage",
  "adminDriversFilterValues",
  "adminLiveFleetSnapshot",
  "adminPayrollRuleSnapshot",
  "adminPayrollMonthSnapshot",
  "adminListAttendanceDaily",
  "adminAttendanceKpis",
  "adminIncentiveDailyReport",
  "adminEmployeesDashboard",
] as const;

export const HEAVY_FUNCTIONS = [
  "adminPurgeFilterColumns",
  "adminPurgePreviewAll",
  "adminPurgeFilteredValues",
  "adminPurgeFilteredPreview",
  "adminPurgeFilteredPage",
  "adminPurgeRunAll",
  "adminPurgeFilteredRun",
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
] as const;

const SCAN = new Set<string>(SCAN_FUNCTIONS);
const HEAVY = new Set<string>(HEAVY_FUNCTIONS);
const WORKER = new Set<string>(WORKER_HTTP_FUNCTIONS);

export const LANE_FUNCTION_NAME: Record<LaneId, LaneExportName> = {
  light: "adminApi",
  scan: "adminApiScan",
  heavy: "adminApiHeavy",
};

/** Client abort must be at least the lane's server timeout. Light uses the 60s platform default. */
export const LANE_CLIENT_TIMEOUT_MS: Record<LaneId, number> = {
  light: 60_000,
  scan: 120_000,
  heavy: 300_000,
};

export function isDriverAppCallable(name: string): boolean {
  return name.startsWith("driver") && name !== "driverOpsAuditHealth";
}

export function laneOf(name: string): LaneId | null {
  if (WORKER.has(name) || isDriverAppCallable(name)) return null;
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
        timeoutSeconds: 120,
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
    if (WORKER.has(name) || isDriverAppCallable(name)) {
      throw new Error(`excluded callable is on a lane: ${name}`);
    }
  }
  for (const name of SCAN_FUNCTIONS) {
    if (HEAVY.has(name)) throw new Error(`function is on two lanes: ${name}`);
  }
}

assertPartition();
