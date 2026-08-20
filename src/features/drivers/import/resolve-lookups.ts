const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseCommaSeparatedIds(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export type NamedRecord = { id: string; name: string };
export type ZoneRecord = NamedRecord & { code: string | null };
export type RestaurantRecord = NamedRecord & { restaurant_code: string | null };

export type LabelLookupResult =
  | { status: "ok"; id: string; name: string }
  | { status: "unmatched" }
  | { status: "ambiguous" }
  | { status: "empty" };

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueByKey(entries: Array<{ key: string; record: NamedRecord }>): {
  unique: Map<string, NamedRecord>;
  ambiguous: Set<string>;
} {
  const unique = new Map<string, NamedRecord>();
  const ambiguous = new Set<string>();
  const seen = new Map<string, NamedRecord>();
  for (const { key, record } of entries) {
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, record);
      unique.set(key, record);
      continue;
    }
    if (prev.id !== record.id) {
      unique.delete(key);
      ambiguous.add(key);
    }
  }
  return { unique, ambiguous };
}

export function buildPartnerIndex(partners: NamedRecord[]) {
  const byId = new Map(partners.map((p) => [p.id, p]));
  const nameEntries = partners.map((p) => ({ key: norm(p.name), record: p }));
  const { unique: byName, ambiguous: ambiguousNames } = uniqueByKey(nameEntries);
  return { byId, byName, ambiguousNames };
}

export function buildZoneIndex(zones: ZoneRecord[]) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const nameEntries = zones.map((z) => ({ key: norm(z.name), record: z }));
  const codeEntries = zones
    .filter((z) => z.code?.trim())
    .map((z) => ({ key: norm(z.code!), record: z }));
  const { unique: byName, ambiguous: ambiguousNames } = uniqueByKey(nameEntries);
  const { unique: byCode, ambiguous: ambiguousCodes } = uniqueByKey(codeEntries);
  return { byId, byName, byCode, ambiguousNames, ambiguousCodes };
}

export function buildRestaurantIndex(restaurants: RestaurantRecord[]) {
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const nameEntries = restaurants.map((r) => ({ key: norm(r.name), record: r }));
  const codeEntries = restaurants
    .filter((r) => r.restaurant_code?.trim())
    .map((r) => ({
      key: r.restaurant_code!.trim().toUpperCase(),
      record: r,
    }));
  const { unique: byName, ambiguous: ambiguousNames } = uniqueByKey(nameEntries);
  const { unique: byCode, ambiguous: ambiguousCodes } = uniqueByKey(
    codeEntries.map((e) => ({ key: e.key.toLowerCase(), record: e.record })),
  );
  const byCodeUpper = new Map<string, NamedRecord>();
  for (const [key, record] of byCode) {
    byCodeUpper.set(key.toUpperCase(), record);
  }
  const ambiguousCodesUpper = new Set(
    [...ambiguousCodes].map((key) => key.toUpperCase()),
  );
  return {
    byId,
    byName,
    byCode: byCodeUpper,
    ambiguousNames,
    ambiguousCodes: ambiguousCodesUpper,
  };
}

export type PartnerIndex = ReturnType<typeof buildPartnerIndex>;
export type ZoneIndex = ReturnType<typeof buildZoneIndex>;
export type RestaurantIndex = ReturnType<typeof buildRestaurantIndex>;

export function resolvePartnerToken(
  token: string | null | undefined,
  index: PartnerIndex,
): LabelLookupResult {
  const value = token?.trim() ?? "";
  if (!value) return { status: "empty" };
  if (isUuid(value)) {
    const hit = index.byId.get(value);
    return hit ? { status: "ok", id: hit.id, name: hit.name } : { status: "unmatched" };
  }
  const key = norm(value);
  if (index.ambiguousNames.has(key)) return { status: "ambiguous" };
  const hit = index.byName.get(key);
  return hit ? { status: "ok", id: hit.id, name: hit.name } : { status: "unmatched" };
}

export function resolveZoneToken(
  token: string | null | undefined,
  index: ZoneIndex,
): LabelLookupResult {
  const value = token?.trim() ?? "";
  if (!value) return { status: "empty" };
  if (isUuid(value)) {
    const hit = index.byId.get(value);
    return hit ? { status: "ok", id: hit.id, name: hit.name } : { status: "unmatched" };
  }
  const key = norm(value);
  if (index.ambiguousCodes.has(key)) return { status: "ambiguous" };
  const byCode = index.byCode.get(key);
  if (byCode) return { status: "ok", id: byCode.id, name: byCode.name };
  if (index.ambiguousNames.has(key)) return { status: "ambiguous" };
  const byName = index.byName.get(key);
  return byName ? { status: "ok", id: byName.id, name: byName.name } : { status: "unmatched" };
}

export function resolveRestaurantToken(
  token: string,
  index: RestaurantIndex,
): LabelLookupResult {
  const value = token.trim();
  if (!value) return { status: "empty" };
  if (isUuid(value)) {
    const hit = index.byId.get(value);
    return hit ? { status: "ok", id: hit.id, name: hit.name } : { status: "unmatched" };
  }
  const codeKey = value.toUpperCase();
  if (index.ambiguousCodes.has(codeKey)) return { status: "ambiguous" };
  const byCode = index.byCode.get(codeKey);
  if (byCode) return { status: "ok", id: byCode.id, name: byCode.name };
  const nameKey = norm(value);
  if (index.ambiguousNames.has(nameKey)) return { status: "ambiguous" };
  const byName = index.byName.get(nameKey);
  return byName ? { status: "ok", id: byName.id, name: byName.name } : { status: "unmatched" };
}

export function resolveRestaurantTokens(
  raw: string | null,
  index: RestaurantIndex,
): {
  status: "ok" | "unmatched" | "ambiguous" | "empty";
  ids: string[];
  names: string[];
} {
  const tokens = parseCommaSeparatedIds(raw);
  if (tokens.length === 0) return { status: "empty", ids: [], names: [] };

  const ids: string[] = [];
  const names: string[] = [];
  for (const token of tokens) {
    const hit = resolveRestaurantToken(token, index);
    if (hit.status !== "ok") {
      return { status: hit.status === "empty" ? "unmatched" : hit.status, ids: [], names: [] };
    }
    if (!ids.includes(hit.id)) {
      ids.push(hit.id);
      names.push(hit.name);
    }
  }
  return { status: "ok", ids, names };
}
