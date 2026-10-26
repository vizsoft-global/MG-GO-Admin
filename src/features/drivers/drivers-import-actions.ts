"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";
import { employeeIdKey, normalizeEmployeeId } from "./driver-errors";
import {
  canContinueImportLookups,
  clientIdKey,
  evaluateImportIdentity,
  isImportRowReady,
  shouldApproveImportRow,
  type ImportIdentityRoster,
  type ImportIdentitySeen,
} from "./import/import-identity";
import { getFirebaseAuth } from "@/lib/firebase/admin";
import type { Auth } from "firebase-admin/auth";
import type { Json } from "@/types/database";
import { civilIdExists, staffClient, type StaffClient } from "./driver-uniqueness";
import { intakeMissingApprovalFields } from "./driver-approve-validation";
import type {
  DriverImportCredential,
  DriverImportMappedRow,
  DriverImportPreviewRow,
  DriverImportPreviewStatus,
  DriverRiderCategory,
} from "./types";
import { listCustomFieldDefinitions } from "@/features/custom-fields/custom-fields-actions";
import { listEmployeeCatalog } from "@/features/employees/employee-catalogs-actions";
import { validateCustomFieldValues } from "@/lib/custom-fields/validate";
import { resolveCountryInput } from "@/lib/geo/countries";
import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  clientValueTooLong,
  normalizeClientValue,
} from "./driver-client-fields";
import { requiresOpsAssignment } from "./driver-assignment";
import {
  flattenProfileSnapshot,
  loadIntakeProfileSnapshot,
  logDriverChange,
} from "./driver-change-log";
import type { DriverImportLogEvent } from "./import/import-progress";
import {
  importOffNeedsApprovedDriver,
  kuwaitCalendarMonthDays,
  offDaysForRpc,
  parseImportOffDays,
} from "./import/import-off-days";
import {
  isClearToken,
  isValidImportIban,
  isValidImportPassport,
  normalizeImportAccountNumber,
  normalizeImportIban,
  normalizeImportPassport,
  parseImportActive,
  parseImportDate,
  parseImportVehicleType,
  parseImportYesNo,
  parseRiderCategory,
} from "./import/parse";
import { isDriverProjectKey, type DriverProjectKey } from "@/features/fleet/fleet-labels";
import { isPaymentCurrency } from "@/lib/currencies";
import {
  isHiringType,
  isJobEndDescription,
  isJobPosition,
  normalizeMoney,
} from "./driver-private-fields";
import {
  DRIVER_IMPORT_EXPIRY_FIELDS,
  type DriverImportExpiryField,
} from "./types";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import {
  companyMatchesCategory,
  resolveCompanyInput,
  type SourceCompany,
} from "./source-companies";
import { buildImportWritePatch, importRowMissingAssignment, writesCell } from "./import/driver-import-patch";
import {
  readImportSnapshot,
  syncImportAssets,
  syncImportExpiries,
  syncImportRestaurants,
} from "./import/driver-import-write";
import type { DriverImportJournal } from "./import/driver-import-stack";
import { clearRedo } from "./import/driver-import-stack";
import {
  buildEmployeeCatalogIndex,
  buildPartnerIndex,
  buildRestaurantIndex,
  buildZoneIndex,
  resolveEmployeeCatalogToken,
  resolveEmployeeCatalogTokens,
  resolvePartnerToken,
  resolveRestaurantTokens,
  resolveZoneToken,
} from "./import/resolve-lookups";
import type { DriverImportLookups } from "./import/lookups";


export async function requireDriversManager(verb: "create" | "edit" | "delete" = "edit") {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, `drivers.${verb}` as Permission, session.isSuperAdmin)
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
  const db = await staffClient();

  const [{ data: restaurants }, { data: partners }, { data: zones }] = await Promise.all([
    db
      .from("restaurants")
      .select("id, name, restaurant_code, partner_id, zone_id, status, is_active")
      .order("name"),
    db.from("partners").select("id, name").order("name"),
    db.from("zones").select("id, name, code").order("name"),
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
  | { success: true; driverId: string; passcode: string; createdAuthUserId: string | null }
  | { error: string };

function syntheticDriverEmail(driverCode: string): string {
  return `${driverCode.trim().toLowerCase()}@driver.dpd.local`;
}

function authErrorCode(error: unknown): string {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code: unknown }).code).toLowerCase();
  }
  return "";
}

/**
 * The login an approval runs on.
 *
 * `admin_approve_driver` re-adopts a live driver row when the intake is the same
 * rider, and in that case the id it returns is the *existing* driver — so a login
 * this call minted would be an orphan holding the rider's phone number, and the
 * next attempt would fail on that number instead of finishing the approval. A
 * retried approval can also find the synthetic address already taken by the
 * previous attempt, which must be reused rather than reported as a phone clash.
 */
