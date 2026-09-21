"use server";

import { countDeliveriesByFilters } from "@/features/deliveries/deliveries-actions";
import { fetchIncentiveDailyReport } from "@/features/earnings/earnings-actions";
import { buildIncentiveDailyWorkbook } from "@/features/earnings/incentive-daily-xlsx";
import {
  fetchDpdEfficiencySnapshot,
  fetchDpdLiveSnapshot,
  fetchDriverPerformanceList,
} from "@/features/performance/performance-actions";
import { buildDpdEfficiencyWorkbook } from "@/features/performance/performance-dpd-xlsx";
import { buildPerformanceReportXlsx } from "@/features/performance/performance-report-xlsx";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import {
  isAssistantExportKind,
  type AssistantExportKind,
  type AssistantExportSpec,
} from "./assistant-contract";
import { kuwaitDayCreatedAtBounds } from "./assistant-dates";
import { buildDeliveryCountsWorkbook } from "./delivery-counts-xlsx";
import { buildPerformanceLiveWorkbook } from "./performance-live-xlsx";

function bufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

async function requireModule(permission: Permission) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "assistant.view", session.isSuperAdmin) ||
    !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

export async function downloadAssistantExport(spec: AssistantExportSpec): Promise<{
  filename: string;
  base64: string;
}> {
  if (!isAssistantExportKind(spec.kind)) throw new Error("unknown_kind");
  const from = spec.from.slice(0, 10);
  const to = spec.to.slice(0, 10);
  const filters = spec.filters ?? {};

  let buffer: ArrayBuffer;
  let filename: string;
  let modulePermission: Permission = "performance.view";

  switch (spec.kind as AssistantExportKind) {
    case "dpd_efficiency": {
      modulePermission = "performance.view";
      await requireModule(modulePermission);
      const snap = await fetchDpdEfficiencySnapshot({
        from,
        to,
        restaurantId: filters.restaurantId,
        zoneId: filters.zoneId,
        partnerId: filters.partnerId,
      });
      buffer = await buildDpdEfficiencyWorkbook(snap);
      filename = `dpd-efficiency-${from}-${to}.xlsx`;
      break;
    }
    case "deliveries_counts": {
      modulePermission = "deliveries.view";
      await requireModule(modulePermission);
      const bounds = kuwaitDayCreatedAtBounds(from, to);
      const counts = await countDeliveriesByFilters({
        dateFrom: bounds.dateFrom,
        dateTo: bounds.dateTo,
        zoneId: filters.zoneId,
        partnerId: filters.partnerId,
      });
      buffer = await buildDeliveryCountsWorkbook(counts, { from, to });
      filename = `delivery-counts-${from}-${to}.xlsx`;
      break;
    }
    case "incentive_daily": {
      modulePermission = "earnings.view";
      await requireModule(modulePermission);
      const report = await fetchIncentiveDailyReport({
        from,
        to,
        driverId: filters.driverId,
        restaurantId: filters.restaurantId,
      });
      buffer = await buildIncentiveDailyWorkbook(report);
      filename = `incentive-daily-${from}-${to}.xlsx`;
      break;
    }
    case "performance_bands": {
      modulePermission = "performance.view";
      await requireModule(modulePermission);
      const list = await fetchDriverPerformanceList({
        fromDate: from,
        toDate: to,
        zoneId: filters.zoneId,
        partnerId: filters.partnerId,
        restaurantId: filters.restaurantId,
        driverId: filters.driverId,
        sort: "overall_desc",
        page: 0,
        pageSize: 2000,
      });
      buffer = await buildPerformanceReportXlsx({
        from: list.from,
        to: list.to,
        rows: list.rows,
        kpis: list.kpis,
        weights: list.weights,
        ratingTeams: [],
        components: list.components,
        criteria: list.criteria,
        totalCount: list.totalCount,
        truncated: list.totalCount > list.rows.length,
      });
      filename = `performance-${from}-${to}.xlsx`;
      break;
    }
    case "performance_live": {
      modulePermission = "performance.view";
      await requireModule(modulePermission);
      const snap = await fetchDpdLiveSnapshot(from);
      buffer = await buildPerformanceLiveWorkbook(snap);
      filename = `performance-live-${snap.date}.xlsx`;
      break;
    }
    default:
      throw new Error("unknown_kind");
  }

  void logAdminMutation({
    action: "export",
    entityType: "assistant",
    routeName: "assistant.export",
    context: { kind: spec.kind },
  });

  return { filename, base64: bufferToBase64(buffer) };
}
