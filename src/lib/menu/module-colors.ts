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
 * Home launcher: Figma `Launcher/00-App-Launcher` canvas is `#212134`, not the
 * MG teal. Tiles take `launcherTileHex(id)`; `moduleTint(id)` still paints the
 * sidebar chips and the Roles & Permissions app cards.
 */
export const LAUNCHER_BRAND_TINT: ModuleTint = PALETTE[0];

export const LAUNCHER_BRAND = {
  canvas: "#212134",
  topBar: "#28283E",
  search: "#242438",
  searchBorder: "rgba(255,255,255,0.1)",
  searchHint: "#383854",
  logoChip: "#D9D2CF",
  badge: "#F03838",
  muted: "#80808F",
  text: "#F4F4F5",
  subText: "#C4C4CE",
} as const;

/**
 * Home Launcher tile fill per module, taken from Figma
 * `Launcher/00-App-Launcher` (5944:4011). Every tile is one solid accent and
 * carries the module glyph in white — the launcher is the one surface that
 * does not use `moduleTint`, which stays the sidebar-chip palette.
 */
export const LAUNCHER_TILE_HEX: Record<string, string> = {
  "dashboard-ops": "#544D99",
  dashboard: "#544D99",
  performance: "#544D99",
  "live-tracking-v2": "#387A9E",
  "live-tracking": "#387A9E",
  "operations-hub": "#387A9E",
  "visit-bookings": "#38859E",
  "employeedesk-visits": "#38859E",
  notifications: "#388F85",
  attendance: "#6161A3",
  "driver-groups": "#7A5CAD",
  "dpd-verification": "#9E5CAD",
  assistant: "#7A5CAD",
  "app-releases": "#7A4DA8",
  drivers: "#C27047",
  deliveries: "#478F75",
  employeedesk: "#B8474D",
  requests: "#B8474D",
  "document-expiry": "#A84D4D",
  earnings: "#C29947",
  payroll: "#C29947",
  restaurants: "#B25C70",
  roles: "#3D7070",
  profile: "#61708F",
  "driver-app": "#4761A3",
  vehicles: "#8F754D",
  assets: "#8F754D",
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
