"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

/** Deterministic icon-slot tint so each category reads distinctly (Figma ESign 04). */
const SLOT_TINTS = [
  "bg-teal-600",
  "bg-emerald-600",
  "bg-indigo-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-slate-600",
];

function slotTint(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  return SLOT_TINTS[hash % SLOT_TINTS.length];
}

export function EsignCategoriesShell() {
  const t = useTranslations("pages.requests.esign.categories");
  const tCommon = useTranslations("pages.requests.esign");
  const tSettings = useTranslations("pages.requests.settings");
  const [rows, setRows] = useState<EsignCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<EsignCategoryRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<EsignCategoryRow | null>(null);
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

  function resetForm() {
    setEditing(null);
    setKey("");
    setLabelEn("");
    setDescription("");
    setShowAdd(false);
  }

  function startEdit(row: EsignCategoryRow) {
    setEditing(row);
    setKey(row.key);
    setLabelEn(row.label_en);
    setDescription(row.description ?? "");
    setShowAdd(true);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await upsertEsignCategory({
        id: editing?.id,
        key,
        label_en: labelEn,
        description: description.trim() || null,
        screenshot_restricted: editing?.screenshot_restricted,
        is_active: editing?.is_active,
        sort_order: editing?.sort_order,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(editing ? t("updated") : t("added"));
      resetForm();
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
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: tSettings("title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button
            type="button"
            size="sm"
            className="h-9"
            onClick={() => (showAdd ? resetForm() : setShowAdd(true))}
          >
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t("add")}
          </Button>
        }
      />

      <AppListCard className="space-y-3 p-4">
        {showAdd ? (
        <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("key")}</Label>
            <Input
              className="h-9"
              value={key}
              disabled={Boolean(editing)}
              onChange={(e) => setKey(e.target.value)}
            />
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
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button
              type="button"
              className="h-9"
              disabled={isPending || !key.trim() || !labelEn.trim()}
              onClick={handleSave}
            >
              {isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="me-1 h-3.5 w-3.5" />
              )}
              {editing ? t("saveChanges") : t("add")}
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={resetForm}>
              {t("cancel")}
            </Button>
          </div>
        </div>
        ) : null}

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
                <TableHead className={TABLE_HEAD_CLASS}>{t("colSigned")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("screenshot")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("active")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white ${slotTint(row.key)}`}
                      >
                        {row.label_en.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-sm font-medium">{row.label_en}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                    {row.description ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">{row.signed_count}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.screenshot_restricted}
                        onCheckedChange={() => toggleScreenshot(row)}
                        aria-label={t("screenshot")}
                      />
                      <span className="text-xs text-muted-foreground">
                        {row.screenshot_restricted
                          ? t("screenshotBlocked")
                          : t("screenshotAllowed")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.is_active}
                      onCheckedChange={() => toggleActive(row)}
                      aria-label={t("active")}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => startEdit(row)}
                      >
                        <Pencil className="me-1 h-3.5 w-3.5" />
                        {t("edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        aria-label={t("remove")}
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
