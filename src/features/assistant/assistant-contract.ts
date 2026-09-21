/**
 * Staff Assistant v1 — locked allowlist (client 9 Sep + 21 Sep Excel).
 * B is list-filter counts, not report_delivery_orders.
 */

export const ASSISTANT_V1_LANGUAGE = "en" as const;

export const ASSISTANT_V1_ROUTE = "/assistant" as const;

export const ASSISTANT_V1_PERMISSION = "assistant.view" as const;

export const ASSISTANT_V1_MODEL = "openai/gpt-4o" as const;

export const ASSISTANT_V1_MAX_STEPS = 8 as const;

export const ASSISTANT_V1_PROVIDER = {
  sdk: "ai",
  gatewayEnv: "AI_GATEWAY",
  writes: false,
} as const;

export const ASSISTANT_EXPORT_KINDS = [
  "dpd_efficiency",
  "deliveries_counts",
  "incentive_daily",
  "performance_bands",
  "performance_live",
] as const;

export type AssistantExportKind = (typeof ASSISTANT_EXPORT_KINDS)[number];

export const ASSISTANT_TOOL_ALLOWLIST = [
  {
    key: "dpd_efficiency",
    rpc: "admin_dpd_efficiency_snapshot",
    permission: "performance.view",
    excel: "buildDpdEfficiencyWorkbook",
  },
  {
    key: "deliveries_counts",
    rpc: "countDeliveriesByFilters",
    permission: "deliveries.view",
    excel: "buildDeliveryCountsWorkbook",
  },
  {
    key: "incentive_daily",
    rpc: "admin_incentive_daily_report",
    permission: "earnings.view",
    excel: "buildIncentiveDailyWorkbook",
    day: "earn_date",
  },
  {
    key: "performance_bands",
    rpc: "admin_list_driver_performance",
    permission: "performance.view",
    excel: "buildPerformanceReportXlsx",
  },
  {
    key: "performance_live",
    rpc: "admin_dpd_live_snapshot",
    permission: "performance.view",
    excel: "buildPerformanceLiveWorkbook",
  },
] as const;

export type AssistantToolAllowlistKey = (typeof ASSISTANT_TOOL_ALLOWLIST)[number]["key"];

export const ASSISTANT_V1_OUT_OF_SCOPE = [
  "arabic_ui",
  "freeform_sql",
  "writes",
  "notification_send",
  "incentive_upsert",
  "report_delivery_orders",
] as const;

export type AssistantExportSpec = {
  kind: AssistantExportKind;
  from: string;
  to: string;
  filters: Record<string, string | undefined>;
};

export function isAssistantExportKind(value: string): value is AssistantExportKind {
  return (ASSISTANT_EXPORT_KINDS as readonly string[]).includes(value);
}

export function isGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
