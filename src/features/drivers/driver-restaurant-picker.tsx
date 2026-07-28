"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { RestaurantOption } from "./types";

export function DriverRestaurantPicker({
  restaurants,
  selectedIds,
  onChange,
  disabled,
  variant = "inline",
}: {
  restaurants: RestaurantOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  variant?: "inline" | "compact";
}) {
  const t = useTranslations("pages.driverNew");
  const [query, setQuery] = useState("");

  const published = useMemo(
    () => restaurants.filter((r) => r.status === "published"),
    [restaurants],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, RestaurantOption[]>();
    for (const r of published) {
      const key = r.partner_id ?? "__none__";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [published]);

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...selectedIds, id])]);
    } else {
      onChange(selectedIds.filter((x) => x !== id));
    }
  };

  if (published.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("restaurantsEmpty")}{" "}
        <Link href="/restaurants" className="text-primary hover:underline">
          {t("addRestaurantLink")}
        </Link>
      </p>
    );
  }

  if (variant === "compact") {
    const filtered = published.filter((restaurant) =>
      restaurant.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
    const selectedMap = new Map(published.map((restaurant) => [restaurant.id, restaurant.name]));
    const selectedPreview = selectedIds
      .map((id) => ({ id, label: selectedMap.get(id) }))
      .filter((item): item is { id: string; label: string } => Boolean(item.label));

    return (
      <div className="space-y-2">
        <Popover>
          <PopoverTrigger
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <span className={cn("truncate text-left", selectedIds.length === 0 && "text-muted-foreground")}>
              {selectedIds.length === 0
                ? t("sections.restaurants")
                : `${t("sections.restaurants")} · ${selectedIds.length}`}
            </span>
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent className="w-[var(--anchor-width)] min-w-[300px] p-2" align="start">
            <div className="mb-2 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("placeholders.searchRestaurants")}
                className="h-8 rounded-md"
              />
            </div>
            <div className="max-h-[280px] space-y-1 overflow-y-auto">
              {filtered.map((restaurant) => {
                const checked = selectedIds.includes(restaurant.id);
                return (
                  <button
                    key={restaurant.id}
                    type="button"
                    onClick={() => toggle(restaurant.id, !checked)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
                      checked && "bg-muted/70",
                    )}
                  >
                    <Checkbox checked={checked} tabIndex={-1} />
                    <span className="flex-1 truncate text-left">{restaurant.name}</span>
                    {checked ? <Check className="h-4 w-4 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedPreview.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id, false)}
                className="inline-flex max-w-[220px] cursor-pointer items-center gap-1 rounded-md border border-emerald-500 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-400/50 transition-colors hover:bg-emerald-200/80"
              >
                <span className="truncate">{label}</span>
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}

        {selectedIds.length === 0 ? (
          <p className="text-[10px] leading-snug text-muted-foreground">{t("restaurantsActivationHint")}</p>
        ) : null}
      </div>
    );
  }

  const groupLabel = (key: string) => {
    if (key === "__none__") return t("restaurantsUnassignedGroup");
    const match = published.find((r) => r.partner_id === key);
    return match?.partner_name ?? t("restaurantsUnassignedGroup");
  };

  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([key, items]) => (
        <div key={key} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {groupLabel(key)}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((r) => {
              const checked = selectedIds.includes(r.id);
              return (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/40 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(v) => toggle(r.id, v === true)}
                  />
                  <span className="min-w-0 text-sm font-medium text-foreground">{r.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t("restaurantsActivationHint")}</p>
    </div>
  );
}
