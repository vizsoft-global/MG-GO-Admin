"use client";

import { useState, useTransition } from "react";
import { ChevronsUpDown, ClipboardPaste, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNotificationDriverSearch } from "./use-notifications";
import { resolveNotificationDriversByEmployeeIds } from "./notifications-actions";

export type NotificationDriverOption = {
  id: string;
  label: string;
  employee_id: string;
  driver_code: string;
  full_name: string;
};

export function NotificationDriverPicker({
  selectedIds,
  selectedOptions,
  onChange,
}: {
  selectedIds: string[];
  selectedOptions: NotificationDriverOption[];
  onChange: (ids: string[], options: NotificationDriverOption[]) => void;
}) {
  const t = useTranslations("pages.notifications");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pending, startTransition] = useTransition();
  const { data: searchResults = [], isFetching } = useNotificationDriverSearch(query);

  const optionMap = new Map<string, NotificationDriverOption>();
  for (const o of selectedOptions) optionMap.set(o.id, o);
  for (const o of searchResults) optionMap.set(o.id, o);

  const toggle = (driver: NotificationDriverOption, checked: boolean) => {
    if (checked) {
      const nextIds = [...new Set([...selectedIds, driver.id])];
      const nextOptions = [...selectedOptions.filter((o) => o.id !== driver.id), driver];
      onChange(nextIds, nextOptions);
    } else {
      onChange(
        selectedIds.filter((id) => id !== driver.id),
        selectedOptions.filter((o) => o.id !== driver.id),
      );
    }
  };

  const handlePaste = () => {
    const ids = pasteText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        const resolved = await resolveNotificationDriversByEmployeeIds(ids);
        const ok = resolved.filter((r) => r.driver_id && !r.error);
        const addedOptions: NotificationDriverOption[] = ok.map((r) => ({
          id: r.driver_id!,
          label: `${r.driver_code} · ${r.full_name}`,
          employee_id: r.employee_id,
          driver_code: r.driver_code ?? "—",
          full_name: r.full_name ?? "Driver",
        }));
        const nextIds = [...new Set([...selectedIds, ...addedOptions.map((o) => o.id)])];
        const merged = [...selectedOptions];
        for (const o of addedOptions) {
          if (!merged.some((m) => m.id === o.id)) merged.push(o);
        }
        onChange(nextIds, merged);
        const failed = resolved.length - ok.length;
        if (failed > 0) {
          toast.warning(t("pastePartial", { added: ok.length, failed }));
        } else {
          toast.success(t("pasteSuccess", { count: ok.length }));
        }
        setPasteOpen(false);
        setPasteText("");
      } catch {
        toast.error(t("pasteFailed"));
      }
    });
  };

  const selectedPreview = selectedIds
    .map((id) => optionMap.get(id))
    .filter((item): item is NotificationDriverOption => Boolean(item));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            className="flex h-9 flex-1 cursor-pointer items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs"
          >
            <span className="truncate text-muted-foreground">
              {selectedIds.length === 0
                ? t("driverPickerPlaceholder")
                : t("driverPickerSelected", { count: selectedIds.length })}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-[min(420px,92vw)] p-0" align="start">
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 ps-8"
                  placeholder={t("driverSearchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto p-2">
              {isFetching ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("driverSearching")}</p>
              ) : query.trim().length < 1 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("driverSearchHint")}</p>
              ) : searchResults.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("driverSearchEmpty")}</p>
              ) : (
                searchResults.map((driver) => (
                  <label
                    key={driver.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedIds.includes(driver.id)}
                      onCheckedChange={(checked) => toggle(driver, checked === true)}
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
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 cursor-pointer"
          onClick={() => setPasteOpen((v) => !v)}
        >
          <ClipboardPaste className="size-4" />
          {t("pasteEmployeeIds")}
        </Button>
      </div>
      {pasteOpen ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("pasteEmployeeIdsHint")}</p>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={t("pasteEmployeeIdsPlaceholder")}
          />
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer"
            disabled={pending || !pasteText.trim()}
            onClick={handlePaste}
          >
            {t("pasteResolve")}
          </Button>
        </div>
      ) : null}
      {selectedPreview.length > 0 ? (
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {selectedPreview.map((driver) => (
            <span
              key={driver.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs"
            >
              {driver.employee_id} · {driver.full_name}
              <button
                type="button"
                className="cursor-pointer rounded-full p-0.5 hover:bg-muted"
                onClick={() => toggle(driver, false)}
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

export function NotificationGroupPicker({
  groups,
  selectedIds,
  onChange,
}: {
  groups: Array<{ id: string; name: string; member_count: number }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("pages.notifications");
  const [query, setQuery] = useState("");

  const filtered = groups.filter((g) =>
    g.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <Input
        className="h-9"
        placeholder={t("groupSearchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
        {filtered.map((group) => (
          <label key={group.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selectedIds.includes(group.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selectedIds, group.id]
                    : selectedIds.filter((id) => id !== group.id),
                )
              }
            />
            <span>
              {group.name}
              <span className="text-muted-foreground"> ({group.member_count})</span>
            </span>
          </label>
        ))}
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("groupSearchEmpty")}</p>
        ) : null}
      </div>
    </div>
  );
}
