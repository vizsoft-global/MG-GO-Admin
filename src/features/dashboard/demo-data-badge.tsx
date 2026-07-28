"use client";

import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DemoDataBadge({ tooltipKey }: { tooltipKey?: string }) {
  const t = useTranslations("pages.dashboard");

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          className="cursor-default rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {t("demoBadge")}
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs">
          {tooltipKey ? t(tooltipKey as "demoPresenceTooltip") : t("demoTooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
