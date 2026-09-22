import { tool } from "ai";
import { z } from "zod";
import { ASSISTANT_ENTITY_TYPES } from "./assistant-entity";
import { RELATED_RELATIONS } from "./assistant-related";
import {
  runAnalytics,
  runCompareDriverWindows,
  runCompareWindows,
  runDeliveriesCounts,
  runDpdEfficiency,
  runEntityReport,
  runEntitySummary,
  runExportReport,
  runIncentiveDaily,
  runListRelated,
  runPerformanceBands,
  runPerformanceLive,
  runResolveEntity,
} from "./assistant-wrappers";

const dateFields = {
  preset: z
    .enum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month"])
    .optional()
    .describe("Kuwait calendar preset. Pass only this when the user named a preset — omit from/to."),
  from: z.string().optional().describe("Inclusive Kuwait date YYYY-MM-DD. Omit when preset is set."),
  to: z.string().optional().describe("Inclusive Kuwait date YYYY-MM-DD. Omit when preset is set."),
};

const entityType = z.enum(ASSISTANT_ENTITY_TYPES);

export function createAssistantTools() {
  return {
    dpd_efficiency: tool({
      description:
        "A: DPD efficiency — actual vs target, top/bottom 10 riders, restaurant/zone/partner. Read-only.",
      inputSchema: z.object({
        ...dateFields,
        restaurant: z.string().optional(),
        zone: z.string().optional(),
        partner: z.string().optional(),
      }),
      execute: async (input) => runDpdEfficiency(input),
    }),
    deliveries_counts: tool({
      description:
        "B: Delivery counts for a period (verified/pending/rejected/cancelled/in_transit/total). Counts only — never order rows or the Orders Report.",
      inputSchema: z.object({
        ...dateFields,
        zone: z.string().optional(),
        partner: z.string().optional(),
      }),
      execute: async (input) => runDeliveriesCounts(input),
    }),
    incentive_daily: tool({
      description:
        "C: Daily incentives already stored for Kuwait earn_date. Does not recalculate money.",
      inputSchema: z.object({
        ...dateFields,
        rider: z.string().optional().describe("Driver code or employee ID"),
        restaurant: z.string().optional(),
      }),
      execute: async (input) => runIncentiveDaily(input),
    }),
    performance_bands: tool({
      description:
        "D: Performance band counts and optional one rider band/rank/score for a period.",
      inputSchema: z.object({
        ...dateFields,
        rider: z.string().optional(),
        zone: z.string().optional(),
        partner: z.string().optional(),
        restaurant: z.string().optional(),
      }),
      execute: async (input) => runPerformanceBands(input),
    }),
    performance_live: tool({
      description:
        "D: Today’s live roster / on duty / GPS / delivery status buckets. No leaderboard.",
      inputSchema: z.object({
        date: z.string().optional().describe("Kuwait date YYYY-MM-DD. Omit unless the user named a specific day."),
      }),
      execute: async (input) => runPerformanceLive(input),
    }),
    export_report: tool({
      description:
        "Describe the Excel the UI can download for an A–D answer. Never Orders Report. Returns metadata only — no file bytes.",
      inputSchema: z.object({
        kind: z.enum([
          "dpd_efficiency",
          "deliveries_counts",
          "incentive_daily",
          "performance_bands",
          "performance_live",
        ]),
        from: z.string(),
        to: z.string(),
        filters: z.record(z.string(), z.string().optional()).optional(),
      }),
      execute: async (input) => runExportReport(input),
    }),
    resolve_entity: tool({
      description:
        "Resolve one authorized entity from an identifier (id, code, name, email, phone, reference). Never pick among multiple matches — returns candidates instead.",
      inputSchema: z.object({
        entity_type: entityType,
        query: z.string().describe("Identifier as typed by the user. Do not invent values."),
      }),
      execute: async (input) => runResolveEntity(input),
    }),
    entity_summary: tool({
      description: "Allowlisted identity card for one resolved entity id. Use after resolve_entity.",
      inputSchema: z.object({
        entity_type: entityType,
        id: z.string(),
      }),
      execute: async (input) => runEntitySummary(input),
    }),
    entity_report: tool({
      description:
        "Complete authorized report for one entity. Server fans out facets (performance, deliveries counts, attendance, requests, etc.). Missing permission = not_authorized section, not invented data.",
      inputSchema: z.object({
        entity_type: entityType,
        id: z.string(),
        ...dateFields,
      }),
      execute: async (input) => runEntityReport(input),
    }),
    list_related: tool({
      description:
        "Related records: complaints/requests for a driver, restaurants in a zone, pending requests for a zone, drivers in a fleet/group, vehicles for a driver, deliveries for a driver. Counts + capped head.",
      inputSchema: z.object({
        from_type: entityType,
        id: z.string(),
        relation: z.enum(RELATED_RELATIONS),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) => runListRelated(input),
    }),
    compare_windows: tool({
      description:
        "Compare two fleet/zone/restaurant periods using performance ops snapshots. For one driver use compare_driver_windows instead.",
      inputSchema: z.object({
        ...dateFields,
        previous_preset: z.enum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month"]).optional(),
        previous_from: z.string().optional(),
        previous_to: z.string().optional(),
        zone_id: z.string().optional(),
        restaurant_id: z.string().optional(),
        partner_id: z.string().optional(),
        zone_b_id: z.string().optional().describe("Second zone id when comparing Zone A vs Zone B"),
      }),
      execute: async (input) => runCompareWindows(input),
    }),
    compare_driver_windows: tool({
      description:
        "Compare one driver across two date windows using driver-level performance (never the fleet ops snapshot).",
      inputSchema: z.object({
        driver_id: z.string(),
        ...dateFields,
        previous_preset: z.enum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month"]).optional(),
        previous_from: z.string().optional(),
        previous_to: z.string().optional(),
      }),
      execute: async (input) => runCompareDriverWindows(input),
    }),
    analytics_query: tool({
      description:
        "KPIs, trends, and ranked counts: attendance, requests, payroll, vehicles, fleet ops, assets, notifications, performance trend, complaints by zone, low performance + high absence.",
      inputSchema: z.object({
        kind: z.enum([
          "attendance_kpis",
          "attendance_trend",
          "requests_counts",
          "payroll_kpis",
          "vehicles_counts",
          "fleet_ops",
          "assets_kpis",
          "notifications_history",
          "performance_trend",
          "rank_complaints_zone",
          "rank_complaints_restaurant",
          "low_performance_high_absence",
        ]),
        ...dateFields,
        zone_id: z.string().optional(),
        partner_id: z.string().optional(),
      }),
      execute: async (input) => runAnalytics(input),
    }),
  };
}
