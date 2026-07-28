"use client";

import type { LucideIcon } from "lucide-react";
import {
  Clock3,
  ShieldAlert,
  UserCheck,
  Users,
  UserX,
  Wifi,
} from "lucide-react";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";

type KpiItem = {
  id: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: Tone;
};

export function DriversKpiStrip({
  total,
  activeToday,
  onlineNow,
  inactive,
  pendingVerification,
  suspended,
  labels,
}: {
  total: number;
  activeToday: number;
  onlineNow: number;
  inactive: number;
  pendingVerification: number;
  suspended: number;
  labels: {
    total: string;
    activeToday: string;
    onlineNow: string;
    inactive: string;
    pending: string;
    suspended: string;
  };
}) {
  const items: KpiItem[] = [
    { id: "total", label: labels.total, value: total, icon: Users, tone: "primary" },
    {
      id: "active",
      label: labels.activeToday,
      value: activeToday,
      icon: UserCheck,
      tone: "success",
    },
    {
      id: "online",
      label: labels.onlineNow,
      value: onlineNow,
      icon: Wifi,
      tone: "primary",
    },
    {
      id: "inactive",
      label: labels.inactive,
      value: inactive,
      icon: UserX,
      tone: "neutral",
    },
    {
      id: "pending",
      label: labels.pending,
      value: pendingVerification,
      icon: Clock3,
      tone: "warning",
    },
    {
      id: "suspended",
      label: labels.suspended,
      value: suspended,
      icon: ShieldAlert,
      tone: "danger",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <MetricTile
          key={item.id}
          label={item.label}
          value={item.value.toLocaleString()}
          icon={item.icon}
          tone={item.tone}
          className="p-2.5"
        />
      ))}
    </div>
  );
}
