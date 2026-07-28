"use client";

import { SearchSelect } from "@/components/ui/search-select";

type SearchableSelectItem = {
  value: string;
  label: string;
};

export function SearchableSelect({
  value,
  onValueChange,
  items,
  placeholder,
  searchPlaceholder = "Search...",
  recentsKey = "driver-form-searchable-select",
  disabled,
  invalid,
}: {
  value: string;
  onValueChange: (next: string) => void;
  items: SearchableSelectItem[];
  placeholder: string;
  searchPlaceholder?: string;
  recentsKey?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <SearchSelect
      value={value || null}
      onChange={(next) => onValueChange(next ?? "")}
      items={items}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      recentsKey={recentsKey}
      className={invalid ? "border-destructive/70" : undefined}
    />
  );
}

