"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import type {
  EarningsDailyListRow,
  EarningsPreviewResult,
  DeliveryValidationResult,
} from "@/features/dpd/types";
import {
  defaultEndDate,
  defaultStartDate,
} from "@/lib/date/kuwait-dates";
import { queryKeys } from "@/lib/query/query-keys";
import {
  runPreviewEarnings,
  runRecalculateEarnings,
  runRecalculateEarningsRange,
  runValidateDelivery,
} from "./earnings-actions";
import { useEarningsDaily, useEarningsGrouped, useEarningsOverview } from "./use-earnings";
import { EarningsDetailDialog } from "./earnings-detail-dialog";

type EarningsTab = "daily" | "driver" | "reports" | "tools";

type DriverGroupedRow = {
  group_id: string;
  group_name: string;
  driver_code?: string;
  delivery_count: number;
  days_count?: number;
  incentive_kwd: number;
  net_kwd: number;
};

export function EarningsPageShell() {
  const t = useTranslations("pages.earnings");
  const toolsT = useTranslations("pages.earningsCalculation");
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("earnings.manage");

  const [tab, setTab] = useState<EarningsTab>("daily");
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested === "daily" || requested === "driver" || requested === "reports" || requested === "tools") {
      setTab(requested);
    }
  }, [searchParams]);

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"day" | "driver" | "zone" | "partner" | "restaurant">(
    "driver",
  );
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [detailDriverId, setDetailDriverId] = useState<string | null>(null);
  const [detailEarnDate, setDetailEarnDate] = useState<string | null>(null);
  const [detailLabel, setDetailLabel] = useState<string>("");
  const [detailOpen, setDetailOpen] = useState(false);

  const [earnDate, setEarnDate] = useState(defaultEndDate);
  const [rangeStart, setRangeStart] = useState(defaultStartDate);
  const [rangeEnd, setRangeEnd] = useState(defaultEndDate);
  const [deliveryTestId, setDeliveryTestId] = useState("");
  const [preview, setPreview] = useState<EarningsPreviewResult | null>(null);
  const [validation, setValidation] = useState<DeliveryValidationResult | null>(null);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [isToolPending, startToolTransition] = useTransition();

  const invalidateEarnings = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.earnings.all() });
  };

  const dailyQuery = useEarningsDaily(startDate, endDate, selectedDriverId || null);
  const overviewQuery = useEarningsOverview(startDate, endDate, {
    driver_ids: selectedDriverId ? [selectedDriverId] : [],
  });
  const groupedQuery = useEarningsGrouped(startDate, endDate, groupBy, {
    driver_ids: selectedDriverId ? [selectedDriverId] : [],
  });
  const driverGroupedQuery = useEarningsGrouped(startDate, endDate, "driver", {
    driver_ids: selectedDriverId ? [selectedDriverId] : [],
  });

  const rows = (dailyQuery.data ?? []) as EarningsDailyListRow[];
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      return (
        row.driver_name.toLowerCase().includes(q) ||
        row.driver_code.toLowerCase().includes(q) ||
        row.earn_date.includes(q)
      );
    });
  }, [rows, search]);

  const driverRows = useMemo(() => {
    const grouped = (driverGroupedQuery.data ?? []) as DriverGroupedRow[];
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter((row) => {
      const code = row.driver_code ?? "";
      return (
        row.group_name.toLowerCase().includes(q) ||
        code.toLowerCase().includes(q) ||
        row.group_id.toLowerCase().includes(q)
      );
    });
  }, [driverGroupedQuery.data, search]);

  const driverOptions = useMemo(
    () =>
      Array.from(
        new Map(rows.map((row) => [row.driver_id, { id: row.driver_id, name: row.driver_name, code: row.driver_code }])).values(),
      ),
    [rows],
  );

  const kpis = (overviewQuery.data?.kpis as Record<string, unknown> | undefined) ?? {};

  const openDetail = (row: EarningsDailyListRow) => {
    setDetailDriverId(row.driver_id);
    setDetailEarnDate(row.earn_date);
    setDetailLabel(`${row.driver_name} (${row.driver_code})`);
    setDetailOpen(true);
  };

  const openDriverDetail = (row: DriverGroupedRow) => {
    setDetailDriverId(row.group_id);
    setDetailEarnDate(endDate);
    setDetailLabel(
      row.driver_code
        ? `${row.group_name} (${row.driver_code})`
        : row.group_name,
    );
    setDetailOpen(true);
  };

  const handlePreview = () => {
    startToolTransition(async () => {
      const result = await runPreviewEarnings(earnDate);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setPreview(result as EarningsPreviewResult);
      toast.success(toolsT("previewDone"));
    });
  };

  const handleRecalculateDay = () => {
    if (!canManage) return;
    startToolTransition(async () => {
      const result = await runRecalculateEarnings(earnDate);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("count" in result) toast.success(toolsT("recalculateDone", { count: result.count }));
      invalidateEarnings();
    });
  };

  const handleRecalculateRange = () => {
    if (!canManage) return;
    startToolTransition(async () => {
      const result = await runRecalculateEarningsRange(rangeStart, rangeEnd);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("count" in result) toast.success(toolsT("recalculateRangeDone", { count: result.count }));
      invalidateEarnings();
    });
  };

  const handleValidateDelivery = () => {
    startToolTransition(async () => {
      const result = await runValidateDelivery(deliveryTestId.trim());
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setValidation(result as DeliveryValidationResult);
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void dailyQuery.refetch();
              void overviewQuery.refetch();
              void groupedQuery.refetch();
              void driverGroupedQuery.refetch();
            }}
            className="cursor-pointer rounded-lg"
          >
            {t("loadData")}
          </Button>
        }
      />

      <KpiGrid
        items={[
          { label: t("kpiRows"), value: Number(kpis.calculated_rows ?? 0) },
          {
            label: t("kpiTotalPaid"),
            value: Number(kpis.total_payable_kwd ?? 0).toFixed(3),
          },
          {
            label: t("colIncentive"),
            value: Number(kpis.total_incentive_kwd ?? 0).toFixed(3),
          },
          { label: t("colDeliveries"), value: Number(kpis.total_deliveries ?? 0) },
          { label: t("colDriver"), value: Number(kpis.active_drivers ?? 0) },
          { label: t("startDate"), value: startDate },
        ]}
      />

      <AppListCard>
        <div className="space-y-4 p-4">
          <TabBar
            items={[
              { id: "daily", label: "Daily" },
              { id: "driver", label: "By driver" },
              { id: "reports", label: "Reports" },
              { id: "tools", label: "Tools" },
            ]}
            activeId={tab}
            onSelect={(id) => setTab(id as EarningsTab)}
          />

          <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
            <div className="space-y-1.5">
              <Label htmlFor="earn-start">{t("startDate")}</Label>
              <Input
                id="earn-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40 rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="earn-end">{t("endDate")}</Label>
              <Input
                id="earn-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40 rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="earn-driver">Driver</Label>
              <Select
                value={selectedDriverId || "__all"}
                onValueChange={(v) => setSelectedDriverId(!v || v === "__all" ? "" : v)}
              >
                <SelectTrigger id="earn-driver" className="w-56 rounded-lg">
                  <SelectValue placeholder="All drivers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All drivers</SelectItem>
                  {driverOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="earn-search">Search</Label>
              <Input
                id="earn-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 rounded-lg"
              />
            </div>
          </div>

          {tab === "daily" ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDate")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colIncentive")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colNet")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow
                    key={`${row.driver_id}-${row.earn_date}`}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openDetail(row)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.driver_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{row.driver_code}</p>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.earn_date}</TableCell>
                    <TableCell className="tabular-nums">{row.deliveries}</TableCell>
                    <TableCell className="tabular-nums">{row.incentive_kwd}</TableCell>
                    <TableCell className="tabular-nums font-medium">{row.net_kwd}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {tab === "driver" ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colIncentive")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colNet")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driverRows.map((row) => (
                  <TableRow
                    key={row.group_id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openDriverDetail(row)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.group_name}</p>
                        {row.driver_code ? (
                          <p className="font-mono text-xs text-muted-foreground">
                            {row.driver_code}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.delivery_count}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(row.incentive_kwd).toFixed(3)}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {Number(row.net_kwd).toFixed(3)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {tab === "reports" ? (
            <div className="space-y-4">
              <div className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="report-group">Group by</Label>
                  <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                    <SelectTrigger id="report-group" className="w-48 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="zone">Zone</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="restaurant">Restaurant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className={TABLE_HEAD_CLASS}>Group</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colIncentive")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colNet")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(groupedQuery.data ?? []).map((row, idx) => (
                    <TableRow key={`${String((row as Record<string, unknown>).group_id ?? idx)}-${idx}`}>
                      <TableCell>{String((row as Record<string, unknown>).group_name ?? "—")}</TableCell>
                      <TableCell className="tabular-nums">
                        {Number((row as Record<string, unknown>).delivery_count ?? 0)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {Number((row as Record<string, unknown>).incentive_kwd ?? 0).toFixed(3)}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium">
                        {Number((row as Record<string, unknown>).net_kwd ?? 0).toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="space-y-6">
              <section className="space-y-3">
                <p className="text-sm font-medium">{toolsT("singleDateSection")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-earn-date">{toolsT("earnDate")}</Label>
                    <Input
                      id="tool-earn-date"
                      type="date"
                      value={earnDate}
                      onChange={(e) => setEarnDate(e.target.value)}
                      className="w-44 rounded-lg"
                    />
                  </div>
                  <Button type="button" variant="outline" className="rounded-lg" onClick={handlePreview}>
                    {isToolPending ? <Loader2 className="h-4 w-4 animate-spin" /> : toolsT("preview")}
                  </Button>
                  {canManage ? (
                    <Button type="button" className="rounded-lg" onClick={handleRecalculateDay}>
                      {toolsT("recalculate")}
                    </Button>
                  ) : null}
                </div>
              </section>

              {canManage ? (
                <section className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium">{toolsT("rangeSection")}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="tool-range-start">{toolsT("startDate")}</Label>
                      <Input
                        id="tool-range-start"
                        type="date"
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                        className="w-44 rounded-lg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tool-range-end">{toolsT("endDate")}</Label>
                      <Input
                        id="tool-range-end"
                        type="date"
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                        className="w-44 rounded-lg"
                      />
                    </div>
                    <Button type="button" variant="secondary" className="rounded-lg" onClick={handleRecalculateRange}>
                      {toolsT("recalculateRange")}
                    </Button>
                  </div>
                </section>
              ) : null}

              {preview && preview.drivers.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className={TABLE_HEAD_CLASS} />
                      <TableHead className={TABLE_HEAD_CLASS}>{toolsT("colDriver")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{toolsT("colDeliveries")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{toolsT("colIncentive")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.drivers.map((row) => {
                      const expanded = expandedDriverId === row.driver_id;
                      return (
                        <Fragment key={row.driver_id}>
                          <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpandedDriverId(expanded ? null : row.driver_id)}>
                            <TableCell className="w-8">
                              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.driver_id.slice(0, 8)}…</TableCell>
                            <TableCell className="tabular-nums">{row.deliveries}</TableCell>
                            <TableCell className="tabular-nums">{row.incentive_kwd}</TableCell>
                          </TableRow>
                          {expanded ? (
                            <TableRow>
                              <TableCell colSpan={4} className="bg-muted/20 p-4">
                                {row.rules.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">{toolsT("noRules")}</p>
                                ) : (
                                  <ul className="space-y-1 text-sm">
                                    {row.rules.map((rule, idx) => (
                                      <li key={rule.rule_id ?? `note-${idx}`}>
                                        {rule.note === "override_applied"
                                          ? toolsT("overrideApplied")
                                          : `${rule.rule_name} · ${rule.eligible_count} → ${rule.amount_kwd ?? rule.reward_kwd} KWD`}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}

              <section className="space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">{toolsT("testDeliveryTitle")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-delivery-id">{toolsT("testDeliveryId")}</Label>
                    <Input
                      id="tool-delivery-id"
                      value={deliveryTestId}
                      onChange={(e) => setDeliveryTestId(e.target.value)}
                      className="w-72 rounded-lg font-mono text-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg"
                    onClick={handleValidateDelivery}
                    disabled={isToolPending || !deliveryTestId.trim()}
                  >
                    {toolsT("testValidate")}
                  </Button>
                </div>
                {validation ? (
                  <div className="text-sm">
                    <p className="font-medium">
                      {validation.eligible ? toolsT("eligibleYes") : toolsT("eligibleNo")}
                    </p>
                    <p className="text-muted-foreground">
                      {toolsT("matchedRules", { count: validation.matchedRuleIds.length })}
                    </p>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </AppListCard>

      <EarningsDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        driverId={detailDriverId}
        earnDate={detailEarnDate}
        driverLabel={detailLabel}
      />
    </AppPage>
  );
}
