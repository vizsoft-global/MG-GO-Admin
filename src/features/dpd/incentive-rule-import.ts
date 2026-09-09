import { normalizeDateToIso } from "@/lib/import/spreadsheet";

export type IncentiveImportStatus =
  | "ok"
  | "unknown_restaurant"
  | "ambiguous_restaurant"
  | "invalid_start"
  | "invalid_end"
  | "invalid_range"
  | "invalid_tiers"
  | "file_overlap"
  | "would_replace";

export type IncentiveImportTier = {
  threshold_deliveries: number;
  reward_mode: "fixed" | "per_delivery";
  amount: number;
};

export type IncentiveImportInputRow = {
  restaurant?: string;
  start?: string;
  end?: string;
  tiers?: string;
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
  restaurant: string;
  start: string;
  end: string;
  tiers: string;
  status: IncentiveImportStatus;
  restaurant_id: string | null;
  parsed_tiers: IncentiveImportTier[];
  replace_rule_id: string | null;
  replace_rule_ids: string[];
  replace_rule_name: string | null;
};

export function uniqueRestaurantIds(
  ids: Array<string | null | undefined>,
): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function guessIncentiveImportColumns(headers: string[]): {
  restaurant: number;
  start: number;
  end: number;
  tiers: number;
} {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const exact = (aliases: string[]) => {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    restaurant: exact(["restaurant"]),
    start: exact(["start", "start date"]),
    end: exact(["end", "end date"]),
    tiers: exact(["tiers", "tier"]),
  };
}

export function mapIncentiveImportSheet(
  headers: string[],
  rows: string[][],
): IncentiveImportInputRow[] {
  const cols = guessIncentiveImportColumns(headers);
  return rows.map((cells) => {
    const startRaw = cols.start >= 0 ? (cells[cols.start] ?? "") : "";
    const endRaw = cols.end >= 0 ? (cells[cols.end] ?? "") : "";
    return {
      restaurant: cols.restaurant >= 0 ? cells[cols.restaurant] : "",
      start: normalizeDateToIso(startRaw) ?? startRaw,
      end: normalizeDateToIso(endRaw) ?? endRaw,
      tiers: cols.tiers >= 0 ? cells[cols.tiers] : "",
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
    tiers.push({ threshold_deliveries: threshold, reward_mode, amount });
  }
  return tiers;
}

function matchRestaurant(
  name: string,
  restaurants: IncentiveImportRestaurant[],
): { status: "ok" | "unknown_restaurant" | "ambiguous_restaurant"; id: string | null } {
  const needle = name.trim().toLowerCase();
  if (!needle) return { status: "unknown_restaurant", id: null };
  const hits = restaurants.filter((r) => r.name.trim().toLowerCase() === needle);
  if (hits.length === 0) return { status: "unknown_restaurant", id: null };
  if (hits.length > 1) return { status: "ambiguous_restaurant", id: null };
  return { status: "ok", id: hits[0].id };
}

export function previewIncentiveRuleRows(input: {
  rows: IncentiveImportInputRow[];
  restaurants: IncentiveImportRestaurant[];
  existing: IncentiveImportExistingRule[];
}): IncentiveImportPreviewRow[] {
  const firstPass = input.rows.map((row, index): IncentiveImportPreviewRow => {
    const restaurant = row.restaurant?.trim() ?? "";
    const startRaw = row.start?.trim() ?? "";
    const endRaw = row.end?.trim() ?? "";
    const tiersRaw = row.tiers?.trim() ?? "";
    const start = parseIsoDate(startRaw);
    const end = parseIsoDate(endRaw);
    const parsed_tiers = parseIncentiveTiers(tiersRaw);
    const matched = matchRestaurant(restaurant, input.restaurants);

    const base: IncentiveImportPreviewRow = {
      row_number: index + 1,
      restaurant,
      start: startRaw,
      end: endRaw,
      tiers: tiersRaw,
      status: "ok",
      restaurant_id: matched.id,
      parsed_tiers: parsed_tiers ?? [],
      replace_rule_id: null,
      replace_rule_ids: [],
      replace_rule_name: null,
    };

    if (matched.status !== "ok") return { ...base, status: matched.status };
    if (!start) return { ...base, status: "invalid_start" };
    if (!end) return { ...base, status: "invalid_end" };
    if (end < start) return { ...base, status: "invalid_range" };
    if (!parsed_tiers) return { ...base, status: "invalid_tiers" };
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
  return rows.filter((row) => row.status === "ok" || row.status === "would_replace");
}
