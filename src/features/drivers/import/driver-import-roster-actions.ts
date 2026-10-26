"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { canViewDriverBankDetails } from "@/lib/auth/permissions";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { NONE_ZONE } from "../driver-assignment";
import { staffClient } from "../driver-uniqueness";
import { requireDriversManager } from "../drivers-import-actions";
import { DRIVER_IMPORT_EXPIRY_DOC_TYPE } from "../types";
import {
  rosterCells,
  rosterText,
  rosterYmd,
  type ImportRosterSource,
} from "./import-roster-sheet";

const EXPIRY_FIELD_BY_DOC = Object.fromEntries(
  Object.entries(DRIVER_IMPORT_EXPIRY_DOC_TYPE).map(([field, docType]) => [docType, field]),
);

export async function fetchDriverImportRoster(): Promise<
  { rows: Record<string, string>[] } | { error: "not_authorized" }
> {
  const auth = await requireDriversManager();
  if ("error" in auth) return { error: "not_authorized" };
  const includeBank = canViewDriverBankDetails(
    auth.session.permissions,
    auth.session.isSuperAdmin,
  );
  const db = await staffClient();
  const month = `${kuwaitToday().slice(0, 7)}-01`;

  const [
    intakes,
    drivers,
    profiles,
    zones,
    restaurants,
    partners,
    companies,
    vehicles,
    statuses,
    sections,
    nationalities,
    banks,
    sponsorships,
    assets,
    driverLinks,
    intakeLinks,
    assignments,
    tracking,
    offs,
  ] = await Promise.all([
    db.from("driver_intakes").select("*"),
    db.from("drivers").select("*"),
    db.from("profiles").select("id, full_name, phone"),
    db.from("zones").select("id, name, code"),
    db.from("restaurants").select("id, name, restaurant_code"),
    db.from("partners").select("id, name"),
    db.from("source_companies").select("id, name, key"),
    db.from("vehicles").select("id, bike_id, reg_number"),
    db.from("employee_statuses").select("key, label_en"),
    db.from("employee_sections").select("key, label_en"),
    db.from("nationality_categories").select("key, label_en"),
    db.from("bank_codes").select("key, label_en"),
    db.from("sponsorships").select("key, label_en"),
    db.from("asset_catalog").select("id, name, code"),
    db.from("driver_restaurants").select("driver_id, intake_id, restaurant_id"),
    db.from("driver_intake_restaurants").select("driver_id, intake_id, restaurant_id"),
    db.from("asset_assignments").select("catalog_item_id, driver_id, intake_id, status"),
    db.from("document_tracking").select("doc_type, driver_id, intake_id, expires_at, track_expiry"),
    db.from("driver_off_structure").select("driver_id, period_month, off_days").eq("period_month", month),
  ]);

  const intakeRows = asRows(intakes.data).filter((row) => !row.archived_at);
  const driverById = indexById(asRows(drivers.data));
  const profileById = indexById(asRows(profiles.data));
  const zoneById = indexById(asRows(zones.data));
  const restaurantById = indexById(asRows(restaurants.data));
  const partnerById = indexById(asRows(partners.data));
  const companyById = indexById(asRows(companies.data));
  const vehicleById = indexById(asRows(vehicles.data));
  const assetById = indexById(asRows(assets.data));
  const statusLabel = labelMap(statuses.data);
  const sectionLabel = labelMap(sections.data);
  const nationalityLabel = labelMap(nationalities.data);
  const bankLabel = labelMap(banks.data);
  const sponsorshipLabel = labelMap(sponsorships.data);

  const driverRestaurants = groupIds(asRows(driverLinks.data), "driver_id", "restaurant_id");
  const intakeRestaurants = groupIds(asRows(intakeLinks.data), "intake_id", "restaurant_id");
  const driverAssets = groupAssets(asRows(assignments.data), "driver_id", assetById);
  const intakeAssets = groupAssets(asRows(assignments.data), "intake_id", assetById);
  const driverExpiry = groupExpiry(asRows(tracking.data), "driver_id");
  const intakeExpiry = groupExpiry(asRows(tracking.data), "intake_id");
  const offByDriver = new Map<string, number>();
  for (const row of asRows(offs.data)) {
    const driverId = rosterText(row.driver_id);
    if (!driverId || typeof row.off_days !== "number") continue;
    offByDriver.set(driverId, row.off_days);
  }

  const rows = intakeRows
    .map((intake) => {
      const driverId = rosterText(intake.linked_profile_id);
      const driver = driverId ? driverById.get(driverId) ?? null : null;
      const profile = driverId ? profileById.get(driverId) : undefined;
      const restaurantIds =
        driverId && (driverRestaurants.get(driverId)?.length ?? 0) > 0
          ? driverRestaurants.get(driverId)!
          : intakeRestaurants.get(rosterText(intake.id)) ?? [];
      const source: ImportRosterSource = {
        intake,
        driver,
        profileName: rosterText(profile?.full_name),
        profilePhone: rosterText(profile?.phone),
        zoneName: zoneLabel(liveValue(driver, intake, "zone_id"), zoneById),
        restaurantNames: restaurantNames(restaurantIds, restaurantById),
        vehicleLabel: vehicleLabel(liveValue(driver, intake, "vehicle_id"), vehicleById),
        partnerName: rosterText(
          partnerById.get(rosterText(liveValue(driver, intake, "partner_id")))?.name,
        ),
        companyName: companyLabel(liveValue(driver, intake, "source_company"), companyById),
        statusLabel: catalogLabel(liveValue(driver, intake, "employee_status_key"), statusLabel),
        sectionLabels: catalogLabels(liveValue(driver, intake, "section_keys"), sectionLabel),
        nationalityLabels: catalogLabels(
          liveValue(driver, intake, "nationality_category_keys"),
          nationalityLabel,
        ),
        sponsorshipLabel: catalogLabel(liveValue(driver, intake, "sponsorship_key"), sponsorshipLabel),
        bankLabel: includeBank
          ? catalogLabel(bankCode(liveValue(driver, intake, "bank_details")), bankLabel)
          : "",
        assetNames:
          driverId && (driverAssets.get(driverId)?.length ?? 0) > 0
            ? driverAssets.get(driverId)!
            : intakeAssets.get(rosterText(intake.id)) ?? [],
        expiry: {
          ...(intakeExpiry.get(rosterText(intake.id)) ?? {}),
          ...(driverId ? driverExpiry.get(driverId) ?? {} : {}),
        },
        offDays: driverId && offByDriver.has(driverId) ? offByDriver.get(driverId)! : null,
        accountActive: rosterText(driver?.account_status ?? driver?.status) === "active",
        includeBank,
      };
      return source;
    })
    .sort((a, b) => {
      const id = rosterText(a.driver?.employee_id ?? a.intake.employee_id).localeCompare(
        rosterText(b.driver?.employee_id ?? b.intake.employee_id),
        undefined,
        { numeric: true },
      );
      if (id !== 0) return id;
      return (a.profileName || rosterText(a.intake.full_name)).localeCompare(
        b.profileName || rosterText(b.intake.full_name),
      );
    });

  void logAdminRead("driver_intakes", "fetchDriverImportRoster", { count: rows.length });
  return { rows: rows.map(rosterCells) };
}

