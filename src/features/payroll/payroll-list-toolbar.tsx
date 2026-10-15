"use client";

import {
  AppListControls,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { useTranslations } from "next-intl";

export function PayrollListToolbar({
  prefKey,
  search,
  onSearchChange,
}: {
  prefKey: string;
  search: string;
  onSearchChange: (value: string) => void;
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
      searchFields={[
        labels.field.all,
        labels.field.name,
        labels.field.employee_id,
        labels.field.zone,
      ]}
      searchField={prefs.searchField}
      onSearchFieldChange={(value) => update({ searchField: value })}
      searchFieldLabel={labels.searchBy}
      groupByOptions={[labels.group.none, labels.group.zone, labels.group.partner, labels.group.status]}
      groupBy={prefs.groupBy}
      onGroupByChange={(value) => update({ groupBy: value })}
      groupByLabel={labels.groupBy}
      viewMode={prefs.viewMode}
      onViewModeChange={(value) => update({ viewMode: value })}
      tableViewLabel={labels.viewTable}
      cardsViewLabel={labels.viewCards}
    />
  );
}

export { useListViewPrefs as usePayrollListPrefs };
