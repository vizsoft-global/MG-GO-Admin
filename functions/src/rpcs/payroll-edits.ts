/**
 * Payroll cell writes that the month snapshot does not own.
 *
 * Identity cells update the rider record the employees list reads
 * (drivers, the linked profile and intake, and restaurant edges).
 * Order cells write one `payroll_order_overrides` document per rider-day.
 * That number replaces recon and verified for both the grid and the rule engine.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaffFresh } from "../core/staff";
import { driverSearchStamp } from "../core/search-text";
import { logAdminActivity, pick, pickText, type Dict } from "./_shared";
import { bumpScanSnapshots, PAYROLL_SNAPSHOTS, thenBumpDriverRoster } from "../router/read-snapshot";

const EMPLOYEE_ID_RE = /^[A-Za-z0-9]{1,100}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PayrollIdentityField =
  | "employeeId"
  | "fullName"
  | "clientId"
  | "restaurantName"
  | "projectKey"
  | "zoneId";

export function applyPayrollManualOrders(
  manual: number | null,
  recon: number | null,
  verified: number,
): { orders: number; displayOrders: number; overridden: boolean } {
  if (manual != null && Number.isFinite(manual)) {
    return { orders: manual, displayOrders: manual, overridden: true };
  }
  const effective = recon ?? verified;
  return {
    orders: effective,
    displayOrders: effective,
    overridden: false,
  };
}

/** Same window as attendance adjustments: this Kuwait month and the previous two, never a future day. */
export function payrollOrderDateAllowed(date: string, today: string): boolean {
  if (!DAY.test(date) || !DAY.test(today)) return false;
  const min = `${shiftMonth(today.slice(0, 7), -2)}-01`;
  return date >= min && date <= today;
}

