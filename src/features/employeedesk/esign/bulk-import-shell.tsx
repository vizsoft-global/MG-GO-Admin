"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  CloudUpload,
  FileSpreadsheet,
  Loader2,
  PenLine,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppListCard } from "@/components/app/app-list-card";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { LAYOUT } from "@/components/app/layout-spacing";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  buildEsignExampleSheet,
  bulkSheetColumns,
  type EsignSheetColumn,
} from "@/features/esign/esign-example-sheet";
import { parseEsignBulkRows, type EsignBulkDraftRow } from "@/features/esign/esign-bulk-parse";
import {
  createEsignBatch,
  processEsignBatchChunk,
  resolveEsignEmployees,
  saveEsignDraft,
} from "@/features/esign/esign-sender-actions";
import { mappedEsignErrorKey } from "@/features/esign/esign-resolve-error";
import { mergeFieldValuesForSend } from "@/features/esign/esign-snapshot-merge";
import { snapshotValues } from "@/features/esign/render/esign-placeholders";
import {
  alignPenaltyCategoryKey,
  effectiveOutgoingCategoryKey,
  isSendableHubTemplate,
  pickSendableHubTemplate,
} from "@/features/esign/outgoing-hub-categories";
import { isEmployeeRowKey } from "@/features/esign/employee-block";
import {
  groupSheetFields,
  isSheetInput,
  previewFieldValues,
} from "@/features/esign/esign-sheet-fields";
import { EsignDocumentPreview } from "@/features/employeedesk/esign/document-preview";
import { templateFieldLabel } from "@/features/esign/template-source";
import {
  useEsignCategories,
  useEsignDraft,
  useEsignTemplate,
  useEsignTemplates,
} from "@/features/esign/use-esign";
import type {
  EsignLocale,
  EsignResolveRow,
  EsignTemplateFieldRow,
} from "@/features/esign/types";

type Step = 1 | 2 | 3;
type ReviewTone = "ready" | "check_id" | "add_value" | "pending";

/** PDF language is fixed. The bulk screens no longer offer a toggle. */
const BATCH_LANGUAGE: EsignLocale = "en";

const PAGE_SIZE = 6;

const FALLBACK_PENALTIES = [
  { key: "late_attendance", label: "Late attendance" },
  { key: "unauthorised_absence", label: "Unauthorised absence" },
  { key: "written_warning", label: "Written warning" },
  { key: "damage_to_property", label: "Damage to company property" },
  { key: "penalty_others", label: "Others" },
] as const;

function toastEsignError(t: (key: string) => string, error: string | undefined) {
  if (!error) return;
  const mapped = mappedEsignErrorKey(error);
  toast.error(mapped ? t(`errors.${mapped}`) : error);
}

function applySnapshots(
  rows: EsignResolveRow[],
  drafts: EsignBulkDraftRow[],
  fields: EsignTemplateFieldRow[],
  overrides: Record<string, string> = {},
): EsignBulkDraftRow[] {
  return drafts.map((draft, index) => {
    const row = rows[index];
    if (!row?.ok || !row.snapshot) return { ...draft, field_values: withOverrides(draft.field_values, fields, overrides) };
    return {
      ...draft,
      field_values: withOverrides(
        mergeFieldValuesForSend(
          snapshotValues(row.snapshot),
          draft.field_values,
          fields,
        ),
        fields,
        overrides,
      ),
    };
  });
}

/** Batch-only template values: applied to every row, never saved to the template. */
function withOverrides(
  values: Record<string, string>,
  fields: EsignTemplateFieldRow[],
  overrides: Record<string, string>,
): Record<string, string> {
  const keys = new Set(fields.map((field) => field.field_key));
  const next = { ...values };
  for (const [key, raw] of Object.entries(overrides)) {
    if (!keys.has(key)) continue;
    const typed = raw.trim();
    if (typed) next[key] = typed;
  }
  return next;
}

function requiredSheetKeys(fields: EsignTemplateFieldRow[]): string[] {
  return fields
    .filter((field) => field.is_required && !isEmployeeRowKey(field.field_key))
    .map((field) => field.field_key);
}

function reviewTone(
  resolve: EsignResolveRow | undefined,
  draft: EsignBulkDraftRow | undefined,
  requiredKeys: string[],
): ReviewTone {
  if (!resolve) return "pending";
  if (!resolve.ok) return "check_id";
  const missing = requiredKeys.some((key) => !(draft?.field_values[key] ?? "").trim());
  if (missing) return "add_value";
  return "ready";
}

