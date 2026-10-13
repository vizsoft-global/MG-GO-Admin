export type RestaurantEdge = {
  owner: string;
  restaurantId: string;
  name: string;
};

const INTAKE_SORT_KEYS = new Set([
  "name",
  "driverId",
  "phone",
  "platformId",
  "platformName",
  "riderCategory",
  "companyName",
  "companyClientId",
]);

/**
 * The default drivers page can sort and page intakes before reading driver
 * documents. Zone, status, attendance, restaurants, todayDeliveries and custom
 * fields still need the joined row.
 */
export function canDeferDriverJoin(input: {
  tab: string;
  search: string | null;
  filterCount: number;
  sortKey: string;
}): boolean {
  if (input.tab !== "all") return false;
  if ((input.search ?? "").trim() !== "") return false;
  if (input.filterCount > 0) return false;
  if (input.sortKey.startsWith("cf:")) return false;
  return INTAKE_SORT_KEYS.has(input.sortKey);
}

export type RosterKpiRow = {
  linkedProfileId: string | null;
  workflowStatus: string | null;
  accountStatus: string | null;
  onDuty: boolean;
};

export type RosterKpis = {
  total: number;
  activeToday: number;
  onlineNow: number;
  inactive: number;
  pendingVerification: number;
  suspended: number;
};

/**
 * Same predicates as the joined non-archived roster. Each intake counts once,
 * so an unlinked row that is also workflow-pending is not added twice.
 * Pass intake rows only. A driver document with no intake is not a roster row.
 */
export function rosterKpis(rows: readonly RosterKpiRow[]): RosterKpis {
  let activeToday = 0;
  let onlineNow = 0;
  let inactive = 0;
  let pendingVerification = 0;
  let suspended = 0;
  for (const row of rows) {
    if (row.accountStatus === "active") activeToday += 1;
    if (row.onDuty) onlineNow += 1;
    if (row.accountStatus === "active" && !row.onDuty) inactive += 1;
    if (
      row.linkedProfileId === null ||
      row.workflowStatus === "pending" ||
      row.accountStatus === "pending"
    ) {
      pendingVerification += 1;
    }
    if (row.accountStatus === "suspended") suspended += 1;
  }
  return {
    total: rows.length,
    activeToday,
    onlineNow,
    inactive,
    pendingVerification,
    suspended,
  };
}

export function dedupeRestaurantEdges(
  edges: readonly RestaurantEdge[],
): Map<string, { id: string; name: string }[]> {
  const byOwner = new Map<string, { id: string; name: string }[]>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edge.owner || !edge.restaurantId) continue;
    const key = `${edge.owner}\0${edge.restaurantId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byOwner.get(edge.owner) ?? [];
    bucket.push({ id: edge.restaurantId, name: edge.name });
    byOwner.set(edge.owner, bucket);
  }
  for (const bucket of byOwner.values()) {
    bucket.sort((left, right) =>
      left.name === right.name ? left.id.localeCompare(right.id) : left.name.localeCompare(right.name),
    );
  }
  return byOwner;
}
