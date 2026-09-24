import type { VehicleListRow } from "../types";
import { formatReplacementSince } from "@/features/fleet/fleet-labels";
import { downloadAoaXlsx, downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import {
  VEHICLE_IMPORT_COLUMNS,
  type VehicleImportField,
} from "./vehicle-import-columns";

const EXPORT_READONLY: Array<{ header: string; value: (row: VehicleListRow) => string }> = [
  { header: "Driver", value: (row) => row.assigned_driver_name ?? "" },
  { header: "Employee Company", value: (row) => row.assigned_partner_name ?? "" },
  { header: "Cars Company", value: (row) => row.assigned_project_key ?? "" },
  { header: "Replacement", value: (row) => (row.replaces_vehicle_id ? "Yes" : "No") },
  { header: "Rep. Plate", value: (row) => row.replaces_plate ?? "" },
  {
    header: "Since",
    value: (row) => formatReplacementSince(row.replacement_started_at) ?? "",
  },
];

function writableValue(row: VehicleListRow, field: VehicleImportField): string | number {
  switch (field) {
    case "bikeId":
      return row.bike_id;
    case "regNumber":
      return row.reg_number ?? "";
    case "chassisNo":
      return row.chassis_no ?? "";
    case "kind":
      return row.vehicle_type_key;
    case "make":
      return row.make ?? "";
    case "model":
      return row.model ?? "";
    case "modelYear":
      return row.model_year ?? "";
    case "condition":
      return row.condition ?? "";
    case "chipNo":
      return row.chip_no ?? "";
    case "fuelType":
      return row.fuel_type ?? "";
    case "fuelCompany":
      return row.fuel_company ?? "";
    case "carType":
      return row.car_type ?? "";
    case "typeOfUse":
      return row.type_of_use ?? "";
    case "locationText":
      return row.location_text ?? "";
    case "status":
      return row.status;
    case "fuelMonthlyLimitKwd":
      return row.fuel_monthly_limit_kwd ?? "";
    default:
      return "";
  }
}

export function downloadVehicleListXlsx(rows: VehicleListRow[]) {
  const columns = VEHICLE_IMPORT_COLUMNS;
  const headers = [
    ...columns.map((column) => column.header),
    ...EXPORT_READONLY.map((column) => column.header),
  ];
  const aoa: Array<Array<string | number>> = [
    headers,
    ...rows.map((row) => [
      ...columns.map((column) => writableValue(row, column.field)),
      ...EXPORT_READONLY.map((column) => column.value(row)),
    ]),
  ];
  downloadAoaXlsx("vehicles.xlsx", "Vehicles", aoa);
}

export function downloadVehicleTemplate(selected: ReadonlySet<string>) {
  const columns = VEHICLE_IMPORT_COLUMNS.filter(
    (column) => column.pinned || selected.has(column.field),
  );
  const sample = columns.map((column) => column.example);
  const guide: Array<Array<string | number>> = [
    ["Column", "Required", "Allowed", "Example"],
    ...VEHICLE_IMPORT_COLUMNS.map((column) => [
      column.header,
      column.required ? "required" : "optional",
      column.allowed,
      column.example,
    ]),
  ];
  downloadWorkbookXlsx("vehicle-import-template.xlsx", [
    { name: "Vehicles", aoa: [columns.map((column) => column.header), sample] },
    { name: "Guide", aoa: guide },
  ]);
}

export function templateColumnCount(selected: ReadonlySet<string>): number {
  return VEHICLE_IMPORT_COLUMNS.filter(
    (column) => column.pinned || selected.has(column.field),
  ).length;
}

export function defaultTemplateSelection(): Set<string> {
  return new Set(
    VEHICLE_IMPORT_COLUMNS.filter((column) => !column.pinned).map((column) => column.field),
  );
}

