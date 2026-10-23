import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import {
  daysLeft,
  isLeavePlanStatus,
  jobEndWindow,
  mapRequestLeave,
  mergeLeaveRows,
  monthCountsLeave,
  renewalDecision,
  turnoverComparison,
  turnoverRate,
} from "../core/operations-dashboard-math";
import { requireStaff, scopedProjectKey } from "../core/staff";
import { dataOf, pickText, type Dict } from "./_shared";

type DriverRow = {
  id: string;
  name: string;
  employeeId: string;
  project: string;
  status: string;
  archived: boolean;
  archivedAt: string | null;
  workStart: string | null;
  jobEnd: string | null;
  jobEndDescription: string;
  zoneId: string;
  vehicle: string;
};

type LeaveRow = {
  id: string;
  driverId: string;
  employeeId: string;
  name: string;
  project: string;
  leaveType: string;
  start: string;
  end: string;
  days: number;
  status: string;
  yearMonth: string;
  source: "plan" | "request";
};

type BarKey = "working" | "sick" | "onLeave" | "absent" | "other";

type Departure = {
  employeeId: string;
  name: string;
  date: string;
  kind: "archived" | "job_end";
};

const OPS_STATUS_KEYS = ["running", "extension", "leave", "new", "absent_from_mosal", "cancelled"] as const;
const CLIENT_STATUS_KEYS = ["running", "extension", "leave", "new", "cancelled"] as const;

function payloadOf(request: { data?: unknown }): Dict {
  const data = request.data;
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Dict) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function toYmd(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : kuwaitDayString(parsed);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : kuwaitDayString(value);
  if (value instanceof Timestamp) return kuwaitDayString(value.toDate());
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? kuwaitDayString(date) : null;
  }
  return null;
}

