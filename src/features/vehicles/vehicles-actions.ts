"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS, UNIQ_COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  isDriverProjectKey,
  isVehicleCarType,
  isVehicleCondition,
  isVehicleFuelCompany,
  isVehicleFuelType,
  kuwaitYmdToIso,
} from "@/features/fleet/fleet-labels";
import { kuwaitTodayYmd, addKuwaitDays } from "@/lib/date/kuwait-dates";
import {
  findActiveShiftRow,
  type ShiftRow,
} from "@/features/driver-tracking/shift-flags";
import { assignedDriverProjectWrite } from "./vehicles-list-utils";
import { validateVehicleForm } from "./vehicle-form-validation";
import { plateToBikeId } from "./plate-id";
import { vehicleAssignedOnDuty, vehicleShiftLabel } from "./vehicle-on-duty";
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import type {
  VehicleCarType,
  VehicleCondition,
  VehicleFuelCompany,
  VehicleFuelType,
} from "@/features/fleet/fleet-labels";
import type {
  VehicleListRow,
  VehiclePartnerOption,
  VehicleProjectType,
  VehicleStatus,
  VehicleTypeRow,
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

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function allRows(db: Firestore, collection: string): Promise<Row[]> {
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => asRow(doc.id, doc.data()));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error?.message) return "save_failed";
  if (error.code === "23505") {
    const msg = error.message ?? "";
    if (msg.includes("reg_number")) return "duplicate_plate";
    return "duplicate_bike_id";
  }
  return error.code ? `${error.code} — ${error.message}` : error.message;
}

async function requireVehicles(permission: "vehicles.view" | "vehicles.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireStaff() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
}

function emptyText(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = emptyText(value);
  return text || null;
}

async function identityTaken(
  db: Firestore,
  regNumber: string,
  bikeId: string,
  exceptId?: string,
): Promise<"duplicate_plate" | "duplicate_bike_id" | null> {
  const [plates, bikes] = await Promise.all([
    db.collection(COLLECTIONS.vehicles).where("reg_number", "==", regNumber).get(),
    db.collection(COLLECTIONS.vehicles).where("bike_id", "==", bikeId).get(),
  ]);
  if (plates.docs.some((doc) => doc.id !== exceptId)) return "duplicate_plate";
  if (bikes.docs.some((doc) => doc.id !== exceptId)) return "duplicate_bike_id";
  return null;
}

async function claimPlate(db: Firestore, plate: string, ownerId: string): Promise<boolean> {
  const ref = db.collection(UNIQ_COLLECTIONS.plate).doc(encodeURIComponent(plate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const owner = snap.exists ? str(snap.data()?.owner_id) : "";
    if (snap.exists && owner && owner !== ownerId) return false;
    tx.set(ref, { owner_id: ownerId });
    return true;
  });
}

async function releasePlate(db: Firestore, plate: string, ownerId: string) {
  const ref = db.collection(UNIQ_COLLECTIONS.plate).doc(encodeURIComponent(plate));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && str(snap.data()?.owner_id) === ownerId) tx.delete(ref);
  });
}

