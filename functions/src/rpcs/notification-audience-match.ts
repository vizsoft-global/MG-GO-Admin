export function statusWantedSet(raw: readonly string[]): Set<string> {
  const aliases: Record<string, readonly string[]> = {
    onboarding: ["pending", "onboarding"],
    inactive: ["suspended", "inactive"],
    pending: ["pending", "onboarding"],
    suspended: ["suspended", "inactive"],
  };
  const wanted = new Set<string>();
  for (const item of raw) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    for (const alias of aliases[key] ?? [key]) wanted.add(alias);
  }
  return wanted;
}

export function driverStatusSelected(status: string | null, wanted: ReadonlySet<string>): boolean {
  return wanted.has((status ?? "").trim().toLowerCase());
}

export function driverInZone(input: {
  zoneId: string | null;
  assignmentZoneIds: readonly string[];
  wanted: ReadonlySet<string>;
}): boolean {
  if (input.zoneId && input.wanted.has(input.zoneId)) return true;
  return input.assignmentZoneIds.some((id) => input.wanted.has(id));
}

export function partnerMatchKeys(partner: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const field of ["key", "slug", "name", "project_key"] as const) {
    const value = partner[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toLowerCase();
    if (trimmed) keys.push(trimmed);
  }
  return keys;
}

export function driverInPartner(input: {
  partnerId: string | null;
  projectKey: string | null;
  assignmentPartnerIds: readonly string[];
  wantedIds: ReadonlySet<string>;
  keysByPartnerId: ReadonlyMap<string, readonly string[]>;
}): boolean {
  if (input.partnerId && input.wantedIds.has(input.partnerId)) return true;
  if (input.assignmentPartnerIds.some((id) => input.wantedIds.has(id))) return true;
  const project = input.projectKey?.trim().toLowerCase();
  if (!project) return false;
  for (const id of input.wantedIds) {
    if ((input.keysByPartnerId.get(id) ?? []).includes(project)) return true;
  }
  return false;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function firstSorted(ids: readonly string[] | undefined): string | null {
  if (!ids?.length) return null;
  return [...ids].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

export function resolveImportHits(
  rows: readonly Record<string, unknown>[],
  indexes: {
    byEmployeeId: ReadonlyMap<string, readonly string[]>;
    byDriverCode: ReadonlyMap<string, readonly string[]>;
    byClientId: ReadonlyMap<string, readonly string[]>;
  },
): string[] {
  const resolved = new Set<string>();
  for (const row of rows) {
    const employeeId = text(row["employee_id"]);
    const driverCode = text(row["driver_code"]);
    const clientId = text(row["client_id"]);
    const hits = new Set<string>();
    const add = (id: string | null) => {
      if (id) hits.add(id);
    };
    if (employeeId) {
      add(firstSorted(indexes.byEmployeeId.get(employeeId)));
      add(firstSorted(indexes.byClientId.get(employeeId)));
    }
    if (driverCode) {
      add(firstSorted(indexes.byDriverCode.get(driverCode)));
      add(firstSorted(indexes.byClientId.get(driverCode)));
    }
    if (clientId) {
      add(firstSorted(indexes.byClientId.get(clientId)));
      add(firstSorted(indexes.byEmployeeId.get(clientId)));
      add(firstSorted(indexes.byDriverCode.get(clientId)));
    }
    if (hits.size !== 1) continue;
    const [only] = hits;
    if (only) resolved.add(only);
  }
  return [...resolved];
}
