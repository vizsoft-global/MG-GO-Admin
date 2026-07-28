"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Award,
  CalendarDays,
  CheckCircle2,
  Coins,
  Info,
  Loader2,
  Package,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { MetricTile, Pill } from "@/components/ui/metric-tile";
import { StatusPill } from "@/components/dashboard/status-pill";
import { runGetEarningsDetail } from "./earnings-actions";
import type { EarningsDetailResult } from "@/features/dpd/types";

type EarningsDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string | null;
  earnDate: string | null;
  driverLabel?: string;
};

const KWD_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
};

function formatKwd(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString(undefined, KWD_OPTIONS);
}

function formatLongDate(date: string | null, locale: string): string {
  if (!date) return "—";
  try {
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(d);
  } catch {
    return date;
  }
}

export function EarningsDetailDialog({
  open,
  onOpenChange,
  driverId,
  earnDate,
  driverLabel,
}: EarningsDetailDialogProps) {
  const t = useTranslations("pages.earningsCalculation");
  const locale = useLocale();
  const [detail, setDetail] = useState<EarningsDetailResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !driverId || !earnDate) {
      setDetail(null);
      return;
    }
    startTransition(async () => {
      const result = await runGetEarningsDetail(driverId, earnDate);
      if ("error" in result) {
        setDetail(null);
        return;
      }
      setDetail(result);
    });
  }, [open, driverId, earnDate]);

  const daily = detail?.daily;
  const totalDeliveries = detail?.deliveries.length ?? 0;
  const eligibleDeliveries = detail?.eligible_deliveries_count ?? 0;
  const overrideRule = useMemo(
    () => detail?.rules.find((r) => r.note === "override_applied") ?? null,
    [detail],
  );

  const ruleCards = useMemo(() => {
    if (!detail) return [];
    return detail.rules.filter((r) => r.note !== "override_applied");
  }, [detail]);

  const heading = driverLabel?.trim() || (driverId ? driverId.slice(0, 8) : "—");

  const footerMeta = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        {formatLongDate(earnDate, locale)}
      </span>
      {detail?.wallet?.status === "approved" ? (
        <StatusPill variant="success" dot>
          {t("walletApproved")}
        </StatusPill>
      ) : null}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-3xl"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          {isPending ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : detail ? (
            <>
              <section
                aria-label={t("detailTitle")}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                <MetricTile
                  label={t("colBase")}
                  value={`${formatKwd(daily?.base_kwd)} KWD`}
                  icon={Wallet}
                  tone="neutral"
                />
                <MetricTile
                  label={t("colIncentive")}
                  value={`${formatKwd(daily?.incentive_kwd)} KWD`}
                  icon={Sparkles}
                  tone="primary"
                />
                <MetricTile
                  label={t("colDeliveries")}
                  value={`${eligibleDeliveries} / ${totalDeliveries}`}
                  icon={Package}
                  tone="primary"
                  hint={t("eligibleCount", { count: eligibleDeliveries })}
                />
                <MetricTile
                  label={t("colNet")}
                  value={`${formatKwd(daily?.net_kwd)} KWD`}
                  icon={Coins}
                  tone="success"
                />
              </section>

              {overrideRule ? (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t("overrideApplied")}</span>
                </div>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Award className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {t("rulesApplied")}
                  </h3>
                  {detail.rules.length > 0 ? (
                    <Pill tone="neutral">
                      {detail.rules.length === 1
                        ? "1 rule"
                        : `${detail.rules.length} rules`}
                    </Pill>
                  ) : null}
                </div>
                {ruleCards.length === 0 && !overrideRule ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("noRules")}
                  </div>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {ruleCards.map((rule, idx) => (
                      <li
                        key={`${rule.rule_id ?? rule.note ?? idx}`}
                        className="rounded-lg border border-border bg-card/40 p-3 text-sm shadow-sm transition-colors hover:bg-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {rule.rule_name ?? "—"}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              {rule.period ? (
                                <Pill tone="primary" variant="soft">
                                  {rule.period}
                                </Pill>
                              ) : null}
                              <span>
                                {t("eligibleCount", {
                                  count: rule.eligible_count ?? 0,
                                })}
                              </span>
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                            {formatKwd(rule.amount_kwd ?? rule.reward_kwd)} KWD
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {t("ordersTitle")}
                  </h3>
                  <Pill tone="neutral">
                    {`${eligibleDeliveries} / ${totalDeliveries}`}
                  </Pill>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className={TABLE_HEAD_CLASS}>
                          {t("colOrder")}
                        </TableHead>
                        <TableHead className={TABLE_HEAD_CLASS}>
                          {t("colPartner")}
                        </TableHead>
                        <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                          {t("colCounts")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.deliveries.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="py-8 text-center text-xs text-muted-foreground"
                          >
                            {t("previewEmpty")}
                          </TableCell>
                        </TableRow>
                      ) : (
                        detail.deliveries.map((d) => (
                          <TableRow key={d.id} className="text-xs">
                            <TableCell className="font-mono">
                              {d.external_order_id ?? d.id.slice(0, 8)}
                            </TableCell>
                            <TableCell>
                              <span className="block truncate text-foreground">
                                {d.partner_name ?? "—"}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {d.restaurant_name ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-end">
                              {d.counts_for_earnings ? (
                                <StatusPill variant="success">
                                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                                  {t("countsYes")}
                                </StatusPill>
                              ) : (
                                <StatusPill variant="neutral">
                                  <XCircle className="h-3 w-3" aria-hidden />
                                  {t("countsNo")}
                                </StatusPill>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <Coins className="h-6 w-6 opacity-40" aria-hidden />
              <p>{t("detailEmpty")}</p>
            </div>
          )}
        </div>
        <AppModalFooter
          title={`${t("detailTitle")} · ${heading}`}
          subtitle={formatLongDate(earnDate, locale)}
          meta={footerMeta}
        />
      </DialogContent>
    </Dialog>
  );
}
