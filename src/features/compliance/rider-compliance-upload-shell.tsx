"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  COMPLIANCE_MAX_ROWS,
  COMPLIANCE_TEMPLATE_HEADERS,
  kuwaitDayString,
} from "./compliance-parse";
import {
  applyRiderComplianceUpload,
  previewRiderComplianceUpload,
} from "./compliance-upload-actions";
import type { CompliancePreview, ComplianceRowStatus, ComplianceSheet } from "./types";

/** Preview renders this many rows; the rest are counted, not drawn. */
const PREVIEW_LIMIT = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function RiderComplianceUploadShell() {
  const t = useTranslations("pages.compliance");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, startApply] = useTransition();
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ComplianceSheet | null>(null);
  const [preview, setPreview] = useState<CompliancePreview | null>(null);
  const [ready, setReady] = useState(false);

  const okRows = useMemo(
    () => (preview ? preview.rows.filter((row) => row.status === "ok") : []),
    [preview],
  );
  const rejectedRows = useMemo(
    () => (preview ? preview.rows.filter((row) => row.status !== "ok") : []),
    [preview],
  );

  const downloadTemplate = () => {
    const rows = [
      COMPLIANCE_TEMPLATE_HEADERS.join(","),
      `40028,10955,${kuwaitDayString()},0,0,0`,
    ].join("\n");
    const blob = new Blob([`${rows}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rider-compliance-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportRejected = () => {
    const header = `${COMPLIANCE_TEMPLATE_HEADERS.join(",")},status`;
    const body = rejectedRows
      .map((row) =>
        [
          row.employee_id,
          row.driver_code,
          row.day,
          row.invalid_days,
          row.rejected_orders,
          row.cancelled_orders,
          row.status,
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rider-compliance-rejected.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setSheet(null);
    setPreview(null);
    setReady(false);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPicked = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("fileTooLarge"));
      return;
    }
    startTransition(async () => {
      try {
        const parsedFile = await parseSpreadsheetFile(file);
        if (parsedFile.rows.length === 0) {
          toast.error(t("parseFailed"));
          reset();
          return;
        }
        const fileSheet: ComplianceSheet = {
          headers: parsedFile.headers,
          rows: parsedFile.rows,
        };
        setFileName(file.name);
        setSheet(fileSheet);
        setPreview(null);
        setReady(false);

        const result = await previewRiderComplianceUpload({ sheet: fileSheet });
        if ("error" in result) {
          toast.error(result.error === "lookup_failed" ? t("lookupFailed") : t("notAuthorized"));
          return;
        }
        setPreview(result.preview);
        setReady(true);
      } catch {
        toast.error(t("parseFailed"));
      }
    });
  };

  const statusPill = (status: ComplianceRowStatus) => {
    switch (status) {
      case "ok":
        return <StatusPill variant="success">{t("statusOk")}</StatusPill>;
      case "ambiguous":
        return <StatusPill variant="warning">{t("statusAmbiguous")}</StatusPill>;
      case "duplicate":
        return <StatusPill variant="warning">{t("statusDuplicate")}</StatusPill>;
      case "invalid_day":
        return <StatusPill variant="danger">{t("statusInvalidDay")}</StatusPill>;
      case "invalid_number":
        return <StatusPill variant="danger">{t("statusInvalidNumber")}</StatusPill>;
      case "unknown_id":
        return <StatusPill variant="danger">{t("statusUnknownId")}</StatusPill>;
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  const busy = pending || applying;
  const summary = preview?.statusCounts;
  const issues = preview?.issues;
  const blocked = (issues?.missingRequiredColumns.length ?? 0) > 0;

  const onApply = () => {
    if (!sheet || !preview || blocked || okRows.length === 0) return;
    startApply(async () => {
      const result = await applyRiderComplianceUpload({ locale, fileName, sheet });
      if ("error" in result) {
        if (result.error === "partial_write") {
          toast.error(
            t("partialWrite", {
              rows: result.writtenRows ?? 0,
              riders: result.driverCount ?? 0,
            }),
          );
          return;
        }
        toast.error(
          result.error === "no_rows"
            ? t("noWritableRows")
            : result.error === "missing_columns"
              ? t("blockedByColumns", {
                  columns: (result.missingRequiredColumns ?? []).join(", "),
                })
              : result.error === "not_authorized"
                ? t("notAuthorized")
                : t("applyFailed"),
        );
        return;
      }
      toast.success(
        t("appliedToast", { rows: result.writtenRows, riders: result.driverCount }),
      );
      reset();
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2"
              onClick={downloadTemplate}
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </Button>
            <Button
              type="button"
              className="h-9 gap-2"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("chooseFile")}
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPicked(file);
          else reset();
        }}
      />

      <AppListCard
        toolbar={<p className="text-xs text-muted-foreground">{t("templateHint")}</p>}
      >
        {!preview ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-md text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {blocked ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {t("blockedByColumns", {
                  columns: (issues?.missingRequiredColumns ?? []).join(", "),
                })}
              </div>
            ) : null}
            {(issues?.missingOptionalColumns.length ?? 0) > 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("missingOptionalColumns", {
                  columns: (issues?.missingOptionalColumns ?? []).join(", "),
                })}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill variant="success">
                {t("countOk", { count: summary?.ok ?? 0 })}
              </StatusPill>
              {summary && summary.ambiguous > 0 ? (
                <StatusPill variant="warning">
                  {t("statusAmbiguous")} · {summary.ambiguous}
                </StatusPill>
              ) : null}
              {summary && summary.unknown_id > 0 ? (
                <StatusPill variant="danger">
                  {t("statusUnknownId")} · {summary.unknown_id}
                </StatusPill>
              ) : null}
              {summary && summary.invalid_day > 0 ? (
                <StatusPill variant="danger">
                  {t("statusInvalidDay")} · {summary.invalid_day}
                </StatusPill>
              ) : null}
              {summary && summary.invalid_number > 0 ? (
                <StatusPill variant="danger">
                  {t("statusInvalidNumber")} · {summary.invalid_number}
                </StatusPill>
              ) : null}
              {summary && summary.duplicate > 0 ? (
                <StatusPill variant="warning">
                  {t("statusDuplicate")} · {summary.duplicate}
                </StatusPill>
              ) : null}
              {rejectedRows.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={exportRejected}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("exportErrors")}
                </Button>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriverCode")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDay")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colInvalidDays")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colRejected")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colCancelled")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                    <TableRow key={row.row_index}>
                      <TableCell className="text-xs">{row.row_index + 1}</TableCell>
                      <TableCell className="text-xs">{row.employee_id || "—"}</TableCell>
                      <TableCell className="text-xs">{row.driver_code || "—"}</TableCell>
                      <TableCell className="text-xs">{row.driver_name ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.day}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.invalid_days}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.rejected_orders}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.cancelled_orders}</TableCell>
                      <TableCell>{statusPill(row.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {preview.rows.length > PREVIEW_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                {t("previewTruncated", { shown: PREVIEW_LIMIT, total: preview.rows.length })}
              </p>
            ) : null}
            {sheet && sheet.rows.length >= COMPLIANCE_MAX_ROWS ? (
              <p className="text-xs text-muted-foreground">
                {t("rowLimitReached", { max: COMPLIANCE_MAX_ROWS })}
              </p>
            ) : null}
          </div>
        )}
      </AppListCard>

      <AppModalFooter
        asPage
        title={t("applyBarTitle", { rows: okRows.length })}
        subtitle={t("applyBarSubtitle")}
        meta={fileName ? t("applyBarFile", { file: fileName }) : undefined}
      >
        <Button type="button" variant="outline" className="h-9" disabled={busy} onClick={reset}>
          {t("clear")}
        </Button>
        <Button
          type="button"
          className="h-9 gap-2"
          disabled={!ready || busy || blocked || okRows.length === 0}
          onClick={onApply}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {applying ? t("applying") : t("apply")}
        </Button>
      </AppModalFooter>
    </AppPage>
  );
}
