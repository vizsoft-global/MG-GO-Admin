"use client";

import {
  AppListControls,
  useListControlLabels,
  useListViewPrefs,
  type ListViewPrefs,
} from "@/components/app/app-list-controls";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * The Payroll toolbar.
 *
 * `prefs` / `onUpdate` are optional so a tab that also *renders* on `viewMode`
 * (Payroll, Combined, Attendance & Orders, Application Attendance) can own the
 * one preference instance and hand it down. Two `useListViewPrefs` instances on
 * the same key do not share state, so the old shape — toolbar writes its own
 * copy, table reads another — is exactly why the List/Grid buttons appeared to
 * do nothing.
 */
export function PayrollListToolbar({
  prefKey,
  search,
  onSearchChange,
  trailing,
  prefs,
  onUpdate,
}: {
  prefKey: string;
  search: string;
  onSearchChange: (value: string) => void;
  trailing?: ReactNode;
  /** Owned by the caller when the caller also branches on the view mode. */
  prefs?: ListViewPrefs;
  onUpdate?: (patch: Partial<ListViewPrefs>) => void;
}) {
  const t = useTranslations("pages.payroll");
  const labels = useListControlLabels();
  const internal = useListViewPrefs(prefKey);
  const state = prefs ?? internal.prefs;
  const update = onUpdate ?? internal.update;
  return (
    <AppListControls
      searchValue={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t("searchPlaceholder")}
      clearSearchLabel={labels.clearSearch}
      groupByOptions={[labels.group.none, labels.group.zone, labels.group.partner, labels.group.status]}
      groupBy={state.groupBy}
      onGroupByChange={(value) => update({ groupBy: value })}
      groupByLabel={labels.groupBy}
      viewMode={state.viewMode}
      onViewModeChange={(value) => update({ viewMode: value })}
      tableViewLabel={labels.viewTable}
      cardsViewLabel={labels.viewCards}
      trailing={trailing}
    />
  );
}

export { useListViewPrefs as usePayrollListPrefs };
