"use server";

import {
  logAdminActivity,
  logAdminMutation,
  logAdminRead,
} from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { normalizeCountryCode } from "@/lib/geo/countries";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";
import { hasOpsAssignment } from "./driver-assignment";
import {
  flattenProfileSnapshot,
  loadChangeLabels,
  loadIntakeProfileSnapshot,
  logDriverChange,
  resolveIntakeIdForDriver,
} from "./driver-change-log";
import { normalizeClientValue } from "./driver-client-fields";
import { parseDriverRiderCategory } from "./driver-rider-category";
import { mapDriverDbError, normalizeEmployeeId } from "./driver-errors";
import {
  accountStatusToRestoreAfterRestaurantSync,
  restaurantSyncPlan,
} from "./restaurant-sync-plan";
import { accountStatusToSyncFromOperations } from "./driver-operations-status";
import { countDeliveriesInWindow } from "./driver-delivery-counts";
import { defaultStartDate, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { civilIdExists, employeeIdExists } from "./driver-uniqueness";
import {
  allDriverAvatarKeys,
  allIntakeAvatarKeys,
  allIntakeDocumentKeys,
  buildIntakeDocumentKey,
  extensionFromMime,
} from "@/lib/storage/r2-keys";
import { pickDriverAvatarKey } from "@/lib/storage/driver-avatar-key";
import { syncDriverAvatarKey } from "@/lib/storage/sync-driver-avatar";
import { isR2Configured } from "@/lib/storage/r2-config";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import { listExistingDriverDocuments } from "@/lib/storage/driver-documents";
import {
  parseExpiryConfigFromForm,
  upsertDocumentTracking,
} from "@/lib/storage/document-tracking";
import { resolveDriverAvatarUrl } from "@/lib/storage/driver-avatar-url";
import { resolvePartnerLogoUrl } from "@/lib/storage/partner-logo-url";
import {
  uploadDriverAvatarFile,
  uploadIntakeAvatarFile,
} from "./driver-avatar-storage";
import {
  fetchDriverAssetAssignments,
  syncIntakeAssetAssignments,
} from "@/features/assets/assets-actions";
import { parseCatalogItemIds } from "@/features/assets/asset-form-utils";
import {
  parseDriverDeviceOverview,
  type DriverDeviceOverview,
  type DriverMultiDeviceRecentRow,
} from "./device-session-types";
import {
  DOCUMENT_TYPES,
  type DriverAccountStatus,
  type DriverDetailModel,
  type DriverDocumentType,
  type DriverListRow,
  type DriverRemoteDocument,
  type DriverRiderCategory,
  type DriverWorkflowStatus,
} from "./types";
import { listCustomFieldDefinitions } from "@/features/custom-fields/custom-fields-actions";
import { parseCustomFieldsFromFormData } from "@/lib/custom-fields/serialize";
import { parseCustomFieldsJson } from "@/lib/custom-fields/validate";
import type { Json } from "@/types/database";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

async function requireDriversManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

/** Server-side R2 check — must not call isR2Configured() from client components. */
export async function getDriverUploadStorageStatus(): Promise<{ r2Configured: boolean }> {
  await requireDriversView();
  return { r2Configured: await isR2Configured() };
}

function parseAssetsIssued(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, boolean>;
}

export type DriverMutationResult = {
  error?: string;
  success?: boolean;
  id?: string;
  driver_code?: string;
};

function parseRestaurantIds(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("restaurantIds")
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ];
}

async function validateRestaurantsPublished(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantIds: string[],
): Promise<{ error?: string }> {
  if (restaurantIds.length === 0) return {};
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("status", "published")
    .eq("is_active", true)
    .in("id", restaurantIds);
  if (error) return { error: "save_failed" };
  if ((data ?? []).length !== restaurantIds.length) {
    return { error: "invalid_restaurants" };
  }
  return {};
}

async function hasPublishedActiveRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantIds: string[],
): Promise<boolean> {
  if (restaurantIds.length === 0) return false;
  const { count, error } = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("is_active", true)
    .in("id", restaurantIds);
  if (error) return false;
  return (count ?? 0) > 0;
}

async function syncIntakeRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  intakeId: string,
  restaurantIds: string[],
) {
  await supabase.from("driver_intake_restaurants").delete().eq("intake_id", intakeId);
  if (restaurantIds.length === 0) return;
  await supabase.from("driver_intake_restaurants").insert(
    restaurantIds.map((restaurant_id) => ({ intake_id: intakeId, restaurant_id })),
  );
}

async function syncDriverRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
  restaurantIds: string[],
) {
  const { data: existing } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", driverId);
  const { toAdd, toRemove } = restaurantSyncPlan(
    (existing ?? []).map((r) => r.restaurant_id),
    restaurantIds,
  );
  // Insert first: a delete-all sync fires driver_restaurants_sync_status and
  // drops an active driver to pending even when the mapping is unchanged.
  if (toAdd.length > 0) {
    await supabase.from("driver_restaurants").insert(
      toAdd.map((restaurant_id) => ({ driver_id: driverId, restaurant_id })),
    );
  }
  if (toRemove.length > 0) {
    await supabase
      .from("driver_restaurants")
      .delete()
      .eq("driver_id", driverId)
      .in("restaurant_id", toRemove);
  }
}

async function fetchIntakeRestaurantIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  intakeId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("driver_intake_restaurants")
    .select("restaurant_id")
    .eq("intake_id", intakeId);
  return (data ?? []).map((r) => r.restaurant_id);
}

async function fetchDriverRestaurantIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", driverId);
  return (data ?? []).map((r) => r.restaurant_id);
}

async function loadRestaurantNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("restaurants").select("id, name").in("id", ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return (data ?? [])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((r) => r.name);
}

async function phoneExists(phone: string, excludeIntakeId?: string): Promise<boolean> {
  const supabase = await createClient();

  let intakeQuery = supabase
    .from("driver_intakes")
    .select("id")
    .eq("phone", phone)
    .is("archived_at", null);
  if (excludeIntakeId) intakeQuery = intakeQuery.neq("id", excludeIntakeId);

  const { data: intake } = await intakeQuery.maybeSingle();
  if (intake) return true;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (!profile) return false;
  if (excludeIntakeId) {
    const { data: linkedIntake } = await supabase
      .from("driver_intakes")
      .select("id")
      .eq("linked_profile_id", profile.id)
      .maybeSingle();
    if (linkedIntake?.id === excludeIntakeId) return false;
  }
  return true;
}

