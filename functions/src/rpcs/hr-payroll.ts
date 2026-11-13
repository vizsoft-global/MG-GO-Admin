import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaffAny, requireStaffFresh } from "../core/staff";
import { logAdminActivity } from "./_shared";
import { replaceRestaurantEdges } from "./payroll-edits";
import { bumpScanSnapshots, PAYROLL_SNAPSHOTS } from "../router/read-snapshot";

const MONTH = /^\d{4}-\d{2}$/;
const CHUNK = 100;
const SAVE_CAP = 400;
/**
 * How many session documents one month of app-open hours may read.
 *
 * The figure is display-only (it never prices a salary), so a month that exceeds
 * the cap is reported as `truncated` rather than failing the sheet.
 */
const APP_HOURS_CAP = 80_000;

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

/**
 * The identity cells the sheet may correct. Every key is validated against its
 * catalog before it is written, and the write is audited with the payroll month.
 */
type IdentityPatch = {
  bankNumber?: string;
  bankCode?: string;
  currency?: string;
  zoneId?: string;
  projectKey?: string;
  /** ISO alpha-2, the same master the employee profile's country picker uses. */
  nationalityCode?: string;
  /** One `nationality_categories` key — the catalog Employee Settings owns. */
  nationalityCategoryKey?: string;
  /** A `restaurants` document id; the assignment is an edge, not a field. */
  restaurantId?: string;
  /** `YYYY-MM-DD`, or `""` to clear. */
  workStart?: string;
  jobEnd?: string;
  /** Free text on the profile, capped there as well. */
  jobEndDescription?: string;
  /** Catalog keys, each validated against the collection that owns it. */
  sponsorKey?: string;
  sectionKey?: string;
  positionKey?: string;
  companyKey?: string;
  /** A compiled enum on the profile (`HIRING_TYPES`), not a catalog. */
  hiringType?: string;
};

/** The hiring types the employee profile accepts. */
const HIRING_TYPES = new Set(["overseas", "old_local", "new_local", "outsourcing_partner"]);

/**
 * The compiled job positions.
 *
 * `job_positions` is a catalog the panel may never have seeded, and the sheet's
 * Position picker offers these six whether or not it was — Employee Settings
 * builds the same list from the same compiled rows. So the writer accepts their
 * keys and the snapshot prints their labels, which is what keeps a position the
 * operator picked from a save the catalogue would have refused, and a stored key
 * from printing as `rider` on the sheet.
 */
const COMPILED_JOB_POSITIONS: Record<string, string> = {
  rider: "Rider",
  light_driver: "Light driver",
  heavy_driver: "Heavy driver",
  maintenance: "Maintenance",
  workshop: "Workshop",
  head_office: "Head office",
};

/** `YYYY-MM-DD`, or `null` when the value is not a date. */
function dayOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

function identityOf(value: unknown): IdentityPatch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const patch: IdentityPatch = {};
  if (typeof row.bankNumber === "string") patch.bankNumber = row.bankNumber.trim().slice(0, 40);
  if (typeof row.bankCode === "string") patch.bankCode = row.bankCode.trim();
  if (typeof row.currency === "string") patch.currency = row.currency.trim().slice(0, 8).toUpperCase();
  if (typeof row.zoneId === "string") patch.zoneId = row.zoneId.trim();
  if (typeof row.projectKey === "string") patch.projectKey = row.projectKey.trim();
  // `""` is a real instruction here: it clears the cell, which is why these are
  // kept when empty while the four above are not.
  if (typeof row.nationalityCode === "string") {
    patch.nationalityCode = row.nationalityCode.trim().toUpperCase().slice(0, 2);
  }
  if (typeof row.nationalityCategoryKey === "string") {
    patch.nationalityCategoryKey = row.nationalityCategoryKey.trim();
  }
  if (typeof row.restaurantId === "string") patch.restaurantId = row.restaurantId.trim();
  if (typeof row.workStart === "string") patch.workStart = row.workStart.trim();
  if (typeof row.jobEnd === "string") patch.jobEnd = row.jobEnd.trim();
  if (typeof row.jobEndDescription === "string") {
    patch.jobEndDescription = row.jobEndDescription.trim().slice(0, 120);
  }
  if (typeof row.sponsorKey === "string") patch.sponsorKey = row.sponsorKey.trim();
  if (typeof row.sectionKey === "string") patch.sectionKey = row.sectionKey.trim();
  if (typeof row.positionKey === "string") patch.positionKey = row.positionKey.trim();
  if (typeof row.companyKey === "string") patch.companyKey = row.companyKey.trim();
  if (typeof row.hiringType === "string") patch.hiringType = row.hiringType.trim();
  return Object.keys(patch).length ? patch : null;
}

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

