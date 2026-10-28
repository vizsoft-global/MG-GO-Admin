"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export type TableFilterChip = {
  id: string;
  label: string;
};

export function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: TableFilterChip[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  const t = useTranslations("common.tableToolbar");
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip.id)}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 text-xs text-foreground"
        >
          <span>{chip.label}</span>
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="cursor-pointer text-xs font-medium text-primary"
      >
        {t("clearAll")}
      </button>
    </div>
  );
}
