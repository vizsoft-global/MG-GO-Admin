"use client";

import { useListColumns } from "@/hooks/use-list-columns";
import { PAYROLL_COMBINED_COLUMNS_PREF_KEY } from "@/lib/ui-preferences/types";
import { COMBINED_COLUMN_ORDER } from "./combined-columns";

/**
 * The Combined Payroll column order and visibility, saved per staff member in
 * `admin_ui_preferences` under `payroll.combined`.
 *
 * `days` is one id, so the 31 day columns move and hide as a block. The pinned
 * trio never enters the preference — it is always drawn on the start edge.
 */
export function useCombinedColumns() {
  return useListColumns(PAYROLL_COMBINED_COLUMNS_PREF_KEY, COMBINED_COLUMN_ORDER);
}

export type CombinedColumnsController = ReturnType<typeof useCombinedColumns>;
