import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import {
  ORDER_EXCEPTION_EXPORT_MAX_ROWS,
  type OrderExceptionKind,
  type OrderExceptionRow,
  type OrderExceptionSource,
  type OrderExceptionStatus,
} from "./types";

export { ORDER_EXCEPTION_EXPORT_MAX_ROWS };

export type OrderExceptionExportLabels = {
  sheetRows: string;
  sheetSummary: string;
  /** Fourteen headers, in the same order the AOA builder emits cells. */
  columns: string[];
  kind: Record<OrderExceptionKind, string>;
  source: Record<OrderExceptionSource, string>;
  status: Record<OrderExceptionStatus, string>;
  counted: { yes: string; no: string };
  summary: {
    filters: string;
    status: string;
    kind: string;
    source: string;
    from: string;
    to: string;
    search: string;
    all: string;
    exportedRows: string;
    matchedRows: string;
    capped: string;
  };
};

export type OrderExceptionExportFilters = {
  status?: string;
  kind?: string;
  source?: string;
  from?: string;
  to?: string;
  search?: string;
};

function cell(value: string | null | undefined): string {
  return value ?? "";
}

/**
 * One row per exception, in the same order and with the same columns the panel
 * paints. Proof keys are never written — the sheet carries the count, because a
 * storage key is not something an operations spreadsheet should hold.
 */
export function buildOrderExceptionRowsAoa(
  rows: readonly OrderExceptionRow[],
  labels: OrderExceptionExportLabels,
): Array<Array<string | number>> {
  return [
    [...labels.columns],
    ...rows.map((row) => [
      cell(row.day),
      cell(row.driver_name),
      cell(row.driver_code),
      cell(row.order_id),
      labels.kind[row.kind],
      labels.source[row.source],
      cell(row.reason),
      row.proof_count,
      labels.status[row.status],
      cell(row.reviewed_by_name),
      cell(row.reviewed_at),
      cell(row.review_note),
      cell(row.created_at),
      row.counted_as_exception ? labels.counted.yes : labels.counted.no,
    ]),
  ];
}

/**
 * The second sheet exists so a filtered export says how it was filtered. A sheet
 * of 300 rows with no record of the window it covers is a number nobody can retrace.
 */
export function buildOrderExceptionSummaryAoa(input: {
  filters: OrderExceptionExportFilters;
  exportedRows: number;
  matchedRows: number;
  labels: OrderExceptionExportLabels;
}): Array<Array<string | number>> {
  const { filters, exportedRows, matchedRows, labels } = input;
  const all = labels.summary.all;
  const nameOrAll = (value: string | undefined, map: Record<string, string>) =>
    value && value !== "all" ? (map[value] ?? value) : all;

  const aoa: Array<Array<string | number>> = [
    [labels.summary.filters, ""],
    [labels.summary.status, filters.status && filters.status !== "all" ? filters.status : all],
    [labels.summary.kind, nameOrAll(filters.kind, labels.kind)],
    [labels.summary.source, nameOrAll(filters.source, labels.source)],
    [labels.summary.from, filters.from ?? ""],
    [labels.summary.to, filters.to ?? ""],
    [labels.summary.search, filters.search ?? ""],
    ["", ""],
    [labels.summary.exportedRows, exportedRows],
    [labels.summary.matchedRows, matchedRows],
  ];
  if (exportedRows < matchedRows) {
    aoa.push([labels.summary.capped, matchedRows - exportedRows]);
  }
  return aoa;
}

export function buildOrderExceptionsWorkbook(input: {
  rows: readonly OrderExceptionRow[];
  filters: OrderExceptionExportFilters;
  matchedRows: number;
  labels: OrderExceptionExportLabels;
}) {
  const exportedRows = input.rows.length;
  return [
    { name: input.labels.sheetRows, aoa: buildOrderExceptionRowsAoa(input.rows, input.labels) },
    {
      name: input.labels.sheetSummary,
      aoa: buildOrderExceptionSummaryAoa({
        filters: input.filters,
        exportedRows,
        matchedRows: input.matchedRows,
        labels: input.labels,
      }),
    },
  ];
}

export function downloadOrderExceptionsXlsx(input: {
  filename: string;
  rows: readonly OrderExceptionRow[];
  filters: OrderExceptionExportFilters;
  matchedRows: number;
  labels: OrderExceptionExportLabels;
}) {
  downloadWorkbookXlsx(
    input.filename,
    buildOrderExceptionsWorkbook({
      rows: input.rows,
      filters: input.filters,
      matchedRows: input.matchedRows,
      labels: input.labels,
    }),
  );
}
