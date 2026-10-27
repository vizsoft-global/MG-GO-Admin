export const HR_STATUS_ORDER = [
  "leave",
  "leave_return",
  "accident",
  "absent_mosal",
  "absent_moi",
  "on_hold",
  "new",
  "training",
  "transfer_from_company",
  "cancelled",
  "running",
  "extension",
] as const;

export type HrStatusKey = (typeof HR_STATUS_ORDER)[number];

const HR_STATUS_SET = new Set<string>(HR_STATUS_ORDER);

/** English labels the HR sheet and the ops Status column both print. */
export const HR_STATUS_LABEL: Record<HrStatusKey, string> = {
  leave: "Leave",
  leave_return: "Leave Return",
  accident: "Accident",
  absent_mosal: "Absent from MOSAL",
  absent_moi: "Absent from MOI",
  on_hold: "On Hold",
  new: "New",
  training: "Training",
  transfer_from_company: "Transfer from Company",
  cancelled: "Cancelled",
  running: "Running",
  extension: "Extension",
};

const INACTIVE = new Set(["cancelled", "on_hold", "absent_mosal", "absent_moi"]);

export type HrStatusPaint = {
  fill: string;
  text: string;
  split: boolean;
  bordered: boolean;
};

const PAINT: Record<Exclude<HrStatusKey, "cancelled" | "running" | "extension">, HrStatusPaint> = {
  leave: { fill: "#F28C28", text: "#2B1600", split: false, bordered: false },
  leave_return: { fill: "#BFE4F8", text: "#0E3346", split: false, bordered: false },
  accident: { fill: "#FFE45C", text: "#3A3000", split: false, bordered: false },
  absent_mosal: { fill: "#D13B3B", text: "#FFFFFF", split: false, bordered: false },
  absent_moi: { fill: "#D13B3B", text: "#FFFFFF", split: false, bordered: false },
  on_hold: { fill: "#D13B3B", text: "#FFFFFF", split: false, bordered: false },
  new: { fill: "#DCCDF6", text: "#2E1C57", split: false, bordered: false },
  training: { fill: "#FFD9B0", text: "#4A2600", split: false, bordered: false },
  transfer_from_company: { fill: "#C9EEC4", text: "#14401A", split: false, bordered: false },
};

const OPEN: HrStatusPaint = { fill: "transparent", text: "#292A3F", split: false, bordered: true };
const CANCEL_RED: HrStatusPaint = { fill: "#D13B3B", text: "#FFFFFF", split: false, bordered: false };
const CANCEL_GREEN: HrStatusPaint = { fill: "#1E6B3A", text: "#FFFFFF", split: false, bordered: false };
const CANCEL_SPLIT: HrStatusPaint = { fill: "transparent", text: "#FFFFFF", split: true, bordered: false };

export function isHrActive(statusKey: string): boolean {
  return !INACTIVE.has(statusKey);
}

function foldStatusNeedle(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function isHrStatusKey(value: string): value is HrStatusKey {
  return HR_STATUS_SET.has(value);
}

/** Match a catalog key, its English label, or "New hire" → `new`. */
export function hrStatusKeyFromLabel(label: string): HrStatusKey | null {
  const needle = foldStatusNeedle(label);
  if (!needle) return null;
  if (needle === "new hire") return "new";
  for (const key of HR_STATUS_ORDER) {
    if (foldStatusNeedle(key) === needle) return key;
    if (foldStatusNeedle(HR_STATUS_LABEL[key]) === needle) return key;
  }
  return null;
}

export function isEndOfContract(description: string): boolean {
  return foldStatusNeedle(description) === "end of contract";
}

export function hrStatusStyle(paint: HrStatusPaint): {
  background: string;
  color: string;
  border?: string;
} {
  if (paint.bordered) {
    return { background: paint.fill, color: paint.text, border: "1px solid #292A3F" };
  }
  return { background: paint.fill, color: paint.text };
}

export function hrStatusPaint(statusKey: string, jobEndDescription = "", tile = false): HrStatusPaint {
  if (!isHrStatusKey(statusKey)) return OPEN;
  switch (statusKey) {
    case "cancelled":
      if (tile) return CANCEL_SPLIT;
      return isEndOfContract(jobEndDescription) ? CANCEL_GREEN : CANCEL_RED;
    case "running":
    case "extension":
      return OPEN;
    case "leave":
    case "leave_return":
    case "accident":
    case "absent_mosal":
    case "absent_moi":
    case "on_hold":
    case "new":
    case "training":
    case "transfer_from_company":
      return PAINT[statusKey];
    default: {
      const never: never = statusKey;
      return never;
    }
  }
}
