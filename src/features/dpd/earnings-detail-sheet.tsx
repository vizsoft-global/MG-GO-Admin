"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { runGetEarningsDetail } from "@/features/dpd/dpd-actions";
import type { EarningsDetailResult } from "@/features/dpd/types";

type EarningsDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string | null;
  earnDate: string | null;
  driverLabel?: string;
};

export function EarningsDetailSheet({
  open,
  onOpenChange,
  driverId,
  earnDate,
  driverLabel,
}: EarningsDetailSheetProps) {
  const t = useTranslations("pages.earningsCalculation");
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("detailTitle")}</SheetTitle>
          <SheetDescription>
            {driverLabel ?? driverId?.slice(0, 8)} · {earnDate}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
        {isPending ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <div className="space-y-6">
            <section className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">{t("colBase")}</p>
                <p className="font-medium tabular-nums">{daily?.base_kwd ?? 0} KWD</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("colIncentive")}</p>
                <p className="font-medium tabular-nums">{daily?.incentive_kwd ?? 0} KWD</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("colDeliveries")}</p>
                <p className="font-medium tabular-nums">
                  {detail.eligible_deliveries_count} / {detail.deliveries.length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("colNet")}</p>
                <p className="font-semibold tabular-nums">{daily?.net_kwd ?? 0} KWD</p>
              </div>
              {detail.wallet ? (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground">{t("walletApproved")}</p>
                  <p className="font-medium tabular-nums">
                    {detail.wallet.amount_kwd} KWD ({detail.wallet.status})
                  </p>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("rulesApplied")}</h3>
              {detail.rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noRules")}</p>
              ) : (
                <div className="space-y-2">
                  {detail.rules.map((rule, idx) => (
                    <div
                      key={`${rule.rule_id ?? rule.note ?? idx}`}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      {rule.note === "override_applied" ? (
                        <p className="font-medium text-amber-600 dark:text-amber-400">
                          {t("overrideApplied")}
                        </p>
                      ) : (
                        <>
                          <p className="font-medium">{rule.rule_name}</p>
                          <p className="text-muted-foreground">
                            {rule.period} · {t("eligibleCount", { count: rule.eligible_count ?? 0 })}
                          </p>
                          <p className="tabular-nums">{rule.amount_kwd ?? rule.reward_kwd} KWD</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("ordersTitle")}</h3>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colOrder")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colPartner")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colCounts")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">
                        {d.external_order_id ?? d.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {[d.partner_name, d.restaurant_name].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {d.counts_for_earnings ? t("countsYes") : t("countsNo")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("detailEmpty")}</p>
        )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
