/** How long a resolved sidebar menu stays fresh. Epochs in the key bust it sooner. */
export const SIDEBAR_MENU_STALE_MS = 5 * 60 * 1000;

/**
 * Wait before a list search box refetches. Selects and submit buttons are not
 * debounced. Drivers, deliveries, and attendance already used this delay.
 */
export const LIST_SEARCH_DEBOUNCE_MS = 300;

export type SidebarMenuEpochs = {
  /** Permission generation. Stage D supplies this; 0 lets this branch compile alone. */
  accessEpoch?: number;
  /** Menu-config generation. Stage D supplies this; 0 lets this branch compile alone. */
  menuEpoch?: number;
};

export function sidebarMenuQueryKey(
  adminRoleSlug: string,
  isSuperAdmin: boolean,
  epochs: SidebarMenuEpochs = {},
) {
  return [
    "sidebar-menu",
    adminRoleSlug,
    isSuperAdmin,
    epochs.accessEpoch ?? 0,
    epochs.menuEpoch ?? 0,
  ] as const;
}
