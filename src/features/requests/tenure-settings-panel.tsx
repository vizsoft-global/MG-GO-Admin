"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  deleteLoanTenureOption,
  fetchLoanTenureOptions,
  upsertLoanTenureOption,
} from "./requests-settings-actions";
import type { LoanTenureOptionRow } from "./settings-types";

export function TenureSettingsPanel() {
  const t = useTranslations("pages.requests.settings.tenure");
  const tRoot = useTranslations("pages.requests");
  const [rows, setRows] = useState<LoanTenureOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<LoanTenureOptionRow | null>(null);
  const [months, setMonths] = useState("");
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchLoanTenureOptions();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setRows(result.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleAdd() {
    startTransition(async () => {
      const result = await upsertLoanTenureOption({
        months: Number(months),
        label: label || null,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("added"));
      setMonths("");
      setLabel("");
      await load();
    });
  }

  function toggleActive(row: LoanTenureOptionRow) {
    startTransition(async () => {
      const result = await upsertLoanTenureOption({
        id: row.id,
        months: row.months,
        label: row.label,
        is_active: !row.is_active,
        sort_order: row.sort_order,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      await load();
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteLoanTenureOption(deleteTarget.id);
      setDeleteTarget(null);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.deleteFailed"));
        return;
      }
      toast.success(t("deleted"));
      await load();
    });
  }

  const monthsValue = Number(months);
  const canAdd = Number.isInteger(monthsValue) && monthsValue > 0;

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: tRoot("settings.title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        <p className="text-[11px] text-muted-foreground">{t("hint")}</p>

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("months")}</Label>
            <Input
              className="h-9"
              inputMode="numeric"
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t("label")}</Label>
            <Input
              className="h-9"
              placeholder={canAdd ? t("labelPlaceholder", { months: monthsValue }) : undefined}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="h-9 w-full"
              disabled={isPending || !canAdd}
              onClick={handleAdd}
            >
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              {t("add")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("months")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("label")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("active")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.months}</TableCell>
                  <TableCell>{row.label ?? "—"}</TableCell>
                  <TableCell>
                    <ToggleChip selected={row.is_active} onClick={() => toggleActive(row)}>
                      {row.is_active ? t("activeOn") : t("activeOff")}
                    </ToggleChip>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t("remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AppListCard>

      <SimpleConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { months: deleteTarget?.months ?? 0 })}
        confirmLabel={t("remove")}
        onConfirm={confirmDelete}
      />
    </AppPage>
  );
}
