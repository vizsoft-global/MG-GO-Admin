"use client";

import { CalendarCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import type { AttendanceMonitorRow } from "../types";
import {
  DASHBOARD_WIDGET_PREVIEW_LIMIT,
  DashboardWidget,
  DashboardWidgetEmpty,
} from "./dashboard-widget";

export function AttendanceMonitorWidget({
  rows,
  locale,
}: {
  rows: AttendanceMonitorRow[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const renderTable = (data: AttendanceMonitorRow[]) => (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className={TABLE_HEAD_CLASS}>{t("colPartner")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colScheduled")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colCheckedIn")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colLate")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colAbsent")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colOvertime")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.partnerName} className="hover:bg-muted/20">
            <TableCell className="text-xs font-medium text-foreground">
              {row.partnerName}
            </TableCell>
            <TableCell className="text-xs tabular-nums">{row.scheduled}</TableCell>
            <TableCell className="text-xs tabular-nums">{row.checkedIn}</TableCell>
            <TableCell className="text-xs tabular-nums">{row.late}</TableCell>
            <TableCell className="text-xs tabular-nums text-danger">{row.absent}</TableCell>
            <TableCell className="text-xs tabular-nums">{row.overtime}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const preview = rows.slice(0, DASHBOARD_WIDGET_PREVIEW_LIMIT);
  const hasMore = rows.length > preview.length;

  return (
    <DashboardWidget
      title={t("widgetAttendance")}
      href={hasMore ? undefined : `/${locale}/attendance`}
      viewAllLabel={t("viewAll")}
      icon={CalendarCheck}
      tone="primary"
      badge={rows.length > 0 ? rows.length : undefined}
      modalContent={hasMore ? renderTable(rows) : undefined}
      modalTitle={t("widgetAttendance")}
    >
      {rows.length === 0 ? (
        <DashboardWidgetEmpty icon={CalendarCheck} title={t("empty")} tone="neutral" />
      ) : (
        renderTable(preview)
      )}
    </DashboardWidget>
  );
}
