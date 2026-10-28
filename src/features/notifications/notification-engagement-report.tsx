"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
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
  campaignTitle = "",
  campaignBody = "",
}: {
  campaignId: string;
  items: NotificationDispatchItemRow[];
  trackEngagement: boolean;
  campaignTitle?: string;
  campaignBody?: string;
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

  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "driver", label: t("colDriver"), locked: true },
    { id: "employee", label: t("colEmployeeId") },
    { id: "title", label: t("colSentTitle") },
    { id: "body", label: t("colSentBody") },
    { id: "seen", label: t("engagementColSeen") },
    { id: "tapped", label: t("engagementColTapped") },
    { id: "delivery", label: t("engagementColDelivery") },
  ], [t]);
  const prefs = useTablePrefs(`notification-engagement-${campaignId}`, columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const needle = prefs.appliedQuery.trim().toLowerCase();
  const visibleItems = filtered.filter((item) =>
    !needle || `${item.driver_label} ${item.employee_id ?? ""} ${item.resolved_title ?? ""} ${item.resolved_body ?? ""}`.toLowerCase().includes(needle),
  );

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
        {pending ? <span className="text-xs text-muted-foreground">{t("exportRecipients")}</span> : null}
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
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
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
        <TableToolbar
          prefs={prefs}
          entity={t("engagementReportTitle")}
          columns={columns}
          rowKind="dynamic"
          filteredCount={visibleItems.length}
          totalCount={filtered.length}
          onExport={handleExport}
        />
        <Table>
          <TableHeader>
            <TableRow>
              {shown.map((column) => (
                <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item) => (
              <TableRow key={item.id}>
                {shown.map((column) => {
                  if (column.id === "driver") {
                    return <TableCell key={column.id}><TableNameCell name={item.driver_label} /></TableCell>;
                  }
                  if (column.id === "employee") {
                    return <TableCell key={column.id}>{item.employee_id ? item.employee_id : <EmptyCell />}</TableCell>;
                  }
                  if (column.id === "title") {
                    const title = item.resolved_title?.trim() || campaignTitle;
                    return <TableCell key={column.id} className="max-w-[240px] whitespace-normal">{title ? title : <EmptyCell />}</TableCell>;
                  }
                  if (column.id === "body") {
                    const body = item.resolved_body?.trim() || campaignBody;
                    return <TableCell key={column.id} className="max-w-[360px] whitespace-normal">{body ? body : <EmptyCell />}</TableCell>;
                  }
                  if (column.id === "seen") {
                    return (
                      <TableCell key={column.id}>
                        {trackEngagement ? (
                          <>
                            <StatusPill variant={item.engagement_seen ? "success" : "neutral"}>
                              {item.engagement_seen ? t("engagementYes") : t("engagementNo")}
                            </StatusPill>
                            {item.opened_at ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {new Date(item.opened_at).toLocaleString()}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <StatusPill variant="neutral">{t("engagementNotTracked")}</StatusPill>
                        )}
                      </TableCell>
                    );
                  }
                  if (column.id === "tapped") {
                    return (
                      <TableCell key={column.id}>
                        {trackEngagement ? (
                          <StatusPill variant={item.engagement_tapped ? "success" : "neutral"}>
                            {item.engagement_tapped ? t("engagementYes") : t("engagementNo")}
                          </StatusPill>
                        ) : (
                          <StatusPill variant="neutral">{t("engagementNotTracked")}</StatusPill>
                        )}
                      </TableCell>
                    );
                  }
                  return <TableCell key={column.id} className="text-muted-foreground">{friendlyDeliveryStatus(item, t)}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
