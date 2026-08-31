"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";
import { employeeIdKey, normalizeEmployeeId } from "./driver-errors";
import {
  evaluateImportIdentity,
  isImportRowReady,
  type ImportIdentityRoster,
  type ImportIdentitySeen,
} from "./import/import-identity";
import { civilIdExists } from "./driver-uniqueness";
import { intakeMissingApprovalFields } from "./driver-approve-validation";
import type {
  DriverImportCredential,
  DriverImportMappedRow,
  DriverImportPreviewRow,
  DriverImportPreviewStatus,
  DriverRiderCategory,
} from "./types";
import { listCustomFieldDefinitions } from "@/features/custom-fields/custom-fields-actions";
import { validateCustomFieldValues } from "@/lib/custom-fields/validate";
import { resolveCountryInput } from "@/lib/geo/countries";
import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  clientValueTooLong,
  normalizeClientValue,
} from "./driver-client-fields";
import { hasOpsAssignment } from "./driver-assignment";
import {
  flattenProfileSnapshot,
  loadIntakeProfileSnapshot,
  logDriverChange,
} from "./driver-change-log";
import type { DriverImportLogEvent } from "./import/import-progress";
import { parseImportActive, parseRiderCategory } from "./import/parse";
import {
  buildPartnerIndex,
  buildRestaurantIndex,
  buildZoneIndex,
  resolvePartnerToken,
  resolveRestaurantTokens,
  resolveZoneToken,
} from "./import/resolve-lookups";
import type { DriverImportLookups } from "./import/lookups";

type ImportApplyClient = Awaited<ReturnType<typeof createClient>>;

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

export async function fetchDriverImportLookups(): Promise<
  DriverImportLookups | { error: "not_authorized" }
> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  const supabase = await createClient();

  const [{ data: restaurants }, { data: partners }, { data: zones }] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, restaurant_code, partner_id, zone_id, status, is_active")
      .order("name"),
    supabase.from("partners").select("id, name").order("name"),
    supabase.from("zones").select("id, name, code").order("name"),
  ]);

  const partnerNameById = new Map((partners ?? []).map((p) => [p.id, p.name]));
  const zoneById = new Map((zones ?? []).map((z) => [z.id, z]));

  return {
    restaurants: (restaurants ?? []).map((r) => {
      const zone = r.zone_id ? zoneById.get(r.zone_id) : undefined;
      return {
        name: r.name,
        restaurant_code: r.restaurant_code,
        id: r.id,
        partner_name: r.partner_id ? (partnerNameById.get(r.partner_id) ?? null) : null,
        partner_id: r.partner_id,
        zone_name: zone?.name ?? null,
        zone_code: zone?.code ?? null,
        zone_id: r.zone_id,
        importable: r.status === "published" && r.is_active,
      };
    }),
    zones: (zones ?? []).map((z) => ({
      name: z.name,
      code: z.code,
      id: z.id,
    })),
    partners: (partners ?? []).map((p) => ({ name: p.name, id: p.id })),
  };
}

export type ApproveDriverResult =
  | { success: true; driverId: string; passcode: string }
  | { error: string };

function syntheticDriverEmail(driverCode: string): string {
  return `${driverCode.trim().toLowerCase()}@driver.dpd.local`;
}

