import type { HrPayrollGroup } from "./hr-payroll-types";

export type HrColumnKind = "index" | "text" | "money" | "dec2" | "int" | "pct" | "select";

export type HrColumn = {
  key: string;
  header: string;
  group: HrPayrollGroup;
  kind: HrColumnKind;
  width: number;
  select?: readonly number[];
  unit?: string;
  editable?: "select" | "amount";
  filter: "none" | "contains" | "exact" | "auto";
  mono?: boolean;
};

export const HR_GROUP_ORDER = ["emp", "cfg", "ops", "in", "calc", "imp", "pay"] as const;

export const HR_GROUP_FILL: Record<HrPayrollGroup, string> = {
  emp: "#EDEEF6",
  cfg: "#E7F0FA",
  ops: "#F8ECE6",
  calc: "#EAF3EF",
  in: "#FBF4E2",
  imp: "#EEF0F8",
  pay: "#E8E9F2",
};

const INC = [0, 20, 30, 40] as const;
const FOOD = [0, 15] as const;
const SICK = Array.from({ length: 31 }, (_, n) => n);

export const HR_COLUMNS: readonly HrColumn[] = [
  { key: "i", header: "#", group: "emp", kind: "index", width: 44, filter: "none" },
  { key: "client", header: "Client ID", group: "emp", kind: "text", width: 86, filter: "contains" },
  { key: "mg", header: "MG ID", group: "emp", kind: "text", width: 96, filter: "contains", mono: true },
  { key: "name", header: "Employee Name", group: "emp", kind: "text", width: 230, filter: "contains" },
  { key: "civil", header: "Civil ID", group: "emp", kind: "text", width: 140, filter: "contains", mono: true },
  { key: "bankNo", header: "Bank Number", group: "emp", kind: "text", width: 150, filter: "contains", mono: true },
  { key: "bank", header: "Bank", group: "emp", kind: "text", width: 140, filter: "auto" },
  { key: "cur", header: "Currency", group: "emp", kind: "text", width: 90, filter: "auto" },
  { key: "payment", header: "Payment", group: "pay", kind: "money", width: 120, filter: "contains" },
  { key: "clientName", header: "Client", group: "emp", kind: "text", width: 140, filter: "auto" },
  { key: "zone", header: "Zone", group: "emp", kind: "text", width: 120, filter: "auto" },
  { key: "rest", header: "Restaurant", group: "emp", kind: "text", width: 160, filter: "auto" },
  { key: "nationality", header: "Nationality", group: "emp", kind: "text", width: 130, filter: "auto" },
  { key: "natCat", header: "Nationality Category", group: "emp", kind: "text", width: 170, filter: "auto" },
  { key: "status", header: "Employee Status", group: "emp", kind: "text", width: 170, filter: "auto" },
  { key: "start", header: "Work Start", group: "emp", kind: "text", width: 140, filter: "contains" },
  { key: "endDate", header: "Job End Date", group: "emp", kind: "text", width: 130, filter: "contains" },
  { key: "endDesc", header: "Job End Description", group: "emp", kind: "text", width: 180, filter: "auto" },
  { key: "company", header: "Company", group: "emp", kind: "text", width: 150, filter: "auto" },
  { key: "sponsor", header: "Sponsor", group: "emp", kind: "text", width: 140, filter: "auto" },
  { key: "position", header: "Job Position", group: "emp", kind: "text", width: 150, filter: "auto" },
  { key: "hiring", header: "Hiring Type", group: "emp", kind: "text", width: 130, filter: "auto" },
  { key: "section", header: "Section", group: "emp", kind: "text", width: 150, filter: "auto" },
  { key: "fixed", header: "Fixed Salary", group: "emp", kind: "money", width: 130, filter: "contains" },
  { key: "wps", header: "Work Permit Salary", group: "emp", kind: "money", width: 160, filter: "contains" },
  { key: "rate", header: "Rate", group: "cfg", kind: "text", width: 88, filter: "contains" },
  { key: "vtype", header: "Vehicle Type", group: "cfg", kind: "text", width: 110, filter: "auto" },
  { key: "inc2", header: "2 Years Increment Applicable", group: "in", kind: "select", width: 200, select: INC, unit: " KWD", editable: "select", filter: "exact" },
  { key: "inc4", header: "4 Years Increment Applicable", group: "in", kind: "select", width: 200, select: INC, unit: " KWD", editable: "select", filter: "exact" },
  { key: "offs", header: "No. of Offs", group: "ops", kind: "int", width: 110, filter: "contains" },
  { key: "fwd", header: "F.Working Days", group: "ops", kind: "int", width: 140, filter: "contains" },
  { key: "fwh", header: "F.Working Hours", group: "ops", kind: "int", width: 150, filter: "contains" },
  { key: "hourly", header: "Hourly Rate as per F.Working Days", group: "calc", kind: "money", width: 220, filter: "contains" },
  { key: "orders", header: "Count of Orders", group: "ops", kind: "int", width: 140, filter: "contains" },
  { key: "wd", header: "Count of Working Days", group: "ops", kind: "int", width: 180, filter: "contains" },
  { key: "ah", header: "Actual Working Hours", group: "ops", kind: "dec2", width: 170, filter: "contains" },
  { key: "restDpd", header: "Restaurant DPD", group: "ops", kind: "dec2", width: 140, filter: "contains" },
  { key: "riderDpd", header: "Rider DPD", group: "ops", kind: "dec2", width: 110, filter: "contains" },
  { key: "eff", header: "Efficiency", group: "calc", kind: "pct", width: 110, filter: "contains" },
  { key: "salH", header: "Salary as per Hours", group: "calc", kind: "money", width: 160, filter: "contains" },
  { key: "inc2v", header: "2 Years of Experience Increment", group: "calc", kind: "money", width: 230, filter: "contains" },
  { key: "inc4v", header: "4 Years of Experience Increment", group: "calc", kind: "money", width: 230, filter: "contains" },
  { key: "incent", header: "Incentives", group: "ops", kind: "money", width: 120, filter: "contains" },
  { key: "food", header: "Food Allowance", group: "in", kind: "select", width: 140, select: FOOD, unit: " KWD", editable: "select", filter: "exact" },
  { key: "sick", header: "Sick Leave Days", group: "in", kind: "select", width: 140, select: SICK, editable: "select", filter: "exact" },
  { key: "sickR", header: "Sick Leave Reimbursement", group: "calc", kind: "money", width: 190, filter: "contains" },
  { key: "pending", header: "Pending Salary", group: "imp", kind: "money", width: 140, editable: "amount", filter: "contains" },
  { key: "traffic", header: "Traffic Violation", group: "imp", kind: "money", width: 150, editable: "amount", filter: "contains" },
  { key: "loan", header: "Loan Deduction", group: "imp", kind: "money", width: 140, editable: "amount", filter: "contains" },
  { key: "allow", header: "Total Allowances", group: "imp", kind: "money", width: 150, editable: "amount", filter: "contains" },
  { key: "ded", header: "Total Deductions", group: "imp", kind: "money", width: 150, editable: "amount", filter: "contains" },
  { key: "total", header: "Total Salary", group: "pay", kind: "money", width: 130, filter: "contains" },
];

