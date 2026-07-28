"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { interpolateTemplate } from "./interpolate-template";
import { previewNotificationImport } from "./notifications-actions";
import type { NotificationImportRow, NotificationImportSpec } from "./types";

type Props = {
  titleTemplate: string;
  bodyTemplate: string;
  importSpec: NotificationImportSpec | null;
  onImportSpecChange: (spec: NotificationImportSpec | null) => void;
  onPreviewRowChange?: (index: number) => void;
  onImportPreviewStatsChange?: (stats: { okCount: number; totalCount: number } | null) => void;
};

function summarizeImportPreview(
  preview: Array<{ status: string }>,
): { okCount: number; totalCount: number } {
  return {
    okCount: preview.filter((row) => row.status === "ok").length,
    totalCount: preview.length,
  };
}

function importStatusPill(status: string, t: ReturnType<typeof useTranslations>) {
  switch (status) {
    case "ok":
      return <StatusPill variant="success">{t("importStatusOk")}</StatusPill>;
    case "blocked":
      return <StatusPill variant="danger">{t("importStatusBlocked")}</StatusPill>;
    case "duplicate":
      return <StatusPill variant="warning">{t("importStatusDuplicate")}</StatusPill>;
    default:
      return <StatusPill variant="warning">{t("importStatusUnknown")}</StatusPill>;
  }
}

export function NotificationImportPanel({
  titleTemplate,
  bodyTemplate,
  importSpec,
  onImportSpecChange,
  onPreviewRowChange,
  onImportPreviewStatsChange,
}: Props) {
  const t = useTranslations("pages.notifications");
  const [pending, startTransition] = useTransition();
  const [previewRows, setPreviewRows] = useState<
    Array<{
      row_index: number;
      employee_id: string;
      driver_name: string | null;
      status: string;
      resolved_title: string;
      resolved_body: string;
    }>
  >([]);
  const [selectedPreview, setSelectedPreview] = useState(0);

  const variableColumns = useMemo(() => {
    const cols = new Set<string>(importSpec?.variable_columns ?? []);
    if (importSpec?.column_mapping?.employee_id) cols.add("employee_id");
    return [...cols];
  }, [importSpec]);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    const employeeHeader =
      parsed.headers.find((h) => /employee\s*id/i.test(h)) ?? parsed.headers[0] ?? "";
    const mapping: NotificationImportSpec["column_mapping"] = {
      employee_id: employeeHeader,
    };
    const variable_columns = parsed.headers.filter((h) => h !== employeeHeader);
    const rows: NotificationImportRow[] = parsed.rows.map((cells) => {
      const row: NotificationImportRow = {};
      parsed.headers.forEach((header, idx) => {
        const key = header === employeeHeader ? "employee_id" : header.replace(/\s+/g, "_").toLowerCase();
        row[key] = cells[idx] ?? "";
      });
      return row;
    });
    const spec: NotificationImportSpec = { column_mapping: mapping, variable_columns, rows };
    onImportSpecChange(spec);
    onImportPreviewStatsChange?.(null);
    startTransition(async () => {
      try {
        const preview = await previewNotificationImport({
          titleTemplate,
          bodyTemplate,
          importSpec: spec,
        });
        setPreviewRows(preview);
        setSelectedPreview(0);
        onPreviewRowChange?.(0);
        onImportPreviewStatsChange?.(summarizeImportPreview(preview));
      } catch {
        onImportPreviewStatsChange?.({ okCount: 0, totalCount: rows.length });
        toast.error(t("importPreviewFailed"));
      }
    });
  };

  const refreshPreview = () => {
    if (!importSpec) return;
    startTransition(async () => {
      try {
        const preview = await previewNotificationImport({
          titleTemplate,
          bodyTemplate,
          importSpec,
        });
        setPreviewRows(preview);
        onImportPreviewStatsChange?.(summarizeImportPreview(preview));
      } catch {
        onImportPreviewStatsChange?.(
          importSpec ? { okCount: 0, totalCount: importSpec.rows.length } : null,
        );
        toast.error(t("importPreviewFailed"));
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="sr-only">{t("importUpload")}</Label>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs hover:bg-accent">
          <Upload className="size-4" />
          {t("importUpload")}
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        <a
          href="/templates/notification-import-template.csv"
          download
          className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent"
        >
          <Download className="size-4" />
          {t("importDownloadTemplate")}
        </a>
        {importSpec ? (
          <Button variant="outline" size="sm" className="h-9 cursor-pointer" onClick={refreshPreview} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("importRefreshPreview")}
          </Button>
        ) : null}
      </div>
      {importSpec ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t("importRowCount", { count: importSpec.rows.length })}
          </p>
          {variableColumns.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {variableColumns.map((col) => (
                <button
                  key={col}
                  type="button"
                  className="cursor-pointer rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                  onClick={() => {
                    navigator.clipboard.writeText(`{{${col}}}`);
                    toast.success(t("placeholderCopied", { name: col }));
                  }}
                >
                  {`{{${col}}}`}
                </button>
              ))}
            </div>
          ) : null}
          {previewRows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">{t("importPreviewAs")}</Label>
                <Select
                  value={String(selectedPreview)}
                  onValueChange={(v) => {
                    const idx = Number(v);
                    setSelectedPreview(idx);
                    onPreviewRowChange?.(idx);
                  }}
                >
                  <SelectTrigger className="h-9 w-auto min-w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {previewRows.map((row) => (
                      <SelectItem key={row.row_index} value={String(row.row_index)}>
                        {row.employee_id} · {row.driver_name ?? row.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("fieldTitle")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("fieldBody")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.slice(0, 50).map((row) => (
                      <TableRow key={row.row_index}>
                        <TableCell>{row.row_index + 1}</TableCell>
                        <TableCell>{row.employee_id}</TableCell>
                        <TableCell>{row.driver_name ?? "—"}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{row.resolved_title}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{row.resolved_body}</TableCell>
                        <TableCell>{importStatusPill(row.status, t)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {previewRows.length > 50 ? (
                <p className="text-[10px] text-muted-foreground">{t("importPreviewTruncated")}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("importHint")}</p>
      )}
    </div>
  );
}

export function resolveImportPreviewText(
  template: string,
  row: NotificationImportRow,
): string {
  return interpolateTemplate(template, row);
}
