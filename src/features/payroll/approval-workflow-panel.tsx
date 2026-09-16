"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ApprovalWorkflowPanel({
  awaitingAction,
  requestsPerRider,
}: {
  awaitingAction: number;
  requestsPerRider: number;
}) {
  const t = useTranslations("pages.payroll.workflow");
  const steps = [
    { title: t("step1Title"), body: t("step1Body") },
    { title: t("step2Title"), body: t("step2Body") },
    { title: t("step3Title"), body: t("step3Body") },
    { title: t("step4Title"), body: t("step4Body") },
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="mb-3 text-[11px] text-muted-foreground">{t("subtitle")}</p>
      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={step.title} className="relative flex gap-2.5 pb-4 last:pb-0">
            {i < steps.length - 1 ? (
              <span className="absolute start-[13px] top-7 bottom-0 w-0.5 bg-border" />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-extrabold",
                i < 3
                  ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <div>
              <p className="text-[12.5px] font-semibold">{step.title}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[10.5px] font-bold text-muted-foreground">{t("awaiting")}</p>
          <p className="text-base font-bold">{awaitingAction}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[10.5px] font-bold text-muted-foreground">{t("perRider")}</p>
          <p className="text-base font-bold">{requestsPerRider.toFixed(1)}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
