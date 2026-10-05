"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import {
  allAssetCatalogImageKeys,
  allDriverAvatarKeys,
  allIntakeAvatarKeys,
  allIntakeDocumentKeys,
  allRestaurantLogoKeys,
  buildDriverDocumentKey,
  isR2ObjectKey,
} from "@/lib/storage/r2-keys";
import type { DriverDocumentType } from "@/features/drivers/types";
import type { Json } from "@/types/database";
import { deleteObject, deleteObjects } from "@/lib/storage/r2-client";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  isPurgeAllEntity,
  purgeAllModuleFor,
  type PurgeAllEntity,
} from "./purge-entities";

const PAGE_SIZE = 25;

/**
 * Clear all loops the batched RPC until the module is empty, but it stops after
 * this long and hands the remainder back. `deliveries` is ~168k rows at 500 per
 * round; one request that walked the whole table would sit past every serverless
 * ceiling and lose the count it had already deleted. A short budget plus a
 * visible remaining count means the operator presses the button again instead.
 */
const PURGE_ALL_BUDGET_MS = 40_000;
const PURGE_ALL_BATCH = 500;
const PURGE_ALL_MAX_ROUNDS = 400;

export type CleanupTab =
  | "drivers"
  | "zones"
  | "restaurants"
  | "delivery_rules"
  | "incentive_rules"
  | "assets"
  | "deliveries";

export type PurgeEntityType =
  | "driver"
  | "intake"
  | "zone"
  | "restaurant"
  | "delivery_rule"
  | "incentive_rule"
  | "asset_catalog"
  | "delivery";

export type CleanupCandidate = {
  id: string;
  purgeId: string;
  purgeType: PurgeEntityType;
  label: string;
  sublabel?: string;
  status?: string;
};

export type CleanupCandidatesPage = {
  items: CleanupCandidate[];
  total: number;
  page: number;
  pageSize: number;
};

export type CleanupPreviewItem = {
  id: string;
  counts: Record<string, number>;
  storage_key_count: number;
  blockers: string[];
};

export type CleanupPreviewResult = {
  items: CleanupPreviewItem[];
};

export type CleanupPurgeSelection = {
  purgeId: string;
  purgeType: PurgeEntityType;
};

export type CleanupPurgeResult =
  | { ok: true; deleted: number; errors: string[] }
  | { error: string; errorDetail?: string };

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

const DRIVER_DOC_TYPES: DriverDocumentType[] = [
  "license",
  "civil_id",
  "work_permit",
  "passport",
];

function allDriverDocumentKeys(driverId: string): string[] {
  const exts = ["pdf", "png", "jpg", "webp"] as const;
  return DRIVER_DOC_TYPES.flatMap((docType) =>
    exts.map((ext) => buildDriverDocumentKey(driverId, docType, ext)),
  );
}

function expandStorageEntry(entry: string): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return [];

  const driverPrefix = trimmed.match(/^drivers\/([^/]+)\/$/);
  if (driverPrefix) {
    return [...allDriverAvatarKeys(driverPrefix[1]), ...allDriverDocumentKeys(driverPrefix[1])];
  }

  const intakePrefix = trimmed.match(/^drivers\/intakes\/([^/]+)\/$/);
  if (intakePrefix) {
    return [...allIntakeDocumentKeys(intakePrefix[1]), ...allIntakeAvatarKeys(intakePrefix[1])];
  }

  const restaurantPrefix = trimmed.match(/^restaurants\/([^/]+)\/$/);
  if (restaurantPrefix) {
    return allRestaurantLogoKeys(restaurantPrefix[1]);
  }

  if (isR2ObjectKey(trimmed)) return [trimmed];
  return [];
}

async function cleanupStorageEntries(entries: string[]): Promise<void> {
  const keys = [...new Set(entries.flatMap(expandStorageEntry))];
  if (keys.length === 0) return;
  try {
    await deleteObjects(keys);
  } catch {
    /* best-effort */
  }

  try {
    const admin = createAdminClient();
    await admin.from("storage_uploads").delete().in("object_key", keys);
  } catch {
    /* best-effort */
  }
}

async function cleanupStorageKeys(keys: string[]): Promise<void> {
  const objectKeys = keys.filter((k) => isR2ObjectKey(k));
  for (const key of objectKeys) {
    try {
      await deleteObject(key);
    } catch {
      /* best-effort */
    }
  }
  if (objectKeys.length > 0) {
    try {
      const admin = createAdminClient();
      await admin.from("storage_uploads").delete().in("object_key", objectKeys);
    } catch {
      /* best-effort */
    }
  }
}

