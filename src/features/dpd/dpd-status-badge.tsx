"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function DpdStatusBadge({ status }: { status: string }) {
  const t = useTranslations("pages.dpd");
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
        status === "active" && "bg-success/15 text-success",
        status === "draft" && "bg-muted text-muted-foreground",
        status === "ended" && "bg-destructive/10 text-destructive",
      )}
    >
      {t(`status.${status as "draft" | "active" | "ended"}`)}
    </span>
  );
}
