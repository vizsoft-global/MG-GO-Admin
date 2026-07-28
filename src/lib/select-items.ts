import type { ReactNode } from "react";

export type SelectItemOption = {
  value: string;
  label: ReactNode;
};

/** Build `{ value, label }[]` for Base UI Select `items` (shows labels in trigger, not raw IDs). */
export function selectOptionsFrom<T>(
  list: readonly T[],
  getValue: (item: T) => string,
  getLabel: (item: T) => ReactNode,
): SelectItemOption[] {
  return list.map((item) => ({
    value: getValue(item),
    label: getLabel(item),
  }));
}

export function selectOptions(
  items: ReadonlyArray<{ value: string; label: ReactNode }>,
): SelectItemOption[] {
  return items.map((item) => ({ value: item.value, label: item.label }));
}
