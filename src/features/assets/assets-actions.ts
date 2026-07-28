"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  AssetAssignmentRow,
  AssetCatalogKpis,
  AssetCatalogRow,
  AssetDetailModel,
  AssetMutationResult,
  DriverFormCatalogItem,
} from "./types";
import {
  allAssetCatalogImageKeys,
  buildAssetCatalogImageKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import { resolveAssetImageUrl } from "@/lib/storage/asset-image-url";
import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";

type DbClient = SupabaseClient<Database>;

async function requireAssetsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "assets.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireAssetsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "assets.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function slugifyAssetCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function uploadAssetCatalogImageFile(
  catalogItemId: string,
  file: File,
  uploadedBy: string,
): Promise<{ error?: string; imageUrl?: string }> {
  if (file.size === 0) return {};

  const meta = resolvePartnerLogoMeta(file);
  if (meta.error) return { error: meta.error };
  const { ext, contentType } = meta;
  if (!ext || !contentType) return { error: "invalid_type" };

  const key = buildAssetCatalogImageKey(catalogItemId, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, contentType, {
      uploadedBy,
      entityType: "asset_catalog",
      entityId: catalogItemId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { imageUrl: key };
}

async function withResolvedAssetImages(items: AssetCatalogRow[]): Promise<AssetCatalogRow[]> {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      image_url: await resolveAssetImageUrl(item.image_url),
    })),
  );
}

function parseAssetFormFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const codeRaw = String(formData.get("code") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const iconKey = String(formData.get("iconKey") ?? "Package").trim() || "Package";
  const totalQuantity = parseInt(String(formData.get("totalQuantity") ?? "0"), 10);
  const reorderLevel = parseInt(String(formData.get("reorderLevel") ?? "0"), 10);
  const isActive = formData.get("isActive") !== "false";

  return {
    name,
    code: (codeRaw || slugifyAssetCode(name)).toLowerCase(),
    description,
    iconKey,
    totalQuantity: Number.isFinite(totalQuantity) ? Math.max(0, totalQuantity) : 0,
    reorderLevel: Number.isFinite(reorderLevel) ? Math.max(0, reorderLevel) : 0,
    isActive,
  };
}

async function fetchAssignedQtyByCatalog(
  supabase: DbClient,
  catalogIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (catalogIds.length === 0) return map;

  const { data, error } = await supabase
    .from("asset_assignments")
    .select("catalog_item_id, quantity")
    .in("catalog_item_id", catalogIds)
    .eq("status", "assigned");

  if (error) throw error;

  for (const row of data ?? []) {
    map.set(
      row.catalog_item_id,
      (map.get(row.catalog_item_id) ?? 0) + (row.quantity ?? 1),
    );
  }
  return map;
}

async function fetchHolderCountByCatalog(
  supabase: DbClient,
  catalogIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (catalogIds.length === 0) return map;

  const { data, error } = await supabase
    .from("asset_assignments")
    .select("catalog_item_id, intake_id, driver_id")
    .in("catalog_item_id", catalogIds)
    .eq("status", "assigned");

  if (error) throw error;

  for (const row of data ?? []) {
    map.set(row.catalog_item_id, (map.get(row.catalog_item_id) ?? 0) + 1);
  }
  return map;
}

