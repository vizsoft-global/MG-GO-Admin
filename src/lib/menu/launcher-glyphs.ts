import type { LauncherTileId } from "@/lib/menu/launcher-modules";

/** Stroke paths from artifact `ICONS` in `Main.dc.html`. One `d` per tile. */
export const LAUNCHER_GLYPH: Record<LauncherTileId, string> = {
  "dashboard-ops": "M4 16a8 8 0 1 1 16 0 M12 16l4-5",
  "live-tracking-v2":
    "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z M10 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  "driver-groups":
    "M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 11l2 2 4-4",
  drivers:
    "M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7.5 M22 21v-1a6 6 0 0 0-4-5.6",
  deliveries: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9",
  employeedesk: "M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5",
  "visit-bookings": "M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4 M9 15l2 2 4-4",
  "dpd-verification": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  earnings: "M3 7h16v12H3z M3 7l12-3v3 M15 13h2",
  notifications: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4",
  attendance: "M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18z M12 7v5l3 2",
  profile: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M14 4v4 M8 10v4 M16 16v4",
  assets: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  "operations-hub": "M4 21V5h10v16 M14 9h6v12 M2 21h20 M8 9h2 M8 13h2 M8 17h2",
  vehicles:
    "M2 6h11v10H2z M13 10h4l3 3v3h-7 M6 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M17 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4z",
  payroll: "M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5",
  assistant:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
};

/**
 * The artifact glyph for a known tile, or `undefined` so the caller can draw the
 * sidebar's own Lucide icon instead. A row the sidebar gained should not need a
 * second drawing pass to appear on the launcher.
 */
export function launcherGlyphPath(id: string): string | undefined {
  return (LAUNCHER_GLYPH as Record<string, string>)[id];
}
