"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Shield,
  Truck,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/dashboard/status-pill";
import type { AdminActionItem } from "../types";
import {
  DASHBOARD_WIDGET_PREVIEW_LIMIT,
  DashboardWidget,
  DashboardWidgetEmpty,
} from "./dashboard-widget";

function categoryIcon(category: AdminActionItem["category"]) {
  switch (category) {
    case "access":
      return UserPlus;
    case "verification":
      return Shield;
    case "delivery":
      return Truck;
    case "payroll":
      return Wallet;
    case "attendance":
    case "driver":
      return AlertTriangle;
    default:
      return AlertTriangle;
  }
}

function severityVariant(severity: AdminActionItem["severity"]) {
  if (severity === "danger") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "neutral" as const;
}

export function AdminActionQueueWidget({
  items,
  locale,
}: {
  items: AdminActionItem[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const renderItem = (item: AdminActionItem) => {
    const Icon = categoryIcon(item.category);
    return (
      <li key={item.id}>
        <Link
          href={item.href}
          className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
        >
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {t(`adminActions.${item.titleKey}`)}
              </p>
              <StatusPill variant={severityVariant(item.severity)}>
                {t(`alertSeverity.${item.severity}`)}
              </StatusPill>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {new Date(item.at).toLocaleString()}
            </p>
          </div>
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      </li>
    );
  };

  const preview = items.slice(0, DASHBOARD_WIDGET_PREVIEW_LIMIT);
  const hasMore = items.length > preview.length;

  return (
    <DashboardWidget
      title={t("widgetActionQueue")}
      viewAllLabel={t("viewAll")}
      icon={AlertTriangle}
      tone={items.length > 0 ? "warning" : "success"}
      badge={items.length > 0 ? items.length : undefined}
      className="min-h-[320px] lg:col-span-2"
      modalContent={
        hasMore ? (
          <ul className="divide-y divide-border">{items.map(renderItem)}</ul>
        ) : undefined
      }
      modalTitle={t("widgetActionQueue")}
    >
      <ul className="divide-y divide-border">
        {items.length === 0 ? (
          <li>
            <DashboardWidgetEmpty
              icon={Shield}
              title={t("actionQueueClearTitle")}
              hint={t("actionQueueClearHint")}
              tone="success"
            />
          </li>
        ) : (
          preview.map(renderItem)
        )}
      </ul>
    </DashboardWidget>
  );
}
