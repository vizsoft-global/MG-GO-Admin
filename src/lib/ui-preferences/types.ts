export type UiPreferenceSort = {
  id: string;
  dir: "asc" | "desc";
};

export type ListColumnPreference = {
  order: string[];
  visible: string[];
  sort: UiPreferenceSort | null;
  /** Last Group by column id, or "none". Optional so older saved prefs still load. */
  groupBy?: string | null;
  /** Last list or grid choice. Optional so older saved prefs still load. */
  viewMode?: "list" | "grid";
};

export type UiPreferenceSource = "user" | "role" | "system";

export type EffectiveUiPreference<T> = {
  effective: T;
  source: UiPreferenceSource;
  roleDefault: T | null;
  userOverride: T | null;
};

export const DRIVERS_LIST_COLUMNS_PREF_KEY = "drivers.list.columns.v2";