export async function fetchCleanupCandidates(
  tab: CleanupTab,
  search: string,
  page: number,
  options?: { archivedOnly?: boolean },
): Promise<CleanupCandidatesPage | { error: string }> {
  const auth = await requireSuperAdmin();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const q = search.trim();
  const from = Math.max(0, (page - 1) * PAGE_SIZE);
  const to = from + PAGE_SIZE - 1;

  if (tab === "drivers") {
    let query = supabase
      .from("driver_intakes")
      .select("id, full_name, phone, driver_code, linked_profile_id, archived_at, workflow_status", {
        count: "exact",
      })
      .order("created_at", { ascending: false });

    if (options?.archivedOnly) {
      query = query.not("archived_at", "is", null);
    }

    if (q) {
      query = query.or(
        `full_name.ilike.%${q}%,phone.ilike.%${q}%,driver_code.ilike.%${q}%`,
      );
    }

    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };

    const items: CleanupCandidate[] = (data ?? []).map((row) => {
      const linked = Boolean(row.linked_profile_id);
      return {
        id: row.id,
        purgeId: linked ? row.linked_profile_id! : row.id,
        purgeType: linked ? "driver" : "intake",
        label: row.full_name?.trim() || row.driver_code || row.phone || row.id,
        sublabel: [row.driver_code, row.phone].filter(Boolean).join(" · "),
        status: row.archived_at
          ? "archived"
          : linked
            ? "linked"
            : row.workflow_status ?? "awaiting",
      };
    });

    return { items, total: count ?? items.length, page, pageSize: PAGE_SIZE };
  }

  if (tab === "zones") {
    let query = supabase
      .from("zones")
      .select("id, name, code", { count: "exact" })
      .order("name", { ascending: true });
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        purgeId: row.id,
        purgeType: "zone",
        label: row.name,
        sublabel: row.code,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  if (tab === "restaurants") {
    let query = supabase
      .from("restaurants")
      .select("id, name, restaurant_code, status", { count: "exact" })
      .order("name", { ascending: true });
    if (q) query = query.or(`name.ilike.%${q}%,restaurant_code.ilike.%${q}%`);
    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        purgeId: row.id,
        purgeType: "restaurant",
        label: row.name,
        sublabel: row.restaurant_code ?? undefined,
        status: row.status ?? undefined,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  if (tab === "delivery_rules") {
    let query = supabase
      .from("delivery_rules")
      .select("id, name, status", { count: "exact" })
      .order("name", { ascending: true });
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        purgeId: row.id,
        purgeType: "delivery_rule",
        label: row.name,
        status: row.status ?? undefined,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  if (tab === "incentive_rules") {
    let query = supabase
      .from("incentive_rules")
      .select("id, name, status", { count: "exact" })
      .order("name", { ascending: true });
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        purgeId: row.id,
        purgeType: "incentive_rule",
        label: row.name,
        status: row.status ?? undefined,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  if (tab === "assets") {
    let query = supabase
      .from("asset_catalog")
      .select("id, name, code, is_active", { count: "exact" })
      .order("name", { ascending: true });
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
    const { data, error, count } = await query.range(from, to);
    if (error) return { error: "fetch_failed" };
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        purgeId: row.id,
        purgeType: "asset_catalog",
        label: row.name,
        sublabel: row.code,
        status: row.is_active ? "active" : "inactive",
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  let query = supabase
    .from("deliveries")
    .select("id, external_order_id, status, delivered_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.ilike("external_order_id", `%${q}%`);
  const { data, error, count } = await query.range(from, to);
  if (error) return { error: "fetch_failed" };
  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      purgeId: row.id,
      purgeType: "delivery",
      label: row.external_order_id ?? row.id.slice(0, 8),
      sublabel: row.delivered_at ?? undefined,
      status: row.status ?? undefined,
    })),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function previewCleanupPurge(
  selections: CleanupPurgeSelection[],
): Promise<CleanupPreviewResult | { error: string; errorDetail?: string }> {
  const auth = await requireSuperAdmin();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const byType = new Map<PurgeEntityType, string[]>();
  for (const sel of selections) {
    const list = byType.get(sel.purgeType) ?? [];
    list.push(sel.purgeId);
    byType.set(sel.purgeType, list);
  }

  const allItems: CleanupPreviewItem[] = [];

  for (const [entityType, ids] of byType) {
    const uniqueIds = [...new Set(ids)];
    const { data, error } = await supabase.rpc("admin_preview_purge", {
      p_entity_type: entityType,
      p_ids: uniqueIds,
    });
    if (error) {
      return { error: "preview_failed" };
    }
    const payload = (data ?? { items: [] }) as { items?: CleanupPreviewItem[] };
    for (const item of payload.items ?? []) {
      allItems.push({
        id: item.id,
        counts: item.counts ?? {},
        storage_key_count: item.storage_key_count ?? 0,
        blockers: item.blockers ?? [],
      });
    }
  }

  return { items: allItems };
}

async function callPurgeRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  type: PurgeEntityType,
  ids: string[],
) {
  switch (type) {
    case "delivery":
      return supabase.rpc("admin_purge_deliveries", { p_ids: ids });
    case "driver":
      return supabase.rpc("admin_purge_drivers", { p_ids: ids });
    case "intake":
      return supabase.rpc("admin_purge_intakes", { p_ids: ids });
    case "restaurant":
      return supabase.rpc("admin_purge_restaurants", { p_ids: ids });
    case "zone":
      return supabase.rpc("admin_purge_zones", { p_ids: ids });
    case "delivery_rule":
      return supabase.rpc("admin_purge_delivery_rules", { p_ids: ids });
    case "incentive_rule":
      return supabase.rpc("admin_purge_incentive_rules", { p_ids: ids });
    case "asset_catalog":
      return supabase.rpc("admin_purge_asset_catalog", { p_ids: ids });
  }
}

async function executePurgeBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  type: PurgeEntityType,
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await callPurgeRpc(supabase, type, ids);
  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? {}) as Record<string, unknown>;

  if (type === "driver") {
    const storageKeys = (payload.storage_keys as string[] | undefined) ?? [];
    await cleanupStorageEntries(storageKeys);

    const manifest = (payload.manifest as Array<{ auth_user_id?: string }> | undefined) ?? [];
    const admin = createAdminClient();
    for (const entry of manifest) {
      const authUserId = entry.auth_user_id;
      if (!authUserId) continue;
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch {
        /* best-effort */
      }
    }
  } else if (type === "intake") {
    const prefixes = (payload.storage_prefixes as string[] | undefined) ?? [];
    await cleanupStorageEntries(prefixes);
  } else if (type === "restaurant") {
    const prefixes = (payload.storage_prefixes as string[] | undefined) ?? [];
    await cleanupStorageEntries(prefixes);
  } else if (type === "delivery" || type === "asset_catalog") {
    const keys = (payload.storage_keys as string[] | undefined) ?? [];
    await cleanupStorageKeys(keys);
    if (type === "asset_catalog") {
      for (const id of ids) {
        try {
          await deleteObjects(allAssetCatalogImageKeys(id));
        } catch {
          /* best-effort */
        }
      }
    }
  }

  void logAdminMutation({
    action: "delete",
    entityType: `data_cleanup_${type}`,
    routeName: "executeCleanupPurge",
    context: { ids, purgeType: type },
    after: payload as Record<string, unknown>,
  });

  return { ok: true };
}

