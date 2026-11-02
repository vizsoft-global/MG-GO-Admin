import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { isServiceCategoryKey, type ServiceCategoryKey } from "./service-types";
import {
  effectiveRecordCost,
  isDoneRecord,
  normaliseParts,
  odometerOf,
  recordDay,
  recordStage,
} from "./service-records-model";
import {
  DEFAULT_MAINTENANCE_SETTINGS,
  makeModelKey,
  type MaintenanceDoneRecord,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import type {
  MaintenanceScheduleRow,
  MaintenanceSettings,
  ServiceDoneRecord,
  ServicePart,
  ServiceRecordRow,
  ServiceStage,
  ServiceStageEvent,
  ServiceTypeRow,
  ServiceVehicleOption,
  ServiceVehicleSnapshot,
} from "./types";

export type Row = Record<string, unknown> & { id: string };

const SERVICE_SETTINGS_DOC = "current";
const RECORD_CAP = 3000;

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

function asRow(id: string, data: unknown): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function openDb() {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function allRows(collection: string): Promise<Row[]> {
  const db = await openDb();
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => asRow(doc.id, doc.data()));
}

export async function requireService(permission: "service.view" | "service.manage" | "service.export") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export function sessionName(session: { profile?: { full_name?: string | null } } | null): string | null {
  const name = session?.profile?.full_name;
  return name ? String(name) : null;
}

function mapParts(value: unknown): ServicePart[] {
  return Array.isArray(value) ? normaliseParts(value) : [];
}

export function mapStageHistory(value: unknown): ServiceStageEvent[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceStageEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const stage = str(row.stage);
    if (!stage) continue;
    out.push({
      stage: stage as ServiceStage,
      at: str(row.at),
      by: str(row.by) || null,
      by_name: str(row.by_name) || null,
      note: str(row.note) || null,
    });
  }
  return out;
}

function mapSnapshot(value: unknown): ServiceVehicleSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    plate: str(row.plate) || null,
    chassis_no: str(row.chassis_no) || null,
    make: str(row.make) || null,
    model: str(row.model) || null,
    model_year: num(row.model_year),
    car_type: str(row.car_type) || null,
  };
}

function mapServiceRecord(id: string, row: Row): ServiceRecordRow {
  const category = str(row.category);
  return {
    id,
    vehicle_id: str(row.vehicle_id),
    serviced_at: str(row.serviced_at) || str(row.done_at),
    kind: str(row.kind),
    description: str(row.description) || null,
    service_type_key: str(row.service_type_key) || null,
    service_type_label: str(row.service_type_label) || str(row.kind) || null,
    category: isServiceCategoryKey(category) ? (category as ServiceCategoryKey) : null,
    stage: recordStage(row),
    driver_id: str(row.driver_id) || null,
    driver_name: str(row.driver_name) || null,
    vehicle_snapshot: mapSnapshot(row.vehicle_snapshot),
    invoice_no: str(row.invoice_no) || null,
    invoice_date: str(row.invoice_date) || null,
    company: str(row.company) || null,
    odometer_km: num(row.odometer_km),
    odometer: num(row.odometer),
    cost_kwd: num(row.cost_kwd),
    vendor: str(row.vendor) || null,
    notes: str(row.notes) || null,
    parts: mapParts(row.parts),
    stage_history: mapStageHistory(row.stage_history),
    done_at: str(row.done_at) || null,
    done_odometer_km: num(row.done_odometer_km),
    created_by: str(row.created_by) || null,
    created_at: str(row.created_at) || null,
    updated_at: str(row.updated_at) || null,
  };
}

function plateOf(row: Row): string {
  return str(row.reg_number) || str(row.bike_id) || row.id;
}

/** Newest first: the done day when there is one, else the service date. */
function sortRecords(rows: ServiceRecordRow[]): ServiceRecordRow[] {
  return rows.sort((a, b) => recordDay(b).localeCompare(recordDay(a)) || b.id.localeCompare(a.id));
}

