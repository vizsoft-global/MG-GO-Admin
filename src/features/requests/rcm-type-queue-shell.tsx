"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { AppDataTable, AppDataTableEmpty, AppDataTableRow, AppPage, AppPageHeader, TableCell } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { useZonesList } from "@/features/zones/use-zones";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { REQUEST_DATE_PRESETS } from "./date-presets";
import { listScopeFlags } from "./request-list-scopes";
import {
  isQueueRowOverdue,
  queueColumnKeys,
  queueDayCount,
  type QueueColumnKey,
  type RcmQueueScope,
  type RcmQueueType,
} from "./rcm-type-queue-columns";
import type { RequestDatePreset, RequestListFilters, RequestListRow } from "./types";
import { useAdminRequestsList, useRequestQueueFacts } from "./use-requests";

const PAGE_SIZE = 50;
const SCOPES = ["assigned", "forwarded", "handled", "all"] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0)).join("");
  return letters.toUpperCase() || "—";
}

function money(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  const rounded = Number.isInteger(amount) ? String(amount) : amount.toFixed(3);
  return `${rounded} KD`;
}

function waitingMinutes(createdAt: string): number | null {
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 60_000));
}

export function RcmTypeQueueShell({
  type,
  initialScope,
  initialDatePreset,
  initialDueToday,
}: {
  type: RcmQueueType;
  initialScope: RcmQueueScope;
  initialDatePreset: RequestDatePreset;
  initialDueToday: boolean;
}) {
  const t = useTranslations("pages.rcmV2");
  const tRequests = useTranslations("pages.requests");
  const router = useRouter();
  const pathname = usePathname();
  const zones = useZonesList();
  const [scope, setScope] = useState<RcmQueueScope>(initialScope);
  const [datePreset, setDatePreset] = useState<RequestDatePreset>(initialDatePreset);
  const [zoneId, setZoneId] = useState("all");
  const [due, setDue] = useState<"any" | "today">(initialDueToday ? "today" : "any");
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchApplied(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [scope, datePreset, zoneId, searchApplied, due]);

  const typeLabel = t(`types.${type}` as "types.loan");
  const columnKeys = queueColumnKeys(type);

  const filtersFor = (tab: RcmQueueScope, limit: number, pageOffset: number): RequestListFilters => ({
    datePreset,
    type,
    search: searchApplied,
    zoneId: zoneId === "all" ? null : zoneId,
    limit,
    offset: pageOffset,
    sort: tab === "assigned" || tab === "forwarded" ? "oldest" : null,
    ...listScopeFlags(tab),
    dueToday: due === "today" ? true : undefined,
  });

  const assignedQuery = useAdminRequestsList(
    filtersFor("assigned", scope === "assigned" ? PAGE_SIZE : 1, scope === "assigned" ? offset : 0),
  );
  const forwardedQuery = useAdminRequestsList(
    filtersFor("forwarded", scope === "forwarded" ? PAGE_SIZE : 1, scope === "forwarded" ? offset : 0),
  );
  const handledQuery = useAdminRequestsList(
    filtersFor("handled", scope === "handled" ? PAGE_SIZE : 1, scope === "handled" ? offset : 0),
  );
  const allQuery = useAdminRequestsList(
    filtersFor("all", scope === "all" ? PAGE_SIZE : 1, scope === "all" ? offset : 0),
  );

  const queries = {
    assigned: assignedQuery,
    forwarded: forwardedQuery,
    handled: handledQuery,
    all: allQuery,
  } as const;
  const active = queries[scope];
  const rows = active.data?.rows ?? [];
  const total = active.data?.filteredTotal ?? 0;
  const factIds = rows.map((row) => row.id);
  const facts = useRequestQueueFacts(factIds);

  const zoneItems = useMemo<SearchSelectItem[]>(() => {
    const options = zones.data ?? [];
    return [
      { value: "all", label: t("queue.zones"), keywords: [] },
      ...options.map((zone) => ({
        value: zone.id,
        label: zone.name,
        keywords: [zone.code],
      })),
    ];
  }, [t, zones.data]);

  function columnLabel(key: QueueColumnKey): string {
    switch (key) {
      case "amount":
        return t("queue.colAmount");
      case "repayment":
        return t("queue.colRepayment");
      case "fromTo":
        return t("queue.colFromTo");
      case "days":
        return t("queue.colDays");
      case "vehicle":
        return t("queue.colVehicle");
      case "item":
        return t("queue.colItem");
      case "category":
        return t("queue.colCategory");
      case "severity":
        return t("queue.colSeverity");
      case "month":
        return t("queue.colMonth");
      case "subject":
        return t("queue.colSubject");
      default: {
        const unreachable: never = key;
        return unreachable;
      }
    }
  }

  function columnValue(key: QueueColumnKey, row: RequestListRow): string {
    const fact = facts.data?.[row.id];
    switch (key) {
      case "amount":
        return money(row.amount_kwd);
      case "repayment":
        return fact?.tenureMonths ? t("queue.months", { n: fact.tenureMonths }) : "—";
      case "fromTo": {
        if (!fact?.startDate && !fact?.endDate) return "—";
        return [fact?.startDate, fact?.endDate].filter(Boolean).join(" – ");
      }
      case "days":
        return queueDayCount(fact?.startDate ?? null, fact?.endDate ?? null) ?? "—";
      case "vehicle":
        return fact?.vehicleLabel ?? "—";
      case "item":
        return fact?.item ?? "—";
      case "category":
        return fact?.category ?? "—";
      case "severity":
        return row.severity ?? "—";
      case "month":
        return fact?.month ?? "—";
      case "subject":
        return fact?.subject ?? "—";
      default: {
        const unreachable: never = key;
        return unreachable;
      }
    }
  }

  function tabName(tab: RcmQueueScope): string {
    switch (tab) {
      case "assigned":
        return t("queue.tabWaiting");
      case "forwarded":
        return t("queue.tabForwarded");
      case "handled":
        return t("queue.tabHandled");
      case "all":
        return t("queue.tabAll", { type: typeLabel });
      default: {
        const unreachable: never = tab;
        return unreachable;
      }
    }
  }

  function waitingLabel(createdAt: string): string {
    const minutes = waitingMinutes(createdAt);
    if (minutes == null) return "—";
    if (minutes < 1) return t("ageToday");
    if (minutes < 60) return t("ageMinutes", { n: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("ageHours", { n: hours });
    const days = Math.round(hours / 24);
    if (days <= 1) return t("ageDay");
    return t("ageDays", { n: days });
  }

  function openRow(id: string) {
    router.push(`/employeedesk/${id}`);
  }

  function rememberScope(next: RcmQueueScope) {
    setScope(next);
    const params = new URLSearchParams();
    params.set("type", type);
    params.set("preset", datePreset);
    params.set("scope", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const columns = [
    { id: "id", label: t("queue.colId") },
    { id: "employee", label: t("queue.colEmployee") },
    ...columnKeys.map((key) => ({ id: key, label: columnLabel(key) })),
    { id: "step", label: t("queue.colStep") },
    { id: "waiting", label: t("queue.colWaiting") },
    { id: "review", label: t("queue.colReview"), className: "text-end" },
  ];

  return (
    <AppPage className="space-y-2">
      <AppPageHeader
        title={t("queue.heading", { type: typeLabel })}
        description={scope === "assigned" ? t("queue.subtitle") : undefined}
        breadcrumbs={[
          { label: t("breadcrumb"), href: "/employeedesk" },
          { label: t("incomingShort"), href: "/employeedesk/incoming" },
          { label: typeLabel },
        ]}
      />
      <div className="flex flex-wrap gap-1">
        {SCOPES.map((tab) => {
          const selected = tab === scope;
          const count = queries[tab].data?.filteredTotal ?? 0;
          return (
            <button
              key={tab}
              type="button"
              className={cn(
                "inline-flex h-9 cursor-pointer items-center rounded-full px-3 text-sm",
                selected
                  ? "bg-card font-semibold text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
              onClick={() => rememberScope(tab)}
            >
              <span>{tabName(tab)}</span>
              <span
                className={cn(
                  "ms-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums",
                  selected ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {Number.isFinite(count) ? count : 0}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchSelect
          value={zoneId}
          onChange={(next) => setZoneId(next || "all")}
          items={zoneItems}
          placeholder={t("queue.zones")}
          searchPlaceholder={t("queue.zones")}
          recentsKey="rcm-queue-zone"
          className="w-[180px]"
        />
        <Select
          items={REQUEST_DATE_PRESETS.map((preset) => ({
            value: preset,
            label: tRequests(`datePresets.${preset}`),
          }))}
          value={datePreset}
          onValueChange={(next) => {
            if (next) setDatePreset(next as RequestDatePreset);
          }}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label={t("queue.dateRange")}>
            <SelectValue placeholder={t("queue.dateRange")} />
          </SelectTrigger>
          <SelectContent>
            {REQUEST_DATE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset} label={tRequests(`datePresets.${preset}`)}>
                {tRequests(`datePresets.${preset}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={[
            { value: "any", label: `${t("queue.due")}: ${t("queue.dueAny")}` },
            { value: "today", label: `${t("queue.due")}: ${t("queue.dueToday")}` },
          ]}
          value={due}
          onValueChange={(next) => {
            if (next === "any" || next === "today") setDue(next);
          }}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label={t("queue.due")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any" label={`${t("queue.due")}: ${t("queue.dueAny")}`}>
              {t("queue.due")}: {t("queue.dueAny")}
            </SelectItem>
            <SelectItem value="today" label={`${t("queue.due")}: ${t("queue.dueToday")}`}>
              {t("queue.due")}: {t("queue.dueToday")}
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("queue.search")}
            className="h-9 ps-8"
          />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <AppDataTable
          columns={columns}
          empty={
            rows.length === 0 && !active.isLoading ? (
              <AppDataTableEmpty>{active.data?.error ?? t("queue.empty")}</AppDataTableEmpty>
            ) : null
          }
          footer={
            scope === "assigned" ? (
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {t("queue.footer", { type: typeLabel })}{" "}
                <button
                  type="button"
                  className="cursor-pointer font-medium text-orange-700 hover:underline"
                  onClick={() => rememberScope("all")}
                >
                  {t("queue.seeAll", { type: typeLabel })}
                </button>
              </p>
            ) : null
          }
        >
          {rows.map((row) => {
            const overdue = isQueueRowOverdue({
              status: row.status,
              createdAt: row.created_at,
              slaDueAt: row.sla_due_at,
            });
            const code = row.employee_id || row.driver_code;
            const zone = row.driver_zone && !/^[0-9a-f-]{16,}$/i.test(row.driver_zone) ? row.driver_zone : "";
            return (
              <AppDataTableRow key={row.id} onClick={() => openRow(row.id)}>
                <TableCell className="font-mono text-xs">{row.request_code}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        avatarTintFromName(row.driver_name),
                      )}
                    >
                      {initials(row.driver_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.driver_name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[code, zone].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </div>
                </TableCell>
                {columnKeys.map((key) => (
                  <TableCell key={key} className="text-sm">
                    {columnValue(key, row)}
                  </TableCell>
                ))}
                <TableCell className="text-sm">{row.current_step_label ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{waitingLabel(row.created_at)}</span>
                    {overdue ? (
                      <span className="font-medium text-red-600">{t("queue.overdue")}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    render={<Link href={`/employeedesk/${row.id}`} />}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {t("queue.review")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            );
          })}
        </AppDataTable>
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={offset === 0}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            >
              {t("queue.prev")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              {t("queue.next")}
            </Button>
          </div>
        ) : null}
      </div>
    </AppPage>
  );
}
