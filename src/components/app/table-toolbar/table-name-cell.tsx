"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function TableNameCell({ name }: { name: string | null | undefined }) {
  const t = useTranslations("common.tableToolbar");
  const missing = name == null || name.trim() === "";
  if (missing) {
    return (
      <span className="inline-flex h-6 items-center rounded-md border border-amber-200 bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
        {t("nameMissing")}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="block whitespace-normal break-words text-sm text-foreground">{name}</span>
        }
      />
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}