function shiftMonth(key: string, delta: number): string {
  const [yearText, monthText] = key.split("-");
  const index = Number(yearText) * 12 + (Number(monthText) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function argsOf(data: unknown): Dict {
  if (!data || typeof data !== "object") return {};
  return data as Dict;
}

/** A trimmed string, or `""`. Keeps the callables readable where null is noise. */
function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIdentityField(value: unknown): PayrollIdentityField {
  switch (value) {
    case "employeeId":
    case "fullName":
    case "clientId":
    case "restaurantName":
    case "projectKey":
    case "zoneId":
      return value;
    default:
      throw new HttpsError("invalid-argument", "invalid_field");
  }
}

/**
 * What the audit trail records as "was". A rename is only trustworthy if the old
 * value sits beside the new one (SOP item 13).
 */
function previousValue(driver: Dict, field: PayrollIdentityField): string | null {
  const stored = driver[IDENTITY_COLUMN[field]];
  return typeof stored === "string" && stored.trim() ? stored.trim() : null;
}

const IDENTITY_COLUMN: Record<PayrollIdentityField, string> = {
  employeeId: "employee_id",
  fullName: "full_name",
  clientId: "client_id",
  restaurantName: "restaurant_id",
  projectKey: "project_key",
  zoneId: "zone_id",
};

function clearedRestaurant(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "—" || trimmed === "-" || trimmed === "–";
}

function stampOf(raw: Dict): Record<string, string> {
  return driverSearchStamp({
    fullName: raw["full_name"],
    name: raw["name"],
    driverCode: raw["driver_code"],
    employeeId: raw["employee_id"],
    clientId: raw["client_id"],
    clientName: raw["client_name"],
    zoneName: raw["zone_name"],
    partnerName: raw["partner_name"],
    companyName: raw["company_name"],
    civilId: raw["civil_id"],
    passport: raw["passport_number"] ?? raw["passport"],
    phone: raw["phone"],
  });
}

async function assertEmployeeIdFree(driverId: string, employeeId: string, intakeId: string | null): Promise<void> {
  const db = getFirestore();
  const lower = employeeId.toLowerCase();
  const [drivers, intakes] = await Promise.all([
    db.collection(COLLECTIONS.drivers).where("employee_id_lower", "==", lower).limit(5).get(),
    db.collection(COLLECTIONS.driverIntakes).where("employee_id_lower", "==", lower).limit(5).get(),
  ]);
  if (drivers.docs.some((doc) => doc.id !== driverId)) {
    throw new HttpsError("already-exists", "employee_id_taken");
  }
  const intakeTaken = intakes.docs.some((doc) => {
    if (intakeId && doc.id === intakeId) return false;
    const linked = doc.get("linked_profile_id");
    return linked !== driverId;
  });
  if (intakeTaken) throw new HttpsError("already-exists", "employee_id_taken");
}

async function linkedIntakeId(driverId: string, driver: Dict): Promise<string | null> {
  const direct = typeof driver["intake_id"] === "string" ? driver["intake_id"].trim() : "";
  if (direct) return direct;
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverIntakes)
    .where("linked_profile_id", "==", driverId)
    .limit(1)
    .get();
  return snap.docs[0]?.id ?? null;
}

async function resolveRestaurant(name: string): Promise<{ id: string; name: string } | null> {
  const snap = await getFirestore().collection(COLLECTIONS.restaurants).select("name").get();
  const needle = name.trim().toLowerCase();
  const hits = snap.docs.filter((doc) => {
    const label = doc.get("name");
    return typeof label === "string" && label.trim().toLowerCase() === needle;
  });
  if (hits.length > 1) throw new HttpsError("failed-precondition", "ambiguous_restaurant");
  const hit = hits[0];
  if (!hit) return null;
  const label = hit.get("name");
  return { id: hit.id, name: typeof label === "string" ? label.trim() : name.trim() };
}

/**
 * Point a rider at one restaurant, or at none.
 *
 * Exported because the HR sheet's Restaurant cell needs the same write: an
 * assignment is an edge (`driver_restaurants`) plus the denormalised copy on the
 * rider and the intake, and two implementations of that would drift.
 */
export async function replaceRestaurantEdges(
  driverId: string,
  intakeId: string | null,
  restaurant: { id: string; name: string } | null,
): Promise<void> {
  const db = getFirestore();
  const [driverEdges, intakeEdges] = await Promise.all([
    db.collection(COLLECTIONS.driverRestaurants).where("driver_id", "==", driverId).get(),
    intakeId
      ? db.collection(COLLECTIONS.driverIntakeRestaurants).where("intake_id", "==", intakeId).get()
      : Promise.resolve(null),
  ]);
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  for (const doc of driverEdges.docs) batch.delete(doc.ref);
  if (intakeEdges) {
    for (const doc of intakeEdges.docs) batch.delete(doc.ref);
  }
  const ids = restaurant ? [restaurant.id] : [];
  const names = restaurant ? [restaurant.name] : [];
  const driverPatch: Dict = {
    restaurant_ids: ids,
    restaurant_names: names,
    updated_at: now,
  };
  if (restaurant) driverPatch["restaurant_id"] = restaurant.id;
  else driverPatch["restaurant_id"] = FieldValue.delete();
  batch.set(db.collection(COLLECTIONS.drivers).doc(driverId), driverPatch, { merge: true });
  if (intakeId) {
    const intakePatch: Dict = {
      restaurant_ids: ids,
      restaurant_names: names,
      updated_at: now,
    };
    if (restaurant) intakePatch["restaurant_id"] = restaurant.id;
    else intakePatch["restaurant_id"] = FieldValue.delete();
    batch.set(db.collection(COLLECTIONS.driverIntakes).doc(intakeId), intakePatch, { merge: true });
    if (restaurant) {
      batch.set(
        db.collection(COLLECTIONS.driverIntakeRestaurants).doc(`${intakeId}_${restaurant.id}`),
        { intake_id: intakeId, restaurant_id: restaurant.id, created_at: now },
        { merge: true },
      );
    }
  }
  if (restaurant) {
    batch.set(
      db.collection(COLLECTIONS.driverRestaurants).doc(`${driverId}_${restaurant.id}`),
      { driver_id: driverId, restaurant_id: restaurant.id, created_at: now },
      { merge: true },
    );
  }
  await batch.commit();
}

async function resolveActiveClientKey(
  db: ReturnType<typeof getFirestore>,
  raw: string,
): Promise<string | null> {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 24) return null;
  const candidates = trimmed === trimmed.toLowerCase() ? [trimmed] : [trimmed, trimmed.toLowerCase()];
  for (const key of candidates) {
    if (!/^[A-Za-z0-9_]{1,24}$/.test(key)) continue;
    const snap = await db.collection(COLLECTIONS.payrollClients).doc(key).get();
    if (!snap.exists || snap.get("is_active") === false) continue;
    return snap.id;
  }
  return null;
}

