"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSearchDriversForGroup } from "./use-driver-groups";
import type { DriverGroupMemberOption } from "./types";

export function DriverGroupMemberPicker({
  selectedIds,
  onChange,
  disabled,
  initialOptions = [],
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  initialOptions?: DriverGroupMemberOption[];
}) {
  const t = useTranslations("pages.driverGroups");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { data: searchResults = [], isFetching } = useSearchDriversForGroup(query);

  const optionMap = useMemo(() => {
    const map = new Map<string, DriverGroupMemberOption>();
    for (const o of initialOptions) map.set(o.id, o);
    for (const o of searchResults) map.set(o.id, o);
    return map;
  }, [initialOptions, searchResults]);

  const displayOptions = useMemo(() => {
    if (query.trim().length >= 1) return searchResults;
    return initialOptions;
  }, [query, searchResults, initialOptions]);

  const toggle = (id: string, checked: boolean) => {
    if (checked) onChange([...new Set([...selectedIds, id])]);
    else onChange(selectedIds.filter((x) => x !== id));
  };

  const selectedPreview = selectedIds
    .map((id) => optionMap.get(id))
    .filter((item): item is DriverGroupMemberOption => Boolean(item));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="truncate text-muted-foreground">
            {selectedIds.length === 0
              ? t("memberPickerPlaceholder")
              : t("memberPickerSelected", { count: selectedIds.length })}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-[min(420px,92vw)] p-0" align="start">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 ps-8"
                placeholder={t("memberSearchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-2">
            {isFetching ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t("searching")}</p>
            ) : displayOptions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t("memberSearchEmpty")}</p>
            ) : (
              displayOptions.map((driver) => (
                <label
                  key={driver.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(driver.id)}
                    onCheckedChange={(checked) => toggle(driver.id, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {driver.full_name}
                    <span className="text-muted-foreground">
                      {" "}
                      · {driver.employee_id} · {driver.driver_code}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedPreview.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedPreview.map((driver) => (
            <span
              key={driver.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs"
            >
              {driver.employee_id} · {driver.full_name}
              <button
                type="button"
                className="cursor-pointer rounded-full p-0.5 hover:bg-muted"
                onClick={() => toggle(driver.id, false)}
                aria-label={t("removeMember")}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DriverGroupIconBadge({ iconKey }: { iconKey: string | null }) {
  return (
    <span className="inline-flex size-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
      {(iconKey ?? "users").slice(0, 2).toUpperCase()}
    </span>
  );
}