function projectOf(value: unknown): string {
  const key = text(value).toLowerCase();
  return key || "unassigned";
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const index = Number(yearMonth.slice(0, 4)) * 12 + (Number(yearMonth.slice(5, 7)) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function endOfMonth(yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

async function readOrFail<T>(code: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", code);
  }
}

function parseDriver(id: string, data: Dict): DriverRow {
  const archivedAt = toYmd(data["archived_at"]);
  return {
    id,
    name: text(data["full_name"]),
    employeeId: text(data["employee_id"]),
    project: projectOf(data["project_key"]),
    status: text(data["employee_status_key"]).toLowerCase(),
    archived: data["archived_at"] != null && data["archived_at"] !== "" && data["archived_at"] !== false,
    archivedAt,
    workStart: toYmd(data["work_start_date"]),
    jobEnd: toYmd(data["job_end_date"]),
    jobEndDescription: text(data["job_end_description"]),
    zoneId: text(data["zone_id"]),
    vehicle: text(data["vehicle_type_key"]).toLowerCase(),
  };
}

function parseLeave(id: string, data: Dict): LeaveRow {
  const start = text(data["start_date"]);
  const end = text(data["end_date"]);
  const storedDays = data["days_count"];
  const days =
    typeof storedDays === "number" && Number.isFinite(storedDays)
      ? storedDays
      : isRealYmd(start) && isRealYmd(end)
        ? daysLeft(start, end) + 1
        : 0;
  return {
    id,
    driverId: text(data["driver_id"]),
    employeeId: text(data["employee_id"]),
    name: text(data["driver_name"]),
    project: projectOf(data["project_key"]),
    leaveType: text(data["leave_type"]).toLowerCase(),
    start,
    end,
    days,
    status: text(data["status"]).toLowerCase(),
    yearMonth: text(data["year_month"]) || (start.length >= 7 ? start.slice(0, 7) : ""),
    source: "plan",
  };
}

function indexLeaves(plans: LeaveRow[]): Map<string, LeaveRow[]> {
  const map = new Map<string, LeaveRow[]>();
  for (const plan of plans) {
    const list = map.get(plan.driverId);
    if (list) list.push(plan);
    else map.set(plan.driverId, [plan]);
  }
  return map;
}

function covers(plan: LeaveRow, day: string): boolean {
  return plan.start !== "" && plan.end !== "" && plan.start <= day && plan.end >= day;
}

function covering(plans: LeaveRow[], day: string): LeaveRow[] {
  return plans.filter((plan) => plan.status !== "rejected" && covers(plan, day));
}

function classify(driver: DriverRow, day: string, todayYm: string, plans: LeaveRow[], checkedIn: boolean): BarKey {
  if (checkedIn) return "working";
  const open = covering(plans, day);
  if (open.some((plan) => plan.leaveType === "sick")) return "sick";
  if (open.length > 0 || driver.status === "leave") return "onLeave";
  if (driver.status === "cancelled" || driver.status === "absent_from_mosal") return "absent";
  const joinedThisMonth = driver.workStart !== null && driver.workStart.slice(0, 7) === todayYm;
  if (driver.status === "suspended" || driver.status === "awaiting_documents" || joinedThisMonth) return "other";
  return "absent";
}

function tally(
  drivers: DriverRow[],
  day: string,
  todayYm: string,
  byDriver: Map<string, LeaveRow[]>,
  checkedIn: Set<string>,
) {
  const statusBar: Record<BarKey, number> = { working: 0, sick: 0, onLeave: 0, absent: 0, other: 0 };
  let accident = 0;
  for (const driver of drivers) {
    if (driver.archived) continue;
    const key = classify(driver, day, todayYm, byDriver.get(driver.id) ?? [], checkedIn.has(driver.id));
    statusBar[key] += 1;
    if (driver.status === "accident") accident += 1;
  }
  const assigned = statusBar.working + statusBar.sick + statusBar.onLeave + statusBar.absent + statusBar.other;
  return {
    statusBar,
    kpis: {
      assigned,
      working: statusBar.working,
      onLeave: statusBar.onLeave,
      absent: statusBar.absent,
      sick: statusBar.sick,
      other: statusBar.other,
      accident,
      workingRate: turnoverRate(statusBar.working, assigned),
    },
  };
}

function projectSort(left: string, right: string): number {
  const rank = (key: string): number => {
    switch (key) {
      case "keeta":
        return 0;
      case "americana":
        return 1;
      case "unassigned":
        return 3;
      default:
        return 2;
    }
  };
  const byRank = rank(left) - rank(right);
  return byRank !== 0 ? byRank : left.localeCompare(right);
}

function byProject(
  drivers: DriverRow[],
  day: string,
  todayYm: string,
  byDriver: Map<string, LeaveRow[]>,
  checkedIn: Set<string>,
) {
  const keys = new Set<string>(["keeta", "americana", "unassigned"]);
  for (const driver of drivers) {
    if (!driver.archived) keys.add(driver.project);
  }
  const rows = [...keys].sort(projectSort).map((project) => {
    const counts = tally(
      drivers.filter((driver) => driver.project === project),
      day,
      todayYm,
      byDriver,
      checkedIn,
    );
    return { project, ...counts.kpis, share: 0 };
  });
  const total = rows.reduce((sum, row) => sum + row.assigned, 0);
  return rows.map((row) => ({ ...row, share: turnoverRate(row.assigned, total) }));
}

function statusTiles(drivers: DriverRow[], keys: readonly string[]) {
  const live = drivers.filter((driver) => !driver.archived);
  return keys.map((key) => ({
    key,
    count: live.filter((driver) => driver.status === key).length,
  }));
}

function leaveMonthRows(plans: LeaveRow[], today: string, todayYm: string) {
  const rows: Array<{ yearMonth: string; count: number; tense: "past" | "current" | "future" }> = [];
  for (let delta = -6; delta <= 5; delta += 1) {
    const yearMonth = shiftMonth(todayYm, delta);
    const tense = delta < 0 ? "past" : delta === 0 ? "current" : "future";
    let count = 0;
    for (const plan of plans) {
      if (plan.yearMonth !== yearMonth || !isLeavePlanStatus(plan.status)) continue;
      if (monthCountsLeave(plan.status, yearMonth, todayYm, covers(plan, today))) count += 1;
    }
    rows.push({ yearMonth, count, tense });
  }
  return rows;
}

function leaveRecord(plan: LeaveRow): Dict {
  return {
    id: plan.id,
    driver_id: plan.driverId,
    employee_id: plan.employeeId,
    driver_name: plan.name,
    project_key: plan.project,
    leave_type: plan.leaveType,
    start_date: plan.start,
    end_date: plan.end,
    days_count: plan.days,
    status: plan.status,
    year_month: plan.yearMonth,
    source: plan.source,
  };
}

function leaveCsv(plan: LeaveRow): Dict {
  return {
    "Employee ID": plan.employeeId,
    Name: plan.name,
    Project: plan.project,
    "Leave Type": plan.leaveType,
    Start: plan.start,
    End: plan.end,
    Days: plan.days,
    Status: plan.status,
  };
}

function outlookLeave(plan: LeaveRow): Dict {
  return {
    driverId: plan.driverId,
    employeeId: plan.employeeId,
    name: plan.name,
    projectKey: plan.project,
    leaveType: plan.leaveType,
    status: plan.status,
    startDate: plan.start,
    endDate: plan.end,
  };
}

function outlook(drivers: DriverRow[], plans: LeaveRow[], today: string) {
  const weekEnd = addDays(today, 6);
  const open = (plan: LeaveRow) => plan.status === "approved" || plan.status === "taken";
  const returningThisWeek = plans
    .filter((plan) => open(plan) && plan.end >= today && plan.end <= weekEnd)
    .sort((left, right) => left.end.localeCompare(right.end) || left.name.localeCompare(right.name))
    .map(outlookLeave);
  const startingThisWeek = plans
    .filter((plan) => open(plan) && plan.start >= today && plan.start <= weekEnd)
    .sort((left, right) => left.start.localeCompare(right.start) || left.name.localeCompare(right.name))
    .map(outlookLeave);
  const pendingApproval = plans
    .filter((plan) => plan.status === "pending" && plan.start >= today)
    .sort((left, right) => left.start.localeCompare(right.start) || left.name.localeCompare(right.name))
    .map(outlookLeave);
  const overdue = plans
    .filter(
      (plan) =>
        (plan.status === "pending" || plan.status === "approved") && plan.end !== "" && plan.end < today,
    )
    .sort((left, right) => left.end.localeCompare(right.end) || left.name.localeCompare(right.name))
    .map(outlookLeave);
  const [year, month, day] = today.split("-").map(Number);
  const sinceSaturday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 1) % 7;
  const weekStart = addDays(today, -sinceSaturday);
  const kuwaitWeekEnd = addDays(weekStart, 6);
  const newJoiners = drivers
    .filter(
      (driver) =>
        !driver.archived &&
        driver.workStart !== null &&
        driver.workStart >= weekStart &&
        driver.workStart <= kuwaitWeekEnd,
    )
    .sort((left, right) => (left.workStart ?? "").localeCompare(right.workStart ?? "") || left.name.localeCompare(right.name))
    .map((driver) => ({
      driverId: driver.id,
      employeeId: driver.employeeId,
      name: driver.name,
      projectKey: driver.project,
      workStartDate: driver.workStart,
    }));
  return { returningThisWeek, startingThisWeek, pendingApproval, overdue, newJoiners };
}

function jobEndRow(driver: DriverRow, today: string): Dict {
  return {
    driverId: driver.id,
    employeeId: driver.employeeId,
    name: driver.name,
    projectKey: driver.project,
    status: driver.status,
    workStartDate: driver.workStart,
    jobEndDate: driver.jobEnd,
    daysLeft: driver.jobEnd ? daysLeft(today, driver.jobEnd) : null,
    renewal: renewalDecision(driver.jobEndDescription, driver.jobEnd),
  };
}

function jobEndCsv(driver: DriverRow, today: string): Dict {
  const renewal = renewalDecision(driver.jobEndDescription, driver.jobEnd);
  return {
    "Employee ID": driver.employeeId,
    Name: driver.name,
    Project: driver.project,
    Status: driver.status,
    "Joining Date": driver.workStart ?? "",
    "Job End Date": driver.jobEnd ?? "",
    "Days Left": driver.jobEnd ? daysLeft(today, driver.jobEnd) : "",
    "Renewal Decision": renewal ?? "",
  };
}

function liveOf(drivers: DriverRow[]): DriverRow[] {
  return drivers.filter((driver) => !driver.archived);
}

function jobEndBlocks(drivers: DriverRow[], today: string) {
  const live = liveOf(drivers);
  const window = jobEndWindow(today);
  const months = window.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    count: live.filter((driver) => {
      if (!driver.jobEnd || driver.jobEnd.slice(0, 7) !== bucket.key) return false;
      if (index === 0 && driver.jobEnd < today) return false;
      return true;
    }).length,
  }));
  const dated = live.filter((driver) => driver.jobEnd);
  const card = (rows: DriverRow[]) => ({
    count: rows.length,
    rows: rows
      .sort((left, right) => (left.jobEnd ?? "").localeCompare(right.jobEnd ?? "") || left.name.localeCompare(right.name))
      .map((driver) => jobEndRow(driver, today)),
  });
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const horizon = endOfMonth(window[window.length - 1]?.key ?? today.slice(0, 7));
  return {
    months,
    cards: {
      next30: card(dated.filter((driver) => {
        const left = daysLeft(today, driver.jobEnd ?? today);
        return left >= 0 && left <= 30;
      })),
      eoy: card(dated.filter((driver) => (driver.jobEnd ?? "") >= today && (driver.jobEnd ?? "") <= yearEnd)),
      next6m: card(dated.filter((driver) => (driver.jobEnd ?? "") >= today && (driver.jobEnd ?? "") <= horizon)),
      noRenewal: card(
        live.filter((driver) => renewalDecision(driver.jobEndDescription, driver.jobEnd) === "no_renewal"),
      ),
    },
  };
}