export async function approveDriverIntake(
  intakeId: string,
): Promise<ApproveDriverResult> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!intakeId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: intake, error: loadError } = await supabase
    .from("driver_intakes")
    .select(
      "id, phone, full_name, driver_code, linked, archived_at, partner_id, zone_id, employee_id, civil_id",
    )
    .eq("id", intakeId)
    .is("archived_at", null)
    .maybeSingle();

  if (loadError || !intake) return { error: "save_failed" };
  if (intake.linked) return { error: "intake_already_linked" };
  if (intakeMissingApprovalFields(intake)) {
    return { error: "missing_fields" };
  }

  const { data: hasAssignment, error: assignmentCheckError } = await supabase.rpc(
    "intake_has_ops_assignment",
    { p_intake_id: intakeId },
  );
  if (assignmentCheckError || !hasAssignment) {
    return { error: "missing_assignment" };
  }

  const civilIdNormalized = normalizeCivilId(intake.civil_id ?? "");
  if (civilIdNormalized && (await civilIdExists(civilIdNormalized, intakeId))) {
    return { error: "civil_id_exists" };
  }

  const email = syntheticDriverEmail(intake.driver_code);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "save_failed" };
  }

  // The synthetic email is the auth identifier the passcode login exchanges a
  // magic link on; phone is stored only as a contact detail. Omit the key
  // entirely when there is no number rather than sending null, since
  // `phone_confirm` on an absent phone is a claim about nothing.
  const intakePhone = intake.phone?.trim() ? intake.phone.trim() : null;
  const { data: authUser, error: createError } = await admin.auth.admin.createUser({
    ...(intakePhone ? { phone: intakePhone, phone_confirm: true } : {}),
    email,
    email_confirm: true,
    user_metadata: {
      full_name: intake.full_name,
      driver_code: intake.driver_code,
    },
  });

  if (createError || !authUser.user?.id) {
    const msg = createError?.message?.toLowerCase() ?? "";
    if (msg.includes("phone") || msg.includes("already")) {
      return { error: "phone_exists" };
    }
    return { error: "save_failed" };
  }

  const userId = authUser.user.id;

  const { data: rpcRaw, error: rpcError } = await supabase.rpc("admin_approve_driver", {
    p_intake_id: intakeId,
    p_user_id: userId,
    p_email: email,
  });

  if (rpcError) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* rollback */
    }
    return { error: "save_failed" };
  }

  const payload = (rpcRaw ?? {}) as {
    ok?: boolean;
    error?: string;
    driver_id?: string;
    app_passcode?: string;
  };

  if (!payload.ok) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* rollback */
    }
    const err = payload.error ?? "save_failed";
    if (err === "driver_missing_active_restaurant" || err === "driver_missing_assignment") {
      return { error: "missing_assignment" };
    }
    if (err === "intake_already_linked") return { error: "intake_already_linked" };
    if (err === "intake_archived") return { error: "save_failed" };
    if (err === "phone_exists") return { error: "phone_exists" };
    if (err === "civil_id_exists") return { error: "civil_id_exists" };
    if (err === "employee_id_exists") return { error: "employee_id_exists" };
    if (err === "not_authorized") return { error: "not_authorized" };
    if (err === "missing_fields") return { error: "missing_fields" };
    return { error: err };
  }

  void logAdminMutation({
    action: "update",
    entityType: "driver_intake",
    entityId: intakeId,
    routeName: "approveDriverIntake",
    after: {
      driver_id: payload.driver_id,
      driver_code: intake.driver_code,
    },
  });
  void logDriverChange({
    intakeId,
    driverId: payload.driver_id ?? userId,
    source: "approve",
    context: { note: "approve" },
  });

  return {
    success: true,
    driverId: payload.driver_id ?? userId,
    passcode: payload.app_passcode ?? "",
  };
}

