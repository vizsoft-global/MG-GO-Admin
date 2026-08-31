"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  Building2,
  Clock,
  Hash,
  IdCard,
  KeyRound,
  Link2,
  ListChecks,
  MapPin,
  Package,
  Phone,
  Shield,
  Store,
  User,
  Users,
} from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DRIVER_EXPORT_COLUMNS,
  DRIVER_EXPORT_PINNED_IDS,
  buildDriversExportAoa,
  customExportColumnId,
  downloadDriversCsv,
  resolveExportColumnIds,
  type DriverExportColumnId,
  type DriverExportCustomField,
} from "./export-drivers";
import type { DriverListRow } from "./types";

const COLUMN_ICONS = {
  driver_code: Hash,
  employee_id: IdCard,
  full_name: User,
  phone: Phone,
  partner: Building2,
  zone: MapPin,
  restaurants: Store,
  rider_category: Users,
  client_id: Briefcase,
  client_name: Building2,
  account_status: Shield,
  on_duty: Clock,
  today_deliveries: Package,
  workflow_status: ListChecks,
  linked: Link2,
} as const;

function defaultSelected(customFields: readonly DriverExportCustomField[]): string[] {
  return [
    ...DRIVER_EXPORT_COLUMNS.map((column) => column.id),
    ...customFields.map((field) => customExportColumnId(field.key)),
  ];
}

export function DriversExportDialog({
  open,
  onOpenChange,
  rows,
  customFields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: DriverListRow[];
  customFields: DriverExportCustomField[];
}) {
  const t = useTranslations("pages.drivers.exportDialog");
  const [selected, setSelected] = useState<string[]>(() => defaultSelected(customFields));
  const [includeAppCode, setIncludeAppCode] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(defaultSelected(customFields));
    setIncludeAppCode(false);
  }, [open, customFields]);

  const selectedIds = useMemo(
    () => new Set(resolveExportColumnIds(selected, customFields)),
    [selected, customFields],
  );
  const columnCount = selectedIds.size + (includeAppCode ? 1 : 0);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(resolveExportColumnIds(current, customFields));
      if (next.has(id) && !DRIVER_EXPORT_PINNED_IDS.includes(id as DriverExportColumnId)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };

  const handleExport = () => {
    downloadDriversCsv(
      buildDriversExportAoa(rows, Array.from(selectedIds), {
        includeAppCode,
        customFields,
      }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-[min(720px,96vw)]"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5 pt-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("columnsTitle")}
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 cursor-pointer rounded-md px-2 text-xs"
                onClick={() => setSelected(defaultSelected(customFields))}
              >
                {t("selectAll")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 cursor-pointer rounded-md px-2 text-xs"
                onClick={() => setSelected([...DRIVER_EXPORT_PINNED_IDS])}
              >
                {t("identityOnly")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DRIVER_EXPORT_COLUMNS.map((column) => {
              const isOn = selectedIds.has(column.id);
              return (
                <ToggleChip
                  key={column.id}
                  selected={isOn}
                  disabled={column.pinned}
                  icon={isOn ? undefined : COLUMN_ICONS[column.id]}
                  onClick={() => toggle(column.id)}
                >
                  {t(`columns.${column.id}`)}
                </ToggleChip>
              );
            })}
            {customFields.map((field) => {
              const id = customExportColumnId(field.key);
              return (
                <ToggleChip
                  key={id}
                  selected={selectedIds.has(id)}
                  onClick={() => toggle(id)}
                >
                  {field.label}
                </ToggleChip>
              );
            })}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="include-app-code" className="inline-flex items-center gap-1.5 text-sm">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("includeAppCode")}
              </Label>
              <p className="text-[10px] text-muted-foreground">{t("includeAppCodeHint")}</p>
            </div>
            <Switch
              id="include-app-code"
              size="sm"
              checked={includeAppCode}
              onCheckedChange={setIncludeAppCode}
            />
          </div>
        </div>
        <AppModalFooter
          title={t("title")}
          subtitle={t("subtitle", {
            rows: rows.length,
            columns: columnCount,
          })}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            disabled={rows.length === 0}
            onClick={handleExport}
          >
            {t("download")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
