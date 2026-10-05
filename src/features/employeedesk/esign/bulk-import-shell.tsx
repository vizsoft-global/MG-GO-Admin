"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  PenLine,
  Send,
  Upload,
  UserRoundSearch,
} from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppListCard } from "@/components/app/app-list-card";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  buildEsignExampleSheet,
  bulkSheetColumns,
  type EsignSheetColumn,
} from "@/features/esign/esign-example-sheet";
import { BATCH_CAP } from "@/features/esign/render/esign-batch-cap";
import { parseEsignBulkRows, type EsignBulkDraftRow } from "@/features/esign/esign-bulk-parse";
import {
  createEsignBatch,
  processEsignBatchChunk,
  resolveEsignEmployees,
} from "@/features/esign/esign-sender-actions";
import { templateFieldLabel } from "@/features/esign/template-source";
import { useEsignTemplate, useEsignTemplates } from "@/features/esign/use-esign";
import type {
  EsignLocale,
  EsignResolveRow,
  EsignResolveStatus,
  EsignTemplateFieldRow,
} from "@/features/esign/types";

type Step = 1 | 2 | 3;

const PAGE_SIZE = 8;

/**
 * Bulk import, as the reference's three steps.
 *
 * The V1 screen at `/requests/esign/bulk` is one long form: pick a template,
 * upload, read a table, press send. That works, and it stays — but it cannot
 * tell an operator *what the sheet is allowed to contain* before they upload,
 * which is the question the reference's step 3 answers with two lists of column
 * names. That answer is derivable from the template's own field rows, so this
 * screen states it rather than describing it in a hint line.
 *
 * Three decisions worth naming:
 *
 * 1. **Provenance comes from the template, and mostly from the employee
 *    block.** "Filled from the system" is the shared employee catalogue (the
 *    same `ESIGN_EMPLOYEE_ROWS` the builder and both renderers read), plus any
 *    field row an author explicitly marked `system`. "You add in the sheet" is
 *    the template's `entry` rows. `fixed` and `signature` rows are in neither
 *    list on purpose: they never become sheet columns, so listing them under
 *    "you add in the sheet" would ask for a value the importer ignores —
 *    `fixed` gets its own small group instead, because "the template already
 *    supplies this" is worth saying. `Employee ID` is always listed even though
 *    it is not a field row, because the server resolves the rider from it and a
 *    sheet cannot omit it.
 * 2. **Rows that need fixing are rendered in place with a `Replace` action.**
 *    The reference is explicit that an unresolvable row is shown rather than
 *    dropped, and that is also the only honest behaviour: a wizard that quietly
 *    sends 22 and reports "24 rows" has told the operator something untrue.
 * 3. **Send options live in step 1, not step 3.** Language, due date and batch
 *    title are decisions about *what is being sent*, and the reference's step 3
 *    is a review of what arrived. Putting three inputs above a review table
 *    would also cost the vertical budget the table needs on a 14" screen.
 *
 * The batch this creates is the same object the V1 sent list already reads —
 * `createEsignBatch` + `processEsignBatchChunk` are shared, so a hand-off from
 * either door lands in one queue and there is no second definition of "sendable".
 */
