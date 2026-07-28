"use client";

import { cn } from "@/lib/utils";

const STEPS = [
  { id: "identity" },
  { id: "assignment" },
  { id: "documents" },
] as const;

export type DriverFormStepId = (typeof STEPS)[number]["id"];

export function DriverFormStepper({
  activeStep,
  onStepClick,
  labels,
}: {
  activeStep: DriverFormStepId;
  onStepClick: (stepId: DriverFormStepId) => void;
  labels: Record<DriverFormStepId, string>;
}) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const active = step.id === activeStep;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`Go to ${labels[step.id]}`}
              aria-current={active ? "step" : undefined}
              onClick={() => onStepClick(step.id)}
              className={cn(
                "inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs font-semibold transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {index + 1}
            </button>
            <span className={cn("text-xs", active ? "text-foreground" : "text-muted-foreground")}>
              {labels[step.id]}
            </span>
            {index < STEPS.length - 1 ? <span className="h-px w-5 bg-border" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

