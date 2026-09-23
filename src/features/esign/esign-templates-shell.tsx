"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions } from "@/lib/select-items";
import { upsertEsignTemplate } from "./esign-sender-actions";
import { useEsignCategories, useEsignTemplates } from "./use-esign";

export function EsignTemplatesShell() {
  const t = useTranslations("pages.requests.esign.templates");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useEsignTemplates();
  const { data: categoriesData } = useEsignCategories();
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => categoriesData?.rows.filter((c) => c.is_active) ?? [],
    [categoriesData?.rows],
  );
  const rows = data?.rows ?? [];

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setOpen(true);
      router.replace("/requests/esign/templates");
    }
  }, [searchParams, router]);

  async function submit() {
    if (!nameEn.trim() || !categoryKey) {
      toast.error(t("errors.missingFields"));
      return;
    }
    setSaving(true);
    const result = await upsertEsignTemplate({
      name_en: nameEn.trim(),
      name_ar: nameAr.trim() || null,
      category_key: categoryKey,
    });
    setSaving(false);
    if (!result.ok || !result.id) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("created"));
    setOpen(false);
    setNameEn("");
    setNameAr("");
    setCategoryKey("");
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.templates() });
    router.push(`/requests/esign/templates/${result.id}`);
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <Button size="sm" className="h-9" onClick={() => setOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t("add")}
          </Button>
        }
      />

      <AppListCard className="p-0">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data?.error ? (
          <AppEmptyState title={t("emptyTitle")} description={data.error} />
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "name", label: t("colName") },
              { id: "category", label: t("colCategory") },
              { id: "language", label: t("colLanguage") },
              { id: "fields", label: t("colFields") },
              { id: "status", label: t("colStatus") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/templates/${row.id}`)}
              >
                <TableCell className="text-sm font-medium">
                  {row.name_en}
                  {row.name_ar ? (
                    <div className="text-[11px] text-muted-foreground">{row.name_ar}</div>
                  ) : null}
                  <Link
                    href={`/requests/esign/templates/${row.id}`}
                    className="mt-0.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("viewDetails")}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{row.category_key}</TableCell>
                <TableCell className="text-sm uppercase">{row.default_language}</TableCell>
                <TableCell className="text-sm tabular-nums">{row.field_count}</TableCell>
                <TableCell>
                  <StatusPill variant={row.is_active ? "success" : "neutral"}>
                    {row.is_active ? t("active") : t("inactive")}
                  </StatusPill>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tpl-name-en">
                {t("fieldNameEn")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tpl-name-en"
                className="h-9"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder={t("fieldNameEnPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-name-ar">{t("fieldNameAr")}</Label>
              <Input
                id="tpl-name-ar"
                className="h-9"
                dir="rtl"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                {t("fieldCategory")} <span className="text-destructive">*</span>
              </Label>
              <Select
                items={selectOptions(categories.map((c) => ({ value: c.key, label: c.label_en })))}
                value={categoryKey || undefined}
                onValueChange={(v) => setCategoryKey(v ?? "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("fieldCategoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AppModalFooter title={t("addTitle")} subtitle={t("addSubtitle")}>
            <Button variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              className="h-9"
              disabled={saving || !nameEn.trim() || !categoryKey}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("create")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