export async function listServiceRecords(): Promise<ServiceRecordRow[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const rows = await allRows(COLLECTIONS.vehicleServices);
  void logAdminRead("service_records", "/fleet/service");
  return sortRecords(rows.map((row) => mapServiceRecord(row.id, row))).slice(0, RECORD_CAP);
}

export async function getServiceRecord(id: string): Promise<ServiceRecordRow | null> {
  const auth = await requireService("service.view");
  if ("error" in auth) return null;
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicleServices).doc(id).get();
  if (!snap.exists) return null;
  return mapServiceRecord(snap.id, asRow(snap.id, snap.data()));
}

export async function listServiceRecordsForVehicle(
  vehicleId: string,
): Promise<ServiceRecordRow[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  if (!vehicleId) return [];
  const db = await openDb();
  const snap = await db
    .collection(COLLECTIONS.vehicleServices)
    .where("vehicle_id", "==", vehicleId)
    .get();
  return sortRecords(snap.docs.map((doc) => mapServiceRecord(doc.id, asRow(doc.id, doc.data()))));
}

async function driverNamesByVehicle(): Promise<
  Map<string, { id: string; name: string | null; zoneName: string | null }>
> {
  const db = await openDb();
  const drivers = await db.collection(COLLECTIONS.drivers).get();
  const ids: string[] = [];
  const rows: Row[] = [];
  for (const doc of drivers.docs) {
    const row = asRow(doc.id, doc.data());
    if (row.archived_at) continue;
    const vehicleId = str(row.vehicle_id);
    if (!vehicleId) continue;
    rows.push({ ...row, vehicle_id: vehicleId });
    ids.push(row.id);
  }
  const names = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) names.set(snap.id, str(snap.get("full_name")) || null);
  }
  const zones = await db.collection(COLLECTIONS.zones).get();
  const zoneNames = new Map<string, string>();
  for (const doc of zones.docs) {
    zoneNames.set(doc.id, str(doc.get("name")) || str(doc.get("zone_name")) || doc.id);
  }
  const map = new Map<string, { id: string; name: string | null; zoneName: string | null }>();
  for (const row of rows) {
    const zoneId = str(row.zone_id);
    map.set(str(row.vehicle_id), {
      id: row.id,
      name: names.get(row.id) ?? null,
      zoneName: zoneId ? zoneNames.get(zoneId) ?? null : null,
    });
  }
  return map;
}

export async function listServiceVehicleOptions(): Promise<ServiceVehicleOption[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const [vehicles, assigned, companies] = await Promise.all([
    allRows(COLLECTIONS.vehicles),
    driverNamesByVehicle(),
    allRows(COLLECTIONS.vehicleCompanies),
  ]);
  const companyNames = new Map<string, string>();
  for (const row of companies) {
    companyNames.set(str(row.key) || row.id, str(row.label_en) || str(row.key) || row.id);
  }
  return vehicles
    .filter((row) => !row.archived_at)
    .map((row) => {
      const driver = assigned.get(row.id);
      const companyId = str(row.company_id);
      return {
        id: row.id,
        plate: plateOf(row),
        chassis_no: str(row.chassis_no) || null,
        make: str(row.make) || null,
        model: str(row.model) || null,
        model_year: num(row.model_year),
        car_type: str(row.car_type) || null,
        company_name: companyId ? companyNames.get(companyId) ?? null : null,
        condition: str(row.condition) || null,
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? null,
        current_odometer_km: num(row.current_odometer_km),
        vehicle_type_key: str(row.vehicle_type_key) || null,
        zone_name: driver?.zoneName ?? null,
      } satisfies ServiceVehicleOption;
    })
    .sort((a, b) => a.plate.localeCompare(b.plate));
}


