"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileClock, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { BATCH_CAP } from "./render/esign-batch-cap";
import { parseEsignBulkRows, type EsignBulkDraftRow } from "./esign-bulk-parse";
import {
  createEsignBatch,
  deleteEsignDraft,
  processEsignBatchChunk,
  resolveEsignEmployees,
  saveEsignDraft,
} from "./esign-sender-actions";
import {
  alignPenaltyCategoryKey,
  effectiveOutgoingCategoryKey,
} from "./outgoing-hub-categories";
import { PENALTY_SUBCATEGORY_KEYS } from "./esign-penalty-subcategories";
import {
  useEsignCategories,
  useEsignDraft,
  useEsignTemplate,
  useEsignTemplates,
} from "./use-esign";
import type { EsignLocale, EsignResolveRow } from "./types";

const BATCH_LANGUAGE: EsignLocale = "en";

const FALLBACK_PENALTIES = [
  { key: "late_attendance", label: "Late attendance" },
  { key: "unauthorised_absence", label: "Unauthorised absence" },
  { key: "written_warning", label: "Written warning" },
  { key: "damage_to_property", label: "Damage to company property" },
  { key: "penalty_others", label: "Others" },
] as const;

function isPenaltySubcategoryKey(key: string): boolean {
  return (PENALTY_SUBCATEGORY_KEYS as readonly string[]).includes(key);
}

function bulkTemplateSelectItem(row: {
  id: string;
  name_en: string;
  category_key: string;
}) {
  return {
    value: row.id,
    label: row.name_en,
    hint: row.category_key,
    keywords: [row.name_en, row.category_key, row.id],
  };
}

function statusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ok") return "success";
  if (status === "blocked" || status === "archived" || status === "unknown_id") return "danger";
  return "warning";
}

