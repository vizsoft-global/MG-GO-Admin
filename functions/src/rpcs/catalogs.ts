import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { parseId } from "../core/query";
import { requireStaff } from "../core/staff";

const ZONES = COLLECTIONS.zones;
const ZONE_GEOFENCE_SETTINGS = "zone_geofence_settings";
const PARTNERS = COLLECTIONS.partners;
const RESTAURANTS = COLLECTIONS.restaurants;
const DRIVERS = COLLECTIONS.drivers;
const DRIVER_RESTAURANTS = COLLECTIONS.driverRestaurants;
const VEHICLE_TYPES = "vehicle_types";
const VEHICLE_USE_TYPES = COLLECTIONS.vehicleUseTypes;
const ASSET_CATALOG = COLLECTIONS.assetCatalog;
const ASSET_ASSIGNMENTS = "asset_assignments";
const CUSTOM_FIELD_DEFINITIONS = "custom_field_definitions";
const LOAN_TENURE_OPTIONS = "loan_tenure_options";
const COMPLAINT_CATEGORIES = "complaint_categories";

const MIN_RADIUS_METERS = 50;
const MAX_RADIUS_METERS = 50_000;
const MIN_POLYGON_VERTICES = 3;
const SLUG_KEY_RE = /^[a-z0-9_]+$/;