function mapCatalogRow(
  row: Database["public"]["Tables"]["asset_catalog"]["Row"],
  assignedQty: number,
  holderCount: number,
): AssetCatalogRow {
  const available = Math.max(0, row.total_quantity - assignedQty);
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    icon_key: row.icon_key,
    image_url: row.image_url ?? null,
    total_quantity: row.total_quantity,
    reorder_level: row.reorder_level,
    is_active: row.is_active,
    assigned_qty: assignedQty,
    available_qty: available,
    holder_count: holderCount,
    is_low_stock: row.is_active && available <= row.reorder_level,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchAssetsCatalog(): Promise<{
  items: AssetCatalogRow[];
  kpis: AssetCatalogKpis;
}> {
  await requireAssetsView();
  void logAdminRead("assets", "fetchAssetsCatalog");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_catalog")
    .select("*")
    .order("name");

  if (error) throw error;

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const [assignedMap, holderMap] = await Promise.all([
    fetchAssignedQtyByCatalog(supabase, ids),
    fetchHolderCountByCatalog(supabase, ids),
  ]);

  const items = await withResolvedAssetImages(
    rows.map((row) =>
      mapCatalogRow(row, assignedMap.get(row.id) ?? 0, holderMap.get(row.id) ?? 0),
    ),
  );

  const kpis: AssetCatalogKpis = {
    total_skus: items.filter((i) => i.is_active).length,
    total_units: items.reduce((sum, i) => sum + i.total_quantity, 0),
    assigned_units: items.reduce((sum, i) => sum + i.assigned_qty, 0),
    available_units: items.reduce((sum, i) => sum + i.available_qty, 0),
    low_stock_count: items.filter((i) => i.is_low_stock).length,
  };

  return { items, kpis };
}

async function hydrateAssignments(
  supabase: DbClient,
  rows: Database["public"]["Tables"]["asset_assignments"]["Row"][],
): Promise<AssetAssignmentRow[]> {
  if (rows.length === 0) return [];

  const intakeIds = [...new Set(rows.map((r) => r.intake_id).filter(Boolean))] as string[];
  const driverIds = [...new Set(rows.map((r) => r.driver_id).filter(Boolean))] as string[];
  const staffIds = [...new Set(rows.map((r) => r.assigned_by).filter(Boolean))] as string[];

  const [{ data: intakes }, { data: drivers }, { data: profiles }] = await Promise.all([
    intakeIds.length
      ? supabase
          .from("driver_intakes")
          .select("id, full_name, driver_code, partner_id, partners(name)")
          .in("id", intakeIds)
      : Promise.resolve({ data: [] }),
    driverIds.length
      ? supabase
          .from("drivers")
          .select("id, driver_code, profiles(full_name), partners(name)")
          .in("id", driverIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] }),
  ]);

  const intakeById = new Map((intakes ?? []).map((i) => [i.id, i]));
  const driverById = new Map((drivers ?? []).map((d) => [d.id, d]));
  const staffById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((row) => {
    const driver = row.driver_id ? driverById.get(row.driver_id) : null;
    const intake = row.intake_id ? intakeById.get(row.intake_id) : null;
    const driverProfile = driver?.profiles;
    const profileName = Array.isArray(driverProfile)
      ? driverProfile[0]?.full_name
      : driverProfile?.full_name;

    let holder_name = "—";
    let holder_code: string | null = null;
    let holder_type: "driver" | "intake" = "intake";
    let partner_name: string | null = null;

    if (driver) {
      holder_type = "driver";
      holder_name = profileName ?? "—";
      holder_code = driver.driver_code;
      const partnerRel = driver.partners;
      partner_name = Array.isArray(partnerRel)
        ? (partnerRel[0]?.name ?? null)
        : (partnerRel?.name ?? null);
    } else if (intake) {
      holder_type = "intake";
      holder_name = intake.full_name;
      holder_code = intake.driver_code;
      const partnerRel = intake.partners;
      partner_name = Array.isArray(partnerRel)
        ? (partnerRel[0]?.name ?? null)
        : (partnerRel?.name ?? null);
    }

    return {
      id: row.id,
      catalog_item_id: row.catalog_item_id,
      quantity: row.quantity,
      status: row.status,
      intake_id: row.intake_id,
      driver_id: row.driver_id,
      assigned_at: row.assigned_at,
      returned_at: row.returned_at,
      assigned_by: row.assigned_by,
      assigned_by_name: row.assigned_by ? (staffById.get(row.assigned_by) ?? null) : null,
      notes: row.notes,
      holder_name,
      holder_code,
      holder_type,
      partner_name,
    };
  });
}