function ridersOnLeave(drivers: DriverRow[], byDriver: Map<string, LeaveRow[]>, today: string) {
  const rows: Dict[] = [];
  for (const driver of liveOf(drivers)) {
    const open = covering(byDriver.get(driver.id) ?? [], today);
    if (open.length === 0) continue;
    const endDate = open.reduce((latest, plan) => (plan.end > latest ? plan.end : latest), open[0]?.end ?? "");
    const startDate = open.reduce((earliest, plan) => (plan.start < earliest ? plan.start : earliest), open[0]?.start ?? "");
    const left = daysLeft(today, endDate);
    rows.push({
      driverId: driver.id,
      employeeId: driver.employeeId,
      name: driver.name,
      projectKey: driver.project,
      leaveType: open[0]?.leaveType ?? "",
      startDate,
      endDate,
      returnWithin3Days: left >= 0 && left <= 3,
    });
  }
  return rows.sort((left, right) => String(left["endDate"]).localeCompare(String(right["endDate"])));
}

function departuresOf(drivers: DriverRow[]): Departure[] {
  const rows: Departure[] = [];
  for (const driver of drivers) {
    if (driver.archivedAt) {
      rows.push({ employeeId: driver.employeeId, name: driver.name, date: driver.archivedAt, kind: "archived" });
    } else if (driver.status === "cancelled" && driver.jobEnd) {
      rows.push({ employeeId: driver.employeeId, name: driver.name, date: driver.jobEnd, kind: "job_end" });
    }
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.employeeId.localeCompare(right.employeeId));
}

