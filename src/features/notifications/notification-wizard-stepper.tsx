"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  id: string;
  label: string;
};

export function NotificationWizardStepper({
  steps,
  currentStepId,
  completedStepIds,
}: {
  steps: WizardStep[];
  currentStepId: string;
  completedStepIds: string[];
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);

  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const isComplete = completedStepIds.includes(step.id);
        const isCurrent = step.id === currentStepId;
        const isPast = index < currentIndex;
        const showComplete = isPast && isComplete;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                showComplete && "border-emerald-500 bg-emerald-500 text-white",
                !isCurrent && !showComplete && "border-border text-muted-foreground",
              )}
            >
              {showComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-xs font-medium",
                isCurrent ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span className="mx-1 hidden h-px w-6 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