export async function fetchAssetDetail(catalogItemId: string): Promise<AssetDetailModel | null> {
  await requireAssetsView();
  if (!catalogItemId) return null;
  void logAdminRead("assets", "fetchAssetDetail", { catalogItemId });

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("asset_catalog")
    .select("*")
    .eq("id", catalogItemId)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  const [assignedMap, holderMap, { data: activeRows }, { data: returnedRows }] =
    await Promise.all([
      fetchAssignedQtyByCatalog(supabase, [catalogItemId]),
      fetchHolderCountByCatalog(supabase, [catalogItemId]),
      supabase
        .from("asset_assignments")
        .select("*")
        .eq("catalog_item_id", catalogItemId)
        .eq("status", "assigned")
        .order("assigned_at", { ascending: false }),
      supabase
        .from("asset_assignments")
        .select("*")
        .eq("catalog_item_id", catalogItemId)
        .eq("status", "returned")
        .order("returned_at", { ascending: false })
        .limit(20),
    ]);

  const base = mapCatalogRow(
    row,
    assignedMap.get(catalogItemId) ?? 0,
    holderMap.get(catalogItemId) ?? 0,
  );
  const [resolvedBase] = await withResolvedAssetImages([base]);

  const [active_assignments, recent_returns] = await Promise.all([
    hydrateAssignments(supabase, activeRows ?? []),
    hydrateAssignments(supabase, returnedRows ?? []),
  ]);

  return { ...resolvedBase, active_assignments, recent_returns };
}

export async function createAssetCatalogItem(
  formData: FormData,
): Promise<AssetMutationResult> {
  const auth = await requireAssetsManage();
  if (auth.error) return { error: auth.error };

  const fields = parseAssetFormFields(formData);
  if (!fields.name) return { error: "missing_fields" };
  if (!/^[a-z0-9_]+$/.test(fields.code)) return { error: "invalid_code" };

  const imageFile = formData.get("image");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_catalog")
    .insert({
      name: fields.name,
      code: fields.code,
      description: fields.description || null,
      icon_key: fields.iconKey,
      total_quantity: fields.totalQuantity,
      reorder_level: fields.reorderLevel,
      is_active: fields.isActive,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "code_exists" };
    return { error: "save_failed" };
  }

  let imageWarning: string | undefined;
  if (imageFile instanceof File && imageFile.size > 0) {
    const upload = await uploadAssetCatalogImageFile(data.id, imageFile, auth.session.id);
    if (upload.error) {
      imageWarning = upload.error;
    } else if (upload.imageUrl) {
      await supabase
        .from("asset_catalog")
        .update({ image_url: upload.imageUrl, updated_at: new Date().toISOString() })
        .eq("id", data.id);
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "asset_catalog",
    entityId: data.id,
    routeName: "createAssetCatalogItem",
    after: { name: fields.name, code: fields.code },
  });

  return { success: true, id: data.id, imageWarning };
}

export async function updateAssetCatalogItem(
  formData: FormData,
): Promise<AssetMutationResult> {
  const auth = await requireAssetsManage();
  if (auth.error) return { error: auth.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "missing_fields" };

  const fields = parseAssetFormFields(formData);
  if (!fields.name) return { error: "missing_fields" };
  if (!/^[a-z0-9_]+$/.test(fields.code)) return { error: "invalid_code" };

  const imageFile = formData.get("image");
  const removeImage = formData.get("removeImage") === "true";

  const supabase = await createClient();
  const assignedMap = await fetchAssignedQtyByCatalog(supabase, [id]);
  const assignedQty = assignedMap.get(id) ?? 0;
  if (fields.totalQuantity < assignedQty) return { error: "stock_below_assigned" };

  let imageUrl: string | null | undefined;
  let imageWarning: string | undefined;

  if (removeImage) {
    imageUrl = null;
    try {
      await deleteObjects(allAssetCatalogImageKeys(id));
    } catch {
      /* best-effort */
    }
  } else if (imageFile instanceof File && imageFile.size > 0) {
    const upload = await uploadAssetCatalogImageFile(id, imageFile, auth.session.id);
    if (upload.error) {
      imageWarning = upload.error;
    } else {
      imageUrl = upload.imageUrl ?? null;
    }
  }

  const { error } = await supabase
    .from("asset_catalog")
    .update({
      name: fields.name,
      code: fields.code,
      description: fields.description || null,
      icon_key: fields.iconKey,
      total_quantity: fields.totalQuantity,
      reorder_level: fields.reorderLevel,
      is_active: fields.isActive,
      ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "code_exists" };
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "asset_catalog",
    entityId: id,
    routeName: "updateAssetCatalogItem",
    after: { name: fields.name, code: fields.code, total_quantity: fields.totalQuantity },
  });

  return { success: true, id, imageWarning };
}

