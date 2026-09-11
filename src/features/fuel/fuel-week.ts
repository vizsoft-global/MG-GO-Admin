import {
  isDriverProjectKey,
  isVehicleFuelCompany,
  isVehicleFuelType,
  toKuwaitYmd,
} from "../fleet/fleet-labels";
import type { FuelDayCell, FuelFillAttachment, FuelFillListItem, FuelWeekRow } from "./types";

const CRITICAL_RATIO = 0.9;

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asAttachments(value: unknown): FuelFillAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const kind = typeof row.kind === "string" ? row.kind : "";
    const title = typeof row.title === "string" ? row.title : kind;
    const storageKey = typeof row.storage_key === "string" ? row.storage_key : "";
    if (!kind || !storageKey) return [];
    return [
      {
        kind,
        title,
        file_name: typeof row.file_name === "string" ? row.file_name : null,
        storage_key: storageKey,
        captured_at: typeof row.captured_at === "string" ? row.captured_at : null,
        source: typeof row.source === "string" ? row.source : null,
      },
    ];
  });
}

export function parseFuelFillRow(raw: Record<string, unknown>): FuelFillListItem | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const driverId = typeof raw.driver_id === "string" ? raw.driver_id : "";
  const vehicleId = typeof raw.vehicle_id === "string" ? raw.vehicle_id : "";
  const filledAt = typeof raw.filled_at === "string" ? raw.filled_at : "";
  if (!id || !driverId || !vehicleId || !filledAt) return null;
  const projectRaw = typeof raw.project_key === "string" ? raw.project_key : null;
  const fuelTypeRaw = typeof raw.fuel_type === "string" ? raw.fuel_type : null;
  const fuelCompanyRaw = typeof raw.fuel_company === "string" ? raw.fuel_company : null;
  return {
    id,
    filled_at: filledAt,
    ymd: toKuwaitYmd(filledAt),
    litres: asNumber(raw.litres),
    cost_kwd: asNumber(raw.cost_kwd),
    station_name: typeof raw.station_name === "string" ? raw.station_name : "",
    lat: raw.lat == null ? null : asNumber(raw.lat),
    lng: raw.lng == null ? null : asNumber(raw.lng),
    driver_id: driverId,
    driver_name: typeof raw.driver_name === "string" ? raw.driver_name : null,
    driver_code: typeof raw.driver_code === "string" ? raw.driver_code : null,
    employee_id: typeof raw.employee_id === "string" ? raw.employee_id : null,
    employee_company: typeof raw.employee_company === "string" ? raw.employee_company : null,
    project_key: isDriverProjectKey(projectRaw) ? projectRaw : null,
    vehicle_id: vehicleId,
    plate: typeof raw.plate === "string" ? raw.plate : null,
    kind: typeof raw.kind === "string" ? raw.kind : null,
    model: typeof raw.model === "string" ? raw.model : null,
    fuel_type: isVehicleFuelType(fuelTypeRaw) ? fuelTypeRaw : null,
    fuel_company: isVehicleFuelCompany(fuelCompanyRaw) ? fuelCompanyRaw : null,
    chip_no: typeof raw.chip_no === "string" ? raw.chip_no : null,
    fuel_monthly_limit_kwd: raw.fuel_monthly_limit_kwd == null ? null : asNumber(raw.fuel_monthly_limit_kwd),
    vehicle_company: typeof raw.vehicle_company === "string" ? raw.vehicle_company : null,
    zone_name: typeof raw.zone_name === "string" ? raw.zone_name : null,
    attachments: asAttachments(raw.attachments),
  };
}

export function isFuelRowCritical(withdrawn: number, monthlyLimit: number): boolean {
  if (monthlyLimit <= 0) return false;
  return withdrawn / monthlyLimit > CRITICAL_RATIO;
}

export function buildFuelWeekRows(
  fills: FuelFillListItem[],
  weekDays: string[],
  monthPrefix: string,
): FuelWeekRow[] {
  const groups = new Map<string, FuelFillListItem[]>();
  for (const fill of fills) {
    const key = `${fill.vehicle_id}:${fill.driver_id}`;
    const list = groups.get(key) ?? [];
    list.push(fill);
    groups.set(key, list);
  }

  const rows: FuelWeekRow[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.filled_at.localeCompare(b.filled_at));
    const sample = list[list.length - 1];
    if (!sample) continue;
    const withdrawn = list
      .filter((fill) => fill.ymd.startsWith(monthPrefix))
      .reduce((sum, fill) => sum + fill.cost_kwd, 0);
    const monthlyLimit = sample.fuel_monthly_limit_kwd ?? 0;
    const byDay = new Map<string, FuelDayCell>();
    for (const fill of list) {
      const existing = byDay.get(fill.ymd);
      if (existing) {
        existing.costKwd += fill.cost_kwd;
        existing.litres += fill.litres;
        existing.stationName = fill.station_name || existing.stationName;
      } else {
        byDay.set(fill.ymd, {
          costKwd: fill.cost_kwd,
          litres: fill.litres,
          stationName: fill.station_name,
        });
      }
    }
    rows.push({
      key,
      driverId: sample.driver_id,
      driverName: sample.driver_name,
      employeeId: sample.employee_id,
      employeeCompany: sample.employee_company,
      vehicleId: sample.vehicle_id,
      plate: sample.plate,
      model: sample.model,
      vehicleCompany: sample.vehicle_company,
      chip: sample.chip_no,
      fuelType: sample.fuel_type,
      fuelCompany: sample.fuel_company,
      projectKey: sample.project_key,
      zone: sample.zone_name,
      monthlyLimit,
      withdrawn,
      critical: isFuelRowCritical(withdrawn, monthlyLimit),
      days: weekDays.map((day) => byDay.get(day) ?? null),
      fills: list,
    });
  }

  return rows.sort((a, b) => (a.plate ?? "").localeCompare(b.plate ?? ""));
}

export function fuelWeekMatchesSearch(row: FuelWeekRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.driverName,
    row.employeeId,
    row.employeeCompany,
    row.plate,
    row.vehicleCompany,
    row.chip,
    row.zone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function formatKwd(value: number): string {
  return value.toFixed(3);
}
