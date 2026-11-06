"use server";

import { revalidatePath } from "next/cache";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  DEFAULT_PAYROLL_CLIENTS,
  PAYROLL_CLIENT_KEY_RE,
  normalizePayrollClientKey,
  payrollClientKeyFromName,
  type PayrollClientInput,
  type PayrollClientRow,
} from "./payroll-clients";

/**
 * The client catalog behind the Employee Client dropdown, the HR Payroll Client
 * Name cell and Attendance & Orders.
 *
 * Reads are gated on either employee management (the Employee Settings dialog)
 * or payroll access (the payroll screens); writes need one of the two as well,
 * because a client is a shared dimension of both modules.
 */
export type PayrollClientError =
  | "not_authorized"
  | "not_configured"
  | "invalid_key"
  | "invalid_name"
  | "client_key_taken"
  | "system_client"
  | "client_has_riders"
  | "unknown_client"
  | "save_failed";

type SessionLike = {
  permissions: ReadonlySet<string> | string[];
  isSuperAdmin: boolean;
};

function canReadClients(session: SessionLike): boolean {
  const ticks =
    session.permissions instanceof Set ? session.permissions : new Set(session.permissions);
  return (
    hasPermissionInSet(ticks, "drivers.manage", session.isSuperAdmin) ||
    hasPermissionInSet(ticks, "payroll.view", session.isSuperAdmin) ||
    hasPermissionInSet(ticks, "payroll.manage", session.isSuperAdmin)
  );
}

async function requireReader() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
  if (!canReadClients(session)) throw new Error("not_authorized");
  return session;
}