export async function adjustAssetStock(input: {
  id: string;
  delta: number;
  note?: string;
}): Promise<AssetMutationResult> {
  const auth = await requireAssetsManage();
  if (auth.error) return { error: auth.error };
  if (!input.id || !Number.isFinite(input.delta) || input.delta === 0) {
    return { error: "invalid_quantity" };
  }

  const supabase = await createClient();
  const { data: row, error: fetchErr } = await supabase
    .from("asset_catalog")
    .select("id, total_quantity")
    .eq("id", input.id)
    .maybeSingle();

  if (fetchErr || !row) return { error: "catalog_not_found" };

  const assignedMap = await fetchAssignedQtyByCatalog(supabase, [input.id]);
  const assignedQty = assignedMap.get(input.id) ?? 0;
  const nextTotal = row.total_quantity + input.delta;
  if (nextTotal < assignedQty) return { error: "stock_below_assigned" };
  if (nextTotal < 0) return { error: "invalid_quantity" };

  const { error } = await supabase
    .from("asset_catalog")
    .update({
      total_quantity: nextTotal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) return { error: "save_failed" };

  void logAdminMutation({
    action: "update",
    entityType: "asset_catalog",
    entityId: input.id,
    routeName: "adjustAssetStock",
    after: { delta: input.delta, total_quantity: nextTotal, note: input.note ?? null },
  });

  return { success: true, id: input.id };
}

export async function returnAssetAssignment(
  assignmentId: string,
): Promise<AssetMutationResult> {
  const auth = await requireAssetsManage();
  if (auth.error) return { error: auth.error };
  if (!assignmentId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: row, error: fetchErr } = await supabase
    .from("asset_assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .maybeSingle();

  if (fetchErr || !row) return { error: "assignment_not_found" };
  if (row.status !== "assigned") return { success: true };

  const { error } = await supabase
    .from("asset_assignments")
    .update({
      status: "returned",
      returned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId);

  if (error) return { error: "save_failed" };

  void logAdminMutation({
    action: "update",
    entityType: "asset_assignment",
    entityId: assignmentId,
    routeName: "returnAssetAssignment",
  });

  return { success: true };
}

async function requireDriverFormAssetCatalog() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
  if (session.isSuperAdmin) return session;
  if (
    hasPermissionInSet(session.permissions, "drivers.manage", false) ||
    hasPermissionInSet(session.permissions, "assets.view", false)
  ) {
    return session;
  }
  throw new Error("not_authorized");
}

async function requireDriverOrAssetsView() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
  if (session.isSuperAdmin) return session;
  if (
    hasPermissionInSet(session.permissions, "drivers.view", false) ||
    hasPermissionInSet(session.permissions, "assets.view", false)
  ) {
    return session;
  }
  throw new Error("not_authorized");
}

export async function fetchAssetCatalogForDriverForm(
  intakeId?: string | null,
): Promise<DriverFormCatalogItem[]> {
  await requireDriverFormAssetCatalog();

  const supabase = await createClient();
  const { data: catalog, error } = await supabase
    .from("asset_catalog")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;

  const ids = (catalog ?? []).map((c) => c.id);
  const assignedMap = await fetchAssignedQtyByCatalog(supabase, ids);

  let selectedIds = new Set<string>();
  if (intakeId) {
    const { data: current } = await supabase
      .from("asset_assignments")
      .select("catalog_item_id")
      .eq("intake_id", intakeId)
      .eq("status", "assigned");
    selectedIds = new Set((current ?? []).map((r) => r.catalog_item_id));
  }

  const items = await Promise.all(
    (catalog ?? []).map(async (row) => {
      const assigned_qty = assignedMap.get(row.id) ?? 0;
      const available_qty = Math.max(0, row.total_quantity - assigned_qty);
      const is_selected = selectedIds.has(row.id);
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        icon_key: row.icon_key,
        image_url: await resolveAssetImageUrl(row.image_url),
        total_quantity: row.total_quantity,
        assigned_qty,
        available_qty: is_selected ? available_qty + 1 : available_qty,
        is_selected,
        is_low_stock: available_qty <= row.reorder_level,
      };
    }),
  );

  return items;
}