export async function listServiceTypes(): Promise<ServiceTypeRow[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const rows = await allRows(COLLECTIONS.serviceTypes);
  return rows
    .map((row) => {
      const category = str(row.category);
      return {
        key: str(row.key) || row.id,
        label_en: str(row.label_en) || str(row.key) || row.id,
        label_ar: str(row.label_ar),
        category: (isServiceCategoryKey(category) ? category : "other") as ServiceCategoryKey,
        is_active: row.is_active !== false,
        sort_order: num(row.sort_order) ?? 100,
        created_at: str(row.created_at) || null,
        updated_at: str(row.updated_at) || null,
      } satisfies ServiceTypeRow;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.label_en.localeCompare(b.label_en));
}

/** The single `current` settings doc, or the provisional defaults when absent. */
export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  const db = await openDb();
  const snap = await db
    .collection(COLLECTIONS.serviceMaintenanceSettings)
    .doc(SERVICE_SETTINGS_DOC)
    .get();
  if (!snap.exists) return { ...DEFAULT_MAINTENANCE_SETTINGS };
  const row = asRow(snap.id, snap.data());
  return {
    km_interval: num(row.km_interval) ?? DEFAULT_MAINTENANCE_SETTINGS.km_interval,
    day_interval: num(row.day_interval) ?? DEFAULT_MAINTENANCE_SETTINGS.day_interval,
    alert_km: num(row.alert_km) ?? DEFAULT_MAINTENANCE_SETTINGS.alert_km,
    alert_days: num(row.alert_days) ?? DEFAULT_MAINTENANCE_SETTINGS.alert_days,
    provisional: row.provisional !== false,
    approved_at: str(row.approved_at) || null,
    approved_by: str(row.approved_by) || null,
    updated_at: str(row.updated_at) || null,
    updated_by: str(row.updated_by) || null,
  };
}

export async function listMaintenanceSchedules(): Promise<MaintenanceScheduleRow[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const rows = await allRows(COLLECTIONS.vehicleMaintenanceSchedules);
  return rows
    .map((row) => ({
      id: row.id,
      scope: str(row.scope) === "vehicle" ? ("vehicle" as const) : ("model" as const),
      vehicle_id: str(row.vehicle_id) || null,
      make_model_key: str(row.make_model_key) || null,
      service_type_key: str(row.service_type_key),
      service_type_label: str(row.service_type_label) || null,
      km_interval: num(row.km_interval) ?? 0,
      day_interval: num(row.day_interval) ?? 0,
      alert_km: num(row.alert_km) ?? 0,
      alert_days: num(row.alert_days) ?? 0,
      is_active: row.is_active !== false,
      created_at: str(row.created_at) || null,
      updated_at: str(row.updated_at) || null,
    }))
    .sort((a, b) => a.service_type_key.localeCompare(b.service_type_key));
}

/** Everything the maintenance tab needs, shaped the way its pure model reads it. */
export async function listServiceMaintenanceData(): Promise<{
  vehicles: MaintenanceVehicle[];
  doneRecords: MaintenanceDoneRecord[];
  schedules: MaintenanceScheduleRow[];
  settings: MaintenanceSettings;
}> {
  const auth = await requireService("service.view");
  if ("error" in auth) {
    return {
      vehicles: [],
      doneRecords: [],
      schedules: [],
      settings: { ...DEFAULT_MAINTENANCE_SETTINGS },
    };
  }
  const [options, records, schedules, settings] = await Promise.all([
    listServiceVehicleOptions(),
    listServiceRecords(),
    listMaintenanceSchedules(),
    getMaintenanceSettings(),
  ]);
  const vehicles: MaintenanceVehicle[] = options.map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    condition: vehicle.condition,
    vehicleTypeKey: vehicle.vehicle_type_key,
    zoneName: vehicle.zone_name,
    driverName: vehicle.driver_name,
    currentKm: vehicle.current_odometer_km,
  }));
  const doneRecords: MaintenanceDoneRecord[] = records
    .filter((record) => isDoneRecord(record))
    .map((record) => ({
      id: record.id,
      vehicleId: record.vehicle_id,
      serviceTypeKey: record.service_type_key,
      doneDay: recordDay(record),
      odometerKm: odometerOf(record),
    }));
  void logAdminRead("service_maintenance", "/fleet/service");
  return { vehicles, doneRecords, schedules, settings };
}

