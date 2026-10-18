"use client";

import {
  AppListControls,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function PayrollListToolbar({
  prefKey,
  search,
  onSearchChange,
  trailing,
}: {
  prefKey: string;
  search: string;
  onSearchChange: (value: string) => void;
  trailing?: ReactNode;
}) {
  const t = useTranslations("pages.payroll");
  const labels = useListControlLabels();
  const { prefs, update } = useListViewPrefs(prefKey);
  return (
    <AppListControls
      searchValue={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t("searchPlaceholder")}
      clearSearchLabel={labels.clearSearch}
      groupByOptions={[labels.group.none, labels.group.zone, labels.group.partner, labels.group.status]}
      groupBy={prefs.groupBy}
      onGroupByChange={(value) => update({ groupBy: value })}
      groupByLabel={labels.groupBy}
      viewMode={prefs.viewMode}
      onViewModeChange={(value) => update({ viewMode: value })}
      tableViewLabel={labels.viewTable}
      cardsViewLabel={labels.viewCards}
      trailing={trailing}
    />
  );
}

export { useListViewPrefs as usePayrollListPrefs };