async function uploadIntakeDocument(
  intakeId: string,
  docType: DriverDocumentType,
  file: File,
  uploadedBy: string,
): Promise<{ error?: string; path?: string }> {
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "file_too_large" };
  if (!ALLOWED_DOC_MIME.has(file.type)) return { error: "invalid_file_type" };

  const ext = extensionFromMime(file.type);
  const key = buildIntakeDocumentKey(intakeId, docType, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, file.type, {
      uploadedBy,
      entityType: "driver_intake",
      entityId: intakeId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { path: key };
}

export async function createDriverIntake(
  formData: FormData,
): Promise<DriverMutationResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const civilId = String(formData.get("civilId") ?? "").trim();
  const employeeIdRaw = String(formData.get("employeeId") ?? "");
  const employeeId = normalizeEmployeeId(employeeIdRaw);
  const nationality = normalizeCountryCode(String(formData.get("nationality") ?? ""));
  const riderCategory = parseDriverRiderCategory(String(formData.get("riderCategory") ?? ""));
  const clientId = normalizeClientValue(String(formData.get("clientId") ?? ""));
  const clientName = normalizeClientValue(String(formData.get("clientName") ?? ""));
  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const zoneId = String(formData.get("zoneId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const vehicleTypeKey = String(formData.get("vehicleTypeKey") ?? "bike").trim() || "bike";
  const workflowStatusRaw = String(formData.get("workflowStatus") ?? "").trim();
  const workflowStatus: DriverWorkflowStatus =
    workflowStatusRaw === "approved" || workflowStatusRaw === "pending" || workflowStatusRaw === "draft"
      ? workflowStatusRaw
      : "draft";
  const catalogItemIds = parseCatalogItemIds(formData);

  if (!fullName || !employeeId) {
    return { error: "missing_fields" };
  }

  // Optional, but a value that was typed still has to be a real one. Absent is
  // NULL rather than '' — an empty string is a value, and two of them would
  // collide on the phone unique index.
  const phone = phoneRaw ? normalizeKuwaitPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { error: "invalid_phone" };

  const civilIdNormalized = civilId ? normalizeCivilId(civilId) : null;
  if (civilId && !civilIdNormalized) return { error: "invalid_civil_id" };

  const customFieldDefs = await listCustomFieldDefinitions("driver", {
    includeInactive: true,
  });
  const customParsed = parseCustomFieldsFromFormData(formData, customFieldDefs);
  if (customParsed.errors.length > 0) {
    return { error: "invalid_custom_fields" };
  }

  const restaurantIds = parseRestaurantIds(formData);
  if (!hasOpsAssignment(zoneId, restaurantIds)) {
    return { error: "missing_assignment" };
  }
  const supabase = await createClient();
  const intakeId = crypto.randomUUID();

  const docsToUpload: { docType: DriverDocumentType; file: File }[] = [];
  for (const docType of DOCUMENT_TYPES) {
    const file = formData.get(`doc_${docType}`);
    if (file instanceof File && file.size > 0) {
      docsToUpload.push({ docType, file });
    }
  }

  const avatarFile = formData.get("avatar");
  const hasAvatarUpload = avatarFile instanceof File && avatarFile.size > 0;
  const needsR2 = docsToUpload.length > 0 || hasAvatarUpload;

  const [phoneTaken, civilTaken, restaurantCheck, r2Configured] = await Promise.all([
    phone ? phoneExists(phone) : Promise.resolve(false),
    civilIdNormalized ? civilIdExists(civilIdNormalized) : Promise.resolve(false),
    validateRestaurantsPublished(supabase, restaurantIds),
    needsR2 ? isR2Configured() : Promise.resolve(true),
  ]);

  if (phoneTaken) return { error: "phone_exists" };
  if (civilTaken) return { error: "civil_id_exists" };
  if (restaurantCheck.error) return { error: restaurantCheck.error };
  if (needsR2 && !r2Configured) return { error: "r2_not_configured" };

  const [docUploads, avatarUpload, codeResult] = await Promise.all([
    Promise.all(
      docsToUpload.map(({ docType, file }) =>
        uploadIntakeDocument(intakeId, docType, file, auth.session.id),
      ),
    ),
    hasAvatarUpload && avatarFile instanceof File
      ? uploadIntakeAvatarFile(intakeId, avatarFile, auth.session.id)
      : Promise.resolve<{ error?: string; path?: string }>({}),
    supabase.rpc("allocate_driver_code"),
  ]);

  const docError = docUploads.find((r) => r.error)?.error;
  if (docError || avatarUpload.error) {
    try {
      await deleteObjects([
        ...allIntakeDocumentKeys(intakeId),
        ...allIntakeAvatarKeys(intakeId),
      ]);
    } catch {
      /* best-effort */
    }
    return { error: docError ?? avatarUpload.error ?? "upload_failed" };
  }

  const allocatedCode = codeResult.data;
  if (codeResult.error || !allocatedCode || typeof allocatedCode !== "string") {
    try {
      await deleteObjects([
        ...allIntakeDocumentKeys(intakeId),
        ...allIntakeAvatarKeys(intakeId),
      ]);
    } catch {
      /* best-effort */
    }
    return { error: "save_failed" };
  }

  const intakeAvatarKey = avatarUpload.path ?? null;

  const { data, error } = await supabase
    .from("driver_intakes")
    .insert({
      id: intakeId,
      phone,
      full_name: fullName,
      civil_id: civilIdNormalized,
      employee_id: employeeId,
      nationality,
      rider_category: riderCategory,
      client_id: clientId,
      client_name: clientName,
      driver_code: allocatedCode,
      partner_id: partnerId || null,
      zone_id: zoneId || null,
      vehicle_id: vehicleId || null,
      vehicle_type_key: vehicleTypeKey,
      avatar_url: intakeAvatarKey,
      status: "awaiting_app_link",
      workflow_status: normalizeIntakeWorkflowStatus(false, workflowStatus),
      linked: false,
      custom_fields: customParsed.values as unknown as Json,
    })
    .select("id, driver_code")
    .single();

  if (error) {
    try {
      await deleteObjects([...allIntakeDocumentKeys(intakeId), ...allIntakeAvatarKeys(intakeId)]);
    } catch {
      /* best-effort rollback */
    }
    return { error: mapDriverDbError(error, "employee_id") };
  }

  await syncIntakeRestaurants(supabase, data.id, restaurantIds);

  const assetSync = await syncIntakeAssetAssignments(
    supabase,
    data.id,
    catalogItemIds,
    auth.session.id,
    null,
  );
  if (assetSync.error) {
    return { error: assetSync.error };
  }

  for (const { docType } of docsToUpload) {
    const expiry = parseExpiryConfigFromForm(formData, docType);
    const trackingResult = await upsertDocumentTracking({
      intakeId: data.id,
      driverProfileId: null,
      docType,
      expiry,
    });
    if (trackingResult.error) {
      return { error: trackingResult.error };
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "driver_intake",
    entityId: data.id,
    routeName: "createDriverIntake",
    after: { driver_code: data.driver_code, partner_id: partnerId, zone_id: zoneId },
  });

  const labels = await loadChangeLabels(supabase, {
    zoneId: zoneId || null,
    partnerId: partnerId || null,
    vehicleId: vehicleId || null,
    restaurantIds,
  });
  void logDriverChange({
    intakeId: data.id,
    source: "manual_create",
    before: {},
    after: flattenProfileSnapshot({
      full_name: fullName,
      phone,
      civil_id: civilIdNormalized,
      employee_id: employeeId,
      driver_code: data.driver_code,
      partner: labels.partner,
      zone: labels.zone,
      restaurants: labels.restaurants,
      vehicle: labels.vehicle,
      nationality,
      rider_category: riderCategory,
      client_id: clientId,
      client_name: clientName,
      workflow_status: normalizeIntakeWorkflowStatus(false, workflowStatus),
      custom_fields: customParsed.values as Record<string, unknown>,
    }),
  });
  for (const { docType } of docsToUpload) {
    void logDriverChange({
      intakeId: data.id,
      source: "document",
      before: { [`document.${docType}`]: "absent" },
      after: { [`document.${docType}`]: "uploaded" },
      context: { doc_type: docType },
    });
  }

  return { success: true, id: data.id, driver_code: data.driver_code };
}

type IntakeListRow = {
  id: string;
  full_name: string;
  phone: string | null;
  driver_code: string;
  employee_id: string;
  partner_id: string;
  zone_id: string;
  linked_profile_id: string | null;
  workflow_status: DriverWorkflowStatus;
  linked: boolean;
  archived_at: string | null;
  avatar_url: string | null;
  rider_category: DriverRiderCategory;
  client_id: string | null;
  client_name: string | null;
  custom_fields: Json;
  partners:
    | { name: string; logo_url: string | null }
    | { name: string; logo_url: string | null }[]
    | null;
  zones: { name: string } | { name: string }[] | null;
};

function kuwaitDayBounds(): { start: string; end: string } {
  const today = kuwaitTodayYmd();
  return {
    start: `${today}T00:00:00+03:00`,
    end: `${today}T23:59:59.999+03:00`,
  };
}

function kuwaitRollingWeekBounds(): { start: string; end: string } {
  const today = kuwaitTodayYmd();
  return {
    start: `${defaultStartDate(6)}T00:00:00+03:00`,
    end: `${today}T23:59:59.999+03:00`,
  };
}

async function fetchDriverDeliveryCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string | null,
): Promise<{ today: number; week: number }> {
  if (!driverId) return { today: 0, week: 0 };
  const week = kuwaitRollingWeekBounds();
  const today = kuwaitDayBounds();
  const { data } = await supabase
    .from("deliveries")
    .select("status, created_at, pickup_at, delivered_at")
    .eq("driver_id", driverId)
    .neq("status", "cancelled")
    .gte("created_at", week.start);
  const rows = data ?? [];
  return {
    today: countDeliveriesInWindow(rows, today.start, today.end),
    week: countDeliveriesInWindow(rows, week.start, week.end),
  };
}

function deriveAccountStatus(
  workflowStatus: DriverWorkflowStatus,
  driverStatus?: DriverAccountStatus,
): DriverAccountStatus {
  if (driverStatus) return driverStatus;
  if (workflowStatus === "pending") return "pending";
  return "pending";
}

/** `approved` workflow is only valid after admin Verify and Approve links the intake. */
function normalizeIntakeWorkflowStatus(
  linked: boolean,
  status: DriverWorkflowStatus,
): DriverWorkflowStatus {
  if (!linked && status === "approved") return "pending";
  return status;
}

function relName<T extends { name: string }>(
  rel: T | T[] | null | undefined,
): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.name ?? "—";
}

