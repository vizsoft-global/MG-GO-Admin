"use client";

import { useTranslations } from "next-intl";
import { ColumnOrderMenu } from "@/components/app/column-order-menu";
import type { CombinedColumnsController } from "./use-combined-columns";

/**
 * The Combined Payroll Columns menu (SOP item 8).
 *
 * Order and visibility are the operator's own, saved per staff member. The pinned
 * MG ID · Driver ID · Name trio cannot be hidden or moved, so the menu says so
 * once instead of offering three checkboxes that would silently refuse.
 *
 * The panel itself is the shared `ColumnOrderMenu`, so this tab and every other
 * payroll sheet arrange columns with the same controls.
 */
export function CombinedColumnsMenu({
  columns,
  labelFor,
  canManage,
}: {
  columns: CombinedColumnsController;
  labelFor: (columnId: string) => string;
  /** Rename is `payroll.manage`; visibility and order are everyone's own. */
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll.combinedColumns");
  return (
    <ColumnOrderMenu
      columns={columns}
      labelFor={labelFor}
      labels={{
        columns: t("columns"),
        title: t("title"),
        hint: t("hint"),
        pinned: t("pinned"),
        drag: t("drag"),
        show: t("show"),
        hide: t("hide"),
        reset: t("reset"),
      }}
      footer={
        canManage ? (
          <span className="text-xs text-muted-foreground">{t("renameHint")}</span>
        ) : undefined
      }
    />
  );
}
