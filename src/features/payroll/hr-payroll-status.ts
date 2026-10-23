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

export function isEndOfContract(description: string): boolean {
  return description.trim().toLowerCase() === "end of contract";
}

export function hrStatusPaint(statusKey: string, jobEndDescription = "", tile = false): HrStatusPaint {
  if (statusKey === "cancelled") {
    if (tile) return CANCEL_SPLIT;
    return isEndOfContract(jobEndDescription) ? CANCEL_GREEN : CANCEL_RED;
  }
  if (statusKey === "running" || statusKey === "extension") return OPEN;
  if (statusKey in PAINT) return PAINT[statusKey as keyof typeof PAINT];
  return OPEN;
}
