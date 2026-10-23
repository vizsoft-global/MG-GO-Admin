import type { HrColumn } from "../../hr-payroll-columns";
import type { HrEditState, HrImportField } from "../../hr-payroll-types";

export const COLUMN_EDIT: Record<string, keyof HrEditState> = {
  inc2: "twoYear",
  inc4: "fourYear",
  food: "food",
  sick: "sick",
  pending: "pending",
  traffic: "traffic",
  loan: "loan",
  allow: "allowances",
  ded: "deductions",
};

export const IMPORT_EDIT: Record<HrImportField, keyof HrEditState> = {
  pendingSalary: "pending",
  trafficViolation: "traffic",
  loanDeduction: "loan",
  totalAllowances: "allowances",
  totalDeductions: "deductions",
};

export function optionLabel(value: number, column: HrColumn): string {
  if (value === 0 && column.key !== "sick") return "—";
  return `${value}${column.unit ?? ""}`;
}

export function money3(value: number): string {
  return value.toFixed(3);
}

export function moneyGrouped(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
