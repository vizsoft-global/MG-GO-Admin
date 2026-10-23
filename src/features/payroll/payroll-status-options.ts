import { PAYROLL_STATUS_CHIP, type DayStatus } from "./payroll-formulas";

/** The Status column's only built-in choices, in filter order. */
export const CORE_PAYROLL_STATUS_KEYS = [
  "active",
  "absent",
  "leave",
  "active_payroll",
  "accident",
  "terminated",
  "cancelled",
] as const;

export type CorePayrollStatusKey = (typeof CORE_PAYROLL_STATUS_KEYS)[number];

export const CORE_PAYROLL_STATUS_LABEL: Record<CorePayrollStatusKey, string> = {
  active: "Active",
  absent: "Absent",
  leave: "Leave",
  active_payroll: "Active Payroll",
  accident: "Accident",
  terminated: "Terminated",
  cancelled: "Cancelled",
};

/** Null means the account-style emerald pill. Active Payroll stays a distinct green. */
export const CORE_PAYROLL_STATUS_HEX: Record<CorePayrollStatusKey, string | null> = {
  active: null,
  absent: PAYROLL_STATUS_CHIP.absent.hex,
  leave: PAYROLL_STATUS_CHIP.leave.hex,
  active_payroll: "#1e7e34",
  accident: PAYROLL_STATUS_CHIP.accident.hex,
  terminated: PAYROLL_STATUS_CHIP.terminated.hex,
  cancelled: PAYROLL_STATUS_CHIP.cancelled.hex,
};

export const CUSTOM_STATUS_HEX = "#64748b";

const MAX_STATUS_LABEL = 40;

export function isCorePayrollStatus(value: string): value is CorePayrollStatusKey {
  return (CORE_PAYROLL_STATUS_KEYS as readonly string[]).includes(value);
}

/**
 * Fold a day cell into a Status-column choice.
 * Worked, off, and the retired day types read as Active.
 * Active Payroll has no day source — an operator sets it by hand.
 * Sick reads as Leave so it leaves the dropdown. A blank cell is not a status.
 */
export function payrollGridStatusFromDay(status: DayStatus): CorePayrollStatusKey | null {
  switch (status) {
    case "blank":
      return null;
    case "absent":
    case "abs_lh":
    case "abs_lo":
      return "absent";
    case "leave":
    case "sick":
      return "leave";
    case "accident":
      return "accident";
    case "terminated":
      return "terminated";
    case "cancelled":
      return "cancelled";
    case "work":
    case "reduced3":
    case "half":
    case "actual":
    case "off":
    case "vehicle":
    case "phone_issue":
    case "id_suspended":
    case "new_hire":
    case "training":
    case "custom":
      return "active";
    default: {
      const never: never = status;
      return never;
    }
  }
}

/** The checklist: the seven cores, then saved and in-use custom labels. */
export function statusFilterLabels(
  customs: readonly string[],
  inUse: readonly string[] = [],
): string[] {
  const cores = CORE_PAYROLL_STATUS_KEYS.map((key) => CORE_PAYROLL_STATUS_LABEL[key]);
  const seen = new Set(cores.map((label) => label.toLowerCase()));
  const extras: string[] = [];
  for (const raw of [...customs, ...inUse]) {
    const label = raw.trim().replace(/\s+/g, " ");
    const fold = label.toLowerCase();
    if (!label || seen.has(fold)) continue;
    seen.add(fold);
    extras.push(label);
  }
  extras.sort((a, b) => a.localeCompare(b));
  return [...cores, ...extras];
}

/** A typed or clicked label. A core word stores the core key, whatever the caller typed. */
export function payrollStatusChoiceFromLabel(label: string): { key: string; label: string } | null {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_STATUS_LABEL || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const core = CORE_PAYROLL_STATUS_KEYS.find(
    (key) => CORE_PAYROLL_STATUS_LABEL[key].toLowerCase() === trimmed.toLowerCase(),
  );
  if (core) return { key: core, label: CORE_PAYROLL_STATUS_LABEL[core] };
  return { key: "custom", label: trimmed };
}