async function resolveDriverAuthUser(
  authAdmin: Auth,
  email: string,
  displayName: string,
  phone: string | undefined,
): Promise<{ userId: string; created: boolean } | null> {
  const existing = await authAdmin.getUserByEmail(email).catch(() => null);
  if (existing) return { userId: existing.uid, created: false };

  try {
    const user = await authAdmin.createUser({
      email,
      emailVerified: true,
      displayName,
      ...(phone ? { phoneNumber: phone } : {}),
    });
    return { userId: user.uid, created: true };
  } catch (error) {
    const code = authErrorCode(error);
    if (code.includes("email-already-exists")) {
      const raced = await authAdmin.getUserByEmail(email).catch(() => null);
      return raced ? { userId: raced.uid, created: false } : null;
    }
    if (!code.includes("phone")) return null;
  }

  // The number is already on another login. The profile still carries it, so the
  // address alone is enough to finish the approval.
  try {
    const user = await authAdmin.createUser({ email, emailVerified: true, displayName });
    return { userId: user.uid, created: true };
  } catch (error) {
    if (!authErrorCode(error).includes("email-already-exists")) return null;
    const raced = await authAdmin.getUserByEmail(email).catch(() => null);
    return raced ? { userId: raced.uid, created: false } : null;
  }
}

