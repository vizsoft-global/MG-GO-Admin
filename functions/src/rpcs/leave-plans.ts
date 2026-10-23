import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { daysLeft, type LeavePlanStatus } from "../core/operations-dashboard-math";
import { requireStaffAny, requireStaffFresh, scopedProjectKey } from "../core/staff";
import { BATCH_LIMIT, chunk, dataOf, pick, pickText, type Dict } from "./_shared";
import { bumpScanSnapshots, OPERATIONS_SNAPSHOTS } from "../router/read-snapshot";

const LEAVE_TYPES = ["annual", "emergency", "sick", "unpaid"] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];
const PROJECTS = ["keeta", "americana"] as const;
type LeaveProject = (typeof PROJECTS)[number];

type PlanWrite = {
  driver_id: string;
  employee_id: string;
  driver_name: string;
  project_key: LeaveProject;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days_count: number;
  status: LeavePlanStatus;
  year_month: string;
  note_internal: string | null;
};

function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function asLeaveType(value: string): LeaveType | null {
  switch (value) {
    case "annual":
    case "emergency":
    case "sick":
    case "unpaid":
      return value;
    default:
      return null;
  }
}

function asStatus(value: string): LeavePlanStatus | null {
  switch (value) {
    case "pending":
    case "approved":
    case "taken":
    case "rejected":
      return value;
    default:
      return null;
  }
}

function asProject(value: string): LeaveProject | null {
  switch (value.trim().toLowerCase()) {
    case "keeta":
      return "keeta";
    case "americana":
      return "americana";
    default:
      return null;
  }
}

function asDays(raw: unknown, start: string, end: string): number | null {
  if (raw === undefined || raw === null || raw === "") return daysLeft(start, end) + 1;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function parsePlan(raw: Dict): { ok: true; plan: PlanWrite } | { ok: false; code: string } {
  const driverId = pickText(raw, "driver_id", "driverId");
  if (!driverId) return { ok: false, code: "invalid_driver" };
  const start = pickText(raw, "start_date", "startDate", "start");
  const end = pickText(raw, "end_date", "endDate", "end");
  if (!start || !end || !isRealYmd(start) || !isRealYmd(end)) return { ok: false, code: "invalid_date" };
  if (end < start) return { ok: false, code: "end_before_start" };
  const leaveType = asLeaveType(pickText(raw, "leave_type", "leaveType") ?? "");
  if (!leaveType) return { ok: false, code: "invalid_leave_type" };
  const status = asStatus(pickText(raw, "status") ?? "");
  if (!status) return { ok: false, code: "invalid_status" };
  const project = asProject(pickText(raw, "project_key", "projectKey") ?? "");
  if (!project) return { ok: false, code: "invalid_project" };
  const days = asDays(pick(raw, "days_count", "daysCount", "days"), start, end);
  if (days === null) return { ok: false, code: "invalid_days" };
  return {
    ok: true,
    plan: {
      driver_id: driverId,
      employee_id: pickText(raw, "employee_id", "employeeId") ?? "",
      driver_name: pickText(raw, "driver_name", "driverName", "name") ?? "",
      project_key: project,
      leave_type: leaveType,
      start_date: start,
      end_date: end,
      days_count: days,
      status,
      year_month: start.slice(0, 7),
      note_internal: pickText(raw, "note_internal", "noteInternal", "note"),
    },
  };
}

async function driverByEmployeeId(employeeId: string): Promise<Dict | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.drivers)
    .where("employee_id", "==", employeeId)
    .limit(5)
    .get();
  const live = snap.docs.filter((doc) => dataOf(doc)["archived_at"] == null);
  if (live.length !== 1) return null;
  return { id: live[0].id, ...dataOf(live[0]) };
}

async function withDriver(raw: Dict): Promise<Dict> {
  const employeeId = pickText(raw, "employee_id", "employeeId");
  const hasDriver = Boolean(pickText(raw, "driver_id", "driverId"));
  const hasProject = Boolean(pickText(raw, "project_key", "projectKey"));
  if ((hasDriver && hasProject) || !employeeId) return raw;
  const driver = await driverByEmployeeId(employeeId);
  if (!driver) return raw;
  return {
    ...raw,
    driver_id: pickText(raw, "driver_id", "driverId") ?? driver["id"],
    project_key: pickText(raw, "project_key", "projectKey") ?? driver["project_key"],
    driver_name: pickText(raw, "driver_name", "driverName", "name") ?? driver["full_name"],
    employee_id: employeeId,
  };
}

function payload(request: { data?: unknown }): Dict {
  const data = request.data;
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Dict) : {};
}

async function requireLeaveWriter(request: CallableRequest<unknown>): Promise<{ uid: string }> {
  const staff = await requireStaffFresh(request, "operations_dashboard.view");
  if (staff.isPartner) throw new HttpsError("permission-denied", "not_authorized");
  return staff;
}

function plansCollection() {
  return getFirestore().collection(COLLECTIONS.driverLeavePlans);
}

async function readPlans(): Promise<Array<{ id: string; data: Dict }>> {
  try {
    const snap = await plansCollection().get();
    return snap.docs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "leave_plans_read_failed");
  }
}

