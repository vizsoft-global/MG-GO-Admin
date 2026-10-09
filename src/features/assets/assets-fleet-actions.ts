"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
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

  let db: Firestore;
  try {
    db = await openDb();
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "not_configured" };
  }

  let assignmentRows: Row[];
  try {
    const snap = await db
      .collection(COLLECTIONS.assetAssignments)
      .orderBy("assigned_at", "desc")
      .limit(500)
      .get();
    assignmentRows = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "save_failed" };
  }

  const catalog = await rowsByIds(
    db,
    COLLECTIONS.assetCatalog,
    assignmentRows.map((row) => asId(row.catalog_item_id)).filter((id): id is string => Boolean(id)),
  );
  const catalogById = new Map(catalog.map((row) => [row.id, row]));
  const rows: Array<Row & { asset_catalog: { name: unknown; code: unknown } | null }> = assignmentRows.map(
    (row) => {
      const item = catalogById.get(asId(row.catalog_item_id) ?? "");
      return {
        ...row,
        asset_catalog: item ? { name: item.name, code: item.code } : null,
      };
    },
  );
  const driverIds = [...new Set(rows.map((row) => asId(row.driver_id)).filter(Boolean))] as string[];
  const assignmentIds = rows.map((row) => asId(row.id)).filter(Boolean) as string[];

  let drivers: Row[];
  let attachments: Row[];
  try {
    [drivers, attachments] = await Promise.all([
      rowsByIds(db, COLLECTIONS.drivers, driverIds),
      whereIn(db, "asset_assignment_attachments", "assignment_id", assignmentIds),
    ]);
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "save_failed" };
  }

  const profiles = await rowsByIds(db, COLLECTIONS.profiles, driverIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const zoneIds = drivers.map((row) => asId(row.zone_id)).filter((id): id is string => Boolean(id));
  const zoneRows = await rowsByIds(db, COLLECTIONS.zones, zoneIds);
  const zoneById = new Map(zoneRows.map((row) => [row.id, row]));

  const driverById = new Map<string, Record<string, unknown>>();
  const vehicleIds = new Set<string>();
  const partnerIds = new Set<string>();
  for (const row of drivers) {
    const zone = zoneById.get(asId(row.zone_id) ?? "");
    const profile = profileById.get(row.id);
    driverById.set(row.id, {
      ...row,
      profiles: { full_name: profile?.full_name ?? null, phone: profile?.phone ?? null },
      zones: zone ? { name: zone.name } : null,
    });
    const vehicleId = asId(row.vehicle_id);
    if (vehicleId) vehicleIds.add(vehicleId);
    const partnerId = asId(row.partner_id);
    if (partnerId) partnerIds.add(partnerId);
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

  const attachmentsByAssignment = new Map<string, FleetAssetAssignmentAttachment[]>();
  for (const raw of attachments) {
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