function turnoverBlock(rows: Departure[], liveNonCancelled: number) {
  const avgActive = liveNonCancelled + rows.length / 2;
  return { departures: rows.length, avgActive, rate: turnoverRate(rows.length, avgActive) };
}

function onLeaveNow(
  drivers: DriverRow[],
  byDriver: Map<string, LeaveRow[]>,
  today: string,
  zones: Map<string, string>,
) {
  const rows: Array<Record<string, string>> = [];
  for (const driver of liveOf(drivers)) {
    const open = covering(byDriver.get(driver.id) ?? [], today);
    if (open.length === 0 && driver.status !== "leave") continue;
    const endDate = open.reduce((latest, plan) => (plan.end > latest ? plan.end : latest), open[0]?.end ?? "");
    const startDate = open.reduce(
      (earliest, plan) => (plan.start < earliest ? plan.start : earliest),
      open[0]?.start ?? "",
    );
    rows.push({
      name: driver.name,
      employee_id: driver.employeeId,
      start_date: startDate,
      end_date: endDate,
      zone: zoneLabel(driver.zoneId, zones),
    });
  }
  return rows.sort((left, right) => left.end_date.localeCompare(right.end_date) || left.name.localeCompare(right.name));
}

function vehicleMatches(vehicle: string, filter: string): boolean {
  if (filter === "bike") return vehicle.includes("bike") || vehicle.includes("motor");
  if (filter === "car") return vehicle === "car" || vehicle.includes("car");
  return true;
}