function relZone(
  rel:
    | { name: string; code?: string }
    | { name: string; code?: string }[]
    | null
    | undefined,
): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row) return "—";
  return row.code ? `${row.name} (${row.code})` : row.name;
}

export async function fetchDriversForAdmin(options?: {
  archived?: boolean;
}): Promise<DriverListRow[]> {
  await requireDriversView();
  void logAdminRead("driver_intakes", "fetchDriversForAdmin", {
    archived: options?.archived ?? false,
  });
  const supabase = await createClient();
  const archivedOnly = options?.archived === true;

  let query = supabase
    .from("driver_intakes")
    .select(
      `
      id,
      full_name,
      phone,
      driver_code,
      employee_id,
      rider_category,
      client_id,
      client_name,
      avatar_url,
      partner_id,
      zone_id,
      linked_profile_id,
      workflow_status,
      linked,
      archived_at,
      custom_fields,
      partners (name, logo_url),
      zones (name)
    `,
    )
    .order("created_at", { ascending: false });

  query = archivedOnly
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);

  const { data: intakes, error } = await query;

  if (error) throw error;

  const rows = (intakes ?? []) as IntakeListRow[];
  const linkedIds = [
    ...new Set(
      rows
        .map((r) => r.linked_profile_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const driverByProfileId = new Map<
    string,
    {
      status: DriverAccountStatus;
      is_on_duty: boolean;
      is_blocked: boolean;
      blocked_reason: string | null;
      app_passcode: string | null;
      employee_id: string | null;
      avatar_object_key: string | null;
      zone_id: string | null;
    }
  >();
  const deliveryCountByDriverId = new Map<string, number>();
  const restaurantNamesByIntakeId = new Map<string, string[]>();
  const restaurantNamesByDriverId = new Map<string, string[]>();
  const restaurantIdsByIntakeId = new Map<string, string[]>();
  const restaurantIdsByDriverId = new Map<string, string[]>();

  const intakeIds = rows.map((r) => r.id);
  if (intakeIds.length > 0) {
    const [{ data: intakeRestRows }, { data: driverRestRows }] = await Promise.all([
      supabase
        .from("driver_intake_restaurants")
        .select("intake_id, restaurants (id, name)")
        .in("intake_id", intakeIds),
      linkedIds.length > 0
        ? supabase
            .from("driver_restaurants")
            .select("driver_id, restaurants (id, name)")
            .in("driver_id", linkedIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    for (const link of (intakeRestRows ?? []) as Array<{
      intake_id: string;
      restaurants: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
      const rel = Array.isArray(link.restaurants) ? link.restaurants[0] : link.restaurants;
      if (!rel?.name) continue;
      const nameList = restaurantNamesByIntakeId.get(link.intake_id) ?? [];
      nameList.push(rel.name);
      restaurantNamesByIntakeId.set(link.intake_id, nameList);
      const idList = restaurantIdsByIntakeId.get(link.intake_id) ?? [];
      if (!idList.includes(rel.id)) idList.push(rel.id);
      restaurantIdsByIntakeId.set(link.intake_id, idList);
    }

    for (const link of (driverRestRows ?? []) as Array<{
      driver_id: string;
      restaurants: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
      const rel = Array.isArray(link.restaurants) ? link.restaurants[0] : link.restaurants;
      if (!rel?.name) continue;
      const nameList = restaurantNamesByDriverId.get(link.driver_id) ?? [];
      nameList.push(rel.name);
      restaurantNamesByDriverId.set(link.driver_id, nameList);
      const idList = restaurantIdsByDriverId.get(link.driver_id) ?? [];
      if (!idList.includes(rel.id)) idList.push(rel.id);
      restaurantIdsByDriverId.set(link.driver_id, idList);
    }
  }

  if (linkedIds.length > 0) {
    const [{ data: driverRows }, { data: deliveryRows }] = await Promise.all([
      supabase
        .from("drivers")
        .select("id, status, is_on_duty, is_blocked, blocked_reason, app_passcode, employee_id, avatar_object_key, zone_id")
        .in("id", linkedIds),
      (() => {
        const { start, end } = kuwaitDayBounds();
        return supabase
          .from("deliveries")
          .select("driver_id")
          .in("driver_id", linkedIds)
          .gte("delivered_at", start)
          .lte("delivered_at", end);
      })(),
    ]);

    for (const driver of driverRows ?? []) {
      driverByProfileId.set(driver.id, {
        status: driver.status as DriverAccountStatus,
        is_on_duty: driver.is_on_duty,
        is_blocked: driver.is_blocked ?? false,
        blocked_reason: driver.blocked_reason ?? null,
        app_passcode: driver.app_passcode ?? null,
        employee_id: driver.employee_id ?? null,
        avatar_object_key: driver.avatar_object_key ?? null,
        zone_id: driver.zone_id ?? null,
      });
    }

    for (const delivery of deliveryRows ?? []) {
      deliveryCountByDriverId.set(
        delivery.driver_id,
        (deliveryCountByDriverId.get(delivery.driver_id) ?? 0) + 1,
      );
    }
  }

  const partnerLogoCache = new Map<string, string | null>();
  const avatarCache = new Map<string, string | null>();

  return Promise.all(
    rows.map(async (row) => {
      const partnerRel = row.partners;
      const partnerRow = Array.isArray(partnerRel) ? partnerRel[0] : partnerRel;
      const partnerLogoKey = partnerRow?.logo_url ?? null;

      let partner_logo_url: string | null = null;
      if (partnerLogoKey) {
        if (partnerLogoCache.has(partnerLogoKey)) {
          partner_logo_url = partnerLogoCache.get(partnerLogoKey) ?? null;
        } else {
          partner_logo_url = await resolvePartnerLogoUrl(partnerLogoKey);
          partnerLogoCache.set(partnerLogoKey, partner_logo_url);
        }
      }

      const zoneRel = row.zones;
      const zoneRow = Array.isArray(zoneRel) ? zoneRel[0] : zoneRel;
      const linkedDriver = row.linked_profile_id
        ? driverByProfileId.get(row.linked_profile_id)
        : undefined;

      const account_status = deriveAccountStatus(
        row.workflow_status,
        linkedDriver?.status,
      );

      const avatarKey = pickDriverAvatarKey({
        avatarObjectKey: linkedDriver?.avatar_object_key,
        intakeAvatarUrl: row.avatar_url,
      });
      let avatar_display_url: string | null = null;
      if (avatarKey) {
        if (avatarCache.has(avatarKey)) {
          avatar_display_url = avatarCache.get(avatarKey) ?? null;
        } else {
          avatar_display_url = await resolveDriverAvatarUrl(avatarKey);
          avatarCache.set(avatarKey, avatar_display_url);
        }
      }

      return {
        id: row.id,
        driver_code: row.driver_code,
        employee_id: row.linked_profile_id
          ? (driverByProfileId.get(row.linked_profile_id)?.employee_id ?? row.employee_id)
          : row.employee_id,
        full_name: row.full_name,
        phone: row.phone,
        partner_id: row.partner_id,
        partner_name: relName(row.partners),
        partner_logo_url,
        zone_id: linkedDriver?.zone_id ?? row.zone_id,
        zone_name: zoneRow?.name ?? "—",
        restaurant_ids: row.linked_profile_id
          ? (restaurantIdsByDriverId.get(row.linked_profile_id) ??
              restaurantIdsByIntakeId.get(row.id) ??
              [])
          : (restaurantIdsByIntakeId.get(row.id) ?? []),
        restaurant_names: row.linked_profile_id
          ? (restaurantNamesByDriverId.get(row.linked_profile_id) ??
              restaurantNamesByIntakeId.get(row.id) ??
              [])
          : (restaurantNamesByIntakeId.get(row.id) ?? []),
        workflow_status: row.workflow_status,
        linked: row.linked,
        linked_profile_id: row.linked_profile_id,
        account_status,
        is_blocked: linkedDriver?.is_blocked ?? false,
        blocked_reason: linkedDriver?.blocked_reason ?? null,
        is_on_duty: linkedDriver?.is_on_duty ?? false,
        today_deliveries: row.linked_profile_id
          ? (deliveryCountByDriverId.get(row.linked_profile_id) ?? 0)
          : 0,
        app_passcode:
          account_status === "active" && !row.archived_at
            ? (linkedDriver?.app_passcode ?? null)
            : null,
        archived_at: row.archived_at,
        avatar_url: row.avatar_url,
        avatar_display_url,
        rider_category: row.rider_category ?? "in_house",
        client_id: row.client_id,
        client_name: row.client_name,
        custom_fields: parseCustomFieldsJson(row.custom_fields),
      };
    }),
  );
}

export async function archiveDriverIntake(
  intakeId: string,
): Promise<DriverMutationResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!intakeId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_driver_intake", {
    p_intake_id: intakeId,
  });

  if (error) return { error: mapDriverDbError(error) };

  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    if (payload.error === "intake_not_found") return { error: "save_failed" };
    return { error: payload.error ?? "save_failed" };
  }

  const { data: archived } = await supabase
    .from("driver_intakes")
    .select("linked_profile_id")
    .eq("id", intakeId)
    .maybeSingle();
  void logDriverChange({
    intakeId,
    driverId: archived?.linked_profile_id,
    source: "archive",
    context: { note: "archive" },
  });

  return { success: true, id: intakeId };
}

export async function restoreDriverIntake(
  intakeId: string,
): Promise<DriverMutationResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!intakeId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: intake, error: loadError } = await supabase
    .from("driver_intakes")
    .select("id, phone, civil_id, employee_id, archived_at, linked_profile_id")
    .eq("id", intakeId)
    .maybeSingle();

  if (loadError || !intake) return { error: "save_failed" };
  if (!intake.archived_at) return { error: "save_failed" };

  const phone = intake.phone?.trim();
  const civilId = intake.civil_id?.trim() ?? "";
  const employeeId = intake.employee_id?.trim() ?? "";

  const [phoneTaken, civilTaken, employeeTaken] = await Promise.all([
    phone ? phoneExists(phone, intakeId) : Promise.resolve(false),
    civilId ? civilIdExists(civilId, intakeId) : Promise.resolve(false),
    employeeId ? employeeIdExists(employeeId, intakeId) : Promise.resolve(false),
  ]);

  if (phoneTaken) return { error: "phone_exists" };
  if (civilTaken) return { error: "civil_id_exists" };
  if (employeeTaken) return { error: "employee_id_exists" };

  const { data, error } = await supabase.rpc("restore_driver_intake", {
    p_intake_id: intakeId,
  });

  if (error) return { error: mapDriverDbError(error) };

  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    if (payload.error === "intake_not_found") return { error: "save_failed" };
    if (payload.error === "intake_not_archived") return { error: "save_failed" };
    if (payload.error === "not_authorized") return { error: "not_authorized" };
    return { error: payload.error ?? "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "driver_intake",
    entityId: intakeId,
    routeName: "restoreDriverIntake",
    after: { archived_at: null },
  });
  void logDriverChange({
    intakeId,
    driverId: intake.linked_profile_id,
    source: "restore",
    context: { note: "restore" },
  });

  return { success: true, id: intakeId };
}

