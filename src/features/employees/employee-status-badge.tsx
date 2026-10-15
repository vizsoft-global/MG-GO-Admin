"use client";

import { StatusPill } from "@/components/dashboard/status-pill";
import { catalogLabel, type EmployeeCatalogRow } from "./employee-catalogs";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  new: "info",
  running: "success",
  absent_mosal: "warning",
  absent_moi: "warning",
  transfer_from_company: "info",
  on_hold: "neutral",
  training: "info",
  extension: "info",
  accident: "danger",
};

export function EmployeeStatusBadge({
  statusKey,
  rows,
  locale,
}: {
  statusKey: string | null | undefined;
  rows: readonly EmployeeCatalogRow[];
  locale: string;
}) {
  if (!statusKey) return <span className="text-xs text-muted-foreground">—</span>;
  const variant = TONE[statusKey] ?? "neutral";
  return (
    <StatusPill variant={variant} dot={false}>
      {catalogLabel(statusKey, rows, locale)}
    </StatusPill>
  );
}
