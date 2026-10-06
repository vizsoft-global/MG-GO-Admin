export type ModuleTint = {
  chip: string;
  ink: string;
  tile: string;
};

const PALETTE: readonly ModuleTint[] = [
  { chip: "#0F766E", ink: "#ECFDF5", tile: "#0F766E" },
  { chip: "#1D4ED8", ink: "#DBEAFE", tile: "#2563EB" },
  { chip: "#C2410C", ink: "#FFEDD5", tile: "#EA580C" },
  { chip: "#15803D", ink: "#DCFCE7", tile: "#16A34A" },
  { chip: "#BE123C", ink: "#FFE4E6", tile: "#E11D48" },
  { chip: "#7C3AED", ink: "#EDE9FE", tile: "#7C3AED" },
  { chip: "#0E7490", ink: "#CFFAFE", tile: "#0891B2" },
  { chip: "#A16207", ink: "#FEF3C7", tile: "#D97706" },
  { chip: "#334155", ink: "#E2E8F0", tile: "#475569" },
  { chip: "#4338CA", ink: "#E0E7FF", tile: "#4F46E5" },
];

const BY_ID: Record<string, ModuleTint> = {
  "dashboard-ops": PALETTE[0],
  dashboard: PALETTE[0],
  "live-tracking-v2": PALETTE[1],
  "live-tracking": PALETTE[1],
  "driver-groups": PALETTE[2],
  drivers: PALETTE[3],
  deliveries: { chip: "#DB2777", ink: "#FCE7F3", tile: "#DB2777" },
  employeedesk: PALETTE[4],
  requests: PALETTE[4],
  "visit-bookings": PALETTE[5],
  "employeedesk-visits": PALETTE[5],
  "dpd-verification": PALETTE[0],
  earnings: PALETTE[3],
  restaurants: PALETTE[2],
  notifications: PALETTE[7],
  attendance: PALETTE[6],
  roles: PALETTE[8],
  profile: PALETTE[8],
  "document-expiry": PALETTE[4],
  "driver-app": PALETTE[9],
  assets: PALETTE[3],
  "operations-hub": PALETTE[1],
  vehicles: PALETTE[6],
  payroll: PALETTE[3],
  performance: PALETTE[7],
  assistant: PALETTE[5],
};

/**
 * Home launcher: canvas is the MG teal, not navy-grey. Tiles and icons use
 * the same mark as `/logo` (teal square, mint glyph). Sidebar chips and
 * Roles cards still use `moduleTint(id)`.
 */
export const LAUNCHER_BRAND_TINT: ModuleTint = PALETTE[0];

export const LAUNCHER_BRAND = {
  canvas: "#042F2E",
  tile: LAUNCHER_BRAND_TINT.tile,
  icon: LAUNCHER_BRAND_TINT.ink,
} as const;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function moduleTint(id: string): ModuleTint {
  return BY_ID[id] ?? PALETTE[hashId(id) % PALETTE.length];
}

export function everyRegistryIdHasTint(ids: readonly string[]): boolean {
  return ids.every((id) => moduleTint(id).tile.length > 0);
}

export function moduleChipStyle(id: string): { backgroundColor: string; color: string } {
  const tint = moduleTint(id);
  return { backgroundColor: tint.chip, color: tint.ink };
}
