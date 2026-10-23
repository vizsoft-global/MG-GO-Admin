export type HrPayrollGroup = "emp" | "ops" | "in" | "calc" | "imp" | "pay";

export type HrSummaryBy = "company" | "sponsor" | "project" | "zone" | "section";

export type HrGroupBy = "none" | "company" | "project" | "section";

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
  hiringType: string;
  workStart: string;
  jobEnd: string;
  jobEndDescription: string;
  fixedSalary: number;
  workPermitSalary: number;
  bankNumber: string;
  bankName: string;
  currency: string;
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
};

export type HrPayrollRow = {
  driverId: string;
  approved: boolean;
  active: boolean;
  statusKey: string;
  jobEndDescription: string;
  searchBlob: string;
  company: string;
  project: string;
  section: string;
  sponsor: string;
  zone: string;
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
};

export type HrColumnFilter = {
  key: string;
  mode: "contains" | "exact";
  value: string;
};
