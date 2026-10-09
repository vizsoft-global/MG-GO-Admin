"use server";

import { logDriverChange } from "@/features/drivers/driver-change-log";
import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { resolveAssetImageUrl } from "@/lib/storage/asset-image-url";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import { allAssetCatalogImageKeys, buildAssetCatalogImageKey } from "@/lib/storage/r2-keys";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import type {
  AssetAssignmentRow,
  AssetCatalogKpis,
  AssetCatalogRow,
  AssetDetailModel,
  AssetMutationResult,
  DriverFormCatalogItem,
} from "./types";

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, asRow(snap.id, snap.data()));
    }
  }
  return map;
}

async function whereIn(db: Firestore, collection: string, field: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await db.collection(collection).where(field, "in", chunk).get();
    rows.push(...snap.docs.map((doc) => asRow(doc.id, doc.data())));
  }
  return rows;
}

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
  const category = String(formData.get("category") ?? "").trim();
  const penaltyRaw = String(formData.get("penaltyKwd") ?? "").trim();
  const penaltyParsed = Number(penaltyRaw);
  const iconKey = String(formData.get("iconKey") ?? "Package").trim() || "Package";
  const totalQuantity = parseInt(String(formData.get("totalQuantity") ?? "0"), 10);
  const reorderLevel = parseInt(String(formData.get("reorderLevel") ?? "0"), 10);
  const isActive = formData.get("isActive") !== "false";

  return {
    name,
    code: (codeRaw || slugifyAssetCode(name)).toLowerCase(),
    description,
    category,
    penaltyKwd: penaltyRaw ? penaltyParsed : null,
    penaltyInvalid: Boolean(
      penaltyRaw && (!Number.isFinite(penaltyParsed) || penaltyParsed < 0),
    ),
    iconKey,
    totalQuantity: Number.isFinite(totalQuantity) ? Math.max(0, totalQuantity) : 0,
    reorderLevel: Number.isFinite(reorderLevel) ? Math.max(0, reorderLevel) : 0,
    isActive,
  };
}

async function assignedRowsForCatalog(db: Firestore, catalogIds: string[]): Promise<Row[]> {
  if (catalogIds.length === 0) return [];
  const rows = await whereIn(db, COLLECTIONS.assetAssignments, "catalog_item_id", catalogIds);
  return rows.filter((row) => row.status === "assigned");
}

async function fetchAssignedQtyByCatalog(
  db: Firestore,
  catalogIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const row of await assignedRowsForCatalog(db, catalogIds)) {
    const id = str(row.catalog_item_id);
    map.set(id, (map.get(id) ?? 0) + num(row.quantity, 1));
  }
  return map;
}