async function commitSets(writes: Array<{ id: string; data: Dict }>): Promise<void> {
  const db = getFirestore();
  const col = plansCollection();
  try {
    for (const group of chunk(writes, BATCH_LIMIT)) {
      const batch = db.batch();
      for (const write of group) batch.set(col.doc(write.id), write.data);
      await batch.commit();
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "leave_plan_write_failed");
  }
}

export const adminListLeavePlans = onCall(async (request) => {
  const staff = await requireStaffAny(request, ["drivers.view", "operations_dashboard.view"]);
  const data = payload(request);
  const yearMonth = pickText(data, "yearMonth", "year_month");
  if (yearMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new HttpsError("invalid-argument", "invalid_month");
  }
  const project = scopedProjectKey(staff, pickText(data, "projectKey", "project_key"));
  const loaded = await readPlans();
  const rows = loaded
    .filter((row) => {
      if (yearMonth && String(row.data["year_month"] ?? "") !== yearMonth) return false;
      if (project && String(row.data["project_key"] ?? "").trim().toLowerCase() !== project) return false;
      return true;
    })
    .map((row) => {
      const copy: Dict = { id: row.id, ...row.data };
      if (staff.isPartner) delete copy["note_internal"];
      return copy;
    })
    .sort((left, right) => {
      const byStart = String(left["start_date"] ?? "").localeCompare(String(right["start_date"] ?? ""));
      if (byStart !== 0) return byStart;
      const byEmployee = String(left["employee_id"] ?? "").localeCompare(String(right["employee_id"] ?? ""));
      if (byEmployee !== 0) return byEmployee;
      return String(left["id"]).localeCompare(String(right["id"]));
    });
  return { rows };
});

export const adminUpsertLeavePlan = onCall(async (request) => {
  const staff = await requireLeaveWriter(request);
  const data = payload(request);
  const parsed = parsePlan(await withDriver(data));
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.code);
  const requestedId = pickText(data, "id", "planId", "plan_id");
  const col = plansCollection();
  const ref = requestedId ? col.doc(requestedId) : col.doc();
  let createdAt = new Date().toISOString();
  let createdBy = staff.uid;
  if (requestedId) {
    let existing: Dict | null = null;
    try {
      const snap = await ref.get();
      existing = snap.exists ? dataOf(snap) : null;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("failed-precondition", "leave_plans_read_failed");
    }
    if (existing) {
      if (typeof existing["created_at"] === "string" && existing["created_at"]) createdAt = existing["created_at"];
      if (typeof existing["created_by"] === "string" && existing["created_by"]) createdBy = existing["created_by"];
    }
  }
  const now = new Date().toISOString();
  await commitSets([
    {
      id: ref.id,
      data: { ...parsed.plan, created_by: createdBy, created_at: createdAt, updated_at: now },
    },
  ]);
  await bumpScanSnapshots(OPERATIONS_SNAPSHOTS);
  return { id: ref.id };
});

export const adminDeleteLeavePlan = onCall(async (request) => {
  await requireLeaveWriter(request);
  const id = pickText(payload(request), "id", "planId", "plan_id");
  if (!id) throw new HttpsError("invalid-argument", "missing_id");
  const ref = plansCollection().doc(id);
  try {
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "not_found");
    await ref.delete();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "leave_plan_write_failed");
  }
  await bumpScanSnapshots(OPERATIONS_SNAPSHOTS);
  return { id };
});

export const adminSetLeavePlanStatus = onCall(async (request) => {
  await requireLeaveWriter(request);
  const data = payload(request);
  const id = pickText(data, "id", "planId", "plan_id");
  if (!id) throw new HttpsError("invalid-argument", "missing_id");
  const status = asStatus(pickText(data, "status") ?? "");
  if (!status) throw new HttpsError("invalid-argument", "invalid_status");
  const ref = plansCollection().doc(id);
  try {
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "not_found");
    await ref.update({ status, updated_at: new Date().toISOString() });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "leave_plan_write_failed");
  }
  await bumpScanSnapshots(OPERATIONS_SNAPSHOTS);
  return { id, status };
});

export const adminImportLeavePlans = onCall(async (request) => {
  const staff = await requireLeaveWriter(request);
  const rawRows = payload(request)["rows"] ?? payload(request)["p_rows"];
  if (!Array.isArray(rawRows)) throw new HttpsError("invalid-argument", "invalid_rows");
  if (rawRows.length > 500) throw new HttpsError("invalid-argument", "import_too_large");
  const errors: Array<{ row: number; code: string }> = [];
  const writes: Array<{ id: string; data: Dict }> = [];
  const now = new Date().toISOString();
  const col = plansCollection();
  for (let index = 0; index < rawRows.length; index += 1) {
    const raw = rawRows[index];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push({ row: index + 1, code: "invalid_row" });
      continue;
    }
    const parsed = parsePlan(await withDriver(raw as Dict));
    if (!parsed.ok) {
      errors.push({ row: index + 1, code: parsed.code });
      continue;
    }
    const requestedId = pickText(raw as Dict, "id", "planId", "plan_id");
    writes.push({
      id: requestedId ?? col.doc().id,
      data: { ...parsed.plan, created_by: staff.uid, created_at: now, updated_at: now },
    });
  }
  await commitSets(writes);
  if (writes.length > 0) await bumpScanSnapshots(OPERATIONS_SNAPSHOTS);
  return { written: writes.length, errors };
});
