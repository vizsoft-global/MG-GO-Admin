"use server";

import {
  isDriverProjectKey,
  isVehicleCarType,
  isVehicleFuelCompany,
  type VehicleCarType,
  type VehicleFuelCompany,
} from "@/features/fleet/fleet-labels";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { FUEL_TRANSFER_TYPES, type FuelTransferType } from "@/features/requests/types";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import type { FleetRequestListRow } from "./fleet-request-types";
import { isAssetFirstTime } from "@/features/requests/request-create-utils";
import {
  fleetDepartmentLabel,
  monthlyAmountTotal,
  requestNumberThisMonth,
  resolveFleetRequestVehicleId,
  type FleetQueueRequestType,
  fleetQueueViewSlug,
} from "./fleet-request-utils";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nestedName(value: unknown): string | null {
  const row = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  return name || null;
}

function profilePhone(value: unknown): string | null {
  const row = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  const phone = typeof row.phone === "string" ? row.phone.trim() : "";
  return phone || null;
}

function parseAssetFields(payload: Record<string, unknown>) {
  const item = typeof payload.asset_type === "string" ? payload.asset_type.trim() : "";
  const qtyRaw = payload.quantity;
  const quantity =
    typeof qtyRaw === "number"
      ? qtyRaw
      : typeof qtyRaw === "string" && qtyRaw.trim() !== ""
        ? Number(qtyRaw)
        : null;
  const mode = typeof payload.request_mode === "string" ? payload.request_mode : "";
  const handoverBy = typeof payload.handover_by === "string" ? payload.handover_by.trim() : "";
  const handoverAt = typeof payload.handover_at === "string" ? payload.handover_at.trim() : "";
  return {
    item: item || null,
    quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
    had_before: mode ? !isAssetFirstTime(mode) : null,
    handover_by: handoverBy || null,
    handover_at: handoverAt || null,
  };
}

function isFuelTransferType(value: unknown): value is FuelTransferType {
  return (FUEL_TRANSFER_TYPES as readonly string[]).includes(String(value));
}

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

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) rows.push(asRow(snap.id, snap.data()));
    }
  }
  return rows;
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

