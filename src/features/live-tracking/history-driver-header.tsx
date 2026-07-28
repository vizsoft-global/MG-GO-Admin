"use client";

import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/metric-tile";

export function HistoryDriverHeader({
  name,
  code,
  zoneName,
  isOnDuty,
  dateLabel,
  avatarUrl,
}: {
  name: string;
  code: string;
  zoneName?: string | null;
  isOnDuty?: boolean;
  dateLabel: string;
  avatarUrl?: string | null;
}) {
  const t = useTranslations("pages.liveTracking");
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-start gap-2.5">
        <Avatar className="h-10 w-10 shrink-0 rounded-lg">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className={cn("rounded-lg text-sm font-semibold", avatarTintFromName(name))}>
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">#{code}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{zoneName ?? "—"}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          <Bike className="h-3 w-3" />
          Bike
        </span>
        <Pill tone={isOnDuty ? "success" : "neutral"}>{isOnDuty ? t("onDuty") : t("offDuty")}</Pill>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{dateLabel}</p>
    </div>
  );
}