export async function updateDriverWorkflowStatus(
  intakeId: string,
  workflowStatus: DriverWorkflowStatus,
): Promise<DriverMutationResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const before = await loadIntakeProfileSnapshot(supabase, intakeId);
  const { error } = await supabase
    .from("driver_intakes")
    .update({
      workflow_status: workflowStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intakeId)
    .is("archived_at", null);

  if (error) return { error: mapDriverDbError(error) };
  void logAdminMutation({
    action: "update",
    entityType: "driver_intake",
    entityId: intakeId,
    routeName: "updateDriverWorkflowStatus",
    after: { workflow_status: workflowStatus },
  });
  void logDriverChange({
    intakeId,
    driverId: before?.driverId,
    source: "status",
    before: before?.snapshot ?? {},
    after: { ...(before?.snapshot ?? {}), workflow_status: workflowStatus },
  });
  return { success: true };
}

export async function updateDriverIntake(
  formData: FormData,
): Promise<DriverMutationResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  try {
    return await updateDriverIntakeInner(formData, auth.session.id);
  } catch {
    return { error: "save_failed" };
  }
}

async function updateDriverIntakeInner(
  formData: FormData,
  actorId: string,
): Promise<DriverMutationResult> {
  const intakeId = String(formData.get("intakeId") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const civilId = String(formData.get("civilId") ?? "").trim();
  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const zoneId = String(formData.get("zoneId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const vehicleTypeKey = String(formData.get("vehicleTypeKey") ?? "bike").trim() || "bike";
  const employeeIdRaw = String(formData.get("employeeId") ?? "");
  const employeeId = normalizeEmployeeId(employeeIdRaw);
  const nationality = normalizeCountryCode(String(formData.get("nationality") ?? ""));
  const riderCategory = parseDriverRiderCategory(String(formData.get("riderCategory") ?? ""));
  const clientId = normalizeClientValue(String(formData.get("clientId") ?? ""));
  const clientName = normalizeClientValue(String(formData.get("clientName") ?? ""));
  const catalogItemIds = parseCatalogItemIds(formData);
  const workflowStatus = String(formData.get("workflowStatus") ?? "").trim() as DriverWorkflowStatus;
  const avatarFile = formData.get("avatar");
  const hasAvatarUpload = avatarFile instanceof File && avatarFile.size > 0;
  const removeAvatar = formData.get("removeAvatar") === "true";

  const customFieldDefs = await listCustomFieldDefinitions("driver", {
    includeInactive: true,
  });
  const customParsed = parseCustomFieldsFromFormData(formData, customFieldDefs);
  if (customParsed.errors.length > 0) {
    return { error: "invalid_custom_fields" };
  }

  if (!intakeId || !fullName || !employeeId) {
    return { error: "missing_fields" };
  }

  if (!["draft", "pending", "approved"].includes(workflowStatus)) {
    return { error: "missing_fields" };
  }

  // Clearing the field is a legitimate edit, so an empty input means NULL —
  // not "leave whatever was there".
  const phone = phoneRaw ? normalizeKuwaitPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { error: "invalid_phone" };

  const civilIdNormalized = civilId ? normalizeCivilId(civilId) : null;
  if (civilId && !civilIdNormalized) return { error: "invalid_civil_id" };

  const supabase = await createClient();
  const restaurantIds = parseRestaurantIds(formData);
  if (!hasOpsAssignment(zoneId, restaurantIds)) {
    return { error: "missing_assignment" };
  }

  const [phoneTaken, civilTaken, existingResp, restaurantCheck, r2Configured] = await Promise.all([
    phone ? phoneExists(phone, intakeId) : Promise.resolve(false),
    civilIdNormalized ? civilIdExists(civilIdNormalized, intakeId) : Promise.resolve(false),
    supabase
      .from("driver_intakes")
      .select("id, linked_profile_id, driver_code, avatar_url")
      .eq("id", intakeId)
      .is("archived_at", null)
      .maybeSingle(),
    validateRestaurantsPublished(supabase, restaurantIds),
    hasAvatarUpload ? isR2Configured() : Promise.resolve(true),
  ]);

  if (phoneTaken) return { error: "phone_exists" };
  if (civilTaken) return { error: "civil_id_exists" };
  if (hasAvatarUpload && !r2Configured) return { error: "r2_not_configured" };
  if (restaurantCheck.error) return { error: restaurantCheck.error };

  const existing = existingResp.data;
  if (!existing) return { error: "save_failed" };

  const beforeChange = await loadIntakeProfileSnapshot(supabase, intakeId);

  let currentAccountStatus: DriverAccountStatus | null = null;
  if (existing.linked_profile_id) {
    const { data: linkedDriver } = await supabase
      .from("drivers")
      .select("status")
      .eq("id", existing.linked_profile_id)
      .maybeSingle();

    currentAccountStatus = (linkedDriver?.status as DriverAccountStatus | null) ?? null;

    if (linkedDriver?.status === "active") {
      if (!hasOpsAssignment(zoneId, restaurantIds)) {
        return { error: "missing_assignment" };
      }
      if (restaurantIds.length > 0) {
        const { data: publishedRows } = await supabase
          .from("restaurants")
          .select("id")
          .eq("status", "published")
          .eq("is_active", true)
          .in("id", restaurantIds);
        if ((publishedRows ?? []).length === 0 && !hasOpsAssignment(zoneId, [])) {
          return { error: "missing_assignment" };
        }
      }
    }
  }

  let intakeAvatarPath = existing.avatar_url ?? null;

  if (removeAvatar) {
    intakeAvatarPath = null;
    try {
      await deleteObjects([
        ...allIntakeAvatarKeys(intakeId),
        ...(existing.linked_profile_id
          ? allDriverAvatarKeys(existing.linked_profile_id)
          : []),
      ]);
    } catch {
      /* best-effort */
    }
  } else if (hasAvatarUpload && avatarFile instanceof File) {
    const upload = await uploadIntakeAvatarFile(intakeId, avatarFile, actorId);
    if (upload.error) return { error: upload.error };
    intakeAvatarPath = upload.path ?? null;
  }

  const linked = Boolean(existing.linked_profile_id);
  const resolvedWorkflowStatus = normalizeIntakeWorkflowStatus(linked, workflowStatus);

  const { error } = await supabase
    .from("driver_intakes")
    .update({
      full_name: fullName,
      phone,
      civil_id: civilIdNormalized,
      employee_id: employeeId,
      nationality,
      rider_category: riderCategory,
      client_id: clientId,
      client_name: clientName,
      partner_id: partnerId || null,
      zone_id: zoneId || null,
      vehicle_id: vehicleId || null,
      vehicle_type_key: vehicleTypeKey,
      avatar_url: intakeAvatarPath,
      workflow_status: resolvedWorkflowStatus,
      custom_fields: customParsed.values as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intakeId);

  if (error) return { error: mapDriverDbError(error, "employee_id") };

  const assetSync = await syncIntakeAssetAssignments(
    supabase,
    intakeId,
    catalogItemIds,
    actorId,
    existing.linked_profile_id,
  );
  if (assetSync.error) {
    return { error: assetSync.error };
  }

  if (existing.linked_profile_id) {
    let profileAvatarPath: string | null | undefined;
    if (removeAvatar) {
      profileAvatarPath = null;
    } else if (hasAvatarUpload && avatarFile instanceof File) {
      const upload = await uploadDriverAvatarFile(
        existing.linked_profile_id,
        avatarFile,
        actorId,
      );
      if (upload.error) return { error: upload.error };
      profileAvatarPath = upload.path ?? null;
    }

    const linkedProfileId = existing.linked_profile_id;
    // Restaurant mapping first, then the driver row. Running them in parallel
    // let driver_restaurants_sync_status see an empty set and write Pending
    // after we had already restored Active.
    await syncDriverRestaurants(supabase, linkedProfileId, restaurantIds);
    await syncIntakeRestaurants(supabase, intakeId, restaurantIds);

    const results = await Promise.all([
      supabase
        .from("profiles")
        .update({
          full_name: fullName,
          phone,
          ...(profileAvatarPath !== undefined ? { avatar_url: profileAvatarPath } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkedProfileId),
      supabase
        .from("drivers")
        .update({
          partner_id: partnerId || null,
          zone_id: zoneId || null,
          vehicle_id: vehicleId || null,
          vehicle_type_key: vehicleTypeKey,
          civil_id: civilIdNormalized,
          employee_id: employeeId,
          nationality,
          rider_category: riderCategory,
          client_id: clientId,
          client_name: clientName,
          custom_fields: customParsed.values as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkedProfileId),
    ]);

    const driverUpdateResp = results[1];
    if (driverUpdateResp.error) {
      return { error: mapDriverDbError(driverUpdateResp.error, "employee_id") };
    }

    const nextAccount = accountStatusToSyncFromOperations({
      linked: true,
      currentAccountStatus,
      operationsWorkflow: resolvedWorkflowStatus,
    });
    const { data: afterSync } = await supabase
      .from("drivers")
      .select("status")
      .eq("id", linkedProfileId)
      .maybeSingle();
    const restoreAccount = accountStatusToRestoreAfterRestaurantSync({
      statusBefore: currentAccountStatus,
      intended: nextAccount,
      statusNow: (afterSync?.status as DriverAccountStatus | null) ?? null,
    });
    const writeAccount = nextAccount ?? restoreAccount;
    if (writeAccount) {
      const { data: statusData, error: statusError } = await supabase.rpc(
        "set_driver_account_status",
        {
          p_driver_id: linkedProfileId,
          p_status: writeAccount,
        },
      );
      if (statusError) return { error: "save_failed" };
      const payload = (statusData ?? {}) as { ok?: boolean; error?: string };
      if (!payload.ok) {
        if (
          payload.error === "driver_missing_active_restaurant" ||
          payload.error === "driver_missing_assignment"
        ) {
          return { error: "missing_assignment" };
        }
        return { error: "save_failed" };
      }
    }

    if (profileAvatarPath !== undefined) {
      await syncDriverAvatarKey(linkedProfileId, profileAvatarPath);
    }
  } else {
    await syncIntakeRestaurants(supabase, intakeId, restaurantIds);
  }

  void logAdminMutation({
    action: "update",
    entityType: "driver_intake",
    entityId: intakeId,
    routeName: "updateDriverIntake",
    after: { workflow_status: workflowStatus, partner_id: partnerId },
  });

  const afterLabels = await loadChangeLabels(supabase, {
    zoneId: zoneId || null,
    partnerId: partnerId || null,
    vehicleId: vehicleId || null,
    restaurantIds,
  });
  void logDriverChange({
    intakeId,
    driverId: existing.linked_profile_id,
    source: "edit",
    before: beforeChange?.snapshot ?? {},
    after: flattenProfileSnapshot({
      full_name: fullName,
      phone,
      civil_id: civilIdNormalized,
      employee_id: employeeId,
      driver_code: existing.driver_code,
      partner: afterLabels.partner,
      zone: afterLabels.zone,
      restaurants: afterLabels.restaurants,
      vehicle: afterLabels.vehicle,
      nationality,
      rider_category: riderCategory,
      client_id: clientId,
      client_name: clientName,
      workflow_status: resolvedWorkflowStatus,
      account_status: currentAccountStatus,
      custom_fields: customParsed.values as Record<string, unknown>,
    }),
  });

  return { success: true, id: intakeId };
}

export async function fetchDriverDocuments(
  intakeId: string,
  driverProfileId: string | null,
): Promise<Partial<Record<DriverDocumentType, DriverRemoteDocument>>> {
  await requireDriversView();
  if (!intakeId) return {};
  return listExistingDriverDocuments(intakeId, driverProfileId);
}

export async function fetchDriverDetail(
  id: string,
): Promise<DriverDetailModel | null> {
  await requireDriversView();
  void logAdminRead("driver_intake", "fetchDriverDetail", { id });
  try {
    return await fetchDriverDetailInner(id);
  } catch {
    return null;
  }
}

async function fetchDriverDetailInner(
  id: string,
): Promise<DriverDetailModel | null> {
  const supabase = await createClient();

  const { data: intake } = await supabase
    .from("driver_intakes")
    .select(
      `
      id,
      full_name,
      phone,
      civil_id,
      employee_id,
      nationality,
      rider_category,
      client_id,
      client_name,
      driver_code,
      workflow_status,
      linked,
      linked_profile_id,
      partner_id,
      zone_id,
      vehicle_id,
      vehicle_type_key,
      avatar_url,
      assets_issued,
      custom_fields,
      created_at,
      archived_at,
      partners (name),
      zones (name, code),
      vehicles (bike_id, reg_number)
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (intake) {
    const linkedId = intake.linked_profile_id;
    let profile: {
      email: string | null;
      avatar_url: string | null;
      full_name: string | null;
      phone: string | null;
    } | null = null;
    let linkedDriver: {
      app_passcode: string | null;
      status: DriverAccountStatus;
      employee_id: string | null;
      nationality: string | null;
      rider_category: DriverRiderCategory;
      client_id: string | null;
      client_name: string | null;
      is_blocked: boolean;
      blocked_reason: string | null;
      blocked_at: string | null;
      login_verification_exempt: boolean;
      avatar_object_key: string | null;
    } | null = null;
    if (linkedId) {
      const [{ data: prof }, { data: drv }] = await Promise.all([
        supabase
          .from("profiles")
          .select("email, avatar_url, full_name, phone")
          .eq("id", linkedId)
          .maybeSingle(),
        supabase
          .from("drivers")
          .select("app_passcode, status, employee_id, nationality, rider_category, client_id, client_name, is_blocked, blocked_reason, blocked_at, login_verification_exempt, avatar_object_key")
          .eq("id", linkedId)
          .maybeSingle(),
      ]);
      profile = prof;
      linkedDriver = drv
        ? {
            app_passcode: drv.app_passcode,
            status: drv.status as DriverAccountStatus,
            employee_id: drv.employee_id ?? null,
            nationality: drv.nationality ?? null,
            rider_category: (drv.rider_category as DriverRiderCategory) ?? "in_house",
            client_id: drv.client_id ?? null,
            client_name: drv.client_name ?? null,
            is_blocked: drv.is_blocked ?? false,
            blocked_reason: drv.blocked_reason ?? null,
            blocked_at: drv.blocked_at ?? null,
            login_verification_exempt: drv.login_verification_exempt ?? false,
            avatar_object_key: drv.avatar_object_key ?? null,
          }
        : null;
    }

    const vehicle = intake.vehicles as
      | { bike_id: string; reg_number: string | null }
      | { bike_id: string; reg_number: string | null }[]
      | null;
    const vehicleRow = Array.isArray(vehicle) ? vehicle[0] : vehicle;
    const vehicle_label = vehicleRow
      ? `${vehicleRow.bike_id}${vehicleRow.reg_number ? ` · ${vehicleRow.reg_number}` : ""}`
      : null;

    const restaurant_ids =
      linkedId != null
        ? await fetchDriverRestaurantIds(supabase, linkedId)
        : await fetchIntakeRestaurantIds(supabase, intake.id);
    const [restaurant_names, has_published_restaurant, avatar_url, assigned_assets, deliveryCounts] =
      await Promise.all([
      loadRestaurantNames(supabase, restaurant_ids),
      hasPublishedActiveRestaurants(supabase, restaurant_ids),
      resolveDriverAvatarUrl(
        pickDriverAvatarKey({
          avatarObjectKey: linkedDriver?.avatar_object_key,
          profileAvatarUrl: profile?.avatar_url,
          intakeAvatarUrl: intake.avatar_url,
        }),
      ),
      fetchDriverAssetAssignments(intake.id, linkedId),
      fetchDriverDeliveryCounts(supabase, linkedId),
    ]);

    return {
      id: intake.id,
      intake_id: intake.id,
      source: "intake",
      driver_code: intake.driver_code,
      full_name: profile?.full_name ?? intake.full_name,
      // Both are optional now. The em dash matches what the driver-sourced
      // branch below has always returned for a missing value, and it reads back
      // through the edit form as empty, since the inputs keep digits only.
      phone: profile?.phone ?? intake.phone ?? "—",
      email: profile?.email ?? null,
      civil_id: intake.civil_id ?? "—",
      employee_id: linkedDriver?.employee_id ?? intake.employee_id ?? null,
      nationality: linkedDriver?.nationality ?? intake.nationality ?? null,
      rider_category: linkedDriver?.rider_category ?? intake.rider_category ?? "in_house",
      client_id: linkedDriver?.client_id ?? intake.client_id ?? null,
      client_name: linkedDriver?.client_name ?? intake.client_name ?? null,
      avatar_url,
      partner_name: relName(
        intake.partners as { name: string } | { name: string }[] | null,
      ),
      zone_label: relZone(intake.zones),
      vehicle_label,
      partner_id: intake.partner_id ?? null,
      zone_id: intake.zone_id ?? null,
      vehicle_id: intake.vehicle_id,
      vehicle_type_key: (intake as { vehicle_type_key?: string | null }).vehicle_type_key ?? null,
      workflow_status: intake.workflow_status as DriverWorkflowStatus,
      linked: intake.linked,
      linked_profile_id: intake.linked_profile_id,
      base_earnings_kwd: null,
      joined_at: intake.created_at.slice(0, 10),
      assets_issued: parseAssetsIssued(intake.assets_issued),
      assigned_assets,
      restaurant_ids,
      restaurant_names,
      has_published_restaurant,
      app_passcode:
        linkedDriver &&
        linkedDriver.status === "active" &&
        !intake.archived_at
          ? linkedDriver.app_passcode
          : null,
      account_status: deriveAccountStatus(
        intake.workflow_status as DriverWorkflowStatus,
        linkedDriver?.status,
      ),
      is_blocked: linkedDriver?.is_blocked ?? false,
      blocked_reason: linkedDriver?.blocked_reason ?? null,
      blocked_at: linkedDriver?.blocked_at ?? null,
      login_verification_exempt:
        linkedDriver?.login_verification_exempt ?? false,
      archived_at: intake.archived_at,
      documents: {},
      custom_fields: parseCustomFieldsJson(intake.custom_fields),
      deliveries_today: deliveryCounts.today,
      deliveries_week: deliveryCounts.week,
    };
  }

  const { data: driverRow } = await supabase
    .from("drivers")
    .select(
      `
      id,
      driver_code,
      civil_id,
      status,
      base_earnings_kwd,
      joined_at,
      is_on_duty,
      vehicle_id,
      vehicle_type_key,
      partner_id,
      zone_id,
      app_passcode,
      employee_id,
      nationality,
      rider_category,
      client_id,
      client_name,
      is_blocked,
      blocked_reason,
      blocked_at,
      login_verification_exempt,
      archived_at,
      custom_fields,
      avatar_object_key,
      partners (name),
      zones (name, code)
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (!driverRow) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("email, avatar_url, full_name, phone")
    .eq("id", id)
    .maybeSingle();

  let vehicleRow: { bike_id: string; reg_number: string | null } | null = null;
  if (driverRow.vehicle_id) {
    const { data: v } = await supabase
      .from("vehicles")
      .select("bike_id, reg_number")
      .eq("id", driverRow.vehicle_id)
      .maybeSingle();
    vehicleRow = v;
  }

  const { data: intakeForDriver } = await supabase
    .from("driver_intakes")
    .select(
      "id, assets_issued, workflow_status, linked, partner_id, zone_id, vehicle_id, archived_at, avatar_url",
    )
    .eq("linked_profile_id", id)
    .maybeSingle();

  const restaurant_ids = await fetchDriverRestaurantIds(supabase, id);
  const [restaurant_names, has_published_restaurant, avatar_url, assigned_assets, deliveryCounts] =
    await Promise.all([
    loadRestaurantNames(supabase, restaurant_ids),
    hasPublishedActiveRestaurants(supabase, restaurant_ids),
    resolveDriverAvatarUrl(
      pickDriverAvatarKey({
        avatarObjectKey: driverRow.avatar_object_key,
        profileAvatarUrl: prof?.avatar_url,
        intakeAvatarUrl: intakeForDriver?.avatar_url,
      }),
    ),
    fetchDriverAssetAssignments(intakeForDriver?.id ?? null, id),
    fetchDriverDeliveryCounts(supabase, id),
  ]);

  return {
    id: driverRow.id,
    intake_id: intakeForDriver?.id ?? null,
    source: intakeForDriver ? "intake" : "driver",
    driver_code: driverRow.driver_code,
    full_name: prof?.full_name ?? "—",
    phone: prof?.phone ?? "—",
    email: prof?.email ?? null,
    civil_id: driverRow.civil_id ?? "—",
    employee_id: driverRow.employee_id ?? null,
    nationality: driverRow.nationality ?? null,
    rider_category: (driverRow.rider_category as DriverRiderCategory) ?? "in_house",
    client_id: driverRow.client_id ?? null,
    client_name: driverRow.client_name ?? null,
    avatar_url,
    partner_name: relName(driverRow.partners as { name: string } | { name: string }[] | null),
    zone_label: relZone(driverRow.zones),
    vehicle_label: vehicleRow
      ? `${vehicleRow.bike_id}${vehicleRow.reg_number ? ` · ${vehicleRow.reg_number}` : ""}`
      : null,
    partner_id: intakeForDriver?.partner_id ?? driverRow.partner_id ?? "",
    zone_id: intakeForDriver?.zone_id ?? driverRow.zone_id ?? "",
    vehicle_id: intakeForDriver?.vehicle_id ?? driverRow.vehicle_id,
    vehicle_type_key:
      (driverRow as { vehicle_type_key?: string | null }).vehicle_type_key ??
      (intakeForDriver as { vehicle_type_key?: string | null } | null)?.vehicle_type_key ??
      null,
    workflow_status:
      (intakeForDriver?.workflow_status as DriverWorkflowStatus) ?? "pending",
    linked: intakeForDriver?.linked ?? true,
    linked_profile_id: id,
    base_earnings_kwd: driverRow.base_earnings_kwd,
    joined_at: driverRow.joined_at,
    assets_issued: parseAssetsIssued(intakeForDriver?.assets_issued),
    assigned_assets,
    restaurant_ids,
    restaurant_names,
    has_published_restaurant,
    app_passcode:
      driverRow.status === ("active" as DriverAccountStatus) &&
      !(intakeForDriver?.archived_at ?? driverRow.archived_at)
        ? (driverRow.app_passcode ?? null)
        : null,
    account_status: deriveAccountStatus(
      (intakeForDriver?.workflow_status as DriverWorkflowStatus) ?? "approved",
      driverRow.status as DriverAccountStatus,
    ),
    is_blocked: driverRow.is_blocked ?? false,
    blocked_reason: driverRow.blocked_reason ?? null,
    blocked_at: driverRow.blocked_at ?? null,
    login_verification_exempt: driverRow.login_verification_exempt ?? false,
    archived_at: intakeForDriver?.archived_at ?? driverRow.archived_at,
    documents: {},
    custom_fields: parseCustomFieldsJson(driverRow.custom_fields),
    deliveries_today: deliveryCounts.today,
    deliveries_week: deliveryCounts.week,
  };
}

export async function setDriverLoginVerificationExempt(
  driverId: string,
  exempt: boolean,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  if (!driverId) return { error: "missing_fields" };

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("drivers")
      .update({ login_verification_exempt: exempt })
      .eq("id", driverId);

    if (error) return { error: "save_failed" };

    void logAdminMutation({
      action: "update",
      entityType: "driver",
      entityId: driverId,
      routeName: "setDriverLoginVerificationExempt",
      after: { login_verification_exempt: exempt },
    });

    return { success: true };
  } catch {
    return { error: "save_failed" };
  }
}

export type RegeneratePasscodeResult =
  | { success: true; passcode: string }
  | { error: string };

export async function updateDriverAccountStatus(
  driverId: string,
  status: DriverAccountStatus,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  if (!driverId || !["active", "suspended", "pending"].includes(status)) {
    return { error: "missing_fields" };
  }

  const supabase = await createClient();
  const { data: beforeDriver } = await supabase
    .from("drivers")
    .select("status")
    .eq("id", driverId)
    .maybeSingle();
  const { data, error } = await supabase.rpc("set_driver_account_status", {
    p_driver_id: driverId,
    p_status: status,
  });

  if (error) return { error: "save_failed" };

  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    if (
      payload.error === "driver_missing_active_restaurant" ||
      payload.error === "driver_missing_assignment"
    ) {
      return { error: "missing_assignment" };
    }
    if (payload.error === "driver_not_found") return { error: "driver_not_found" };
    if (payload.error === "not_authorized") return { error: "not_authorized" };
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "updateDriverAccountStatus",
    after: { status },
  });

  const intakeId = await resolveIntakeIdForDriver(supabase, driverId);
  if (intakeId) {
    void logDriverChange({
      intakeId,
      driverId,
      source: "status",
      before: { account_status: beforeDriver?.status ?? null },
      after: { account_status: status },
    });
  }

  return { success: true };
}

export async function setDriverBlocked(
  driverId: string,
  blocked: boolean,
  reason?: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  if (!driverId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_driver_blocked", {
    p_driver_id: driverId,
    p_blocked: blocked,
    p_reason: blocked ? reason?.trim() || undefined : undefined,
  });

  if (error) return { error: "save_failed" };

  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    if (payload.error === "missing_block_reason") return { error: "missing_block_reason" };
    if (payload.error === "driver_not_found") return { error: "driver_not_found" };
    if (payload.error === "not_authorized") return { error: "not_authorized" };
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: blocked ? "update" : "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "setDriverBlocked",
    after: blocked ? { is_blocked: true, blocked_reason: reason?.trim() } : { is_blocked: false },
  });

  const intakeId = await resolveIntakeIdForDriver(supabase, driverId);
  if (intakeId) {
    void logDriverChange({
      intakeId,
      driverId,
      source: blocked ? "block" : "unblock",
      before: { blocked: blocked ? "no" : "yes" },
      after: {
        blocked: blocked ? "yes" : "no",
        ...(blocked && reason?.trim() ? { block_reason: reason.trim() } : {}),
      },
    });
  }

  return { success: true };
}

export async function regenerateDriverPasscode(
  driverId: string,
): Promise<RegeneratePasscodeResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  if (!driverId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("drivers")
    .select("id, status")
    .eq("id", driverId)
    .maybeSingle();

  if (!existing) return { error: "driver_not_found" };
  if (existing.status !== "active") return { error: "driver_not_active" };

  const { data, error } = await supabase.rpc("regenerate_driver_app_passcode", {
    p_driver_id: driverId,
  });

  if (error) return { error: "save_failed" };

  const payload = (data ?? {}) as { ok?: boolean; error?: string; passcode?: string };
  if (!payload.ok || !payload.passcode) {
    return { error: payload.error ?? "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "regenerateDriverAppPasscode",
    context: { passcode_rotated: true },
  });

  const intakeId = await resolveIntakeIdForDriver(supabase, driverId);
  if (intakeId) {
    void logDriverChange({
      intakeId,
      driverId,
      source: "passcode",
      context: { note: "passcode replaced" },
    });
  }

  return { success: true, passcode: payload.passcode };
}

export async function fetchDriverDeviceOverview(
  driverId: string,
  historyLimit = 20,
): Promise<DriverDeviceOverview | null> {
  await requireDriversView();
  if (!driverId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_driver_device_overview", {
    p_driver_id: driverId,
    p_history_limit: historyLimit,
  });

  if (error) throw error;

  const overview = parseDriverDeviceOverview(data);
  if (!overview) throw new Error("invalid_device_overview");

  const overrideSessions = overview.history.filter(
    (session) => session.revoked_reason === "override",
  );
  if (overrideSessions.length > 0) {
    void logAdminActivity({
      action: "read",
      entityType: "driver",
      entityId: driverId,
      routeName: "driverDeviceOverrideReview",
      context: {
        override_count: overrideSessions.length,
        override_sessions: overrideSessions.map((session) => ({
          session_id: session.session_id,
          device_id: session.device_id,
          device_model: session.device_model,
          device_manufacturer: session.device_manufacturer,
          revoked_at: session.revoked_at,
          flushed_at: session.flushed_at,
        })),
      },
    });
  }

  void logAdminRead("driver_device_session", "fetchDriverDeviceOverview", {
    driver_id: driverId,
  });

  return overview;
}

export type ForceSignOutDriverResult =
  | { success: true }
  | { error: "not_authorized" | "missing_fields" | "save_failed" };

export async function forceSignOutDriver(
  driverId: string,
): Promise<ForceSignOutDriverResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  if (!driverId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_force_sign_out_driver", {
    p_driver_id: driverId,
  });

  if (error) return { error: "save_failed" };

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "forceSignOutDriver",
    after: { active_device_cleared: true },
  });

  return { success: true };
}

export async function fetchDriversMultiDeviceRecent(
  days = 7,
): Promise<DriverMultiDeviceRecentRow[]> {
  await requireDriversView();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_drivers_multi_device_recent", {
    p_days: days,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    driver_id: row.driver_id,
    device_count: Number(row.device_count),
    latest_activity_at: row.latest_activity_at,
  }));
}