/**
 * The same value shaped for an `<input type="date">`, which only accepts
 * `YYYY-MM-DD`. A timestamp has to be shifted to the Kuwait wall clock first or
 * a midnight-stamped date prints as the previous day.
 */
function dayValue(value: unknown): string {
  return dateText(value);
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

function validCell(field: CellField, value: number): string | null {
  if (!Number.isFinite(value)) return field;
  if (field === "twoYear" || field === "fourYear") {
    // A negotiated KWD amount, not a closed list: typing 3 must save 3.
    return value >= 0 ? null : field;
  }
  if (field === "food") return FOOD_VALUES.has(value) ? null : field;
  if (field === "sick") {
    return Number.isInteger(value) && value >= 0 && value <= 30 ? null : field;
  }
  return value >= 0 ? null : field;
}

export const adminHrPayrollSnapshot = onCall(async (request) => {
  await requireStaffAny(request, ["payroll.hr_payroll", "payroll.manage"]);
  const data = (request.data ?? {}) as { month?: unknown; locale?: unknown };
  const month = monthOf(data.month);
  const locale = text(data.locale) === "ar" ? "ar" : "en";
  const db = getFirestore();
  const [statusLabels, sectionLabels, categoryLabels, sponsorLabels, companies, banks, jobPositions, period, drivers] =
    await Promise.all([
      labels(COLLECTIONS.employeeStatuses, locale),
      labels(COLLECTIONS.employeeSections, locale),
      labels(COLLECTIONS.nationalityCategories, locale),
      labels(COLLECTIONS.sponsorships, locale),
      labels(COLLECTIONS.sourceCompanies, locale),
      labels(COLLECTIONS.bankCodes, locale),
      labels(COLLECTIONS.jobPositions, locale),
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
      nationalityCategoryKeys: Array.isArray(row.nationality_category_keys)
        ? row.nationality_category_keys.map((key: unknown) => text(key)).filter(Boolean)
        : [],
      restaurantId: text(row.restaurant_id),
      nationalityCategory: joinLabels(row.nationality_category_keys, categoryLabels),
      statusKey,
      statusLabel: statusLabels.get(statusKey) || statusKey,
      section: joinLabels(row.section_keys, sectionLabels),
      sectionKey: Array.isArray(row.section_keys) ? text(row.section_keys[0]) : "",
      sponsor: sponsorLabels.get(text(row.sponsorship_key)) || text(row.sponsorship_key),
      sponsorKey: text(row.sponsorship_key),
      company: companies.get(companyKey) || companyKey,
      companyKey,
      position:
        jobPositions.get(text(row.job_position)) ||
        COMPILED_JOB_POSITIONS[text(row.job_position)] ||
        text(row.job_position),
      positionKey: text(row.job_position),
      hiringType: text(row.hiring_type),
      /** The raw `YYYY-MM-DD` dates, so the inline pickers bind to a real date. */
      workStartDate: dayValue(row.work_start_date),
      jobEndDate: dayValue(row.job_end_date),
      workStart: dateText(row.work_start_date),
      jobEnd: dateText(row.job_end_date),
      jobEndDescription: text(row.job_end_description),
      fixedSalary: num(row.fixed_salary),
      workPermitSalary: num(row.work_permit_salary),
      bankNumber: text(bank.account_number),
      bankName: banks.get(bankCode) || bankCode,
      currency: text(bank.currency) || "KWD",
      bankCode,
      zoneId: text(row.zone_id),
      vehicleId: text(row.vehicle_id),
      vehicleTypeKey: text(row.vehicle_type_key),
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
  const parsed: {
    driverId: string;
    patch: Partial<Record<CellField, number>>;
    vehicleTypeKey?: string;
    identity?: IdentityPatch;
  }[] = [];
  const wantsVehicleType = (data.cells as unknown[]).some(
    (item) => typeof (item as { vehicleTypeKey?: unknown })?.vehicleTypeKey === "string",
  );
  let typeKeys: Set<string> | null = null;
  if (wantsVehicleType) {
    const types = await db.collection(COLLECTIONS.vehicleTypes).get();
    typeKeys = new Set(types.docs.map((doc) => text(doc.get("key")) || doc.id));
  }
  for (const item of data.cells) {
    const row = (item ?? {}) as { driverId?: unknown; patch?: unknown; vehicleTypeKey?: unknown; identity?: unknown };
    const driverId = text(row.driverId);
    const patchIn = (row.patch ?? {}) as Record<string, unknown>;
    if (!driverId) throw new HttpsError("invalid-argument", "invalid_cell");
    const patch: Partial<Record<CellField, number>> = {};
    for (const field of CELL_FIELDS) {
      if (patchIn[field] === undefined) continue;
      const value = num(patchIn[field]);
      const offending = validCell(field, value);
      if (offending) {
        throw new HttpsError("invalid-argument", `invalid_cell:${offending}`);
      }
      patch[field] = value;
    }
    // An empty string clears nothing: a vehicle type is always one of the catalog
    // keys, so an unknown key is refused rather than written.
    const vehicleTypeKey = typeof row.vehicleTypeKey === "string" ? row.vehicleTypeKey.trim() : "";
    if (vehicleTypeKey && typeKeys && !typeKeys.has(vehicleTypeKey)) {
      throw new HttpsError("invalid-argument", "invalid_cell:vehicle_type");
    }
    const identity = identityOf(row.identity);
    if (Object.keys(patch).length || vehicleTypeKey || identity) {
      parsed.push({
        driverId,
        patch,
        ...(vehicleTypeKey ? { vehicleTypeKey } : {}),
        ...(identity ? { identity } : {}),
      });
    }
  }

  // Catalog reads happen only for the identity fields actually present, so a
  // money-only save costs nothing extra.
  const identityNeeds = {
    bank: parsed.some((row) => row.identity?.bankCode !== undefined),
    zone: parsed.some((row) => row.identity?.zoneId !== undefined),
    project: parsed.some((row) => row.identity?.projectKey !== undefined),
    category: parsed.some((row) => row.identity?.nationalityCategoryKey !== undefined),
    restaurant: parsed.some((row) => row.identity?.restaurantId !== undefined),
    sponsor: parsed.some((row) => row.identity?.sponsorKey !== undefined),
    section: parsed.some((row) => row.identity?.sectionKey !== undefined),
    position: parsed.some((row) => row.identity?.positionKey !== undefined),
    company: parsed.some((row) => row.identity?.companyKey !== undefined),
  };
  const bankKeys = new Set<string>();
  if (identityNeeds.bank) {
    const banks = await db.collection(COLLECTIONS.bankCodes).get();
    banks.docs.forEach((doc) => bankKeys.add(text(doc.get("key")) || doc.id));
  }
  const projectKeys = new Set<string>();
  if (identityNeeds.project) {
    const clients = await db.collection(COLLECTIONS.payrollClients).get();
    clients.docs.forEach((doc) => projectKeys.add(text(doc.get("key")) || doc.id));
    projectKeys.add("unassigned");
  }
  const zoneNames = new Map<string, string>();
  const zoneIds = [...new Set(parsed.map((row) => row.identity?.zoneId).filter((id): id is string => Boolean(id)))];
  if (identityNeeds.zone && zoneIds.length) {
    for (let i = 0; i < zoneIds.length; i += CHUNK) {
      const snaps = await db.getAll(...zoneIds.slice(i, i + CHUNK).map((id) => db.collection(COLLECTIONS.zones).doc(id)));
      snaps.forEach((snap) => {
        if (snap.exists) zoneNames.set(snap.id, text(snap.get("name")) || text(snap.get("zone_name")) || snap.id);
      });
    }
  }
  /**
   * The two masters the new inline cells pick from.
   *
   * A category is one `nationality_categories` key, the same catalog Employee
   * Settings edits, so a value is only accepted while the catalog holds it.
   * A restaurant is a document id, and the assignment itself is an edge write
   * rather than a field — that is why it is handled after the batch.
   */
  const categoryKeys = new Set<string>();
  if (identityNeeds.category) {
    const categories = await db.collection(COLLECTIONS.nationalityCategories).get();
    categories.docs.forEach((doc) => categoryKeys.add(text(doc.get("key")) || doc.id));
  }
  const restaurantsById = new Map<string, string>();
  const restaurantIds = [
    ...new Set(parsed.map((row) => row.identity?.restaurantId).filter((id): id is string => Boolean(id))),
  ];
  if (identityNeeds.restaurant && restaurantIds.length) {
    for (let i = 0; i < restaurantIds.length; i += CHUNK) {
      const snaps = await db.getAll(
        ...restaurantIds.slice(i, i + CHUNK).map((id) => db.collection(COLLECTIONS.restaurants).doc(id)),
      );
      snaps.forEach((snap) => {
        if (snap.exists) restaurantsById.set(snap.id, text(snap.get("name")) || snap.id);
      });
    }
  }
  /**
   * The four catalogs the profile's own pickers read. They are fetched only when
   * a row actually changes one, so a money-only save stays a single round trip.
   */
  const catalogKeys = async (
    wanted: boolean,
    collection: string,
  ): Promise<Set<string>> => {
    if (!wanted) return new Set<string>();
    const snap = await db.collection(collection).get();
    return new Set(snap.docs.map((doc) => text(doc.get("key")) || doc.id));
  };
  const sponsorKeys = await catalogKeys(identityNeeds.sponsor, COLLECTIONS.sponsorships);
  const sectionKeys = await catalogKeys(identityNeeds.section, COLLECTIONS.employeeSections);
  const positionKeys = await catalogKeys(identityNeeds.position, COLLECTIONS.jobPositions);
  const companyKeys = await catalogKeys(identityNeeds.company, COLLECTIONS.sourceCompanies);
  for (const row of parsed) {
    const identity = row.identity;
    if (!identity) continue;
    if (identity.bankCode !== undefined && !bankKeys.has(identity.bankCode)) {
      throw new HttpsError("invalid-argument", "invalid_cell:bank_code");
    }
    if (identity.zoneId !== undefined && !zoneNames.has(identity.zoneId)) {
      throw new HttpsError("invalid-argument", "invalid_cell:zone");
    }
    if (identity.projectKey !== undefined && !projectKeys.has(identity.projectKey)) {
      throw new HttpsError("invalid-argument", "invalid_cell:project");
    }
    if (
      identity.nationalityCategoryKey !== undefined &&
      identity.nationalityCategoryKey !== "" &&
      !categoryKeys.has(identity.nationalityCategoryKey)
    ) {
      throw new HttpsError("invalid-argument", "invalid_cell:nationality_category");
    }
    if (identity.restaurantId !== undefined && identity.restaurantId !== "" && !restaurantsById.has(identity.restaurantId)) {
      throw new HttpsError("invalid-argument", "invalid_cell:restaurant");
    }
    if (
      identity.nationalityCode !== undefined &&
      identity.nationalityCode !== "" &&
      !/^[A-Z]{2}$/.test(identity.nationalityCode)
    ) {
      throw new HttpsError("invalid-argument", "invalid_cell:nationality");
    }
    // A catalogue key is only accepted while the catalogue still holds it, which
    // is what keeps a deleted section or sponsor from being re-introduced by a
    // stale dropdown. `""` clears, so it is checked before the set lookup.
    if (identity.sponsorKey !== undefined && identity.sponsorKey !== "" && !sponsorKeys.has(identity.sponsorKey)) {
      throw new HttpsError("invalid-argument", "invalid_cell:sponsor");
    }
    if (identity.sectionKey !== undefined && identity.sectionKey !== "" && !sectionKeys.has(identity.sectionKey)) {
      throw new HttpsError("invalid-argument", "invalid_cell:section");
    }
    if (
      identity.positionKey !== undefined &&
      identity.positionKey !== "" &&
      !positionKeys.has(identity.positionKey) &&
      !(identity.positionKey in COMPILED_JOB_POSITIONS)
    ) {
      throw new HttpsError("invalid-argument", "invalid_cell:position");
    }
    if (identity.companyKey !== undefined && identity.companyKey !== "" && !companyKeys.has(identity.companyKey)) {
      throw new HttpsError("invalid-argument", "invalid_cell:company");
    }
    if (identity.hiringType !== undefined && identity.hiringType !== "" && !HIRING_TYPES.has(identity.hiringType)) {
      throw new HttpsError("invalid-argument", "invalid_cell:hiring_type");
    }
    for (const field of [identity.workStart, identity.jobEnd]) {
      if (field === undefined || field === "") continue;
      if (dayOf(field) === null) throw new HttpsError("invalid-argument", "invalid_cell:date");
    }
  }

  const refs = parsed.map((row) => db.collection(COLLECTIONS.drivers).doc(row.driverId));
  const existing = new Set<string>();
  const vehicleOf = new Map<string, string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const snaps = await db.getAll(...refs.slice(i, i + CHUNK));
    snaps.forEach((snap) => {
      if (snap.exists && !snap.get("archived_at")) existing.add(snap.id);
      const vehicleId = text(snap.get("vehicle_id"));
      if (vehicleId) vehicleOf.set(snap.id, vehicleId);
    });
  }

  const batch = db.batch();
  let saved = 0;
  let skipped = 0;
  const touched = new Set<string>();
  const vehicleWrites: { driverId: string; vehicleId: string; key: string }[] = [];
  /** Riders with no vehicle: the type is written on the rider, not on a plate. */
  const driverTypeWrites: { driverId: string; key: string }[] = [];
  /**
   * Restaurant assignments are edge writes with their own batch, so they are
   * collected here and applied after this one commits — one write path for the
   * assignment, shared with the payroll identity editor.
   */
  const restaurantWrites: { driverId: string; restaurantId: string; name: string }[] = [];
  for (const row of parsed) {
    if (!existing.has(row.driverId)) {
      skipped += 1;
      continue;
    }
    if (row.vehicleTypeKey) {
      const vehicleId = vehicleOf.get(row.driverId);
      if (vehicleId) {
        vehicleWrites.push({ driverId: row.driverId, vehicleId, key: row.vehicleTypeKey });
      } else {
        /*
         * No vehicle assigned. The sheet used to refuse this outright, which made
         * the Vehicle Type column dead for exactly the riders whose pay it most
         * needs to change. `drivers.vehicle_type_key` is the same field the payroll
         * snapshot already falls back to (`vehicle_key` → `vehicle_type_key` →
         * `vehicle_kind`), so writing it there types the rider without inventing a
         * plate number, and the next snapshot read reprices the row.
         */
        driverTypeWrites.push({ driverId: row.driverId, key: row.vehicleTypeKey });
      }
      touched.add("vehicleType");
      if (Object.keys(row.patch).length === 0 && !row.identity) continue;
    }
    if (row.identity) {
      const identity = row.identity;
      const update: Record<string, unknown> = {
        updated_at: FieldValue.serverTimestamp(),
        updated_by: staff.uid,
      };
      if (identity.bankNumber !== undefined) update["bank_details.account_number"] = identity.bankNumber;
      if (identity.bankCode !== undefined) update["bank_details.bank_code"] = identity.bankCode;
      if (identity.currency !== undefined) update["bank_details.currency"] = identity.currency;
      if (identity.zoneId !== undefined) {
        update.zone_id = identity.zoneId;
        update.zone_name = zoneNames.get(identity.zoneId) ?? "";
      }
      if (identity.projectKey !== undefined) update.project_key = identity.projectKey;
      if (identity.nationalityCode !== undefined) {
        // The employee profile's own field: the ISO code, not a label.
        update.nationality = identity.nationalityCode;
      }
      if (identity.nationalityCategoryKey !== undefined) {
        // One category, matching the profile's single-select picker. The cell
        // prints the label from the catalog, so the stored value stays a key.
        update.nationality_category_keys = identity.nationalityCategoryKey
          ? [identity.nationalityCategoryKey]
          : [];
      }
      /*
       * The profile columns, written with the same shapes `saveDriverPrivateInformation`
       * uses: a date is stored as its `YYYY-MM-DD` string, a section is a one-element
       * array, and a cleared cell deletes the field rather than storing `""`.
       */
      const orDelete = (value: string): unknown => (value ? value : FieldValue.delete());
      if (identity.workStart !== undefined) update.work_start_date = orDelete(identity.workStart);
      if (identity.jobEnd !== undefined) update.job_end_date = orDelete(identity.jobEnd);
      if (identity.jobEndDescription !== undefined) {
        update.job_end_description = orDelete(identity.jobEndDescription);
      }
      if (identity.sponsorKey !== undefined) update.sponsorship_key = orDelete(identity.sponsorKey);
      if (identity.hiringType !== undefined) update.hiring_type = orDelete(identity.hiringType);
      if (identity.positionKey !== undefined) update.job_position = orDelete(identity.positionKey);
      if (identity.companyKey !== undefined) update.source_company = orDelete(identity.companyKey);
      if (identity.sectionKey !== undefined) {
        update.section_keys = identity.sectionKey ? [identity.sectionKey] : [];
      }
      batch.set(db.collection(COLLECTIONS.drivers).doc(row.driverId), update, { merge: true });
      if (identity.restaurantId !== undefined) {
        restaurantWrites.push({
          driverId: row.driverId,
          restaurantId: identity.restaurantId,
          name: restaurantsById.get(identity.restaurantId) ?? "",
        });
      }
      touched.add("identity");
      saved += 1;
      if (Object.keys(row.patch).length === 0) continue;
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
  for (const write of vehicleWrites) {
    batch.set(
      db.collection(COLLECTIONS.vehicles).doc(write.vehicleId),
      { vehicle_type_key: write.key, updated_at: FieldValue.serverTimestamp(), updated_by: staff.uid },
      { merge: true },
    );
    saved += 1;
  }
  for (const write of driverTypeWrites) {
    batch.set(
      db.collection(COLLECTIONS.drivers).doc(write.driverId),
      {
        vehicle_type_key: write.key,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: staff.uid,
      },
      { merge: true },
    );
    saved += 1;
  }
  if (saved) await batch.commit();
  for (const write of restaurantWrites) {
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(write.driverId).get();
    const driver = (driverSnap.data() ?? {}) as Record<string, unknown>;
    const direct = text(driver["intake_id"]);
    let intakeId = direct || null;
    if (!intakeId) {
      const intake = await db
        .collection(COLLECTIONS.driverIntakes)
        .where("linked_profile_id", "==", write.driverId)
        .limit(1)
        .get();
      intakeId = intake.docs[0]?.id ?? null;
    }
    await replaceRestaurantEdges(
      write.driverId,
      intakeId,
      write.restaurantId ? { id: write.restaurantId, name: write.name } : null,
    );
    touched.add("restaurant");
  }
  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "driver_hr_payroll",
    entityId: month,
    detail: {
      month,
      count: saved,
      fields: [...touched],
      ...(vehicleWrites.length
        ? { vehicles: vehicleWrites.map((write) => `${write.driverId}:${write.key}`) }
        : {}),
      ...(driverTypeWrites.length
        ? { driverVehicleTypes: driverTypeWrites.map((write) => `${write.driverId}:${write.key}`) }
        : {}),
    },
  });
  await bumpScanSnapshots(PAYROLL_SNAPSHOTS);
  return { saved, skipped };
});

/** `2026-10` → `2026-11`, the first instant of the next Kuwait month. */
function nextMonthStart(month: string): Timestamp {
  const [year, index] = month.split("-").map((part) => Number(part));
  const nextYear = index === 12 ? year + 1 : year;
  const nextIndex = index === 12 ? 1 : index + 1;
  const key = `${nextYear}-${String(nextIndex).padStart(2, "0")}`;
  return Timestamp.fromDate(new Date(`${key}-01T00:00:00+03:00`));
}

function instantOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** The union of a day's sessions: overlaps counted once. */
function unionHours(spans: { start: number; end: number }[]): number {
  if (spans.length === 0) return 0;
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  const ms = merged.reduce((sum, span) => sum + (span.end - span.start), 0);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/**
 * App-open hours per rider for one month, **display only**.
 *
 * Shift in / Shift out come from `driver_sessions` (the duty span the rider
 * controls by clocking in), unioned per Kuwait day and clipped to the month. It
 * sits beside the attendance-clock hours on the HR sheet and never replaces them:
 * whether a session hour prices a salary is a client decision (Q-A/Q-B), so this
 * callable deliberately touches no pay figure.
 *
 * **Retired from the sheet.** The client's 3.3 asks for Actual Working Hours from
 * Operations Payroll and for the "Worked hours (app)" section to be removed, so
 * no column reads this any more. The callable stays registered so an installed
 * build or a saved link cannot 404 on it, and so the figure can come back if the
 * client reverses the decision; nothing in the panel calls it.
 */
export const adminHrAppHours = onCall(async (request) => {
  await requireStaffAny(request, ["payroll.hr_payroll", "payroll.manage"]);
  const data = (request.data ?? {}) as { month?: unknown };
  const month = monthOf(data.month);
  const db = getFirestore();
  const start = Timestamp.fromDate(new Date(`${month}-01T00:00:00+03:00`));
  const end = nextMonthStart(month);
  let truncated = false;
  const spans = new Map<string, { start: number; end: number }[]>();
  let scanned = 0;
  try {
    const snap = await db
      .collection(COLLECTIONS.driverSessions)
      .where("went_online_at", ">=", start)
      .where("went_online_at", "<", end)
      .select("driver_id", "went_online_at", "went_offline_at")
      .limit(APP_HOURS_CAP)
      .get();
    scanned = snap.size;
    truncated = snap.size >= APP_HOURS_CAP;
    const monthEndMs = end.toMillis();
    const nowMs = Date.now();
    snap.forEach((doc) => {
      const driverId = text(doc.get("driver_id")) || text(doc.get("driverId"));
      if (!driverId) return;
      const startMs = instantOf(doc.get("went_online_at"));
      if (startMs === null) return;
      const endMs = instantOf(doc.get("went_offline_at")) ?? Math.min(nowMs, monthEndMs);
      if (endMs <= startMs) return;
      const list = spans.get(driverId) ?? [];
      list.push({ start: Math.max(startMs, start.toMillis()), end: Math.min(endMs, monthEndMs) });
      spans.set(driverId, list);
    });
  } catch {
    // A missing index or an unreadable session ledger leaves the column empty,
    // never the payroll load broken.
    return { month, hours: {}, scanned: 0, truncated: false };
  }
  const hours: Record<string, number> = {};
  for (const [driverId, list] of spans) hours[driverId] = unionHours(list);
  return { month, hours, scanned, truncated };
});
