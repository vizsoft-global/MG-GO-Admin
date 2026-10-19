"use client";

import {
  AlertTriangle,
  ClipboardX,
  ShieldAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "../types";

export function AdminKpiBar({
  kpis,
  canViewDrivers = false,
}: {
  kpis: DashboardKpis;
  canViewDrivers?: boolean;
}) {
  const t = useTranslations("pages.dashboard");

  const items: Array<{
    label: string;
    value: number;
    icon: typeof UserPlus;
    tone: Tone;
    href?: string;
    hint?: string;
  }> = [
    {
      label: t("kpiPendingAccess"),
      value: kpis.pendingAccessRequests,
      icon: UserPlus,
      tone: kpis.pendingAccessRequests > 0 ? "warning" : "neutral",
    },
  ];

  if (canViewDrivers) {
    items.push({
      label: t("kpiPendingEmployees"),
      value: kpis.pendingEmployeeVerifications,
      icon: UserCheck,
      tone: kpis.pendingEmployeeVerifications > 0 ? "warning" : "success",
      href: "/drivers?tab=pending",
      hint: kpis.pendingEmployeeVerifications > 0 ? t("kpiPendingEmployeesHint") : undefined,
    });
  }

  items.push(
    {
      label: t("kpiVerificationBacklog"),
      value: kpis.verificationBacklog,
      icon: ClipboardX,
      tone: kpis.verificationBacklog > 0 ? "warning" : "neutral",
    },
    {
      label: t("kpiDeliveryReview"),
      value: kpis.deliveryReviewPending,
      icon: ShieldAlert,
      tone: kpis.deliveryReviewPending > 0 ? "danger" : "neutral",
    },
    {
      label: t("kpiPayrollBlockers"),
      value: kpis.payrollBlockers,
      icon: Wallet,
      tone: kpis.payrollBlockers > 0 ? "danger" : "success",
    },
    {
      label: t("kpiDriverExceptions"),
      value: kpis.driverExceptions,
      icon: AlertTriangle,
      tone: kpis.driverExceptions > 0 ? "warning" : "success",
    },
    {
      label: t("kpiAbsentToday"),
      value: kpis.absentToday,
      icon: UserMinus,
      tone: kpis.absentToday > 0 ? "danger" : "success",
    },
  );

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3",
        items.length > 6 ? "xl:grid-cols-7" : "xl:grid-cols-6",
      )}
    >
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className="group block cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <MetricTile
              label={item.label}
              value={item.value}
              icon={item.icon}
              tone={item.tone}
              hint={item.hint}
              className="h-full transition-colors duration-150 group-hover:border-primary/40"
            />
          </Link>
        ) : (
          <MetricTile
            key={item.label}
            label={item.label}
            value={item.value}
            icon={item.icon}
            tone={item.tone}
          />
        ),
      )}
    </div>
  );
}
