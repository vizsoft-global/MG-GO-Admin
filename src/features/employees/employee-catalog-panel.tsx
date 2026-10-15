"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { catalogKeyFromLabel, CATALOG_KEY_RE, type EmployeeCatalogKind, type EmployeeCatalogRow } from "./employee-catalogs";
import { upsertEmployeeCatalog } from "./employee-catalogs-actions";
import { toast } from "sonner";

export function EmployeeCatalogPanel({
  kind,
  rows,
  title,
  subtitle,
}: {
  kind: EmployeeCatalogKind;
  rows: EmployeeCatalogRow[];
  title: string;
  subtitle: string;
}) {
  const t = useTranslations("pages.settings.employeeCatalogs");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EmployeeCatalogRow | null>(null);

  const reset = () => {
    setKey("");
    setLabelEn("");
    setLabelAr("");
    setEditing(null);
  };

  const startAdd = () => {
    reset();
    setOpen(true);
  };

  const startEdit = (row: EmployeeCatalogRow) => {
    setEditing(row);
    setKey(row.key);
    setLabelEn(row.label_en);
    setLabelAr(row.label_ar);
    setOpen(true);
  };

  const save = async () => {
    const resolvedKey = editing?.key || catalogKeyFromLabel(labelEn) || key;
    if (!CATALOG_KEY_RE.test(resolvedKey) || !labelEn.trim()) {
      toast.error(t("invalid"));
      return;
    }
    setSaving(true);
    const result = await upsertEmployeeCatalog({
      kind,
      key: resolvedKey,
      labelEn,
      labelAr,
      isActive: editing?.is_active ?? true,
      sortOrder: editing?.sort_order,
      color: editing?.color,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    reset();
    router.refresh();
  };

  return (
    <AppPage>
      <AppPageHeader
        title={title}
        description={subtitle}
        actions={
          <Button type="button" className="h-9" onClick={startAdd}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        }
      />
      <AppListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colKey")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colSystem")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                className="cursor-pointer"
                onClick={() => startEdit(row)}
              >
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell className="text-sm">{row.label_en}</TableCell>
                <TableCell className="text-sm">{row.label_ar || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.is_system ? t("system") : t("custom")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AppListCard>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(520px,96vw)] overflow-visible"
        >
          <div className="space-y-3 px-5 pt-4 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="catalog-en">{t("colLabelEn")}</Label>
              <Input
                id="catalog-en"
                className="h-9"
                value={labelEn}
                onChange={(event) => {
                  setLabelEn(event.target.value);
                  if (!editing) setKey(catalogKeyFromLabel(event.target.value));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-ar">{t("colLabelAr")}</Label>
              <Input
                id="catalog-ar"
                className="h-9"
                value={labelAr}
                onChange={(event) => setLabelAr(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-key">{t("colKey")}</Label>
              <Input
                id="catalog-key"
                className="h-9 font-mono"
                value={key}
                disabled={Boolean(editing)}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
              />
            </div>
          </div>
          <AppModalFooter title={editing ? t("edit") : t("add")} subtitle={title}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" className="h-9" disabled={saving} onClick={() => void save()}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