async function requireManager() {
  const mutation = await requireMutationAuth();
  if ("error" in mutation) return { error: mutation.error } as const;
  if (!canReadClients(mutation.session)) return { error: "not_authorized" } as const;
  return { session: mutation.session } as const;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseRow(key: string, data: Record<string, unknown> | undefined): PayrollClientRow {
  const row = data ?? {};
  return {
    key,
    name: text(row.name) || key,
    nameAr: text(row.name_ar),
    isActive: row.is_active !== false,
    isSystem: row.is_system === true,
    sortOrder: num(row.sort_order, 100),
    usesZone: bool(row.uses_zone, true),
    usesOrders: bool(row.uses_orders, true),
    usesHours: bool(row.uses_hours, false),
    fullDayHours: num(row.full_day_hours, 12),
    halfDayHours: num(row.half_day_hours, 6),
    reducedHours: num(row.reduced_hours, 3),
    requiredHoursPerDay: num(row.required_hours_per_day, 12),
    defaultOffDays: num(row.default_off_days, 2),
    goodThreshold: num(row.good_threshold, 110),
    averageThreshold: num(row.average_threshold, 70),
    riderCount: 0,
  };
}

async function riderCount(db: Firestore, key: string): Promise<number> {
  const [drivers, intakes] = await Promise.all([
    db.collection(COLLECTIONS.drivers).where("project_key", "==", key).count().get(),
    db.collection(COLLECTIONS.driverIntakes).where("project_key", "==", key).count().get(),
  ]);
  return drivers.data().count + intakes.data().count;
}


/**
 * Every client, active or not, sorted the way the catalog prints them.
 *
 * An empty collection falls back to the three seeded clients so a fresh
 * environment still shows cards and a dropdown — a blank catalog must never make
 * Attendance & Orders blank.
 */
export async function listPayrollClients(): Promise<PayrollClientRow[]> {
  await requireReader();
  const db = await staffDb();
  if (!db) return [...DEFAULT_PAYROLL_CLIENTS];
  const snap = await db.collection(COLLECTIONS.payrollClients).get();
  if (snap.empty) return [...DEFAULT_PAYROLL_CLIENTS];
  const rows = snap.docs.map((doc) => parseRow(doc.id, doc.data() as Record<string, unknown>));
  // A built-in client whose document has not been seeded yet still belongs on
  // the list — absence means "never written", not "turned off". Deactivation is
  // an explicit `is_active: false` row and is honoured as one.
  for (const seeded of DEFAULT_PAYROLL_CLIENTS) {
    if (!rows.some((row) => row.key === seeded.key)) rows.push({ ...seeded });
  }
  const counts = await Promise.all(rows.map((row) => riderCount(db, row.key)));
  rows.forEach((row, index) => {
    row.riderCount = counts[index] ?? 0;
  });
  return rows.sort((left, right) =>
    left.sortOrder === right.sortOrder
      ? left.key.localeCompare(right.key)
      : left.sortOrder - right.sortOrder,
  );
}

/**
 * Create or edit one client.
 *
 * The key is the document id and therefore immutable: an edit renames the label
 * only, which is what keeps every rider's `project_key` valid. A system client
 * (`americana`, `keeta`, `five_guys`) can be renamed, deactivated and re-labelled
 * but never deleted; deactivating it is the documented way to retire it.
 */
export async function upsertPayrollClient(
  input: PayrollClientInput,
): Promise<{ error: PayrollClientError } | { ok: true; key: string }> {
  const auth = await requireManager();
  if (!("session" in auth)) return { error: auth.error ?? "not_authorized" };
  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const name = text(input.name);
  if (!name || name.length > 120) return { error: "invalid_name" };
  const key = input.key ? normalizePayrollClientKey(input.key) : payrollClientKeyFromName(name);
  if (!key || !PAYROLL_CLIENT_KEY_RE.test(key)) return { error: "invalid_key" };

  const ref = db.collection(COLLECTIONS.payrollClients).doc(key);
  const snap = await ref.get();
  const before = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  if (!before) {
    // A create must actually create; the Add dialog never overwrites an
    // existing client by typing a name that already slugs to its key.
    if (input.key) return { error: "unknown_client" };
    const seeded = DEFAULT_PAYROLL_CLIENTS.find((row) => row.key === key);
    const created = {
      name,
      name_ar: text(input.nameAr),
      is_system: false,
      is_active: bool(input.isActive, true),
      sort_order: Date.now() % 1_000_000,
      uses_zone: bool(input.usesZone, seeded?.usesZone ?? true),
      uses_orders: bool(input.usesOrders, seeded?.usesOrders ?? true),
      uses_hours: bool(input.usesHours, seeded?.usesHours ?? false),
      full_day_hours: num(input.fullDayHours, seeded?.fullDayHours ?? 12),
      half_day_hours: num(input.halfDayHours, seeded?.halfDayHours ?? 6),
      reduced_hours: num(input.reducedHours, seeded?.reducedHours ?? 3),
      required_hours_per_day: num(input.requiredHoursPerDay, seeded?.requiredHoursPerDay ?? 12),
      default_off_days: num(input.defaultOffDays, seeded?.defaultOffDays ?? 2),
      good_threshold: num(input.goodThreshold, seeded?.goodThreshold ?? 110),
      average_threshold: num(input.averageThreshold, seeded?.averageThreshold ?? 70),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    await ref.set(created);
    void logAdminMutation({
      action: "create",
      entityType: "payroll_client",
      entityId: key,
      routeName: "payroll-clients",
      before: null,
      after: { ...created, key },
    });
    revalidatePath("/settings/payroll-clients");
    revalidatePath("/payroll");
    revalidatePath("/drivers");
    return { ok: true, key };
  }

  if (before.is_system === true && !input.key) return { error: "client_key_taken" };

  const patch: Record<string, unknown> = {
    name,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (input.nameAr !== undefined) patch.name_ar = text(input.nameAr);
  if (input.isActive !== undefined) patch.is_active = bool(input.isActive, true);
  for (const [field, column, fallback] of [
    ["usesZone", "uses_zone", true],
    ["usesOrders", "uses_orders", true],
    ["usesHours", "uses_hours", false],
  ] as const) {
    if (input[field] !== undefined) patch[column] = bool(input[field], fallback);
  }
  for (const [field, column, fallback] of [
    ["fullDayHours", "full_day_hours", 12],
    ["halfDayHours", "half_day_hours", 6],
    ["reducedHours", "reduced_hours", 3],
    ["requiredHoursPerDay", "required_hours_per_day", 12],
    ["defaultOffDays", "default_off_days", 2],
    ["goodThreshold", "good_threshold", 110],
    ["averageThreshold", "average_threshold", 70],
  ] as const) {
    if (input[field] !== undefined) patch[column] = num(input[field], fallback);
  }
  await ref.set(patch, { merge: true });
  void logAdminMutation({
    action: "update",
    entityType: "payroll_client",
    entityId: key,
    routeName: "payroll-clients",
    before,
    after: { ...before, ...patch, key },
  });
  revalidatePath("/settings/payroll-clients");
  revalidatePath("/payroll");
  revalidatePath("/payroll/hr");
  revalidatePath("/drivers");
  return { ok: true, key };
}


/**
 * Delete a client that has never carried a rider.
 *
 * A system client and a client someone is still assigned to are both refused:
 * deleting either would strand the riders on a key the payroll engine can no
 * longer price. Deactivating instead hides the card and leaves the assignment
 * readable.
 */
export async function deletePayrollClient(
  key: string,
): Promise<{ error: PayrollClientError } | { ok: true }> {
  const auth = await requireManager();
  if (!("session" in auth)) return { error: auth.error ?? "not_authorized" };
  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const normalized = normalizePayrollClientKey(key);
  if (!normalized) return { error: "unknown_client" };
  const ref = db.collection(COLLECTIONS.payrollClients).doc(normalized);
  const snap = await ref.get();
  if (!snap.exists) return { error: "unknown_client" };
  const before = (snap.data() ?? {}) as Record<string, unknown>;
  if (before.is_system === true) return { error: "system_client" };
  if ((await riderCount(db, normalized)) > 0) return { error: "client_has_riders" };

  await ref.delete();
  void logAdminMutation({
    action: "delete",
    entityType: "payroll_client",
    entityId: normalized,
    routeName: "payroll-clients",
    before,
    after: null,
  });
  revalidatePath("/settings/payroll-clients");
  revalidatePath("/payroll");
  revalidatePath("/drivers");
  return { ok: true };
}

