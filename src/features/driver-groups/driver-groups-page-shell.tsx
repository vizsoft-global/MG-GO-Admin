"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppListControls,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
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
  const labels = useListControlLabels();
  const { prefs, update: updateListPrefs } = useListViewPrefs("driver-groups");
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("driver_groups.manage");
  const { data: groups = [], isLoading } = useDriverGroups();
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () =>
      groups.filter((group) =>
        fieldSearchMatch(group, search, {
          name: (item) => item.name,
        }),
      ),
    [groups, search],
  );
  const grouped = useMemo(
    () => groupRows(visible, "none", {}, {}, "—"),
    [visible],
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button
              className="h-9 cursor-pointer"
              onClick={() => router.push("/drivers/groups/new")}
            >
              <Plus className="size-4" />
              {t("createGroup")}
            </Button>
          ) : null
        }
      />
      <AppListCard title={t("listTitle")}>
        <div className="p-4 pb-0">
          <AppListControls
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("listSearchPlaceholder")}
            clearSearchLabel={labels.clearSearch}
            viewMode={prefs.viewMode}
            onViewModeChange={(value) => updateListPrefs({ viewMode: value })}
            tableViewLabel={labels.viewTable}
            cardsViewLabel={labels.viewCards}
          />
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
        ) : groups.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : visible.length === 0 ? (
          <AppEmptyState title={t("listSearchEmpty")} description={t("listSearchEmptyHint")} />
        ) : prefs.viewMode === "cards" ? (
          <div className="p-4">
            <GroupedSections groups={grouped}>
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
                        <p className="truncate text-sm font-semibold">{group.name}</p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colMembers")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colUpdated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.flatMap((bucket) =>
                  bucket.rows.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell>
                        <Link
                          href={`/drivers/groups/${group.id}`}
                          className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
                        >
                          <DriverGroupIconBadge iconKey={group.icon_key} />
                          {group.name}
                        </Link>
                      </TableCell>
                      <TableCell>{group.member_count}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(group.updated_at).toLocaleDateString()}
                      </TableCell>
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
