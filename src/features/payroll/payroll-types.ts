import type { OpsSlicers } from "@/features/performance/performance-ops-types";
import type {
  DayStatus,
  PayrollKpis,
  PayrollMonthMeta,
  PayrollTileKey,
  PayrollUiStatus,
  RequestKpis,
} from "./payroll-formulas";
import type {
  AdjustmentStatus,
  DaySource,
  PayrollClientConfig,
  PayrollRule,
  ZoneCategory,
} from "./payroll-rules-engine";
import type { ZoneMetricInput } from "./payroll-zone-metrics";

export type { PayrollMonthMeta };

export type PayrollSlicers = OpsSlicers;

export type PayrollOptions = {
  zones: Array<{ id: string; name: string }>;
  restaurants: Array<{ id: string; name: string }>;
  nationalities: string[];
  sourceCompanies: string[];
};

/** Per-day inputs and the engine's verdict, parallel to `days`. */
export type PayrollDayInfo = {
  /** Daily final adjusted orders (Order Reconciliation). */
  orders: number;
  /** Kuwait check-in → check-out hours. */
  loggedHours: number;
  source: DaySource;
  /** The rule that decided the day, when a rule did. */
  ruleLabel: string | null;
  adjusted: boolean;
  /** The adjustment in force, and its reason. */
  adjustmentStatus: AdjustmentStatus | null;
  adjustmentHours: number | null;
  adjustmentReason: string | null;
  /** Credited hours for this day. */
  creditedHours: number;
};

export type PayrollRiderRow = {
  driverId: string;
  amId: string;
  mgId: string;
  name: string;
  restaurant: string;
  restaurantId: string | null;
  zone: string;
  zoneId: string | null;
  /** The zone's category from the previous month, as the rules see it. */
  zoneCategory: ZoneCategory;
  zoneEfficiency: number | null;
  zoneDpd: number | null;
  partner: string;
  projectKey: string | null;
  nationality: string;
  nationalityCode: string | null;
  status: "Active" | "Inactive";
  vehicleKey: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  days: DayStatus[];
  dayInfo: PayrollDayInfo[];
  /** Days credited as a full 12 h day. */
  workDays: number;
  /** Credited hours for the month (Σ the engine's hours per day). */
  totalHours: number;
  /** OFF day-cells in the grid, from approved leave requests or an adjustment. */
  offDays: number;
  sickDays: number;
  accidentDays: number;
  absentDays: number;
  /** SOP day types added in v4. */
  reducedDays: number;
  halfDays: number;
  actualDays: number;
  vehicleDays: number;
  absLhDays: number;
  absLoDays: number;
  customDays: number;
  /** Σ daily final adjusted orders for the month. */
  finalOrders: number;
  /** Day-cells currently carrying a hand adjustment. */
  adjustedCells: number;
  fixedDays: number;
  /** Contracted OFF days for the month, from driver_off_structure. */
  offStructureDays: number;
  offStructureSource: OffStructureSource;
  offStructureHours: number;
  requiredHours: number;
  actualHours: number;
  efficiency: number;
  unjustified: number;
};

/** 'default' = no driver_off_structure row, so the 2-day fallback applies. */
export type OffStructureSource = "default" | "manual" | "bulk_upload";

export type PayrollRequestRow = {
  id: string;
  code: string;
  driverId: string;
  riderName: string;
  riderCode: string;
  tile: PayrollTileKey;
  day: string;
  zone: string;
  partner: string;
  reviewingDept: string;
  liveStatus: string;
  uiStatus: PayrollUiStatus;
};

export type PayrollSnapshot = {
  today: string;
  month: PayrollMonthMeta;
  months: PayrollMonthMeta[];
  options: PayrollOptions;
  riders: PayrollRiderRow[];
  requests: PayrollRequestRow[];
  payrollKpis: PayrollKpis;
  requestKpis: RequestKpis;
  workflow: { awaitingAction: number; requestsPerRider: number };
  /** The completed month the zone efficiency was read from. */
  zoneMonth: string;
  clients: PayrollClientConfig[];
  rules: PayrollRule[];
  zoneMetrics: PayrollZoneMetricRow[];
  canManage: boolean;
};

/** One zone's previous-month figures, as the snapshot returns them. */
export type PayrollZoneMetricRow = {
  zoneId: string;
  zoneName: string;
  orders: number;
  riderDays: number;
  dpd: number | null;
  targetDpd: number | null;
  dpdUsed: number | null;
  targetDpdUsed: number | null;
  efficiency: number | null;
  categoryAuto: ZoneCategory;
  categoryOverride: "good" | "average" | "low" | null;
  goodThreshold: number;
  averageThreshold: number;
  computedAt: string | null;
};

export type PayrollZoneOverrideInput = Pick<
  ZoneMetricInput,
  "dpdUsed" | "targetDpdUsed" | "categoryOverride"
>;

export type PayrollRuleConfigSnapshot = {
  month: string;
  canManage: boolean;
  clients: Array<
    PayrollClientConfig & {
      riderCount: number;
      effectiveMonth: string | null;
      hasRulesForMonth: boolean;
    }
  >;
  rules: PayrollRule[];
  audit: PayrollRuleAuditRow[];
};

export type PayrollRuleAuditRow = {
  id: string;
  clientKey: string | null;
  periodMonth: string | null;
  entity: string;
  action: string;
  actorName: string;
  createdAt: string;
  before: unknown;
  after: unknown;
};

/** One cell of an adjustment batch: a rider on a date. */
export type PayrollAdjustmentCell = {
  driverId: string;
  date: string;
  status: AdjustmentStatus;
  hours?: number | null;
};

/** One append-only manual adjustment record, as the audit list returns it. */
export type PayrollAdjustmentAuditRow = {
  id: string;
  driverId: string;
  driverName: string;
  mgId: string;
  workDate: string;
  originalStatus: string | null;
  adjustedStatus: string;
  adjustedHours: number | null;
  reason: string;
  actorName: string;
  adjustedAt: string;
};

export type PayrollAdjustmentResult = {
  applied: number;
  reason: string;
  by: string;
};

export type PayrollHubTab =
  | "payroll"
  | "combined"
  | "attendance-orders"
  | "requests"
  | "settings";

export type OffStructureBulkVerdict =
  | "applied"
  | "missing_id"
  | "duplicate"
  | "invalid_off_days"
  | "off_days_exceeds_month"
  | "unknown_id"
  | "ambiguous_id";

export type OffStructureBulkRow = {
  index: number;
  driverKey: string;
  offDays: number | null;
  previousOffDays: number | null;
  verdict: OffStructureBulkVerdict;
  driverId: string | null;
  driverName: string | null;
};

export type OffStructureBulkResult = {
  ok: true;
  month: string;
  monthDays: number;
  applied: number;
  skipped: number;
  rows: OffStructureBulkRow[];
};
