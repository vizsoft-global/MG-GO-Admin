"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { payrollEmployeeHref } from "./payroll-row-link";

export type PayrollCardRow = {
  /** `drivers/{id}` — the React key. Never the printed code: two riders can share one. */
  id: string;
  /** Small label above the name, e.g. the MG ID. */
  code: string;
  name: string;
  fields: { label: string; value: string }[];
  /** Employee file, when the row carries a driver id. */
  driverId?: string | null;
};

/**
 * The card view every payroll sheet shows when the toolbar's Cards button is
 * pressed.
 *
 * Before this component the payroll family rendered the Table/Cards switch (it is
 * part of the shared `AppListControls` / `TableToolbar`) but never read the
 * preference, so pressing "Cards" saved a setting and left the table untouched —
 * the exact complaint on page 4 of the client PDF.
 *
 * Keyed by `driverId`, not by the printed MG ID: the previous version used the
 * code as the key, and two riders with a blank or duplicated code produced
 * "Encountered two children with the same key".
 */
export function PayrollRiderCards({ rows, empty }: { rows: readonly PayrollCardRow[]; empty: string }) {
  const t = useTranslations("pages.payroll.common");
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div
          key={row.id}
          className="rounded-lg border border-border bg-card p-3 text-start shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] tabular-nums text-muted-foreground">{row.code}</p>
              <p className="text-sm font-semibold break-words text-foreground">{row.name}</p>
            </div>
            {row.driverId ? (
              <Link
                href={payrollEmployeeHref(row.driverId)}
                aria-label={t("openEmployee")}
                title={t("openEmployee")}
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70",
                  "hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary",
                  "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
                )}
              >
                <ExternalLink className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {row.fields.slice(0, 4).map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[10px] text-muted-foreground">{field.label}</dt>
                <dd className="text-xs break-words text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