async function fetchHolderCountByCatalog(
  db: Firestore,
  catalogIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const row of await assignedRowsForCatalog(db, catalogIds)) {
    const id = str(row.catalog_item_id);
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

function mapCatalogRow(row: Row, assignedQty: number, holderCount: number): AssetCatalogRow {
  const total = num(row.total_quantity);
  const available = Math.max(0, total - assignedQty);
  const reorder = num(row.reorder_level);
  const active = row.is_active === true;
  return {
    id: row.id,
    name: str(row.name),
    code: str(row.code),
    description: str(row.description) || null,
    category: str(row.category) || null,
    penalty_kwd: row.penalty_kwd == null ? null : Number(row.penalty_kwd),
    icon_key: str(row.icon_key) || "Package",
    image_url: str(row.image_url) || null,
    total_quantity: total,
    reorder_level: reorder,
    is_active: active,
    assigned_qty: assignedQty,
    available_qty: available,
    holder_count: holderCount,
    is_low_stock: active && available <= reorder,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

export async function fetchAssetsCatalog(): Promise<{
  items: AssetCatalogRow[];
  kpis: AssetCatalogKpis;
}> {
  await requireAssetsView();
  void logAdminRead("assets", "fetchAssetsCatalog");

  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.assetCatalog).get();
  const rows = snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const ids = rows.map((row) => row.id);
  const [assignedMap, holderMap] = await Promise.all([
    fetchAssignedQtyByCatalog(db, ids),
    fetchHolderCountByCatalog(db, ids),
  ]);

  const items = await withResolvedAssetImages(
    rows.map((row) => mapCatalogRow(row, assignedMap.get(row.id) ?? 0, holderMap.get(row.id) ?? 0)),
  );

  const kpis: AssetCatalogKpis = {
    total_skus: items.filter((item) => item.is_active).length,
    total_units: items.reduce((sum, item) => sum + item.total_quantity, 0),
    assigned_units: items.reduce((sum, item) => sum + item.assigned_qty, 0),
    available_units: items.reduce((sum, item) => sum + item.available_qty, 0),
    low_stock_count: items.filter((item) => item.is_low_stock).length,
  };

  return { items, kpis };
}

async function hydrateAssignments(db: Firestore, rows: Row[]): Promise<AssetAssignmentRow[]> {
  if (rows.length === 0) return [];

  const intakeIds = [...new Set(rows.map((row) => str(row.intake_id)).filter(Boolean))];
  const driverIds = [...new Set(rows.map((row) => str(row.driver_id)).filter(Boolean))];
  const staffIds = [...new Set(rows.map((row) => str(row.assigned_by)).filter(Boolean))];

  const [intakes, drivers, staff] = await Promise.all([
    rowsByIds(db, COLLECTIONS.driverIntakes, intakeIds),
    rowsByIds(db, COLLECTIONS.drivers, driverIds),
    rowsByIds(db, COLLECTIONS.profiles, staffIds),
  ]);
  const partnerIds = [
    ...new Set(
      [
        ...[...intakes.values()].map((row) => str(row.partner_id)),
        ...[...drivers.values()].map((row) => str(row.partner_id)),
      ].filter(Boolean),
    ),
  ];
  const partners = await rowsByIds(db, COLLECTIONS.partners, partnerIds);
  const driverProfiles = await rowsByIds(db, COLLECTIONS.profiles, driverIds);

  return rows.map((row) => {
    const driverId = str(row.driver_id);
    const intakeId = str(row.intake_id);
    const driver = driverId ? drivers.get(driverId) : undefined;
    const intake = intakeId ? intakes.get(intakeId) : undefined;
    let holder_name = "—";
    let holder_code: string | null = null;
    let holder_type: "driver" | "intake" = "intake";
    let partner_name: string | null = null;

    if (driver) {
      holder_type = "driver";
      holder_name = str(driverProfiles.get(driverId)?.full_name) || "—";
      holder_code = str(driver.driver_code) || null;
      partner_name = str(partners.get(str(driver.partner_id))?.name) || null;
    } else if (intake) {
      holder_type = "intake";
      holder_name = str(intake.full_name) || "—";
      holder_code = str(intake.driver_code) || null;
      partner_name = str(partners.get(str(intake.partner_id))?.name) || null;
    }

    const status = row.status === "returned" ? "returned" : "assigned";
    return {
      id: row.id,
      catalog_item_id: str(row.catalog_item_id),
      quantity: num(row.quantity, 1),
      status,
      intake_id: intakeId || null,
      driver_id: driverId || null,
      assigned_at: str(row.assigned_at),
      returned_at: str(row.returned_at) || null,
      assigned_by: str(row.assigned_by) || null,
      assigned_by_name: str(staff.get(str(row.assigned_by))?.full_name) || null,
      notes: str(row.notes) || null,
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

  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.assetCatalog).doc(catalogItemId).get();
  if (!snap.exists) return null;
  const row = asRow(snap.id, snap.data());

  const assignmentSnap = await db
    .collection(COLLECTIONS.assetAssignments)
    .where("catalog_item_id", "==", catalogItemId)
    .get();
  const assignments = assignmentSnap.docs.map((doc) => asRow(doc.id, doc.data()));
  const activeRows = assignments
    .filter((item) => item.status === "assigned")
    .sort((a, b) => str(b.assigned_at).localeCompare(str(a.assigned_at)));
  const returnedRows = assignments
    .filter((item) => item.status === "returned")
    .sort((a, b) => str(b.returned_at).localeCompare(str(a.returned_at)))
    .slice(0, 20);

  const [assignedMap, holderMap] = await Promise.all([
    fetchAssignedQtyByCatalog(db, [catalogItemId]),
    fetchHolderCountByCatalog(db, [catalogItemId]),
  ]);
  const base = mapCatalogRow(row, assignedMap.get(catalogItemId) ?? 0, holderMap.get(catalogItemId) ?? 0);
  const [resolvedBase] = await withResolvedAssetImages([base]);
  const [active_assignments, recent_returns] = await Promise.all([
    hydrateAssignments(db, activeRows),
    hydrateAssignments(db, returnedRows),
  ]);
  if (!resolvedBase) return null;
  return { ...resolvedBase, active_assignments, recent_returns };
}

async function codeTaken(db: Firestore, code: string, exceptId?: string): Promise<boolean> {
  const snap = await db.collection(COLLECTIONS.assetCatalog).where("code", "==", code).limit(3).get();
  return snap.docs.some((doc) => doc.id !== exceptId);
}

export async function createAssetCatalogItem(
  formData: FormData,
): Promise<AssetMutationResult> {
  const auth = await requireAssetsManage();
  if (auth.error) return { error: auth.error };

  const fields = parseAssetFormFields(formData);
  if (!fields.name) return { error: "missing_fields" };
  if (!/^[a-z0-9_]+$/.test(fields.code)) return { error: "invalid_code" };
  if (fields.penaltyInvalid) return { error: "invalid_penalty" };

  const db = await openDb();
  if (await codeTaken(db, fields.code)) return { error: "code_exists" };

  const id = crypto.randomUUID();
  const imageFile = formData.get("image");
  try {
    await db.collection(COLLECTIONS.assetCatalog).doc(id).set({
      id,
      name: fields.name,
      code: fields.code,
      description: fields.description || null,
      category: fields.category || null,
      penalty_kwd: fields.penaltyKwd,
      icon_key: fields.iconKey,
      total_quantity: fields.totalQuantity,
      reorder_level: fields.reorderLevel,
      is_active: fields.isActive,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } catch {
    return { error: "save_failed" };
  }

  let imageWarning: string | undefined;
  if (imageFile instanceof File && imageFile.size > 0) {
    const upload = await uploadAssetCatalogImageFile(id, imageFile, auth.session.id);
    if (upload.error) {
      imageWarning = upload.error;
    } else if (upload.imageUrl) {
      await db.collection(COLLECTIONS.assetCatalog).doc(id).set(
        { image_url: upload.imageUrl, updated_at: new Date() },
        { merge: true },
      );
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "asset_catalog",
    entityId: id,
    routeName: "createAssetCatalogItem",
    after: { name: fields.name, code: fields.code },
  });

  return { success: true, id, imageWarning };
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
  if (fields.penaltyInvalid) return { error: "invalid_penalty" };

  const imageFile = formData.get("image");
  const removeImage = formData.get("removeImage") === "true";
  const db = await openDb();
  const assignedMap = await fetchAssignedQtyByCatalog(db, [id]);
  const assignedQty = assignedMap.get(id) ?? 0;
  if (fields.totalQuantity < assignedQty) return { error: "stock_below_assigned" };
  if (await codeTaken(db, fields.code, id)) return { error: "code_exists" };

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

  try {
    await db.collection(COLLECTIONS.assetCatalog).doc(id).set(
      {
        name: fields.name,
        code: fields.code,
        description: fields.description || null,
        category: fields.category || null,
        penalty_kwd: fields.penaltyKwd,
        icon_key: fields.iconKey,
        total_quantity: fields.totalQuantity,
        reorder_level: fields.reorderLevel,
        is_active: fields.isActive,
        ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
        updated_at: new Date(),
      },
      { merge: true },
    );
  } catch {
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

  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.assetCatalog).doc(input.id).get();
  if (!snap.exists) return { error: "catalog_not_found" };
  const row = asRow(snap.id, snap.data());
  const assignedMap = await fetchAssignedQtyByCatalog(db, [input.id]);
  const assignedQty = assignedMap.get(input.id) ?? 0;
  const nextTotal = num(row.total_quantity) + input.delta;
  if (nextTotal < assignedQty) return { error: "stock_below_assigned" };
  if (nextTotal < 0) return { error: "invalid_quantity" };

  try {
    await snap.ref.set({ total_quantity: nextTotal, updated_at: new Date() }, { merge: true });
  } catch {
    return { error: "save_failed" };
  }

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

  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.assetAssignments).doc(assignmentId).get();
  if (!snap.exists) return { error: "assignment_not_found" };
  if (snap.data()?.status !== "assigned") return { success: true };

  try {
    await snap.ref.set(
      { status: "returned", returned_at: new Date(), updated_at: new Date() },
      { merge: true },
    );
  } catch {
    return { error: "save_failed" };
  }

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

  const db = await openDb();
  const catalogSnap = await db.collection(COLLECTIONS.assetCatalog).where("is_active", "==", true).get();
  const catalog = catalogSnap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const ids = catalog.map((row) => row.id);
  const assignedMap = await fetchAssignedQtyByCatalog(db, ids);

  let selectedIds = new Set<string>();
  if (intakeId) {
    const current = await db
      .collection(COLLECTIONS.assetAssignments)
      .where("intake_id", "==", intakeId)
      .where("status", "==", "assigned")
      .get();
    selectedIds = new Set(current.docs.map((doc) => str(doc.data().catalog_item_id)).filter(Boolean));
  }

  return Promise.all(
    catalog.map(async (row) => {
      const assigned_qty = assignedMap.get(row.id) ?? 0;
      const available_qty = Math.max(0, num(row.total_quantity) - assigned_qty);
      const is_selected = selectedIds.has(row.id);
      return {
        id: row.id,
        name: str(row.name),
        code: str(row.code),
        icon_key: str(row.icon_key) || "Package",
        image_url: await resolveAssetImageUrl(str(row.image_url) || null),
        total_quantity: num(row.total_quantity),
        assigned_qty,
        available_qty: is_selected ? available_qty + 1 : available_qty,
        is_selected,
        is_low_stock: available_qty <= num(row.reorder_level),
      };
    }),
  );
}

export async function syncIntakeAssetAssignments(
  _client: unknown,
  intakeId: string,
  catalogItemIds: string[],
  assignedBy: string,
  linkedDriverId?: string | null,
): Promise<{ error?: string }> {
  const uniqueIds = [...new Set(catalogItemIds.filter(Boolean))];
  let db: Firestore;
  try {
    db = await openDb();
  } catch {
    return { error: "save_failed" };
  }

  const catalog = await rowsByIds(
    db,
    COLLECTIONS.assetCatalog,
    uniqueIds.length ? uniqueIds : ["00000000-0000-0000-0000-000000000000"],
  );
  for (const id of uniqueIds) {
    const item = catalog.get(id);
    if (!item || item.is_active !== true) return { error: "insufficient_stock" };
  }

  const existingSnap = await db
    .collection(COLLECTIONS.assetAssignments)
    .where("intake_id", "==", intakeId)
    .get();
  const existing = existingSnap.docs.map((doc) => asRow(doc.id, doc.data()));
  const activeExisting = existing.filter((row) => row.status === "assigned");
  const activeIds = new Set(activeExisting.map((row) => str(row.catalog_item_id)));
  const nextIds = new Set(uniqueIds);
  const toReturn = activeExisting.filter((row) => !nextIds.has(str(row.catalog_item_id)));
  const toAssign = uniqueIds.filter((id) => !activeIds.has(id));

  if (toAssign.length > 0) {
    const assignedMap = await fetchAssignedQtyByCatalog(db, toAssign);
    for (const id of toAssign) {
      const item = catalog.get(id);
      if (!item) return { error: "insufficient_stock" };
      const assigned = assignedMap.get(id) ?? 0;
      if (num(item.total_quantity) - assigned < 1) return { error: "insufficient_stock" };
    }
  }

  const now = new Date();
  try {
    for (const row of toReturn) {
      await db.collection(COLLECTIONS.assetAssignments).doc(row.id).set(
        { status: "returned", returned_at: now, updated_at: now },
        { merge: true },
      );
    }
    for (const catalogItemId of toAssign) {
      const id = crypto.randomUUID();
      await db.collection(COLLECTIONS.assetAssignments).doc(id).set({
        id,
        catalog_item_id: catalogItemId,
        intake_id: intakeId,
        driver_id: linkedDriverId ?? null,
        assigned_by: assignedBy,
        quantity: 1,
        status: "assigned",
        assigned_at: now,
        created_at: now,
        updated_at: now,
      });
    }
    if (linkedDriverId) {
      const assigned = await db
        .collection(COLLECTIONS.assetAssignments)
        .where("intake_id", "==", intakeId)
        .where("status", "==", "assigned")
        .get();
      await Promise.all(
        assigned.docs.map((doc) =>
          doc.ref.set({ driver_id: linkedDriverId, updated_at: now }, { merge: true }),
        ),
      );
    }
  } catch {
    return { error: "save_failed" };
  }

  if (toReturn.length > 0 || toAssign.length > 0) {
    const nameIds = [...toReturn.map((row) => str(row.catalog_item_id)), ...toAssign];
    const named = await rowsByIds(db, COLLECTIONS.assetCatalog, nameIds);
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const row of toReturn) {
      const catalogId = str(row.catalog_item_id);
      const key = `asset.${str(named.get(catalogId)?.name) || catalogId}`;
      before[key] = "1";
      after[key] = "0";
    }
    for (const id of toAssign) {
      const key = `asset.${str(named.get(id)?.name) || id}`;
      before[key] = "0";
      after[key] = "1";
    }
    void logDriverChange({
      intakeId,
      driverId: linkedDriverId,
      source: "asset",
      before,
      after,
    });
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
  try {
    await requireDriverOrAssetsView();
  } catch {
    return [];
  }
  if (!intakeId && !driverId) return [];

  try {
    const db = await openDb();
    const queries = [];
    if (driverId) {
      queries.push(
        db
          .collection(COLLECTIONS.assetAssignments)
          .where("driver_id", "==", driverId)
          .where("status", "==", "assigned")
          .get(),
      );
    }
    if (intakeId) {
      queries.push(
        db
          .collection(COLLECTIONS.assetAssignments)
          .where("intake_id", "==", intakeId)
          .where("status", "==", "assigned")
          .get(),
      );
    }
    const snaps = await Promise.all(queries);
    const byId = new Map<string, Row>();
    for (const snap of snaps) {
      for (const doc of snap.docs) byId.set(doc.id, asRow(doc.id, doc.data()));
    }
    const rows = [...byId.values()].sort((a, b) =>
      str(b.assigned_at).localeCompare(str(a.assigned_at)),
    );
    const catalog = await rowsByIds(
      db,
      COLLECTIONS.assetCatalog,
      rows.map((row) => str(row.catalog_item_id)).filter(Boolean),
    );
    return Promise.all(
      rows.map(async (row) => {
        const item = catalog.get(str(row.catalog_item_id));
        return {
          catalog_item_id: str(row.catalog_item_id),
          name: str(item?.name) || "—",
          code: str(item?.code) || "—",
          icon_key: str(item?.icon_key) || "Package",
          image_url: await resolveAssetImageUrl(str(item?.image_url) || null),
          assigned_at: str(row.assigned_at),
        };
      }),
    );
  } catch {
    return [];
  }
}
