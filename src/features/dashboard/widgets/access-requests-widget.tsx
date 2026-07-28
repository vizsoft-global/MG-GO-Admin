"use client";

import { Clock, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Pill, type Tone } from "@/components/ui/metric-tile";
import type { AccessRequestRow } from "../types";
import {
  DASHBOARD_WIDGET_PREVIEW_LIMIT,
  DashboardWidget,
  DashboardWidgetEmpty,
} from "./dashboard-widget";

function ageTone(bucket: AccessRequestRow["ageBucket"]): Tone {
  if (bucket === "stale") return "danger";
  if (bucket === "waiting") return "warning";
  return "primary";
}

function initials(name: string | null): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function AccessRequestsWidget({
  rows,
  locale,
}: {
  rows: AccessRequestRow[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const renderRow = (row: AccessRequestRow) => (
    <li
      key={row.id}
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/20"
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials(row.fullName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{row.fullName ?? "—"}</p>
        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="size-3" />
          {new Date(row.createdAt).toLocaleString()}
        </p>
      </div>
      <Pill tone={ageTone(row.ageBucket)}>{t(`accessAge.${row.ageBucket}`)}</Pill>
    </li>
  );

  const preview = rows.slice(0, DASHBOARD_WIDGET_PREVIEW_LIMIT);
  const hasMore = rows.length > preview.length;

  return (
    <DashboardWidget
      title={t("widgetAccessRequests")}
      href={hasMore ? undefined : `/${locale}/settings/access-requests`}
      viewAllLabel={t("viewAll")}
      icon={UserPlus}
      tone={rows.some((r) => r.ageBucket === "stale") ? "danger" : "primary"}
      badge={rows.length > 0 ? rows.length : undefined}
      modalContent={
        hasMore ? <ul className="divide-y divide-border">{rows.map(renderRow)}</ul> : undefined
      }
      modalTitle={t("widgetAccessRequests")}
    >
      <ul className="divide-y divide-border">
        {rows.length === 0 ? (
          <li>
            <DashboardWidgetEmpty
              icon={UserPlus}
              title={t("accessRequestsEmptyTitle")}
              hint={t("accessRequestsEmptyHint")}
              tone="neutral"
            />
          </li>
        ) : (
          preview.map(renderRow)
        )}
      </ul>
    </DashboardWidget>
  );
}
