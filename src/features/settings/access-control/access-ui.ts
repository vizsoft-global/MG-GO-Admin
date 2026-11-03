import type { AppAccessLevel } from "@/lib/auth/app-access";

/**
 * Tokens read off Figma `7102:17660` — "DPD - Roles & Permissions (v2)".
 * Every surface on `/settings/roles` uses the warm-sand line, navy ink and the
 * rust brand button; nothing here is a new colour the theme does not already own.
 */
export const ACCESS_INK = "#27273f";
export const ACCESS_MUTED = "#5e5e72";
export const ACCESS_FAINT = "#8c8798";
export const ACCESS_RUST = "#a73c24";
export const ACCESS_LINE = "#e4ddd9";
export const ACCESS_TILE_BG = "#d9d2cf";
export const ACCESS_CHIP_BG = "#f8f5f3";
export const ACCESS_SELECTED_BG = "#fbeee9";

/** Card shell shared by the staff list, the summary pane and the editor. */
export const ACCESS_CARD = "rounded-xl border border-[#e4ddd9] bg-white";

export const ACCESS_BTN_PRIMARY =
  "inline-flex h-[38px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#a73c24] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#8f331f] active:bg-[#7a2b1a] disabled:cursor-not-allowed disabled:opacity-50";

export const ACCESS_BTN_SECONDARY =
  "inline-flex h-[38px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#e4ddd9] bg-white px-4 text-sm font-semibold text-[#27273f] transition-colors duration-150 hover:bg-[#faf8f7] disabled:cursor-not-allowed disabled:opacity-50";

/** Small square mark that opens every KPI card in the frame. */
export const ACCESS_KPI_DOT = "size-2 shrink-0 rounded-[2px] bg-[#27273f]";

type PillTone = { bg: string; fg: string };

/**
 * `Status Badge` (7087:17427) tones, reused for the access-level pill:
 * Manager = Plum, User = Green, Viewer = Blue, No access = Grey.
 */
export const ACCESS_LEVEL_PILL: Record<AppAccessLevel, PillTone> = {
  manager: { bg: "#f1e6ec", fg: "#7a3b5c" },
  user: { bg: "#e4eeea", fg: "#2f5d50" },
  viewer: { bg: "#e5eaf2", fg: "#3d5a80" },
  none: { bg: "#eeebef", fg: "#6e6a7c" },
};

export const ACCESS_LEVEL_KEY: Record<AppAccessLevel, string> = {
  none: "levelNone",
  viewer: "levelViewer",
  user: "levelUser",
  manager: "levelManager",
};

/**
 * Avatar fills from the staff rows in the frame. The frame picks a different
 * hue per person, so a stable hash keeps the same person the same colour on
 * every render without storing anything.
 */
const AVATAR_TINTS = [
  "#3e3e6b",
  "#a73c24",
  "#6d7f3f",
  "#7c6a9c",
  "#a1704b",
  "#8a3f6b",
  "#3d7070",
  "#4a5768",
  "#b0873a",
  "#5d6275",
] as const;

export function accessAvatarTint(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export function accessInitials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** `9 of 24 apps · 18 sub-views` — the third line of a staff row. */
export function accessRowSummary(apps: number, appsTotal: number, subViews: number): string {
  return `${apps} of ${appsTotal} apps · ${subViews} sub-views`;
}
