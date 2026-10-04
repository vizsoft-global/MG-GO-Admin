import { normalizeDateToIso } from "@/lib/import/spreadsheet";
import {
  FIXED_REWARD_STEP_KWD,
  PER_DELIVERY_REWARD_STEP_KWD,
  isOnRewardStep,
} from "./incentive-rule-form-validation";

export type IncentiveImportStatus =
  | "ok"
  | "unknown_restaurant"
  | "ambiguous_restaurant"
  | "invalid_start"
  | "invalid_end"
  | "invalid_range"
  | "invalid_tiers"
  | "invalid_target"
  | "invalid_reward"
  | "invalid_target_type"
  | "invalid_period"
  | "invalid_priority"
  | "file_overlap"
  | "would_replace";

export type IncentiveImportTier = {
  threshold_deliveries: number;
  reward_mode: "fixed" | "per_delivery";
  amount: number;
};

export type IncentiveImportInputRow = {
  name?: string;
  restaurant?: string;
  start?: string;
  end?: string;
  targetType?: string;
  target?: string;
  rewardType?: string;
  reward?: string;
  rate?: string;
  baseMinimum?: string;
  tiers?: string;
  period?: string;
  priority?: string;
  override?: string;
  status?: string;
};

export type IncentiveImportRestaurant = {
  id: string;
  name: string;
};

export type IncentiveImportExistingRule = {
  id: string;
  name: string;
  status: string;
  restaurant_ids: string[];
  start_date: string;
  end_date: string;
};

export type IncentiveImportPreviewRow = {
  row_number: number;
  /** Uploaded, unresolved values — what the operator typed. */
  name: string;
  restaurant: string;
  start: string;
  end: string;
  tiers: string;
  status: IncentiveImportStatus;
  restaurant_id: string | null;
  parsed_tiers: IncentiveImportTier[];
  /** Resolved rule shape the apply step writes. */
  rule_name: string;
  target_mode: "single" | "tiered";
  target_deliveries: number | null;
  reward_mode: "fixed" | "per_delivery";
  reward_kwd: number;
  reward_per_delivery_kwd: number | null;
  base_minimum_deliveries: number;
  period: "daily" | "weekly" | "monthly";
  priority: number | null;
  overrides_others: boolean;
  rule_status: "draft" | "active" | "ended";
  replace_rule_id: string | null;
  replace_rule_ids: string[];
  replace_rule_name: string | null;
};

/**
 * The template catalogue. Headers are also what `guessIncentiveImportColumns`
 * matches on, so a header is a column name, not documentation — the Guide sheet
 * carries the explanation.
 */
export const INCENTIVE_IMPORT_COLUMNS: {
  key: keyof IncentiveImportInputRow;
  header: string;
  aliases: string[];
  required: boolean;
  example: string;
}[] = [
  {
    key: "restaurant",
    header: "Restaurant",
    aliases: ["restaurant"],
    required: true,
    example: "Central Tower Cafe",
  },
  {
    key: "start",
    header: "Start",
    aliases: ["start", "start date"],
    required: true,
    example: "2026-11-01",
  },
  {
    key: "end",
    header: "End",
    aliases: ["end", "end date"],
    required: true,
    example: "2026-11-30",
  },
  {
    key: "targetType",
    header: "Target Type",
    aliases: ["target type", "targettype", "target_mode"],
    required: false,
    example: "tiered",
  },
  {
    key: "target",
    header: "Target",
    aliases: ["target", "target deliveries", "target_deliveries"],
    required: false,
    example: "10",
  },
  {
    key: "rewardType",
    header: "Reward Type",
    aliases: ["reward type", "rewardtype", "reward_mode"],
    required: false,
    example: "fixed",
  },
  {
    key: "reward",
    header: "Reward (KD)",
    aliases: ["reward (kd)", "reward", "reward_kwd", "reward kd", "reward kwd"],
    required: false,
    example: "1.5",
  },
  {
    key: "rate",
    header: "Rate (KD/order)",
    aliases: [
      "rate (kd/order)",
      "rate",
      "reward per delivery",
      "reward_per_delivery_kwd",
    ],
    required: false,
    example: "0.25",
  },
  {
    key: "baseMinimum",
    header: "Base Minimum Deliveries",
    aliases: ["base minimum deliveries", "base minimum", "base_minimum_deliveries"],
    required: false,
    example: "0",
  },
  {
    key: "tiers",
    header: "Tiers",
    aliases: ["tiers", "tier"],
    required: false,
    example: "15:fixed:1.5; 20:per_delivery:0.25",
  },
  {
    key: "period",
    header: "Period",
    aliases: ["period"],
    required: false,
    example: "daily",
  },
  {
    key: "priority",
    header: "Priority",
    aliases: ["priority"],
    required: false,
    example: "30",
  },
  {
    key: "override",
    header: "Override",
    aliases: ["override", "overrides", "overrides others"],
    required: false,
    example: "no",
  },
  {
    key: "status",
    header: "Status",
    aliases: ["status"],
    required: false,
    example: "active",
  },
  {
    key: "name",
    header: "Rule Name",
    aliases: ["rule name", "name"],
    required: false,
    example: "(blank = Restaurant Start date)",
  },
];

