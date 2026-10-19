"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Building2, FileSpreadsheet, Plus, Send } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { LAYOUT } from "@/components/app/layout-spacing";
import {
  employeeRowLabel,
  employeeSampleValues,
  ESIGN_EMPLOYEE_ROWS,
} from "@/features/esign/employee-block";
import { buildEsignExampleSheet } from "@/features/esign/esign-example-sheet";
import { previewStaffLabel } from "@/features/esign/esign-signers";
import { ensureOutgoingHubDrafts } from "@/features/esign/esign-sender-actions";
import { isSendableHubTemplate } from "@/features/esign/outgoing-hub-categories";
import { queryKeys } from "@/lib/query/query-keys";
import { useEsignTemplate, useEsignTemplates } from "@/features/esign/use-esign";
import type { EsignTemplateDetail, EsignTemplateRow } from "@/features/esign/types";
import { EsignDocumentPreview } from "./document-preview";

/** Chip order on the library pane — the same facts the create screen fills. */
const SYSTEM_CHIP_KEYS = [
  "company_name",
  "employee_name",
  "position",
  "civil_id",
  "sponsor",
  "pay_through",
  "bank_number",
  "employee_id",
] as const;

function bulkSubtitleKey(
  mode: EsignTemplateRow["bulk_mode"],
): "bulkSignAndReturn" | "bulkImport" | "bulkFallback" {
  switch (mode) {
    case "sign_and_return":
      return "bulkSignAndReturn";
    case "import":
      return "bulkImport";
    case null:
    case undefined:
      return "bulkFallback";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function fileDisplayName(name: string): string {
  const trimmed = name.trim();
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  return `${trimmed}.docx`;
}

function previewValuesFor(detail: EsignTemplateDetail | undefined) {
  const values = { ...employeeSampleValues() };
  if (!detail) return values;
  for (const field of detail.fields) {
    const sample = field.preview_value?.trim();
    if (sample) values[field.field_key] = sample;
  }
  return values;
}

function downloadExampleCsv(detail: EsignTemplateDetail, filename: string) {
  const sheet = buildEsignExampleSheet(detail.fields);
  const blob = new Blob([sheet.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TemplatesShell() {
  const t = useTranslations("pages.employeedesk.esign.templates");
  const tBuilder = useTranslations("pages.employeedesk.esign.templateBuilder");
  const tCommon = useTranslations("common");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useEsignTemplates();
  const [tab, setTab] = useState<"library" | "draft">("library");
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(
    () =>
      allRows.filter((row) =>
        tab === "library" ? isSendableHubTemplate(row) : !isSendableHubTemplate(row),
      ),
    [allRows, tab],
  );
  const loadFailed = isError || Boolean(data?.error);

  const [pickedId, setPickedId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ensureOutgoingHubDrafts().then((result) => {
      if (cancelled || result.error || (result.updated ?? 0) === 0) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.esign.templates() });
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const selectedId = rows.some((row) => row.id === pickedId)
    ? pickedId
    : (rows[0]?.id ?? "");
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const { data: loaded, isLoading: detailLoading } = useEsignTemplate(selectedId);
  const detail = loaded?.template ?? undefined;
  const previewValues = useMemo(() => previewValuesFor(detail), [detail]);

  const createHref = selected
    ? `/employeedesk/esign/templates/new?template=${selected.id}`
    : "";
  const bulkHref = selected ? `/employeedesk/esign/bulk?template=${selected.id}` : "";
  const editHref = selected ? `/employeedesk/esign/templates/${selected.id}/edit` : "";
  const exampleSheet = useMemo(
    () => (detail ? buildEsignExampleSheet(detail.fields) : null),
    [detail],
  );
  const systemChipLabels = SYSTEM_CHIP_KEYS.map((key) => {
    const row = ESIGN_EMPLOYEE_ROWS.find((item) => item.key === key);
    return row ? employeeRowLabel(row, locale) : key;
  });
  const signatureChips = (detail?.fields ?? [])
    .filter((field) => field.source_kind === "signature")
    .map((field) => field.label_en);
  const signedLabels = [t("signerEmployee"), t("signerAuthorized")];
  for (const label of signatureChips) {
    const lower = label.toLowerCase();
    if (lower.includes("employee") || lower.includes("authori")) continue;
    if (!signedLabels.includes(label)) signedLabels.push(label);
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("breadcrumbRcm"), href: "/employeedesk" },
          { label: t("title") },
        ]}
        actions={
          <Button
            className="h-9 bg-[#0A0A0A] text-white hover:bg-[#262626]"
            render={<Link href="/employeedesk/esign/templates/new/builder" />}
          >
            <Plus className="size-4" />
            {t("newTemplateAction")}
          </Button>
        }
      />

      <div className={`grid min-h-0 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] ${LAYOUT.panelGap}`}>
        <AppListCard className="h-full min-h-0 p-2">
          <div className="mb-2 flex flex-wrap gap-1.5 px-1 pt-1">
            <ToggleChip selected={tab === "library"} onClick={() => setTab("library")}>
              {t("tabLibrary")}
            </ToggleChip>
            <ToggleChip selected={tab === "draft"} onClick={() => setTab("draft")}>
              {t("tabDraft")}
            </ToggleChip>
          </div>
          {loadFailed ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">{t("loadFailed")}</p>
          ) : isLoading ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">{t("emptyTitle")}</p>
          ) : (
            <ul className="min-h-0 space-y-0.5 overflow-y-auto">
              {rows.map((row) => {
                const active = row.id === selectedId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setPickedId(row.id)}
                      className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-start ${
                        active
                          ? "border border-[#F04438] bg-[#FEF3F2]"
                          : "border border-transparent hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-sm font-semibold text-foreground">{row.name_en}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(bulkSubtitleKey(row.bulk_mode))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </AppListCard>

        <AppListCard className="h-full min-h-0 px-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
          ) : (
            <div className={`${LAYOUT.stackGap} flex flex-col`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold">{selected.name_en}</h2>
                <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  {t(bulkSubtitleKey(selected.bulk_mode))}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("basedOnFile", { name: fileDisplayName(selected.name_en) })}
                {" · "}
                <button
                  type="button"
                  className="font-semibold text-[#EA580C] hover:underline"
                  onClick={() => setPreviewOpen(true)}
                  disabled={detailLoading || !detail}
                >
                  {t("open")}
                </button>
              </p>

              <div className="space-y-1.5">
                <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                  <Building2 className="size-3" aria-hidden />
                  {t("chips.filledFromSystem")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {systemChipLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C2410C]">
                  {t("youAddExample")}
                </p>
                {exampleSheet ? (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/40">
                        <tr>
                          {exampleSheet.headers.map((header) => (
                            <th
                              key={header}
                              className="px-2 py-1.5 text-start font-semibold text-muted-foreground"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {exampleSheet.sampleRow.map((cell, index) => (
                            <td key={`${exampleSheet.headers[index] ?? index}`} className="px-2 py-1.5">
                              {cell || "—"}
                            </td>
                          ))}
                        </tr>
                        <tr className="text-muted-foreground">
                          {exampleSheet.headers.map((header) => (
                            <td key={`ellipsis-${header}`} className="px-2 py-1.5">
                              …
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{tCommon("loading")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                  {t("signedOrDecidedBy")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {signedLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-800"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {detail?.document_kind === "payslip" ? t("libraryNotePayslip") : t("libraryNote")}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="h-9 bg-[#0A0A0A] text-white hover:bg-[#262626]"
                  render={<Link href={bulkHref} />}
                >
                  <FileSpreadsheet className="size-4" />
                  {tBuilder("importSheet")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!detail}
                  onClick={() => {
                    if (!detail) return;
                    downloadExampleCsv(
                      detail,
                      `${selected.name_en || "template"}-example.csv`,
                    );
                  }}
                >
                  {tBuilder("downloadExampleSheet")}
                </Button>
                <Button variant="outline" className="h-9" render={<Link href={createHref} />}>
                  <Send className="size-4" />
                  {tBuilder("useForOneEmployee")}
                </Button>
                <Link
                  href={editHref}
                  className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("editTemplateAdmin")}
                </Link>
              </div>
            </div>
          )}
        </AppListCard>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="w-[min(1200px,96vw)] max-w-none"
          showCloseButton
        >
          <DialogHeader className="border-b border-border px-5 py-3 pe-12">
            <DialogTitle>{selected?.name_en ?? t("open")}</DialogTitle>
            {selected?.name_ar ? (
              <DialogDescription dir="rtl">{selected.name_ar}</DialogDescription>
            ) : (
              <DialogDescription>{t("open")}</DialogDescription>
            )}
          </DialogHeader>
          <div className="relative h-[min(70vh,640px)] overflow-hidden px-5 py-4">
            {detail ? (
              <div className="relative h-full w-full">
                <EsignDocumentPreview
                  templateName={detail.name_en}
                  nameAr={detail.name_ar}
                  company={tBuilder("previewCompany")}
                  body={detail.body_en}
                  bodyAr={detail.body_ar}
                  declaration={detail.declaration_en}
                  declarationAr={detail.declaration_ar}
                  fields={detail.fields}
                  values={previewValues}
                  documentKind={detail.document_kind}
                  fill
                  signers={{
                    employeeLabel: tBuilder("previewEmployeeSignature"),
                    staffLabel: previewStaffLabel([], "", tBuilder("previewStaffSignature")),
                  }}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setPreviewOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            {selected ? (
              <Button className="h-9" render={<Link href={createHref} />}>
                <Send className="size-4" />
                {tBuilder("useForOneEmployee")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