export async function approveDriverIntake(
  intakeId: string,
): Promise<ApproveDriverResult> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("create");
  if (auth.error) return { error: auth.error };
  if (!intakeId) return { error: "missing_fields" };

  const db = await staffClient();
  const { data: intake, error: loadError } = await db
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

  const { data: hasAssignment, error: assignmentCheckError } = await db.rpc(
    "intake_has_ops_assignment",
    { p_intake_id: intakeId },
  );
  if (assignmentCheckError || !hasAssignment) {
    return { error: "missing_assignment" };
  }

  const civilIdNormalized = normalizeCivilId(intake.civil_id ?? "");
  if (civilIdNormalized && (await civilIdExists(civilIdNormalized, intakeId, intake.employee_id))) {
    return { error: "civil_id_exists" };
  }

  const email = syntheticDriverEmail(intake.driver_code);
  const authAdmin = await getFirebaseAuth();
  if (!authAdmin) return { error: "save_failed" };

  const intakePhone = intake.phone?.trim() ? intake.phone.trim() : undefined;
  const resolved = await resolveDriverAuthUser(authAdmin, email, intake.full_name, intakePhone);
  if (!resolved) return { error: "save_failed" };
  const { userId, created: createdAuthUser } = resolved;

  const { data: rpcRaw, error: rpcError } = await db.rpc("admin_approve_driver", {
    p_intake_id: intakeId,
    p_user_id: userId,
    p_email: email,
  });

  if (rpcError) {
    if (createdAuthUser) {
      try {
        await authAdmin.deleteUser(userId);
      } catch {
        /* rollback */
      }
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
    if (createdAuthUser) {
      try {
        await authAdmin.deleteUser(userId);
      } catch {
        /* rollback */
      }
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

  if (createdAuthUser && payload.driver_id && payload.driver_id !== userId) {
    // The intake was re-adopted onto a driver that already existed, so the login
    // minted here belongs to nobody and would hold the rider's number hostage.
    try {
      await authAdmin.deleteUser(userId);
    } catch {
      /* orphan login */
    }
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

  const adoptedExisting = Boolean(
    createdAuthUser && payload.driver_id && payload.driver_id !== userId,
  );
  return {
    success: true,
    driverId: payload.driver_id ?? userId,
    passcode: payload.app_passcode ?? "",
    createdAuthUserId: createdAuthUser && !adoptedExisting ? userId : null,
  };
}

export async function resolveDriverImportPreview(
  rows: DriverImportMappedRow[],
): Promise<DriverImportPreviewRow[] | { error: "not_authorized" }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  const db = await staffClient();
  // The catalogue answers which sections need no zone or restaurant, so the
  // sheet gate uses the same answer the employee form does.
  const sections = await listEmployeeCatalog("employee_sections");

  const [
    { data: partners },
    { data: zones },
    { data: vehicles },
    { data: restaurants },
    { data: intakes },
    { data: drivers },
    { data: profiles },
    { data: companyRows },
    { data: statusRows },
    { data: sectionRows },
    { data: nationalityCategoryRows },
    { data: bankRows },
    { data: sponsorshipRows },
    { data: assetRows },
  ] = await Promise.all([
    db.from("partners").select("id, name"),
    db.from("zones").select("id, name, code"),
    db.from("vehicles").select("id, bike_id, reg_number, vehicle_type_key"),
    db
      .from("restaurants")
      .select("id, name, restaurant_code, partner_id, status, is_active")
      .eq("status", "published")
      .eq("is_active", true),
    db
      .from("driver_intakes")
      .select("id, phone, civil_id, employee_id, client_id, linked_profile_id")
      .is("archived_at", null),
    db.from("drivers").select("id, employee_id, civil_id, client_id").is("archived_at", null),
    db.from("profiles").select("id, phone").eq("role", "rider"),
    db
      .from("source_companies")
      .select(
        "key, name, client_code, is_active, is_system, sort_order, dpd_target, incentive_enabled, incentive_above_kwd, incentive_below_kwd, effective_from",
      ),
    db.from("employee_statuses").select("key, label_en, label_ar, is_active"),
    db.from("employee_sections").select("key, label_en, label_ar, is_active"),
    db.from("nationality_categories").select("key, label_en, label_ar, is_active"),
    db.from("bank_codes").select("key, label_en, label_ar, is_active"),
    db.from("sponsorships").select("key, label_en, label_ar, is_active"),
    db.from("asset_catalog").select("id, name, code, is_active"),
  ]);
  const companies: SourceCompany[] = companyRows ?? [];
  const catalog = (rows: Array<{ key: string; label_en: string; label_ar: string }> | null) =>
    (rows ?? []).map((row) => ({
      key: row.key,
      name: row.label_en,
      name_ar: row.label_ar,
    }));
  const statusIndex = buildEmployeeCatalogIndex(catalog(statusRows));
  const sectionIndex = buildEmployeeCatalogIndex(catalog(sectionRows));
  const nationalityCategoryIndex = buildEmployeeCatalogIndex(catalog(nationalityCategoryRows));
  const bankIndex = buildEmployeeCatalogIndex(catalog(bankRows));
  const sponsorshipIndex = buildEmployeeCatalogIndex(catalog(sponsorshipRows));
  const assetIndex = buildEmployeeCatalogIndex(
    (assetRows ?? [])
      .filter((row) => row.is_active !== false)
      .map((row) => ({
        key: row.id,
        name: row.name ?? row.code ?? row.id,
        name_ar: row.code,
      })),
  );

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

  const vehicleByLabel = new Map<
    string,
    { id: string; typeKey: "bike" | "car" | null }
  >();
  for (const v of vehicles ?? []) {
    const entry = { id: v.id, typeKey: parseImportVehicleType(v.vehicle_type_key) };
    const bike = v.bike_id?.trim().toLowerCase() ?? "";
    if (bike) vehicleByLabel.set(bike, entry);
    const reg = v.reg_number?.trim().toLowerCase() ?? "";
    if (reg) vehicleByLabel.set(reg, entry);
    if (bike && reg) vehicleByLabel.set(`${bike} · ${reg}`, entry);
  }

  const roster: ImportIdentityRoster = {
    employeeIds: new Set(),
    phoneToEmployee: new Map(),
    civilToEmployee: new Map(),
    clientIdToEmployees: new Map(),
    employeeIdByKey: new Map(),
  };
  const rememberClient = (raw: string | null | undefined, empKey: string, rawEmp: string) => {
    const key = clientIdKey(raw);
    if (!key) return;
    const set = roster.clientIdToEmployees.get(key) ?? new Set<string>();
    set.add(empKey);
    roster.clientIdToEmployees.set(key, set);
    if (!roster.employeeIdByKey.has(empKey)) roster.employeeIdByKey.set(empKey, rawEmp);
  };
  const peopleByEmployee = new Map<string, Set<string>>();
  const rememberPerson = (raw: string | null | undefined, person: string) => {
    if (!raw) return;
    const key = employeeIdKey(raw);
    const set = peopleByEmployee.get(key) ?? new Set<string>();
    set.add(person);
    peopleByEmployee.set(key, set);
  };
  const driverEmpById = new Map<string, string>();
  for (const driver of drivers ?? []) {
    if (!driver.employee_id) continue;
    const key = employeeIdKey(driver.employee_id);
    roster.employeeIds.add(key);
    rememberPerson(driver.employee_id, driver.id);
    rememberClient(driver.client_id, key, driver.employee_id);
    driverEmpById.set(driver.id, key);
    if (driver.civil_id) {
      roster.civilToEmployee.set(normalizeCivilId(driver.civil_id) ?? driver.civil_id, key);
    }
  }
  for (const intake of intakes ?? []) {
    if (!intake.employee_id) continue;
    const key = employeeIdKey(intake.employee_id);
    roster.employeeIds.add(key);
    rememberPerson(intake.employee_id, intake.linked_profile_id ?? `intake:${intake.id}`);
    rememberClient(intake.client_id, key, intake.employee_id);
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
    clientIds: new Map(),
  };
  const monthDays = kuwaitCalendarMonthDays(kuwaitToday());
  const passportSeen = new Map<string, number>();

  return rows.map((row) => {
    let partner_id: string | null = null;
    let partner_name: string | null = null;
    let zone_id: string | null = null;
    let zone_name: string | null = null;
    let vehicle_id: string | null = null;
    let vehicle_type_key: "bike" | "car" | null = null;
    let restaurant_ids: string[] = [];
    let restaurant_names: string[] = [];
    let nationality: string | null = null;
    let rider_category: DriverRiderCategory = "in_house";
    let source_company: string | null = null;
    let client_id: string | null = null;
    let client_name: string | null = null;
    let active: boolean | null = null;
    let off_days: number | null = null;
    let passport_number: string | null = null;
    let employee_status_key: string | null = null;
    let employee_status_name: string | null = null;
    let section_keys: string[] = [];
    let section_names: string[] = [];
    let nationality_category_keys: string[] = [];
    let nationality_category_names: string[] = [];
    let project_key: DriverProjectKey | null = null;
    let accommodation: string | null = null;
    let work_start_date: string | null = null;
    let sponsorship_key: string | null = null;
    let job_position: string | null = null;
    let hiring_type: string | null = null;
    let job_end_date: string | null = null;
    let job_end_description: string | null = null;
    let residency_expiry_date: string | null = null;
    let fixed_salary: number | null = null;
    let work_permit_salary: number | null = null;
    let last_increment_date: string | null = null;
    let currency: string | null = null;
    let asset_ids: string[] = [];
    let asset_names: string[] = [];
    let screenshots_allowed: boolean | null = null;
    let login_verification_exempt: boolean | null = null;
    let bank_code: string | null = null;
    let bank_code_name: string | null = null;
    let account_number: string | null = null;
    let iban: string | null = null;
    let beneficiary_civil_id: string | null = null;
    const expiries: Partial<Record<DriverImportExpiryField, string | null>> = {};

    const identity = evaluateImportIdentity(row, roster, seen);
    let status: DriverImportPreviewStatus = identity.status;
    const existingByEmployeeId = identity.existingByEmployeeId;
    const existingByClientId = identity.existingByClientId;
    const lookupStillOpen = () =>
      canContinueImportLookups({
        ...identity,
        status,
        existingByEmployeeId,
        existingByClientId,
      });

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

    if (lookupStillOpen() && row.present.vehicle_label) {
      if (row.cleared?.vehicle_label) {
        vehicle_id = null;
      } else {
        const label = row.vehicle_label?.trim().toLowerCase() ?? "";
        const matched = label ? vehicleByLabel.get(label) : undefined;
        if (label && !matched) status = "unmatched_vehicle";
        else vehicle_id = matched?.id ?? null;
      }
    }

    if (lookupStillOpen() && row.present.vehicle_type) {
      if (row.cleared?.vehicle_type) {
        vehicle_type_key = null;
      } else if (row.vehicle_type?.trim()) {
        const parsed = parseImportVehicleType(row.vehicle_type);
        if (!parsed) status = "invalid_vehicle_type";
        else vehicle_type_key = parsed;
      }
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

    if (lookupStillOpen() && row.nationality?.trim()) {
      nationality = resolveCountryInput(row.nationality);
      if (!nationality) status = "invalid_nationality";
    }

    if (lookupStillOpen()) {
      const parsedCategory = parseRiderCategory(row.rider_category);
      if (parsedCategory === "invalid") status = "invalid_rider_category";
      else rider_category = parsedCategory ?? "in_house";
    }

    if (lookupStillOpen()) {
      const parsedCompany = resolveCompanyInput(row.source_company, companies);
      if (parsedCompany === "invalid") status = "invalid_source_company";
      else if (!companyMatchesCategory(rider_category, parsedCompany, companies)) {
        status = "company_category_mismatch";
      } else source_company = parsedCompany;
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

    if (lookupStillOpen()) {
      const parsedOff = parseImportOffDays(row.off_days, monthDays);
      if (parsedOff.error) status = parsedOff.error;
      else off_days = parsedOff.offDays;
    }

    if (lookupStillOpen() && row.present.passport_number) {
      if (row.cleared?.passport_number) {
        passport_number = null;
      } else {
        const normalized = normalizeImportPassport(row.passport_number);
        if (normalized && !isValidImportPassport(normalized)) status = "invalid_passport";
        else if (normalized && passportSeen.has(normalized)) status = "duplicate_passport";
        else {
          passport_number = normalized;
          if (normalized) passportSeen.set(normalized, row.rowIndex);
        }
      }
    }

    if (lookupStillOpen() && row.present.employee_status_key) {
      if (row.cleared?.employee_status_key) {
        employee_status_key = null;
      } else {
        const hit = resolveEmployeeCatalogToken(row.employee_status_key, statusIndex);
        if (hit.status === "ok") {
          employee_status_key = hit.key;
          employee_status_name = hit.name;
        } else if (hit.status !== "empty") {
          status = "invalid_employee_status";
        }
      }
    }

    if (lookupStillOpen() && row.present.section_keys) {
      if (row.cleared?.section_keys) {
        section_keys = [];
      } else {
        const hit = resolveEmployeeCatalogTokens(row.section_keys, sectionIndex);
        if (hit.status === "ok") {
          section_keys = hit.keys;
          section_names = hit.names;
        } else if (hit.status !== "empty") {
          status = "invalid_section";
        }
      }
    }

    if (lookupStillOpen() && row.present.nationality_category_keys) {
      if (row.cleared?.nationality_category_keys) {
        nationality_category_keys = [];
      } else {
        const hit = resolveEmployeeCatalogTokens(
          row.nationality_category_keys,
          nationalityCategoryIndex,
        );
        if (hit.status === "ok") {
          nationality_category_keys = hit.keys;
          nationality_category_names = hit.names;
        } else if (hit.status !== "empty") {
          status = "invalid_nationality_category";
        }
      }
    }

    if (lookupStillOpen() && row.present.project_key) {
      if (row.cleared?.project_key) {
        project_key = null;
      } else {
        const normalized = (row.project_key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (isDriverProjectKey(normalized)) project_key = normalized;
        else status = "invalid_project";
      }
    }

    if (lookupStillOpen() && row.present.accommodation) {
      accommodation = row.cleared?.accommodation
        ? null
        : (row.accommodation ?? "").trim() || null;
    }

    if (lookupStillOpen() && row.present.work_start_date) {
      if (row.cleared?.work_start_date) {
        work_start_date = null;
      } else if (row.work_start_date?.trim()) {
        work_start_date = parseImportDate(row.work_start_date);
        if (!work_start_date) status = "invalid_date";
      }
    }

    if (lookupStillOpen() && row.present.screenshots_allowed) {
      if (row.cleared?.screenshots_allowed) {
        screenshots_allowed = null;
      } else {
        const parsed = parseImportYesNo(row.screenshots_allowed);
        if (parsed === "invalid") status = "invalid_yes_no";
        else screenshots_allowed = parsed;
      }
    }

    if (lookupStillOpen() && row.present.login_verification_exempt) {
      if (row.cleared?.login_verification_exempt) {
        login_verification_exempt = null;
      } else {
        const parsed = parseImportYesNo(row.login_verification_exempt);
        if (parsed === "invalid") status = "invalid_yes_no";
        else login_verification_exempt = parsed;
      }
    }

    if (lookupStillOpen() && row.present.bank_code) {
      if (row.cleared?.bank_code) {
        bank_code = null;
      } else {
        const hit = resolveEmployeeCatalogToken(row.bank_code, bankIndex);
        if (hit.status === "ok") {
          bank_code = hit.key;
          bank_code_name = hit.name;
        } else {
          status = "invalid_bank_code";
        }
      }
    }

    if (lookupStillOpen() && row.present.account_number) {
      if (row.cleared?.account_number) {
        account_number = null;
      } else {
        account_number = normalizeImportAccountNumber(row.account_number);
        if (!account_number || !/^\d{6,20}$/.test(account_number)) {
          status = "invalid_account_number";
        }
      }
    }

    if (lookupStillOpen() && row.present.iban) {
      if (row.cleared?.iban) {
        iban = null;
      } else {
        iban = normalizeImportIban(row.iban);
        if (!iban || !isValidImportIban(iban)) status = "invalid_iban";
      }
    }

    if (lookupStillOpen() && row.present.beneficiary_civil_id) {
      if (row.cleared?.beneficiary_civil_id) {
        beneficiary_civil_id = null;
      } else {
        const rawCivil = (row.beneficiary_civil_id ?? "").trim();
        beneficiary_civil_id = normalizeCivilId(rawCivil) ?? rawCivil;
        if (!/^\d{12}$/.test(beneficiary_civil_id)) status = "invalid_beneficiary_civil_id";
      }
    }

    if (lookupStillOpen()) {
      for (const field of DRIVER_IMPORT_EXPIRY_FIELDS) {
        if (!row.present[field]) continue;
        const raw = row[field];
        if (row.cleared?.[field]) {
          expiries[field] = null;
          continue;
        }
        if (!raw?.trim()) continue;
        const ymd = parseImportDate(raw);
        if (!ymd) {
          status = "invalid_date";
          break;
        }
        expiries[field] = `${ymd}T00:00:00+03:00`;
      }
    }

    const opsRequired = requiresOpsAssignment(section_keys, sections);
    if (
      lookupStillOpen() &&
      importRowMissingAssignment({
        ops_required: opsRequired,
        zone_id,
        restaurant_ids,
        existingByEmployeeId,
        existingByClientId,
        cleared: row.cleared,
      })
    ) {
      status = "missing_assignment";
    }

    if (lookupStillOpen() && row.present.sponsorship_key) {
      if (row.cleared?.sponsorship_key) sponsorship_key = null;
      else if (row.sponsorship_key?.trim()) {
        const hit = resolveEmployeeCatalogToken(row.sponsorship_key, sponsorshipIndex);
        if (hit.status === "ok") sponsorship_key = hit.key;
        else status = "invalid_sponsorship";
      }
    }
    if (lookupStillOpen() && row.present.job_position && !row.cleared?.job_position && row.job_position?.trim()) {
      const key = row.job_position.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (isJobPosition(key)) job_position = key;
      else status = "invalid_job_position";
    }
    if (lookupStillOpen() && row.present.hiring_type && !row.cleared?.hiring_type && row.hiring_type?.trim()) {
      const key = row.hiring_type.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (isHiringType(key)) hiring_type = key;
      else status = "invalid_hiring_type";
    }
    if (lookupStillOpen() && row.present.job_end_date) {
      if (row.cleared?.job_end_date) job_end_date = null;
      else if (row.job_end_date?.trim()) {
        job_end_date = parseImportDate(row.job_end_date);
        if (!job_end_date) status = "invalid_date";
      }
    }
    if (
      lookupStillOpen() &&
      row.present.job_end_description &&
      !row.cleared?.job_end_description &&
      row.job_end_description?.trim()
    ) {
      const key = row.job_end_description.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (isJobEndDescription(key)) job_end_description = key;
      else status = "invalid_job_end_description";
    }
    if (lookupStillOpen() && row.present.residency_expiry_date) {
      if (row.cleared?.residency_expiry_date) residency_expiry_date = null;
      else if (row.residency_expiry_date?.trim()) {
        residency_expiry_date = parseImportDate(row.residency_expiry_date);
        if (!residency_expiry_date) status = "invalid_date";
      }
    }
    if (lookupStillOpen() && row.present.fixed_salary && !row.cleared?.fixed_salary && row.fixed_salary?.trim()) {
      fixed_salary = normalizeMoney(row.fixed_salary);
      if (fixed_salary == null) status = "invalid_money";
    }
    if (
      lookupStillOpen() &&
      row.present.work_permit_salary &&
      !row.cleared?.work_permit_salary &&
      row.work_permit_salary?.trim()
    ) {
      work_permit_salary = normalizeMoney(row.work_permit_salary);
      if (work_permit_salary == null) status = "invalid_money";
    }
    if (lookupStillOpen() && row.present.last_increment_date) {
      if (row.cleared?.last_increment_date) last_increment_date = null;
      else if (row.last_increment_date?.trim()) {
        last_increment_date = parseImportDate(row.last_increment_date);
        if (!last_increment_date) status = "invalid_date";
      }
    }
    if (lookupStillOpen() && row.present.currency && !row.cleared?.currency && row.currency?.trim()) {
      const code = row.currency.trim().toUpperCase();
      if (isPaymentCurrency(code)) currency = code;
      else status = "invalid_currency";
    }
    if (lookupStillOpen() && row.present.asset_ids) {
      if (row.cleared?.asset_ids) {
        asset_ids = [];
      } else if (row.asset_ids?.trim()) {
        const hit = resolveEmployeeCatalogTokens(row.asset_ids, assetIndex);
        if (hit.status === "ok") {
          asset_ids = hit.keys;
          asset_names = hit.names;
        } else status = "invalid_asset";
      }
    }

    const people = row.employee_id
      ? peopleByEmployee.get(employeeIdKey(row.employee_id))
      : identity.resolvedEmployeeId
        ? peopleByEmployee.get(employeeIdKey(identity.resolvedEmployeeId))
        : undefined;
    const ambiguousEmployee = (people?.size ?? 0) > 1;
    if (ambiguousEmployee) status = "ambiguous_employee_id";
    else if (
      lookupStillOpen() &&
      existingByEmployeeId &&
      status !== "duplicate_client_id" &&
      status !== "missing_assignment"
    ) {
      status = "duplicate_employee_id";
    }

    return {
      ...row,
      status,
      existingByEmployeeId: ambiguousEmployee ? false : existingByEmployeeId,
      existingByClientId: ambiguousEmployee ? false : existingByClientId,
      resolved_employee_id: identity.resolvedEmployeeId,
      ops_required: opsRequired,
      partner_id,
      partner_name,
      zone_id,
      zone_name,
      vehicle_id,
      vehicle_type_key,
      restaurant_ids,
      restaurant_names,
      nationality,
      rider_category,
      source_company,
      client_id,
      client_name,
      active,
      off_days,
      passport_number,
      employee_status_key,
      employee_status_name,
      section_keys,
      section_names,
      nationality_category_keys,
      nationality_category_names,
      project_key,
      accommodation,
      work_start_date,
      screenshots_allowed,
      login_verification_exempt,
      bank_code,
      bank_code_name,
      account_number,
      iban,
      beneficiary_civil_id,
      expiries,
      sponsorship_key,
      job_position,
      hiring_type,
      job_end_date,
      job_end_description,
      residency_expiry_date,
      fixed_salary,
      work_permit_salary,
      last_increment_date,
      currency,
      asset_ids,
      asset_names,
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

export async function applyOneImportRow(
  row: DriverImportPreviewRow,
  ctx: {
    db: StaffClient;
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
  journal?: Omit<DriverImportJournal, "batch_id">;
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
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return fail(mutationAuth.error);

  const phone = row.phone?.trim() ? normalizeKuwaitPhone(row.phone) : null;
  const civilId = row.civil_id?.trim() ? normalizeCivilId(row.civil_id) : null;
  const requestedEmployeeId = normalizeEmployeeId(
    row.employee_id ?? row.resolved_employee_id ?? "",
  );
  if (importRowMissingAssignment(row)) return fail("missing_assignment");

  let intakeId: string | null = null;
  let driverCode: string | null = null;
  let updated = false;
  let alreadyLinked = false;
  let linkedDriverId: string | null = null;
  let beforeSnap = {};
  let journalBefore: Awaited<ReturnType<typeof readImportSnapshot>> | null = null;

  const matchExisting = async () => {
    if (requestedEmployeeId) {
      const byEmp = await ctx.db
        .from("driver_intakes")
        .select("id, linked, driver_code, linked_profile_id, employee_id")
        .is("archived_at", null)
        .ilike("employee_id", requestedEmployeeId)
        .maybeSingle();
      if (byEmp.data) return byEmp;
    }
    const clientId = normalizeClientValue(row.client_id);
    if (!clientId || ctx.duplicateStrategy !== "update") {
      return { data: null, error: null };
    }
    const { data: rows, error } = await ctx.db
      .from("driver_intakes")
      .select("id, linked, driver_code, linked_profile_id, employee_id")
      .is("archived_at", null)
      .ilike("client_id", clientId);
    if (error) return { data: null, error };
    if (!rows || rows.length !== 1) return { data: null, error: null };
    return { data: rows[0], error: null };
  };

  let employeeId = requestedEmployeeId;

  if (row.off_days != null) {
    const { data: existingForOff } = await matchExisting();
    const linkedId = existingForOff?.linked_profile_id ?? null;
    const already = Boolean(existingForOff?.linked || linkedId);
    const approveRequested = row.active ?? ctx.approveImmediately;
    if (
      importOffNeedsApprovedDriver(
        row.off_days,
        Boolean(linkedId),
        shouldApproveImportRow(approveRequested, already),
      )
    ) {
      return fail("off_requires_approved_driver");
    }
    linkedDriverId = linkedId;
  }

  if (ctx.duplicateStrategy === "update") {
    const { data: existing } = await matchExisting();

    if (existing) {
      employeeId =
        requestedEmployeeId ||
        normalizeEmployeeId(existing.employee_id ?? "") ||
        employeeId;
      alreadyLinked = Boolean(existing.linked || existing.linked_profile_id);
      const prior = await loadIntakeProfileSnapshot(ctx.db, existing.id);
      beforeSnap = prior?.snapshot ?? {};
      journalBefore = await readImportSnapshot(
        ctx.db,
        existing.id,
        existing.linked_profile_id ?? null,
      );
      const { intake: intakePatch, profile: profilePatch } = buildImportWritePatch({
        row: { ...row, phone, civil_id: civilId, employee_id: employeeId },
        mode: "update",
        existingCustom: (journalBefore.intake?.custom_fields as Record<string, unknown> | null) ?? null,
        existingBank:
          (journalBefore.intake?.bank_details as Parameters<
            typeof buildImportWritePatch
          >[0]["existingBank"]) ?? null,
      });
      intakePatch.employee_id = employeeId;
      intakePatch.updated_at = new Date().toISOString();
      const { error: updErr } = await ctx.db
        .from("driver_intakes")
        .update(intakePatch)
        .eq("id", existing.id);

      if (updErr) return fail(updErr.message);
      intakeId = existing.id;
      driverCode = existing.driver_code;
      updated = true;
      if (writesCell(row, "restaurant_ids", row.restaurant_ids.length > 0, "update")) {
        const linkError = await syncImportRestaurants(
          ctx.db,
          existing.id,
          existing.linked_profile_id ?? null,
          row.cleared?.restaurant_ids ? [] : row.restaurant_ids,
        );
        if (linkError) return fail(linkError);
      }

      if (existing.linked_profile_id) {
        const linkedId = existing.linked_profile_id;
        linkedDriverId = linkedId;
        const { error: driverErr } = await ctx.db
          .from("drivers")
          .update({ ...intakePatch, employee_id: employeeId, updated_at: new Date().toISOString() })
          .eq("id", linkedId);
        if (driverErr) return fail(driverErr.message);
        const { error: profileErr } = await ctx.db
          .from("profiles")
          .update({ ...profilePatch, updated_at: new Date().toISOString() })
          .eq("id", linkedId);
        if (profileErr) return fail(profileErr.message);
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
    if (!employeeId) return fail("missing_fields");
    const { data: code, error: codeErr } = await ctx.db.rpc("allocate_driver_code");
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
    const { intake: createPatch } = buildImportWritePatch({
      row: { ...row, phone, civil_id: civilId, employee_id: employeeId, custom_fields: customValues as Record<string, string | null> },
      mode: "create",
    });
    const { error: insErr } = await ctx.db.from("driver_intakes").insert({
      id: newId,
      driver_code: code,
      status: "awaiting_app_link",
      workflow_status: "pending",
      linked: false,
      assets_issued: {},
      ...createPatch,
      employee_id: employeeId,
      full_name: row.full_name!.trim(),
      custom_fields: (createPatch.custom_fields as Json | undefined) ?? (customValues as unknown as Json),
    });

    if (insErr) return fail(insErr.message);
    intakeId = newId;
    driverCode = String(code);
  }

  if (
    !updated &&
    writesCell(row, "restaurant_ids", row.restaurant_ids.length > 0, "create") &&
    row.restaurant_ids.length > 0
  ) {
    const linkError = await syncImportRestaurants(ctx.db, intakeId!, null, row.restaurant_ids);
    if (linkError) return fail(linkError);
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
        source_company: row.source_company,
        client_id: row.client_id,
        client_name: row.client_name,
        custom_fields: row.custom_fields ?? {},
      }),
      context: ctx.fileName ? { file: ctx.fileName } : {},
    });
  }

  let approved: 0 | 1 = 0;
  let approvedDriverId: string | null = null;
  let createdAuthUserId: string | null = null;
  let credential: DriverImportCredential | undefined;
  const approveRow = shouldApproveImportRow(
    row.active ?? ctx.approveImmediately,
    alreadyLinked,
  );
  if (approveRow && intakeId) {
    const result = await approveDriverIntake(intakeId);
    if ("success" in result && result.success) {
      approved = 1;
      approvedDriverId = result.driverId;
      createdAuthUserId = result.createdAuthUserId;
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
        employee_id: employeeId ?? "",
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
        source_company: row.source_company,
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

  const driverIdForOff = approvedDriverId ?? linkedDriverId;
  if (row.off_days != null) {
    if (!driverIdForOff) return fail("off_requires_approved_driver");
    const { error: offErr } = await ctx.db.rpc("admin_set_driver_off_structure", {
      p_driver_id: driverIdForOff,
      p_month: `${kuwaitToday().slice(0, 7)}-01`,
      p_off_days: offDaysForRpc(row.off_days) as unknown as number,
    });
    if (offErr) return fail(offErr.message);
  }

  const mode = updated ? "update" : "create";
  const driverForLinks = approvedDriverId ?? linkedDriverId;
  if (intakeId) {
    const assetError = await syncImportAssets(
      row,
      intakeId,
      driverForLinks,
      mutationAuth.session.id,
      mode,
    );
    if (assetError) return fail(assetError);
    const expiryError = await syncImportExpiries(
      row,
      intakeId,
      driverForLinks,
      mode,
      journalBefore?.tracking ?? [],
    );
    if (expiryError) return fail(expiryError);
  }
  const journalAfter = intakeId
    ? await readImportSnapshot(ctx.db, intakeId, driverForLinks)
    : null;

  return {
    events,
    applied: 1,
    approved,
    credential,
    journal: {
      row_index: row.rowIndex,
      outcome: updated ? "update" : "create",
      intake_id: intakeId,
      driver_id: driverForLinks,
      created_auth_uid: createdAuthUserId,
      passcode: credential?.passcode ?? null,
      before: journalBefore,
      after: journalAfter,
      replay: "applied",
    },
  };
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
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("create");
  if (auth.error) return { error: auth.error };

  const ready = payload.rows.filter((r) =>
    isImportRowReady(r, payload.duplicateStrategy),
  );
  const db = await staffClient();
  let batchId = payload.batchId ?? null;

  if (!batchId) {
    const { data: batch, error: batchError } = await db
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
        undo_seq: 0,
        redoable: true,
      })
      .select("id")
      .single();
    if (batchError || !batch?.id) return { error: "save_failed" };
    batchId = String(batch.id);
    const { data: openRedo } = await db
      .from("driver_import_batches")
      .select("id, status, redoable")
      .eq("status", "undone");
    const retire = clearRedo(
      (openRedo ?? []).map((batch) => ({
        id: String(batch.id),
        status: String(batch.status),
        createdAt: "",
        undoSeq: 0,
        redoable: batch.redoable !== false,
      })),
    );
    if (retire.length > 0) {
      await db.from("driver_import_batches").update({ redoable: false }).in("id", retire);
    }
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
      db,
      duplicateStrategy: payload.duplicateStrategy,
      approveImmediately: payload.approveImmediately,
      customFieldDefs,
      fileName: payload.fileName,
    });
    events.push(...result.events);
    applied += result.applied;
    approved += result.approved;
    if (result.credential) credentials.push(result.credential);
    if (result.journal && result.applied === 1) {
      const { error: journalError } = await db.from("driver_import_rows").insert({
        ...result.journal,
        batch_id: batchId,
      });
      if (journalError) return { error: journalError.message };
    }
    if (result.failure) {
      failures.push(result.failure);
      if (result.applied === 0) skipped += 1;
    }
  }

  const appliedTotal = payload.appliedSoFar + applied;
  const skippedTotal = payload.skippedSoFar + skipped;
  const approvedTotal = payload.approvedSoFar + approved;
  await db
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

