"use client";

import { AlertTriangle, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { SystemStatusSummary } from "../types";

export function SystemStatusBanner({
  status,
  locale,
}: {
  status: SystemStatusSummary;
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  if (!status.maintenanceMode) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-foreground">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-bg text-warning">
        <Wrench className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{t("maintenanceBannerTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("maintenanceBannerHint")}</p>
      </div>
      <Link
        href={`/${locale}/settings/maintenance`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10"
      >
        <AlertTriangle className="size-3.5" />
        {t("maintenanceBannerAction")}
      </Link>
    </div>
  );
}
