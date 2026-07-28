"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import type { WorkforceQueueRow } from "../types";
import {
  DASHBOARD_WIDGET_PREVIEW_LIMIT,
  DashboardWidget,
  DashboardWidgetEmpty,
} from "./dashboard-widget";

export function WorkforceQueueWidget({
  rows,
  locale,
}: {
  rows: WorkforceQueueRow[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const renderTable = (data: WorkforceQueueRow[]) => (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colPartner")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colLastActivity")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.driverId} className="hover:bg-muted/20">
            <TableCell className="text-xs">
              <p className="font-medium text-foreground">{row.driverName}</p>
              <p className="text-muted-foreground">#{row.driverCode}</p>
            </TableCell>
            <TableCell className="text-xs">
              <p>{row.partnerName}</p>
              <p className="text-muted-foreground">{row.restaurantName}</p>
            </TableCell>
            <TableCell>
              <StatusPill variant={resolveStatusVariant(row.status)} dot>
                {t(`workforceStatus.${row.status}`)}
              </StatusPill>
            </TableCell>
            <TableCell className="text-xs tabular-nums">{row.deliveriesToday}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleTimeString() : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const preview = rows.slice(0, DASHBOARD_WIDGET_PREVIEW_LIMIT);
  const hasMore = rows.length > preview.length;

  return (
    <DashboardWidget
      title={t("widgetWorkforceQueue")}
      href={hasMore ? undefined : `/${locale}/drivers`}
      viewAllLabel={t("viewAll")}
      icon={Users}
      tone={rows.length > 0 ? "warning" : "neutral"}
      badge={rows.length > 0 ? rows.length : undefined}
      modalContent={hasMore ? renderTable(rows) : undefined}
      modalTitle={t("widgetWorkforceQueue")}
    >
      {rows.length === 0 ? (
        <DashboardWidgetEmpty icon={Users} title={t("empty")} tone="neutral" />
      ) : (
        renderTable(preview)
      )}
    </DashboardWidget>
  );
}
