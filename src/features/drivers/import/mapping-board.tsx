"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DRIVER_IMPORT_FIELDS, type DriverImportTargetField } from "../types";

const NONE = "__none__";

export function DriverMappingBoard({
  headers,
  sampleRow,
  mapping,
  onMappingChange,
}: {
  headers: string[];
  sampleRow: string[];
  mapping: Partial<Record<DriverImportTargetField, string>>;
  onMappingChange: (next: Partial<Record<DriverImportTargetField, string>>) => void;
}) {
  const t = useTranslations("pages.drivers.import");

  const headerItems = useMemo(
    () => [
      { value: NONE, label: t("unmap") },
      ...headers.map((h) => ({ value: h, label: h })),
    ],
    [headers, t],
  );

  const sampleByHeader = useMemo(() => {
    const m = new Map<string, string>();
    headers.forEach((h, i) => m.set(h, sampleRow[i] ?? ""));
    return m;
  }, [headers, sampleRow]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sourceColumns")}
        </p>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {headers.map((h) => (
            <li key={h} className="flex justify-between gap-2 rounded-md bg-background px-2 py-1">
              <span className="font-medium">{h}</span>
              <span className="truncate text-muted-foreground">
                {sampleByHeader.get(h) || "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("targetFields")}
        </p>
        {DRIVER_IMPORT_FIELDS.map((field) => (
          <div key={field} className="space-y-1">
            <Label className="text-xs">{t(`fields.${field}`)}</Label>
            <Select
              items={headerItems}
              value={mapping[field] ?? NONE}
              onValueChange={(v) => {
                const next = { ...mapping };
                if (!v || v === NONE) delete next[field];
                else next[field] = v;
                onMappingChange(next);
              }}
            >
              <SelectTrigger className="h-8 w-full cursor-pointer rounded-lg text-sm">
                <SelectValue placeholder={t("selectColumn")} />
              </SelectTrigger>
              <SelectContent>
                {headerItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} label={item.label}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
