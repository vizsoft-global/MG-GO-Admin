"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";

/**
 * The bar every payroll table ends with.
 *
 * Left: what the table is showing ("Showing 240 of 962 riders · October 2026").
 * Right: **Download this table**, which writes exactly the filtered rows and the
 * visible columns the screen is showing. Payroll and HR Payroll share this one
 * component so the two screens cannot drift in wording, order or height.
 */
export function TableFooterExport({
  summary,
  exportLabel,
  onExport,
  canExport = true,
  note,
}: {
  summary: ReactNode;
  exportLabel?: string;
  onExport?: () => void;
  canExport?: boolean;
  note?: string;
}) {
  return (
    <div
      data-table-footer=""
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="min-w-0 truncate">
        {summary}
        {note ? <span className="ms-2 opacity-75">{note}</span> : null}
      </span>
      {onExport && exportLabel ? (
        <button
          type="button"
          data-table-footer-export=""
          onClick={onExport}
          disabled={!canExport}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="size-3.5" />
          {exportLabel}
        </button>
      ) : null}
    </div>
  );
}
