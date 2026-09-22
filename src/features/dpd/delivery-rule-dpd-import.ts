/**
 * Bulk DPD create uses the same defaultPriority as the form (restaurant 30, zone 10).
 *
 * Prod 2026-09-22: restaurant rules are priority 5, 20, 30; no zone rules.
 * Create only when that restaurant/zone id has zero rules, so a new 30/10
 * never outranks a manual sibling. delivery_matches_rules is ANY-match
 * (priority unused). DPD efficiency DISTINCT ON is per restaurant_id and
 * per zone_id separately; a restaurant target beats a zone target via
 * COALESCE, not via 30 vs 10.
 */
export const BULK_DPD_CREATE_PRIORITY = {
  restaurant: 30,
  zone: 10,
} as const;

export type DpdTargetImportStatus =
  | "ok"
  | "create"
  | "unknown_name"
  | "invalid_target"
  | "invalid_period"
  | "ambiguous_name"
  | "duplicate";

export type DpdTargetImportInputRow = {
  scope_type?: string;
  name?: string;
  dpd_target?: string;
  dpd_period?: string;
  partner?: string;
  zone_code?: string;
};

export type DpdTargetImportRestaurant = {
  id: string;
  name: string;
  partner_name: string;
};

export type DpdTargetImportZone = {
  id: string;
  name: string;
  code: string;
};

export type DpdTargetImportExistingRule = {
  id: string;
  name: string;
  status: string;
  priority: number;
  scope_type: "restaurant" | "zone" | "partner";
  restaurant_ids: string[];
  zone_ids: string[];
};

export type DpdTargetImportPreviewRow = {
  row_number: number;
  scope_type: string;
  name: string;
  partner: string;
  zone_code: string;
  dpd_target: string;
  dpd_period: string;
  status: DpdTargetImportStatus;
  rule_id: string | null;
  rule_name: string | null;
  scope_id: string | null;
  resolved_scope: "restaurant" | "zone" | null;
  note: string | null;
};

export function normalizeDpdScopeType(
  value: string,
): "restaurant" | "zone" | null {
  const v = value.trim().toLowerCase();
  if (v === "restaurant" || v === "restaurants") return "restaurant";
  if (v === "zone" || v === "zones") return "zone";
  return null;
}

export function guessDpdTargetImportColumns(headers: string[]): {
  scope_type: number;
  name: number;
  dpd_target: number;
  dpd_period: number;
  partner: number;
  zone_code: number;
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
    scope_type: exact(["scope type", "scope", "type"]),
    name: exact([
      "restaurant / zone name",
      "restaurant/zone name",
      "name",
      "restaurant",
      "zone",
    ]),
    dpd_target: exact(["dpd target", "target"]),
    dpd_period: exact(["dpd target period", "period"]),
    partner: exact(["partner name", "partner"]),
    zone_code: exact(["zone code", "code"]),
  };
}

export function mapDpdTargetImportSheet(
  headers: string[],
  rows: string[][],
): DpdTargetImportInputRow[] {
  const cols = guessDpdTargetImportColumns(headers);
  return rows.map((cells) => ({
    scope_type: cols.scope_type >= 0 ? cells[cols.scope_type] : "",
    name: cols.name >= 0 ? cells[cols.name] : "",
    dpd_target: cols.dpd_target >= 0 ? cells[cols.dpd_target] : "",
    dpd_period: cols.dpd_period >= 0 ? cells[cols.dpd_period] : "",
    partner: cols.partner >= 0 ? cells[cols.partner] : "",
    zone_code: cols.zone_code >= 0 ? cells[cols.zone_code] : "",
  }));
}

function eqName(value: string, needle: string): boolean {
  return value.trim().toLowerCase() === needle.trim().toLowerCase();
}

function pickRule(
  rules: DpdTargetImportExistingRule[],
  scope: "restaurant" | "zone",
  id: string,
): DpdTargetImportExistingRule | null {
  const candidates = rules
    .filter((rule) =>
      scope === "restaurant"
        ? rule.scope_type === "restaurant" && rule.restaurant_ids.includes(id)
        : rule.scope_type === "zone" && rule.zone_ids.includes(id),
    )
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return b.priority - a.priority;
    });
  return candidates[0] ?? null;
}

function resolveHits<T extends { id: string }>(
  hits: T[],
  note: string | null,
): {
  status: "ok" | "unknown_name" | "ambiguous_name";
  id: string | null;
  note: string | null;
} {
  if (hits.length === 0) return { status: "unknown_name", id: null, note };
  if (hits.length > 1) return { status: "ambiguous_name", id: null, note };
  return { status: "ok", id: hits[0].id, note: null };
}

function resolveRestaurant(
  name: string,
  partner: string,
  restaurants: DpdTargetImportRestaurant[],
): {
  status: "ok" | "unknown_name" | "ambiguous_name";
  id: string | null;
  note: string | null;
} {
  let hits = restaurants.filter((r) => eqName(r.name, name));
  const partnerNeedle = partner.trim().toLowerCase();
  if (partnerNeedle) {
    hits = hits.filter((r) => eqName(r.partner_name, partnerNeedle));
  }
  const note =
    hits.length > 1
      ? [...new Set(hits.map((r) => r.partner_name || "—"))].join(", ")
      : null;
  return resolveHits(hits, note);
}

