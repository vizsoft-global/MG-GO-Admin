/**
 * One wording per shared payroll field.
 *
 * The header cell, the column picker, the filter placeholder, the CSV resolver
 * and the workbook header all read this map, so a column cannot be "Driver ID"
 * on the screen and "Client ID" in the download. Column ids stay as they are —
 * only the printed words are decided here.
 */

/** Canonical English label per column id. Ids not listed keep their own label. */
export const PAYROLL_COLUMN_LABELS: Readonly<Record<string, string>> = {
  serial: "#",
  i: "#",
  /** `amId` is the employee's MG ID; the HR sheet spells the same column `mg`. */
  amId: "MG ID",
  mg: "MG ID",
  /**
   * `mgId` is the rider's **Driver ID** (`drivers.driver_code`, e.g. 10782). It
   * is NOT the same field as HR Payroll's "Client ID" (105913), which is the
   * person-level `drivers.client_id` / the restaurant's client id — verified
   * against production: one rider carries 3054 / 10043 / 105466 at once.
   */
  mgId: "Driver ID",
  client: "Client ID",
  clientId: "Client ID",
  name: "Employee Name",
  status: "Status",
};

/**
 * The label a payroll surface prints for a column: the canonical wording when
 * this module owns one, otherwise the caller's own (already translated) text.
 */
export function payrollColumnLabel(columnId: string, fallback: string): string {
  return PAYROLL_COLUMN_LABELS[columnId] ?? fallback;
}

/**
 * Status words. `active` reads **Running**, which is what the client's sheet
 * calls a rider who is working — the stored keys and hexes stay exactly as they
 * were, only the printed word changes.
 */
export const PAYROLL_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "Running",
  active_payroll: "Active Payroll",
  inactive: "Inactive",
  absent: "Absent",
  leave: "Leave",
  accident: "Accident",
  terminated: "Terminated",
  cancelled: "Cancelled",
};

/** Words that mean `active` in older rows. Kept so a stored label still resolves. */
const ACTIVE_ALIASES = new Set(["active", "running"]);

/**
 * The word a pill, the legend, the filter list or an export prints for a status
 * label. Only the `active` word is renamed; a status the map does not own is
 * returned untouched, so an HR catalogue label is never re-worded by accident.
 */
export function payrollStatusDisplayLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return label;
  if (ACTIVE_ALIASES.has(trimmed.toLowerCase())) return PAYROLL_STATUS_LABELS.active;
  return label;
}

/** Display word for a stored status key (`active` → `Running`). */
export function payrollStatusDisplayLabelOfKey(key: string): string {
  return PAYROLL_STATUS_LABELS[key] ?? payrollStatusDisplayLabel(key);
}
