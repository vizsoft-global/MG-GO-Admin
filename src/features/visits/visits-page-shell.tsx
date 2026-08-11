"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { fetchAdminVisitsList, updateAdminVisitStatus } from "./visits-actions";

function statusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed" || status === "checked_in") return "success";
  if (status === "cancelled" || status === "no_show") return "danger";
  if (status === "confirmed") return "warning";
  return "neutral";
}

export function VisitsPageShell() {
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list({}),
    queryFn: () => fetchAdminVisitsList({}),
  });

  const rows = data?.rows ?? [];

  const setStatus = async (
    bookingId: string,
    status: "checked_in" | "completed" | "no_show" | "cancelled",
  ) => {
    setBusyId(bookingId);
    const result = await updateAdminVisitStatus({ bookingId, status });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? "Update failed");
      return;
    }
    toast.success("Visit updated");
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Visit bookings"
        description="Head Office view · Operator check-in / status"
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
            Refresh
          </Button>
        }
      />

      <AppListCard>
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title="No visits yet"
            description="Driver bookings with VIS-##### tokens will appear here."
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: "Booking" },
              { id: "driver", label: "Driver" },
              { id: "dept", label: "Department" },
              { id: "date", label: "Date" },
              { id: "status", label: "Status" },
              { id: "actions", label: "Actions" },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="font-medium tabular-nums">
                  {row.booking_code}
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{row.driver_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.driver_code}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{row.department_label}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.scheduled_date}
                </TableCell>
                <TableCell>
                  <StatusPill variant={statusVariant(row.status)}>
                    {row.status}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  {canOperate && row.status === "confirmed" ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8"
                        disabled={busyId === row.id}
                        onClick={() => void setStatus(row.id, "checked_in")}
                      >
                        Check in
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-destructive hover:bg-destructive/10"
                        disabled={busyId === row.id}
                        onClick={() => void setStatus(row.id, "cancelled")}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : canOperate && row.status === "checked_in" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={busyId === row.id}
                      onClick={() => void setStatus(row.id, "completed")}
                    >
                      Complete
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
