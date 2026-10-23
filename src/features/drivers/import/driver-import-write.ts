import { syncIntakeAssetAssignments } from "@/features/assets/assets-actions";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { DEFAULT_NOTIFY_LEAD_DAYS } from "@/features/drivers/types";
import {
  DRIVER_IMPORT_EXPIRY_DOC_TYPE,
  DRIVER_IMPORT_EXPIRY_FIELDS,
} from "@/features/drivers/types";
import { upsertDocumentTracking } from "@/lib/storage/document-tracking";
import type { StaffClient } from "../driver-uniqueness";
import type { DriverImportPreviewRow } from "../types";
import { writesCell } from "./driver-import-patch";
import type { DriverImportSnapshot, DriverImportTrackingSnap } from "./driver-import-stack";

const MONTH = () => `${kuwaitToday().slice(0, 7)}-01`;

export async function readImportSnapshot(
  db: StaffClient,
  intakeId: string,
  driverId: string | null,
): Promise<DriverImportSnapshot> {
  const { data: intake } = await db.from("driver_intakes").select("*").eq("id", intakeId).maybeSingle();
  const { data: driver } = driverId
    ? await db.from("drivers").select("*").eq("id", driverId).maybeSingle()
    : { data: null };
  const { data: profile } = driverId
    ? await db.from("profiles").select("id, full_name, phone").eq("id", driverId).maybeSingle()
    : { data: null };
  const { data: intakeLinks } = await db
    .from("driver_intake_restaurants")
    .select("restaurant_id")
    .eq("intake_id", intakeId);
  const { data: driverLinks } = driverId
    ? await db.from("driver_restaurants").select("restaurant_id").eq("driver_id", driverId)
    : { data: [] as Array<{ restaurant_id: string }> };
  const { data: assets } = await db
    .from("asset_assignments")
    .select("catalog_item_id, status")
    .eq("intake_id", intakeId);
  const { data: tracking } = await db
    .from("document_tracking")
    .select("doc_type, object_key, expires_at, track_expiry")
    .eq("intake_id", intakeId);
  const { data: off } = driverId
    ? await db
        .from("driver_off_structure")
        .select("off_days")
        .eq("driver_id", driverId)
        .eq("period_month", MONTH())
        .maybeSingle()
    : { data: null };

  const restaurant_ids = (
    (driverLinks && driverLinks.length > 0 ? driverLinks : intakeLinks) ?? []
  ).map((row) => String(row.restaurant_id));
  const asset_ids = (assets ?? [])
    .filter((row) => row.status === "assigned")
    .map((row) => String(row.catalog_item_id));
  const trackingRows: DriverImportTrackingSnap[] = (tracking ?? []).map((row) => ({
    doc_type: String(row.doc_type),
    object_key: row.object_key ?? null,
    expires_at: row.expires_at ?? null,
    track_expiry: Boolean(row.track_expiry),
  }));

  return {
    intake: (intake as Record<string, unknown> | null) ?? null,
    driver: (driver as Record<string, unknown> | null) ?? null,
    profile: (profile as Record<string, unknown> | null) ?? null,
    restaurant_ids,
    asset_ids,
    tracking: trackingRows,
    off_days: typeof off?.off_days === "number" ? off.off_days : null,
    driver_code:
      (driver as { driver_code?: string } | null)?.driver_code ??
      (intake as { driver_code?: string } | null)?.driver_code ??
      null,
  };
}

export async function syncImportRestaurants(
  db: StaffClient,
  intakeId: string,
  driverId: string | null,
  restaurantIds: string[],
): Promise<string | null> {
  await db.from("driver_intake_restaurants").delete().eq("intake_id", intakeId);
  if (restaurantIds.length > 0) {
    const { error } = await db.from("driver_intake_restaurants").insert(
      restaurantIds.map((restaurant_id) => ({ intake_id: intakeId, restaurant_id })),
    );
    if (error) return error.message;
  }
  if (!driverId) return null;
  const { data: existingLinks } = await db
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", driverId);
  const have = new Set((existingLinks ?? []).map((row) => row.restaurant_id));
  const want = new Set(restaurantIds);
  const toAdd = restaurantIds.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));
  if (toAdd.length > 0) {
    const { error } = await db.from("driver_restaurants").insert(
      toAdd.map((restaurant_id) => ({ driver_id: driverId, restaurant_id })),
    );
    if (error) return error.message;
  }
  if (toRemove.length > 0) {
    await db.from("driver_restaurants").delete().eq("driver_id", driverId).in("restaurant_id", toRemove);
  }
  return null;
}

export async function syncImportExpiries(
  row: DriverImportPreviewRow,
  intakeId: string,
  driverId: string | null,
  mode: "create" | "update",
  preserved: DriverImportTrackingSnap[],
): Promise<string | null> {
  for (const field of DRIVER_IMPORT_EXPIRY_FIELDS) {
    const hasValue = Boolean(row.expiries[field]);
    if (!writesCell(row, field, hasValue, mode)) continue;
    const previous = preserved.find((item) => item.doc_type === DRIVER_IMPORT_EXPIRY_DOC_TYPE[field]);
    const cleared = Boolean(row.cleared?.[field]);
    const result = await upsertDocumentTracking({
      intakeId,
      driverProfileId: driverId,
      docType: DRIVER_IMPORT_EXPIRY_DOC_TYPE[field],
      objectKey: previous?.object_key ?? null,
      expiry: {
        trackExpiry: !cleared && hasValue,
        expiresAt: cleared ? null : row.expiries[field] ?? null,
        notifyEnabled: true,
        notifyLeadDays: [...DEFAULT_NOTIFY_LEAD_DAYS],
        objectKey: previous?.object_key ?? null,
      },
    });
    if (result.error) return result.error;
  }
  return null;
}

export async function syncImportAssets(
  row: DriverImportPreviewRow,
  intakeId: string,
  driverId: string | null,
  assignedBy: string,
  mode: "create" | "update",
): Promise<string | null> {
  const hasValue = row.asset_ids.length > 0;
  if (!writesCell(row, "asset_ids", hasValue, mode)) return null;
  const ids = row.cleared?.asset_ids ? [] : row.asset_ids;
  const result = await syncIntakeAssetAssignments(null, intakeId, ids, assignedBy, driverId);
  return result.error ?? null;
}
