export type UiPreferenceSort = {
  id: string;
  dir: "asc" | "desc";
};

export type ListColumnPreference = {
  order: string[];
  visible: string[];
  sort: UiPreferenceSort | null;
  /** Last Group by column id, or "none". Optional so older saved prefs still load. */
  groupBy?: string | null;
  /** Last list or grid choice. Optional so older saved prefs still load. */
  viewMode?: "list" | "grid";
};

export type UiPreferenceSource = "user" | "role" | "system";

export type EffectiveUiPreference<T> = {
  effective: T;
  source: UiPreferenceSource;
  roleDefault: T | null;
  userOverride: T | null;
};

export const DRIVERS_LIST_COLUMNS_PREF_KEY = "drivers.list.columns.v2";

/** Combined Payroll column order and visibility, saved per staff member. */
export const PAYROLL_COMBINED_COLUMNS_PREF_KEY = "payroll.combined";

/** Payroll tab (rider summary) column order and visibility. */
export const PAYROLL_SUMMARY_COLUMNS_PREF_KEY = "payroll.summary.columns";

/** HR Payroll sheet column order and visibility. */
export const HR_PAYROLL_COLUMNS_PREF_KEY = "payroll.hr.columns";

/** Attendance & Orders tab column order and visibility. */
export const PAYROLL_AO_COLUMNS_PREF_KEY = "payroll.ao.columns";

/** Application Attendance tab column order and visibility. */
export const PAYROLL_APP_ATTENDANCE_COLUMNS_PREF_KEY = "payroll.application-attendance.columns";
