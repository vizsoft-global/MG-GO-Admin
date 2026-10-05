"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FilePenLine,
  Languages,
  Lock,
  Plus,
  Save,
  Send,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { SegmentOption, ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import {
  deleteEsignTemplateField,
  upsertEsignTemplate,
  upsertEsignTemplateField,
} from "@/features/esign/esign-sender-actions";
import {
  ESIGN_FIELD_SOURCE_ORDER,
  ESIGN_FIELD_TYPE_ORDER,
  fieldPairErrorKey,
  resolveFieldSource,
} from "@/features/esign/template-source";
import { buildEsignExampleSheet } from "@/features/esign/esign-example-sheet";
import {
  ESIGN_EMPLOYEE_ROWS,
  employeeRowLabel,
} from "@/features/esign/employee-block";
import type {
  EsignDocumentKind,
  EsignFieldSection,
  EsignLocale,
  EsignTemplateDetail,
  EsignTemplateFieldRow,
  EsignTemplateFieldType,
} from "@/features/esign/types";
import { FieldSourceBadge } from "./field-source-badge";
import { EsignDocumentPreview } from "./document-preview";

const CATEGORIES = [
  { key: "penalty", labelKey: "categoryPenalty" },
  { key: "loan", labelKey: "categoryLoan" },
  { key: "warning", labelKey: "categoryWarning" },
  { key: "handover", labelKey: "categoryHandover" },
  { key: "general", labelKey: "categoryGeneral" },
] as const;

const DOCUMENT_KINDS: EsignDocumentKind[] = ["penalty", "loan", "general"];

type DraftField = EsignTemplateFieldRow & {
  /** Set on a row created in this session — no server id to delete yet. */
  isNew?: boolean;
  /** Set when the row existed on load and must be deleted on save. */
  removed?: boolean;
};

let newFieldSeq = 0;

function blankField(templateId: string, sortOrder: number): DraftField {
  newFieldSeq += 1;
  return {
    id: `new-${newFieldSeq}`,
    template_id: templateId,
    field_key: "",
    label_en: "",
    label_ar: null,
    field_type: "text",
    options: [],
    is_required: false,
    sort_order: sortOrder,
    source_kind: "entry",
    section_key: "document",
    options_source: null,
    isNew: true,
  };
}

/**
 * EmployeeDesk V2 template builder.
 *
 * Two panes, matching the reference: a field list on the start side where every
 * row carries its **source badge**, and the A4 document preview on the end side.
 * The preview is live — it reads the same draft the list edits — because the
 * point of the screen is to answer "what will the rider actually receive", and a
 * preview that updates only after a save cannot answer it while the author is
 * still deciding.
 *
 * This is additive. `/requests/esign/templates/[id]` (V1) is untouched and still
 * saves through the same two RPCs; the only difference is that V1 does not send
 * the three new keys, so its rows keep the `entry`/`document` defaults.
 */
export function TemplateBuilderShell({
  template,
  categories,
  isNew = false,
}: {
  template: EsignTemplateDetail;
  categories: { key: string; label_en: string }[];
  /** Create mode: the draft has no server row yet, so save inserts then routes. */
  isNew?: boolean;
}) {
  const t = useTranslations("pages.employeedesk.esign.templateBuilder");
  const router = useRouter();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState({
    name_en: template.name_en,
    name_ar: template.name_ar ?? "",
    category_key: template.category_key,
    document_kind: template.document_kind,
    default_language: template.default_language as EsignLocale,
    is_active: template.is_active,
    is_draft: template.is_draft,
    header_en: template.header_en,
    header_ar: template.header_ar,
    body_en: template.body_en,
    body_ar: template.body_ar,
    declaration_en: template.declaration_en,
    declaration_ar: template.declaration_ar,
  });

  const [fields, setFields] = useState<DraftField[]>(() =>
    [...template.fields].sort((a, b) => a.sort_order - b.sort_order),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    template.fields[0]?.id ?? null,
  );
  const [previewLocale, setPreviewLocale] = useState<EsignLocale>(
    template.default_language as EsignLocale,
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /**
   * Which section tab the field list is showing.
   *
   * The reference draws the list as two tabs — `Employee Information` and
   * `Employee details` — rather than one list with inline group headings, and
   * that is the right call here for the same reason: a penalty notice carries
   * ~10 system rows and 3 authored ones, and a single list buries the three the
   * author actually has to fill in. The default is the first tab that has rows,
   * so an author never opens onto an empty list when the other tab is populated.
   */
  const [section, setSection] = useState<EsignFieldSection>(() => {
    const first = template.fields?.find((f) => f.section_key === "employee");
    return first ? "employee" : "document";
  });

  const visibleFields = useMemo(() => fields.filter((f) => !f.removed), [fields]);

  /**
   * Whether the Document details block is expanded.
   *
   * The reference gives the field list the whole start pane and keeps the
   * document-level settings off the screen, because the fields are what an
   * author is actually editing — the name, category and body are set once and
   * then re-read, not worked in. Expanded by default they pushed the field list
   * below the fold on a 14" laptop, so the pane an author opened the screen for
   * was the one they had to scroll to reach.
   *
   * An empty draft inverts that: with no field rows yet there is nothing to give
   * the room to, and the details block is the only thing a new template has to
   * fill in. So it opens when the list is empty and collapses when it is not —
   * a data-independent default would be wrong for one of the two cases.
   */
  const [detailsOpen, setDetailsOpen] = useState(() => template.fields.length === 0);
  const tabFields = useMemo(
    () => visibleFields.filter((f) => f.section_key === section),
    [visibleFields, section],
  );
  const sectionCounts = useMemo(
    () => ({
      employee: visibleFields.filter((f) => f.section_key === "employee").length,
      document: visibleFields.filter((f) => f.section_key === "document").length,
    }),
    [visibleFields],
  );
  const selected = visibleFields.find((f) => f.id === selectedId) ?? null;
  const categoryOptions = categories.length
    ? categories.map((c) => ({ key: c.key, label: c.label_en }))
    : CATEGORIES.map((c) => ({ key: c.key, label: t(c.labelKey) }));

  function patchDraft<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function patchField(id: string, patch: Partial<DraftField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function moveField(id: string, direction: -1 | 1) {
    setFields((prev) => {
      const live = prev.filter((f) => !f.removed);
      const moving = live.find((f) => f.id === id);
      if (!moving) return prev;
      // Reorder inside the row's own section, not the whole list.
      //
      // The list renders one section at a time, so the arrows must move a row
      // against the neighbours the author can actually see. Swapping against the
      // global order instead would send a row past a hidden row in the other tab
      // — the arrow would appear to do nothing, twice, then jump. The section's
      // members are re-sequenced and dropped back into the same global slots, so
      // cross-section interleaving is left exactly as it was.
      const sectionIds = live
        .filter((f) => f.section_key === moving.section_key)
        .map((f) => f.id);
      const at = sectionIds.indexOf(id);
      const target = at + direction;
      if (at < 0 || target < 0 || target >= sectionIds.length) return prev;
      const reordered = [...sectionIds];
      const [movedId] = reordered.splice(at, 1);
      reordered.splice(target, 0, movedId);

      let cursor = 0;
      const next = live.map((f) =>
        f.section_key === moving.section_key
          ? live.find((row) => row.id === reordered[cursor++])!
          : f,
      );
      // Sort order is positional, so a reorder is just a renumber of the live
      // rows. Removed rows keep their position in `fields` but are filtered out
      // of the render and the save.
      return [...next.map((f, i) => ({ ...f, sort_order: i })), ...prev.filter((f) => f.removed)];
    });
  }

  function removeField(id: string) {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, removed: true } : f)),
    );
    if (selectedId === id) {
      const next = visibleFields.find((f) => f.id !== id);
      setSelectedId(next?.id ?? null);
    }
  }

  function addField() {
    // The new row lands in the tab the author is looking at, or it would be
    // created invisible and look like the button did nothing.
    const field = { ...blankField(template.id, visibleFields.length), section_key: section };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
  }

  const pairError = selected
    ? fieldPairErrorKey(
        resolveFieldSource(selected),
        selected.field_type,
        selected.options.filter((o) => o.trim()).length,
      )
    : null;

  const canSave =
    draft.name_en.trim().length > 0 &&
    visibleFields.every(
      (f) =>
        f.label_en.trim().length > 0 &&
        /^[a-z][a-z0-9_]*$/.test(f.field_key) &&
        !fieldPairErrorKey(
          resolveFieldSource(f),
          f.field_type,
          f.options.filter((o) => o.trim()).length,
        ),
    );

  async function handleSave(options?: { asDraft?: boolean }) {
    if (!canSave || saving) return;
    // `Save draft` is the same write with two status flags forced, rather than a
    // second code path: the reference offers it beside the primary so an author
    // can park a half-built template without a publish decision, and the only
    // difference that matters is whether it lands in the sendable library.
    const isDraft = options?.asDraft ? true : draft.is_draft;
    const isActive = options?.asDraft ? false : draft.is_active;
    setSaving(true);
    try {
      const saved = await upsertEsignTemplate({
        // In create mode the row does not exist yet, so the insert branch of the
        // RPC runs. Passing an id would make it an update against nothing.
        id: isNew ? undefined : template.id,
        category_key: draft.category_key,
        name_en: draft.name_en,
        name_ar: draft.name_ar,
        header_en: draft.header_en,
        header_ar: draft.header_ar,
        body_en: draft.body_en,
        body_ar: draft.body_ar,
        declaration_en: draft.declaration_en,
        declaration_ar: draft.declaration_ar,
        default_language: draft.default_language,
        is_active: isActive,
        document_kind: draft.document_kind,
        is_draft: isDraft,
      });
      if (!saved.ok) throw new Error(saved.error ?? "failed");

      if (!saved.ok || !saved.id) throw new Error(saved.error ?? "failed");
      const templateId = saved.id;

      for (const field of fields) {
        if (field.removed) {
          if (!field.isNew) {
            const res = await deleteEsignTemplateField(field.id);
            if (!res.ok) throw new Error(res.error ?? "failed");
          }
          continue;
        }
        const res = await upsertEsignTemplateField({
          template_id: templateId,
          field_key: field.field_key,
          label_en: field.label_en,
          label_ar: field.label_ar,
          field_type: field.field_type,
          options: field.options.filter((o) => o.trim()),
          is_required: field.is_required,
          sort_order: field.sort_order,
          source_kind: resolveFieldSource(field),
          section_key: field.section_key,
          options_source: field.options_source,
        });
        if (!res.ok) throw new Error(res.error ?? "failed");
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.templates() });
      if (!isNew) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.esign.template(template.id),
        });
      }
      toast.success(isDraft ? t("draftSaved") : t("saved"));
      if (isNew) {
        router.replace(`/employeedesk/esign/templates/${templateId}`);
      } else {
        router.refresh();
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "failed";
      toast.error(t.has(`errors.${code}`) ? t(`errors.${code}`) : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Download the example sheet for this template.
   *
   * Built from the live draft, not from the stored row, so an author who has
   * just added a field can hand out a sheet that already has its column. The
   * sheet leads with `Employee ID` because that is the column the importer
   * resolves the rider from, and it never lists a reserved employee key — those
   * fill from the record and a column asking for one would be silently ignored.
   */
  function downloadExampleSheet() {
    const sheet = buildEsignExampleSheet(visibleFields);
    const blob = new Blob([sheet.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(draft.name_en || "esign").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-example-sheet.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(t("exampleSheetDownloaded"));
  }

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        breadcrumbs={[
          // The list's own two crumbs, extended by the record — so the chain
          // reads `Request & Complaint / Templates / Penalty Notice` and every
          // label points at the page it names. It previously put the hub's name
          // on the templates link, so "EmployeeDesk" and "Templates" were two
          // crumbs with one destination, and a reader who clicked the first was
          // not taken where its label said.
          { label: t("breadcrumbRcm"), href: "/employeedesk" },
          { label: t("breadcrumbTemplates"), href: "/employeedesk/esign/templates" },
          { label: draft.name_en || t("untitled") },
        ]}
        title={draft.name_en || t("untitled")}
        description={
          <>
            {draft.name_ar.trim() ? (
              <span className="block text-foreground/80" dir="rtl">
                {draft.name_ar}
              </span>
            ) : null}
            <span className="block">{t("builderSubtitle")}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/employeedesk/esign/templates")}
            >
              <Undo2 className="size-3.5" aria-hidden />
              {t("backToList")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadExampleSheet}
              disabled={visibleFields.length === 0}
            >
              <Download className="size-3.5" aria-hidden />
              {t("downloadExampleSheet")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isNew}
              onClick={() => router.push(`/employeedesk/esign/bulk?template=${template.id}`)}
            >
              <FileSpreadsheet className="size-3.5" aria-hidden />
              {t("importSheet")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canSave || saving}
              // Neutral-vs-primary, not two identical actions: this one parks the
              // template outside the sendable library, the primary publishes it
              // with whatever status the form says. Same write, two outcomes, so
              // the pair reads the way the rulebook asks a destructive/neutral
              // pair to read — different in weight, not in size.
              onClick={() => handleSave({ asDraft: true })}
            >
              <FilePenLine className="size-3.5" aria-hidden />
              {t("saveDraft")}
            </Button>
            <Button size="sm" onClick={() => handleSave()} disabled={!canSave || saving}>
              <Save className="size-3.5" aria-hidden />
              {saving ? t("saving") : t("save")}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,660px)] lg:items-start">
        {/* ---------------------------------------------------------------
            Start pane — details, then the field list with source badges.
            --------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="rounded-xl border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
              {/* The title doubles as the disclosure control, and states the
                  template's own name once collapsed — a closed section whose
                  heading still said "Document details" would hide which document
                  is open, which is the one thing the collapsed state must not
                  lose. */}
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                    !detailsOpen && "-rotate-90",
                  )}
                  aria-hidden
                />
                <CardTitle className="truncate text-sm">
                  {detailsOpen ? t("detailsTitle") : draft.name_en || t("detailsTitle")}
                </CardTitle>
              </button>
              {/* The direction chip, as the reference carries it on every
                  document block. It is a fact about the template rather than a
                  control, so it takes the metadata badge treatment instead of a
                  toggle's emerald — nothing here is selectable. */}
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <Send className="size-3" aria-hidden />
                {t("youSend")}
              </span>
            </CardHeader>
            <CardContent
              className={cn("space-y-3 p-4 pt-0", !detailsOpen && "hidden")}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("nameEn")} required>
                  <Input
                    className="h-9"
                    value={draft.name_en}
                    onChange={(e) => patchDraft("name_en", e.target.value)}
                  />
                </Field>
                <Field label={t("nameAr")}>
                  <Input
                    className="h-9"
                    dir="rtl"
                    value={draft.name_ar}
                    onChange={(e) => patchDraft("name_ar", e.target.value)}
                  />
                </Field>
                <Field label={t("category")}>
                  <Select
                    value={draft.category_key}
                    onValueChange={(v) => patchDraft("category_key", v ?? "")}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("documentKind")}>
                  <Select
                    value={draft.document_kind}
                    onValueChange={(v) =>
                      patchDraft("document_kind", v as EsignDocumentKind)
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {t(`kinds.${k}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("defaultLanguage")} icon={Languages}>
                  <div className="flex gap-1.5" role="radiogroup">
                    {(["en", "ar"] as EsignLocale[]).map((code) => (
                      <SegmentOption
                        key={code}
                        selected={previewLocale === code}
                        onClick={() => {
                          setPreviewLocale(code);
                          patchDraft("default_language", code);
                        }}
                      >
                        {code === "en" ? t("langEn") : t("langAr")}
                      </SegmentOption>
                    ))}
                  </div>
                </Field>
                <Field label={t("status")}>
                  <div className="flex gap-1.5" role="radiogroup">
                    <SegmentOption
                      variant="success"
                      selected={draft.is_active && !draft.is_draft}
                      onClick={() => {
                        patchDraft("is_active", true);
                        patchDraft("is_draft", false);
                      }}
                    >
                      {t("statusActive")}
                    </SegmentOption>
                    <SegmentOption
                      selected={draft.is_draft}
                      onClick={() => {
                        patchDraft("is_draft", true);
                        patchDraft("is_active", false);
                      }}
                    >
                      {t("statusDraft")}
                    </SegmentOption>
                    <SegmentOption
                      selected={!draft.is_active && !draft.is_draft}
                      onClick={() => {
                        patchDraft("is_active", false);
                        patchDraft("is_draft", false);
                      }}
                    >
                      {t("statusInactive")}
                    </SegmentOption>
                  </div>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("bodyEn")}>
                  <Textarea
                    className="min-h-16 text-xs"
                    value={draft.body_en}
                    onChange={(e) => patchDraft("body_en", e.target.value)}
                  />
                </Field>
                <Field label={t("declarationEn")}>
                  <Textarea
                    className="min-h-16 text-xs"
                    value={draft.declaration_en}
                    onChange={(e) => patchDraft("declaration_en", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {t("fieldsTitle", { count: visibleFields.length })}
                {/* The reference's action bar states the required count beside
                    the total, and it is worth stating: "8 fields" does not tell
                    an author how many of them the rider must fill in, and that
                    is the number that decides whether a bulk sheet needs a
                    column left empty. Hidden at zero rather than printing
                    "0 required". */}
                {visibleFields.some((f) => f.is_required) ? (
                  <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {t("requiredCount", {
                      count: visibleFields.filter((f) => f.is_required).length,
                    })}
                  </span>
                ) : null}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={addField}>
                <Plus className="size-3.5" aria-hidden />
                {t("addField")}
              </Button>
            </CardHeader>
            {/* Section tabs, as the reference draws them: the list is split into
                the employee block and the document block, with a live count on
                each so an empty tab is visibly empty rather than a dead end. */}
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 pb-3">
              {(["employee", "document"] as const).map((tabSection) => (
                <ToggleChip
                  key={tabSection}
                  icon={tabSection === "employee" ? UserRound : FileText}
                  selected={section === tabSection}
                  onClick={() => setSection(tabSection)}
                >
                  {t(`sections.${tabSection}`)}
                  <span className="ms-1 opacity-70">{sectionCounts[tabSection]}</span>
                </ToggleChip>
              ))}
            </div>
            <CardContent className="divide-y divide-border p-0">
              {/* The system rows of the employee block, drawn as list rows with
                  their own `From the system` badge — the reference puts the badge
                  on every field row, and these are the rows a reader of the
                  design expects to find in this tab. They are the document's
                  skeleton, not the template's fields: they cannot be reordered,
                  renamed or removed, so they carry no controls and are not
                  counted in the field total. */}
              {section === "employee" ? (
                <div className="bg-muted/20 px-4 py-2">
                  <p className="text-[11px] font-semibold">{t("systemRowsTitle")}</p>
                  <p className="text-[10px] text-muted-foreground">{t("systemRowsHint")}</p>
                </div>
              ) : null}
              {section === "employee"
                ? ESIGN_EMPLOYEE_ROWS.map((row) => (
                    <div
                      key={`system-${row.key}`}
                      className="flex items-center gap-2 bg-muted/10 px-4 py-2"
                    >
                      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-xs font-medium">
                          {employeeRowLabel(row, previewLocale)}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {`{{${row.key}}}`}
                        </span>
                      </div>
                      <FieldSourceBadge source="system" className="shrink-0" />
                    </div>
                  ))
                : null}
              {tabFields.length === 0 && section !== "employee" ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {t("noFields")}
                </p>
              ) : null}
              {tabFields.length === 0 && section === "employee" ? (
                <p className="px-4 py-4 text-center text-[11px] text-muted-foreground">
                  {t("noEmployeeFieldsHint")}
                </p>
              ) : null}
              {tabFields.map((field, index) => {
                const source = resolveFieldSource(field);
                const isSelected = field.id === selectedId;
                return (
                  <div
                    key={field.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(field.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(field.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-4 py-2",
                        isSelected && "bg-muted/50",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-xs font-medium">
                            {field.label_en || t("untitledField")}
                          </span>
                          {field.is_required ? (
                            <span className="shrink-0 text-[10px] font-semibold text-destructive">
                              {t("required")}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t(`types.${field.field_type}`)}
                          </span>
                        </div>
                      </div>
                      {/* The source badge sits on the trailing edge of the row,
                          which is where the reference puts it. It is the one
                          thing an author reads on every row — whether they have
                          to supply this value or the system already has it — so
                          it gets the edge rather than a chip inside the
                          description line. */}
                      <FieldSourceBadge source={source} className="shrink-0" />
                      <div className="flex shrink-0 items-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          disabled={index === 0}
                          aria-label={t("moveUp")}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(field.id, -1);
                          }}
                        >
                          <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          disabled={index === tabFields.length - 1}
                          aria-label={t("moveDown")}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(field.id, 1);
                          }}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:bg-destructive/10"
                          aria-label={t("removeField")}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeField(field.id);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  );
              })}
            </CardContent>
          </Card>

          {selected ? (
            <Card className="rounded-xl border-border shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
                <CardTitle className="text-sm">{t("fieldInspector")}</CardTitle>
                <FieldSourceBadge source={resolveFieldSource(selected)} />
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("fieldLabelEn")} required>
                    <Input
                      className="h-9"
                      value={selected.label_en}
                      onChange={(e) =>
                        patchField(selected.id, { label_en: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("fieldLabelAr")}>
                    <Input
                      className="h-9"
                      dir="rtl"
                      value={selected.label_ar ?? ""}
                      onChange={(e) =>
                        patchField(selected.id, { label_ar: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("fieldKey")} required>
                    <Input
                      className="h-9 font-mono text-xs"
                      value={selected.field_key}
                      onChange={(e) =>
                        patchField(selected.id, {
                          field_key: e.target.value.trim().toLowerCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label={t("fieldType")}>
                    <Select
                      value={selected.field_type}
                      onValueChange={(v) =>
                        patchField(selected.id, {
                          field_type: v as EsignTemplateFieldType,
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ESIGN_FIELD_TYPE_ORDER.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`types.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label={t("fieldSource")}>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup">
                    {ESIGN_FIELD_SOURCE_ORDER.map((source) => (
                      <button
                        key={source}
                        type="button"
                        role="radio"
                        aria-checked={resolveFieldSource(selected) === source}
                        onClick={() => patchField(selected.id, { source_kind: source })}
                        className="cursor-pointer rounded-md transition-[transform] duration-100 active:scale-[0.98]"
                      >
                        <FieldSourceBadge
                          source={source}
                          className={cn(
                            resolveFieldSource(selected) === source &&
                              "ring-1 ring-emerald-400/60",
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t("fieldSection")}>
                  <div className="flex gap-1.5" role="radiogroup">
                    {(["employee", "document"] as const).map((nextSection) => (
                      <SegmentOption
                        key={nextSection}
                        selected={selected.section_key === nextSection}
                        onClick={() => {
                          patchField(selected.id, { section_key: nextSection });
                          // Follow the row to its new tab, or moving a field
                          // between sections would make it vanish from the list
                          // the author is looking at.
                          setSection(nextSection);
                        }}
                      >
                        {t(`sections.${nextSection}`)}
                      </SegmentOption>
                    ))}
                  </div>
                </Field>

                {/* A fixed row carries exactly one string — the text the sheet
                    prints — so it gets one input. It used to share the
                    comma-separated options field, which meant a fixed value
                    containing a comma ("Fined 10%, per policy") was silently
                    stored as two options and the document printed only the
                    first. A single value cannot be split wrongly. */}
                {resolveFieldSource(selected) === "fixed" ? (
                  <Field label={t("fixedValue")}>
                    <Input
                      className="h-9 text-xs"
                      value={selected.options[0] ?? ""}
                      onChange={(e) =>
                        patchField(selected.id, {
                          options: e.target.value.trim() ? [e.target.value] : [],
                        })
                      }
                    />
                  </Field>
                ) : null}

                {/* The choose-one option list, drawn the way the reference draws
                    it: one row per option with a radio marker, not a comma-
                    separated sentence in a text box. The marker is the point —
                    it states that the rider picks *one*, and it makes an empty
                    option row visible as an empty option row rather than as a
                    stray comma. Blank rows are allowed while typing and dropped
                    on save, so a half-typed option does not block the write. */}
                {selected.field_type === "select" &&
                resolveFieldSource(selected) !== "fixed" ? (
                  <Field label={t("options")}>
                    <div className="space-y-1.5">
                      {selected.options.map((option, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-3.5 shrink-0 rounded-full border border-neutral-400"
                          />
                          <Input
                            className="h-9 text-xs"
                            placeholder={t("optionPlaceholder")}
                            value={option}
                            onChange={(e) => {
                              const next = [...selected.options];
                              next[index] = e.target.value;
                              patchField(selected.id, { options: next });
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                            aria-label={t("removeOption")}
                            onClick={() =>
                              patchField(selected.id, {
                                options: selected.options.filter(
                                  (_, i) => i !== index,
                                ),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            patchField(selected.id, {
                              options: [...selected.options, ""],
                            })
                          }
                        >
                          <Plus className="size-3.5" aria-hidden />
                          {t("addOption")}
                        </Button>
                        <span className="text-[10px] text-muted-foreground">
                          {t("optionsHint")}
                        </span>
                      </div>
                    </div>
                  </Field>
                ) : null}

                {resolveFieldSource(selected) !== "fixed" ? (
                  <Field label={t("previewValue")}>
                    <Input
                      className="h-9 text-xs"
                      placeholder={t("previewValuePlaceholder")}
                      value={values[selected.field_key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [selected.field_key]: e.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : null}

                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer accent-emerald-600"
                    checked={selected.is_required}
                    onChange={(e) =>
                      patchField(selected.id, { is_required: e.target.checked })
                    }
                  />
                  {t("requiredField")}
                </label>

                {pairError ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                    {t(`errors.${pairError}`)}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* ---------------------------------------------------------------
            End pane — the A4 document, live.
            --------------------------------------------------------------- */}
        <Card className="rounded-xl border-border shadow-sm lg:sticky lg:top-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSignature className="size-3.5 text-primary" aria-hidden />
              {t("previewTitle")}
            </CardTitle>
            <div className="flex gap-1.5" role="radiogroup">
              {(["en", "ar"] as EsignLocale[]).map((code) => (
                <SegmentOption
                  key={code}
                  selected={previewLocale === code}
                  onClick={() => setPreviewLocale(code)}
                >
                  {code === "en" ? t("langEn") : t("langAr")}
                </SegmentOption>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="rounded-md bg-muted/40 p-3">
              <EsignDocumentPreview
                templateName={draft.name_en}
                nameAr={draft.name_ar}
                company={t("previewCompany")}
                body={previewLocale === "ar" ? draft.body_ar : draft.body_en}
                declaration={
                  previewLocale === "ar" ? draft.declaration_ar : draft.declaration_en
                }
                fields={visibleFields}
                values={values}
                locale={previewLocale}
                documentKind={draft.document_kind}
                signers={{
                  employeeLabel: t("previewEmployeeSignature"),
                  staffLabel: t("previewStaffSignature"),
                }}
              />
            </div>
            <Separator className="my-3" />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t("previewHint")}
            </p>
            {/* The reference puts "Send for e-signature" under the preview rather
                than in the page header, because the button acts on *this*
                document — the one the author can see.
                The reference's second entry here is "Use for one employee",
                which in this app is the same destination as the button beside
                it: sending is one rider plus one template either way, so
                `?template=` is what a single-employee send looks like. Two
                adjacent actions that do the same thing is exactly what the
                action rulebook forbids, and the batch path already has its own
                entry above — "Import a sheet" — so the pair is one primary plus
                the sheet route, not one primary and a duplicate. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={isNew}
                onClick={() =>
                  router.push(`/employeedesk/esign/send?template=${template.id}`)
                }
              >
                <Send className="size-3.5" aria-hidden />
                {t("sendForSignature")}
              </Button>
            </div>
            {isNew ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("saveBeforeSending")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}

function Field({
  label,
  required,
  icon: Icon,
  children,
}: {
  label: string;
  required?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
