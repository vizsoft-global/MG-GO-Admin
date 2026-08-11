"use client";

import { CheckCircle2, Circle, XCircle } from "lucide-react";
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
                  step.status === "pending" && "text-muted-foreground",
                )}
              >
                {step.step_order}. {step.step_name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isCompleted
                  ? formatStamp(step.decided_at)
                  : isRejected
                    ? `${t("detail.stepRejected")}${step.decided_at ? ` · ${formatStamp(step.decided_at)}` : ""}`
                    : isActive
                      ? t("detail.stepWaiting")
                      : t("detail.stepNotStarted")}
              </p>
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
