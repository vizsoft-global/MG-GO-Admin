/**
 * Staff Assistant — locked tool catalog.
 * A–D stay Excel-exportable. Entity/analytics tools are read-only, no Orders Report.
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

export const ASSISTANT_V1_TOOL_KEYS = [
  "dpd_efficiency",
  "deliveries_counts",
  "incentive_daily",
  "performance_bands",
  "performance_live",
] as const;

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
  {
    key: "resolve_entity",
    rpc: "resolveEntity",
    permission: "assistant.view",
  },
  {
    key: "entity_summary",
    rpc: "buildEntitySummary",
    permission: "assistant.view",
  },
  {
    key: "entity_report",
    rpc: "buildEntityReport",
    permission: "assistant.view",
  },
  {
    key: "list_related",
    rpc: "listRelated",
    permission: "assistant.view",
  },
  {
    key: "compare_windows",
    rpc: "fetchPerformanceOpsSnapshot",
    permission: "performance.view",
  },
  {
    key: "compare_driver_windows",
    rpc: "fetchDriverPerformanceDetail",
    permission: "performance.view",
  },
  {
    key: "analytics_query",
    rpc: "runAnalyticsQuery",
    permission: "assistant.view",
  },
] as const;

export type AssistantToolAllowlistKey = (typeof ASSISTANT_TOOL_ALLOWLIST)[number]["key"];

export const ASSISTANT_V1_OUT_OF_SCOPE = [
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

function envFlag(name: string): string | undefined {
  return process.env[name];
}

/** True when a Gateway key, an OIDC token, or a Vercel runtime (OIDC via request) is present. */
export function isGatewayConfigured(): boolean {
  return Boolean(
    envFlag("AI_GATEWAY_API_KEY") || envFlag("VERCEL_OIDC_TOKEN") || envFlag("VERCEL") === "1",
  );
}