export async function listFleetRequests(input: {
  type: FleetQueueRequestType;
  driverId?: string;
}): Promise<{ rows: FleetRequestListRow[]; error?: string }> {
  let db: Firestore;
  try {
    db = await openDb();
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "not_configured" };
  }
  let search: string | undefined;
  if (input.driverId) {
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(input.driverId).get();
    const driver = driverSnap.exists ? asRow(driverSnap.id, driverSnap.data()) : null;
    const driverCode = typeof driver?.driver_code === "string" ? driver.driver_code.trim() : "";
    const employeeId = typeof driver?.employee_id === "string" ? driver.employee_id.trim() : "";
    // admin_list_requests p_search matches request_code / name / driver_code, not employee_id.
    search = driverCode || employeeId || undefined;
  }

  const extraView = fleetQueueViewSlug(input.type);
  const list = await fetchAdminRequestsList(
    {
      datePreset: "all",
      type: input.type,
      search,
      limit: 200,
      offset: 0,
    },
    extraView,
  );
  if (list.error) return { rows: [], error: list.error };

  let scopedRows = input.driverId
    ? list.rows.filter((row) => row.driver_id === input.driverId)
    : list.rows;
  if (input.driverId && scopedRows.length === 0) {
    const fallback = await fetchAdminRequestsList(
      {
        datePreset: "all",
        type: input.type,
        limit: 200,
        offset: 0,
      },
      extraView,
    );
    if (fallback.error) return { rows: [], error: fallback.error };
    scopedRows = fallback.rows.filter((row) => row.driver_id === input.driverId);
  }
  const driverIds = [...new Set(scopedRows.map((row) => row.driver_id).filter(Boolean))];

  const requestIds = scopedRows.map((row) => row.id);
  let drivers: Row[];
  let siblings: Row[];
  let fills: Row[];
  let stampedRows: Row[];
  try {
    [drivers, siblings, fills, stampedRows] = await Promise.all([
      rowsByIds(db, COLLECTIONS.drivers, driverIds),
      db
        .collection(COLLECTIONS.requests)
        .where("request_type", "==", input.type)
        .get()
        .then((snap) => snap.docs.map((doc) => asRow(doc.id, doc.data()))),
      whereIn(db, COLLECTIONS.fuelFills, "driver_id", driverIds),
      rowsByIds(db, COLLECTIONS.requests, requestIds),
    ]);
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "save_failed" };
  }

  const profiles = await rowsByIds(db, COLLECTIONS.profiles, driverIds);
  const zoneIds = drivers.map((row) => asId(row.zone_id)).filter((id): id is string => Boolean(id));
  const zones = await rowsByIds(db, COLLECTIONS.zones, zoneIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const zoneById = new Map(zones.map((row) => [row.id, row]));

  const driverById = new Map<string, Record<string, unknown>>();
  for (const row of drivers) {
    const zone = zoneById.get(asId(row.zone_id) ?? "");
    driverById.set(row.id, {
      ...row,
      profiles: { phone: profileById.get(row.id)?.phone ?? null },
      zones: zone ? { name: zone.name } : null,
    });
  }

  const fillVehicleByDriver = new Map<string, string>();
  const fillsSorted = [...fills].sort((a, b) => String(b.filled_at ?? "").localeCompare(String(a.filled_at ?? "")));
  for (const row of fillsSorted) {
    const driverId = asId(row.driver_id);
    const vehicleId = asId(row.vehicle_id);
    if (driverId && vehicleId && !fillVehicleByDriver.has(driverId)) {
      fillVehicleByDriver.set(driverId, vehicleId);
    }
  }

  const stampedByRequest = new Map<
    string,
    { vehicleId: string | null; payload: Record<string, unknown>; fuelTransferType: FuelTransferType | null }
  >();
  for (const row of stampedRows) {
    stampedByRequest.set(row.id, {
      vehicleId: asId(row.vehicle_id),
      payload: asRecord(row.payload),
      fuelTransferType: isFuelTransferType(row.fuel_transfer_type) ? row.fuel_transfer_type : null,
    });
  }

  const vehicleIds = new Set<string>();
  const partnerIds = new Set<string>();
  for (const row of driverById.values()) {
    const assigned = asId(row.vehicle_id);
    if (assigned) vehicleIds.add(assigned);
    const partnerId = asId(row.partner_id);
    if (partnerId) partnerIds.add(partnerId);
  }
  for (const vehicleId of fillVehicleByDriver.values()) vehicleIds.add(vehicleId);
  for (const stamped of stampedByRequest.values()) {
    if (stamped.vehicleId) vehicleIds.add(stamped.vehicleId);
  }

  let vehicleRows: Row[];
  try {
    vehicleRows = await rowsByIds(db, COLLECTIONS.vehicles, [...vehicleIds]);
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "save_failed" };
  }

  const vehicleById = new Map<string, Record<string, unknown>>();
  for (const row of vehicleRows) {
    vehicleById.set(row.id, row);
    const ownerId = asId(row.owner_partner_id);
    if (ownerId) partnerIds.add(ownerId);
  }

  let partnerRows: Row[];
  try {
    partnerRows = await rowsByIds(db, COLLECTIONS.partners, [...partnerIds]);
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "save_failed" };
  }

  const partnerNameById = new Map(
    partnerRows.map((row) => [row.id, typeof row.name === "string" ? row.name : ""]),
  );

  const siblingsByDriver = new Map<string, Array<{ created_at: string; amount_kwd: number | null }>>();
  for (const raw of siblings) {
    const row = asRecord(raw);
    const driverId = asId(row.driver_id);
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!driverId || !createdAt) continue;
    const listForDriver = siblingsByDriver.get(driverId) ?? [];
    listForDriver.push({
      created_at: createdAt,
      amount_kwd: row.amount_kwd != null ? Number(row.amount_kwd) : null,
    });
    siblingsByDriver.set(driverId, listForDriver);
  }

  const rows: FleetRequestListRow[] = scopedRows.map((row) => {
    const driver = driverById.get(row.driver_id) ?? {};
    const stamped = stampedByRequest.get(row.id);
    const vehicleId = resolveFleetRequestVehicleId({
      requestVehicleId: stamped?.vehicleId ?? null,
      driverVehicleId: asId(driver.vehicle_id),
      fillVehicleId: fillVehicleByDriver.get(row.driver_id) ?? null,
    });
    const vehicle = vehicleId ? vehicleById.get(vehicleId) ?? {} : {};
    const asset = parseAssetFields(stamped?.payload ?? {});
    const projectRaw = row.project_key ?? (typeof driver.project_key === "string" ? driver.project_key : null);
    const siblings = siblingsByDriver.get(row.driver_id) ?? [];
    const createdAts = siblings.map((item) => item.created_at);
    const carTypeRaw = typeof vehicle.car_type === "string" ? vehicle.car_type : null;
    const fuelCompanyRaw = typeof vehicle.fuel_company === "string" ? vehicle.fuel_company : null;
    const make = typeof vehicle.make === "string" ? vehicle.make : "";
    const model = typeof vehicle.model === "string" ? vehicle.model : "";
    return {
      id: row.id,
      request_code: row.request_code,
      request_type: input.type,
      vehicle_id: vehicleId,
      item: asset.item,
      quantity: asset.quantity,
      had_before: asset.had_before,
      handover_by: asset.handover_by,
      handover_at: asset.handover_at,
      status: row.status,
      current_step_label: row.current_step_label,
      department_key: row.department_key,
      department: fleetDepartmentLabel(row.department_key),
      driver_id: row.driver_id,
      driver_name: row.driver_name,
      employee_id: row.employee_id ?? (typeof driver.employee_id === "string" ? driver.employee_id : null),
      employee_company: partnerNameById.get(asId(driver.partner_id) ?? "") ?? null,
      phone: profilePhone(driver.profiles),
      project_key: isDriverProjectKey(projectRaw) ? projectRaw : null,
      zone: row.driver_zone ?? nestedName(driver.zones),
      plate: typeof vehicle.reg_number === "string" ? vehicle.reg_number : null,
      vehicle_model: [make, model].filter(Boolean).join(" ") || null,
      vehicle_company: partnerNameById.get(asId(vehicle.owner_partner_id) ?? "") ?? null,
      car_type: (isVehicleCarType(carTypeRaw) ? carTypeRaw : null) as VehicleCarType | null,
      fuel_company: (isVehicleFuelCompany(fuelCompanyRaw) ? fuelCompanyRaw : null) as VehicleFuelCompany | null,
      amount_kwd: row.amount_kwd,
      request_no_this_month: requestNumberThisMonth(row.created_at, createdAts),
      monthly_total_kwd: monthlyAmountTotal(row.created_at, siblings),
      created_at: row.created_at,
      fuel_transfer_type: stamped?.fuelTransferType ?? null,
    };
  });

  return { rows };
}
