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
  deleteComplaintCategory,
  fetchComplaintCategories,
  upsertComplaintCategory,
} from "./requests-settings-actions";
import type { ComplaintCategoryRow } from "./settings-types";

export function CategoriesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.categories");
  const [rows, setRows] = useState<ComplaintCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<ComplaintCategoryRow | null>(null);
  const [key, setKey] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchComplaintCategories();
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
      const result = await upsertComplaintCategory({
        key,
        label_en: labelEn,
        label_ar: labelAr || null,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("added"));
      setKey("");
      setLabelEn("");
      setLabelAr("");
      await load();
    });
  }

  function toggleActive(row: ComplaintCategoryRow) {
    startTransition(async () => {
      const result = await upsertComplaintCategory({
        id: row.id,
        key: row.key,
        label_en: row.label_en,
        label_ar: row.label_ar,
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
      const result = await deleteComplaintCategory(deleteTarget.id);
      setDeleteTarget(null);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.deleteFailed"));
        return;
      }
      toast.success(t("deleted"));
      await load();
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        <p className="text-[11px] text-muted-foreground">{t("emptyHint")}</p>

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("key")}</Label>
            <Input className="h-9" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("labelEn")}</Label>
            <Input className="h-9" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("labelAr")}</Label>
            <Input className="h-9" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="h-9 w-full"
              disabled={isPending || !key.trim() || !labelEn.trim()}
              onClick={handleAdd}
            >
              {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
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
                <TableHead className={TABLE_HEAD_CLASS}>{t("key")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("labelEn")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("labelAr")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("active")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.key}</TableCell>
                  <TableCell>{row.label_en}</TableCell>
                  <TableCell>{row.label_ar ?? "—"}</TableCell>
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
        description={t("deleteDescription", { label: deleteTarget?.label_en ?? "" })}
        confirmLabel={t("remove")}
        onConfirm={confirmDelete}
      />
    </AppPage>
  );
}