function statusByProject(drivers: DriverRow[]) {
  const keys = new Set<string>();
  for (const driver of drivers) {
    if (!driver.archived) keys.add(driver.project);
  }
  return [...keys].sort(projectSort).map((project) => {
    const live = drivers.filter((driver) => !driver.archived && driver.project === project);
    const counts = {
      project,
      running: 0,
      extension: 0,
      leave: 0,
      new: 0,
      absent_from_mosal: 0,
      cancelled: 0,
      total: live.length,
    };
    for (const driver of live) {
      switch (driver.status) {
        case "running":
          counts.running += 1;
          break;
        case "extension":
          counts.extension += 1;
          break;
        case "leave":
          counts.leave += 1;
          break;
        case "new":
          counts.new += 1;
          break;
        case "absent_from_mosal":
          counts.absent_from_mosal += 1;
          break;
        case "cancelled":
          counts.cancelled += 1;
          break;
        default:
          break;
      }
    }
    return counts;
  });
}

function zoneLabel(zoneId: string, names: Map<string, string>): string {
  if (!zoneId) return "";
  return names.get(zoneId) ?? zoneId;
}

async function loadDashboard(day: string) {
  const db = getFirestore();
  const [driverSnap, leaveSnap, attendanceSnap, zoneSnap, requestSnap] = await Promise.all([
    readOrFail("drivers_read_failed", () =>
      db.collection(COLLECTIONS.drivers).select(
        "full_name",
        "employee_id",
        "project_key",
        "employee_status_key",
        "archived_at",
        "work_start_date",
        "job_end_date",
        "job_end_description",
        "zone_id",
        "vehicle_type_key",
      ).get(),
    ),
    readOrFail("leave_plans_read_failed", () =>
      db.collection(COLLECTIONS.driverLeavePlans).select(
        "driver_id",
        "employee_id",
        "driver_name",
        "project_key",
        "leave_type",
        "start_date",
        "end_date",
        "days_count",
        "status",
        "year_month",
      ).get(),
    ),
    readOrFail("attendance_read_failed", () =>
      db.collection(COLLECTIONS.attendanceLogs).where("log_date", "==", day).select("driver_id", "check_out_at").get(),
    ),
    readOrFail("zones_read_failed", () => db.collection(COLLECTIONS.zones).select("name").get()),
    readOrFail("leave_requests_read_failed", () =>
      db.collection(COLLECTIONS.requests)
        .where("request_type", "in", ["leave", "sick_leave"])
        .select("request_type", "status", "driver_id", "employee_id", "driver_name", "start_date", "end_date", "payload")
        .get(),
    ),
  ]);
  const drivers = driverSnap.docs.map((doc) => parseDriver(doc.id, dataOf(doc)));
  const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
  const requestLeaves: LeaveRow[] = [];
  for (const doc of requestSnap.docs) {
    const data = dataOf(doc);
    const payload = data["payload"];
    const payloadRow = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Dict : {};
    const mapped = mapRequestLeave({
      id: doc.id,
      requestType: text(data["request_type"]),
      status: text(data["status"]),
      driverId: text(data["driver_id"]),
      employeeId: text(data["employee_id"]),
      name: text(data["driver_name"]),
      project: "",
      start: toYmd(data["start_date"]) ?? "",
      end: toYmd(data["end_date"]) ?? "",
      today: day,
      leaveTypeRaw: text(payloadRow["leave_type"]) || text(payloadRow["leaveType"]),
    });
    if (!mapped) continue;
    const driver = driversById.get(mapped.driverId);
    requestLeaves.push({
      ...mapped,
      project: driver?.project ?? mapped.project,
      employeeId: mapped.employeeId || driver?.employeeId || "",
      name: mapped.name || driver?.name || "",
    });
  }
  const leaves = mergeLeaveRows(
    leaveSnap.docs.map((doc) => parseLeave(doc.id, dataOf(doc))),
    requestLeaves,
  );
  const checkedIn = new Set<string>();
  for (const doc of attendanceSnap.docs) {
    const data = dataOf(doc);
    const driverId = text(data["driver_id"]);
    if (driverId && data["check_out_at"] == null) checkedIn.add(driverId);
  }
  const zones = new Map<string, string>();
  for (const doc of zoneSnap.docs) zones.set(doc.id, text(dataOf(doc)["name"]) || doc.id);
  return { drivers, leaves, checkedIn, zones };
}