export async function syncIntakeAssetAssignments(
  supabase: DbClient,
  intakeId: string,
  catalogItemIds: string[],
  assignedBy: string,
  linkedDriverId?: string | null,
): Promise<{ error?: string }> {
  const uniqueIds = [...new Set(catalogItemIds.filter(Boolean))];
  const { data: catalog, error: catalogErr } = await supabase
    .from("asset_catalog")
    .select("id, total_quantity, is_active")
    .in("id", uniqueIds.length ? uniqueIds : ["00000000-0000-0000-0000-000000000000"]);

  if (catalogErr) return { error: "save_failed" };

  const catalogById = new Map((catalog ?? []).map((c) => [c.id, c]));
  for (const id of uniqueIds) {
    const item = catalogById.get(id);
    if (!item || !item.is_active) return { error: "insufficient_stock" };
  }

  const { data: existing, error: existingErr } = await supabase
    .from("asset_assignments")
    .select("id, catalog_item_id, status")
    .eq("intake_id", intakeId);

  if (existingErr) return { error: "save_failed" };

  const activeExisting = (existing ?? []).filter((r) => r.status === "assigned");
  const activeIds = new Set(activeExisting.map((r) => r.catalog_item_id));
  const nextIds = new Set(uniqueIds);

  const toReturn = activeExisting.filter((r) => !nextIds.has(r.catalog_item_id));
  const toAssign = uniqueIds.filter((id) => !activeIds.has(id));

  if (toAssign.length > 0) {
    const assignedMap = await fetchAssignedQtyByCatalog(supabase, toAssign);
    for (const id of toAssign) {
      const item = catalogById.get(id);
      if (!item) return { error: "insufficient_stock" };
      const assigned = assignedMap.get(id) ?? 0;
      if (item.total_quantity - assigned < 1) return { error: "insufficient_stock" };
    }
  }

  const now = new Date().toISOString();

  for (const row of toReturn) {
    const { error } = await supabase
      .from("asset_assignments")
      .update({ status: "returned", returned_at: now, updated_at: now })
      .eq("id", row.id);
    if (error) return { error: "save_failed" };
  }

  if (toAssign.length > 0) {
    const { error } = await supabase.from("asset_assignments").insert(
      toAssign.map((catalog_item_id) => ({
        catalog_item_id,
        intake_id: intakeId,
        driver_id: linkedDriverId ?? null,
        assigned_by: assignedBy,
        quantity: 1,
        status: "assigned" as const,
      })),
    );
    if (error) return { error: "save_failed" };
  }

  if (linkedDriverId) {
    await supabase
      .from("asset_assignments")
      .update({ driver_id: linkedDriverId, updated_at: now })
      .eq("intake_id", intakeId)
      .eq("status", "assigned");
  }

  return {};
}

export async function fetchDriverAssetAssignments(
  intakeId: string | null,
  driverId: string | null,
): Promise<
  Array<{
    catalog_item_id: string;
    name: string;
    code: string;
    icon_key: string;
    image_url: string | null;
    assigned_at: string;
  }>
> {
  await requireDriverOrAssetsView();
  if (!intakeId && !driverId) return [];

  const supabase = await createClient();
  let query = supabase
    .from("asset_assignments")
    .select("catalog_item_id, assigned_at, asset_catalog(name, code, icon_key, image_url)")
    .eq("status", "assigned");

  if (driverId && intakeId) {
    query = query.or(`driver_id.eq.${driverId},intake_id.eq.${intakeId}`);
  } else if (driverId) {
    query = query.eq("driver_id", driverId);
  } else if (intakeId) {
    query = query.eq("intake_id", intakeId);
  }

  const { data, error } = await query.order("assigned_at", { ascending: false });
  if (error) throw error;

  return Promise.all(
    (data ?? []).map(async (row) => {
      const catalog = Array.isArray(row.asset_catalog)
        ? row.asset_catalog[0]
        : row.asset_catalog;
      return {
        catalog_item_id: row.catalog_item_id,
        name: catalog?.name ?? "—",
        code: catalog?.code ?? "—",
        icon_key: catalog?.icon_key ?? "Package",
        image_url: await resolveAssetImageUrl(catalog?.image_url ?? null),
        assigned_at: row.assigned_at,
      };
    }),
  );
}