export const adminSavePayrollIdentity = onCall(thenBumpDriverRoster(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = argsOf(request.data);
  const driverId = pickText(data, "p_driver_id", "driver_id", "driverId");
  if (!driverId) throw new HttpsError("invalid-argument", "invalid_driver");
  const field = parseIdentityField(pick(data, "p_field", "field"));
  const value = pickText(data, "p_value", "value") ?? "";
  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) throw new HttpsError("not-found", "driver_not_found");
  const driver = driverSnap.data() ?? {};
  const intakeId = await linkedIntakeId(driverId, driver);
  const next: Dict = { ...driver };
  const patch: Dict = { updated_at: FieldValue.serverTimestamp() };

  switch (field) {
    case "employeeId": {
      const employeeId = value.trim();
      if (!EMPLOYEE_ID_RE.test(employeeId)) throw new HttpsError("invalid-argument", "invalid_employee_id");
      await assertEmployeeIdFree(driverId, employeeId, intakeId);
      next["employee_id"] = employeeId;
      patch["employee_id"] = employeeId;
      break;
    }
    case "fullName": {
      const name = value.trim();
      if (name.length < 1 || name.length > 120) throw new HttpsError("invalid-argument", "invalid_name");
      next["full_name"] = name;
      next["name"] = name;
      patch["full_name"] = name;
      patch["name"] = name;
      const profileRef = db.collection(COLLECTIONS.profiles).doc(driverId);
      const profile = await profileRef.get();
      if (profile.exists) {
        await profileRef.set({ full_name: name, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      }
      break;
    }
    case "clientId": {
      const clientId = value.trim();
      if (clientId.length > 64) throw new HttpsError("invalid-argument", "invalid_client_id");
      if (!clientId) {
        delete next["client_id"];
        patch["client_id"] = FieldValue.delete();
        patch["client_id_lower"] = FieldValue.delete();
      } else {
        next["client_id"] = clientId;
        patch["client_id"] = clientId;
      }
      break;
    }
    case "restaurantName": {
      if (clearedRestaurant(value)) {
        await replaceRestaurantEdges(driverId, intakeId, null);
      } else {
        const restaurant = await resolveRestaurant(value);
        if (!restaurant) throw new HttpsError("not-found", "unknown_restaurant");
        await replaceRestaurantEdges(driverId, intakeId, restaurant);
      }
      await logAdminActivity({
        actorId: staff.uid,
        action: "update",
        entity: "drivers",
        entityId: driverId,
        detail: { field, value: value.trim(), before: previousValue(driver, field) },
      });
      return { ok: true };
    }
    case "projectKey": {
      if (clearedRestaurant(value)) {
        delete next["project_key"];
        patch["project_key"] = FieldValue.delete();
        break;
      }
      const current = typeof driver["project_key"] === "string" ? driver["project_key"].trim() : "";
      const asked = value.trim();
      let key = await resolveActiveClientKey(db, asked);
      if (!key && current && (asked === current || asked.toLowerCase() === current.toLowerCase())) {
        key = current;
      }
      if (!key) throw new HttpsError("not-found", "unknown_client");
      next["project_key"] = key;
      patch["project_key"] = key;
      break;
    }
    case "zoneId": {
      if (clearedRestaurant(value)) {
        delete next["zone_id"];
        delete next["zone_name"];
        patch["zone_id"] = FieldValue.delete();
        patch["zone_name"] = FieldValue.delete();
        patch["zone_name_lower"] = FieldValue.delete();
        break;
      }
      const zoneId = value.trim();
      if (!zoneId || zoneId.length > 128) throw new HttpsError("not-found", "unknown_zone");
      const zone = await db.collection(COLLECTIONS.zones).doc(zoneId).get();
      const archived = zone.get("archived_at");
      if (!zone.exists || archived) throw new HttpsError("not-found", "unknown_zone");
      const zoneName = typeof zone.get("name") === "string" ? zone.get("name").trim() : "";
      next["zone_id"] = zone.id;
      next["zone_name"] = zoneName;
      patch["zone_id"] = zone.id;
      patch["zone_name"] = zoneName;
      break;
    }
    default: {
      const unknown: never = field;
      throw new HttpsError("invalid-argument", `invalid_field:${String(unknown)}`);
    }
  }

  Object.assign(patch, stampOf(next));
  await driverRef.set(patch, { merge: true });
  if (intakeId) {
    const intakePatch: Dict = { updated_at: FieldValue.serverTimestamp(), ...stampOf(next) };
    if (field === "employeeId") intakePatch["employee_id"] = patch["employee_id"];
    if (field === "fullName") {
      intakePatch["full_name"] = patch["full_name"];
      intakePatch["name"] = patch["name"];
    }
    if (field === "clientId") {
      intakePatch["client_id"] = patch["client_id"];
      if (patch["client_id_lower"]) intakePatch["client_id_lower"] = patch["client_id_lower"];
    }
    if (field === "projectKey") intakePatch["project_key"] = patch["project_key"];
    if (field === "zoneId") {
      intakePatch["zone_id"] = patch["zone_id"];
      intakePatch["zone_name"] = patch["zone_name"];
      if (patch["zone_name_lower"]) intakePatch["zone_name_lower"] = patch["zone_name_lower"];
    }
    await db.collection(COLLECTIONS.driverIntakes).doc(intakeId).set(intakePatch, { merge: true });
  }
  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "drivers",
    entityId: driverId,
    detail: { field, value: value.trim(), before: previousValue(driver, field) },
  });
  await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { ok: true };
}));

