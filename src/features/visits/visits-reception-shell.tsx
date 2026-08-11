"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, QrCode, RefreshCw, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
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
  type VisitListRow,
} from "./visits-actions";
import {
  avatarTintClass,
  initialsOf,
  visitStatusVariant,
} from "./visit-status-utils";

function queueGroup(status: string): "waiting" | "inProgress" | "done" {
  if (status === "confirmed") return "waiting";
  if (status === "checked_in") return "inProgress";
  return "done";
}

export function VisitsReceptionShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.reception(today),
    queryFn: () => fetchReceptionVisitsToday(),
  });

  const sorted = useMemo(
    () =>
      [...(data?.rows ?? [])].sort((a, b) =>
        (a.slot_start ?? "").localeCompare(b.slot_start ?? ""),
      ),
    [data?.rows],
  );

  const groups = useMemo(() => {
    const waiting: VisitListRow[] = [];
    const inProgress: VisitListRow[] = [];
    const done: VisitListRow[] = [];
    for (const row of sorted) {
      const group = queueGroup(row.status);
      if (group === "waiting") waiting.push(row);
      else if (group === "inProgress") inProgress.push(row);
      else done.push(row);
    }
    return { waiting, inProgress, done };
  }, [sorted]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.booking_code.toLowerCase().includes(q) ||
        r.driver_name.toLowerCase().includes(q) ||
        r.driver_code.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const selected =
    sorted.find((r) => r.id === selectedId) ??
    groups.waiting[0] ??
    groups.inProgress[0] ??
    sorted[0] ??
    null;

  const recents = useMemo(() => sorted.slice(0, 5).map((r) => r.booking_code), [sorted]);

  const setStatus = async (status: "checked_in" | "completed" | "no_show") => {
    if (!selected) return;
    setBusy(true);
    const result = await updateAdminVisitStatus({ bookingId: selected.id, status });
    setBusy(false);
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
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("reception.title") },
        ]}
        title={t("reception.title")}
        description={t("reception.subtitle", { date: today })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                {t("reception.waiting")} {groups.waiting.length}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("reception.inProgress")} {groups.inProgress.length}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {t("reception.done")} {groups.done.length}
              </span>
            </div>
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
          </div>
        }
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <AppEmptyState
          title={t("reception.emptyTitle")}
          description={t("reception.emptyDescription")}
        />
      ) : (
        <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <div className="space-y-2">
            {selected ? (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        avatarTintClass(selected.driver_name),
                      )}
                    >
                      {initialsOf(selected.driver_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{selected.driver_name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {selected.booking_code} · {selected.driver_phone ?? "—"}
                      </p>
                    </div>
                  </div>
                  <StatusPill variant={visitStatusVariant(selected.status)}>
                    {t(`status.${selected.status}` as "status.confirmed")}
                  </StatusPill>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("colDepartment")}
                    </dt>
                    <dd className="font-medium">{selected.department_label}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("detail.branch")}
                    </dt>
                    <dd className="font-medium">{selected.branch_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("colDate")}
                    </dt>
                    <dd className="tabular-nums">{selected.scheduled_date}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("detail.slot")}
                    </dt>
                    <dd className="tabular-nums">
                      {selected.slot_start ? selected.slot_start.slice(0, 5) : "—"}
                      {selected.slot_end ? `–${selected.slot_end.slice(0, 5)}` : ""}
                    </dd>
                  </div>
                </dl>

                {canOperate ? (
                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 bg-success text-white hover:bg-success/90"
                        disabled={busy || selected.status !== "confirmed"}
                        onClick={() => void setStatus("checked_in")}
                      >
                        <Check className="me-1.5 h-3.5 w-3.5" />
                        {t("reception.markArrived")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={busy || selected.status !== "checked_in"}
                        onClick={() => void setStatus("completed")}
                      >
                        {t("reception.markCompleted")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 text-destructive hover:bg-destructive/10"
                        disabled={busy || selected.status !== "confirmed"}
                        onClick={() => void setStatus("no_show")}
                      >
                        {t("noShow")}
                      </Button>
                    </div>
                    {selected.status !== "confirmed" && selected.status !== "checked_in" ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t("reception.alreadyClosed")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border p-3">
                <h2 className="text-sm font-semibold">{t("reception.todaysArrivals")}</h2>
                <span className="text-[11px] text-muted-foreground">
                  {t("reception.bookedDoneCount", {
                    booked: sorted.length,
                    done: groups.done.length,
                  })}
                </span>
              </div>
              <div className="divide-y divide-border">
                {(
                  [
                    { key: "waiting", label: t("reception.waiting"), items: groups.waiting },
                    { key: "inProgress", label: t("reception.inProgress"), items: groups.inProgress },
                    { key: "done", label: t("reception.done"), items: groups.done },
                  ] as const
                ).map((section) =>
                  section.items.length === 0 ? null : (
                    <div key={section.key}>
                      <p className="bg-muted/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {section.label} · {section.items.length}
                      </p>
                      {section.items.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-muted/40",
                            selected?.id === row.id && "bg-primary/5",
                          )}
                        >
                          <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {row.slot_start ? row.slot_start.slice(0, 5) : "—"}
                          </span>
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                              avatarTintClass(row.driver_name),
                            )}
                          >
                            {initialsOf(row.driver_name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {row.driver_name}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {row.department_label}
                            </span>
                          </span>
                          <StatusPill variant={visitStatusVariant(row.status)}>
                            {t(`status.${row.status}` as "status.confirmed")}
                          </StatusPill>
                        </button>
                      ))}
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
              <h2 className="text-sm font-semibold">{t("reception.scanTitle")}</h2>
              <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6">
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
                  <QrCode className="h-7 w-7 text-muted-foreground" />
                </span>
                <p className="text-[11px] text-muted-foreground">{t("reception.scanHint")}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold">{t("reception.findManually")}</h2>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 ps-8"
                  placeholder={t("reception.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {search ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {filteredRows.slice(0, 8).map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(row.id);
                          setSearch("");
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted/40"
                      >
                        <span className="truncate">{row.driver_name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {row.booking_code}
                        </span>
                      </button>
                    </li>
                  ))}
                  {filteredRows.length === 0 ? (
                    <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {t("reception.noMatches")}
                    </li>
                  ) : null}
                </ul>
              ) : recents.length > 0 ? (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("reception.recent")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {recents.map((code) => (
                      <Link
                        key={code}
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          const row = sorted.find((r) => r.booking_code === code);
                          if (row) setSelectedId(row.id);
                        }}
                        className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted/60"
                      >
                        {code}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
}
