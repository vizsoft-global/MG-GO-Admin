"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  FlatListPager,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { DriverGroupIconBadge } from "./driver-group-member-picker";
import { useDriverGroups } from "./use-driver-groups";

export function DriverGroupsPageShell() {
  const t = useTranslations("pages.driverGroups");
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("driver_groups.manage");
  const toolbarColumns = useMemo((): TableToolbarColumn[] => [
    { id: "name", label: t("colName"), locked: true },
    { id: "members", label: t("colMembers") },
    { id: "updated", label: t("colUpdated") },
  ], [t]);
  const tablePrefs = useTablePrefs("driver-groups", toolbarColumns);
  const { data: groups = [], isLoading } = useDriverGroups();
  const visible = useMemo(
    () =>
      groups.filter((group) =>
        fieldSearchMatch(group, tablePrefs.appliedQuery, {
          name: (item) => item.name,
        }),
      ),
    [groups, tablePrefs.appliedQuery],
  );
  const grouped = useMemo(
    () => groupRows(visible, "none", {}, {}, "—"),
    [visible],
  );
  const listView = useGroupedListView(grouped, false, tablePrefs.appliedQuery);
  const shown = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const toolbar = (
    <TableToolbar
      prefs={tablePrefs}
      entity={t("title")}
      columns={toolbarColumns}
      rowKind="dynamic"
      entityList
      filteredCount={visible.length}
      totalCount={groups.length}
      onAdd={canManage ? () => router.push("/drivers/groups/new") : undefined}
      addLabel={t("createGroup")}
    />
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
      />
      <AppListCard title={t("listTitle")}>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
        ) : groups.length === 0 ? (
          <>
            {toolbar}
            <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          </>
        ) : visible.length === 0 ? (
          <>
            {toolbar}
            <AppEmptyState title={t("listSearchEmpty")} description={t("listSearchEmptyHint")} />
          </>
        ) : tablePrefs.view === "grid" ? (
          <div>
            {toolbar}
            <GroupedSections groups={grouped} paged resetKey={tablePrefs.appliedQuery}>
              {(groupRowsList) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupRowsList.map((group) => (
                    <Link
                      key={group.id}
                      href={`/drivers/groups/${group.id}`}
                      className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        <DriverGroupIconBadge iconKey={group.icon_key} />
                        <TableNameCell name={group.name} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{group.member_count}</p>
                    </Link>
                  ))}
                </div>
              )}
            </GroupedSections>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
            {toolbar}
            <Table>
              <TableHeader>
                <TableRow>
                  {shown.map((column) => (
                    <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listView.sections.flatMap((section) =>
                  section.visibleRows.map((group) => (
                    <TableRow key={group.id}>
                      {shown.map((column) => {
                        if (column.id === "name") {
                          return (
                            <TableCell key={column.id}>
                              <Link
                                href={`/drivers/groups/${group.id}`}
                                className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
                              >
                                <DriverGroupIconBadge iconKey={group.icon_key} />
                                <TableNameCell name={group.name} />
                              </Link>
                            </TableCell>
                          );
                        }
                        if (column.id === "members") {
                          return <TableCell key={column.id}>{group.member_count}</TableCell>;
                        }
                        return (
                          <TableCell key={column.id} className="text-muted-foreground">
                            {new Date(group.updated_at).toLocaleDateString()}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </AppListCard>
    </AppPage>
  );
}