type GeoKind = "polygon" | "circle";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(data: Record<string, unknown>, key: string): string {
  const raw = data[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const raw = data[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBool(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = data[key];
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function optionalString(data: Record<string, unknown>, key: string): string | null {
  const text = readString(data, key);
  return text.length ? text : null;
}

function validateGeometry(kind: GeoKind, geometry: unknown): string | null {
  const feature = asRecord(geometry);
  const geo = asRecord(feature.geometry);
  const type = typeof geo.type === "string" ? geo.type : "";
  if (!type) return "geometry_required";

  if (kind === "circle") {
    if (type !== "Point") return "invalid_circle";
    const coords = geo.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return "invalid_circle";
    const radius = readNumber(asRecord(feature.properties), "radiusMeters");
    if (radius === null || radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
      return "invalid_radius";
    }
    return null;
  }

  if (type !== "Polygon") return "invalid_polygon";
  const coordinates = geo.coordinates;
  const ring = Array.isArray(coordinates) ? coordinates[0] : null;
  if (!Array.isArray(ring) || ring.length < MIN_POLYGON_VERTICES + 1) {
    return "polygon_too_small";
  }
  for (const vertex of ring) {
    if (!Array.isArray(vertex) || vertex.length < 2) return "invalid_polygon";
  }
  return null;
}

/** `admin_upsert_zone` — plus the `zone_geofence_settings` row the panel writes. */
export const adminUpsertZone = onCall(async (request) => {
  await requireStaff(request, "zones.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  const code = readString(data, "code").toUpperCase();
  if (!name || !code) throw new HttpsError("invalid-argument", "missing_fields");

  const zoneTypeRaw = readString(data, "zoneType").toLowerCase();
  if (zoneTypeRaw !== "polygon" && zoneTypeRaw !== "circle") {
    throw new HttpsError("invalid-argument", "invalid_polygon");
  }
  const zoneType = zoneTypeRaw as GeoKind;

  const geometryError = validateGeometry(zoneType, data.geometry);
  if (geometryError) throw new HttpsError("invalid-argument", geometryError);

  const db = getFirestore();
  const clash = await db.collection(ZONES).where("code", "==", code).get();
  if (clash.docs.some((doc) => doc.id !== id)) {
    throw new HttpsError("already-exists", "code_exists");
  }

  const color = readString(data, "color") || "#0f766e";
  const isActive = readBool(data, "isActive", true);
  const ref = id ? db.collection(ZONES).doc(id) : db.collection(ZONES).doc();
  const payload: Record<string, unknown> = {
    name,
    code,
    color,
    zone_type: zoneType,
    geometry: data.geometry ?? null,
    is_active: isActive,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }

  const geofence = asRecord(data.geofence);
  if (Object.keys(geofence).length > 0) {
    await db.collection(ZONE_GEOFENCE_SETTINGS).doc(ref.id).set(
      {
        zone_id: ref.id,
        kind: readString(geofence, "kind") || null,
        radius_meters: readNumber(geofence, "radiusMeters"),
        polygon: geofence.polygon ?? null,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return { success: true, id: ref.id };
});

export const adminDeleteZone = onCall(async (request) => {
  await requireStaff(request, "zones.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const driverCount = await db.collection(DRIVERS).where("zone_id", "==", id).count().get();
  if (driverCount.data().count > 0 && data.force !== true) {
    throw new HttpsError("failed-precondition", "has_drivers");
  }
  if (driverCount.data().count > 0) {
    const assigned = await db.collection(DRIVERS).where("zone_id", "==", id).get();
    const batch = db.batch();
    for (const doc of assigned.docs) {
      batch.set(doc.ref, { zone_id: null, zone_name: null }, { merge: true });
    }
    await batch.commit();
  }

  await db.collection(ZONES).doc(id).delete();
  await db.collection(ZONE_GEOFENCE_SETTINGS).doc(id).delete().catch(() => undefined);
  return { success: true };
});

export const adminUpsertPartner = onCall(async (request) => {
  await requireStaff(request, "partners.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  if (!name) throw new HttpsError("invalid-argument", "missing_fields");

  const slug = readString(data, "slug").toLowerCase();
  if (slug && !SLUG_KEY_RE.test(slug)) throw new HttpsError("invalid-argument", "invalid_slug");

  const db = getFirestore();
  if (slug) {
    const clash = await db.collection(PARTNERS).where("slug", "==", slug).get();
    if (clash.docs.some((doc) => doc.id !== id)) {
      throw new HttpsError("already-exists", "slug_exists");
    }
  }

  const ref = id ? db.collection(PARTNERS).doc(id) : db.collection(PARTNERS).doc();
  const payload: Record<string, unknown> = {
    name,
    slug: slug || null,
    description: optionalString(data, "description"),
    logo_url: optionalString(data, "logoUrl"),
    is_active: readBool(data, "isActive", true),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

export const adminDeletePartner = onCall(async (request) => {
  await requireStaff(request, "partners.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const [driverCount, restaurantCount] = await Promise.all([
    db.collection(DRIVERS).where("partner_id", "==", id).count().get(),
    db.collection(RESTAURANTS).where("partner_id", "==", id).count().get(),
  ]);
  if (driverCount.data().count > 0) throw new HttpsError("failed-precondition", "has_drivers");
  if (restaurantCount.data().count > 0) {
    throw new HttpsError("failed-precondition", "has_restaurants");
  }

  await db.collection(PARTNERS).doc(id).delete();
  return { success: true };
});

/** `admin_upsert_restaurant` / `saveRestaurant`. */
export const adminUpsertRestaurant = onCall(async (request) => {
  await requireStaff(request, "restaurants.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  if (!name) throw new HttpsError("invalid-argument", "missing_fields");

  const lat = readNumber(data, "latitude");
  const lng = readNumber(data, "longitude");
  if (lat !== null && (lat < -90 || lat > 90)) {
    throw new HttpsError("invalid-argument", "invalid_coordinates");
  }
  if (lng !== null && (lng < -180 || lng > 180)) {
    throw new HttpsError("invalid-argument", "invalid_coordinates");
  }

  const merchantId = readString(data, "externalMerchantId");
  if (merchantId && !/^\d{1,32}$/.test(merchantId)) {
    throw new HttpsError("invalid-argument", "invalid_merchant_id");
  }

  const partnerId = parseId(data.partnerId);
  const db = getFirestore();
  if (partnerId) {
    const partner = await db.collection(PARTNERS).doc(partnerId).get();
    if (!partner.exists) throw new HttpsError("invalid-argument", "unknown_partner");
  }

  const clash = await db
    .collection(RESTAURANTS)
    .where("name", "==", name)
    .where("partner_id", "==", partnerId)
    .get();
  if (clash.docs.some((doc) => doc.id !== id)) {
    throw new HttpsError("already-exists", "restaurant_exists");
  }

  const ref = id ? db.collection(RESTAURANTS).doc(id) : db.collection(RESTAURANTS).doc();
  const payload: Record<string, unknown> = {
    name,
    partner_id: partnerId,
    zone_id: parseId(data.zoneId),
    external_merchant_id: merchantId || null,
    map_link: optionalString(data, "mapLink"),
    logo_url: optionalString(data, "logoUrl"),
    latitude: lat,
    longitude: lng,
    is_active: readBool(data, "isActive", true),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

export const adminDeleteRestaurant = onCall(async (request) => {
  await requireStaff(request, "restaurants.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const links = await db.collection(DRIVER_RESTAURANTS).where("restaurant_id", "==", id).get();
  const batch = db.batch();
  for (const doc of links.docs) batch.delete(doc.ref);
  batch.delete(db.collection(RESTAURANTS).doc(id));
  await batch.commit();
  return { success: true };
});

export const adminUpsertVehicleType = onCall(async (request) => {
  await requireStaff(request, "vehicles.manage");

  const data = asRecord(request.data);
  const key = readString(data, "key").toLowerCase();
  if (!key || !SLUG_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_key");
  const labelEn = readString(data, "labelEn") || readString(data, "label");
  if (!labelEn) throw new HttpsError("invalid-argument", "missing_fields");

  const sortOrder = readNumber(data, "sortOrder") ?? 100;
  const ref = getFirestore().collection(VEHICLE_TYPES).doc(key);
  await ref.set(
    {
      key,
      label_en: labelEn,
      label_ar: optionalString(data, "labelAr"),
      is_active: readBool(data, "isActive", true),
      sort_order: sortOrder,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { success: true, id: key };
});

/** `admin_upsert_vehicle_use_type` — gated on `settings.manage` in SQL. */
export const adminUpsertVehicleUseType = onCall(async (request) => {
  await requireStaff(request, "settings.manage");

  const data = asRecord(request.data);
  const key = readString(data, "key").toLowerCase();
  if (!key || !SLUG_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_key");
  const labelEn = readString(data, "labelEn") || readString(data, "label");
  if (!labelEn) throw new HttpsError("invalid-argument", "missing_fields");

  const sortOrder = readNumber(data, "sortOrder") ?? 100;
  const ref = getFirestore().collection(VEHICLE_USE_TYPES).doc(key);
  await ref.set(
    {
      key,
      label_en: labelEn,
      label_ar: optionalString(data, "labelAr"),
      is_active: readBool(data, "isActive", true),
      sort_order: sortOrder,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { success: true, id: key };
});

/** `admin_upsert_asset_catalog` / `createAssetCatalogItem` / `update`. */
export const adminUpsertAssetCatalog = onCall(async (request) => {
  await requireStaff(request, "assets.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  const code = readString(data, "code").toLowerCase();
  if (!name) throw new HttpsError("invalid-argument", "missing_fields");
  if (!SLUG_KEY_RE.test(code)) throw new HttpsError("invalid-argument", "invalid_code");

  const penaltyKwd = readNumber(data, "penaltyKwd");
  if (penaltyKwd !== null && penaltyKwd < 0) {
    throw new HttpsError("invalid-argument", "invalid_penalty");
  }

  const totalQuantity = readNumber(data, "totalQuantity") ?? 0;
  if (totalQuantity < 0) throw new HttpsError("invalid-argument", "invalid_quantity");
  const reorderLevel = readNumber(data, "reorderLevel") ?? 0;
  if (reorderLevel < 0) throw new HttpsError("invalid-argument", "invalid_quantity");

  const db = getFirestore();
  const clash = await db.collection(ASSET_CATALOG).where("code", "==", code).get();
  if (clash.docs.some((doc) => doc.id !== id)) {
    throw new HttpsError("already-exists", "code_exists");
  }

  const ref = id ? db.collection(ASSET_CATALOG).doc(id) : db.collection(ASSET_CATALOG).doc();
  const payload: Record<string, unknown> = {
    name,
    code,
    description: optionalString(data, "description"),
    category: optionalString(data, "category"),
    penalty_kwd: penaltyKwd ?? 0,
    icon_key: optionalString(data, "iconKey"),
    total_quantity: totalQuantity,
    reorder_level: reorderLevel,
    is_active: readBool(data, "isActive", true),
    updated_at: FieldValue.serverTimestamp(),
  };

  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    const assigned = await db
      .collection(ASSET_ASSIGNMENTS)
      .where("catalog_item_id", "==", id)
      .where("status", "==", "assigned")
      .count()
      .get();
    if (totalQuantity < assigned.data().count) {
      throw new HttpsError("failed-precondition", "stock_below_assigned");
    }
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, image_url: optionalString(data, "imageUrl"), created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

export const adminDeleteAssetCatalog = onCall(async (request) => {
  await requireStaff(request, "assets.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const assigned = await db
    .collection(ASSET_ASSIGNMENTS)
    .where("catalog_item_id", "==", id)
    .where("status", "==", "assigned")
    .count()
    .get();
  if (assigned.data().count > 0) {
    throw new HttpsError("failed-precondition", "stock_below_assigned");
  }
  await db.collection(ASSET_CATALOG).doc(id).delete();
  return { success: true };
});

/** `admin_adjust_asset_stock` / `adjustAssetStock`. */
export const adminAdjustAssetStock = onCall(async (request) => {
  await requireStaff(request, "assets.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const delta = readNumber(data, "delta");
  if (!id || delta === null) throw new HttpsError("invalid-argument", "missing_fields");
  if (!Number.isInteger(delta) || delta === 0) {
    throw new HttpsError("invalid-argument", "invalid_quantity");
  }

  const db = getFirestore();
  const ref = db.collection(ASSET_CATALOG).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "catalog_not_found");
    const row = snap.data() ?? {};
    const current = typeof row.total_quantity === "number" ? row.total_quantity : 0;
    const assigned = await db
      .collection(ASSET_ASSIGNMENTS)
      .where("catalog_item_id", "==", id)
      .where("status", "==", "assigned")
      .count()
      .get();
    const nextTotal = current + delta;
    if (nextTotal < 0) throw new HttpsError("invalid-argument", "invalid_quantity");
    if (nextTotal < assigned.data().count) {
      throw new HttpsError("failed-precondition", "stock_below_assigned");
    }
    tx.set(ref, { total_quantity: nextTotal, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { success: true, id };
});

/** `admin_return_asset_assignment` / `returnAssetAssignment`. */
export const adminReturnAssetAssignment = onCall(async (request) => {
  await requireStaff(request, "assets.manage");

  const assignmentId = parseId(asRecord(request.data).assignmentId);
  if (!assignmentId) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const ref = db.collection(ASSET_ASSIGNMENTS).doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "assignment_not_found");
  const row = snap.data() ?? {};
  if (row.status !== "assigned") return { success: true };

  await ref.set(
    { status: "returned", returned_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { success: true };
});

type CustomFieldType = "text" | "number" | "date" | "select" | "multiselect" | "checkbox";

const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  "text",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
];

function requireFieldType(value: string): CustomFieldType {
  const match = CUSTOM_FIELD_TYPES.find((type) => type === value);
  if (!match) throw new HttpsError("invalid-argument", "invalid_definition");
  return match;
}

/** `admin_upsert_custom_field_definition`. */
export const adminUpsertCustomFieldDefinition = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const entityType = readString(data, "entityType") || "driver";
  if (entityType !== "driver") throw new HttpsError("invalid-argument", "invalid_entity");

  const key = readString(data, "key");
  if (!key || !SLUG_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_key");

  const fieldType = requireFieldType(readString(data, "fieldType"));
  const labelEn = readString(data, "labelEn") || key;
  const options = readStringArray(data.options);
  if ((fieldType === "select" || fieldType === "multiselect") && options.length === 0) {
    throw new HttpsError("invalid-argument", "invalid_definition");
  }

  const db = getFirestore();
  const clash = await db
    .collection(CUSTOM_FIELD_DEFINITIONS)
    .where("entity_type", "==", entityType)
    .where("key", "==", key)
    .get();
  if (clash.docs.some((doc) => doc.id !== id)) {
    throw new HttpsError("already-exists", "key_exists");
  }

  const ref = id
    ? db.collection(CUSTOM_FIELD_DEFINITIONS).doc(id)
    : db.collection(CUSTOM_FIELD_DEFINITIONS).doc();
  const payload: Record<string, unknown> = {
    entity_type: entityType,
    key,
    label_en: labelEn,
    label_ar: optionalString(data, "labelAr"),
    field_type: fieldType,
    options,
    is_required: readBool(data, "isRequired", false),
    is_active: readBool(data, "isActive", true),
    letters_only: readBool(data, "lettersOnly", false),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    const sortOrder = readNumber(data, "sortOrder") ?? 100;
    await ref.set({ ...payload, sort_order: sortOrder, created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

/** `admin_reorder_custom_field_definitions`. */
export const adminReorderCustomFieldDefinitions = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const ids = readStringArray(asRecord(request.data).ids);
  if (ids.length === 0) throw new HttpsError("invalid-argument", "missing_fields");

  const db = getFirestore();
  const batch = db.batch();
  ids.forEach((id, index) => {
    batch.set(
      db.collection(CUSTOM_FIELD_DEFINITIONS).doc(id),
      { sort_order: index, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
  await batch.commit();
  return { success: true };
});

export const adminDeleteCustomFieldDefinition = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  await getFirestore().collection(CUSTOM_FIELD_DEFINITIONS).doc(id).delete();
  return { success: true };
});

/** `admin_upsert_loan_tenure_option`. */
export const adminUpsertLoanTenureOption = onCall(async (request) => {
  await requireStaff(request, "requests.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const months = readNumber(data, "months");
  if (months === null || !Number.isFinite(months) || months <= 0) {
    throw new HttpsError("invalid-argument", "invalid_months");
  }

  const label = readString(data, "label") || `${months} months`;
  const db = getFirestore();
  const ref = id ? db.collection(LOAN_TENURE_OPTIONS).doc(id) : db.collection(LOAN_TENURE_OPTIONS).doc();
  const sortOrder = readNumber(data, "sortOrder") ?? months;
  const payload: Record<string, unknown> = {
    months,
    label,
    is_active: readBool(data, "isActive", true),
    sort_order: sortOrder,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

export const adminDeleteLoanTenureOption = onCall(async (request) => {
  await requireStaff(request, "requests.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  await getFirestore().collection(LOAN_TENURE_OPTIONS).doc(id).delete();
  return { success: true };
});

/** `admin_upsert_complaint_category`. */
export const adminUpsertComplaintCategory = onCall(async (request) => {
  await requireStaff(request, "requests.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const key = readString(data, "key").toLowerCase();
  const labelEn = readString(data, "labelEn");
  if (!key || !labelEn) throw new HttpsError("invalid-argument", "missing_fields");
  if (!SLUG_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_key");

  const db = getFirestore();
  const clash = await db.collection(COMPLAINT_CATEGORIES).where("key", "==", key).get();
  if (clash.docs.some((doc) => doc.id !== id)) {
    throw new HttpsError("already-exists", "key_exists");
  }

  const ref = id ? db.collection(COMPLAINT_CATEGORIES).doc(id) : db.collection(COMPLAINT_CATEGORIES).doc();
  const sortOrder = readNumber(data, "sortOrder") ?? 100;
  const payload: Record<string, unknown> = {
    key,
    label_en: labelEn,
    label_ar: optionalString(data, "labelAr"),
    is_active: readBool(data, "isActive", true),
    sort_order: sortOrder,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }
  return { success: true, id: ref.id };
});

export const adminDeleteComplaintCategory = onCall(async (request) => {
  await requireStaff(request, "requests.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  await getFirestore().collection(COMPLAINT_CATEGORIES).doc(id).delete();
  return { success: true };
});