function readyIndexSet(
  rows: EsignResolveRow[],
  drafts: EsignBulkDraftRow[],
  fields: EsignTemplateFieldRow[],
): Set<number> {
  const keys = requiredSheetKeys(fields);
  const next = new Set<number>();
  rows.forEach((row, index) => {
    if (reviewTone(row, drafts[index], keys) === "ready") next.add(index);
  });
  return next;
}

function snapshotText(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || "—";
}

function reviewRowClass(tone: ReviewTone): string | undefined {
  switch (tone) {
    case "check_id":
      return "bg-rose-50 hover:bg-rose-50";
    case "add_value":
      return "bg-amber-50 hover:bg-amber-50";
    case "ready":
    case "pending":
      return undefined;
    default: {
      const unexpected: never = tone;
      return unexpected;
    }
  }
}

function reviewStatusKey(tone: Exclude<ReviewTone, "pending">): "ready" | "checkId" | "addValue" {
  switch (tone) {
    case "ready":
      return "ready";
    case "check_id":
      return "checkId";
    case "add_value":
      return "addValue";
    default: {
      const unexpected: never = tone;
      return unexpected;
    }
  }
}

function SystemHead({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      <span className="text-xs font-normal normal-case tracking-normal text-emerald-700">{hint}</span>
    </span>
  );
}

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
export function BulkImportShell({
  initialTemplateId,
  /**
   * `?draft=<id>` — the drafts list resumes a saved bulk sheet back into this
   * wizard. A bulk draft is worth keeping precisely because step 3 is where the
   * work is: the rows are already mapped and the unresolvable ones already
   * corrected, and rebuilding that from the file is the slow part.
   */
  initialDraftId,
}: {
  initialTemplateId?: string;
  initialDraftId?: string;
}) {
  const t = useTranslations("pages.employeedesk.esign.bulk");
  const tRcm = useTranslations("pages.rcmV2");
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
  const { data: categoriesData } = useEsignCategories();
  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter((row) => isSendableHubTemplate(row)),
    [templatesData?.rows],
  );
  const penaltyChildren = useMemo(() => {
    const live = (categoriesData?.rows ?? []).filter(
      (row) => row.is_active && row.parent_key === "penalty",
    );
    if (live.length > 0) {
      return live.map((row) => ({ key: row.key, label: row.label_en }));
    }
    return FALLBACK_PENALTIES.map((row) => ({ key: row.key, label: row.label }));
  }, [categoriesData?.rows]);

  function pickPenaltyChild(key: string) {
    const picked = pickSendableHubTemplate(templatesData?.rows ?? [], key);
    if (!picked) {
      toast.error(t("penaltyMissingTemplate"));
      return;
    }
    setTemplateId(picked.id);
    setDrafts([]);
    setResolved([]);
    setFileName("");
    setChecked(new Set());
    setPrimedKey(null);
  }

  const [step, setStep] = useState<Step>(initialTemplateId ? 2 : 1);
  /** Batch-only template values: applied at compose time, never saved to the template. */
  const [templateOverrides, setTemplateOverrides] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;
  /**
   * The rows the operator may type over. A `signature` row is not an input —
   * its value is the rider's ink — so it stays in the preview and out of the
   * form, which is also what keeps the two panes describing the same sheet.
   */
  const editableFields = useMemo(
    () => (template?.fields ?? []).filter(isSheetInput),
    [template?.fields],
  );
  const sheetGroups = useMemo(
    () => groupSheetFields(editableFields, template?.document_kind ?? null),
    [editableFields, template?.document_kind],
  );
  const previewValues = useMemo(
    () => previewFieldValues(editableFields, templateOverrides, null),
    [editableFields, templateOverrides],
  );

  /**
   * One row of the batch-values form.
   *
   * The label is the template's own, in the page language — a raw
   * `employee_code` is a database column, not a value an operator is being
   * asked to type. The input follows the field's type, because a date typed
   * into a free-text box is a date the renderer has to guess at.
   */
  function renderOverrideField(field: EsignTemplateFieldRow) {
    const label = templateFieldLabel(field, labelLocale);
    const value = templateOverrides[field.field_key] ?? "";
    const setValue = (next: string) =>
      setTemplateOverrides((prev) => ({ ...prev, [field.field_key]: next }));
    const placeholder = field.preview_value ?? undefined;
    const wide = field.field_type === "textarea";

    return (
      <div key={field.field_key} className={cn("space-y-1", wide && "sm:col-span-2")}>
        <Label className="text-xs font-medium text-foreground">
          {label}
          {field.is_required ? <span className="text-destructive"> *</span> : null}
        </Label>
        {field.field_type === "select" && field.options.length > 0 ? (
          field.options.length > 30 ? (
            <SearchSelect
              items={field.options.map((option) => ({
                value: option,
                label: option,
                keywords: [option],
              }))}
              value={value || null}
              onChange={(next) => setValue(next ?? "")}
              placeholder={placeholder ?? t("editSelectPlaceholder")}
              searchPlaceholder={t("editSelectSearch")}
              recentsKey={`esign-bulk-value-${field.field_key}`}
              className="w-full"
            />
          ) : (
            <Select value={value || undefined} onValueChange={(next) => setValue(next ?? "")}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={placeholder ?? t("editSelectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : field.field_type === "textarea" ? (
          <Textarea
            className="min-h-16"
            value={value}
            placeholder={placeholder ?? t("editTextPlaceholder")}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <Input
            className="h-9"
            type={
              field.field_type === "number"
                ? "number"
                : field.field_type === "date"
                  ? "date"
                  : "text"
            }
            value={value}
            placeholder={placeholder ?? t("editTextPlaceholder")}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
    );
  }

  const [dueAt, setDueAt] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [drafts, setDrafts] = useState<EsignBulkDraftRow[]>([]);
  const [resolved, setResolved] = useState<EsignResolveRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"all" | "ready" | "fix">("all");
  const [fixRow, setFixRow] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [primedKey, setPrimedKey] = useState<string | null>(null);

  /** The draft being edited, so a second save updates rather than duplicates. */
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const draftQuery = useEsignDraft(initialDraftId ?? "");
  /**
   * One-shot. A draft payload is the *starting* state, so re-applying it on a
   * refetch would silently undo the rows the operator has since corrected —
   * which is the work the draft exists to protect.
   */
  const [appliedDraftId, setAppliedDraftId] = useState<string | null>(null);
  const [resolveRows, setResolveRows] = useState<EsignBulkDraftRow[] | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const incomingDraft = draftQuery.data?.draft ?? null;
  if (incomingDraft && appliedDraftId !== incomingDraft.id) {
    const restored: EsignBulkDraftRow[] = incomingDraft.rows.map((row, index) => ({
      row_index: index,
      employee_id: row.employee_id,
      description: row.description ?? "",
      field_values: row.field_values ?? {},
    }));
    setAppliedDraftId(incomingDraft.id);
    if (incomingDraft.template_id) setTemplateId(incomingDraft.template_id);
    if (incomingDraft.title) setTitle(incomingDraft.title);
    if (incomingDraft.due_at) setDueAt(incomingDraft.due_at.slice(0, 10));
    if (incomingDraft.source_filename) setFileName(incomingDraft.source_filename);
    setDrafts(restored);
    setPage(0);
    setStep(3);
    setBusy(restored.length > 0);
    setResolveRows(restored.length > 0 ? restored : null);
  }

  /**
   * Re-resolve a resumed draft's employee IDs.
   *
   * The rows are re-resolved rather than trusted from the payload because the
   * preview's whole job is to state each rider's *current* status: a draft saved
   * days ago could hold a rider who has since been archived or blocked, and a
   * stored `ok` would print a green row that the send would then refuse.
   */
  useEffect(() => {
    if (!resolveRows || !appliedDraftId) return;
    const restored = resolveRows;
    let ignore = false;
    void resolveEsignEmployees(restored.map((row) => row.employee_id)).then((result) => {
      if (ignore) return;
      setBusy(false);
      if (result.error) {
        toastEsignError(t, result.error);
        return;
      }
      const fields = template?.fields ?? [];
      const merged = applySnapshots(result.rows, restored, fields, templateOverrides);
      setDrafts(merged);
      setResolved(result.rows);
      setChecked(readyIndexSet(result.rows, merged, fields));
    });
    return () => {
      ignore = true;
    };
    // Once per draft. Template fields that arrive later reclassify via keysKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedDraftId, resolveRows, templateOverrides]);

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

  const requiredKeys = useMemo(
    () => requiredSheetKeys(template?.fields ?? []),
    [template?.fields],
  );
  const tones = useMemo(
    () => drafts.map((draft, index) => reviewTone(resolved[index], draft, requiredKeys)),
    [drafts, resolved, requiredKeys],
  );
  const needsFixing = useMemo(
    () => tones.filter((tone) => tone === "check_id" || tone === "add_value").length,
    [tones],
  );
  const readyCount = useMemo(
    () => tones.filter((tone) => tone === "ready").length,
    [tones],
  );
  const filteredIndexes = useMemo(() => {
    const query = reviewQuery.trim().toLowerCase();
    const indexes: number[] = [];
    drafts.forEach((draft, index) => {
      const tone = tones[index] ?? "pending";
      if (reviewFilter === "ready" && tone !== "ready") return;
      if (reviewFilter === "fix" && tone === "ready") return;
      if (query) {
        const name = resolved[index]?.snapshot?.employee_name ?? "";
        const haystack = `${draft.employee_id} ${name}`.toLowerCase();
        if (!haystack.includes(query)) return;
      }
      indexes.push(index);
    });
    return indexes;
  }, [drafts, tones, resolved, reviewQuery, reviewFilter]);
  const selectedReady = useMemo(
    () => tones.filter((tone, index) => tone === "ready" && checked.has(index)).length,
    [tones, checked],
  );
  const sheetValueFields = useMemo(
    () => columns.sheetFields.filter((field) => !isEmployeeRowKey(field.field_key)),
    [columns.sheetFields],
  );

  const keysKey = requiredKeys.join("|");
  if (resolved.length > 0 && primedKey !== keysKey) {
    setPrimedKey(keysKey);
    setChecked(readyIndexSet(resolved, drafts, template?.fields ?? []));
  }

  const pageCount = Math.max(1, Math.ceil(filteredIndexes.length / PAGE_SIZE));
  const safePage = filteredIndexes.length === 0 ? 0 : Math.min(page, pageCount - 1);
  const pageIndexes = filteredIndexes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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
      toastEsignError(t, result.error);
      return;
    }
    const merged = applySnapshots(result.rows, parsed.rows, template.fields);
    setDrafts(merged);
    setResolved(result.rows);
    setChecked(readyIndexSet(result.rows, merged, template.fields));
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
      toastEsignError(t, result.error);
      return;
    }
    const row = result.rows[0];
    const nextDraft = {
      ...draft,
      employee_id: employeeId,
      field_values:
        row?.ok && row.snapshot
          ? mergeFieldValuesForSend(
              snapshotValues(row.snapshot),
              draft.field_values,
              template?.fields ?? [],
            )
          : draft.field_values,
    };
    const nextResolve: EsignResolveRow = {
      ...resolved[rowIndex],
      row_index: resolved[rowIndex]?.row_index ?? rowIndex,
      employee_id: employeeId,
      ok: Boolean(row?.ok),
      status: row?.status ?? "invalid",
      driver_id: row?.driver_id,
      snapshot: row?.snapshot,
    };
    setDrafts((current) => current.map((d, i) => (i === rowIndex ? nextDraft : d)));
    setResolved((current) => current.map((r, i) => (i === rowIndex ? nextResolve : r)));
    setChecked((current) => {
      const next = new Set(current);
      if (reviewTone(nextResolve, nextDraft, requiredKeys) === "ready") next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
    setFixRow(null);
  }

  /**
   * Save the mapping as a draft.
   *
   * Every parsed row is stored, including the ones that did not resolve — those
   * are precisely the rows an operator has to come back and correct, and dropping
   * them would mean the resume was missing the work they were mid-way through.
   * The resolution is deliberately not stored (see the hydrate effect).
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
      rows: drafts.map((draft, i) => ({
        employee_id: draft.employee_id,
        driver_id: resolved[i]?.driver_id,
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
    const usable = drafts
      .map((draft, i) => ({ draft, resolve: resolved[i], index: i }))
      .filter(
        (pair) =>
          checked.has(pair.index) &&
          reviewTone(pair.resolve, pair.draft, requiredKeys) === "ready" &&
          Boolean(pair.resolve?.driver_id),
      );
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
        driver_id: p.resolve!.driver_id!,
        employee_id: p.draft.employee_id,
        description: p.draft.description,
        field_values: mergeFieldValuesForSend(
          p.resolve?.snapshot ? snapshotValues(p.resolve.snapshot) : null,
          p.draft.field_values,
          template.fields,
        ),
      })),
    });
    if (!created.ok || !created.id) {
      setBusy(false);
      toastEsignError(t, created.error ?? t("errors.createFailed"));
      return;
    }
    let remaining = usable.length;
    while (remaining > 0) {
      const chunk = await processEsignBatchChunk(created.id);
      if (!chunk.ok) {
        toastEsignError(t, chunk.error ?? t("errors.processFailed"));
        break;
      }
      remaining = chunk.remaining;
      if (chunk.processed === 0) break;
    }
    setBusy(false);
    toast.success(t("sentToast", { count: usable.length }));
    router.push(`/employeedesk/esign/batches/${created.id}?sent=${usable.length}`);
  }

  return (
    <AppPage className={`${LAYOUT.stackGap} flex flex-col`}>
      <div className="flex flex-col gap-2">
        <Link
          href="/employeedesk"
          className="inline-flex h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" />
          {t("backToOutgoing")}
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-orange-200 bg-orange-50 text-orange-700">
              <FileSpreadsheet className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-md bg-[#FFFAEB] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#B54708]">
            {tRcm("youSend")}
          </span>
        </div>
      </div>

      <Stepper
        step={step}
        labels={[t("steps.template"), t("steps.upload"), t("steps.review"), t("steps.notify")]}
        onGo={(target) => {
          if (target === 4) return;
          if (target === 1 || (target === 2 && templateId) || (target === 3 && drafts.length > 0)) {
            setStep(target as Step);
          }
        }}
      />

      <div className={`grid min-h-0 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] lg:items-stretch ${LAYOUT.panelGap}`}>
        <AppListCard className={`flex h-full flex-col ${LAYOUT.stackGap} p-4`}>
          <div className="space-y-1">
            <Label>{t("fieldTemplate")}</Label>
            {step === 3 ? (
              <div className="flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm">
                <span className="truncate">{template?.name_en ?? (title || "—")}</span>
              </div>
            ) : (
              <SearchSelect
                items={templateItems}
                value={templateId}
                onChange={(id) => {
                  setTemplateId(id);
                  setDrafts([]);
                  setResolved([]);
                  setFileName("");
                  setChecked(new Set());
                  setPrimedKey(null);
                }}
                placeholder={t("fieldTemplatePlaceholder")}
                searchPlaceholder={t("fieldTemplateSearch")}
                recentsKey="employeedesk-bulk-template"
                className="w-full"
              />
            )}
            {step === 1 ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-normal uppercase tracking-[0.5px] text-[#a1a1aa]">
                  {t("penaltyCategory")}
                </p>
                <div className="flex flex-col gap-1">
                  {penaltyChildren.map((child) => (
                    <button
                      key={child.key}
                      type="button"
                      className={cn(
                        "flex h-8 items-center rounded px-2 text-start text-xs font-normal text-[#18181b] hover:bg-[#f4f4f5]",
                        template &&
                          effectiveOutgoingCategoryKey(template) ===
                            alignPenaltyCategoryKey(child.key)
                          ? "bg-[#f4f4f5] font-semibold"
                          : null,
                      )}
                      onClick={() => pickPenaltyChild(child.key)}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {template ? (
            <ColumnGroups
              labels={{
                system: t("groups.system"),
                sheet: t("groups.sheet"),
              }}
              system={columns.system}
              sheet={columns.sheet}
              employeeIdLabel={t("employeeIdChip")}
              hint={t("requiredTag")}
            />
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 items-center text-xs font-semibold text-[#EA580C] hover:underline disabled:opacity-50"
            disabled={!template}
            onClick={downloadExample}
          >
            {t("downloadExample")}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center text-xs font-semibold text-[#EA580C] hover:underline disabled:opacity-50"
            disabled={!template}
            onClick={() => setEditOpen(true)}
          >
            {t("editValues")}
          </button>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent
              showCloseButton
              closeOutside
              className="w-[min(1200px,96vw)] max-w-none gap-0 overflow-visible p-0 sm:max-w-[min(1200px,96vw)]"
            >
              <div className="grid h-[min(84dvh,800px)] min-h-[480px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-stretch">
                <div className="relative hidden h-full min-h-0 border-e border-border bg-muted/40 lg:block">
                  {template ? (
                    <EsignDocumentPreview
                      templateName={title.trim() || template.name_en}
                      nameAr={template.name_ar}
                      company={t("previewCompany")}
                      body={template.body_en}
                      bodyAr={template.body_ar}
                      declaration={template.declaration_en}
                      declarationAr={template.declaration_ar}
                      fields={template.fields}
                      values={previewValues}
                      fill
                      documentKind={template.document_kind}
                      signers={{
                        employeeLabel: t("signerEmployee"),
                        staffLabel: t("signerStaff"),
                      }}
                    />
                  ) : null}
                </div>

                <div className="flex h-full min-h-0 flex-col">
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                    {sheetGroups.length === 0 ? (
                      <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t("noEditableFields")}
                      </p>
                    ) : (
                      sheetGroups.map((group) => (
                        <div key={group.key} className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                            {t(`valueGroups.${group.key}`)}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {group.fields.map((field) => renderOverrideField(field))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="shrink-0 border-t border-border px-5 py-3">
                    <AppModalFooter title={t("editTitle")} subtitle={t("editHint")}>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        onClick={() => {
                          setTemplateOverrides({});
                          setEditOpen(false);
                          setStep(2);
                        }}
                      >
                        {t("useAsIs")}
                      </Button>
                      <Button
                        type="button"
                        className="h-9"
                        onClick={() => {
                          setEditOpen(false);
                          setStep(2);
                        }}
                      >
                        {t("continue")}
                      </Button>
                    </AppModalFooter>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {step === 3 && fileName ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <FileSpreadsheet className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="truncate">{fileName}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("rowsFound", { count: drafts.length })}
              </p>
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-[#EA580C] hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => replaceInputRef.current?.click()}
              >
                {t("replace")}
              </button>
              <button
                type="button"
                className="mt-1 block text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={savingDraft || busy || drafts.length === 0}
                onClick={() => void saveDraft()}
              >
                {draftId ? t("updateDraft") : t("saveDraft")}
              </button>
              <input
                ref={replaceInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void onFile(file);
                }}
              />
            </div>
          ) : null}
        </AppListCard>

        {step === 3 ? (
          <AppListCard className="flex h-full min-h-0 flex-col p-0">
            {busy && drafts.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : drafts.length === 0 ? (
              <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span>
                        {t("reviewTitle", {
                          count: drafts.length,
                          template: template?.name_en ?? title,
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <Check className="size-3" aria-hidden />
                        {t("summaryReady", { count: readyCount })}
                      </span>
                      {needsFixing > 0 ? (
                        <span className="text-xs font-semibold text-rose-600">
                          {t("summaryFix", { count: needsFixing })}
                        </span>
                      ) : null}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {template?.document_kind === "payslip"
                        ? t("willReceive", { count: readyCount })
                        : t("reviewHelper")}
                      {sheetValueFields.length > 3
                        ? ` ${t("extraColumns", { count: sheetValueFields.length - 3 })}`
                        : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        className="h-9 w-56"
                        value={reviewQuery}
                        placeholder={t("searchEmployees")}
                        onChange={(event) => {
                          setReviewQuery(event.target.value);
                          setPage(0);
                        }}
                      />
                      <Select
                        value={reviewFilter}
                        onValueChange={(next) => {
                          setReviewFilter(next === "ready" || next === "fix" ? next : "all");
                          setPage(0);
                        }}
                      >
                        <SelectTrigger className="h-9 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("filterAll")}</SelectItem>
                          <SelectItem value="ready">{t("filterReady")}</SelectItem>
                          <SelectItem value="fix">{t("filterFix")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <AppDataTable
                  columns={[
                    {
                      id: "pick",
                      label: (
                        <Checkbox
                          checked={
                            readyCount > 0 &&
                            tones.every((tone, index) => tone !== "ready" || checked.has(index))
                          }
                          aria-label={t("selectRow")}
                          onCheckedChange={(value) => {
                            setChecked(() => {
                              if (!value) return new Set();
                              return readyIndexSet(resolved, drafts, template?.fields ?? []);
                            });
                          }}
                        />
                      ),
                    },
                    { id: "emp", label: t("colEmployeeId") },
                    {
                      id: "name",
                      label: <SystemHead label={t("colEmployee")} hint={t("fromSystem")} />,
                      className: "bg-emerald-50/70",
                    },
                    {
                      id: "position",
                      label: <SystemHead label={t("colPosition")} hint={t("fromSystem")} />,
                      className: "bg-emerald-50/70",
                    },
                    ...sheetValueFields.slice(0, 3).map((field) => ({
                      id: field.id,
                      label: templateFieldLabel(field, labelLocale),
                    })),
                    { id: "status", label: t("colStatus") },
                  ]}
                >
                  {pageIndexes.map((index) => {
                    const draft = drafts[index];
                    const resolve = resolved[index];
                    const tone = tones[index] ?? "pending";
                    const snap = resolve?.snapshot;
                    return (
                      <AppDataTableRow key={draft.row_index} className={reviewRowClass(tone)}>
                        <TableCell>
                          <Checkbox
                            checked={tone === "ready" && checked.has(index)}
                            disabled={tone !== "ready"}
                            aria-label={t("selectRow")}
                            onCheckedChange={(value) => {
                              setChecked((current) => {
                                const next = new Set(current);
                                if (value) next.add(index);
                                else next.delete(index);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {draft.employee_id || "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-sm",
                            tone === "ready" || tone === "pending" ? "bg-emerald-50" : undefined,
                          )}
                        >
                          {tone === "check_id" ? (
                            <span className="font-medium text-rose-700">{t("notFound")}</span>
                          ) : (
                            snapshotText(snap?.employee_name)
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-sm",
                            tone === "ready" || tone === "pending" ? "bg-emerald-50" : undefined,
                          )}
                        >
                          {snapshotText(snap?.position)}
                        </TableCell>
                        {sheetValueFields.slice(0, 3).map((field) => {
                          const value = draft.field_values[field.field_key]?.trim() ?? "";
                          const missing =
                            tone === "add_value" && field.is_required && value.length === 0;
                          return (
                            <TableCell key={field.id} className="text-sm">
                              {missing ? (
                                <span className="font-medium text-destructive">{t("notFilled")}</span>
                              ) : (
                                value || "—"
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {tone === "pending" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ReviewStatusChip
                              tone={tone}
                              label={t(`statusChip.${reviewStatusKey(tone)}`)}
                            />
                          )}
                        </TableCell>
                      </AppDataTableRow>
                    );
                  })}
                </AppDataTable>
              </>
            )}
            {drafts.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
                <p className="text-xs text-muted-foreground">
                  {t("showingCount", {
                    shown: pageIndexes.length,
                    total: filteredIndexes.length,
                  })}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t("prevPage")}
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={safePage + 1 >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              </div>
            ) : null}
          </AppListCard>
        ) : (
          <AppListCard className={`flex h-full flex-col ${LAYOUT.stackGap} p-4`}>
            <h2 className="text-sm font-semibold">{t("uploadTitle")}</h2>
            <label
              className={cn(
                "flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center",
                !template || busy
                  ? "pointer-events-none border-border bg-muted/20 opacity-60"
                  : fileName
                    ? "border-emerald-300 bg-emerald-50/40"
                    : "border-border bg-muted/20 hover:bg-muted/40",
              )}
            >
              <CloudUpload className="size-8 text-[#F04438]" aria-hidden />
              <span className="text-sm font-medium">{t("dropHere")}</span>
              <span className="text-xs text-muted-foreground">{t("dropHint")}</span>
              <span className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-xs font-medium">
                {t("browseFile")}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                disabled={busy || !template}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">{t("beforeYouUpload")}</p>
              <CheckRow label={t("checks.employeeId")} />
              <CheckRow label={t("checks.columns")} />
              <CheckRow label={t("checks.dates")} />
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              {step === 1 ? (
                <Button variant="outline" className="h-9" render={<Link href="/employeedesk" />}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t("back")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t("back")}
                </Button>
              )}
              {step === 1 ? (
                <Button
                  className="h-9 bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:opacity-100"
                  disabled={!templateId}
                  onClick={() => setEditOpen(true)}
                >
                  {t("continue")}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              ) : (
                <Button
                  className="h-9 bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:opacity-100"
                  disabled={busy || drafts.length === 0}
                  onClick={() => setStep(3)}
                >
                  {t("continue")}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              )}
            </div>
          </AppListCard>
        )}
      </div>

      {step === 3 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">{t("sendNote")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {needsFixing > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  const checkIndex = tones.findIndex((tone) => tone === "check_id");
                  const addIndex = tones.findIndex((tone) => tone === "add_value");
                  const target = checkIndex >= 0 ? checkIndex : addIndex;
                  if (target < 0) return;
                  setPage(Math.floor(target / PAGE_SIZE));
                  if (checkIndex >= 0) setFixRow(checkIndex);
                }}
              >
                {t("fixRows", { count: needsFixing })}
              </Button>
            ) : null}
            <Button
              className="h-9 bg-zinc-950 text-white hover:bg-zinc-800"
              disabled={busy || selectedReady === 0}
              onClick={() => void confirm()}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Send className="size-3.5" aria-hidden />
              )}
              {t("sendToCount", { count: selectedReady })}
            </Button>
          </div>
        </div>
      ) : null}

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
 * Four-step chrome. The fourth label is visual only — send still happens on
 * step 3 — so a click on it is a no-op from the parent.
 */
function Stepper({
  step,
  labels,
  onGo,
}: {
  step: number;
  labels: string[];
  onGo: (target: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {labels.map((label, i) => {
        const index = i + 1;
        const done = index < step;
        const active = index === step;
        const clickable = index <= 3;
        return (
          <li key={label} className="flex min-w-0 items-center gap-1">
            {clickable ? (
              <button
                type="button"
                onClick={() => onGo(index)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold",
                  active || done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-xs font-bold",
                    done && "bg-emerald-500 text-white",
                    active && "bg-zinc-950 text-white",
                    !done && !active && "border border-border bg-background text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-2.5" aria-hidden /> : index}
                </span>
                {label}
              </button>
            ) : (
              <span className="inline-flex h-8 items-center gap-1.5 px-1.5 text-xs font-semibold text-muted-foreground">
                <span className="grid size-5 place-items-center rounded-full border border-border bg-background text-xs font-bold text-muted-foreground">
                  {index}
                </span>
                {label}
              </span>
            )}
            {i < labels.length - 1 ? (
              <span
                className={cn("hidden h-px w-10 sm:block", done ? "bg-emerald-500" : "bg-border")}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * FILLED FROM THE SYSTEM vs YOU ADD IN THE SHEET — pills, not table rows.
 */
function ColumnGroups({
  labels,
  system,
  sheet,
  employeeIdLabel,
  hint,
}: {
  labels: { system: string; sheet: string };
  system: string[];
  sheet: EsignSheetColumn[];
  employeeIdLabel: string;
  hint: string;
}) {
  return (
    <div className={LAYOUT.stackGap + " flex flex-col"}>
      <ColumnGroup
        label={labels.system}
        tone="system"
        items={system.map((header) => ({ header, required: false, chip: "system" as const }))}
        icon={Building2}
        hint={hint}
      />
      <ColumnGroup
        label={labels.sheet}
        tone="sheet"
        items={sheet.map((item, index) => ({
          header: item.header,
          label: index === 0 && item.required ? employeeIdLabel : item.label,
          required: item.required,
          chip: item.required ? ("required" as const) : ("sheet" as const),
        }))}
        icon={PenLine}
        hint={hint}
      />
    </div>
  );
}

function ColumnGroup({
  label,
  tone,
  items,
  icon: Icon,
  hint,
}: {
  label: string;
  tone: "system" | "sheet";
  items: { header: string; label?: string; required: boolean; chip: "system" | "sheet" | "required" }[];
  icon: LucideIcon;
  hint: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          "flex items-center gap-1 text-xs font-semibold uppercase tracking-wide",
          tone === "system" ? "text-sky-700" : "text-[#EA580C]",
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.header}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              item.chip === "system" && "border-sky-200 bg-sky-50 text-sky-900",
              item.chip === "required" && "border-orange-200 bg-orange-50 text-orange-800",
              item.chip === "sheet" && "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            <span className="truncate">{item.label ?? item.header}</span>
            {item.required && item.chip !== "required" ? (
              <span className="text-destructive" title={hint}>
                *
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
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3 text-emerald-600" aria-hidden />
      {label}
    </p>
  );
}

function reviewChipClass(tone: Exclude<ReviewTone, "pending">): string {
  switch (tone) {
    case "ready":
      return "text-emerald-700";
    case "check_id":
      return "text-rose-600";
    case "add_value":
      return "text-amber-700";
    default: {
      const unexpected: never = tone;
      return unexpected;
    }
  }
}

function ReviewStatusChip({
  tone,
  label,
}: {
  tone: Exclude<ReviewTone, "pending">;
  label: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", reviewChipClass(tone))}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
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
        <p className="text-xs text-muted-foreground">{labels.hint}</p>
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