export const HR_OPS_KEYS = new Set([
  "offs",
  "fwd",
  "fwh",
  "orders",
  "wd",
  "ah",
  "restDpd",
  "riderDpd",
  "incent",
  "hourly",
  "eff",
  "salH",
  "inc2v",
  "inc4v",
]);

export const HR_FOOTER_KEYS = [
  "payment",
  "total",
  "salH",
  "pending",
  "traffic",
  "loan",
  "allow",
  "ded",
  "sickR",
  "inc2v",
  "inc4v",
  "incent",
  "food",
] as const;

export function visibleHrColumns(shown: ReadonlySet<HrPayrollGroup>): HrColumn[] {
  return HR_COLUMNS.filter((column) => shown.has(column.group));
}

export function hrGroupSpans(columns: readonly { group: HrPayrollGroup }[]): { group: HrPayrollGroup; count: number }[] {
  const spans: { group: HrPayrollGroup; count: number }[] = [];
  columns.forEach((column, idx) => {
    const group: HrPayrollGroup = idx < 4 ? "emp" : column.group;
    const last = spans[spans.length - 1];
    if (last && last.group === group && idx !== 4) last.count += 1;
    else spans.push({ group, count: 1 });
  });
  return spans;
}

export function stickyOffsets(columns: readonly { width: number }[]): number[] {
  let left = 0;
  return columns.slice(0, 4).map((column) => {
    const at = left;
    left += column.width;
    return at;
  });
}