export const adminSavePayrollOrders = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = argsOf(request.data);
  const driverId = pickText(data, "p_driver_id", "driver_id", "driverId");
  const date = pickText(data, "p_date", "date", "work_date", "workDate");
  if (!driverId) throw new HttpsError("invalid-argument", "invalid_driver");
  if (!date || !payrollOrderDateAllowed(date, kuwaitToday())) {
    throw new HttpsError("failed-precondition", "date_out_of_range");
  }
  const rawOrders = pick(data, "p_orders", "orders");
  const orders = parseOrders(rawOrders);
  const db = getFirestore();
  const driver = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driver.exists) throw new HttpsError("not-found", "driver_not_found");
  const ref = db.collection(COLLECTIONS.payrollOrderOverrides).doc(`${driverId}_${date}`);
  if (orders == null) {
    await ref.delete();
  } else {
    await ref.set(
      {
        driver_id: driverId,
        work_date: date,
        orders,
        updated_by: staff.uid,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await logAdminActivity({
    actorId: staff.uid,
    action: orders == null ? "delete" : "update",
    entity: "payroll_order_overrides",
    entityId: `${driverId}_${date}`,
    detail: { orders },
  });
  await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { ok: true };
});

function parseOrders(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
    throw new HttpsError("invalid-argument", "invalid_orders");
  }
  return parsed;
}

/** Hours one rider-day may carry. `0` is a real value: the rider did not work. */
export function parseDayHours(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
    throw new HttpsError("invalid-argument", "invalid_hours");
  }
  // Half-hour precision is what the sheet carries; keep the value exact.
  return Math.round(parsed * 100) / 100;
}

/** Which projects load hours instead of orders. Americana keeps orders. */
export const UPLOAD_HOURS_PROJECTS = ["keeta", "five_guys"] as const;

export function projectLoadsHours(projectKey: string | null | undefined): boolean {
  return (UPLOAD_HOURS_PROJECTS as readonly string[]).includes((projectKey ?? "").trim().toLowerCase());
}

/**
 * One rider-day of hours for a project that loads hours instead of orders.
 *
 * Written to its own collection rather than folded into the order overrides:
 * `payroll_order_overrides` is read by the rule engine as `orders`, and writing
 * hours there would price a Keeta day against an order count that does not
 * exist. Absent + `0` is stored as a real document so "loaded and zero" is
 * distinguishable from "never loaded".
 */