export async function resolveDriverImportPreview(
  rows: DriverImportMappedRow[],
): Promise<DriverImportPreviewRow[] | { error: "not_authorized" }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  const supabase = await createClient();

  const [
    { data: partners },
    { data: zones },
    { data: vehicles },
    { data: restaurants },
    { data: intakes },
    { data: drivers },
    { data: profiles },
  ] = await Promise.all([
    supabase.from("partners").select("id, name"),
    supabase.from("zones").select("id, name, code"),
    supabase.from("vehicles").select("id, bike_id, reg_number"),
    supabase
      .from("restaurants")
      .select("id, name, restaurant_code, partner_id, status, is_active")
      .eq("status", "published")
      .eq("is_active", true),
    supabase
      .from("driver_intakes")
      .select("id, phone, civil_id, employee_id")
      .is("archived_at", null),
    supabase.from("drivers").select("id, employee_id, civil_id").is("archived_at", null),
    supabase.from("profiles").select("id, phone").eq("role", "rider"),
  ]);

  const partnerIndex = buildPartnerIndex(
    (partners ?? []).map((p) => ({ id: p.id, name: p.name })),
  );
  const zoneIndex = buildZoneIndex(
    (zones ?? []).map((z) => ({ id: z.id, name: z.name, code: z.code })),
  );
  const restaurantIndex = buildRestaurantIndex(
    (restaurants ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      restaurant_code: r.restaurant_code,
    })),
  );

  const vehicleByLabel = new Map<string, string>();
  for (const v of vehicles ?? []) {
    const bike = v.bike_id?.trim().toLowerCase() ?? "";
    if (bike) vehicleByLabel.set(bike, v.id);
    const reg = v.reg_number?.trim().toLowerCase() ?? "";
    if (reg) vehicleByLabel.set(reg, v.id);
    if (bike && reg) vehicleByLabel.set(`${bike} · ${reg}`, v.id);
  }

  const roster: ImportIdentityRoster = {
    employeeIds: new Set(),
    phoneToEmployee: new Map(),
    civilToEmployee: new Map(),
  };
  const driverEmpById = new Map<string, string>();
  for (const driver of drivers ?? []) {
    if (!driver.employee_id) continue;
    const key = employeeIdKey(driver.employee_id);
    roster.employeeIds.add(key);
    driverEmpById.set(driver.id, key);
    if (driver.civil_id) {
      roster.civilToEmployee.set(normalizeCivilId(driver.civil_id) ?? driver.civil_id, key);
    }
  }
  for (const intake of intakes ?? []) {
    if (!intake.employee_id) continue;
    const key = employeeIdKey(intake.employee_id);
    roster.employeeIds.add(key);
    if (intake.phone) {
      roster.phoneToEmployee.set(normalizeKuwaitPhone(intake.phone) ?? intake.phone, key);
    }
    if (intake.civil_id) {
      roster.civilToEmployee.set(normalizeCivilId(intake.civil_id) ?? intake.civil_id, key);
    }
  }
  for (const profile of profiles ?? []) {
    const emp = driverEmpById.get(profile.id);
    if (profile.phone && emp) {
      roster.phoneToEmployee.set(normalizeKuwaitPhone(profile.phone) ?? profile.phone, emp);
    }
  }

  const seen: ImportIdentitySeen = {
    employeeIds: new Set(),
    phones: new Map(),
    civils: new Map(),
  };

  return rows.map((row) => {
    let partner_id: string | null = null;
    let partner_name: string | null = null;
    let zone_id: string | null = null;
    let zone_name: string | null = null;
    let vehicle_id: string | null = null;
    let restaurant_ids: string[] = [];
    let restaurant_names: string[] = [];
    let nationality: string | null = null;
    let rider_category: DriverRiderCategory = "in_house";
    let client_id: string | null = null;
    let client_name: string | null = null;
    let active: boolean | null = null;

    const identity = evaluateImportIdentity(row, roster, seen);
    let status: DriverImportPreviewStatus = identity.status;
    const existingByEmployeeId = identity.existingByEmployeeId;
    const lookupStillOpen = () =>
      status === "ok" || (status === "duplicate_employee_id" && existingByEmployeeId);

    if (lookupStillOpen() && row.partner_id?.trim()) {
      const hit = resolvePartnerToken(row.partner_id, partnerIndex);
      if (hit.status === "ok") {
        partner_id = hit.id;
        partner_name = hit.name;
      } else if (hit.status === "ambiguous") status = "ambiguous_partner";
      else status = "unmatched_partner";
    }

    if (lookupStillOpen() && row.zone_id?.trim()) {
      const hit = resolveZoneToken(row.zone_id, zoneIndex);
      if (hit.status === "ok") {
        zone_id = hit.id;
        zone_name = hit.name;
      } else if (hit.status === "ambiguous") status = "ambiguous_zone";
      else status = "unmatched_zone";
    }

    if (lookupStillOpen() && row.vehicle_label?.trim()) {
      const vlabel = row.vehicle_label.trim().toLowerCase();
      vehicle_id = vehicleByLabel.get(vlabel) ?? null;
      if (!vehicle_id) status = "unmatched_vehicle";
    }

    if (lookupStillOpen()) {
      const restaurantsHit = resolveRestaurantTokens(row.restaurant_ids, restaurantIndex);
      if (restaurantsHit.status === "ok") {
        restaurant_ids = restaurantsHit.ids;
        restaurant_names = restaurantsHit.names;
      } else if (restaurantsHit.status === "empty") {
        restaurant_ids = [];
        restaurant_names = [];
      } else if (restaurantsHit.status === "ambiguous") {
        status = "ambiguous_restaurant";
      } else {
        status = "unmatched_restaurant";
      }
    }

    if (lookupStillOpen() && !hasOpsAssignment(zone_id, restaurant_ids)) {
      status = "missing_assignment";
    }

    if (lookupStillOpen() && row.nationality?.trim()) {
      nationality = resolveCountryInput(row.nationality);
      if (!nationality) status = "invalid_nationality";
    }

    if (lookupStillOpen()) {
      const parsedCategory = parseRiderCategory(row.rider_category);
      if (parsedCategory === "invalid") status = "invalid_rider_category";
      else rider_category = parsedCategory ?? "in_house";
    }

    // Free text, so the only way a cell can be wrong is by being longer than
    // the column. Caught here rather than at insert time, where it would abort
    // the batch with a CHECK violation naming a constraint, not a row.
    if (lookupStillOpen()) {
      client_id = normalizeClientValue(row.client_id);
      if (clientValueTooLong(client_id, CLIENT_ID_MAX_LENGTH)) {
        status = "invalid_client_id";
      }
    }

    if (lookupStillOpen()) {
      client_name = normalizeClientValue(row.client_name);
      if (clientValueTooLong(client_name, CLIENT_NAME_MAX_LENGTH)) {
        status = "invalid_client_name";
      }
    }

    if (lookupStillOpen()) {
      const parsedActive = parseImportActive(row.active);
      if (parsedActive === "invalid") status = "invalid_active";
      else active = parsedActive;
    }

    if (lookupStillOpen() && existingByEmployeeId) {
      status = "duplicate_employee_id";
    }

    return {
      ...row,
      status,
      existingByEmployeeId,
      partner_id,
      partner_name,
      zone_id,
      zone_name,
      vehicle_id,
      restaurant_ids,
      restaurant_names,
      nationality,
      rider_category,
      client_id,
      client_name,
      active,
    };
  });
}

