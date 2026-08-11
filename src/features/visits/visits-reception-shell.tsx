"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchReceptionVisitsToday,
  updateAdminVisitStatus,
} from "./visits-actions";
import { visitStatusVariant } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

export function VisitsReceptionShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.reception(today),
    queryFn: () => fetchReceptionVisitsToday(),
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.booking_code.toLowerCase().includes(q) ||
        r.driver_name.toLowerCase().includes(q) ||
        r.driver_code.toLowerCase().includes(q),
    );
  }, [data?.rows, search]);

  const checkIn = async (bookingId: string) => {
    setBusyId(bookingId);
    const result = await updateAdminVisitStatus({
      bookingId,
      status: "checked_in",
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("actionFailed"));
      return;
    }
    toast.success(t("actionOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("reception.title")}
        description={t("reception.subtitle", { date: today })}
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
        <div className="border-b border-border p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 ps-8"
              placeholder={t("reception.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("reception.emptyTitle")}
            description={t("reception.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "dept", label: t("colDepartment") },
              { id: "status", label: t("colStatus") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="font-medium tabular-nums">
                  <Link
                    href={`/visit-bookings/${row.id}`}
                    className="text-primary hover:underline"
                  >
                    {row.booking_code}
                  </Link>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{row.driver_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.driver_code}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{row.department_label}</TableCell>
                <TableCell>
                  <StatusPill variant={visitStatusVariant(row.status)}>
                    {t(`status.${row.status}` as "status.confirmed")}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  {canOperate ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={busyId === row.id}
                      onClick={() => void checkIn(row.id)}
                    >
                      {t("checkIn")}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
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