function resolveZone(
  name: string,
  zoneCode: string,
  zones: DpdTargetImportZone[],
): {
  status: "ok" | "unknown_name" | "ambiguous_name";
  id: string | null;
  note: string | null;
} {
  let hits = zones.filter((z) => eqName(z.name, name));
  const codeNeedle = zoneCode.trim().toLowerCase();
  if (codeNeedle) {
    hits = hits.filter((z) => eqName(z.code, codeNeedle));
  }
  const note =
    hits.length > 1 ? hits.map((z) => z.code || "—").join(", ") : null;
  return resolveHits(hits, note);
}

function resolveScope(input: {
  scopeType: "restaurant" | "zone" | null;
  name: string;
  partner: string;
  zoneCode: string;
  restaurants: DpdTargetImportRestaurant[];
  zones: DpdTargetImportZone[];
}): {
  status: "ok" | "unknown_name" | "ambiguous_name";
  scope: "restaurant" | "zone" | null;
  id: string | null;
  note: string | null;
} {
  const { scopeType, name, partner, zoneCode, restaurants, zones } = input;
  if (scopeType === "restaurant") {
    const hit = resolveRestaurant(name, partner, restaurants);
    return { ...hit, scope: hit.status === "ok" ? "restaurant" : null };
  }
  if (scopeType === "zone") {
    const hit = resolveZone(name, zoneCode, zones);
    return { ...hit, scope: hit.status === "ok" ? "zone" : null };
  }

  const restaurant = resolveRestaurant(name, partner, restaurants);
  const zone = resolveZone(name, zoneCode, zones);
  if (restaurant.status === "ok" && zone.status !== "ok") {
    return { ...restaurant, scope: "restaurant" };
  }
  if (zone.status === "ok" && restaurant.status !== "ok") {
    return { ...zone, scope: "zone" };
  }
  if (restaurant.status === "ok" && zone.status === "ok") {
    return {
      status: "ambiguous_name",
      scope: null,
      id: null,
      note: "restaurant, zone",
    };
  }
  if (restaurant.status === "ambiguous_name" || zone.status === "ambiguous_name") {
    return {
      status: "ambiguous_name",
      scope: null,
      id: null,
      note: [restaurant.note, zone.note].filter(Boolean).join("; ") || null,
    };
  }
  return { status: "unknown_name", scope: null, id: null, note: null };
}

export function previewDpdTargetRows(input: {
  rows: DpdTargetImportInputRow[];
  restaurants: DpdTargetImportRestaurant[];
  zones: DpdTargetImportZone[];
  rules: DpdTargetImportExistingRule[];
}): DpdTargetImportPreviewRow[] {
  const claimed = new Set<string>();

  return input.rows.map((row, index) => {
    const scope_type = row.scope_type?.trim() ?? "";
    const name = row.name?.trim() ?? "";
    const partner = row.partner?.trim() ?? "";
    const zone_code = row.zone_code?.trim() ?? "";
    const dpd_target = row.dpd_target?.trim() ?? "";
    const dpd_period = row.dpd_period?.trim() ?? "";
    const base: DpdTargetImportPreviewRow = {
      row_number: index + 1,
      scope_type,
      name,
      partner,
      zone_code,
      dpd_target,
      dpd_period,
      status: "unknown_name",
      rule_id: null,
      rule_name: null,
      scope_id: null,
      resolved_scope: null,
      note: null,
    };

    if (!name) return base;

    const resolved = resolveScope({
      scopeType: normalizeDpdScopeType(scope_type),
      name,
      partner,
      zoneCode: zone_code,
      restaurants: input.restaurants,
      zones: input.zones,
    });
    if (resolved.status !== "ok" || !resolved.id || !resolved.scope) {
      return {
        ...base,
        status: resolved.status,
        note: resolved.note,
      };
    }

    const claimKey = `${resolved.scope}:${resolved.id}`;
    if (claimed.has(claimKey)) {
      return {
        ...base,
        status: "duplicate",
        scope_id: resolved.id,
        resolved_scope: resolved.scope,
      };
    }
    claimed.add(claimKey);

    const target = Number(dpd_target);
    if (!Number.isFinite(target) || target <= 0) {
      return {
        ...base,
        status: "invalid_target",
        scope_id: resolved.id,
        resolved_scope: resolved.scope,
      };
    }
    const period = dpd_period.toLowerCase();
    if (period !== "daily" && period !== "weekly" && period !== "monthly") {
      return {
        ...base,
        status: "invalid_period",
        scope_id: resolved.id,
        resolved_scope: resolved.scope,
      };
    }

    const match = pickRule(input.rules, resolved.scope, resolved.id);
    if (!match) {
      return {
        ...base,
        status: "create",
        scope_id: resolved.id,
        resolved_scope: resolved.scope,
      };
    }
    return {
      ...base,
      status: "ok",
      rule_id: match.id,
      rule_name: match.name,
      scope_id: resolved.id,
      resolved_scope: resolved.scope,
    };
  });
}

export function applyableDpdTargetRows(
  rows: DpdTargetImportPreviewRow[],
): DpdTargetImportPreviewRow[] {
  return rows.filter((row) => row.status === "ok" || row.status === "create");
}
