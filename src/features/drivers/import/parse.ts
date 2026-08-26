import {
  cleanCell,
  loadStoredMapping as loadStoredMappingBase,
  saveStoredMapping as saveStoredMappingBase,
} from "@/lib/import/spreadsheet";
import { normalizeCivilId, normalizeKuwaitPhone } from "../driver-phone";
import { normalizeEmployeeId } from "../driver-errors";
import type { DriverImportMappedRow, DriverImportTargetField, DriverRiderCategory } from "../types";
import { customFieldColumnId } from "@/lib/custom-fields/types";

export function parseRiderCategory(
  raw: string | null | undefined,
): DriverRiderCategory | "invalid" | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_house" || key === "inhouse") return "in_house";
  if (key === "outsourced" || key === "outsource") return "outsourced";
  return "invalid";
}

/**
 * Reads the sheet's Active cell.
 *
 * `null` (blank) is not the same as `false`: blank means the sheet expressed no
 * opinion and the dialog's approve toggle decides, which is what keeps an
 * uploaded file that predates this column behaving exactly as it used to.
 * Anything unrecognised is `"invalid"` rather than a silent `false`, since
 * quietly not approving a batch someone marked for approval is the failure
 * this column exists to avoid.
 */
export function parseImportActive(
  raw: string | null | undefined,
): boolean | "invalid" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["yes", "y", "true", "1", "active", "approved"].includes(value)) return true;
  if (["no", "n", "false", "0", "inactive", "pending"].includes(value)) return false;
  return "invalid";
}

export function mapRowsFromSheet(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<DriverImportTargetField, string>>,
  customFieldKeys: string[] = [],
): DriverImportMappedRow[] {
  const headerIndex = new Map(headers.map((h, i) => [cleanCell(h), i]));

  return rows
    .map((row, rowIndex) => {
      const get = (field: DriverImportTargetField): string | null => {
        const src = mapping[field];
        if (!src) return null;
        const idx = headerIndex.get(cleanCell(src));
        if (idx == null) return null;
        const v = cleanCell(row[idx]);
        return v || null;
      };

      const phoneRaw = get("phone");
      const civilRaw = get("civil_id");
      const empRaw = get("employee_id");
      const custom_fields: Record<string, string | null> = {};
      for (const key of customFieldKeys) {
        const cfKey = customFieldColumnId(key) as DriverImportTargetField;
        if (!mapping[cfKey]) continue;
        custom_fields[key] = get(cfKey);
      }

      return {
        rowIndex,
        full_name: get("full_name"),
        phone: phoneRaw ? (normalizeKuwaitPhone(phoneRaw) ?? phoneRaw) : null,
        civil_id: civilRaw ? (normalizeCivilId(civilRaw) ?? civilRaw) : null,
        employee_id: empRaw ? (normalizeEmployeeId(empRaw) ?? empRaw) : null,
        partner_id: get("partner_id"),
        zone_id: get("zone_id"),
        vehicle_label: get("vehicle_label"),
        restaurant_ids: get("restaurant_ids"),
        nationality: get("nationality"),
        rider_category: get("rider_category"),
        client_id: get("client_id"),
        client_name: get("client_name"),
        active: get("active"),
        custom_fields,
      };
    })
    .filter(
      (r) =>
        r.full_name ||
        r.phone ||
        r.civil_id ||
        r.employee_id ||
        r.restaurant_ids ||
        r.partner_id ||
        r.zone_id ||
        r.nationality ||
        r.rider_category ||
        r.client_id ||
        r.client_name ||
        Object.values(r.custom_fields).some(Boolean),
    );
}

export function guessColumnMapping(
  headers: string[],
  customFieldKeys: string[] = [],
): Partial<Record<DriverImportTargetField, string>> {
  const lower = headers.map((h) => ({ raw: h, key: cleanCell(h).toLowerCase() }));
  const find = (...needles: string[]) => {
    const hit = lower.find((h) => needles.some((n) => h.key.includes(n)));
    return hit?.raw;
  };

  const mapping: Partial<Record<DriverImportTargetField, string>> = {
    full_name: find("full name", "name", "driver name"),
    phone: find("phone", "mobile", "tel"),
    civil_id: find("civil", "national id", "nid"),
    employee_id: find("emp id", "emp_id", "employee"),
    partner_id: find("partner id", "partner_id", "partner uuid", "partner"),
    zone_id: find("zone id", "zone_id", "zone uuid", "zone"),
    vehicle_label: find("vehicle", "bike", "plate"),
    restaurant_ids: find(
      "restaurant id",
      "restaurant_ids",
      "restaurant code",
      "restaurants",
      "restaurant",
      "rst-",
      "store id",
      "merchant id",
    ),
    nationality: find("nationality", "country"),
    rider_category: find("rider category", "category", "outsourced", "in house"),
    // Deliberately not a bare "client" needle: `find` returns the first header
    // matching any needle, so "client" would let a sheet carrying only Client ID
    // fill Client name with the same column.
    client_id: find("client id", "client_id", "client code"),
    client_name: find("client name", "client_name"),
    // Not "status": the intake already has a workflow status column elsewhere,
    // and guessing that one onto this field would approve drivers nobody asked
    // to approve.
    active: find("active", "approve"),
  };

  for (const key of customFieldKeys) {
    const hit = find(key.replace(/_/g, " "), key);
    if (hit) mapping[customFieldColumnId(key) as DriverImportTargetField] = hit;
  }

  return mapping;
}

export const MAPPING_STORAGE_PREFIX = "dpd-driver-import-mapping:";

export function loadStoredMapping(
  signature: string,
): Partial<Record<DriverImportTargetField, string>> | null {
  return loadStoredMappingBase<DriverImportTargetField>(
    MAPPING_STORAGE_PREFIX,
    signature,
  );
}

export function saveStoredMapping(
  signature: string,
  mapping: Partial<Record<DriverImportTargetField, string>>,
) {
  saveStoredMappingBase(MAPPING_STORAGE_PREFIX, signature, mapping);
}