function nowIso() {
  return new Date().toISOString();
}

function logWho(row: DriverImportPreviewRow) {
  return {
    rowIndex: row.rowIndex,
    name: row.full_name?.trim() ?? "",
    employeeId: row.employee_id ?? undefined,
    zone: row.zone_name ?? undefined,
  };
}

async function applyOneImportRow(
  row: DriverImportPreviewRow,
  ctx: {
    supabase: ImportApplyClient;
    duplicateStrategy: "skip" | "update";
    approveImmediately: boolean;
    customFieldDefs: Awaited<ReturnType<typeof listCustomFieldDefinitions>>;
    fileName?: string;
  },
): Promise<{
  events: DriverImportLogEvent[];
  applied: 0 | 1;
  approved: 0 | 1;
  failure?: { rowIndex: number; reason: string };
  credential?: DriverImportCredential;
}> {
  const events: DriverImportLogEvent[] = [];
  const who = logWho(row);
  const fail = (reason: string) => {
    events.push({ at: nowIso(), kind: "failed", ...who, detail: reason });
    return {
      events,
      applied: 0 as const,
      approved: 0 as const,
      failure: { rowIndex: row.rowIndex, reason },
    };
  };

  const phone = row.phone?.trim() ? normalizeKuwaitPhone(row.phone) : null;
  const civilId = row.civil_id?.trim() ? normalizeCivilId(row.civil_id) : null;
  const employeeId = normalizeEmployeeId(row.employee_id!);
  if (!employeeId) return fail("missing_fields");
  if (!hasOpsAssignment(row.zone_id, row.restaurant_ids)) {
    return fail("missing_assignment");
  }

  let intakeId: string | null = null;
  let driverCode: string | null = null;
  let updated = false;
  let beforeSnap = {};

  const matchExisting = () =>
    ctx.supabase
      .from("driver_intakes")
      .select("id, linked, driver_code, linked_profile_id")
      .is("archived_at", null)
      .ilike("employee_id", employeeId)
      .maybeSingle();

  if (ctx.duplicateStrategy === "update") {
    const { data: existing } = await matchExisting();

    if (existing) {
      const prior = await loadIntakeProfileSnapshot(ctx.supabase, existing.id);
      beforeSnap = prior?.snapshot ?? {};
      const { error: updErr } = await ctx.supabase
        .from("driver_intakes")
        .update({
          phone,
          full_name: row.full_name!.trim(),
          civil_id: civilId,
          employee_id: employeeId,
          partner_id: row.partner_id,
          zone_id: row.zone_id,
          vehicle_id: row.vehicle_id,
          nationality: row.nationality,
          rider_category: row.rider_category,
          client_id: row.client_id,
          client_name: row.client_name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updErr) return fail(updErr.message);
      intakeId = existing.id;
      driverCode = existing.driver_code;
      updated = true;
      await ctx.supabase
        .from("driver_intake_restaurants")
        .delete()
        .eq("intake_id", intakeId);

      if (existing.linked_profile_id) {
        const linkedId = existing.linked_profile_id;
        const { error: driverErr } = await ctx.supabase
          .from("drivers")
          .update({
            partner_id: row.partner_id,
            zone_id: row.zone_id,
            vehicle_id: row.vehicle_id,
            civil_id: civilId,
            employee_id: employeeId,
            nationality: row.nationality,
            rider_category: row.rider_category,
            client_id: row.client_id,
            client_name: row.client_name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", linkedId);
        if (driverErr) return fail(driverErr.message);
        await ctx.supabase
          .from("profiles")
          .update({
            full_name: row.full_name!.trim(),
            phone,
            updated_at: new Date().toISOString(),
          })
          .eq("id", linkedId);
        const { data: existingLinks } = await ctx.supabase
          .from("driver_restaurants")
          .select("restaurant_id")
          .eq("driver_id", linkedId);
        const have = new Set((existingLinks ?? []).map((r) => r.restaurant_id));
        const want = new Set(row.restaurant_ids);
        const toAdd = row.restaurant_ids.filter((id) => !have.has(id));
        const toRemove = [...have].filter((id) => !want.has(id));
        if (toAdd.length > 0) {
          const { error: addErr } = await ctx.supabase.from("driver_restaurants").insert(
            toAdd.map((restaurant_id) => ({ driver_id: linkedId, restaurant_id })),
          );
          if (addErr) return fail(addErr.message);
        }
        if (toRemove.length > 0) {
          await ctx.supabase
            .from("driver_restaurants")
            .delete()
            .eq("driver_id", linkedId)
            .in("restaurant_id", toRemove);
        }
      }
    }
  } else {
    const { data: dup } = await matchExisting();
    if (dup) {
      events.push({
        at: nowIso(),
        kind: "skipped",
        ...who,
        detail: "Duplicate employee ID (skip)",
      });
      return {
        events,
        applied: 0,
        approved: 0,
        failure: { rowIndex: row.rowIndex, reason: "Duplicate employee ID (skip)" },
      };
    }
  }

  if (!intakeId) {
    const { data: code, error: codeErr } = await ctx.supabase.rpc("allocate_driver_code");
    if (codeErr || !code) return fail("Could not allocate driver code");

    const newId = crypto.randomUUID();
    const mappedCustom = row.custom_fields ?? {};
    const defsForRow = ctx.customFieldDefs.map((d) => ({
      ...d,
      required: d.required && Object.prototype.hasOwnProperty.call(mappedCustom, d.key),
    }));
    const { values: customValues, errors: customErrors } = validateCustomFieldValues(
      defsForRow,
      mappedCustom,
    );
    if (customErrors.length > 0) {
      return fail(`custom_fields: ${customErrors.map((e) => e.key).join(",")}`);
    }
    const { error: insErr } = await ctx.supabase.from("driver_intakes").insert({
      id: newId,
      phone,
      full_name: row.full_name!.trim(),
      civil_id: civilId,
      employee_id: employeeId,
      driver_code: code,
      partner_id: row.partner_id,
      zone_id: row.zone_id,
      vehicle_id: row.vehicle_id,
      nationality: row.nationality,
      rider_category: row.rider_category,
      client_id: row.client_id,
      client_name: row.client_name,
      status: "awaiting_app_link",
      workflow_status: "pending",
      linked: false,
      assets_issued: {},
      custom_fields: customValues as unknown as import("@/types/database").Json,
    });

    if (insErr) return fail(insErr.message);
    intakeId = newId;
    driverCode = String(code);
  }

  if (row.restaurant_ids.length > 0) {
    const { error: linkErr } = await ctx.supabase.from("driver_intake_restaurants").insert(
      row.restaurant_ids.map((restaurant_id) => ({
        intake_id: intakeId!,
        restaurant_id,
      })),
    );
    if (linkErr) return fail(linkErr.message);
  }

  events.push({
    at: nowIso(),
    kind: updated ? "updated" : "created",
    ...who,
    driverCode: driverCode ?? undefined,
  });

  if (intakeId) {
    void logDriverChange({
      intakeId,
      source: "bulk_import",
      before: beforeSnap,
      after: flattenProfileSnapshot({
        full_name: row.full_name,
        phone,
        civil_id: civilId,
        employee_id: employeeId,
        driver_code: driverCode,
        partner: row.partner_name,
        zone: row.zone_name,
        restaurants: row.restaurant_names,
        vehicle: row.vehicle_label,
        nationality: row.nationality,
        rider_category: row.rider_category,
        client_id: row.client_id,
        client_name: row.client_name,
        custom_fields: row.custom_fields ?? {},
      }),
      context: ctx.fileName ? { file: ctx.fileName } : {},
    });
  }

  let approved: 0 | 1 = 0;
  let credential: DriverImportCredential | undefined;
  const approveRow = row.active ?? ctx.approveImmediately;
  if (approveRow && intakeId) {
    const result = await approveDriverIntake(intakeId);
    if ("success" in result && result.success) {
      approved = 1;
      events.push({
        at: nowIso(),
        kind: "approved",
        ...who,
        driverCode: driverCode ?? undefined,
        detail: "passcode minted",
      });
      credential = {
        rowIndex: row.rowIndex,
        full_name: row.full_name!.trim(),
        employee_id: employeeId,
        driver_code: driverCode ?? "",
        passcode: result.passcode,
        phone,
        civil_id: civilId,
        partner_name: row.partner_name,
        zone_name: row.zone_name,
        vehicle_label: row.vehicle_label,
        restaurant_names: row.restaurant_names,
        nationality: row.nationality,
        rider_category: row.rider_category,
        client_id: row.client_id,
        client_name: row.client_name,
        custom_fields: row.custom_fields ?? {},
      };
    } else {
      return {
        events: [
          ...events,
          {
            at: nowIso(),
            kind: "failed",
            ...who,
            detail: `Approved intake failed: ${"error" in result ? result.error : "save_failed"}`,
          },
        ],
        applied: 1,
        approved: 0,
        failure: {
          rowIndex: row.rowIndex,
          reason: `Approved intake failed: ${"error" in result ? result.error : "save_failed"}`,
        },
        credential,
      };
    }
  }

  return { events, applied: 1, approved, credential };
}

export async function applyDriverImportChunk(payload: {
  fileName: string;
  mapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
  batchId?: string | null;
  sheetRowCount: number;
  preSkipped: number;
  appliedSoFar: number;
  skippedSoFar: number;
  approvedSoFar: number;
  isLast: boolean;
}): Promise<
  | {
      success: true;
      batchId: string;
      events: DriverImportLogEvent[];
      applied: number;
      skipped: number;
      approved: number;
      failures: Array<{ rowIndex: number; reason: string }>;
      credentials: DriverImportCredential[];
    }
  | { error: string }
> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  const ready = payload.rows.filter((r) =>
    isImportRowReady(r, payload.duplicateStrategy),
  );
  const supabase = await createClient();
  let batchId = payload.batchId ?? null;

  if (!batchId) {
    const { data: batch, error: batchError } = await supabase
      .from("driver_import_batches")
      .insert({
        file_name: payload.fileName,
        mapping: payload.mapping,
        row_count: payload.sheetRowCount,
        applied_count: 0,
        skipped_count: payload.preSkipped,
        approved_count: 0,
        status: "previewed",
        uploaded_by: auth.session.id,
      })
      .select("id")
      .single();
    if (batchError || !batch) return { error: "save_failed" };
    batchId = batch.id;
  }

  const customFieldDefs = await listCustomFieldDefinitions("driver");
  const events: DriverImportLogEvent[] = [];
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  const credentials: DriverImportCredential[] = [];
  let applied = 0;
  let approved = 0;
  let skipped = 0;

  for (const row of ready) {
    const result = await applyOneImportRow(row, {
      supabase,
      duplicateStrategy: payload.duplicateStrategy,
      approveImmediately: payload.approveImmediately,
      customFieldDefs,
      fileName: payload.fileName,
    });
    events.push(...result.events);
    applied += result.applied;
    approved += result.approved;
    if (result.credential) credentials.push(result.credential);
    if (result.failure) {
      failures.push(result.failure);
      if (result.applied === 0) skipped += 1;
    }
  }

  const appliedTotal = payload.appliedSoFar + applied;
  const skippedTotal = payload.skippedSoFar + skipped;
  const approvedTotal = payload.approvedSoFar + approved;
  await supabase
    .from("driver_import_batches")
    .update({
      applied_count: appliedTotal,
      skipped_count: skippedTotal,
      approved_count: approvedTotal,
      ...(payload.isLast
        ? { status: appliedTotal > 0 ? "applied" : "failed" }
        : {}),
    })
    .eq("id", batchId);

  if (payload.isLast) {
    void logAdminMutation({
      action: "create",
      entityType: "driver_import_batch",
      entityId: batchId,
      routeName: "applyDriverImportChunk",
      after: {
        applied: appliedTotal,
        approved: approvedTotal,
        skipped: skippedTotal,
        failures: failures.length,
        credentials: credentials.length,
      },
    });
  }

  return {
    success: true,
    batchId,
    events,
    applied,
    skipped,
    approved,
    failures,
    credentials,
  };
}

export async function applyDriverImportBatch(payload: {
  fileName: string;
  mapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
}): Promise<
  | {
      success: true;
      batchId: string;
      applied: number;
      skipped: number;
      approved: number;
      failures: Array<{ rowIndex: number; reason: string }>;
      credentials: DriverImportCredential[];
    }
  | { error: string }
> {
  const ready = payload.rows.filter((r) =>
    isImportRowReady(r, payload.duplicateStrategy),
  );
  const preSkipped = payload.rows.length - ready.length;
  const result = await applyDriverImportChunk({
    fileName: payload.fileName,
    mapping: payload.mapping,
    rows: ready,
    duplicateStrategy: payload.duplicateStrategy,
    approveImmediately: payload.approveImmediately,
    sheetRowCount: payload.rows.length,
    preSkipped,
    appliedSoFar: 0,
    skippedSoFar: preSkipped,
    approvedSoFar: 0,
    isLast: true,
  });
  if ("error" in result) return result;
  return {
    success: true,
    batchId: result.batchId,
    applied: result.applied,
    skipped: preSkipped + result.skipped,
    approved: result.approved,
    failures: result.failures,
    credentials: result.credentials,
  };
}

