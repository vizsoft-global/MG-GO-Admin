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
  offDays: number;
  sickDays: number;
  accidentDays: number;
  absentDays: number;
  fixedDays: number;
  efficiency: number;
  unjustified: number;
};

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

export type PayrollHubTab = "payroll" | "requests";