export const adminSavePayrollDayHours = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = argsOf(request.data);
  const driverId = pickText(data, "p_driver_id", "driver_id", "driverId") ?? "";
  const date = pickText(data, "p_date", "date", "work_date", "workDate") ?? "";
  if (!driverId) throw new HttpsError("invalid-argument", "invalid_driver");
  if (!date || !payrollOrderDateAllowed(date, kuwaitToday())) {
    throw new HttpsError("failed-precondition", "date_out_of_range");
  }
  const rawHours = pick(data, "p_hours", "hours");
  const hours = parseDayHours(rawHours);
  const reason = (pickText(data, "p_reason", "reason") ?? "").slice(0, 200);

  const db = getFirestore();
  const driver = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driver.exists) throw new HttpsError("not-found", "driver_not_found");
  const projectKey = asString(driver.get("project_key"));
  if (!projectLoadsHours(projectKey)) {
    // An Americana day is priced on orders. Accepting hours here would create a
    // figure no screen could show.
    throw new HttpsError("failed-precondition", "project_uses_orders");
  }

  const ref = db.collection(COLLECTIONS.payrollDayHours).doc(`${driverId}_${date}`);
  const before = await ref.get();
  const previous = nullableNumber(before.get("hours"));
  if (hours == null) {
    await ref.delete();
  } else {
    await ref.set(
      {
        driver_id: driverId,
        work_date: date,
        project_key: projectKey,
        hours,
        reason: reason || null,
        updated_by: staff.uid,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await logAdminActivity({
    actorId: staff.uid,
    action: hours == null ? "delete" : "update",
    entity: "payroll_day_hours",
    entityId: `${driverId}_${date}`,
    detail: { hours, before: previous, reason: reason || null },
  });
  await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { ok: true };
});

export type DayHoursImportRow = {
  driverId: string;
  mgId: string | null;
  date: string;
  hours: number;
};

export type DayHoursImportResult = {
  ok: true;
  applied: number;
  rejected: Array<{ row: number; code: string; mgId: string | null; date: string | null }>;
};

/**
 * Operations' daily sheet: many rider-days in one write.
 *
 * The client sends already-parsed rows; **every rule is checked again here**, so
 * a tampered payload cannot load another project's rider or a future day. A
 * rejected row never blocks the rest — one bad MG ID must not cost the operator
 * the whole file — and each accepted row is audited with the reason
 * "Daily upload", which is what the manual-changes record prints.
 */
export const adminImportPayrollDayHours = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = argsOf(request.data);
  const projectKey = (pickText(data, "p_project_key", "project_key", "projectKey") ?? "")
    .trim()
    .toLowerCase();
  if (!projectLoadsHours(projectKey)) {
    throw new HttpsError("invalid-argument", "project_uses_orders");
  }
  const rawRows = pick(data, "p_rows", "rows");
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new HttpsError("invalid-argument", "empty_file");
  }
  if (rawRows.length > 2000) throw new HttpsError("invalid-argument", "row_cap_exceeded");

  const today = kuwaitToday();
  const monthPrefix = `${today.slice(0, 7)}-`;
  const db = getFirestore();

  // One roster read, not one per row: the same 900-driver scan per row is what
  // turned a 200-row file into 200 full-collection reads.
  const roster = await db
    .collection(COLLECTIONS.drivers)
    .where("archived_at", "==", null)
    .get();
  const byMgId = new Map<string, { id: string; projectKey: string }>();
  for (const doc of roster.docs) {
    const raw = doc.data();
    const keys = [asString(raw["driver_code"]), asString(raw["employee_id"]), asString(raw["client_id"])];
    const entry = { id: doc.id, projectKey: (asString(raw["project_key"]) ?? "").toLowerCase() };
    for (const key of keys) {
      if (key) byMgId.set(key.trim().toLowerCase(), entry);
    }
  }

  const rejected: DayHoursImportResult["rejected"] = [];
  const accepted: DayHoursImportRow[] = [];
  rawRows.forEach((raw, index) => {
    const row = (raw ?? {}) as Dict;
    const rowNumber = nullableNumber(pick(row, "row")) ?? index + 2;
    const mgId = (pickText(row, "mgId", "mg_id", "driver_key") ?? "").trim();
    const date = (pickText(row, "date", "work_date") ?? "").trim();
    const hoursValue = pick(row, "hours", "value");
    if (!mgId) {
      rejected.push({ row: rowNumber, code: "row_missing_id", mgId: null, date: date || null });
      return;
    }
    const hit = byMgId.get(mgId.toLowerCase());
    if (!hit) {
      rejected.push({ row: rowNumber, code: "row_unknown_id", mgId, date: date || null });
      return;
    }
    if (hit.projectKey !== projectKey) {
      rejected.push({ row: rowNumber, code: "row_other_project", mgId, date: date || null });
      return;
    }
    if (!DAY.test(date)) {
      rejected.push({ row: rowNumber, code: "row_invalid_date", mgId, date: date || null });
      return;
    }
    if (!date.startsWith(monthPrefix)) {
      rejected.push({ row: rowNumber, code: "row_outside_month", mgId, date });
      return;
    }
    if (date > today) {
      rejected.push({ row: rowNumber, code: "row_future_date", mgId, date });
      return;
    }
    const hours = typeof hoursValue === "number" ? hoursValue : Number(String(hoursValue ?? "").trim());
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      rejected.push({ row: rowNumber, code: "row_invalid_value", mgId, date });
      return;
    }
    accepted.push({ driverId: hit.id, mgId, date, hours: Math.round(hours * 100) / 100 });
  });

  const now = new Date();
  for (let index = 0; index < accepted.length; index += 400) {
    const batch = db.batch();
    for (const row of accepted.slice(index, index + 400)) {
      batch.set(
        db.collection(COLLECTIONS.payrollDayHours).doc(`${row.driverId}_${row.date}`),
        {
          driver_id: row.driverId,
          work_date: row.date,
          project_key: projectKey,
          hours: row.hours,
          source: "daily_upload",
          updated_by: staff.uid,
          updated_at: now,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "payroll_day_hours",
    entityId: `import_${now.toISOString()}`,
    detail: { project_key: projectKey, applied: accepted.length, rejected: rejected.length },
  });
  if (accepted.length > 0) await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { ok: true, applied: accepted.length, rejected } satisfies DayHoursImportResult;
});