export async function listVehicleTypes(): Promise<VehicleTypeRow[]> {
  await requireStaff();
  const db = await openDb();
  const rows = await allRows(db, COLLECTIONS.vehicleTypes);
  return rows
    .map((row) => ({
      key: str(row.key) || row.id,
      label_en: str(row.label_en),
      label_ar: str(row.label_ar),
      sort_order: Number(row.sort_order ?? 0),
      is_active: row.is_active !== false,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function listVehiclePartners(): Promise<VehiclePartnerOption[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) throw new Error(auth.error);
  const db = await openDb();
  const rows = await allRows(db, COLLECTIONS.partners);
  return rows
    .map((row) => ({ id: row.id, name: str(row.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type VehicleDbRow = {
  id: string;
  bike_id: string;
  reg_number: string | null;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  project_type: VehicleProjectType;
  status: VehicleStatus;
  vehicle_type_key: string;
  location_text: string | null;
  condition: string | null;
  car_type: string | null;
  type_of_use: string | null;
  fuel_type: string | null;
  fuel_company: string | null;
  chip_no: string | null;
  fuel_monthly_limit_kwd: number | null;
  owner_partner_id: string | null;
  replaces_vehicle_id: string | null;
  replacement_started_at: string | null;
  created_at: string;
};

function mapVehicle(row: Row): VehicleDbRow {
  return {
    id: row.id,
    bike_id: str(row.bike_id),
    reg_number: str(row.reg_number) || null,
    chassis_no: str(row.chassis_no) || null,
    make: str(row.make) || null,
    model: str(row.model) || null,
    model_year: numOrNull(row.model_year),
    project_type: row.project_type as VehicleProjectType,
    status: row.status as VehicleStatus,
    vehicle_type_key: str(row.vehicle_type_key),
    location_text: str(row.location_text) || null,
    condition: str(row.condition) || null,
    car_type: str(row.car_type) || null,
    type_of_use: str(row.type_of_use) || null,
    fuel_type: str(row.fuel_type) || null,
    fuel_company: str(row.fuel_company) || null,
    chip_no: str(row.chip_no) || null,
    fuel_monthly_limit_kwd: numOrNull(row.fuel_monthly_limit_kwd),
    owner_partner_id: str(row.owner_partner_id) || null,
    replaces_vehicle_id: str(row.replaces_vehicle_id) || null,
    replacement_started_at: str(row.replacement_started_at) || null,
    created_at: str(row.created_at),
  };
}

export async function listVehicles(): Promise<VehicleListRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) throw new Error(auth.error);

  const db = await openDb();
  const today = kuwaitTodayYmd();
  const yesterday = addKuwaitDays(today, -1);
  const [vehicles, types, drivers, profiles, partners, zones, useTypes, logs, shifts] =
    await Promise.all([
      allRows(db, COLLECTIONS.vehicles),
      allRows(db, COLLECTIONS.vehicleTypes),
      allRows(db, COLLECTIONS.drivers),
      allRows(db, COLLECTIONS.profiles),
      allRows(db, COLLECTIONS.partners),
      allRows(db, COLLECTIONS.zones),
      allRows(db, COLLECTIONS.vehicleUseTypes),
      db.collection(COLLECTIONS.attendanceLogs).where("log_date", ">=", yesterday).get(),
      db.collection(COLLECTIONS.driverDailyShifts).where("shift_date", "in", [today, yesterday]).get(),
    ]);

  const vehicleRows = vehicles
    .map(mapVehicle)
    .sort((a, b) => (a.reg_number ?? "").localeCompare(b.reg_number ?? ""));
  const typeLabels = new Map(
    types.map((row) => [
      str(row.key) || row.id,
      { label_en: str(row.label_en), label_ar: str(row.label_ar) },
    ]),
  );
  const partnerNames = new Map(partners.map((row) => [row.id, str(row.name)]));
  const zoneNames = new Map(zones.map((row) => [row.id, str(row.name)]));
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const assigned = new Map<
    string,
    {
      id: string;
      driver_code: string;
      employee_id: string;
      name: string | null;
      phone: string | null;
      project_key: string | null;
      accommodation: string | null;
      partner_name: string | null;
      zone_name: string | null;
    }
  >();
  for (const row of drivers) {
    if (row.archived_at) continue;
    const vehicleId = str(row.vehicle_id);
    if (!vehicleId) continue;
    const profile = profileById.get(row.id);
    assigned.set(vehicleId, {
      id: row.id,
      driver_code: str(row.driver_code),
      employee_id: str(row.employee_id),
      name: str(profile?.full_name) || null,
      phone: str(profile?.phone) || null,
      project_key: str(row.project_key) || null,
      accommodation: str(row.accommodation) || null,
      partner_name: str(row.partner_id) ? partnerNames.get(str(row.partner_id)) ?? null : null,
      zone_name: str(row.zone_id) ? zoneNames.get(str(row.zone_id)) ?? null : null,
    });
  }

  const plateById = new Map(vehicleRows.map((row) => [row.id, row.reg_number]));
  const useTypeLabels = new Map(
    useTypes.map((row) => [str(row.key) || row.id, str(row.label_en)]),
  );
  const openAttendance = new Set(
    logs.docs
      .map((doc) => asRow(doc.id, doc.data()))
      .filter((row) => row.check_in_at != null && row.check_out_at == null)
      .map((row) => str(row.driver_id))
      .filter(Boolean),
  );
  const shiftRowsByDriver = new Map<string, ShiftRow[]>();
  for (const doc of shifts.docs) {
    const row = asRow(doc.id, doc.data()) as unknown as ShiftRow;
    const list = shiftRowsByDriver.get(row.driver_id);
    if (list) list.push(row);
    else shiftRowsByDriver.set(row.driver_id, [row]);
  }
  const activeShiftByDriver = new Map<string, ShiftRow>();
  for (const [driverId, rows] of shiftRowsByDriver) {
    const active = findActiveShiftRow(rows, today);
    if (active) activeShiftByDriver.set(driverId, active);
  }

  void logAdminRead("vehicles", "/vehicles");

  return vehicleRows.map((row) => {
    const driver = assigned.get(row.id);
    const type = typeLabels.get(row.vehicle_type_key);
    const useKey = row.type_of_use?.trim() || null;
    return {
      id: row.id,
      bike_id: row.bike_id,
      reg_number: row.reg_number,
      chassis_no: row.chassis_no,
      make: row.make,
      model: row.model,
      model_year: row.model_year,
      project_type: row.project_type,
      status: row.status,
      vehicle_type_key: row.vehicle_type_key,
      vehicle_type_label: type?.label_en ?? row.vehicle_type_key,
      location_text: row.location_text,
      condition: isVehicleCondition(row.condition) ? row.condition : null,
      car_type: isVehicleCarType(row.car_type) ? row.car_type : null,
      type_of_use: useKey,
      type_of_use_label: useKey ? useTypeLabels.get(useKey) ?? useKey : null,
      fuel_type: isVehicleFuelType(row.fuel_type) ? row.fuel_type : null,
      fuel_company: isVehicleFuelCompany(row.fuel_company) ? row.fuel_company : null,
      chip_no: row.chip_no,
      fuel_monthly_limit_kwd: row.fuel_monthly_limit_kwd,
      owner_partner_id: row.owner_partner_id,
      owner_partner_name: row.owner_partner_id ? partnerNames.get(row.owner_partner_id) ?? null : null,
      replaces_vehicle_id: row.replaces_vehicle_id,
      replacement_started_at: row.replacement_started_at,
      replaces_plate: row.replaces_vehicle_id ? plateById.get(row.replaces_vehicle_id) ?? null : null,
      assigned_driver_id: driver?.id ?? null,
      assigned_driver_name: driver?.name ?? null,
      assigned_driver_code: driver?.driver_code ?? null,
      assigned_employee_id: driver?.employee_id ?? null,
      assigned_driver_phone: driver?.phone ?? null,
      assigned_project_key: isDriverProjectKey(driver?.project_key) ? driver.project_key : null,
      assigned_accommodation: driver?.accommodation ?? null,
      assigned_partner_name: driver?.partner_name ?? null,
      assigned_zone_name: driver?.zone_name ?? null,
      assigned_on_duty: vehicleAssignedOnDuty({
        assignedDriverId: driver?.id ?? null,
        hasOpenAttendance: Boolean(driver && openAttendance.has(driver.id)),
      }),
      assigned_shift_label: driver ? vehicleShiftLabel(activeShiftByDriver.get(driver.id)) : null,
      created_at: row.created_at,
    };
  });
}

export async function getVehicle(id: string): Promise<VehicleListRow | null> {
  const rows = await listVehicles();
  return rows.find((row) => row.id === id) ?? null;
}

async function updateLinkedIntakes(
  db: Firestore,
  driverId: string,
  patch: Record<string, unknown>,
) {
  const snap = await db
    .collection(COLLECTIONS.driverIntakes)
    .where("linked_profile_id", "==", driverId)
    .where("archived_at", "==", null)
    .get();
  let batch = db.batch();
  let pending = 0;
  for (const doc of snap.docs) {
    batch.set(doc.ref, patch, { merge: true });
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
}

export async function saveVehicle(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const id = emptyText(formData.get("id"));
  const regNumber = emptyText(formData.get("regNumber"));
  const bikeId = plateToBikeId(regNumber);
  const vehicleTypeKey = emptyText(formData.get("vehicleTypeKey")) || "bike";
  const status = emptyText(formData.get("status")) as VehicleStatus;
  const carTypeRaw = emptyText(formData.get("carType"));
  const conditionRaw = emptyText(formData.get("condition"));
  const fuelTypeRaw = emptyText(formData.get("fuelType"));
  const fuelCompanyRaw = emptyText(formData.get("fuelCompany"));
  const typeOfUseRaw = emptyText(formData.get("typeOfUse"));
  const modelYearRaw = emptyText(formData.get("modelYear"));
  const limitRaw = emptyText(formData.get("fuelMonthlyLimitKwd"));
  const replacesVehicleId = optionalText(formData.get("replacesVehicleId"));
  const replacementStartedRaw = emptyText(formData.get("replacementStartedAt"));

  if (!regNumber) return { error: "missing_fields" };
  const formError = validateVehicleForm({
    bikeId,
    regNumber,
    chassisNo: emptyText(formData.get("chassisNo")),
    make: emptyText(formData.get("make")),
    model: emptyText(formData.get("model")),
    locationText: emptyText(formData.get("locationText")),
    modelYear: modelYearRaw,
    chipNo: emptyText(formData.get("chipNo")),
    fuelMonthlyLimitKwd: limitRaw,
  });
  if (formError) return { error: formError };
  if (status !== "active" && status !== "suspended" && status !== "maintenance") {
    return { error: "missing_fields" };
  }

  const carType: VehicleCarType | null = isVehicleCarType(carTypeRaw) ? carTypeRaw : null;
  const condition: VehicleCondition | null = isVehicleCondition(conditionRaw) ? conditionRaw : null;
  const fuelType: VehicleFuelType | null = isVehicleFuelType(fuelTypeRaw) ? fuelTypeRaw : null;
  const fuelCompany: VehicleFuelCompany | null = isVehicleFuelCompany(fuelCompanyRaw)
    ? fuelCompanyRaw
    : null;
  const typeOfUse = typeOfUseRaw || null;
  const modelYear = modelYearRaw ? Number(modelYearRaw) : null;
  const fuelMonthlyLimit = limitRaw ? Number(limitRaw) : defaultFuelMonthlyLimit(vehicleTypeKey);
  if (replacesVehicleId && replacesVehicleId === id) return { error: "invalid_replacement" };
  const replacementStartedAt = replacesVehicleId
    ? kuwaitYmdToIso(replacementStartedRaw) ?? new Date().toISOString()
    : null;

  const db = await openDb();
  const vehicleId = id || crypto.randomUUID();
  const taken = await identityTaken(db, regNumber, bikeId, id || undefined);
  if (taken) return { error: taken };
  const claimed = await claimPlate(db, regNumber, vehicleId);
  if (!claimed) return { error: formatError({ code: "23505", message: "reg_number" }) };

  const existingSnap = id ? await db.collection(COLLECTIONS.vehicles).doc(id).get() : null;
  const previousPlate = existingSnap?.exists ? str(existingSnap.data()?.reg_number) : "";

  const payload = {
    bike_id: bikeId,
    reg_number: regNumber,
    chassis_no: optionalText(formData.get("chassisNo")),
    make: optionalText(formData.get("make")),
    model: optionalText(formData.get("model")),
    model_year: modelYear,
    vehicle_type_key: vehicleTypeKey,
    project_type: carTypeToProjectType(carType),
    status,
    location_text: optionalText(formData.get("locationText")),
    condition,
    car_type: carType,
    type_of_use: typeOfUse,
    fuel_type: fuelType,
    fuel_company: fuelCompany,
    chip_no: optionalText(formData.get("chipNo")),
    fuel_monthly_limit_kwd: fuelMonthlyLimit,
    owner_partner_id: optionalText(formData.get("ownerPartnerId")),
    replaces_vehicle_id: replacesVehicleId,
    replacement_started_at: replacementStartedAt,
    updated_at: new Date(),
  };

  try {
    if (id) {
      await db.collection(COLLECTIONS.vehicles).doc(id).set(payload, { merge: true });
    } else {
      await db.collection(COLLECTIONS.vehicles).doc(vehicleId).set({
        id: vehicleId,
        ...payload,
        created_by: auth.session.id,
        created_at: new Date(),
      });
    }
  } catch (error) {
    if (!id) await releasePlate(db, regNumber, vehicleId).catch(() => undefined);
    return { error: formatError(error as { message?: string }) };
  }

  if (previousPlate && previousPlate !== regNumber) {
    await releasePlate(db, previousPlate, vehicleId).catch(() => undefined);
  }

  if (id) {
    const projectWrite = assignedDriverProjectWrite(
      emptyText(formData.get("assignedDriverId")),
      formData.get("projectKey"),
    );
    if (projectWrite) {
      try {
        await db.collection(COLLECTIONS.drivers).doc(projectWrite.driverId).set(
          { project_key: projectWrite.project_key, updated_at: new Date() },
          { merge: true },
        );
        await updateLinkedIntakes(db, projectWrite.driverId, {
          project_key: projectWrite.project_key,
          updated_at: new Date(),
        });
      } catch (error) {
        return { error: formatError(error as { message?: string }) };
      }
    }
    void logAdminMutation({
      action: "update",
      entityType: "vehicle",
      entityId: id,
      routeName: "/vehicles",
      after: { ...payload, updated_at: new Date().toISOString() },
    });
    return { id };
  }

  void logAdminMutation({
    action: "create",
    entityType: "vehicle",
    entityId: vehicleId,
    routeName: "/vehicles",
    after: { ...payload, updated_at: new Date().toISOString() },
  });
  return { id: vehicleId };
}

export async function assignVehicleDriver(
  vehicleId: string,
  driverId: string | null,
): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const id = vehicleId.trim();
  if (!id) return { error: "missing_fields" };

  const db = await openDb();
  const now = new Date();
  const nextDriverId = driverId?.trim() || null;
  const previousSnap = await db
    .collection(COLLECTIONS.drivers)
    .where("vehicle_id", "==", id)
    .where("archived_at", "==", null)
    .get();
  const previousIds = previousSnap.docs.map((doc) => doc.id);

  try {
    const assignedDrivers = await db.collection(COLLECTIONS.drivers).where("vehicle_id", "==", id).get();
    let batch = db.batch();
    let pending = 0;
    const queue = (ref: DocumentReference, patch: Record<string, unknown>) => {
      batch.set(ref, patch, { merge: true });
      pending += 1;
    };
    for (const doc of assignedDrivers.docs) queue(doc.ref, { vehicle_id: null, updated_at: now });
    const assignedIntakes = await db
      .collection(COLLECTIONS.driverIntakes)
      .where("vehicle_id", "==", id)
      .where("archived_at", "==", null)
      .get();
    for (const doc of assignedIntakes.docs) queue(doc.ref, { vehicle_id: null, updated_at: now });
    if (pending > 0) await batch.commit();

    if (nextDriverId) {
      const driverSnap = await db.collection(COLLECTIONS.drivers).doc(nextDriverId).get();
      if (!driverSnap.exists || driverSnap.data()?.archived_at != null) {
        return { error: "missing_fields" };
      }
      await db.collection(COLLECTIONS.drivers).doc(nextDriverId).set(
        { vehicle_id: id, updated_at: now },
        { merge: true },
      );
      await updateLinkedIntakes(db, nextDriverId, { vehicle_id: id, updated_at: now });
    }
  } catch (error) {
    return { error: formatError(error as { message?: string }) };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle",
    entityId: id,
    routeName: "/vehicles",
    after: {
      assigned_driver_id: nextDriverId,
      previous_driver_ids: previousIds,
    },
  });
  return {};
}

const BULK_VEHICLE_CAP = 50;

export async function bulkAssignVehicleDrivers(
  pairs: { vehicleId: string; driverId: string | null }[],
): Promise<{ error?: string; updated?: number }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const next = pairs
    .map((pair) => ({
      vehicleId: pair.vehicleId.trim(),
      driverId: pair.driverId?.trim() || null,
    }))
    .filter((pair) => pair.vehicleId)
    .slice(0, BULK_VEHICLE_CAP);
  if (next.length === 0) return { error: "missing_fields" };
  for (const pair of next) {
    const result = await assignVehicleDriver(pair.vehicleId, pair.driverId);
    if (result.error) return result;
  }
  return { updated: next.length };
}

export async function bulkUpdateVehicles(
  ids: string[],
  patch: { status?: VehicleStatus; ownerPartnerId?: string | null },
): Promise<{ error?: string; updated?: number }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, BULK_VEHICLE_CAP);
  if (unique.length === 0) return { error: "missing_fields" };

  const payload: {
    updated_at: Date;
    status?: VehicleStatus;
    owner_partner_id?: string | null;
  } = { updated_at: new Date() };
  if (patch.status === "active" || patch.status === "suspended" || patch.status === "maintenance") {
    payload.status = patch.status;
  }
  if ("ownerPartnerId" in patch) {
    payload.owner_partner_id = patch.ownerPartnerId?.trim() || null;
  }
  if (payload.status === undefined && !("owner_partner_id" in payload)) {
    return { error: "missing_fields" };
  }

  const db = await openDb();
  try {
    const refs = unique.map((id) => db.collection(COLLECTIONS.vehicles).doc(id));
    const snaps = await db.getAll(...refs);
    let batch = db.batch();
    let pending = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      batch.set(snap.ref, payload, { merge: true });
      pending += 1;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  } catch (error) {
    return { error: formatError(error as { message?: string }) };
  }
  void logAdminMutation({
    action: "update",
    entityType: "vehicle",
    entityId: unique[0] ?? "bulk",
    routeName: "/vehicles",
    after: { ids: unique, ...payload, updated_at: payload.updated_at.toISOString() },
  });
  return { updated: unique.length };
}

export async function updateVehicleTypeLabel(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const key = emptyText(formData.get("key"));
  const labelEn = emptyText(formData.get("labelEn"));
  const labelAr = emptyText(formData.get("labelAr"));
  if (!key || !labelEn || !labelAr) return { error: "missing_fields" };

  const db = await openDb();
  try {
    const byId = db.collection(COLLECTIONS.vehicleTypes).doc(key);
    const snap = await byId.get();
    if (snap.exists) {
      await byId.set({ label_en: labelEn, label_ar: labelAr }, { merge: true });
    } else {
      const found = await db.collection(COLLECTIONS.vehicleTypes).where("key", "==", key).limit(1).get();
      const doc = found.docs[0];
      if (!doc) return { error: "save_failed" };
      await doc.ref.set({ label_en: labelEn, label_ar: labelAr }, { merge: true });
    }
  } catch (error) {
    return { error: formatError(error as { message?: string }) };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_type",
    entityId: key,
    routeName: "/settings/vehicle-types",
    after: { label_en: labelEn, label_ar: labelAr },
  });
  return {};
}
