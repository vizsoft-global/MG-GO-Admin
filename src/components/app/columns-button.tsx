"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ColumnOrderMenu,
  type ColumnOrderController,
} from "@/components/app/column-order-menu";

/**
 * "Columns N" + "Show and reorder columns", on any table that has no column
 * manager of its own.
 *
 * The payroll sheets already render `ColumnOrderMenu` directly with their own
 * copy; this wrapper exists so a table that has never had a column picker gets
 * the same one without every page inventing its own labels. `columns` is a
 * `useColumnLayout` controller, so order and visibility are saved in
 * `localStorage` under that table's id and the table re-renders on every tick
 * and every arrow.
 *
 * Deliberately **not** used on a table that already draws its own Columns
 * control: two pickers over one table would disagree about what is visible.
 */
export function ColumnsButton({
  columns,
  labelFor,
  pinned,
}: {
  columns: ColumnOrderController;
  labelFor: (columnId: string) => string;
  /** Pinned-column notice for this table, e.g. "MG ID · Name stay pinned…". */
  pinned?: string;
}) {
  const t = useTranslations("pages.payroll.columnsMenu");
  const labels = useMemo(
    () => ({
      columns: t("columns"),
      title: t("title"),
      hint: t("hint"),
      pinned: pinned ?? t("pinnedSummary"),
      drag: t("drag"),
      show: t("show"),
      hide: t("hide"),
      reset: t("reset"),
    }),
    [pinned, t],
  );
  return <ColumnOrderMenu columns={columns} labelFor={labelFor} labels={labels} />;
}