export const adminOperationsDashboard = onCall(async (request) => {
  const staff = await requireStaff(request, "operations_dashboard.view");
  const data = payloadOf(request);
  const today = kuwaitDayString(new Date());
  const requestedDay = pickText(data, "day");
  if (requestedDay && !isRealYmd(requestedDay)) throw new HttpsError("invalid-argument", "invalid_day");
  const day = requestedDay ?? today;
  const todayYm = day.slice(0, 7);
  const requestedMonth = pickText(data, "month", "yearMonth", "year_month");
  if (requestedMonth && !isYearMonth(requestedMonth)) throw new HttpsError("invalid-argument", "invalid_month");
  const month = requestedMonth ?? todayYm;
  const projectKey = scopedProjectKey(staff, pickText(data, "projectKey", "project_key"));
  const zoneId = pickText(data, "zoneId", "zone_id");
  const vehicle = pickText(data, "vehicle", "vehicleType", "vehicle_type")?.toLowerCase() ?? "";
  const loaded = await loadDashboard(day);
  const narrowed = loaded.drivers.filter(
    (driver) => (!zoneId || driver.zoneId === zoneId) && vehicleMatches(driver.vehicle, vehicle),
  );
  const scopedDrivers = projectKey ? narrowed.filter((driver) => driver.project === projectKey) : narrowed;
  const scopedIds = new Set(scopedDrivers.map((driver) => driver.id));
  const scopedLeaves = loaded.leaves.filter(
    (plan) => scopedIds.has(plan.driverId) && (!projectKey || plan.project === projectKey),
  );
  const scopedByDriver = indexLeaves(scopedLeaves);
  const allByDriver = indexLeaves(loaded.leaves);
  const bar = tally(scopedDrivers, day, todayYm, scopedByDriver, loaded.checkedIn);
  const year = month.slice(0, 4);
  const yearLeaves = scopedLeaves.filter((plan) => plan.yearMonth.startsWith(year));
  const monthLeaves = scopedLeaves.filter((plan) => plan.yearMonth === month);
  const endings = jobEndBlocks(scopedDrivers, day);
  const live = liveOf(scopedDrivers);
  return {
    today: day,
    projectKey,
    month,
    statusBar: bar.statusBar,
    kpis: bar.kpis,
    byProject: byProject(narrowed, day, todayYm, allByDriver, loaded.checkedIn),
    employeeStatus: statusTiles(scopedDrivers, OPS_STATUS_KEYS),
    statusByProject: statusByProject(narrowed),
    leaveMonths: leaveMonthRows(scopedLeaves, day, todayYm),
    leavePlans: monthLeaves
      .sort((left, right) => left.start.localeCompare(right.start) || left.employeeId.localeCompare(right.employeeId))
      .map(leaveRecord),
    outlook: outlook(scopedDrivers, scopedLeaves, day),
    jobEnd: endings.months,
    jobEndCards: endings.cards,
    ridersOnLeave: ridersOnLeave(scopedDrivers, scopedByDriver, day),
    zones: [...loaded.zones.entries()]
      .map(([id, name]) => ({ id, name: name || id }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    exports: {
      leaveYear: yearLeaves.map(leaveCsv),
      leaveMonth: monthLeaves.map(leaveCsv),
      jobEnd: live
        .filter((driver) => driver.jobEnd || renewalDecision(driver.jobEndDescription, driver.jobEnd) !== null)
        .map((driver) => jobEndCsv(driver, day)),
    },
  };
});

export const adminClientPortalDashboard = onCall(async (request) => {
  const staff = await requireStaff(request, "client_portal.view");
  const data = payloadOf(request);
  const today = kuwaitDayString(new Date());
  const todayYm = today.slice(0, 7);
  const requestedDay = pickText(data, "day");
  if (requestedDay && !isRealYmd(requestedDay)) throw new HttpsError("invalid-argument", "invalid_day");
  const day = requestedDay ?? today;
  const projectKey = scopedProjectKey(staff, pickText(data, "projectKey", "project_key")) ?? "keeta";
  const zoneId = pickText(data, "zoneId", "zone_id");
  const loaded = await loadDashboard(day);
  const projectDrivers = loaded.drivers.filter((driver) => driver.project === projectKey);
  const projectLeaves = loaded.leaves.filter((plan) => plan.project === projectKey);
  const byDriver = indexLeaves(projectLeaves);
  const barDrivers = zoneId ? projectDrivers.filter((driver) => driver.zoneId === zoneId) : projectDrivers;
  const bar = tally(barDrivers, day, todayYm, byDriver, loaded.checkedIn);
  const live = liveOf(projectDrivers);
  const liveCount = live.length;
  const departures = departuresOf(projectDrivers);
  const liveNonCancelled = live.filter((driver) => driver.status !== "cancelled").length;
  const monthLeaves = projectLeaves.filter((plan) => plan.yearMonth === todayYm);
  const comparison = turnoverComparison(departures, liveNonCancelled, today);
  const zoneIds = new Set(projectDrivers.map((driver) => driver.zoneId).filter((id) => id !== ""));
  return {
    projectKey,
    day,
    zoneId,
    statusBar: bar.statusBar,
    kpis: bar.kpis,
    leaveMonths: leaveMonthRows(projectLeaves, today, todayYm),
    leavePlans: projectLeaves.map(leaveRecord),
    turnover: {
      monthly: turnoverBlock(departures.filter((row) => row.date.slice(0, 7) === todayYm), liveNonCancelled),
      yearly: turnoverBlock(departures.filter((row) => row.date.slice(0, 4) === today.slice(0, 4)), liveNonCancelled),
      comparison,
    },
    riderStatus: statusTiles(projectDrivers, CLIENT_STATUS_KEYS).map((tile) => ({
      ...tile,
      pct: liveCount === 0 ? 0 : (tile.count / liveCount) * 100,
    })),
    onLeaveNow: onLeaveNow(projectDrivers, byDriver, today, loaded.zones),
    zones: [...zoneIds]
      .map((id) => ({ id, name: zoneLabel(id, loaded.zones) }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    exports: {
      riders: live.map((driver) => ({
        "Employee ID": driver.employeeId,
        Name: driver.name,
        Status: driver.status,
        Zone: zoneLabel(driver.zoneId, loaded.zones),
      })),
      leaveMonth: monthLeaves.map(leaveCsv),
      turnover: comparison.months.map((row) => ({
        Month: row.label,
        "Avg riders": row.avgActive,
        "Riders who left": row.departures,
        "Turnover %": row.rate,
      })),
    },
  };
});