function liveValue(
  driver: Record<string, unknown> | null,
  intake: Record<string, unknown>,
  key: string,
): unknown {
  if (driver && Object.prototype.hasOwnProperty.call(driver, key)) return driver[key];
  return intake[key];
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

function indexById(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = rosterText(row.id);
    if (id) map.set(id, row);
  }
  return map;
}

function labelMap(data: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of asRows(data)) {
    const key = rosterText(row.key);
    if (key) map.set(key, rosterText(row.label_en) || key);
  }
  return map;
}

function catalogLabel(value: unknown, labels: Map<string, string>): string {
  const key = rosterText(value);
  if (!key) return "";
  return labels.get(key) ?? key;
}

function catalogLabels(value: unknown, labels: Map<string, string>): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((key) => catalogLabel(key, labels)).filter(Boolean);
}

function groupIds(
  rows: Record<string, unknown>[],
  ownerKey: string,
  valueKey: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const owner = rosterText(row[ownerKey]);
    const value = rosterText(row[valueKey]);
    if (!owner || !value) continue;
    const list = map.get(owner) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(owner, list);
  }
  return map;
}

function restaurantNames(
  ids: readonly string[],
  restaurants: Map<string, Record<string, unknown>>,
): string[] {
  return [...new Set(ids)]
    .map((id) => {
      const row = restaurants.get(id);
      return rosterText(row?.name) || rosterText(row?.restaurant_code) || id;
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function zoneLabel(value: unknown, zones: Map<string, Record<string, unknown>>): string {
  const id = rosterText(value);
  if (!id || id === NONE_ZONE) return "";
  const zone = zones.get(id);
  return rosterText(zone?.name) || rosterText(zone?.code) || id;
}

function vehicleLabel(value: unknown, vehicles: Map<string, Record<string, unknown>>): string {
  const id = rosterText(value);
  if (!id) return "";
  const vehicle = vehicles.get(id);
  return rosterText(vehicle?.bike_id) || rosterText(vehicle?.reg_number);
}

function companyLabel(value: unknown, companies: Map<string, Record<string, unknown>>): string {
  const token = rosterText(value);
  if (!token) return "";
  const company =
    companies.get(token) ??
    [...companies.values()].find(
      (row) => rosterText(row.key).toLowerCase() === token.toLowerCase(),
    );
  if (company) return rosterText(company.name) || rosterText(company.key);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token) ? "" : token;
}

function bankCode(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return rosterText((value as { bank_code?: unknown }).bank_code);
}

function groupAssets(
  rows: Record<string, unknown>[],
  ownerKey: string,
  catalog: Map<string, Record<string, unknown>>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (rosterText(row.status) !== "assigned") continue;
    const owner = rosterText(row[ownerKey]);
    const item = catalog.get(rosterText(row.catalog_item_id));
    const name = rosterText(item?.name) || rosterText(item?.code);
    if (!owner || !name) continue;
    const list = map.get(owner) ?? [];
    if (!list.includes(name)) list.push(name);
    map.set(owner, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.localeCompare(b));
  return map;
}

function groupExpiry(
  rows: Record<string, unknown>[],
  ownerKey: string,
): Map<string, ImportRosterSource["expiry"]> {
  const map = new Map<string, ImportRosterSource["expiry"]>();
  for (const row of rows) {
    if (row.track_expiry !== true) continue;
    const owner = rosterText(row[ownerKey]);
    const field = EXPIRY_FIELD_BY_DOC[rosterText(row.doc_type)];
    const date = rosterYmd(row.expires_at);
    if (!owner || !field || !date) continue;
    const bag = map.get(owner) ?? {};
    bag[field as keyof ImportRosterSource["expiry"]] = date;
    map.set(owner, bag);
  }
  return map;
}