export function uniqueRestaurantIds(
  ids: Array<string | null | undefined>,
): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function guessIncentiveImportColumns(
  headers: string[],
): Record<keyof IncentiveImportInputRow, number> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const result = {} as Record<keyof IncentiveImportInputRow, number>;
  for (const column of INCENTIVE_IMPORT_COLUMNS) {
    let idx = -1;
    for (const alias of column.aliases) {
      const found = lower.indexOf(alias);
      if (found >= 0) {
        idx = found;
        break;
      }
    }
    result[column.key] = idx;
  }
  return result;
}

export function mapIncentiveImportSheet(
  headers: string[],
  rows: string[][],
): IncentiveImportInputRow[] {
  const cols = guessIncentiveImportColumns(headers);
  const pick = (cells: string[], key: keyof IncentiveImportInputRow) =>
    cols[key] >= 0 ? cells[cols[key]] : "";
  return rows.map((cells) => {
    const startRaw = pick(cells, "start") ?? "";
    const endRaw = pick(cells, "end") ?? "";
    return {
      name: pick(cells, "name"),
      restaurant: pick(cells, "restaurant"),
      start: normalizeDateToIso(startRaw) ?? startRaw,
      end: normalizeDateToIso(endRaw) ?? endRaw,
      targetType: pick(cells, "targetType"),
      target: pick(cells, "target"),
      rewardType: pick(cells, "rewardType"),
      reward: pick(cells, "reward"),
      rate: pick(cells, "rate"),
      baseMinimum: pick(cells, "baseMinimum"),
      tiers: pick(cells, "tiers"),
      period: pick(cells, "period"),
      priority: pick(cells, "priority"),
      override: pick(cells, "override"),
      status: pick(cells, "status"),
    };
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string): string | null {
  const trimmed = normalizeDateToIso(value.trim()) ?? value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return trimmed;
}

export function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Matching start when a replace overlaps an active rule: never earlier than Kuwait today. */
export function clampIncentiveImportStart(
  uploadedStart: string,
  kuwaitToday: string,
): string {
  return uploadedStart >= kuwaitToday ? uploadedStart : kuwaitToday;
}

export function effectiveIncentiveImportStart(input: {
  uploadedStart: string;
  kuwaitToday: string;
  replaces: boolean;
}): string {
  if (!input.replaces) return input.uploadedStart;
  return clampIncentiveImportStart(input.uploadedStart, input.kuwaitToday);
}

export function parseIncentiveTiers(raw: string): IncentiveImportTier[] | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(/[;|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const tiers: IncentiveImportTier[] = [];
  for (const part of parts) {
    const colon = part.split(":").map((s) => s.trim());
    const eq = part.split("=").map((s) => s.trim());
    let threshold: number;
    let reward_mode: "fixed" | "per_delivery" = "fixed";
    let amount: number;
    if (colon.length === 3) {
      threshold = Number(colon[0]);
      const mode = colon[1].toLowerCase();
      if (mode !== "fixed" && mode !== "per_delivery") return null;
      reward_mode = mode;
      amount = Number(colon[2]);
    } else if (eq.length === 2) {
      threshold = Number(eq[0]);
      amount = Number(eq[1]);
    } else {
      return null;
    }
    if (!Number.isInteger(threshold) || threshold <= 0) return null;
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (
      !isOnRewardStep(
        amount,
        reward_mode === "fixed"
          ? FIXED_REWARD_STEP_KWD
          : PER_DELIVERY_REWARD_STEP_KWD,
      )
    ) {
      return null;
    }
    tiers.push({ threshold_deliveries: threshold, reward_mode, amount });
  }
  const thresholds = tiers.map((tier) => tier.threshold_deliveries);
  const sorted = [...thresholds].sort((a, b) => a - b);
  if (sorted.some((threshold, index) => index > 0 && threshold <= sorted[index - 1])) {
    return null;
  }
  return tiers;
}

const TARGET_MODES = new Set(["single", "tiered"]);
const REWARD_MODES = new Set(["fixed", "per_delivery"]);
const PERIODS = new Set(["daily", "weekly", "monthly"]);
const RULE_STATUSES = new Set(["draft", "active", "ended"]);

function normaliseEnum(value: string | undefined, allowed: Set<string>): string | null {
  const trimmed = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!trimmed) return "";
  return allowed.has(trimmed) ? trimmed : null;
}

function normaliseBool(value: string | undefined, fallback: boolean): boolean | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return fallback;
  if (["yes", "y", "true", "1", "on"].includes(trimmed)) return true;
  if (["no", "n", "false", "0", "off"].includes(trimmed)) return false;
  return null;
}

function matchRestaurant(
  name: string,
  restaurants: IncentiveImportRestaurant[],
): {
  status: "ok" | "unknown_restaurant" | "ambiguous_restaurant";
  id: string | null;
} {
  const needle = name.trim().toLowerCase();
  if (!needle) return { status: "unknown_restaurant", id: null };
  const hits = restaurants.filter(
    (r) => r.name.trim().toLowerCase() === needle,
  );
  if (hits.length === 0) return { status: "unknown_restaurant", id: null };
  if (hits.length > 1) return { status: "ambiguous_restaurant", id: null };
  return { status: "ok", id: hits[0].id };
}

export function previewIncentiveRuleRows(input: {
  rows: IncentiveImportInputRow[];
  restaurants: IncentiveImportRestaurant[];
  existing: IncentiveImportExistingRule[];
  kuwaitToday?: string;
}): IncentiveImportPreviewRow[] {
  const firstPass = input.rows.map((row, index): IncentiveImportPreviewRow => {
    const restaurant = row.restaurant?.trim() ?? "";
    const startRaw = row.start?.trim() ?? "";
    const endRaw = row.end?.trim() ?? "";
    const tiersRaw = row.tiers?.trim() ?? "";
    const start = parseIsoDate(startRaw);
    const end = parseIsoDate(endRaw);
    const matched = matchRestaurant(restaurant, input.restaurants);

    // Missing columns fall back to the pre-expansion shape so a sheet written
    // against the old 4-column template still imports unchanged.
    const targetModeRaw = normaliseEnum(row.targetType, TARGET_MODES);
    const target_mode = (targetModeRaw || "tiered") as "single" | "tiered";
    const rewardModeRaw = normaliseEnum(row.rewardType, REWARD_MODES);
    const reward_mode = (rewardModeRaw || "fixed") as "fixed" | "per_delivery";
    const periodRaw = normaliseEnum(row.period, PERIODS);
    const period = (periodRaw || "daily") as "daily" | "weekly" | "monthly";
    const statusRaw = normaliseEnum(row.status, RULE_STATUSES);
    const rule_status = (statusRaw || "active") as "draft" | "active" | "ended";
    const overrides = normaliseBool(row.override, false);

    const baseMinimum = (() => {
      const raw = (row.baseMinimum ?? "").trim();
      if (!raw) return 0;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
    })();
    const target = (() => {
      const raw = (row.target ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : Number.NaN;
    })();
    const reward = (() => {
      const raw = (row.reward ?? "").trim();
      if (!raw) return 0;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
    })();
    const rate = (() => {
      const raw = (row.rate ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
    })();
    const priority = (() => {
      const raw = (row.priority ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
    })();

    const parsed_tiers =
      target_mode === "tiered" ? parseIncentiveTiers(tiersRaw) : [];

    const base: IncentiveImportPreviewRow = {
      row_number: index + 1,
      name: row.name?.trim() ?? "",
      restaurant,
      start: startRaw,
      end: endRaw,
      tiers: tiersRaw,
      status: "ok",
      restaurant_id: matched.id,
      parsed_tiers: parsed_tiers ?? [],
      rule_name: (row.name?.trim() || `${restaurant} ${startRaw}`).trim(),
      target_mode,
      target_deliveries: target_mode === "single" ? target : null,
      reward_mode,
      reward_kwd: reward_mode === "fixed" ? reward : 0,
      reward_per_delivery_kwd: reward_mode === "per_delivery" ? rate : null,
      base_minimum_deliveries: baseMinimum,
      period,
      priority,
      overrides_others: overrides ?? false,
      rule_status,
      replace_rule_id: null,
      replace_rule_ids: [],
      replace_rule_name: null,
    };

    if (matched.status !== "ok") return { ...base, status: matched.status };
    if (!start) return { ...base, status: "invalid_start" };
    if (!end) return { ...base, status: "invalid_end" };
    if (end < start) return { ...base, status: "invalid_range" };
    if (!targetModeRaw && (row.targetType ?? "").trim())
      return { ...base, status: "invalid_target_type" };
    if (!periodRaw && (row.period ?? "").trim())
      return { ...base, status: "invalid_period" };
    if (overrides === null) return { ...base, status: "invalid_target_type" };
    if (!Number.isFinite(baseMinimum)) return { ...base, status: "invalid_target" };
    if (priority !== null && !Number.isFinite(priority))
      return { ...base, status: "invalid_priority" };

    if (target_mode === "single") {
      if (
        target === null ||
        !Number.isFinite(target) ||
        target <= baseMinimum
      ) {
        return { ...base, status: "invalid_target" };
      }
      if (reward_mode === "fixed") {
        if (
          !Number.isFinite(reward) ||
          !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)
        ) {
          return { ...base, status: "invalid_reward" };
        }
      } else if (
        rate === null ||
        !Number.isFinite(rate) ||
        !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)
      ) {
        return { ...base, status: "invalid_reward" };
      }
    } else {
      if (!parsed_tiers || parsed_tiers.length === 0) {
        return { ...base, status: "invalid_tiers" };
      }
      const lowest = Math.min(
        ...parsed_tiers.map((tier) => tier.threshold_deliveries),
      );
      if (lowest <= baseMinimum) return { ...base, status: "invalid_tiers" };
    }
    return base;
  });

  const byRestaurant = new Map<string, number[]>();
  for (const row of firstPass) {
    if (row.status !== "ok" || !row.restaurant_id) continue;
    const list = byRestaurant.get(row.restaurant_id) ?? [];
    list.push(row.row_number);
    byRestaurant.set(row.restaurant_id, list);
  }

  const overlapRows = new Set<number>();
  for (const indexes of byRestaurant.values()) {
    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = i + 1; j < indexes.length; j += 1) {
        const a = firstPass[indexes[i] - 1];
        const b = firstPass[indexes[j] - 1];
        if (datesOverlap(a.start, a.end, b.start, b.end)) {
          overlapRows.add(a.row_number);
          overlapRows.add(b.row_number);
        }
      }
    }
  }

  return firstPass.map((row) => {
    if (row.status !== "ok" || !row.restaurant_id) return row;
    if (overlapRows.has(row.row_number)) {
      return { ...row, status: "file_overlap" };
    }
    const conflicts = input.existing.filter(
      (rule) =>
        rule.status === "active" &&
        uniqueRestaurantIds(rule.restaurant_ids).includes(row.restaurant_id!) &&
        datesOverlap(row.start, row.end, rule.start_date, rule.end_date),
    );
    if (conflicts.length > 0) {
      if (input.kuwaitToday) {
        const effectiveStart = clampIncentiveImportStart(
          row.start,
          input.kuwaitToday,
        );
        if (effectiveStart > row.end) {
          return { ...row, status: "invalid_range" };
        }
      }
      return {
        ...row,
        status: "would_replace",
        replace_rule_id: conflicts[0].id,
        replace_rule_ids: conflicts.map((rule) => rule.id),
        replace_rule_name: conflicts.map((rule) => rule.name).join(", "),
      };
    }
    return row;
  });
}

export function applyableIncentiveImportRows(
  rows: IncentiveImportPreviewRow[],
): IncentiveImportPreviewRow[] {
  return rows.filter(
    (row) => row.status === "ok" || row.status === "would_replace",
  );
}

/** Sample rows that the shipped template writes, derived from the catalogue. */
export function incentiveImportTemplateHeader(): string {
  return INCENTIVE_IMPORT_COLUMNS.map((column) => column.header).join(",");
}

export function incentiveImportTemplateRow(): string {
  return INCENTIVE_IMPORT_COLUMNS.map((column) => {
    if (column.key === "name") return "";
    return column.example;
  })
    .map((cell) => (/[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
    .join(",");
}
