"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  isDriverProjectKey,
  isVehicleFuelType,
  type DriverProjectKey,
  type VehicleFuelType,
} from "@/features/fleet/fleet-labels";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { parseFuelFillRow } from "./fuel-week";
import type { FuelFillListItem } from "./types";

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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function requireFuelView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "fuel.view", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireFuelEdit() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "fuel.edit", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchFuelFillAttachmentUrl(
  storageKey: string,
): Promise<{ url: string | null; error?: string }> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const normalized = storageKey.trim().replace(/^\/+/, "");
  if (!normalized) return { url: null };
  const objectKey = normalized.startsWith("fuel-fills/")
    ? normalized.slice("fuel-fills/".length)
    : normalized;

  const storage = await getFirebaseStorage();
  if (!storage) return { url: null, error: "not_configured" };
  try {
    const [url] = await storage.bucket().file(`fuel-fills/${objectKey}`).getSignedUrl({
      action: "read",
      expires: Date.now() + 300_000,
    });
    return { url: url ?? null };
  } catch (error) {
    return { url: null, error: error instanceof Error ? error.message : "save_failed" };
  }
}

export async function listFuelFills(input: {
  from: string;
  to: string;
  search?: string;
  projectKey?: string | null;
  driverId?: string;
}): Promise<FuelFillListItem[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const { data, error } = await callAdminFunction<{
    ok?: boolean;
    error?: string;
    rows?: unknown;
  }>("admin_list_fuel_fills", {
    p_from: input.from,
    p_to: input.to,
    p_search: input.search?.trim() || undefined,
    p_project_key: input.projectKey || undefined,
    p_driver_id: input.driverId || undefined,
    p_limit: 2000,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);

  const payload = data;
  if (!payload?.ok) {
    throw new Error(payload?.error || "fuel_list_failed");
  }
  if (!Array.isArray(payload.rows)) return [];

  void logAdminRead("fuel_fills", input.driverId ? `/fuel/drivers/${input.driverId}` : "/fuel");
  return payload.rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const parsed = parseFuelFillRow(row as Record<string, unknown>);
    return parsed ? [parsed] : [];
  });
}

const MONTH_KEY = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OVERRIDES = "fuel_withdrawn_overrides";

export type FuelDriverHeader = {
  driverId: string;
  driverName: string | null;
  employeeId: string | null;
  plate: string | null;
  projectKey: DriverProjectKey | null;
  zone: string | null;
  monthlyLimit: number;
  fuelType: VehicleFuelType | null;
};

export async function getFuelDriverHeader(driverId: string): Promise<FuelDriverHeader | null> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);
  if (!UUID.test(driverId)) return null;

  const db = await openDb();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) return null;
  const driver = asRow(driverSnap.id, driverSnap.data());
  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(driverId).get();
  const profile = profileSnap.exists ? asRow(profileSnap.id, profileSnap.data()) : null;
  const zoneId = str(driver.zone_id);
  const zoneSnap = zoneId ? await db.collection(COLLECTIONS.zones).doc(zoneId).get() : null;
  const vehicleId = str(driver.vehicle_id);
  const vehicleSnap = vehicleId
    ? await db.collection(COLLECTIONS.vehicles).doc(vehicleId).get()
    : null;
  const vehicle = vehicleSnap?.exists ? asRow(vehicleSnap.id, vehicleSnap.data()) : null;
  const limit = Number(vehicle?.fuel_monthly_limit_kwd);
  const projectKey = typeof driver.project_key === "string" ? driver.project_key : null;
  const fuelType = typeof vehicle?.fuel_type === "string" ? vehicle.fuel_type : null;

  return {
    driverId,
    driverName: str(profile?.full_name) || null,
    employeeId: str(driver.employee_id) || null,
    plate: str(vehicle?.reg_number) || null,
    projectKey: isDriverProjectKey(projectKey) ? projectKey : null,
    zone: zoneSnap?.exists ? str(zoneSnap.data()?.name) || null : null,
    monthlyLimit: Number.isFinite(limit) ? limit : 0,
    fuelType: isVehicleFuelType(fuelType) ? fuelType : null,
  };
}

export type FuelWithdrawnOverride = {
  driverId: string;
  vehicleId: string;
  amountKwd: number;
};

export async function listFuelWithdrawnOverrides(monthKey: string): Promise<FuelWithdrawnOverride[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);
  if (!MONTH_KEY.test(monthKey)) return [];

  const db = await openDb();
  const snap = await db.collection(OVERRIDES).where("month_key", "==", monthKey).get();
  return snap.docs.flatMap((doc) => {
    const row = asRow(doc.id, doc.data());
    const amount = Number(row.amount_kwd);
    const driverId = str(row.driver_id);
    const vehicleId = str(row.vehicle_id);
    if (!driverId || !vehicleId || !Number.isFinite(amount)) return [];
    return [{ driverId, vehicleId, amountKwd: amount }];
  });
}

export async function saveFuelWithdrawnOverride(input: {
  driverId: string;
  vehicleId: string;
  monthKey: string;
  amountKwd: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFuelEdit();
  if ("error" in auth) return { ok: false, error: auth.error ?? "not_authorized" };
  if (!UUID.test(input.driverId) || !UUID.test(input.vehicleId) || !MONTH_KEY.test(input.monthKey)) {
    return { ok: false, error: "invalid" };
  }
  if (!Number.isFinite(input.amountKwd) || input.amountKwd < 0 || input.amountKwd > 999_999) {
    return { ok: false, error: "invalid_amount" };
  }
  const amountKwd = Math.round(input.amountKwd * 1000) / 1000;
  const docId = `${input.driverId}_${input.vehicleId}_${input.monthKey}`;

  const db = await openDb();
  try {
    await db.collection(OVERRIDES).doc(docId).set(
      {
        driver_id: input.driverId,
        vehicle_id: input.vehicleId,
        month_key: input.monthKey,
        amount_kwd: amountKwd,
        updated_at: new Date(),
        updated_by: auth.session.id,
      },
      { merge: true },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "save_failed" };
  }

  await logAdminMutation({
    action: "update",
    entityType: "fuel_withdrawn_overrides",
    entityId: input.vehicleId,
    routeName: "/fuel",
    after: { driverId: input.driverId, monthKey: input.monthKey, amountKwd },
  });
  return { ok: true };
}
