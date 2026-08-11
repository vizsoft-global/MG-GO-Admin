"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitDetail,
  updateAdminVisitStatus,
} from "./visits-actions";
import { departmentBadgeClass, visitStatusVariant } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

export function VisitDetailPageShell({ bookingId }: { bookingId: string }) {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.visits.detail(bookingId),
    queryFn: () => fetchAdminVisitDetail(bookingId),
  });

  const visit = data?.visit;

  const slotLabel = useMemo(() => {
    if (!visit?.slot_start || !visit?.slot_end) return "—";
    return `${visit.slot_start.slice(0, 5)} – ${visit.slot_end.slice(0, 5)}`;
  }, [visit?.slot_end, visit?.slot_start]);

  const setStatus = async (
    status: "checked_in" | "completed" | "no_show" | "cancelled",
  ) => {
    setBusy(true);
    const result = await updateAdminVisitStatus({ bookingId, status });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? t("actionFailed"));
      return;
    }
    toast.success(t("actionOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
    await refetch();
  };

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }

  if (!visit) {
    return (
      <AppPage>
        <AppPageHeader title={t("detail.notFound")} />
        <Button variant="outline" className="h-9" render={<Link href="/visit-bookings" />}>
          <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
          {t("detail.back")}
        </Button>
      </AppPage>
    );
  }

  const closed =
    visit.status === "completed" ||
    visit.status === "cancelled" ||
    visit.status === "no_show";

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("allVisits.title"), href: "/visit-bookings/all" },
          { label: visit.booking_code },
        ]}
        title={visit.booking_code}
        description={`${visit.department_label} · ${visit.scheduled_date}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill variant={visitStatusVariant(visit.status)}>
              {t(`status.${visit.status}` as "status.confirmed")}
            </StatusPill>
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/visit-bookings" />}>
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("detail.back")}
            </Button>
          </div>
        }
      />

      <VisitsTabBar />

      <div className="mt-2 grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">{t("detail.driverSection")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("colDriver")}</dt>
              <dd className="font-medium">{visit.driver_name}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("detail.driverCode")}</dt>
              <dd className="tabular-nums">{visit.driver_code || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("colDepartment")}</dt>
              <dd>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    departmentBadgeClass(visit.department_key),
                  )}
                >
                  {visit.department_label}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("detail.branch")}</dt>
              <dd>{visit.branch_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("detail.slot")}</dt>
              <dd className="tabular-nums">{slotLabel}</dd>
            </div>
            {visit.note ? (
              <div>
                <dt className="text-muted-foreground">{t("detail.note")}</dt>
                <dd className="mt-1 rounded-md bg-muted/40 p-2 text-sm">{visit.note}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">{t("detail.timeline")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("detail.created")}</dt>
              <dd className="tabular-nums text-xs">{visit.created_at.slice(0, 16).replace("T", " ")}</dd>
            </div>
            {visit.checked_in_at ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("detail.checkedIn")}</dt>
                <dd className="tabular-nums text-xs">{visit.checked_in_at.slice(0, 16).replace("T", " ")}</dd>
              </div>
            ) : null}
            {visit.completed_at ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("detail.completed")}</dt>
                <dd className="tabular-nums text-xs">{visit.completed_at.slice(0, 16).replace("T", " ")}</dd>
              </div>
            ) : null}
            {visit.cancelled_at ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("detail.cancelled")}</dt>
                <dd className="tabular-nums text-xs">{visit.cancelled_at.slice(0, 16).replace("T", " ")}</dd>
              </div>
            ) : null}
          </dl>

          {canOperate && !closed ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              {visit.status === "confirmed" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9"
                    disabled={busy}
                    onClick={() => void setStatus("checked_in")}
                  >
                    {t("checkIn")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={busy}
                    onClick={() => void setStatus("no_show")}
                  >
                    {t("noShow")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn("h-9 text-destructive hover:bg-destructive/10")}
                    disabled={busy}
                    onClick={() => void setStatus("cancelled")}
                  >
                    {t("cancel")}
                  </Button>
                </>
              ) : null}
              {visit.status === "checked_in" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9"
                    disabled={busy}
                    onClick={() => void setStatus("completed")}
                  >
                    {t("complete")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => void setStatus("cancelled")}
                  >
                    {t("cancel")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </AppPage>
  );
}
