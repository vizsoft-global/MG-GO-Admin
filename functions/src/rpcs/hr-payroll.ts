import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaffAny, requireStaffFresh } from "../core/staff";
import { logAdminActivity } from "./_shared";
import { bumpScanSnapshots, PAYROLL_SNAPSHOTS } from "../router/read-snapshot";

const MONTH = /^\d{4}-\d{2}$/;
const CHUNK = 100;
const SAVE_CAP = 400;

const INC_VALUES = new Set([0, 20, 30, 40]);
const FOOD_VALUES = new Set([0, 15]);

const CELL_FIELDS = [
  "twoYear",
  "fourYear",
  "food",
  "sick",
  "pending",
  "traffic",
  "loan",
  "allowances",
  "deductions",
] as const;

type CellField = (typeof CELL_FIELDS)[number];

const STORED: Record<CellField, string> = {
  twoYear: "two_year_applicable",
  fourYear: "four_year_applicable",
  food: "food_allowance",
  sick: "sick_leave_days",
  pending: "pending_salary",
  traffic: "traffic_violation",
  loan: "loan_deduction",
  allowances: "total_allowances",
  deductions: "total_deductions",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function monthOf(value: unknown): string {
  const month = text(value);
  if (!MONTH.test(month)) throw new HttpsError("invalid-argument", "invalid_month");
  return month;
}

function dateText(value: unknown): string {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match?.[1] ?? "";
  }
  if (value instanceof Timestamp) {
    return new Date(value.toDate().getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function labelOf(data: Record<string, unknown>, locale: string): string {
  const en = text(data.label_en);
  const ar = text(data.label_ar);
  if (locale === "ar" && ar) return ar;
  return en || ar || text(data.key);
}

async function labels(collection: string, locale: string): Promise<Map<string, string>> {
  const snap = await getFirestore().collection(collection).get();
  const map = new Map<string, string>();
  snap.forEach((doc) => {
    const data = doc.data();
    const key = text(data.key) || doc.id;
    map.set(key, labelOf(data, locale));
  });
  return map;
}

function joinLabels(value: unknown, map: Map<string, string>): string {
  const keys = Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : text(value) ? [text(value)] : [];
  return keys.map((key) => map.get(key) || key).join(", ");
}

function cellDocId(driverId: string, month: string): string {
  return `${driverId}_${month}-01`;
}

function validCell(field: CellField, value: number): boolean {
  if (field === "twoYear" || field === "fourYear") return INC_VALUES.has(value);
  if (field === "food") return FOOD_VALUES.has(value);
  if (field === "sick") return Number.isInteger(value) && value >= 0 && value <= 30;
  return Number.isFinite(value) && value >= 0;
}

export const adminHrPayrollSnapshot = onCall(async (request) => {
  await requireStaffAny(request, ["payroll.hr_payroll", "payroll.manage"]);
  const data = (request.data ?? {}) as { month?: unknown; locale?: unknown };
  const month = monthOf(data.month);
  const locale = text(data.locale) === "ar" ? "ar" : "en";
  const db = getFirestore();
  const [statusLabels, sectionLabels, categoryLabels, sponsorLabels, companies, banks, period, drivers] =
    await Promise.all([
      labels(COLLECTIONS.employeeStatuses, locale),
      labels(COLLECTIONS.employeeSections, locale),
      labels(COLLECTIONS.nationalityCategories, locale),
      labels(COLLECTIONS.sponsorships, locale),
      labels(COLLECTIONS.sourceCompanies, locale),
      labels(COLLECTIONS.bankCodes, locale),
      db.collection(COLLECTIONS.payrollHrPeriods).doc(month).get(),
      db.collection(COLLECTIONS.drivers).get(),
    ]);

  const live = drivers.docs.filter((doc) => !doc.get("archived_at"));
  const cellRefs = live.map((doc) => db.collection(COLLECTIONS.driverHrPayroll).doc(cellDocId(doc.id, month)));
  const cells = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < cellRefs.length; i += CHUNK) {
    const snaps = await db.getAll(...cellRefs.slice(i, i + CHUNK));
    snaps.forEach((snap) => {
      if (snap.exists) cells.set(snap.id, snap.data() ?? {});
    });
  }

  const incentives = new Map<string, number>();
  try {
    const earned = await db
      .collection(COLLECTIONS.driverEarningsDaily)
      .where("earn_date", ">=", `${month}-01`)
      .where("earn_date", "<=", `${month}-31`)
      .select("driver_id", "incentive_kwd", "final_incentive_kwd")
      .get();
    earned.forEach((doc) => {
      const row = doc.data();
      const driverId = text(row.driver_id);
      if (!driverId) return;
      const amount = num(row.final_incentive_kwd ?? row.incentive_kwd);
      incentives.set(driverId, (incentives.get(driverId) ?? 0) + amount);
    });
  } catch {
    incentives.clear();
  }

  const rows = live.map((doc) => {
    const row = doc.data();
    const bank = (row.bank_details ?? {}) as Record<string, unknown>;
    const stored = cells.get(cellDocId(doc.id, month)) ?? {};
    const statusKey = text(row.employee_status_key);
    const companyKey = text(row.source_company);
    const bankCode = text(bank.bank_code);
    return {
      driverId: doc.id,
      employeeId: text(row.employee_id),
      driverCode: text(row.driver_code),
      fullName: text(row.full_name) || text(row.name),
      civilId: text(row.civil_id),
      clientId: text(row.client_id),
      clientName: text(row.client_name),
      projectKey: text(row.project_key),
      nationality: text(row.nationality),
      nationalityCategory: joinLabels(row.nationality_category_keys, categoryLabels),
      statusKey,
      statusLabel: statusLabels.get(statusKey) || statusKey,
      section: joinLabels(row.section_keys, sectionLabels),
      sponsor: sponsorLabels.get(text(row.sponsorship_key)) || text(row.sponsorship_key),
      company: companies.get(companyKey) || companyKey,
      position: text(row.job_position),
      hiringType: text(row.hiring_type),
      workStart: dateText(row.work_start_date),
      jobEnd: dateText(row.job_end_date),
      jobEndDescription: text(row.job_end_description),
      fixedSalary: num(row.fixed_salary),
      workPermitSalary: num(row.work_permit_salary),
      bankNumber: text(bank.account_number),
      bankName: banks.get(bankCode) || bankCode,
      currency: text(bank.currency) || "KWD",
      twoYear: num(stored.two_year_applicable),
      fourYear: num(stored.four_year_applicable),
      food: num(stored.food_allowance),
      sick: num(stored.sick_leave_days),
      pending: num(stored.pending_salary),
      traffic: num(stored.traffic_violation),
      loan: num(stored.loan_deduction),
      allowances: num(stored.total_allowances),
      deductions: num(stored.total_deductions),
      incentives: incentives.get(doc.id) ?? 0,
    };
  });

  return { month, opsApproved: period.exists, rows };
});

export const adminSaveHrPayrollCells = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "payroll.manage");
  const data = (request.data ?? {}) as { month?: unknown; cells?: unknown };
  const month = monthOf(data.month);
  if (!Array.isArray(data.cells) || data.cells.length > SAVE_CAP) {
    throw new HttpsError("invalid-argument", "invalid_cells");
  }
  const db = getFirestore();
  const parsed: { driverId: string; patch: Partial<Record<CellField, number>> }[] = [];
  for (const item of data.cells) {
    const row = (item ?? {}) as { driverId?: unknown; patch?: unknown };
    const driverId = text(row.driverId);
    const patchIn = (row.patch ?? {}) as Record<string, unknown>;
    if (!driverId) throw new HttpsError("invalid-argument", "invalid_cell");
    const patch: Partial<Record<CellField, number>> = {};
    for (const field of CELL_FIELDS) {
      if (patchIn[field] === undefined) continue;
      const value = num(patchIn[field]);
      if (!validCell(field, value)) throw new HttpsError("invalid-argument", "invalid_cell");
      patch[field] = value;
    }
    if (Object.keys(patch).length) parsed.push({ driverId, patch });
  }

  const refs = parsed.map((row) => db.collection(COLLECTIONS.drivers).doc(row.driverId));
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const snaps = await db.getAll(...refs.slice(i, i + CHUNK));
    snaps.forEach((snap) => {
      if (snap.exists && !snap.get("archived_at")) existing.add(snap.id);
    });
  }

  const batch = db.batch();
  let saved = 0;
  let skipped = 0;
  const touched = new Set<string>();
  for (const row of parsed) {
    if (!existing.has(row.driverId)) {
      skipped += 1;
      continue;
    }
    const stored: Record<string, unknown> = {
      month: `${month}-01`,
      driver_id: row.driverId,
      updated_by: staff.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
    for (const field of CELL_FIELDS) {
      if (row.patch[field] === undefined) continue;
      stored[STORED[field]] = row.patch[field];
      touched.add(field);
    }
    batch.set(db.collection(COLLECTIONS.driverHrPayroll).doc(cellDocId(row.driverId, month)), stored, { merge: true });
    saved += 1;
  }
  if (saved) await batch.commit();
  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "driver_hr_payroll",
    entityId: month,
    detail: { month, count: saved, fields: [...touched] },
  });
  await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { saved, skipped };
});
