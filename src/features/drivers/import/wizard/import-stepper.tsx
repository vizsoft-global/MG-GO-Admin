"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  IMPORT_WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  stepIndex,
  type ImportWizardStep,
} from "../wizard-state";

/**
 * The numbered rail across the top of the wizard. Every step is named, so the
 * operator always knows how much of the flow is left — the thing the old
 * one-screen dialog could not tell them.
 */
export function ImportStepper({
  current,
  onJump,
}: {
  current: ImportWizardStep;
  /** Only steps already behind the operator are jumpable. */
  onJump: (step: ImportWizardStep) => void;
}) {
  const t = useTranslations("pages.drivers.import.wizard");
  const currentIndex = stepIndex(current);

  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("stepsLabel")}>
      {IMPORT_WIZARD_STEPS.map((step, index) => {
        const state =
          index === currentIndex ? "current" : index < currentIndex ? "done" : "todo";
        const label = t(WIZARD_STEP_LABELS[step]);
        return (
          <li key={step} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={state !== "done"}
              onClick={() => onJump(step)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                state === "current" && "bg-primary/10 text-foreground",
                state === "done" && "cursor-pointer text-muted-foreground hover:bg-muted",
                state === "todo" && "cursor-default text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[9px] tabular-nums",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "done" && "bg-emerald-500/15 text-emerald-700",
                  state === "todo" && "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {index < IMPORT_WIZARD_STEPS.length - 1 ? (
              <span className="h-px w-3 bg-border" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
