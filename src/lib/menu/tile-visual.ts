import type { LucideIcon } from "lucide-react";
import { MENU_REGISTRY, resolveIcon } from "./menu-registry";
import { moduleTint } from "./module-colors";

/**
 * The one place a module's icon and tint are decided.
 *
 * The sidebar, the Home launcher and the hub pages all render the same module,
 * so they read it from `MENU_REGISTRY` (icon) and `moduleTint` (tint) here
 * instead of each carrying its own drawing. Tile *fills* stay in
 * `LAUNCHER_TILE_HEX`; this helper only aligns the glyph and the accent.
 */
export type LauncherTileVisual = {
  id: string;
  label: string;
  icon: LucideIcon;
  tint: string;
  iconName: string;
};

export function launcherTileVisual(id: string): LauncherTileVisual {
  const item = MENU_REGISTRY.find((row) => row.id === id);
  const iconName = item?.defaultIcon ?? "LayoutGrid";
  return {
    id,
    label: item?.defaultLabel ?? id,
    icon: resolveIcon(iconName),
    tint: moduleTint(id).tile,
    iconName,
  };
}
