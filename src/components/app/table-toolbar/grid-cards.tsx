"use client";

import type { ReactNode } from "react";
import { StatusBadge, type FrameStatus } from "@/components/app/status-badge";

export type TableGridField = { label: string; value: ReactNode };

export function TableGridCards({
  rows,
}: {
  rows: {
    id: string;
    name: string;
    status?: { status: FrameStatus; label: string };
    fields: TableGridField[];
    onOpen?: () => void;
  }[];
}) {
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={row.onOpen}
          className="cursor-pointer rounded-lg border border-[var(--border-default)] bg-card p-3 text-start"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-[var(--text-muted)]">{row.id}</p>
              <p className="text-sm font-semibold break-words text-foreground">{row.name}</p>
            </div>
            {row.status ? <StatusBadge status={row.status.status} label={row.status.label} /> : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {row.fields.slice(0, 4).map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[10px] text-[var(--text-muted)]">{field.label}</dt>
                <dd className="text-xs break-words text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        </button>
      ))}
    </div>
  );
}
