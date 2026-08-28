"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { pct, rawPct, ratingPeriodMonth } from "./performance-formulas";
import { PerformanceComponentBreakdown } from "./performance-component-breakdown";
import { PerformanceRatingPanel } from "./performance-rating-panel";
import { useDriverPerformanceDetail } from "./use-performance";
import type {
  PerformanceComponent,
  PerformanceDriverRow,
} from "./performance-types";

function MetricBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function DrilldownBody({
  row,
  components,
  fromDate,
  toDate,
  onClose,
}: {
  row: PerformanceDriverRow;
  components: PerformanceComponent[];
  fromDate: string;
  toDate: string;
  onClose: () => void;
}) {
  const t = useTranslations("pages.performance");
  const { data, isLoading } = useDriverPerformanceDetail(
    row.driver_id,
    fromDate,
    toDate,
  );
  const detail = data ?? row;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-medium text-primary">
                {detail.driver_code}
              </span>
              {detail.partner_name ? <span>{detail.partner_name}</span> : null}
              {detail.zone_name ? <span>· {detail.zone_name}</span> : null}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricBlock
                label={t("kpiOverall")}
                value={String(detail.overall_score)}
              />
              <MetricBlock
                label={t("colDeliveryPct")}
                value={rawPct(detail.delivery_efficiency_raw, 0)}
                hint={`${detail.actual_deliveries}/${detail.target_deliveries}`}
              />
              <MetricBlock
                label={t("colUtilization")}
                value={pct(detail.utilization, 0)}
                hint={t("daysHint", {
                  worked: detail.worked_days,
                  eligible: detail.eligible_days,
                })}
              />
              <MetricBlock
                label={t("colCompliance")}
                value={
                  detail.compliance_score == null
                    ? "—"
                    : `${Math.round(detail.compliance_score)}%`
                }
                hint={t("exceptionsCount", {
                  count: detail.penalised_exception_count,
                })}
              />
            </div>

            <PerformanceComponentBreakdown
              scores={detail.component_scores}
              components={components}
              compliance={detail.compliance_score}
            />

            <PerformanceRatingPanel
              driverId={detail.driver_id}
              periodMonth={ratingPeriodMonth(toDate)}
              rangeScore={detail.manual_score}
              rangeTeamCount={detail.manual_rating_count}
            />

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-border p-2">
                <p className="text-muted-foreground">{t("workedDays")}</p>
                <p className="font-semibold tabular-nums">{detail.worked_days}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="text-muted-foreground">{t("leaveDays")}</p>
                <p className="font-semibold tabular-nums">{detail.leave_days}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="text-muted-foreground">{t("absentDays")}</p>
                <p className="font-semibold tabular-nums">{detail.absent_days}</p>
              </div>
            </div>

            {detail.exceptions.length > 0 ? (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium">
                  {t("exceptionsTitle")}
                </p>
                <ul className="max-h-36 divide-y divide-border overflow-y-auto text-xs">
                  {detail.exceptions.slice(0, 8).map((ex, i) => (
                    <li
                      key={`${ex.exception_type}-${ex.exception_date}-${i}`}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                    >
                      <span>{ex.exception_type}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {ex.exception_date}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {t("noExceptions")}
              </p>
            )}

            <p className="text-[10px] text-muted-foreground">{t("weightsNote")}</p>
          </>
        )}
      </div>

      <div className="mt-auto px-5 pb-4">
        <AppModalFooter
          title={detail.driver_name}
          subtitle={t("drilldownSubtitle", { from: fromDate, to: toDate })}
        >
          <Link
            href={`/attendance/drivers/${detail.driver_id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-primary hover:bg-primary/10"
          >
            <ExternalLink className="size-3.5" />
            {t("openAttendance")}
          </Link>
          <Link
            href={`/drivers/${detail.driver_id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-primary hover:bg-primary/10"
          >
            <ExternalLink className="size-3.5" />
            {t("openDriver")}
          </Link>
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            {t("close")}
          </Button>
        </AppModalFooter>
      </div>
    </div>
  );
}

export function PerformanceDrilldownSheet({
  row,
  components = [],
  open,
  onOpenChange,
  fromDate,
  toDate,
}: {
  row: PerformanceDriverRow | null;
  components?: PerformanceComponent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromDate: string;
  toDate: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,720px)] w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton
        closeOutside
      >
        {open && row ? (
          <DrilldownBody
            key={row.driver_id}
            row={row}
            components={components}
            fromDate={fromDate}
            toDate={toDate}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
