import type { AssistantRefuseCode } from "./assistant-refuse";

export const ASSISTANT_REFUSE_COPY: Record<AssistantRefuseCode, string> = {
  report_delivery_orders:
    "I cannot generate the shift-day Orders Report. Open /deliveries and use Generate.",
  freeform_sql: "I cannot run SQL or invent a query. Ask A–D only.",
  write_shaped:
    "I cannot change data. Verify or reject on /deliveries; payouts on /earnings Tools; rules on /incentive-rules or /delivery-rules.",
  unknown_tool: "That is outside Staff Assistant v1 (A–D only).",
};

export function refuseCopy(code: string): string {
  if (code in ASSISTANT_REFUSE_COPY) {
    return ASSISTANT_REFUSE_COPY[code as AssistantRefuseCode];
  }
  if (code === "not_authorized") {
    return "You do not have permission for that report.";
  }
  if (code === "gateway_not_configured") {
    return "The assistant is not connected. Ask an administrator to finish AI Gateway setup.";
  }
  return ASSISTANT_REFUSE_COPY.unknown_tool;
}

export function lastUserText(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return (message.parts ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}
