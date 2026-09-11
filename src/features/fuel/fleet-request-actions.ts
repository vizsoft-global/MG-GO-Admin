"use server";

import {
  isDriverProjectKey,
  isVehicleCarType,
  isVehicleFuelCompany,
  type VehicleCarType,
  type VehicleFuelCompany,
} from "@/features/fleet/fleet-labels";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import { createClient } from "@/lib/supabase/server";
import type { FleetRequestListRow } from "./fleet-request-types";
import { isAssetFirstTime } from "@/features/requests/request-create-utils";
import {
  fleetDepartmentLabel,
  monthlyAmountTotal,
  requestNumberThisMonth,
  resolveFleetRequestVehicleId,
  type FleetQueueRequestType,
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

export async function listFleetRequests(input: {
  type: FleetQueueRequestType;
}): Promise<{ rows: FleetRequestListRow[]; error?: string }> {
  const list = await fetchAdminRequestsList({
    datePreset: "all",
    type: input.type,
    limit: 200,
    offset: 0,
  });
  if (list.error) return { rows: [], error: list.error };

  const driverIds = [...new Set(list.rows.map((row) => row.driver_id).filter(Boolean))];
  const supabase = await createClient();

  const requestIds = list.rows.map((row) => row.id);
  const [driversResult, siblingsResult, fillsResult, stampedResult] = await Promise.all([
    driverIds.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase
          .from("drivers")
          .select(
            "id, employee_id, project_key, partner_id, vehicle_id, zone_id, zones(name), profiles!drivers_id_fkey(phone)",
          )
          .in("id", driverIds),
    supabase.from("requests").select("driver_id, created_at, amount_kwd").eq("request_type", input.type),
    driverIds.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase
          .from("fuel_fills")
          .select("driver_id, vehicle_id, filled_at")
          .in("driver_id", driverIds)
          .order("filled_at", { ascending: false }),
    requestIds.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase.from("requests").select("id, vehicle_id, payload").in("id", requestIds),
  ]);

  if (driversResult.error) return { rows: [], error: driversResult.error.message };
  if (siblingsResult.error) return { rows: [], error: siblingsResult.error.message };
  if (fillsResult.error) return { rows: [], error: fillsResult.error.message };
  if (stampedResult.error) return { rows: [], error: stampedResult.error.message };

  const driverById = new Map<string, Record<string, unknown>>();
  for (const raw of driversResult.data ?? []) {
    const row = asRecord(raw);
    const id = asId(row.id);
    if (id) driverById.set(id, row);
  }

  const fillVehicleByDriver = new Map<string, string>();
  for (const raw of fillsResult.data ?? []) {
    const row = asRecord(raw);
    const driverId = asId(row.driver_id);
    const vehicleId = asId(row.vehicle_id);
    if (driverId && vehicleId && !fillVehicleByDriver.has(driverId)) {
      fillVehicleByDriver.set(driverId, vehicleId);
    }
  }

  const stampedByRequest = new Map<string, { vehicleId: string | null; payload: Record<string, unknown> }>();
  for (const raw of stampedResult.data ?? []) {
    const row = asRecord(raw);
    const id = asId(row.id);
    if (!id) continue;
    stampedByRequest.set(id, {
      vehicleId: asId(row.vehicle_id),
      payload: asRecord(row.payload),
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

  const vehiclesResult =
    vehicleIds.size === 0
      ? { data: [] as Record<string, unknown>[], error: null }
      : await supabase
          .from("vehicles")
          .select("id, reg_number, model, make, car_type, fuel_company, owner_partner_id")
          .in("id", [...vehicleIds]);
  if (vehiclesResult.error) return { rows: [], error: vehiclesResult.error.message };

  const vehicleById = new Map<string, Record<string, unknown>>();
  for (const raw of vehiclesResult.data ?? []) {
    const row = asRecord(raw);
    const id = asId(row.id);
    if (id) vehicleById.set(id, row);
    const ownerId = asId(row.owner_partner_id);
    if (ownerId) partnerIds.add(ownerId);
  }

  const partnersResult =
    partnerIds.size === 0
      ? { data: [] as Array<{ id: string; name: string }>, error: null }
      : await supabase.from("partners").select("id, name").in("id", [...partnerIds]);
  if (partnersResult.error) return { rows: [], error: partnersResult.error.message };

  const partnerNameById = new Map(
    ((partnersResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );

  const siblingsByDriver = new Map<string, Array<{ created_at: string; amount_kwd: number | null }>>();
  for (const raw of siblingsResult.data ?? []) {
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

  const rows: FleetRequestListRow[] = list.rows.map((row) => {
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
    };
  });

  return { rows };
}
