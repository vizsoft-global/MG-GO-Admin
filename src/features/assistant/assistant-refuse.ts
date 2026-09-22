export type AssistantRefuseCode =
  | "report_delivery_orders"
  | "freeform_sql"
  | "write_shaped"
  | "unknown_tool";

function isOrdersReportKind(value: string): boolean {
  const kind = value.toLowerCase();
  return kind === "report_delivery_orders" || kind.includes("orders_report");
}

function looksLikeSql(value: string): boolean {
  return /\b(select|insert|update|delete|drop)\b.+\bfrom\b/i.test(value) || /run sql/i.test(value);
}

/** Structured refuse — only explicit tool keys / SQL fields, never a JSON blob substring scan. */
export function refuseToolArgs(args: Record<string, unknown>): AssistantRefuseCode | null {
  const kind = String(args.kind ?? args.rpc ?? args.report ?? args.tool ?? "").toLowerCase();
  if (isOrdersReportKind(kind) || String(args.tool ?? "") === "report_delivery_orders") {
    return "report_delivery_orders";
  }
  if (typeof args.sql === "string") {
    return "freeform_sql";
  }
  if (typeof args.query === "string" && looksLikeSql(args.query)) {
    return "freeform_sql";
  }
  return null;
}

export function refuseUserText(text: string): AssistantRefuseCode | null {
  const lower = text.toLowerCase();
  if (lower.includes("report_delivery_orders") || /orders report/.test(lower)) {
    return "report_delivery_orders";
  }
  if (/\b(select|insert|update|delete|drop)\b.+\bfrom\b/.test(lower) || /run sql/.test(lower)) {
    return "freeform_sql";
  }
  if (
    /\b(verify this|reject this|recalculate (earnings|payout)|upsert |insert into|delete from|drop table|block rider|pay extra)\b/.test(
      lower,
    )
  ) {
    return "write_shaped";
  }
  return null;
}

export function looksArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function assertNoOrderRows(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  if ("rows" in obj) throw new Error("order_rows_leaked");
  if (Array.isArray(obj.order_ids) || Array.isArray(obj.orderIds)) {
    throw new Error("order_ids_leaked");
  }
}
