import type { OpsSlicers } from "@/features/performance/performance-ops-types";
import type {
  DayStatus,
  PayrollKpis,
  PayrollMonthMeta,
  PayrollTileKey,
  PayrollUiStatus,
  RequestKpis,
} from "./payroll-formulas";

export type PayrollSlicers = OpsSlicers;

export type PayrollOptions = {
  zones: Array<{ id: string; name: string }>;
  restaurants: Array<{ id: string; name: string }>;
  nationalities: string[];
  sourceCompanies: string[];
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
  partner: string;
  projectKey: string | null;
  nationality: string;
  nationalityCode: string | null;
  status: "Active" | "Inactive";
  vehicleKey: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  days: DayStatus[];
  workDays: number;
  totalHours: number;
  /** OFF day-cells in the grid, derived from approved leave requests. */
  offDays: number;
  sickDays: number;
  accidentDays: number;
  absentDays: number;
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
};

export type PayrollHubTab = "payroll" | "combined" | "requests";

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
