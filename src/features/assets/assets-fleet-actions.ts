"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { isDriverProjectKey } from "@/features/fleet/fleet-labels";
import { fetchAssetsCatalog } from "./assets-actions";
import {
  ASSET_ASSIGNMENT_ATTACHMENT_KINDS,
  FLEET_ASSET_KPI_CODES,
  type AssetAssignmentAttachmentKind,
  type FleetAssetAssignmentAttachment,
  type FleetAssetAssignmentRow,
  type FleetAssetKpi,
} from "./types";

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

function profileField(value: unknown, key: "full_name" | "phone"): string | null {
  const row = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  const text = typeof row[key] === "string" ? String(row[key]).trim() : "";
  return text || null;
}

function isAssignmentKind(value: string): value is AssetAssignmentAttachmentKind {
  return (ASSET_ASSIGNMENT_ATTACHMENT_KINDS as readonly string[]).includes(value);
}

async function requireAssetsView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "assets.view", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
}

export async function listFleetAssetKpis(): Promise<FleetAssetKpi[]> {
  const catalog = await fetchAssetsCatalog();
  return FLEET_ASSET_KPI_CODES.map((code) => {
    const item = catalog.items.find((row) => row.code === code);
    return {
      code,
      name: item?.name ?? code,
      total: item?.total_quantity ?? 0,
      used: item?.assigned_qty ?? 0,
      remaining: item?.available_qty ?? 0,
    };
  });
}

export async function listFleetAssetAssignments(): Promise<{
  rows: FleetAssetAssignmentRow[];
  error?: string;
}> {
  await requireAssetsView();
  void logAdminRead("assets", "listFleetAssetAssignments");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_assignments")
    .select(
      "id, asset_code, catalog_item_id, quantity, status, driver_id, intake_id, received_at_place, received_by_name, assigned_at, returned_at, returned_by_name, return_reason, asset_catalog(name, code)",
    )
    .order("assigned_at", { ascending: false })
    .limit(500);
  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []).map((row) => asRecord(row));
  const driverIds = [...new Set(rows.map((row) => asId(row.driver_id)).filter(Boolean))] as string[];
  const assignmentIds = rows.map((row) => asId(row.id)).filter(Boolean) as string[];

  const [driversResult, attachmentsResult] = await Promise.all([
    driverIds.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase
          .from("drivers")
          .select(
            "id, employee_id, project_key, partner_id, vehicle_id, zone_id, zones(name), profiles!drivers_id_fkey(full_name, phone)",
          )
          .in("id", driverIds),
    assignmentIds.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase
          .from("asset_assignment_attachments")
          .select("id, assignment_id, kind, title, file_name, storage_key, captured_at, source")
          .in("assignment_id", assignmentIds),
  ]);
  if (driversResult.error) return { rows: [], error: driversResult.error.message };
  if (attachmentsResult.error) return { rows: [], error: attachmentsResult.error.message };

  const driverById = new Map<string, Record<string, unknown>>();
  const vehicleIds = new Set<string>();
  const partnerIds = new Set<string>();
  for (const raw of driversResult.data ?? []) {
    const row = asRecord(raw);
    const id = asId(row.id);
    if (!id) continue;
    driverById.set(id, row);
    const vehicleId = asId(row.vehicle_id);
    if (vehicleId) vehicleIds.add(vehicleId);
    const partnerId = asId(row.partner_id);
    if (partnerId) partnerIds.add(partnerId);
  }

  const vehiclesResult =
    vehicleIds.size === 0
      ? { data: [] as Record<string, unknown>[], error: null }
      : await supabase
          .from("vehicles")
          .select("id, reg_number, model, make, owner_partner_id")
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

  const attachmentsByAssignment = new Map<string, FleetAssetAssignmentAttachment[]>();
  for (const raw of attachmentsResult.data ?? []) {
    const row = asRecord(raw);
    const assignmentId = asId(row.assignment_id);
    const kind = typeof row.kind === "string" && isAssignmentKind(row.kind) ? row.kind : null;
    if (!assignmentId || !kind) continue;
    const list = attachmentsByAssignment.get(assignmentId) ?? [];
    list.push({
      id: asId(row.id) ?? kind,
      kind,
      title: typeof row.title === "string" && row.title.trim() ? row.title : kind,
      file_name: typeof row.file_name === "string" ? row.file_name : null,
      storage_key: typeof row.storage_key === "string" ? row.storage_key : "",
      captured_at: typeof row.captured_at === "string" ? row.captured_at : null,
      source: typeof row.source === "string" ? row.source : null,
    });
    attachmentsByAssignment.set(assignmentId, list);
  }

  const mapped: FleetAssetAssignmentRow[] = rows.map((row) => {
    const id = asId(row.id) ?? "";
    const catalog = Array.isArray(row.asset_catalog)
      ? asRecord(row.asset_catalog[0])
      : asRecord(row.asset_catalog);
    const catalogCode = typeof catalog.code === "string" ? catalog.code : "";
    const catalogName = typeof catalog.name === "string" ? catalog.name : catalogCode;
    const driver = driverById.get(asId(row.driver_id) ?? "") ?? {};
    const vehicle = vehicleById.get(asId(driver.vehicle_id) ?? "") ?? {};
    const make = typeof vehicle.make === "string" ? vehicle.make : "";
    const model = typeof vehicle.model === "string" ? vehicle.model : "";
    const projectRaw = typeof driver.project_key === "string" ? driver.project_key : null;
    const storedCode = typeof row.asset_code === "string" ? row.asset_code.trim() : "";
    return {
      id,
      asset_code: storedCode || catalogCode || id.slice(0, 8),
      asset_name: catalogName || "—",
      catalog_code: catalogCode,
      quantity: row.quantity != null ? Number(row.quantity) : 1,
      status: row.status === "returned" ? "returned" : "assigned",
      driver_id: asId(row.driver_id),
      driver_name: profileField(driver.profiles, "full_name") ?? "—",
      employee_id: typeof driver.employee_id === "string" ? driver.employee_id : null,
      employee_company: partnerNameById.get(asId(driver.partner_id) ?? "") ?? null,
      phone: profileField(driver.profiles, "phone"),
      project_key: isDriverProjectKey(projectRaw) ? projectRaw : null,
      zone: nestedName(driver.zones),
      plate: typeof vehicle.reg_number === "string" ? vehicle.reg_number : null,
      vehicle_model: [make, model].filter(Boolean).join(" ") || null,
      vehicle_company: partnerNameById.get(asId(vehicle.owner_partner_id) ?? "") ?? null,
      received_at_place: typeof row.received_at_place === "string" ? row.received_at_place : null,
      received_by_name: typeof row.received_by_name === "string" ? row.received_by_name : null,
      assigned_at: typeof row.assigned_at === "string" ? row.assigned_at : "",
      returned_at: typeof row.returned_at === "string" ? row.returned_at : null,
      returned_by_name: typeof row.returned_by_name === "string" ? row.returned_by_name : null,
      return_reason: typeof row.return_reason === "string" ? row.return_reason : null,
      attachments: attachmentsByAssignment.get(id) ?? [],
    };
  });

  return { rows: mapped };
}
