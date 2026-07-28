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
  DriverImportMappedRow,
  DriverImportPreviewRow,
  DriverImportPreviewStatus,
} from "./types";

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

  const { data: authUser, error: createError } = await admin.auth.admin.createUser({
    phone: intake.phone,
    email,
    phone_confirm: true,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function parseCommaSeparatedIds(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export async function resolveDriverImportPreview(
  rows: DriverImportMappedRow[],
): Promise<DriverImportPreviewRow[] | { error: "not_authorized" }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  const supabase = await createClient();

  const [{ data: partners }, { data: zones }, { data: vehicles }, { data: restaurants }, { data: intakes }] =
    await Promise.all([
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
    ]);

  const partnerById = new Map<string, string>();
  for (const p of partners ?? []) {
    partnerById.set(p.id, p.id);
  }

  const zoneById = new Map<string, string>();
  for (const z of zones ?? []) {
    zoneById.set(z.id, z.id);
  }

  const vehicleByLabel = new Map<string, string>();
  for (const v of vehicles ?? []) {
    const bike = v.bike_id?.trim().toLowerCase() ?? "";
    if (bike) vehicleByLabel.set(bike, v.id);
    const reg = v.reg_number?.trim().toLowerCase() ?? "";
    if (reg) vehicleByLabel.set(reg, v.id);
    if (bike && reg) vehicleByLabel.set(`${bike} · ${reg}`, v.id);
  }

  const restaurantById = new Map<string, { id: string; name: string }>();
  const restaurantByCode = new Map<string, { id: string; name: string }>();
  for (const r of restaurants ?? []) {
    const entry = { id: r.id, name: r.name };
    restaurantById.set(r.id, entry);
    if (r.restaurant_code) {
      restaurantByCode.set(r.restaurant_code.trim().toUpperCase(), entry);
    }
  }

  const phoneSet = new Set((intakes ?? []).map((i) => i.phone));
  const civilSet = new Set((intakes ?? []).map((i) => i.civil_id));
  const empSet = new Set((intakes ?? []).map((i) => i.employee_id));

  const seenPhone = new Set<string>();
  const seenCivil = new Set<string>();
  const seenEmp = new Set<string>();

  return rows.map((row) => {
    let status: DriverImportPreviewStatus = "ok";
    let partner_id: string | null = null;
    let zone_id: string | null = null;
    let vehicle_id: string | null = null;
    const restaurant_ids: string[] = [];
    const restaurant_names: string[] = [];

    const name = row.full_name?.trim();
    const phoneNorm = row.phone ? normalizeKuwaitPhone(row.phone) : null;
    const civilNorm = row.civil_id ? normalizeCivilId(row.civil_id) : null;
    const empNorm = row.employee_id ? normalizeEmployeeId(row.employee_id) : null;

    if (!name || !phoneNorm || !civilNorm || !empNorm) {
      status = "missing_fields";
    } else if (!isValidEmployeeId(empNorm)) {
      status = "invalid_employee_id";
    }

    if (status === "ok" && row.phone && !phoneNorm) status = "invalid_phone";
    if (status === "ok" && row.civil_id && !civilNorm) status = "invalid_civil_id";

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
      const token = row.partner_id.trim();
      if (!isUuid(token) || !partnerById.has(token)) {
        status = "unmatched_partner";
      } else {
        partner_id = token;
      }
    }

    if (status === "ok" && row.zone_id?.trim()) {
      const token = row.zone_id.trim();
      if (!isUuid(token) || !zoneById.has(token)) {
        status = "unmatched_zone";
      } else {
        zone_id = token;
      }
    }

    if (status === "ok" && row.vehicle_label?.trim()) {
      const vlabel = row.vehicle_label.trim().toLowerCase();
      vehicle_id = vehicleByLabel.get(vlabel) ?? null;
      if (!vehicle_id) status = "unmatched_vehicle";
    }

    if (status === "ok") {
      const tokens = parseCommaSeparatedIds(row.restaurant_ids);
      if (tokens.length === 0) {
        status = "unmatched_restaurant";
      } else {
        for (const token of tokens) {
          const hit = isUuid(token)
            ? restaurantById.get(token)
            : restaurantByCode.get(token.toUpperCase());
          if (!hit) {
            status = "unmatched_restaurant";
            break;
          }
          if (!restaurant_ids.includes(hit.id)) {
            restaurant_ids.push(hit.id);
            restaurant_names.push(hit.name);
          }
        }
      }
    }

    return {
      ...row,
      status,
      partner_id,
      zone_id,
      vehicle_id,
      restaurant_ids,
      restaurant_names,
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

  for (let i = 0; i < ready.length; i += IMPORT_CHUNK) {
    const chunk = ready.slice(i, i + IMPORT_CHUNK);
    for (const row of chunk) {
      const phone = normalizeKuwaitPhone(row.phone!);
      const civilId = normalizeCivilId(row.civil_id!);
      const employeeId = normalizeEmployeeId(row.employee_id!);
      if (!phone || !civilId || !employeeId) {
        failures.push({ rowIndex: row.rowIndex, reason: "missing_fields" });
        continue;
      }
      if (row.restaurant_ids.length === 0) {
        failures.push({ rowIndex: row.rowIndex, reason: "missing_active_restaurant" });
        continue;
      }

      let intakeId: string | null = null;

      if (payload.duplicateStrategy === "update") {
        const { data: existing } = await supabase
          .from("driver_intakes")
          .select("id, linked")
          .eq("phone", phone)
          .is("archived_at", null)
          .maybeSingle();

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
          await supabase
            .from("driver_intake_restaurants")
            .delete()
            .eq("intake_id", intakeId);
        }
      } else {
        const { data: dup } = await supabase
          .from("driver_intakes")
          .select("id")
          .eq("phone", phone)
          .is("archived_at", null)
          .maybeSingle();
        if (dup) {
          failures.push({ rowIndex: row.rowIndex, reason: "Duplicate phone (skip)" });
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
          status: "awaiting_app_link",
          workflow_status: "pending",
          linked: false,
          assets_issued: {},
        });

        if (insErr) {
          failures.push({ rowIndex: row.rowIndex, reason: insErr.message });
          continue;
        }
        intakeId = newId;
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

      if (payload.approveImmediately && intakeId) {
        const result = await approveDriverIntake(intakeId);
        if ("error" in result && result.error) {
          failures.push({
            rowIndex: row.rowIndex,
            reason: `Approved intake failed: ${result.error}`,
          });
        } else {
          approved += 1;
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
    after: { applied, approved, failures: failures.length },
  });

  return {
    success: true,
    batchId: batch.id,
    applied,
    skipped: preSkipped + (ready.length - applied),
    approved,
    failures,
  };
}
