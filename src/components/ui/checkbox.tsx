"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({
  className,
  tone = "default",
  locked = false,
  disabled,
  ...props
}: CheckboxPrimitive.Root.Props & {
  tone?: "default" | "portal";
  locked?: boolean;
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-tone={tone}
      disabled={disabled || locked}
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground/80 bg-background shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        "dark:data-checked:border-primary dark:data-checked:bg-primary dark:data-checked:text-primary-foreground",
        tone === "portal" &&
          "size-[18px] rounded-[4px] border-[1.5px] border-[var(--portal-check-border)] bg-[var(--portal-canvas)] shadow-none data-checked:border-[var(--portal-btn)] data-checked:bg-[var(--portal-btn)] data-checked:text-[var(--portal-btn-fg)]",
        locked &&
          "border-[var(--portal-locked-border)] bg-[var(--portal-locked-bg)] text-[var(--portal-muted)] opacity-100",
        className,
      )}
      {...props}
    >
      {locked ? (
        <Lock className="size-2.5" />
      ) : (
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-indicator"
          className="grid place-content-center text-current"
        >
          <CheckIcon className="size-3 stroke-[3]" />
        </CheckboxPrimitive.Indicator>
      )}
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
