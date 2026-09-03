"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  DEFAULT_ORDERS_REPORT_FROM_TIME,
  DEFAULT_ORDERS_REPORT_TO_TIME,
  assertDeliveryOrdersReportRange,
  normalizeOrdersReportTime,
  pivotDeliveryOrdersReport,
  type DeliveryOrdersReportData,
  type DeliveryOrdersReportRpcRow,
} from "./orders-report-utils";

async function requireDeliveriesView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function parseRpcRow(raw: Record<string, unknown>): DeliveryOrdersReportRpcRow {
  return {
    driver_id: String(raw.driver_id),
    driver_code: String(raw.driver_code ?? ""),
    employee_id: String(raw.employee_id ?? ""),
    full_name: String(raw.full_name ?? "—"),
    store_name: String(raw.store_name ?? "—"),
    shift_date: String(raw.shift_date).slice(0, 10),
    delivery_count: Number(raw.delivery_count ?? 0),
  };
}

export async function fetchDeliveryOrdersReport(input: {
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
}): Promise<DeliveryOrdersReportData> {
  await requireDeliveriesView();

  const from = input.from?.slice(0, 10) ?? "";
  const to = input.to?.slice(0, 10) ?? "";
  const fromTime = normalizeOrdersReportTime(
    input.fromTime,
    DEFAULT_ORDERS_REPORT_FROM_TIME,
  );
  const toTime = normalizeOrdersReportTime(
    input.toTime,
    DEFAULT_ORDERS_REPORT_TO_TIME,
  );
  assertDeliveryOrdersReportRange(from, to, fromTime, toTime);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_delivery_orders", {
    p_from: from,
    p_to: to,
    p_from_time: `${fromTime}:00`,
    p_to_time: `${toTime}:00`,
  });

  if (error) {
    throw new Error(error.message);
  }

  void logAdminRead("delivery_orders_report", "/deliveries", {
    from,
    to,
    fromTime,
    toTime,
    rowCount: data?.length ?? 0,
  });

  const rpcRows = ((data ?? []) as Record<string, unknown>[]).map(parseRpcRow);
  return pivotDeliveryOrdersReport(from, to, rpcRows, fromTime, toTime);
}