export async function executeCleanupPurge(
  selections: CleanupPurgeSelection[],
): Promise<CleanupPurgeResult> {
  const auth = await requireSuperAdmin();
  if (auth.error) return { error: auth.error };

  if (selections.length === 0) {
    return { error: "nothing_selected" };
  }

  const supabase = await createClient();
  const byType = new Map<PurgeEntityType, string[]>();
  for (const sel of selections) {
    const list = byType.get(sel.purgeType) ?? [];
    list.push(sel.purgeId);
    byType.set(sel.purgeType, list);
  }

  const errors: string[] = [];
  let deleted = 0;

  for (const [type, ids] of byType) {
    const uniqueIds = [...new Set(ids)];
    const result = await executePurgeBatch(supabase, type, uniqueIds);
    if (result.ok) {
      deleted += uniqueIds.length;
    } else {
      errors.push(`${type}: ${result.error ?? "purge_failed"}`);
    }
  }

  if (deleted === 0 && errors.length > 0) {
    return { error: "purge_failed", errorDetail: errors.join("; ") };
  }

  return { ok: true, deleted, errors };
}

/* ------------------------------------------------------------------ */
/* Clear all — one module at a time                                    */
/* ------------------------------------------------------------------ */

export type PurgeAllPreviewItem = {
  entity: PurgeAllEntity;
  count: number;
  blockers: string[];
};

