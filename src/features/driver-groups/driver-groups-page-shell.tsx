"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
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
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("driver_groups.manage");
  const { data: groups = [], isLoading } = useDriverGroups();

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
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
        ) : groups.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
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
                {groups.map((group) => (
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
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </AppListCard>
    </AppPage>
  );
}