/** Status-column choices. Worked days stay Active; Active Payroll is set by hand. */
export const CORE_STATUS_KEYS = [
  "active",
  "absent",
  "leave",
  "active_payroll",
  "accident",
  "terminated",
  "cancelled",
] as const;

export type CoreStatusKey = (typeof CORE_STATUS_KEYS)[number];

export const CORE_STATUS_LABEL: Record<CoreStatusKey, string> = {
  active: "Active",
  absent: "Absent",
  leave: "Leave",
  active_payroll: "Active Payroll",
  accident: "Accident",
  terminated: "Terminated",
  cancelled: "Cancelled",
};

const CATALOG_STATUS_KEYS = [
  "leave_return",
  "absent_mosal",
  "absent_moi",
  "on_hold",
  "new",
  "training",
  "transfer_from_company",
  "running",
  "extension",
] as const;

export type CatalogStatusKey = (typeof CATALOG_STATUS_KEYS)[number];

export const CATALOG_STATUS_LABEL: Record<CatalogStatusKey, string> = {
  leave_return: "Leave Return",
  absent_mosal: "Absent from MOSAL",
  absent_moi: "Absent from MOI",
  on_hold: "On Hold",
  new: "New",
  training: "Training",
  transfer_from_company: "Transfer from Company",
  running: "Running",
  extension: "Extension",
};

export type PayrollStatusEntry = { key: CoreStatusKey | CatalogStatusKey | "custom"; label: string };
export type PayrollStatusRoster = {
  byDriver: Record<string, PayrollStatusEntry>;
  customs: string[];
};

const MAX_STATUS_LABEL = 40;
const MAX_STATUS_CUSTOMS = 40;
const STATUS_ROSTER_DOC = "roster";

function isCoreStatusKey(value: string): value is CoreStatusKey {
  return (CORE_STATUS_KEYS as readonly string[]).includes(value);
}

function isCatalogStatusKey(value: string): value is CatalogStatusKey {
  return (CATALOG_STATUS_KEYS as readonly string[]).includes(value);
}