export type PurgeAllPreviewResult =
  | { items: PurgeAllPreviewItem[] }
  | { error: string; errorDetail?: string };

export type PurgeAllRunResult =
  | {
      ok: true;
      entity: PurgeAllEntity;
      deleted: number;
      remaining: number;
      blockers: string[];
      rounds: number;
      done: boolean;
      /** Set when a round failed after some rows were already gone. */
      warning?: string;
    }
  | { error: string; errorDetail?: string };

async function requirePurgeAllAccess(entity: PurgeAllEntity) {
  const session = await getSessionUser();
  if (!session) return { error: "not_authorized" as const };

  const module = purgeAllModuleFor(entity);
  if (!module) return { error: "unknown_entity" as const };

  if (
    !hasPermissionInSet(session.permissions, module.slug, session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }

  return { session };
}

/**
 * Live row count and blockers per module. Only the modules the caller holds a
 * `*.bulk_delete` tick for are returned — the database checks the same tick
 * again on every run, so this is the UI's copy of the lock, not the lock.
 */
export async function previewPurgeAllModules(
  entities: PurgeAllEntity[],
): Promise<PurgeAllPreviewResult> {
  const session = await getSessionUser();
  if (!session) return { error: "not_authorized" };

  const allowed = entities.filter((entity) => {
    const module = purgeAllModuleFor(entity);
    return (
      module !== null &&
      hasPermissionInSet(session.permissions, module.slug, session.isSuperAdmin)
    );
  });

  if (allowed.length === 0) return { items: [] };

  const supabase = await createClient();
  const items: PurgeAllPreviewItem[] = [];

  for (const entity of allowed) {
    const { data, error } = await supabase.rpc("admin_purge_preview_all", {
      p_entity: entity,
    });
    if (error) {
      return { error: "preview_failed", errorDetail: error.message };
    }
    const payload = (data ?? {}) as {
      count?: number;
      blockers?: string[] | null;
    };
    items.push({
      entity,
      count: payload.count ?? 0,
      blockers: payload.blockers ?? [],
    });
  }

  return { items };
}

export async function previewPurgeAllModule(
  entity: PurgeAllEntity,
): Promise<PurgeAllPreviewResult> {
  if (!isPurgeAllEntity(entity)) return { error: "unknown_entity" };
  return previewPurgeAllModules([entity]);
}

/**
 * Empties one module, in 500-row rounds, until it is clear or the budget runs
 * out. Storage objects and linked Auth users are collected across every round
 * and cleaned once at the end, because a driver deleted in round 3 still owns
 * the avatar that round 1 already reported.
 */
export async function runPurgeAllModule(
  entity: PurgeAllEntity,
): Promise<PurgeAllRunResult> {
  if (!isPurgeAllEntity(entity)) return { error: "unknown_entity" };

  const auth = await requirePurgeAllAccess(entity);
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const startedAt = Date.now();
  const storageEntries = new Set<string>();
  const authUserIds = new Set<string>();

  let deleted = 0;
  let remaining = 0;
  let blockers: string[] = [];
  let rounds = 0;
  let failure: string | null = null;
  let storageKeyCount = 0;

  for (let round = 0; round < PURGE_ALL_MAX_ROUNDS; round += 1) {
    if (round > 0 && Date.now() - startedAt > PURGE_ALL_BUDGET_MS) break;

    const { data, error } = await supabase.rpc("admin_purge_run_all", {
      p_entity: entity,
      p_limit: PURGE_ALL_BATCH,
    });
    if (error) {
      failure = error.message;
      break;
    }

    rounds += 1;
    const payload = (data ?? {}) as {
      deleted?: number;
      remaining?: number;
      blockers?: string[] | null;
      storage_keys?: string[] | null;
      manifest?: Array<{ auth_user_id?: string | null }> | null;
    };

    const roundDeleted = payload.deleted ?? 0;
    deleted += roundDeleted;
    remaining = payload.remaining ?? 0;
    blockers = payload.blockers ?? [];

    for (const entry of payload.storage_keys ?? []) {
      if (entry) {
        storageEntries.add(entry);
        storageKeyCount += 1;
      }
    }
    for (const entry of payload.manifest ?? []) {
      if (entry?.auth_user_id) authUserIds.add(entry.auth_user_id);
    }

    if (blockers.length > 0 || roundDeleted === 0 || remaining === 0) break;
  }

  if (storageEntries.size > 0) {
    await cleanupStorageEntries([...storageEntries]);
  }

  if (authUserIds.size > 0) {
    const admin = createAdminClient();
    for (const authUserId of authUserIds) {
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch {
        /* best-effort — the profile row is already gone */
      }
    }
  }

  void logAdminMutation({
    action: "delete",
    entityType: `data_cleanup_${entity}_all`,
    routeName: "runPurgeAllModule",
    context: { entity, deleted, remaining, rounds, storage_key_count: storageKeyCount },
    after: { entity, deleted, remaining, blockers },
  });

  if (failure && deleted === 0) {
    return { error: "purge_failed", errorDetail: failure };
  }

  return {
    ok: true,
    entity,
    deleted,
    remaining,
    blockers,
    rounds,
    done: blockers.length === 0 && remaining === 0,
    warning: failure ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Clear by filter — the same delete path, narrowed to a subset        */
/* ------------------------------------------------------------------ */

export type PurgeFilterColumnInfo = {
  key: string;
  kind: string;
};

export type PurgeFilterFacet = {
  value: string;
  /** The server's readable label, or `null` for a raw token. */
  label: string | null;
};

export type PurgeFilteredRow = {
  id: string;
  label: string;
  sublabel: string;
  status: string;
  kind: string;
};

export type PurgeFilteredPreview = {
  count: number;
  breakdown: Record<string, number>;
  blockers: string[];
  sample: PurgeFilteredRow[];
};

export type PurgeFilteredPage = {
  rows: PurgeFilteredRow[];
  total: number;
  hasMore: boolean;
};

export type PurgeFilteredRunResult =
  | {
      ok: true;
      entity: string;
      deleted: number;
      remaining: number;
      blockers: string[];
      rounds: number;
      done: boolean;
      warning?: string;
    }
  | { error: string; errorDetail?: string };

const PURGE_FILTERED_PAGE_SIZE = 25;

/**
 * Filtered purge is super admin only, exactly like the row-by-row candidate
 * tab and for the same reason: it sweeps storage objects and removes Auth
 * users. The `*.bulk_delete` tick Clear all checks is deliberately *not*
 * accepted here — a bulk_delete tick is permission to empty a module, and
 * choosing an arbitrary subset is a different, wider power.
 */
async function requireFilteredPurgeAccess() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function parseFilteredRows(payload: unknown): PurgeFilteredRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      sublabel: String(row.sublabel ?? ""),
      status: String(row.status ?? ""),
      kind: String(row.kind ?? ""),
    };
  });
}

