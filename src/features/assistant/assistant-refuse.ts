const WRITE_NEEDLES = [
  "verify",
  "reject",
  "recalc",
  "recalculate",
  "upsert",
  "insert into",
  "delete from",
  "drop table",
  "notify",
  "block rider",
  "pay extra",
  "add rule",
  "edit rule",
];

export type AssistantRefuseCode =
  | "report_delivery_orders"
  | "freeform_sql"
  | "write_shaped"
  | "unknown_tool";

export function refuseToolArgs(args: Record<string, unknown>): AssistantRefuseCode | null {
  const kind = String(args.kind ?? args.rpc ?? args.report ?? "").toLowerCase();
  if (
    kind === "report_delivery_orders" ||
    kind.includes("orders_report") ||
    String(args.tool ?? "") === "report_delivery_orders"
  ) {
    return "report_delivery_orders";
  }
  if (typeof args.sql === "string" || typeof args.query === "string") {
    return "freeform_sql";
  }
  const blob = JSON.stringify(args).toLowerCase();
  if (WRITE_NEEDLES.some((needle) => blob.includes(needle))) {
    return "write_shaped";
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
