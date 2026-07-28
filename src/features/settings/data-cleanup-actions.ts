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
import { deleteObject, deleteObjects } from "@/lib/storage/r2-client";

const PAGE_SIZE = 25;

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
        label: row.full_name?.trim() || row.driver_code || row.phone,
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