/** The server's word on which columns this entity can be filtered by. */
export async function fetchPurgeFilterColumns(
  entity: string,
): Promise<PurgeFilterColumnInfo[] | { error: string; errorDetail?: string }> {
  const auth = await requireFilteredPurgeAccess();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_purge_filter_columns", {
    p_entity: entity,
  });
  if (error) return { error: "fetch_failed", errorDetail: error.message };
  if (!Array.isArray(data)) {
    // `NULL` is the server saying this module has no filter spec yet — an
    // empty list, not a failure, so the dialog can say so plainly.
    return [];
  }

  return data.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return { key: String(row.key ?? ""), kind: String(row.kind ?? "text") };
  });
}

/**
 * Distinct values for one column, honouring every *other* active filter — the
 * same contract the drivers list facets use, so a value that cannot match is
 * not offered.
 */
export async function fetchPurgeFilterValues(
  entity: string,
  column: string,
  filters: Record<string, unknown>,
): Promise<PurgeFilterFacet[] | { error: string; errorDetail?: string }> {
  const auth = await requireFilteredPurgeAccess();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_purge_filtered_values", {
    p_entity: entity,
    p_column: column,
    p_filters: filters as unknown as Json,
  });
  if (error) return { error: "fetch_failed", errorDetail: error.message };
  if (!Array.isArray(data)) return [];

  return data.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      value: String(row.value ?? ""),
      label: row.label == null ? null : String(row.label),
    };
  });
}