export function BulkImportShell({ initialTemplateId }: { initialTemplateId?: string }) {
  const t = useTranslations("pages.employeedesk.esign.bulk");
  /**
   * The **page** language for the column chips, which is not the batch's
   * `locale` below. That one decides which language the rendered PDF is written
   * in; this one decides which language the operator is reading the screen in.
   * Conflating them would print Arabic chips on an English page whenever the
   * batch was queued for Arabic.
   */
  const labelLocale = useLocale();
  const router = useRouter();

  const { data: templatesData } = useEsignTemplates();
  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter((row) => row.is_active),
    [templatesData?.rows],
  );

  const [step, setStep] = useState<Step>(1);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;

  const [locale, setLocale] = useState<EsignLocale>("en");
  const [dueAt, setDueAt] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [drafts, setDrafts] = useState<EsignBulkDraftRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [resolved, setResolved] = useState<EsignResolveRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [fixRow, setFixRow] = useState<number | null>(null);

  const templateItems = useMemo(
    () =>
      templates.map((row) => ({
        value: row.id,
        // The label leads with the operator's own words; the category is
        // context, never the trigger text, so a trigger never shows a slug.
        label: row.category_label ? `${row.name_en} · ${row.category_label}` : row.name_en,
        hint: row.category_label ?? undefined,
        keywords: [row.name_en, row.name_ar ?? "", row.category_label ?? "", row.category_key],
      })),
    [templates],
  );

  /**
   * The sheet's columns, split by who supplies them.
   *
   * The split itself lives in `bulkSheetColumns`, beside `buildEsignExampleSheet`
   * which emits a column for every one of these sheet fields, so step 1's chips
   * and the CSV printed under them are derived by the same rule and cannot drift.
   * `sheetFields` keeps the field rows themselves for the review table, which
   * needs the id and the type as well as the label.
   */
  const columns = useMemo(() => {
    const fields: EsignTemplateFieldRow[] = template?.fields ?? [];
    return { ...bulkSheetColumns(fields, labelLocale), sheetFields: fields };
  }, [template?.fields, labelLocale]);

  const needsFixing = useMemo(
    () => resolved.filter((row) => !row.ok).length,
    [resolved],
  );
  const readyCount = useMemo(() => resolved.filter((row) => row.ok).length, [resolved]);

  const pageCount = Math.max(1, Math.ceil(drafts.length / PAGE_SIZE));
  const pageRows = drafts.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function downloadExample() {
    if (!template) return;
    const sheet = buildEsignExampleSheet(template.fields);
    const csv = `\uFEFF${sheet.csv}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.name_en.replace(/[^\w.-]+/g, "-").toLowerCase()}-example.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("exampleDownloaded"));
  }

  async function onFile(file: File | undefined) {
    if (!file || !template) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("errors.tooLarge"));
      return;
    }
    setFileName(file.name);
    setBusy(true);
    let parsed: { rows: EsignBulkDraftRow[]; error?: string };
    try {
      const sheet = await parseSpreadsheetFile(file);
      parsed = parseEsignBulkRows(
        sheet.headers,
        sheet.rows,
        template.fields.map((f) => f.field_key),
      );
      if (!parsed.error) setHeaders(sheet.headers);
    } catch {
      // A malformed workbook is the operator's file, not our failure, so it is
      // reported as a sheet problem rather than surfacing a parser stack.
      setBusy(false);
      toast.error(t("errors.unreadable"));
      return;
    }
    if (parsed.error) {
      setBusy(false);
      toast.error(t(`errors.${parsed.error}`));
      return;
    }
    setDrafts(parsed.rows);
    setPage(0);
    const result = await resolveEsignEmployees(parsed.rows.map((r) => r.employee_id));
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setResolved(result.rows);
    setStep(3);
  }

  /**
   * Replace one row's Employee ID.
   *
   * Only that row is re-resolved, because the fix is one cell: re-resolving the
   * whole sheet would re-read every other employee and could change a row the
   * operator had already accepted. The row keeps its index and its sheet values,
   * so a corrected sheet is the same sheet with one cell changed.
   */
  async function saveFix(rowIndex: number, employeeId: string) {
    const draft = drafts[rowIndex];
    if (!draft) return;
    setBusy(true);
    const result = await resolveEsignEmployees([employeeId]);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const row = result.rows[0];
    setDrafts((current) =>
      current.map((d, i) => (i === rowIndex ? { ...d, employee_id: employeeId } : d)),
    );
    setResolved((current) =>
      current.map((r, i) =>
        i === rowIndex
          ? { ...r, employee_id: employeeId, ok: Boolean(row?.ok), status: row?.status ?? "invalid", driver_id: row?.driver_id, snapshot: row?.snapshot }
          : r,
      ),
    );
    setFixRow(null);
  }

  async function confirm() {
    if (!templateId || !template) return;
    const usable = drafts
      .map((draft, i) => ({ draft, resolve: resolved[i] }))
      .filter((p) => p.resolve?.ok && p.resolve.driver_id);
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
        driver_id: p.resolve!.driver_id!,
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

  const stepTitle: Record<Step, string> = {
    1: t("steps.template"),
    2: t("steps.upload"),
    3: t("steps.review"),
  };

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        breadcrumbs={[
          // Two tiers, because the reference's bulk screen is two tiers and
          // because a three-tier crumb was the thing that made the template
          // surfaces read as a different product from the module they sit in.
          // `Request & Complaint` is the module; the page names itself.
          { label: t("breadcrumbRcm"), href: "/employeedesk/esign" },
          { label: t("title") },
        ]}
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            // Same destination as the templates list's identical control. It
            // used to point at the template library, so the one label the
            // reference repeats on two panels landed in two different places.
            render={<Link href="/employeedesk/esign" />}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("backToOutgoing")}
          </Button>
        }
      />

      <Stepper
        step={step}
        labels={[t("steps.template"), t("steps.upload"), t("steps.review")]}
        onGo={(target) => {
          // Backwards is always allowed; forwards only when that step has what
          // it needs, so a step cannot be reached with nothing to show.
          if (target === 1 || (target === 2 && templateId) || (target === 3 && drafts.length > 0)) {
            setStep(target);
          }
        }}
      />

      {step === 1 ? (
        <AppListCard className="space-y-3 p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
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
                  setHeaders([]);
                  setFileName("");
                }}
                placeholder={t("fieldTemplatePlaceholder")}
                searchPlaceholder={t("fieldTemplateSearch")}
                recentsKey="employeedesk-bulk-template"
                className="w-full"
              />
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
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>{t("fieldLocale")}</Label>
              <div className="flex gap-1" role="radiogroup">
                <SegmentOption selected={locale === "en"} onClick={() => setLocale("en")}>
                  EN
                </SegmentOption>
                <SegmentOption selected={locale === "ar"} onClick={() => setLocale("ar")}>
                  AR
                </SegmentOption>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("fieldDue")}</Label>
              <Input
                type="date"
                className="h-9 w-44"
                min={kuwaitTodayYmd()}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={!template}
              onClick={downloadExample}
            >
              <Download className="size-3.5" aria-hidden />
              {t("downloadExample")}
            </Button>
          </div>
          {template ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sheetColumnsTitle")}
              </p>
              <ColumnGroups
                labels={{
                  system: t("groups.system"),
                  sheet: t("groups.sheet"),
                }}
                system={columns.system}
                sheet={columns.sheet}
                hint={t("requiredTag")}
              />
            </div>
          ) : null}
        </AppListCard>
      ) : null}

      {step === 2 ? (
        <AppListCard className="space-y-3 p-4">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
              fileName
                ? "border-emerald-300 bg-emerald-50/40"
                : "border-border bg-muted/20 hover:bg-muted/40",
            )}
          >
            <Upload className="size-7 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">{t("dropHere")}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("dropMeta", { cap: BATCH_CAP })}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>

          {fileName ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                <FileSpreadsheet className="size-3" aria-hidden />
                {fileName}
              </span>
              <CheckRow label={t("checks.employeeId")} />
              <CheckRow label={t("checks.columns")} />
              <CheckRow label={t("checks.dates")} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{t("beforeUpload")}</p>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={!template}
              onClick={downloadExample}
            >
              <Download className="size-3.5" aria-hidden />
              {t("downloadExample")}
            </Button>
          </div>
        </AppListCard>
      ) : null}

      {step === 3 ? (
        <>
          <AppListCard className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {t("summaryRows", { count: drafts.length })}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                <CheckCircle2 className="size-3" aria-hidden />
                {t("summaryReady", { count: readyCount })}
              </span>
              {needsFixing > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  <AlertTriangle className="size-3" aria-hidden />
                  {t("summaryFix", { count: needsFixing })}
                </span>
              ) : null}
              {fileName ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <FileSpreadsheet className="size-3" aria-hidden />
                  {fileName}
                </span>
              ) : null}
            </div>

            <ColumnGroups
              labels={{
                system: t("groups.system"),
                sheet: t("groups.sheet"),
              }}
              system={columns.system}
              sheet={columns.sheet}
              hint={t("requiredTag")}
            />

            <p className="text-[10px] text-muted-foreground">
              {t("sheetHeaderNote", { count: headers.length })}
            </p>
          </AppListCard>

          <AppListCard className="p-0">
            {busy && drafts.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : drafts.length === 0 ? (
              <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
            ) : (
              <AppDataTable
                columns={[
                  { id: "emp", label: t("colEmployeeId") },
                  { id: "name", label: t("colEmployee") },
                  ...columns.sheetFields.slice(0, 3).map((f) => ({ id: f.id, label: templateFieldLabel(f, labelLocale) })),
                  { id: "status", label: t("colStatus") },
                  { id: "actions", label: t("colActions") },
                ]}
              >
                {pageRows.map((draft, offset) => {
                  // The absolute index, not the page offset: `resolved` is the
                  // whole sheet's array, and a page-relative index would read the
                  // first page's answers for every later page's rows.
                  const index = page * PAGE_SIZE + offset;
                  const resolve = resolved[index];
                  const ok = Boolean(resolve?.ok);
                  return (
                    <AppDataTableRow key={draft.row_index}>
                      <TableCell className="font-mono text-xs">
                        {draft.employee_id || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {resolve?.snapshot?.employee_name ?? "—"}
                      </TableCell>
                      {columns.sheetFields.slice(0, 3).map((f) => (
                        <TableCell key={f.id} className="text-sm">
                          {draft.field_values[f.field_key] || "—"}
                        </TableCell>
                      ))}
                      <TableCell>
                        <StatusChip
                          ok={ok}
                          label={t(`status.${(resolve?.status ?? "invalid") as EsignResolveStatus}`)}
                        />
                      </TableCell>
                      <TableCell>
                        {/* Only an unresolvable row offers anything to do. A
                            `Replace` on a resolvable row would be a control whose
                            result is the row you already have. */}
                        {ok ? (
                          <span className="text-[10px] text-muted-foreground">
                            {t("readyRow")}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setFixRow(index)}
                          >
                            <UserRoundSearch className="size-3.5" aria-hidden />
                            {t("replace")}
                          </Button>
                        )}
                      </TableCell>
                    </AppDataTableRow>
                  );
                })}
              </AppDataTable>
            )}
            {drafts.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
                <p className="text-[10px] text-muted-foreground">
                  {t("showingRange", {
                    from: page * PAGE_SIZE + 1,
                    to: Math.min(drafts.length, (page + 1) * PAGE_SIZE),
                    total: drafts.length,
                  })}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t("prevPage")}
                  </Button>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {page + 1} / {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              </div>
            ) : null}
          </AppListCard>
        </>
      ) : null}

      {/* Footer-first, with the step name on the left so the operator always
          knows which of the three they are looking at — the stepper is above the
          fold only while the page is at its top. */}
      <AppModalFooter
        asPage
        title={stepTitle[step]}
        subtitle={step === 3 ? t("sendNote") : t(step === 1 ? "footerHint1" : "footerHint2")}
        meta={
          step === 3 ? (
            <span className="tabular-nums">
              {t("footerCounts", { ready: readyCount, total: drafts.length })}
            </span>
          ) : undefined
        }
      >
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={busy}
            onClick={() => setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)))}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("back")}
          </Button>
        ) : null}
        {step === 1 ? (
          <Button
            className="h-9"
            disabled={!templateId}
            onClick={() => setStep(2)}
          >
            {t("continue")}
            <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        ) : null}
        {step === 2 ? (
          <Button
            className="h-9"
            disabled={busy || drafts.length === 0}
            onClick={() => setStep(3)}
          >
            {t("reviewRows")}
            <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        ) : null}
        {step === 3 ? (
          <Button
            className="h-9"
            disabled={busy || readyCount === 0}
            onClick={() => void confirm()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="size-3.5" aria-hidden />
            )}
            {t("send")}
          </Button>
        ) : null}
      </AppModalFooter>

      <Dialog open={fixRow !== null} onOpenChange={(open) => !open && setFixRow(null)}>
        <DialogContent className="w-[min(520px,96vw)] overflow-visible pt-4" showCloseButton closeOutside>
          {fixRow !== null ? (
            <FixRowForm
              rowNumber={fixRow + 1}
              initial={drafts[fixRow]?.employee_id ?? ""}
              labels={{
                title: t("fix.title"),
                subtitle: t("fix.subtitle", { row: fixRow + 1 }),
                label: t("colEmployeeId"),
                save: t("fix.save"),
                cancel: t("back"),
                hint: t("fix.hint"),
              }}
              busy={busy}
              onCancel={() => setFixRow(null)}
              onSave={(value) => void saveFix(fixRow, value)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}

/**
 * The three-step header.
 *
 * Steps before the current one are emerald with a check, because the palette in
 * this panel means "done" with green everywhere else and a stepper is the one
 * place an operator scans for that state rather than reading it.
 */
function Stepper({
  step,
  labels,
  onGo,
}: {
  step: Step;
  labels: string[];
  onGo: (target: Step) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {labels.map((label, i) => {
        const index = (i + 1) as Step;
        const done = index < step;
        const active = index === step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onGo(index)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors",
                active
                  ? "border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/50"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full text-[9px] font-bold",
                  active
                    ? "bg-emerald-600 text-white"
                    : done
                      ? "bg-emerald-600 text-white"
                      : "bg-muted-foreground/30 text-foreground",
                )}
              >
                {done ? <Check className="size-2.5" aria-hidden /> : index}
              </span>
              {label}
            </button>
            {i < labels.length - 1 ? (
              <span className="text-muted-foreground/40" aria-hidden>
                <ArrowRight className="size-3" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The two column lists.
 *
 * Rendered as plain chips under their own heading rather than as tags on a card,
 * because the pair is a *contract about the sheet*: the operator reads the
 * "you add" list as the columns they must fill and the "system" list as the ones
 * they can leave alone, and mixing the two orders would make that reading a
 * guess.
 *
 * Two lists and not three, matching the reference: a `fixed` or `signature` row
 * still arrives in the sheet (see `columns` above), so giving it its own group
 * would promise something the importer does not honour.
 */
function ColumnGroups({
  labels,
  system,
  sheet,
  hint,
}: {
  labels: { system: string; sheet: string };
  system: string[];
  sheet: EsignSheetColumn[];
  hint: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ColumnGroup
        label={labels.system}
        items={system.map((header) => ({ header, required: false }))}
        icon={Database}
        className="border-sky-200 bg-sky-50/60 text-sky-800"
        headingClassName="text-sky-800"
        hint={hint}
      />
      <ColumnGroup
        label={labels.sheet}
        items={sheet}
        icon={PenLine}
        className="border-amber-200 bg-amber-50/60 text-amber-800"
        headingClassName="text-amber-800"
        hint={hint}
      />
    </div>
  );
}

function ColumnGroup({
  label,
  items,
  icon: Icon,
  className,
  headingClassName,
  hint,
}: {
  label: string;
  items: { header: string; label?: string; required: boolean }[];
  icon: LucideIcon;
  className: string;
  headingClassName: string;
  hint: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-2", className)}>
      <p
        className={cn(
          "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
          headingClassName,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      {/**
       * One row per column, and the header text leads it, because the header is
       * the thing the operator has to type. The template's own label follows so
       * a snake_case key stays readable, and it is suppressed when it only
       * restates the key. No per-row badge: the group heading already carries
       * the icon, and a chip on each of ten rows is noise on a 14" screen.
       */}
      <ul className="overflow-hidden rounded-md border border-border/70 bg-background">
        {items.map((item) => (
          <li
            key={item.header}
            className="flex items-center gap-2 border-b border-border/60 px-2 py-0.5 last:border-b-0"
          >
            <span className="truncate font-mono text-[11px] text-foreground">
              {item.header}
            </span>
            {item.label && item.label.toLowerCase() !== item.header.toLowerCase() ? (
              <span className="truncate text-[10px] text-muted-foreground">{item.label}</span>
            ) : null}
            {item.required ? (
              <span className="ms-auto shrink-0 text-[10px] font-semibold text-destructive">
                {hint}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckRow({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Check className="size-3 text-emerald-600" aria-hidden />
      {label}
    </span>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-800",
      )}
    >
      {ok ? <CheckCircle2 className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
      {label}
    </span>
  );
}

/**
 * The row-replacement dialog.
 *
 * Footer-first: no top header band, the title and the reason sit on the left of
 * the footer, and Close floats outside the frame — the same shape every other
 * modal in this panel uses, so a dialog opened from a table does not introduce a
 * second way of reading a dialog.
 */
function FixRowForm({
  rowNumber,
  initial,
  labels,
  busy,
  onCancel,
  onSave,
}: {
  rowNumber: number;
  initial: string;
  labels: {
    title: string;
    subtitle: string;
    label: string;
    save: string;
    cancel: string;
    hint: string;
  };
  busy: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value.trim().length > 0 && value.trim() !== initial.trim();

  return (
    <form
      className="space-y-3 px-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !busy) onSave(value.trim());
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`fix-row-${rowNumber}`}>
          {labels.label} <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`fix-row-${rowNumber}`}
          className="h-9 font-mono"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">{labels.hint}</p>
      </div>
      <AppModalFooter title={labels.title} subtitle={labels.subtitle}>
        <Button type="button" variant="outline" className="h-9" onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button type="submit" className="h-9" disabled={!dirty || busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {labels.save}
        </Button>
      </AppModalFooter>
    </form>
  );
}
