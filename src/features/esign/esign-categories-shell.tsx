"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ToggleChip } from "@/components/app/toggle-chip";
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
import {
  deleteEsignCategory,
  fetchEsignCategories,
  upsertEsignCategory,
} from "./esign-actions";
import type { EsignCategoryRow } from "./types";

export function EsignCategoriesShell() {
  const t = useTranslations("pages.requests.esign.categories");
  const tCommon = useTranslations("pages.requests.esign");
  const [rows, setRows] = useState<EsignCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<EsignCategoryRow | null>(null);
  const [key, setKey] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchEsignCategories();
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
      const result = await upsertEsignCategory({
        key,
        label_en: labelEn,
        description: description.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("added"));
      setKey("");
      setLabelEn("");
      setDescription("");
      await load();
    });
  }

  function toggleActive(row: EsignCategoryRow) {
    startTransition(async () => {
      const result = await upsertEsignCategory({
        id: row.id,
        key: row.key,
        label_en: row.label_en,
        description: row.description,
        screenshot_restricted: row.screenshot_restricted,
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

  function toggleScreenshot(row: EsignCategoryRow) {
    startTransition(async () => {
      const result = await upsertEsignCategory({
        id: row.id,
        key: row.key,
        label_en: row.label_en,
        description: row.description,
        screenshot_restricted: !row.screenshot_restricted,
        is_active: row.is_active,
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
      const result = await deleteEsignCategory(deleteTarget.id);
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
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("key")}</Label>
            <Input className="h-9" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("name")}</Label>
            <Input className="h-9" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t("description")}</Label>
            <Input
              className="h-9"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-end sm:col-span-4">
            <Button
              type="button"
              className="h-9"
              disabled={isPending || !key.trim() || !labelEn.trim()}
              onClick={handleAdd}
            >
              {isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="me-1 h-3.5 w-3.5" />
              )}
              {t("add")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("name")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("description")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("screenshot")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("active")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm font-medium">{row.label_en}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                    {row.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <ToggleChip
                      selected={row.screenshot_restricted}
                      onClick={() => toggleScreenshot(row)}
                    >
                      {row.screenshot_restricted ? t("screenshotBlocked") : t("screenshotAllowed")}
                    </ToggleChip>
                  </TableCell>
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
                      <Trash2 className="me-1 h-3.5 w-3.5" />
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
