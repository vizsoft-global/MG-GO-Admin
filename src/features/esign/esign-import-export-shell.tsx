"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Info, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import type { RequestDatePreset, RequestListRow } from "@/features/requests/types";
import { fetchEsignRequestsList } from "./esign-actions";

const DATE_PRESETS: RequestDatePreset[] = [
  "all",
  "today",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
];

const STATUSES = [
  "all",
  "pending",
  "submitted",
  "in_review",
  "needs_clarification",
  "approved",
  "rejected",
  "solved",
] as const;

type StatusOption = (typeof STATUSES)[number];

type ColumnId =
  | "request_code"
  | "driver_name"
  | "driver_zone"
  | "request_type"
  | "department_label"
  | "status"
  | "current_step_label"
  | "created_at";

const COLUMNS: { id: ColumnId; key: string }[] = [
  { id: "request_code", key: "requestId" },
  { id: "driver_name", key: "riderName" },
  { id: "driver_zone", key: "riderZone" },
  { id: "request_type", key: "type" },
  { id: "department_label", key: "department" },
  { id: "status", key: "status" },
  { id: "current_step_label", key: "currentStep" },
  { id: "created_at", key: "createdDate" },
];

/** Figma lists these columns; neither has schema backing on `requests` yet. */
const UNAVAILABLE_COLUMNS = ["remarks", "internalNotes"] as const;

const TOTAL_COLUMNS = COLUMNS.length + UNAVAILABLE_COLUMNS.length;

function cellValue(row: RequestListRow, column: ColumnId): string {
  const value = row[column];
  return value == null ? "" : String(value);
}

