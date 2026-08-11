"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchVisitDepartments,
  updateVisitDepartment,
} from "./visits-actions";
import { VisitsTabBar } from "./visits-tab-bar";

export function VisitsDepartmentsShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: () => fetchVisitDepartments(),
  });

  const rows = data?.rows ?? [];

  const toggleActive = async (id: string, is_active: boolean) => {
    setBusyId(id);
    const result = await updateVisitDepartment({ id, is_active });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    toast.success(t("catalog.saved"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.departments() });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("departments.title")}
        description={t("departments.subtitle")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
            />
            {t("refresh")}
          </Button>
        }
      />

      <VisitsTabBar />

      <AppListCard className="mt-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("departments.emptyTitle")}
            description={t("departments.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "key", label: t("catalog.key") },
              { id: "label", label: t("catalog.label") },
              { id: "sort", label: t("catalog.sortOrder") },
              { id: "active", label: t("catalog.active") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{row.label_en}</p>
                  {row.label_ar ? (
                    <p className="text-[11px] text-muted-foreground">{row.label_ar}</p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">{row.sort_order}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Switch
                      checked={row.is_active}
                      disabled={busyId === row.id}
                      onCheckedChange={(checked) =>
                        void toggleActive(row.id, checked)
                      }
                    />
                  ) : (
                    <span className="text-sm">
                      {row.is_active ? t("catalog.yes") : t("catalog.no")}
                    </span>
                  )}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
