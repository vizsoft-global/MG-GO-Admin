"use client";

import { AlertTriangle, CheckCircle2, Circle, XCircle, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { RequestApprovalStep } from "./types";

/** Pinned locale + Kuwait time so SSR and the browser render the same stamp. */
const STAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatStamp(value: string | null): string {
  if (!value) return "";
  return STAMP_FORMAT.format(new Date(value));
}

/** Figma approval-progress checklist — shared by the detail page and the typed drawer. */
export function RequestApprovalTimeline({ steps }: { steps: RequestApprovalStep[] }) {
  const t = useTranslations("pages.requests");

  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isCompleted = step.status === "completed";
        const isActive = step.status === "in_progress";
        const isRejected = step.status === "rejected";
        const isSkipped = step.status === "skipped";
        const breached = isActive && step.sla_breached_at != null;
        const overdue =
          breached ||
          (isActive && step.sla_due_at != null && new Date(step.sla_due_at) < new Date());

        return (
          <li key={step.id} className={cn("relative flex gap-2.5", isLast ? "pb-0" : "pb-3")}>
            {!isLast ? (
              <span
                className="absolute top-5 left-[9px] w-px bg-border"
                style={{ height: "calc(100% - 8px)" }}
              />
            ) : null}
            <span className="relative z-10 mt-0.5 shrink-0">
              {isCompleted ? (
                <CheckCircle2 className="h-[18px] w-[18px] text-success" />
              ) : isRejected ? (
                <XCircle className="h-[18px] w-[18px] text-danger" />
              ) : isSkipped ? (
                <MinusCircle className="h-[18px] w-[18px] text-muted-foreground/40" />
              ) : overdue ? (
                <AlertTriangle className="h-[18px] w-[18px] text-danger" />
              ) : isActive ? (
                <Circle className="h-[18px] w-[18px] fill-warning text-warning" />
              ) : (
                <Circle className="h-[18px] w-[18px] text-muted-foreground/40" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  isActive && "text-foreground",
                  (step.status === "pending" || isSkipped) && "text-muted-foreground",
                )}
              >
                {step.step_order}. {step.step_name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isCompleted
                  ? formatStamp(step.decided_at)
                  : isRejected
                    ? `${t("detail.stepRejected")}${step.decided_at ? ` · ${formatStamp(step.decided_at)}` : ""}`
                    : isSkipped
                      ? t("detail.stepSkipped")
                      : isActive
                        ? step.started_at
                          ? t("detail.stepSince", { stamp: formatStamp(step.started_at) })
                          : t("detail.stepWaiting")
                        : t("detail.stepNotStarted")}
              </p>
              {step.actor_display_name ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("detail.stepActor", { name: step.actor_display_name })}
                </p>
              ) : null}
              {isActive && step.sla_due_at ? (
                <p className={cn("text-[11px]", overdue ? "text-danger" : "text-muted-foreground")}>
                  {t(overdue ? "detail.stepSlaBreached" : "detail.stepSlaDue", {
                    stamp: formatStamp(step.sla_due_at),
                  })}
                </p>
              ) : null}
              {step.decision_note ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground italic">
                  {step.decision_note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
