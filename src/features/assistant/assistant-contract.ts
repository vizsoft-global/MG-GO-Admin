/**
 * Wave 3 AI — design only.
 * `assistant.view` is seeded with zero role grants. Do not add `/assistant`,
 * a chat UI, or a menu entry until client allowlist sign-off and Gateway
 * confirm. No generateText call lives in src/.
 */

export const ASSISTANT_V1_LANGUAGE = "en" as const;

export const ASSISTANT_V1_ROUTE = "/assistant" as const;

export const ASSISTANT_V1_PERMISSION = "assistant.view" as const;

export const ASSISTANT_V1_PROVIDER = {
  sdk: "ai",
  gatewayEnv: "AI_GATEWAY",
  writes: false,
} as const;

/**
 * Proposal only. Review and lock with the client before implementation.
 * Each tool is a read of an existing staff RPC or Excel builder — never SQL.
 */
export const ASSISTANT_TOOL_ALLOWLIST_PROPOSAL = [
  {
    key: "deliveries_counts",
    rpc: "report_delivery_orders",
    permission: "deliveries.view",
  },
  {
    key: "dpd_efficiency_top_bottom",
    rpc: "admin_dpd_efficiency_snapshot",
    permission: "performance.view",
    excel: "buildDpdEfficiencyWorkbook",
  },
  {
    key: "incentive_daily_totals",
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
] as const;

export type AssistantToolAllowlistKey =
  (typeof ASSISTANT_TOOL_ALLOWLIST_PROPOSAL)[number]["key"];

export const ASSISTANT_V1_OUT_OF_SCOPE = [
  "arabic_ui",
  "freeform_sql",
  "writes",
  "notification_send",
  "incentive_upsert",
] as const;
