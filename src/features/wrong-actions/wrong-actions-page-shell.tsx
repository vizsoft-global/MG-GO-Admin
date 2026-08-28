"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  Layers,
  Loader2,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { useRouter } from "@/i18n/navigation";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { WrongActionFormDialog } from "./wrong-action-form-dialog";
import { useWrongActionDriverOptions, useWrongActionsList } from "./use-wrong-actions";
import type { WrongActionRow, WrongActionSeverity } from "./types";
import {
  parseWrongActionTab,
  wrongActionKpis,
  wrongActionMatchesSearch,
  wrongActionMatchesTab,
  type WrongActionTab,
} from "./wrong-actions-list-utils";

export function severityTone(
  severity: WrongActionSeverity,
): "default" | "secondary" | "destructive" {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "secondary";
  return "default";
}

export function formatKuwait(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function WrongActionsPageShell({
  addOpen,
  tab,
}: {
  addOpen: boolean;
  tab?: string;
}) {
  const t = useTranslations("pages.wrongActions");
  const { can } = useAuth();
  const canManage = can("wrong_actions.manage");
  const router = useRouter();
  const { data: rows = [], isLoading } = useWrongActionsList();
  const { data: drivers = [], isLoading: driversLoading } = useWrongActionDriverOptions(
    addOpen && canManage,
  );
  const [search, setSearch] = useState("");
  const activeTab = parseWrongActionTab(tab);

  // One clock for the whole render, so the "this week" tab and the KPI counting
  // the same rows cannot disagree by a millisecond at a midnight boundary.
  const now = useMemo(() => new Date(), []);

  const replaceQuery = (next: { add?: boolean; tab?: WrongActionTab }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? activeTab;
    const nextAdd = next.add ?? addOpen;
    if (nextTab !== "all") params.set("tab", nextTab);
    if (nextAdd) params.set("add", "1");
    const qs = params.toString();
    router.replace(qs ? `/wrong-actions?${qs}` : "/wrong-actions");
  };

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          wrongActionMatchesTab(row, activeTab, now) && wrongActionMatchesSearch(row, search),
      ),
    [activeTab, now, rows, search],
  );

  const counts = useMemo(() => wrongActionKpis(rows, now), [now, rows]);
  const dash = (value: number) => (isLoading ? "—" : String(value));
  const kpis = [
    { label: t("kpiTotal"), value: dash(counts.total), icon: Layers, accent: "primary" as const },
    { label: t("kpiHigh"), value: dash(counts.high), icon: ShieldAlert, accent: "danger" as const },
    {
      label: t("kpiMedium"),
      value: dash(counts.medium),
      icon: AlertTriangle,
      accent: "warning" as const,
    },
    { label: t("kpiLow"), value: dash(counts.low), icon: AlertTriangle },
    { label: t("kpiThisWeek"), value: dash(counts.thisWeek), icon: CalendarClock },
    { label: t("kpiWeighted"), value: dash(counts.weighted), icon: Scale },
    { label: t("kpiDrivers"), value: dash(counts.driversInvolved), icon: Users },
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            className="h-9 cursor-pointer rounded-lg"
            disabled={!canManage}
            onClick={() => {
              if (canManage) replaceQuery({ add: true });
            }}
          >
            <Plus className="me-2 h-3.5 w-3.5" />
            {t("addIncident")}
          </Button>
        }
        tabs={
          <TabBar
            activeId={activeTab}
            onSelect={(id) => replaceQuery({ tab: parseWrongActionTab(id) })}
            items={[
              { id: "all", label: t("tabAll"), icon: Layers },
              { id: "high", label: t("severity.high"), icon: ShieldAlert },
              { id: "medium", label: t("severity.medium"), icon: AlertTriangle },
              { id: "low", label: t("severity.low"), icon: AlertTriangle },
              { id: "week", label: t("tabWeek"), icon: CalendarClock },
            ]}
          />
        }
      />
      <KpiGrid items={kpis} compact />
      <AppListCard
        toolbar={
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 rounded-lg bg-background ps-9 pe-9"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        }
      >
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "driver", label: t("colDriver") },
              { id: "type", label: t("colType") },
              { id: "severity", label: t("colSeverity") },
              { id: "date", label: t("colDate") },
              { id: "source", label: t("colSource") },
            ]}
            empty={
              visible.length === 0 ? (
                <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty>
              ) : null
            }
          >
            {visible.map((row) => (
              <WrongActionListRow
                key={row.id}
                row={row}
                onOpen={() => router.push(`/wrong-actions/${row.id}`)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <WrongActionFormDialog
        open={addOpen && canManage}
        incident={null}
        drivers={drivers}
        driversLoading={driversLoading}
        onOpenChange={(open) => {
          if (!open) replaceQuery({ add: false });
        }}
        onSaved={(id) => router.replace(`/wrong-actions/${id}`)}
      />
    </AppPage>
  );
}

function WrongActionListRow({ row, onOpen }: { row: WrongActionRow; onOpen: () => void }) {
  const t = useTranslations("pages.wrongActions");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <div className="flex items-center gap-2">
          <p className="font-medium">{row.driver_name ?? "—"}</p>
          {row.driver_code ? (
            <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {row.driver_code}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-primary">{t("viewDetails")}</p>
      </TableCell>
      <TableCell>{t(`type.${row.action_type}` as "type.delay")}</TableCell>
      <TableCell>
        <Badge variant={severityTone(row.severity)}>
          {t(`severity.${row.severity}` as "severity.low")}
        </Badge>
      </TableCell>
      <TableCell>{formatKuwait(row.occurred_at)}</TableCell>
      <TableCell>{t(`source.${row.source}` as "source.admin")}</TableCell>
    </AppDataTableRow>
  );
}
