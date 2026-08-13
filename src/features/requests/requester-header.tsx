"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import type { RequestRequester } from "./types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function RequesterHeader({
  driverId,
  requester,
}: {
  driverId: string;
  requester: RequestRequester | null;
}) {
  const t = useTranslations("pages.requests");
  const name = requester?.name || "—";

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            avatarTintFromName(name),
          )}
        >
          {initials(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[
              requester?.zone ? t("zoneLabel", { zone: requester.zone }) : null,
              requester?.phone || null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0"
        render={<Link href={`/drivers/${driverId}`} />}
      >
        <ExternalLink className="me-1.5 h-3.5 w-3.5" />
        {t("detail.viewProfile")}
      </Button>
    </div>
  );
}
