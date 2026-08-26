"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";
import { isValidEmployeeId, normalizeEmployeeId } from "./driver-errors";
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

const IMPORT_CHUNK = 200;

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

  const { data: hasActiveRestaurant, error: restaurantCheckError } = await supabase.rpc(
    "intake_has_active_restaurant",
    { p_intake_id: intakeId },
  );
  if (restaurantCheckError || !hasActiveRestaurant) {
    return { error: "missing_active_restaurant" };
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
    if (err === "driver_missing_active_restaurant") {
      return { error: "missing_active_restaurant" };
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

  const phoneSet = new Set<string>();
  const civilSet = new Set<string>();
  const empSet = new Set<string>();
  for (const intake of intakes ?? []) {
    if (intake.phone) phoneSet.add(intake.phone);
    if (intake.civil_id) civilSet.add(intake.civil_id);
    if (intake.employee_id) empSet.add(intake.employee_id);
  }
  for (const driver of drivers ?? []) {
    if (driver.civil_id) civilSet.add(driver.civil_id);
    if (driver.employee_id) empSet.add(driver.employee_id);
  }
  for (const profile of profiles ?? []) {
    if (profile.phone) phoneSet.add(profile.phone);
  }

  const seenPhone = new Set<string>();
  const seenCivil = new Set<string>();
  const seenEmp = new Set<string>();

  return rows.map((row) => {
    let status: DriverImportPreviewStatus = "ok";
    let partner_id: string | null = null;
    let zone_id: string | null = null;
    let vehicle_id: string | null = null;
    let restaurant_ids: string[] = [];
    let restaurant_names: string[] = [];
    let nationality: string | null = null;
    let rider_category: DriverRiderCategory = "in_house";
    let client_id: string | null = null;
    let client_name: string | null = null;
    let active: boolean | null = null;

    const name = row.full_name?.trim();
    const phoneNorm = row.phone ? normalizeKuwaitPhone(row.phone) : null;
    const civilNorm = row.civil_id ? normalizeCivilId(row.civil_id) : null;
    const empNorm = row.employee_id ? normalizeEmployeeId(row.employee_id) : null;

    // Phone and civil ID are optional columns: a blank cell is a driver we do
    // not have those details for, not a broken row. A cell with something in it
    // still has to parse, or the sheet would silently drop a typo'd number.
    if (!name || !row.employee_id?.trim()) {
      status = "missing_fields";
    } else if (row.phone?.trim() && !phoneNorm) {
      status = "invalid_phone";
    } else if (row.civil_id?.trim() && !civilNorm) {
      status = "invalid_civil_id";
    } else if (!empNorm || !isValidEmployeeId(empNorm)) {
      status = "invalid_employee_id";
    }

    if (status === "ok" && phoneNorm) {
      if (phoneSet.has(phoneNorm) || seenPhone.has(phoneNorm)) {
        status = "duplicate_phone";
      } else seenPhone.add(phoneNorm);
    }

    if (status === "ok" && civilNorm) {
      if (civilSet.has(civilNorm) || seenCivil.has(civilNorm)) {
        status = "duplicate_civil_id";
      } else seenCivil.add(civilNorm);
    }

    if (status === "ok" && empNorm) {
      if (empSet.has(empNorm) || seenEmp.has(empNorm)) {
        status = "duplicate_employee_id";
      } else seenEmp.add(empNorm);
    }

    if (status === "ok" && row.partner_id?.trim()) {
      const hit = resolvePartnerToken(row.partner_id, partnerIndex);
      if (hit.status === "ok") partner_id = hit.id;
      else if (hit.status === "ambiguous") status = "ambiguous_partner";
      else status = "unmatched_partner";
    }

    if (status === "ok" && row.zone_id?.trim()) {
      const hit = resolveZoneToken(row.zone_id, zoneIndex);
      if (hit.status === "ok") zone_id = hit.id;
      else if (hit.status === "ambiguous") status = "ambiguous_zone";
      else status = "unmatched_zone";
    }

    if (status === "ok" && row.vehicle_label?.trim()) {
      const vlabel = row.vehicle_label.trim().toLowerCase();
      vehicle_id = vehicleByLabel.get(vlabel) ?? null;
      if (!vehicle_id) status = "unmatched_vehicle";
    }

    if (status === "ok") {
      const restaurantsHit = resolveRestaurantTokens(row.restaurant_ids, restaurantIndex);
      if (restaurantsHit.status === "ok") {
        restaurant_ids = restaurantsHit.ids;
        restaurant_names = restaurantsHit.names;
      } else if (restaurantsHit.status === "empty") {
        status = "missing_fields";
      } else if (restaurantsHit.status === "ambiguous") {
        status = "ambiguous_restaurant";
      } else {
        status = "unmatched_restaurant";
      }
    }

    if (status === "ok" && row.nationality?.trim()) {
      nationality = resolveCountryInput(row.nationality);
      if (!nationality) status = "invalid_nationality";
    }

    if (status === "ok") {
      const parsedCategory = parseRiderCategory(row.rider_category);
      if (parsedCategory === "invalid") status = "invalid_rider_category";
      else rider_category = parsedCategory ?? "in_house";
    }

    // Free text, so the only way a cell can be wrong is by being longer than
    // the column. Caught here rather than at insert time, where it would abort
    // the batch with a CHECK violation naming a constraint, not a row.
    if (status === "ok") {
      client_id = normalizeClientValue(row.client_id);
      if (clientValueTooLong(client_id, CLIENT_ID_MAX_LENGTH)) {
        status = "invalid_client_id";
      }
    }

    if (status === "ok") {
      client_name = normalizeClientValue(row.client_name);
      if (clientValueTooLong(client_name, CLIENT_NAME_MAX_LENGTH)) {
        status = "invalid_client_name";
      }
    }

    if (status === "ok") {
      const parsedActive = parseImportActive(row.active);
      if (parsedActive === "invalid") status = "invalid_active";
      else active = parsedActive;
    }

    return {
      ...row,
      status,
      partner_id,
      zone_id,
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
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  const ready = payload.rows.filter((r) => r.status === "ok" && !r.skip);
  const preSkipped = payload.rows.length - ready.length;

  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from("driver_import_batches")
    .insert({
      file_name: payload.fileName,
      mapping: payload.mapping,
      row_count: payload.rows.length,
      applied_count: 0,
      skipped_count: preSkipped,
      approved_count: 0,
      status: "applied",
      uploaded_by: auth.session.id,
    })
    .select("id")
    .single();

  if (batchError || !batch) return { error: "save_failed" };

  let applied = 0;
  let approved = 0;
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  const credentials: DriverImportCredential[] = [];
  const customFieldDefs = await listCustomFieldDefinitions("driver");

  for (let i = 0; i < ready.length; i += IMPORT_CHUNK) {
    const chunk = ready.slice(i, i + IMPORT_CHUNK);
    for (const row of chunk) {
      const phone = row.phone?.trim() ? normalizeKuwaitPhone(row.phone) : null;
      const civilId = row.civil_id?.trim() ? normalizeCivilId(row.civil_id) : null;
      const employeeId = normalizeEmployeeId(row.employee_id!);
      if (!employeeId) {
        failures.push({ rowIndex: row.rowIndex, reason: "missing_fields" });
        continue;
      }
      if (row.restaurant_ids.length === 0) {
        failures.push({ rowIndex: row.rowIndex, reason: "missing_active_restaurant" });
        continue;
      }

      let intakeId: string | null = null;
      let driverCode: string | null = null;

      // Phone used to be the key that matched an uploaded row to an existing
      // intake. It is optional now, so a phone-less row falls back to employee
      // ID — mandatory and unique, and therefore the stronger key of the two.
      // Phone still wins when present, so rows that matched before still match.
      const matchExisting = () => {
        const query = supabase
          .from("driver_intakes")
          .select("id, linked, driver_code")
          .is("archived_at", null);
        return phone
          ? query.eq("phone", phone).maybeSingle()
          : query.eq("employee_id", employeeId).maybeSingle();
      };

      if (payload.duplicateStrategy === "update") {
        const { data: existing } = await matchExisting();

        if (existing) {
          if (existing.linked) {
            failures.push({
              rowIndex: row.rowIndex,
              reason: "Intake already linked (cannot update)",
            });
            continue;
          }
          const { error: updErr } = await supabase
            .from("driver_intakes")
            .update({
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
              workflow_status: "pending",
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          if (updErr) {
            failures.push({
              rowIndex: row.rowIndex,
              reason: updErr.message,
            });
            continue;
          }
          intakeId = existing.id;
          driverCode = existing.driver_code;
          await supabase
            .from("driver_intake_restaurants")
            .delete()
            .eq("intake_id", intakeId);
        }
      } else {
        const { data: dup } = await matchExisting();
        if (dup) {
          failures.push({
            rowIndex: row.rowIndex,
            reason: phone ? "Duplicate phone (skip)" : "Duplicate employee ID (skip)",
          });
          continue;
        }
      }

      if (!intakeId) {
        const { data: code, error: codeErr } = await supabase.rpc("allocate_driver_code");
        if (codeErr || !code) {
          failures.push({ rowIndex: row.rowIndex, reason: "Could not allocate driver code" });
          continue;
        }

        const newId = crypto.randomUUID();
        const mappedCustom = row.custom_fields ?? {};
        // Import: only validate keys present in the mapping; do not fail on unmapped required defs
        const defsForRow = customFieldDefs.map((d) => ({
          ...d,
          required:
            d.required && Object.prototype.hasOwnProperty.call(mappedCustom, d.key),
        }));
        const { values: customValues, errors: customErrors } = validateCustomFieldValues(
          defsForRow,
          mappedCustom,
        );
        if (customErrors.length > 0) {
          failures.push({
            rowIndex: row.rowIndex,
            reason: `custom_fields: ${customErrors.map((e) => e.key).join(",")}`,
          });
          continue;
        }
        const { error: insErr } = await supabase.from("driver_intakes").insert({
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

        if (insErr) {
          failures.push({ rowIndex: row.rowIndex, reason: insErr.message });
          continue;
        }
        intakeId = newId;
        driverCode = String(code);
      }

      if (row.restaurant_ids.length > 0) {
        const { error: linkErr } = await supabase.from("driver_intake_restaurants").insert(
          row.restaurant_ids.map((restaurant_id) => ({
            intake_id: intakeId!,
            restaurant_id,
          })),
        );
        if (linkErr) {
          failures.push({ rowIndex: row.rowIndex, reason: linkErr.message });
          continue;
        }
      }

      applied += 1;

      // The sheet's Active cell decides for its own row; the dialog toggle is
      // the answer for every row that did not say. So an operator can approve
      // the whole batch with the switch, or hand-pick rows in the spreadsheet,
      // and neither can quietly cancel the other.
      const approveRow = row.active ?? payload.approveImmediately;
      if (approveRow && intakeId) {
        const result = await approveDriverIntake(intakeId);
        if ("success" in result && result.success) {
          approved += 1;
          credentials.push({
            rowIndex: row.rowIndex,
            employee_id: employeeId,
            driver_code: driverCode ?? "",
            passcode: result.passcode,
          });
        } else {
          failures.push({
            rowIndex: row.rowIndex,
            reason: `Approved intake failed: ${"error" in result ? result.error : "save_failed"}`,
          });
        }
      }
    }
  }

  await supabase
    .from("driver_import_batches")
    .update({
      applied_count: applied,
      skipped_count: preSkipped + (ready.length - applied),
      approved_count: approved,
    })
    .eq("id", batch.id);

  void logAdminMutation({
    action: "create",
    entityType: "driver_import_batch",
    entityId: batch.id,
    routeName: "applyDriverImportBatch",
    after: { applied, approved, failures: failures.length, credentials: credentials.length },
  });

  return {
    success: true,
    batchId: batch.id,
    applied,
    skipped: preSkipped + (ready.length - applied),
    approved,
    failures,
    credentials,
  };
}