export function EsignImportExportShell() {
  const t = useTranslations("pages.requests.esign.importExport");
  const tRequests = useTranslations("pages.requests");
  const [preset, setPreset] = useState<"current" | "all">("current");
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");
  const [status, setStatus] = useState<StatusOption>("pending");
  const [selected, setSelected] = useState<ColumnId[]>(COLUMNS.map((c) => c.id));
  const [exportingEsign, setExportingEsign] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const effectiveDatePreset: RequestDatePreset = preset === "all" ? "all" : datePreset;
  const effectiveStatus: StatusOption = preset === "all" ? "all" : status;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.requests.list({
      export: true,
      datePreset: effectiveDatePreset,
      status: effectiveStatus,
    }),
    queryFn: () =>
      fetchAdminRequestsList({
        datePreset: effectiveDatePreset,
        status: effectiveStatus === "all" ? null : effectiveStatus,
        limit: 1000,
        offset: 0,
      }),
  });

  const rows = data?.rows ?? [];
  const activeColumns = useMemo(
    () => COLUMNS.filter((column) => selected.includes(column.id)),
    [selected],
  );

  const approxKb = useMemo(() => {
    if (rows.length === 0 || activeColumns.length === 0) return 0;
    return Math.max(1, Math.round((rows.length * activeColumns.length * 12) / 1024));
  }, [rows.length, activeColumns.length]);

  const exportDisabled = isLoading || rows.length === 0 || activeColumns.length === 0;

  function toggleColumn(id: ColumnId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function exportRequestsCsv() {
    if (exportDisabled) return;
    const csv = buildCsv(
      activeColumns.map((column) => t(`columns.${column.key}`)),
      rows.map((row) => activeColumns.map((column) => cellValue(row, column.id))),
    );
    downloadCsv(
      `rcm-requests-${effectiveDatePreset}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
    toast.success(t("exportOk", { count: rows.length }));
  }

  async function exportRequestsExcel() {
    if (exportDisabled) return;
    setExportingExcel(true);
    try {
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet([
        activeColumns.map((column) => t(`columns.${column.key}`)),
        ...rows.map((row) => activeColumns.map((column) => cellValue(row, column.id))),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Requests");
      XLSX.writeFile(
        book,
        `rcm-requests-${effectiveDatePreset}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(t("exportOk", { count: rows.length }));
    } finally {
      setExportingExcel(false);
    }
  }

  async function exportEsignCsv() {
    setExportingEsign(true);
    const result = await fetchEsignRequestsList({ limit: 500 });
    setExportingEsign(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.rows.length === 0) {
      toast.error(t("exportEmpty"));
      return;
    }
    const csv = buildCsv(
      [
        "request_code",
        "title",
        "driver_name",
        "driver_code",
        "category",
        "status",
        "due_at",
        "signed_at",
        "created_at",
      ],
      result.rows.map((r) => [
        r.request_code,
        r.title,
        r.driver_name,
        r.driver_code,
        r.category_label ?? "",
        r.status,
        r.due_at ?? "",
        r.signed_at ?? "",
        r.created_at,
      ]),
    );
    downloadCsv(`esign-requests-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(t("exportOk", { count: result.rows.length }));
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("requests"), href: "/requests" },
          { label: t("settings"), href: "/requests/settings" },
          { label: t("breadcrumb") },
        ]}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={exportingEsign}
            onClick={() => void exportEsignCsv()}
          >
            {exportingEsign ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="me-1.5 h-3.5 w-3.5" />
            )}
            {t("exportEsignButton")}
          </Button>
        }
      />

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <AppListCard className="h-full space-y-3 p-4 lg:col-span-2">
          <div>
            <p className="text-sm font-semibold">{t("filtersTitle")}</p>
            <p className="text-[11px] text-muted-foreground">{t("filtersBody")}</p>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              {t("filterPreset")}
            </Label>
            <Select
              value={preset}
              onValueChange={(v) => v && setPreset(v as "current" | "all")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">{t("presetCurrentView")}</SelectItem>
                <SelectItem value="all">{t("presetAll")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">
                {t("dateRange")}
              </Label>
              <Select
                value={effectiveDatePreset}
                disabled={preset === "all"}
                onValueChange={(v) => v && setDatePreset(v as RequestDatePreset)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {tRequests(`datePresets.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">
                {t("statusLabel")}
              </Label>
              <Select
                value={effectiveStatus}
                disabled={preset === "all"}
                onValueChange={(v) => v && setStatus(v as StatusOption)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all"
                        ? t("statusAll")
                        : tRequests(`status.${option}` as "status.pending")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {isLoading ? t("matchLoading") : t("matchCount", { count: rows.length })}
          </div>
        </AppListCard>

        <AppListCard className="flex h-full flex-col gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">{t("columnsTitle")}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("columnsSelected", {
                selected: activeColumns.length,
                total: TOTAL_COLUMNS,
              })}
            </p>
          </div>

          <div className="space-y-1.5">
            {COLUMNS.map((column) => (
              <label
                key={column.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={selected.includes(column.id)}
                  onCheckedChange={() => toggleColumn(column.id)}
                />
                {t(`columns.${column.key}`)}
              </label>
            ))}
            {UNAVAILABLE_COLUMNS.map((key) => (
              <label
                key={key}
                className="flex items-center gap-2 text-sm text-muted-foreground/60"
                title={t("columnUnavailable")}
              >
                <Checkbox checked={false} disabled />
                {t(`columns.${key}`)}
              </label>
            ))}
          </div>

          <div className="mt-auto space-y-2 border-t border-border pt-3">
            <p className="text-[10px] text-muted-foreground">
              {t("sizeHint", { kb: approxKb })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled
                title={t("pdfUnavailable")}
              >
                <Download className="me-1.5 h-3.5 w-3.5" />
                {t("exportPdf")}
              </Button>
              <Button
                type="button"
                className="h-9"
                disabled={exportDisabled}
                onClick={exportRequestsCsv}
              >
                <Download className="me-1.5 h-3.5 w-3.5" />
                {t("exportCsv")}
              </Button>
              <Button
                type="button"
                className="h-9"
                disabled={exportDisabled || exportingExcel}
                onClick={() => void exportRequestsExcel()}
              >
                {exportingExcel ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="me-1.5 h-3.5 w-3.5" />
                )}
                {t("exportExcel")}
              </Button>
            </div>
          </div>
        </AppListCard>
      </div>
    </AppPage>
  );
}
