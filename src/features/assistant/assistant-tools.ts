import { tool } from "ai";
import { z } from "zod";
import {
  runDeliveriesCounts,
  runDpdEfficiency,
  runExportReport,
  runIncentiveDaily,
  runPerformanceBands,
  runPerformanceLive,
} from "./assistant-wrappers";

const dateFields = {
  preset: z
    .enum(["today", "yesterday", "this_week", "this_month"])
    .optional()
    .describe("Kuwait calendar preset. Defaults to today when from/to omitted."),
  from: z.string().optional().describe("Inclusive Kuwait date YYYY-MM-DD"),
  to: z.string().optional().describe("Inclusive Kuwait date YYYY-MM-DD"),
};

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
        date: z.string().optional().describe("Kuwait date YYYY-MM-DD, default today"),
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
  };
}
