export type HrPayrollGroup = "emp" | "cfg" | "ops" | "in" | "calc" | "imp" | "pay";

export type HrSummaryBy = "company" | "sponsor" | "project" | "zone" | "section";

export type HrGroupBy =
  | "none"
  | "company"
  | "project"
  | "section"
  | "clientName"
  | "zone"
  | "vehicle"
  | "sponsor"
  | "rest"
  | "status"
  | "natCat"
  | "hiring";

export type HrImportField =
  | "pendingSalary"
  | "trafficViolation"
  | "loanDeduction"
  | "totalAllowances"
  | "totalDeductions";

/** Values an operator can change. Ops figures stay on the payroll snapshot. */
export type HrEditState = {
  twoYear: number;
  fourYear: number;
  food: number;
  sick: number;
  pending: number;
  traffic: number;
  loan: number;
  allowances: number;
  deductions: number;
};

export type HrBundleRow = {
  driverId: string;
  employeeId: string;
  driverCode: string;
  fullName: string;
  civilId: string;
  clientId: string;
  clientName: string;
  projectKey: string;
  nationality: string;
  nationalityCategory: string;
  statusKey: string;
  statusLabel: string;
  section: string;
  sponsor: string;
  company: string;
  position: string;
  /** The raw catalog key on the driver; rates match on this, not the label. */
  positionKey: string;
  hiringType: string;
  workStart: string;
  jobEnd: string;
  jobEndDescription: string;
  fixedSalary: number;
  workPermitSalary: number;
  bankNumber: string;
  bankName: string;
  /** The raw `bank_codes` key and `zones` id, so the sheet can edit them. */
  bankCode: string;
  zoneId: string;
  currency: string;
  /** The rider's assigned vehicle, and its catalog type. Empty when unassigned. */
  vehicleId: string;
  vehicleTypeKey: string;
  twoYear: number;
  fourYear: number;
  food: number;
  sick: number;
  pending: number;
  traffic: number;
  loan: number;
  allowances: number;
  deductions: number;
  incentives: number;
};

export type HrBundle = {
  month: string;
  opsApproved: boolean;
  rows: HrBundleRow[];
};

export type HrCellPatch = Partial<HrEditState>;

export type HrPayrollNumbers = {
  payment: number;
  totalSalary: number;
  salaryAsPerHours: number;
  pendingSalary: number;
  trafficViolation: number;
  loanDeduction: number;
  totalAllowances: number;
  totalDeductions: number;
  sickReimbursement: number;
  twoYearAmount: number;
  fourYearAmount: number;
  incentives: number;
  foodAllowance: number;
  orders: number;
  revenue: number;
  contribution: number;
  /** App-open hours (sessions, unioned). Display only — never in a pay formula. */
  appHours: number;
};

export type HrPayrollRow = {
  driverId: string;
  approved: boolean;
  active: boolean;
  statusKey: string;
  jobEndDescription: string;
  /** Work Permit Salary from the HR sheet; drives the Total Salary shortfall flag. */
  permitSalary: number;
  searchBlob: string;
  company: string;
  project: string;
  section: string;
  sponsor: string;
  zone: string;
  /** The rider's vehicle-type catalog key; drives the inline Vehicle Type cell. */
  vehicleKey: string;
  /** The raw bank/zone/client keys the identity cells pick from. */
  bankCode: string;
  zoneId: string;
  projectKey: string;
  cells: Record<string, string>;
  numbers: HrPayrollNumbers;
  edit: HrEditState;
  identityEdit: {
    clientId: string;
    employeeId: string;
    fullName: string;
    restaurantName: string;
  };
};

export type HrSummaryLine = {
  key: string;
  label: string;
  payment: number;
  salaryAsPerHours: number;
  incentives: number;
  pendingSalary: number;
  sickReimbursement: number;
  trafficViolation: number;
  loanDeduction: number;
  totalAllowances: number;
  totalDeductions: number;
  riders: number;
  vehicleType: string;
  rateLabel: string;
  orders: number;
  revenue: number;
  contribution: number;
};

export type HrSheetFilters = {
  clientName: string;
  zone: string;
  vehicle: string;
  nationality: string;
  company: string;
  store: string;
};

export const EMPTY_HR_SHEET_FILTERS: HrSheetFilters = {
  clientName: "",
  zone: "",
  vehicle: "",
  nationality: "",
  company: "",
  store: "",
};

export type HrColumnFilter = {
  key: string;
  mode: "contains" | "exact";
  value: string;
};