export async function previewFilteredPurge(
  entity: string,
  filters: Record<string, unknown>,
): Promise<PurgeFilteredPreview | { error: string; errorDetail?: string }> {
  const auth = await requireFilteredPurgeAccess();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_purge_filtered_preview", {
    p_entity: entity,
    p_filters: filters as unknown as Json,
  });
  if (error) return { error: "preview_failed", errorDetail: error.message };

  const payload = (data ?? {}) as Record<string, unknown>;
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  return {
    count: Number(payload.count ?? 0),
    breakdown: (payload.breakdown ?? {}) as Record<string, number>,
    blockers: blockers.map((entry) => String(entry)),
    sample: parseFilteredRows(payload.sample),
  };
}

export async function pageFilteredPurge(
  entity: string,
  filters: Record<string, unknown>,
  page: number,
): Promise<PurgeFilteredPage | { error: string; errorDetail?: string }> {
  const auth = await requireFilteredPurgeAccess();
  if (auth.error) return { error: auth.error };

  const offset = Math.max(0, (page - 1) * PURGE_FILTERED_PAGE_SIZE);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_purge_filtered_page", {
    p_entity: entity,
    p_filters: filters as unknown as Json,
    p_limit: PURGE_FILTERED_PAGE_SIZE,
    p_offset: offset,
  });
  if (error) return { error: "preview_failed", errorDetail: error.message };

  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    rows: parseFilteredRows(payload.rows),
    total: Number(payload.total ?? 0),
    hasMore: Boolean(payload.hasMore),
  };
}

/**
 * Deletes the matched subset in 500-row rounds.
 *
 * The loop, the budget and the storage/Auth sweep are the Clear all loop,
 * because a filtered purge must be no more destructive than emptying the
 * module — only narrower. The filters are re-sent to every round rather than
 * the ids being pinned up front: a row the operator's filter no longer matches
 * (a delivery verified between the preview and the run) must not be deleted on
 * a stale id, and the blockers are re-checked by the RPC each round.
 */
export async function runFilteredPurge(
  entity: string,
  filters: Record<string, unknown>,
): Promise<PurgeFilteredRunResult> {
  const auth = await requireFilteredPurgeAccess();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const startedAt = Date.now();
  const storageEntries = new Set<string>();
  const authUserIds = new Set<string>();

  let deleted = 0;
  let remaining = 0;
  let blockers: string[] = [];
  let rounds = 0;
  let failure: string | null = null;
  let storageKeyCount = 0;

  for (let round = 0; round < PURGE_ALL_MAX_ROUNDS; round += 1) {
    if (round > 0 && Date.now() - startedAt > PURGE_ALL_BUDGET_MS) break;

    const { data, error } = await supabase.rpc("admin_purge_filtered_run", {
      p_entity: entity,
      p_filters: filters as unknown as Json,
      p_limit: PURGE_ALL_BATCH,
    });
    if (error) {
      failure = error.message;
      break;
    }

    rounds += 1;
    const payload = (data ?? {}) as {
      deleted?: number;
      remaining?: number;
      blockers?: string[] | null;
      storage_keys?: string[] | null;
      manifest?: Array<{ auth_user_id?: string | null }> | null;
    };

    const roundDeleted = payload.deleted ?? 0;
    deleted += roundDeleted;
    remaining = payload.remaining ?? 0;
    blockers = payload.blockers ?? [];

    for (const entry of payload.storage_keys ?? []) {
      if (entry) {
        storageEntries.add(entry);
        storageKeyCount += 1;
      }
    }
    for (const entry of payload.manifest ?? []) {
      if (entry?.auth_user_id) authUserIds.add(entry.auth_user_id);
    }

    if (blockers.length > 0 || roundDeleted === 0 || remaining === 0) break;
  }

  if (storageEntries.size > 0) {
    await cleanupStorageEntries([...storageEntries]);
  }

  if (authUserIds.size > 0) {
    const admin = createAdminClient();
    for (const authUserId of authUserIds) {
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch {
        /* best-effort — the profile row is already gone */
      }
    }
  }

  void logAdminMutation({
    action: "delete",
    entityType: `data_cleanup_${entity}_filtered`,
    routeName: "runFilteredPurge",
    context: { entity, deleted, remaining, rounds, storage_key_count: storageKeyCount, filters },
    after: { entity, deleted, remaining, blockers },
  });

  if (failure && deleted === 0) {
    return { error: "purge_failed", errorDetail: failure };
  }

  return {
    ok: true,
    entity,
    deleted,
    remaining,
    blockers,
    rounds,
    done: blockers.length === 0 && remaining === 0,
    warning: failure ?? undefined,
  };
}