export function EsignBulkShell({
  /**
   * A template chosen upstream — the V2 builder's "Import a sheet" passes the
   * template the author is looking at, so the wizard opens on that document's
   * example sheet rather than on an empty picker. Prop rather than a
   * `useSearchParams` hook for the same reason the send shell takes it that way.
   */
  initialTemplateId,
  /**
   * `?draft=<id>` — the drafts list resumes a saved bulk send by navigating back
   * here with the draft id. The draft carries the already-mapped rows, so the
   * operator lands on the preview they left rather than on the raw sheet, which
   * is the mapping work the draft exists to protect.
   */
  initialDraftId,
}: {
  initialTemplateId?: string;
  initialDraftId?: string;
}) {
  const t = useTranslations("pages.requests.esign.bulk");
  const tHub = useTranslations("pages.requests.esign.hub");
  const tRcm = useTranslations("pages.rcmV2");
  const router = useRouter();
  const { data: templatesData } = useEsignTemplates();
  const { data: categoriesData } = useEsignCategories();
  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter((row) => row.is_active),
    [templatesData?.rows],
  );
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
  const [penaltySubKey, setPenaltySubKey] = useState<string | null>(null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;
  const [dueAt, setDueAt] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [drafts, setDrafts] = useState<EsignBulkDraftRow[]>([]);
  const [resolved, setResolved] = useState<EsignResolveRow[]>([]);
  const [busy, setBusy] = useState(false);

  /** The draft being edited, so the second save updates rather than duplicates. */
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const draftQuery = useEsignDraft(initialDraftId ?? "");
  /** One-shot — a refetch must never clobber the rows the operator has corrected. */
  const draftAppliedRef = useRef(false);

  const penaltyChildren = useMemo(() => {
    const live = (categoriesData?.rows ?? []).filter(
      (row) => row.is_active && row.parent_key === "penalty",
    );
    if (live.length > 0) {
      return live.map((row) => ({
        key: row.key,
        label: row.label_en,
      }));
    }
    return FALLBACK_PENALTIES.map((row) => ({ key: row.key, label: row.label }));
  }, [categoriesData?.rows]);

  const visiblePenaltyChildren = useMemo(
    () =>
      penaltyChildren.filter((child) =>
        templates.some(
          (row) =>
            effectiveOutgoingCategoryKey(row) === alignPenaltyCategoryKey(child.key),
        ),
      ),
    [penaltyChildren, templates],
  );

  const nonPenaltyTemplateItems = useMemo(
    () =>
      templates
        .filter((row) => !isPenaltySubcategoryKey(effectiveOutgoingCategoryKey(row)))
        .map(bulkTemplateSelectItem),
    [templates],
  );

  const penaltyTemplateItems = useMemo(() => {
    if (!penaltySubKey) return [];
    const aligned = alignPenaltyCategoryKey(penaltySubKey);
    return templates
      .filter((row) => effectiveOutgoingCategoryKey(row) === aligned)
      .map(bulkTemplateSelectItem);
  }, [penaltySubKey, templates]);

  useEffect(() => {
    if (!initialTemplateId || templates.length === 0) return;
    const row = templates.find((tpl) => tpl.id === initialTemplateId);
    if (!row) return;
    const hubKey = effectiveOutgoingCategoryKey(row);
    if (isPenaltySubcategoryKey(hubKey)) {
      setPenaltySubKey(alignPenaltyCategoryKey(hubKey));
    }
  }, [initialTemplateId, templates]);

  function resetTemplateSelection() {
    setTemplateId(null);
    setDrafts([]);
    setResolved([]);
  }

  function selectTemplate(id: string | null) {
    setTemplateId(id);
    setDrafts([]);
    setResolved([]);
    if (!id) return;
    const row = templates.find((tpl) => tpl.id === id);
    if (!row) return;
    const hubKey = effectiveOutgoingCategoryKey(row);
    if (isPenaltySubcategoryKey(hubKey)) {
      setPenaltySubKey(alignPenaltyCategoryKey(hubKey));
    } else {
      setPenaltySubKey(null);
    }
  }

  /**
   * Rehydrate a resumed draft.
   *
   * The rows are re-resolved rather than trusted from the payload because the
   * preview's whole job is to state each rider's *current* status: a draft saved
   * three days ago could hold a rider who has since been archived or blocked, and
   * a stored `ok` would print a green row that the send would then refuse.
   */
  useEffect(() => {
    const draft = draftQuery.data?.draft;
    if (!draft || draftAppliedRef.current) return;
    draftAppliedRef.current = true;
    if (draft.template_id) setTemplateId(draft.template_id);
    if (draft.title) setTitle(draft.title);
    if (draft.due_at) setDueAt(draft.due_at.slice(0, 10));
    if (draft.source_filename) setFileName(draft.source_filename);
    const restored: EsignBulkDraftRow[] = draft.rows.map((row, index) => ({
      row_index: index,
      employee_id: row.employee_id,
      description: row.description ?? "",
      field_values: row.field_values ?? {},
    }));
    setDrafts(restored);
    if (restored.length === 0) return;
    setBusy(true);
    void resolveEsignEmployees(restored.map((row) => row.employee_id)).then((result) => {
      setBusy(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setResolved(result.rows);
    });
  }, [draftQuery.data?.draft]);

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

  /**
   * Save the mapping as a draft.
   *
   * Every parsed row is stored, including the ones that did not resolve — those
   * are precisely the rows an operator has to come back and correct, and dropping
   * them would mean the resume was missing the work they were mid-way through.
   * The resolution is deliberately not stored either (see the hydrate effect).
   */
  async function saveDraft() {
    if (!templateId) {
      toast.error(t("errors.draftTemplate"));
      return;
    }
    if (drafts.length === 0) {
      toast.error(t("errors.draftEmpty"));
      return;
    }
    setSavingDraft(true);
    const result = await saveEsignDraft({
      id: draftId,
      kind: "bulk",
      template_id: templateId,
      template_version: template?.version ?? null,
      language: BATCH_LANGUAGE,
      title: title.trim() || template?.name_en || null,
      due_at: dueAt || null,
      field_values: {},
      rows: preview.map(({ draft, resolve }) => ({
        employee_id: draft.employee_id,
        driver_id: resolve?.driver_id,
        description: draft.description || undefined,
        field_values: draft.field_values,
      })),
      source_filename: fileName || null,
    });
    setSavingDraft(false);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.draftFailed"));
      return;
    }
    setDraftId(result.id ?? draftId);
    toast.success(t("draftSaved"));
  }

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
      language: BATCH_LANGUAGE,
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
    toast.success(t("sentToast", { count: usable.length }));
    if (draftId) {
      const consumed = await deleteEsignDraft(draftId);
      if (!consumed.ok) toast.error(consumed.error ?? t("errors.draftFailed"));
    }
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
          <div className="space-y-2 lg:col-span-3">
            <div className="space-y-1">
              <Label>
                {t("fieldTemplate")} <span className="text-destructive">*</span>
              </Label>
              <SearchSelect
                items={nonPenaltyTemplateItems}
                value={
                  templateId &&
                  nonPenaltyTemplateItems.some((item) => item.value === templateId)
                    ? templateId
                    : null
                }
                onChange={(id) => {
                  setPenaltySubKey(null);
                  selectTemplate(id);
                }}
                placeholder={t("fieldTemplatePlaceholder")}
                searchPlaceholder={t("fieldTemplateSearch")}
                recentsKey="esign-bulk-template"
                className="w-full"
              />
            </div>
            {visiblePenaltyChildren.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                  {tRcm("penaltyCategory")}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={penaltySubKey ?? ""}
                    onValueChange={(next) => {
                      if (!next) {
                        setPenaltySubKey(null);
                        resetTemplateSelection();
                        return;
                      }
                      setPenaltySubKey(next);
                      resetTemplateSelection();
                    }}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder={tRcm("penaltyCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      {visiblePenaltyChildren.map((child) => (
                        <SelectItem key={child.key} value={child.key}>
                          {child.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SearchSelect
                    items={penaltyTemplateItems}
                    value={
                      templateId &&
                      penaltyTemplateItems.some((item) => item.value === templateId)
                        ? templateId
                        : null
                    }
                    onChange={selectTemplate}
                    placeholder={t("fieldTemplatePlaceholder")}
                    searchPlaceholder={t("fieldTemplateSearch")}
                    recentsKey="esign-bulk-penalty-template"
                    className="w-full"
                    disabled={!penaltySubKey || penaltyTemplateItems.length === 0}
                  />
                </div>
              </div>
            ) : null}
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
        <p className="text-xs text-muted-foreground">{t("employeeOnlyHint")}</p>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
          render={<Link href="/requests/esign/drafts" />}
        >
          <FileClock className="me-1.5 h-3.5 w-3.5" />
          {t("draftsLink")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {t("readyCount", { ok: okRows.length, total: preview.length })}
          </p>
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            disabled={savingDraft || busy || !templateId || drafts.length === 0}
            onClick={() => void saveDraft()}
          >
            {savingDraft ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {draftId ? t("updateDraft") : t("saveDraft")}
          </Button>
          <Button className="h-9" disabled={busy || okRows.length === 0} onClick={() => void confirm()}>
            {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("confirm")}
          </Button>
        </div>
      </div>
    </AppPage>
  );
}
