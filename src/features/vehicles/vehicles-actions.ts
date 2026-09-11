"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  isDriverProjectKey,
  isVehicleCarType,
  isVehicleCondition,
  isVehicleFuelCompany,
  isVehicleFuelType,
  isVehicleTypeOfUse,
  kuwaitYmdToIso,
} from "@/features/fleet/fleet-labels";
import type {
  VehicleCarType,
  VehicleCondition,
  VehicleFuelCompany,
  VehicleFuelType,
  VehicleTypeOfUse,
} from "@/features/fleet/fleet-labels";
import type {
  VehicleListRow,
  VehiclePartnerOption,
  VehicleProjectType,
  VehicleStatus,
  VehicleTypeRow,
} from "./types";

function formatError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error?.message) return "save_failed";
  if (error.code === "23505") return "duplicate_bike_id";
  return error.code ? `${error.code} — ${error.message}` : error.message;
}

async function requireVehicles(permission: "vehicles.view" | "vehicles.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function emptyText(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = emptyText(value);
  return text || null;
}

export async function listVehicleTypes(): Promise<VehicleTypeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_types")
    .select("key, label_en, label_ar, sort_order, is_active")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as VehicleTypeRow[];
}

export async function listVehiclePartners(): Promise<VehiclePartnerOption[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) throw new Error(auth.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("partners").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as VehiclePartnerOption[];
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

export async function listVehicles(): Promise<VehicleListRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const [vehiclesRes, typesRes, driversRes, partnersRes, zonesRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select(
        "id, bike_id, reg_number, chassis_no, make, model, model_year, project_type, status, vehicle_type_key, location_text, condition, car_type, type_of_use, fuel_type, fuel_company, chip_no, fuel_monthly_limit_kwd, owner_partner_id, replaces_vehicle_id, replacement_started_at, created_at",
      )
      .order("bike_id"),
    supabase.from("vehicle_types").select("key, label_en, label_ar"),
    supabase
      .from("drivers")
      .select(
        "id, driver_code, employee_id, vehicle_id, is_on_duty, partner_id, zone_id, project_key, accommodation, profiles!drivers_id_fkey(full_name, phone)",
      )
      .not("vehicle_id", "is", null)
      .is("archived_at", null),
    supabase.from("partners").select("id, name"),
    supabase.from("zones").select("id, name"),
  ]);

  if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);

  const typeLabels = new Map(
    ((typesRes.data ?? []) as Array<{ key: string; label_en: string; label_ar: string }>).map(
      (row) => [row.key, row],
    ),
  );
  const partnerNames = new Map(
    ((partnersRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );
  const zoneNames = new Map(
    ((zonesRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );
  const assigned = new Map<
    string,
    {
      id: string;
      driver_code: string;
      employee_id: string;
      name: string | null;
      phone: string | null;
      onDuty: boolean;
      project_key: string | null;
      accommodation: string | null;
      partner_name: string | null;
      zone_name: string | null;
    }
  >();
  for (const row of (driversRes.data ?? []) as Array<{
    id: string;
    driver_code: string;
    employee_id: string;
    vehicle_id: string | null;
    is_on_duty: boolean | null;
    partner_id: string | null;
    zone_id: string | null;
    project_key: string | null;
    accommodation: string | null;
    profiles: { full_name: string | null; phone: string | null } | { full_name: string | null; phone: string | null }[] | null;
  }>) {
    if (!row.vehicle_id) continue;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    assigned.set(row.vehicle_id, {
      id: row.id,
      driver_code: row.driver_code,
      employee_id: row.employee_id,
      name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      onDuty: row.is_on_duty === true,
      project_key: row.project_key,
      accommodation: row.accommodation,
      partner_name: row.partner_id ? partnerNames.get(row.partner_id) ?? null : null,
      zone_name: row.zone_id ? zoneNames.get(row.zone_id) ?? null : null,
    });
  }

  const plateById = new Map(
    ((vehiclesRes.data ?? []) as VehicleDbRow[]).map((row) => [row.id, row.reg_number]),
  );

  void logAdminRead("vehicles", "/vehicles");

  return ((vehiclesRes.data ?? []) as VehicleDbRow[]).map((row) => {
    const driver = assigned.get(row.id);
    const type = typeLabels.get(row.vehicle_type_key);
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
      type_of_use: isVehicleTypeOfUse(row.type_of_use) ? row.type_of_use : null,
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
      assigned_on_duty: driver?.onDuty === true,
      created_at: row.created_at,
    };
  });
}

export async function getVehicle(id: string): Promise<VehicleListRow | null> {
  const rows = await listVehicles();
  return rows.find((row) => row.id === id) ?? null;
}

export async function saveVehicle(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const id = emptyText(formData.get("id"));
  const bikeId = emptyText(formData.get("bikeId"));
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

  if (!bikeId) return { error: "missing_fields" };
  if (status !== "active" && status !== "suspended" && status !== "maintenance") {
    return { error: "missing_fields" };
  }

  const carType: VehicleCarType | null = isVehicleCarType(carTypeRaw) ? carTypeRaw : null;
  const condition: VehicleCondition | null = isVehicleCondition(conditionRaw) ? conditionRaw : null;
  const fuelType: VehicleFuelType | null = isVehicleFuelType(fuelTypeRaw) ? fuelTypeRaw : null;
  const fuelCompany: VehicleFuelCompany | null = isVehicleFuelCompany(fuelCompanyRaw)
    ? fuelCompanyRaw
    : null;
  const typeOfUse: VehicleTypeOfUse | null = isVehicleTypeOfUse(typeOfUseRaw) ? typeOfUseRaw : null;

  let modelYear: number | null = null;
  if (modelYearRaw) {
    const parsed = Number(modelYearRaw);
    if (!Number.isInteger(parsed) || parsed < 1990 || parsed > 2100) return { error: "missing_fields" };
    modelYear = parsed;
  }

  let fuelMonthlyLimit = limitRaw ? Number(limitRaw) : defaultFuelMonthlyLimit(vehicleTypeKey);
  if (!Number.isFinite(fuelMonthlyLimit) || fuelMonthlyLimit <= 0) {
    fuelMonthlyLimit = defaultFuelMonthlyLimit(vehicleTypeKey);
  }

  if (replacesVehicleId && replacesVehicleId === id) return { error: "invalid_replacement" };

  const replacementStartedAt = replacesVehicleId
    ? kuwaitYmdToIso(replacementStartedRaw) ?? new Date().toISOString()
    : null;

  const supabase = await createClient();
  const payload = {
    bike_id: bikeId,
    reg_number: optionalText(formData.get("regNumber")),
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
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("vehicles").update(payload).eq("id", id);
    if (error) return { error: formatError(error) };
    void logAdminMutation({
      action: "update",
      entityType: "vehicle",
      entityId: id,
      routeName: "/vehicles",
      after: payload,
    });
    return { id };
  }

  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...payload, created_by: auth.session.id })
    .select("id")
    .single();
  if (error) return { error: formatError(error) };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle",
    entityId: data.id,
    routeName: "/vehicles",
    after: payload,
  });
  return { id: data.id };
}

export async function updateVehicleTypeLabel(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const key = emptyText(formData.get("key"));
  const labelEn = emptyText(formData.get("labelEn"));
  const labelAr = emptyText(formData.get("labelAr"));
  if (!key || !labelEn || !labelAr) return { error: "missing_fields" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_types")
    .update({ label_en: labelEn, label_ar: labelAr })
    .eq("key", key);
  if (error) return { error: formatError(error) };

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_type",
    entityId: key,
    routeName: "/settings/vehicle-types",
    after: { label_en: labelEn, label_ar: labelAr },
  });
  return {};
}
