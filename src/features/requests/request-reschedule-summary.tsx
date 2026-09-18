"use client";

import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { formatKuwaitDateLabel } from "@/lib/date/kuwait-dates";
import { cn } from "@/lib/utils";
import { RequestFieldRow } from "./request-field-row";
import {
  parseReschedulePayload,
  type RescheduleStatus,
} from "./request-reschedule-payload";

const STATUS_TONE: Record<RescheduleStatus, string> = {
  awaiting: "border-warning/30 bg-warning-bg text-warning",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  declined: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function RequestRescheduleSummary({ payload }: { payload: unknown }) {
  const t = useTranslations("pages.requests.detail.reschedule");
  const parsed = parseReschedulePayload(payload);
  if (!parsed) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="h-3.5 w-3.5 text-primary" />
          {t("summaryTitle")}
        </h2>
        <span
          className={cn(
            "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            STATUS_TONE[parsed.status],
          )}
        >
          {t(
            parsed.status === "accepted"
              ? "statusAccepted"
              : parsed.status === "declined"
                ? "statusDeclined"
                : "statusAwaiting",
          )}
        </span>
      </div>
      <div className="divide-y divide-border/60">
        <RequestFieldRow label={t("newStart")}>
          {parsed.proposedStart ? formatKuwaitDateLabel(parsed.proposedStart) : "—"}
        </RequestFieldRow>
        <RequestFieldRow label={t("newEnd")}>
          {parsed.proposedEnd ? formatKuwaitDateLabel(parsed.proposedEnd) : "—"}
        </RequestFieldRow>
        <RequestFieldRow label={t("note")} muted={!parsed.note}>
          {parsed.note ?? "—"}
        </RequestFieldRow>
        <RequestFieldRow label={t("riderNote")} muted={!parsed.driverNote}>
          {parsed.driverNote ?? "—"}
        </RequestFieldRow>
      </div>
    </section>
  );
}
