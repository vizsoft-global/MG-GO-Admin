export type UiPreferenceSort = {
  id: string;
  dir: "asc" | "desc";
};

export type ListColumnPreference = {
  order: string[];
  visible: string[];
  sort: UiPreferenceSort | null;
};

export type UiPreferenceSource = "user" | "role" | "system";

export type EffectiveUiPreference<T> = {
  effective: T;
  source: UiPreferenceSource;
  roleDefault: T | null;
  userOverride: T | null;
};

export const DRIVERS_LIST_COLUMNS_PREF_KEY = "drivers.list.columns";
