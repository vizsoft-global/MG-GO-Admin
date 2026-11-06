"use client";

import { PencilLine, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ImportWizardMode } from "../wizard-state";

const MODES = [
  { value: "add", icon: UserPlus, titleKey: "modeAddTitle", hintKey: "modeAddHint" },
  {
    value: "update",
    icon: PencilLine,
    titleKey: "modeUpdateTitle",
    hintKey: "modeUpdateHint",
  },
] as const;

/**
 * Step 1. The question the old dialog never asked: is this sheet creating people
 * or changing people? Every later step reads the answer — the required set, the
 * default column selection and the duplicate strategy.
 */
export function ImportStepMode({
  mode,
  onSelect,
}: {
  mode: ImportWizardMode;
  onSelect: (mode: ImportWizardMode) => void;
}) {
  const t = useTranslations("pages.drivers.import.wizard");

  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("modeTitle")}>
      {MODES.map(({ value, icon: Icon, titleKey, hintKey }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(value)}
            className={cn(
              "flex h-full cursor-pointer flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">{t(titleKey)}</span>
            <span className="text-xs leading-snug text-muted-foreground">{t(hintKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