/** Done records plus vehicle ownership — the cost report's two inputs. */
export async function listServiceReportData(): Promise<{
  records: ServiceDoneRecord[];
  vehicles: { id: string; plate: string; carType: string | null }[];
}> {
  const auth = await requireService("service.view");
  if ("error" in auth) return { records: [], vehicles: [] };
  const [records, options] = await Promise.all([
    listServiceRecords(),
    listServiceVehicleOptions(),
  ]);
  const plateById = new Map(options.map((vehicle) => [vehicle.id, vehicle.plate]));
  void logAdminRead("service_reports", "/fleet/service");
  return {
    records: records
      .filter((record) => isDoneRecord(record))
      .map((record) => ({
        id: record.id,
        vehicleId: record.vehicle_id,
        vehiclePlate:
          record.vehicle_snapshot?.plate ?? plateById.get(record.vehicle_id) ?? null,
        serviceTypeKey: record.service_type_key,
        serviceTypeLabel: record.service_type_label,
        category: (record.category ?? "other") as ServiceCategoryKey,
        vendor: record.vendor,
        costKwd: effectiveRecordCost(record),
        parts: record.parts,
        doneDay: recordDay(record),
      })),
    vehicles: options.map((vehicle) => ({
      id: vehicle.id,
      plate: vehicle.plate,
      carType: vehicle.car_type,
    })),
  };
}

/** `service.export` gate for the Excel buttons. */
export async function canExportServiceReports(): Promise<boolean> {
  const auth = await requireService("service.export");
  return !("error" in auth);
}


export async function loadVehicleRow(vehicleId: string): Promise<Row | null> {
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicles).doc(vehicleId).get();
  if (!snap.exists) return null;
  return asRow(snap.id, snap.data());
}

export async function loadServiceType(key: string) {
  if (!key) return null;
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.serviceTypes).doc(key).get();
  if (!snap.exists) return null;
  const category = str(snap.get("category"));
  return {
    label_en: str(snap.get("label_en")) || key,
    category: (isServiceCategoryKey(category) ? category : "other") as ServiceCategoryKey,
  };
}

export function vehicleSnapshotOf(row: Row): ServiceVehicleSnapshot {
  return {
    plate: str(row.reg_number) || str(row.bike_id) || null,
    chassis_no: str(row.chassis_no) || null,
    make: str(row.make) || null,
    model: str(row.model) || null,
    model_year: num(row.model_year),
    car_type: str(row.car_type) || null,
  };
}

export async function driverNameOf(driverId: string): Promise<string | null> {
  if (!driverId) return null;
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.profiles).doc(driverId).get();
  if (!snap.exists) return null;
  return str(snap.get("full_name")) || null;
}

/** Make/Model pairs already in the fleet, for the schedule dialog's picker. */
export async function listVehicleModels(): Promise<
  { key: string; label: string; vehicles: number }[]
> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const options = await listServiceVehicleOptions();
  const map = new Map<string, { key: string; label: string; vehicles: number }>();
  for (const vehicle of options) {
    const key = makeModelKey(vehicle.make, vehicle.model);
    if (!key) continue;
    const label = `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim();
    const existing = map.get(key);
    if (existing) existing.vehicles += 1;
    else map.set(key, { key, label, vehicles: 1 });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}


/** How many Done records each service type carries — the catalog's Records column. */
export async function listServiceTypeUsage(): Promise<Record<string, number>> {
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicleServices).get();
  const counts: Record<string, number> = {};
  for (const doc of snap.docs) {
    const stage = typeof doc.get("stage") === "string" ? doc.get("stage") : "";
    // A legacy row has no stage and is Done; New/Running/Cancelled never count.
    if (stage && stage !== "done") continue;
    const key = typeof doc.get("service_type_key") === "string" ? doc.get("service_type_key") : "";
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

