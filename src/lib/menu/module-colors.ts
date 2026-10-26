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
 * Home launcher chrome from Claude artifact `Main.dc.html` (A · Odoo Classic).
 * Tiles take `launcherTileHex(id)`; `moduleTint(id)` still paints the sidebar
 * chips and the Roles & Permissions app cards.
 */
export const LAUNCHER_BRAND_TINT: ModuleTint = PALETTE[0];

export const LAUNCHER_BRAND = {
  canvas: "#2b2b48",
  topBar: "#383855",
  search: "rgba(0,0,0,0.25)",
  searchBorder: "rgba(255,255,255,0.2)",
  searchHint: "rgba(255,255,255,0.27)",
  logoChip: "#d9d2cf",
  badge: "#e23d3d",
  badgeBorder: "#2b2b48",
  muted: "#999999",
  text: "#ffffff",
  subText: "#9898a7",
  tile: "#d9d2cf",
  tileLabel: "#ffffff",
  footer: "rgba(255,255,255,0.5)",
  footerBar: "#353555",
  meta: "#d9d2cf",
  accent: "#d25335",
  mark: "#e64b26",
} as const;

/**
 * Home Launcher tile fills from the same artifact `LIST`. Unused extras keep
 * the previous Figma hex. The launcher does not use `moduleTint`.
 */
export const LAUNCHER_TILE_HEX: Record<string, string> = {
  "dashboard-ops": "#4b4b80",
  dashboard: "#4b4b80",
  performance: "#3a3a5e",
  "live-tracking-v2": "#4a6f92",
  "live-tracking": "#4a6f92",
  "operations-hub": "#4a6f92",
  "visit-bookings": "#44738a",
  "employeedesk-visits": "#44738a",
  notifications: "#3f7a73",
  attendance: "#5a5a92",
  "driver-groups": "#6e4f8a",
  "dpd-verification": "#85547d",
  assistant: "#732b1a",
  "app-releases": "#7A4DA8",
  drivers: "#b5643f",
  "operations-dashboard": "#4a5768",
  "client-portal": "#6e4f8a",
  deliveries: "#557f6a",
  employeedesk: "#a73d24",
  requests: "#a73d24",
  "document-expiry": "#A84D4D",
  earnings: "#a8843a",
  payroll: "#b0873a",
  restaurants: "#B25C70",
  roles: "#3D7070",
  profile: "#5d6275",
  "driver-app": "#4761A3",
  vehicles: "#6f7a4a",
  assets: "#8a7254",
  compliance: "#6a7a52",
  "wrong-actions": "#84545a",
  "order-exceptions": "#7f5b7a",
  "payroll-hub": "#b0873a",
  "earnings-calculation": "#a8843a",
  "group-settings": "#5d6275",
  "group-system": "#4a5768",
};

/** Launcher tile fill for a module id; falls back to the brand teal. */
export function launcherTileHex(id: string): string {
  return LAUNCHER_TILE_HEX[id] ?? LAUNCHER_BRAND_TINT.tile;
}

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
