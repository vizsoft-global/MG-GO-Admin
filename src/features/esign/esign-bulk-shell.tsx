"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, useRouter } from "@/i18n/navigation";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { BATCH_CAP } from "./render/esign-batch-cap";
import { parseEsignBulkRows, type EsignBulkDraftRow } from "./esign-bulk-parse";
import {
  createEsignBatch,
  processEsignBatchChunk,
  resolveEsignEmployees,
} from "./esign-sender-actions";
import { useEsignTemplate, useEsignTemplates } from "./use-esign";
import type { EsignLocale, EsignResolveRow } from "./types";

function statusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ok") return "success";
  if (status === "blocked" || status === "archived" || status === "unknown_id") return "danger";
  return "warning";
}

export function EsignBulkShell() {
  const t = useTranslations("pages.requests.esign.bulk");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const { data: templatesData } = useEsignTemplates();
  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter((row) => row.is_active),
    [templatesData?.rows],
  );
  const [templateId, setTemplateId] = useState<string | null>(null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;
  const [locale, setLocale] = useState<EsignLocale>("en");
  const [dueAt, setDueAt] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [drafts, setDrafts] = useState<EsignBulkDraftRow[]>([]);
  const [resolved, setResolved] = useState<EsignResolveRow[]>([]);
  const [busy, setBusy] = useState(false);

  const templateItems = useMemo(
    () =>
      templates.map((row) => ({
        value: row.id,
        label: row.name_en,
        hint: row.category_key,
        keywords: [row.name_en, row.category_key, row.id],
      })),
    [templates],
  );

  function downloadTemplate() {
    const headers = ["Employee ID", "Description", ...(template?.fields.map((f) => f.field_key) ?? [])];
    const csv = `${headers.join(",")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "esign-bulk-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File | undefined) {
    if (!file || !template) return;
    setFileName(file.name);
    const sheet = await parseSpreadsheetFile(file);
    const parsed = parseEsignBulkRows(
      sheet.headers,
      sheet.rows,
      template.fields.map((f) => f.field_key),
    );
    if (parsed.error) {
      toast.error(t(`errors.${parsed.error}`));
      return;
    }
    setDrafts(parsed.rows);
    setBusy(true);
    const result = await resolveEsignEmployees(parsed.rows.map((r) => r.employee_id));
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setResolved(result.rows);
  }

  const okRows = resolved.filter((r) => r.ok);
  const preview = drafts.map((draft, i) => ({
    draft,
    resolve: resolved[i],
  }));

  async function confirm() {
    if (!templateId || !template) return;
    const usable = preview.filter((p) => p.resolve?.ok && p.resolve.driver_id);
    if (usable.length === 0) {
      toast.error(t("errors.noOkRows"));
      return;
    }
    setBusy(true);
    const created = await createEsignBatch({
      template_id: templateId,
      title: title.trim() || template.name_en,
      language: locale,
      due_at: dueAt || null,
      source_filename: fileName || null,
      rows: usable.map((p) => ({
        driver_id: p.resolve!.driver_id,
        employee_id: p.draft.employee_id,
        description: p.draft.description,
        field_values: p.draft.field_values,
      })),
    });
    if (!created.ok || !created.id) {
      setBusy(false);
      toast.error(created.error ?? t("errors.createFailed"));
      return;
    }
    let remaining = usable.length;
    while (remaining > 0) {
      const chunk = await processEsignBatchChunk(created.id);
      if (!chunk.ok) {
        toast.error(chunk.error ?? t("errors.processFailed"));
        break;
      }
      remaining = chunk.remaining;
      if (chunk.processed === 0) break;
    }
    setBusy(false);
    toast.success(t("queued", { code: created.batch_code ?? "" }));
    router.push(`/requests/esign/batches/${created.id}`);
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle", { cap: BATCH_CAP })}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/esign" />}>
            {t("back")}
          </Button>
        }
      />

      <AppListCard className="space-y-3 p-4">
        <div className="grid gap-2 lg:grid-cols-4">
          <div className="space-y-1 lg:col-span-2">
            <Label>
              {t("fieldTemplate")} <span className="text-destructive">*</span>
            </Label>
            <SearchSelect
              items={templateItems}
              value={templateId}
              onChange={(id) => {
                setTemplateId(id);
                setDrafts([]);
                setResolved([]);
              }}
              placeholder={t("fieldTemplatePlaceholder")}
              searchPlaceholder={t("fieldTemplateSearch")}
              recentsKey="esign-bulk-template"
              className="w-full"
            />
          </div>
          <div className="space-y-1">
            <Label>{t("fieldLocale")}</Label>
            <div className="flex gap-1">
              <ToggleChip selected={locale === "en"} onClick={() => setLocale("en")}>
                EN
              </ToggleChip>
              <ToggleChip selected={locale === "ar"} onClick={() => setLocale("ar")}>
                AR
              </ToggleChip>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("fieldDue")}</Label>
            <Input
              type="date"
              className="h-9"
              min={kuwaitTodayYmd()}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>{t("fieldTitle")}</Label>
          <Input
            className="h-9"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={template?.name_en ?? ""}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={!template}
            onClick={() => downloadTemplate()}
          >
            <Download className="me-1.5 h-3.5 w-3.5" />
            {t("downloadTemplate")}
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium">
            <Upload className="h-3.5 w-3.5" />
            {t("upload")}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={!template || busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("employeeOnlyHint")}</p>
      </AppListCard>

      <AppListCard className="p-0">
        {busy && drafts.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : preview.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "emp", label: t("colEmployee") },
              { id: "name", label: t("colName") },
              { id: "company", label: t("colCompany") },
              { id: "status", label: t("colStatus") },
            ]}
          >
            {preview.map(({ draft, resolve }) => (
              <AppDataTableRow key={draft.row_index}>
                <TableCell className="font-mono text-xs">{draft.employee_id || "—"}</TableCell>
                <TableCell className="text-sm">{resolve?.snapshot?.employee_name ?? "—"}</TableCell>
                <TableCell className="text-sm">{resolve?.snapshot?.company_name ?? "—"}</TableCell>
                <TableCell>
                  <StatusPill variant={statusVariant(resolve?.status ?? "invalid")}>
                    {t(`status.${resolve?.status ?? "invalid"}`)}
                  </StatusPill>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {t("readyCount", { ok: okRows.length, total: preview.length })}
        </p>
        <Button className="h-9" disabled={busy || okRows.length === 0} onClick={() => void confirm()}>
          {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("confirm")}
        </Button>
      </div>
    </AppPage>
  );
}