function foldStatusNeedle(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function catalogFromLabel(label: string): CatalogStatusKey | null {
  const needle = foldStatusNeedle(label);
  if (!needle) return null;
  if (needle === "new hire") return "new";
  for (const key of CATALOG_STATUS_KEYS) {
    if (foldStatusNeedle(key) === needle) return key;
    if (foldStatusNeedle(CATALOG_STATUS_LABEL[key]) === needle) return key;
  }
  return null;
}

function cleanStatusLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function statusLabelRejected(value: string): boolean {
  if (!value || value.length > MAX_STATUS_LABEL) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function normalizePayrollStatusChoice(input: {
  key?: string;
  label?: string;
}): PayrollStatusEntry {
  const key = (input.key ?? "").trim();
  if (isCoreStatusKey(key)) return { key, label: CORE_STATUS_LABEL[key] };
  if (isCatalogStatusKey(key)) return { key, label: CATALOG_STATUS_LABEL[key] };
  const label = cleanStatusLabel(input.label ?? "");
  if (statusLabelRejected(label)) throw new Error("invalid_status");
  const core = CORE_STATUS_KEYS.find(
    (item) => CORE_STATUS_LABEL[item].toLowerCase() === label.toLowerCase(),
  );
  if (core) return { key: core, label: CORE_STATUS_LABEL[core] };
  const catalog = catalogFromLabel(label);
  if (catalog) return { key: catalog, label: CATALOG_STATUS_LABEL[catalog] };
  return { key: "custom", label };
}

export function applyPayrollStatusRoster(
  roster: PayrollStatusRoster,
  driverId: string,
  choice: PayrollStatusEntry | null,
): PayrollStatusRoster {
  const byDriver = { ...roster.byDriver };
  const customs = [...roster.customs];
  if (!choice) {
    delete byDriver[driverId];
    return { byDriver, customs };
  }
  byDriver[driverId] = choice;
  if (choice.key === "custom") {
    const exists = customs.some((item) => item.toLowerCase() === choice.label.toLowerCase());
    if (!exists && customs.length < MAX_STATUS_CUSTOMS) customs.push(choice.label);
  }
  return { byDriver, customs };
}

function readStatusRoster(data: Dict | undefined): PayrollStatusRoster {
  const byDriver: Record<string, PayrollStatusEntry> = {};
  const rawMap = data?.by_driver;
  if (rawMap && typeof rawMap === "object") {
    for (const [id, value] of Object.entries(rawMap as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Dict;
      try {
        byDriver[id] = normalizePayrollStatusChoice({
          key: typeof row.key === "string" ? row.key : "",
          label: typeof row.label === "string" ? row.label : "",
        });
      } catch {
        // A stored row that no longer parses is dropped on the next write.
      }
    }
  }
  const customs: string[] = [];
  const rawCustoms = data?.customs;
  if (Array.isArray(rawCustoms)) {
    for (const item of rawCustoms) {
      if (typeof item !== "string") continue;
      try {
        const choice = normalizePayrollStatusChoice({ label: item });
        if (choice.key !== "custom") continue;
        if (customs.some((existing) => existing.toLowerCase() === choice.label.toLowerCase())) continue;
        if (customs.length >= MAX_STATUS_CUSTOMS) break;
        customs.push(choice.label);
      } catch {
        // Skip a custom that is blank or too long.
      }
    }
  }
  return { byDriver, customs };
}

export const adminListPayrollRiderStatuses = onCall(async (request) => {
  await requireStaffFresh(request, "payroll.view");
  const snap = await getFirestore().collection(COLLECTIONS.payrollRiderStatuses).doc(STATUS_ROSTER_DOC).get();
  return readStatusRoster(snap.exists ? (snap.data() as Dict) : undefined);
});

export const adminSavePayrollRiderStatus = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = argsOf(request.data);
  const driverId = pickText(data, "p_driver_id", "driver_id", "driverId");
  if (!driverId || driverId.length > 128) throw new HttpsError("invalid-argument", "invalid_driver");
  const clear = pick(data, "p_clear", "clear") === true;
  let choice: PayrollStatusEntry | null = null;
  if (!clear) {
    try {
      choice = normalizePayrollStatusChoice({
        key: pickText(data, "p_key", "key") ?? "",
        label: pickText(data, "p_label", "label") ?? "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_status";
      throw new HttpsError("invalid-argument", message);
    }
  }
  const db = getFirestore();
  if (choice) {
    const driver = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
    if (!driver.exists) throw new HttpsError("not-found", "driver_not_found");
  }
  const ref = db.collection(COLLECTIONS.payrollRiderStatuses).doc(STATUS_ROSTER_DOC);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const applied = applyPayrollStatusRoster(
      readStatusRoster(snap.exists ? (snap.data() as Dict) : undefined),
      driverId,
      choice,
    );
    tx.set(
      ref,
      {
        by_driver: applied.byDriver,
        customs: applied.customs,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: staff.uid,
      },
      { merge: true },
    );
    return applied;
  });
  await logAdminActivity({
    actorId: staff.uid,
    action: clear ? "delete" : "update",
    entity: "payroll_rider_statuses",
    entityId: driverId,
    detail: choice ? { key: choice.key, label: choice.label } : { clear: true },
  });
  return next;
});
