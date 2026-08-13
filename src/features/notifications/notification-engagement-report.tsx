"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { exportNotificationDispatchItemsCsv } from "./notifications-actions";
import type { NotificationDispatchItemRow } from "./notifications-actions";
import { isHardPushFailure, isPushSkippedNoToken } from "./dispatch-outcome";

type EngagementTab = "all" | "seen" | "not_seen" | "tapped" | "failed";

function friendlyDeliveryStatus(item: NotificationDispatchItemRow, t: ReturnType<typeof useTranslations>) {
  if (isPushSkippedNoToken(item)) {
    return item.engagement_seen || item.status === "opened" || item.status === "clicked"
      ? t("engagementInAppOnly")
      : t("engagementInAppPushSkipped");
  }
  if (isHardPushFailure(item)) {
    return item.engagement_seen || item.status === "opened" || item.status === "clicked"
      ? t("engagementInAppPushFailed")
      : t("engagementNotDelivered");
  }
  if (item.status === "skipped") return t("engagementNotDelivered");
  if (
    item.status === "sent" ||
    item.status === "delivered" ||
    item.status === "opened" ||
    item.status === "clicked"
  ) {
    return t("engagementDelivered");
  }
  return t("engagementPending");
}

export function NotificationEngagementReport({
  campaignId,
  items,
  trackEngagement,
}: {
  campaignId: string;
  items: NotificationDispatchItemRow[];
  trackEngagement: boolean;
}) {
  const t = useTranslations("pages.notifications");
  const [tab, setTab] = useState<EngagementTab>("all");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!trackEngagement && (tab === "seen" || tab === "not_seen" || tab === "tapped")) {
      setTab("all");
    }
  }, [trackEngagement, tab]);

  const stats = useMemo(() => {
    const sent = items.filter(
      (i) =>
        !isPushSkippedNoToken(i) &&
        !isHardPushFailure(i) &&
        (i.status === "sent" ||
          i.status === "delivered" ||
          i.status === "opened" ||
          i.status === "clicked"),
    ).length;
    const seen = trackEngagement
      ? items.filter((i) => i.engagement_seen).length
      : null;
    const tapped = trackEngagement
      ? items.filter((i) => i.engagement_tapped).length
      : null;
    const failed = items.filter((i) => isHardPushFailure(i)).length;
    const pushSkipped = items.filter((i) => isPushSkippedNoToken(i)).length;
    return { sent, seen, tapped, failed, noApp: pushSkipped, total: items.length };
  }, [items, trackEngagement]);

  const filtered = useMemo(() => {
    if (!trackEngagement && (tab === "seen" || tab === "not_seen" || tab === "tapped")) {
      return items;
    }
    switch (tab) {
      case "seen":
        return items.filter((i) => i.engagement_seen);
      case "not_seen":
        return items.filter((i) => !i.engagement_seen && !isHardPushFailure(i));
      case "tapped":
        return items.filter((i) => i.engagement_tapped);
      case "failed":
        return items.filter((i) => isHardPushFailure(i) || isPushSkippedNoToken(i));
      default:
        return items;
    }
  }, [items, tab, trackEngagement]);

  const seenRate =
    trackEngagement && stats.sent > 0 && stats.seen != null
      ? Math.round((stats.seen / stats.sent) * 100)
      : 0;

  const handleExport = () => {
    startTransition(async () => {
      const result = await exportNotificationDispatchItemsCsv(campaignId);
      if ("error" in result) {
        toast.error(t("errors.not_authorized"));
        return;
      }
      const blob = new Blob(["\uFEFF" + result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notification-recipients-${campaignId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{t("engagementReportTitle")}</p>
        <Button variant="outline" size="sm" className="h-9 cursor-pointer" disabled={pending} onClick={handleExport}>
          <Download className="size-4" />
          {t("exportRecipients")}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: t("engagementSent"), value: String(stats.sent) },
          {
            label: t("engagementSeen"),
            value: stats.seen == null ? t("engagementNotTracked") : String(stats.seen),
          },
          {
            label: t("engagementTapped"),
            value: stats.tapped == null ? t("engagementNotTracked") : String(stats.tapped),
          },
          { label: t("engagementFailed"), value: String(stats.failed) },
          { label: t("engagementPushSkipped"), value: String(stats.noApp) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
            <p className="text-lg font-semibold">{kpi.value}</p>
          </div>
        ))}
      </div>
      {trackEngagement ? (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>{t("engagementSeenRate")}</span>
            <span className="font-medium">{seenRate}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-success transition-[width]" style={{ width: `${seenRate}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("engagementTrackingOff")}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {(
          (
            trackEngagement
              ? ([
                  ["all", t("engagementTabAll")],
                  ["seen", t("engagementTabSeen")],
                  ["not_seen", t("engagementTabNotSeen")],
                  ["tapped", t("engagementTabTapped")],
                  ["failed", t("engagementTabPushIssues")],
                ] as const)
              : ([
                  ["all", t("engagementTabAll")],
                  ["failed", t("engagementTabPushIssues")],
                ] as const)
          )
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              tab === id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("engagementColSeen")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("engagementColTapped")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("engagementColDelivery")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.driver_label}</TableCell>
                <TableCell>{item.employee_id ?? "—"}</TableCell>
                <TableCell>
                  {trackEngagement ? (
                    <>
                      <StatusPill variant={item.engagement_seen ? "success" : "neutral"}>
                        {item.engagement_seen ? t("engagementYes") : t("engagementNo")}
                      </StatusPill>
                      {item.opened_at ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {new Date(item.opened_at).toLocaleString()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <StatusPill variant="neutral">{t("engagementNotTracked")}</StatusPill>
                  )}
                </TableCell>
                <TableCell>
                  {trackEngagement ? (
                    <StatusPill variant={item.engagement_tapped ? "success" : "neutral"}>
                      {item.engagement_tapped ? t("engagementYes") : t("engagementNo")}
                    </StatusPill>
                  ) : (
                    <StatusPill variant="neutral">{t("engagementNotTracked")}</StatusPill>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {friendlyDeliveryStatus(item, t)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
