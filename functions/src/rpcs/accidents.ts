/**
 * Rider-side Accident Management.
 *
 * The admin writes the same collection through `createAccident` in
 * `src/features/fleet/accidents/accident-actions.ts`. Because the Functions
 * tsconfig pins `rootDir` to `src`, this module cannot import the app's payload
 * builder, so the field contract is repeated here — deliberately, and named field
 * for field after `accidentWritePayload`, so a reader can diff the two.
 *
 * The nine client conditions constraining this file:
 *  - **No seven-day window.** Only a future date is refused; a historical accident
 *    is valid.
 *  - **Ownership proof.** Every attachment key must sit under this rider's
 *    `drivers/{uid}/accident_attachment/` prefix, have a *completed*
 *    `storage_uploads` row uploaded by this rider, and not already be claimed by
 *    another accident.
 *  - **Driver Fault is Yes / No** — a rider report never sets it.
 *  - **`case_status` starts `pending`**, `vehicle_case_status` starts `case_check`,
 *    and `reviewed_*` stays empty until an admin completes the report.
 *  - **No push, WhatsApp, email or cron alert** is sent from here.
 *  - **`vehicles` is never touched.**
 */
import { onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
import { logDriverOperation, pick, pickText, type Dict } from "./_shared";

const VEHICLE_ACCIDENTS = "vehicle_accidents";
const STORAGE_UPLOADS = "storage_uploads";
const VEHICLES = "vehicles";
const VEHICLE_COMPANIES = "vehicle_companies";

/** Mirrors `accident-reference.ts`. The prefix the client confirmed: `ACC-0001`. */
export const ACCIDENT_REFERENCE_PREFIX = "ACC-";
export const ACCIDENT_REFERENCE_DIGITS = 4;
export const ACCIDENT_REFERENCE_COUNTER = "accident_reference_seq";

/** Mirrors `MAX_ACCIDENT_ATTACHMENTS` in `accident-types.ts`. */
export const MAX_ACCIDENT_ATTACHMENTS = 10;
export const ACCIDENT_ATTACHMENT_FOLDER = "accident_attachment";
/** Kept for symmetry with the admin export; riders see `pending` on their own. */
export const RIDER_REPORT_CASE_STATUS = "pending";
export const RIDER_REPORT_VEHICLE_CASE_STATUS = "case_check";

export function formatAccidentReference(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.trunc(value);
  if (n < 1) return "";
  return `${ACCIDENT_REFERENCE_PREFIX}${String(n).padStart(ACCIDENT_REFERENCE_DIGITS, "0")}`;
}

/** `drivers/{uid}/accident_attachment/{date}/{uuid}.{ext}`, no traversal. */
export function accidentAttachmentKeyValid(uid: string, key: string): boolean {
  if (!uid || !key) return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("//")) return false;
  return key.startsWith(`drivers/${uid}/${ACCIDENT_ATTACHMENT_FOLDER}/`);
}

export type AccidentReportInput = {
  occurredAt: unknown;
  locationText: string | null;
  locationLat: number | null;
  locationLng: number | null;
  otherPartyName: string | null;
  otherPartyPlate: string | null;
  otherPartyPhone: string | null;
  description: string | null;
  attachmentKeys: string[];
};

export type AccidentReportValidation =
  | { ok: true; occurredAt: Date }
  | { ok: false; error: string };

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  return null;
}

const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Pure so `accidents.test.ts` can prove the time rule without an emulator:
 * a future instant is refused, a thirty-day-old instant is accepted, and nothing
 * enforces a lower bound.
 */
export function validateAccidentReport(
  input: AccidentReportInput,
  now: Date = new Date(),
): AccidentReportValidation {
  const occurredAt = asDate(input.occurredAt);
  if (!occurredAt) return { ok: false, error: "invalid_date" };
  if (occurredAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, error: "future_date" };
  }
  if (!input.locationText || input.locationText.trim() === "") {
    return { ok: false, error: "location_required" };
  }
  for (const [value, minimum, maximum] of [
    [input.locationLat, -90, 90],
    [input.locationLng, -180, 180],
  ] as const) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      return { ok: false, error: "invalid_location" };
    }
  }
  const keys = input.attachmentKeys.filter((key) => key.trim() !== "");
  if (keys.length === 0) return { ok: false, error: "attachment_required" };
  if (keys.length > MAX_ACCIDENT_ATTACHMENTS) return { ok: false, error: "too_many_attachments" };
  return { ok: true, occurredAt };
}

function capped(value: string | null, limit: number): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type ResolvedVehicle = {
  vehicleId: string;
  plate: string | null;
  companyName: string | null;
  modelYear: number | null;
};

async function loadVehicle(vehicleId: string): Promise<ResolvedVehicle | null> {
  const db = getFirestore();
  const snap = await db.collection(VEHICLES).doc(vehicleId).get();
  if (!snap.exists) return null;
  const vehicle = (snap.data() ?? {}) as Dict;
  const plate =
    (typeof vehicle["reg_number"] === "string" && vehicle["reg_number"].trim()) ||
    (typeof vehicle["bike_id"] === "string" && vehicle["bike_id"].trim()) ||
    null;
  const modelYear = numeric(vehicle["model_year"]);
  const companyId = typeof vehicle["company_id"] === "string" ? vehicle["company_id"] : "";
  let companyName: string | null = null;
  if (companyId) {
    const company = await db.collection(VEHICLE_COMPANIES).doc(companyId).get();
    if (company.exists) {
      const row = (company.data() ?? {}) as Dict;
      companyName = typeof row["label_en"] === "string" ? row["label_en"] : companyId;
    }
  }
  return {
    vehicleId,
    plate: typeof plate === "string" && plate ? plate : null,
    companyName,
    modelYear,
  };
}

/**
 * The ownership proof. Returns the reason a key cannot be filed, or `null`.
 *
 * A key is only accepted when all three hold: the prefix names this rider, a
 * *completed* upload row is owned by this rider, and no other accident lists it.
 * `excludeId` lets a re-submit name its own case.
 */
export async function attachmentKeyProblem(
  uid: string,
  key: string,
  excludeId?: string,
): Promise<string | null> {
  if (!accidentAttachmentKeyValid(uid, key)) return "invalid_attachment";
  const db = getFirestore();
  const uploads = await db
    .collection(STORAGE_UPLOADS)
    .where("object_key", "==", key)
    .limit(5)
    .get();
  const owned = uploads.docs.some(
    (doc) => doc.get("uploaded_by") === uid && doc.get("status") === "completed",
  );
  if (!owned) return "attachment_not_owned";
  const claimed = await db
    .collection(VEHICLE_ACCIDENTS)
    .where("attachment_keys", "array-contains", key)
    .limit(5)
    .get();
  if (claimed.docs.some((doc) => doc.id !== excludeId)) return "attachment_claimed";
  return null;
}

async function allocateReference(): Promise<string> {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.counters).doc(ACCIDENT_REFERENCE_COUNTER);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = Number(snap.data()?.["value"] ?? 0);
    const value = (Number.isFinite(current) ? current : 0) + 1;
    tx.set(ref, { value, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return value;
  });
  return formatAccidentReference(next);
}


export const driverReportAccident = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;

  if (ctx.driver["archived_at"]) return { ok: false, error: "not_a_driver" };

  const vehicleId = typeof ctx.driver["vehicle_id"] === "string" ? ctx.driver["vehicle_id"] : "";
  if (!vehicleId) return { ok: false, error: "vehicle_not_assigned" };

  const rawKeys = pick(data, "p_attachment_keys", "attachmentKeys", "attachment_keys");
  const attachmentKeys = Array.isArray(rawKeys)
    ? rawKeys.map((key) => (typeof key === "string" ? key.trim() : "")).filter(Boolean)
    : [];

  const input: AccidentReportInput = {
    occurredAt: pick(data, "p_occurred_at", "occurredAt", "occurred_at"),
    locationText: pickText(data, "p_location_text", "locationText", "location_text"),
    locationLat: numeric(pick(data, "p_location_lat", "locationLat", "location_lat")),
    locationLng: numeric(pick(data, "p_location_lng", "locationLng", "location_lng")),
    otherPartyName: pickText(data, "p_other_party_name", "otherPartyName", "other_party_name"),
    otherPartyPlate: pickText(data, "p_other_party_plate", "otherPartyPlate", "other_party_plate"),
    otherPartyPhone: pickText(data, "p_other_party_phone", "otherPartyPhone", "other_party_phone"),
    description: pickText(data, "p_description", "description", "p_notes", "notes"),
    attachmentKeys,
  };

  const validation = validateAccidentReport(input);
  if (!validation.ok) return { ok: false, error: validation.error };

  const vehicle = await loadVehicle(vehicleId);
  if (!vehicle) return { ok: false, error: "vehicle_not_assigned" };

  for (const key of attachmentKeys) {
    const problem = await attachmentKeyProblem(ctx.uid, key);
    if (problem === "attachment_not_owned") {
      throw riderError("permission-denied", problem);
    }
    if (problem) return { ok: false, error: problem };
  }

  const db = getFirestore();
  const reference = await allocateReference();
  const driverName =
    typeof ctx.profile["full_name"] === "string" ? (ctx.profile["full_name"] as string) : null;
  const employeeId =
    typeof ctx.driver["employee_id"] === "string" ? (ctx.driver["employee_id"] as string) : null;
  const driverCode =
    typeof ctx.driver["driver_code"] === "string" ? (ctx.driver["driver_code"] as string) : null;

  const ref = db.collection(VEHICLE_ACCIDENTS).doc();
  const now = Timestamp.now();
  await ref.set({
    reference,
    vehicle_id: vehicle.vehicleId,
    plate_snapshot: vehicle.plate,
    vehicle_company_name: vehicle.companyName,
    model_year: vehicle.modelYear,
    driver_id: ctx.uid,
    driver_name: driverName,
    driver_code: driverCode,
    employee_id: employeeId,
    occurred_at: Timestamp.fromDate(validation.occurredAt),
    location_text: capped(input.locationText, 240),
    location_lat: input.locationLat,
    location_lng: input.locationLng,
    insurance_company: null,
    insurance_claim_status: null,
    police_report_status: null,
    amount_kwd: null,
    // Yes / No only, and a rider report never answers it.
    driver_fault: null,
    case_status: RIDER_REPORT_CASE_STATUS,
    vehicle_case_status: RIDER_REPORT_VEHICLE_CASE_STATUS,
    fleet_comment: null,
    replacement_plate: null,
    other_party_name: capped(input.otherPartyName, 120),
    other_party_plate: capped(input.otherPartyPlate, 40),
    other_party_phone: capped(input.otherPartyPhone, 40),
    description: capped(input.description, 1000),
    attachment_keys: attachmentKeys.slice(0, MAX_ACCIDENT_ATTACHMENTS),
    attachment_meta: [],
    source: "rider",
    reported_by: ctx.uid,
    reported_by_name: driverName,
    reviewed_at: null,
    reviewed_by: null,
    reviewed_by_name: null,
    review_note: null,
    severity: null,
    notes: null,
    storage_key: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.uid,
  });

  await logDriverOperation({
    driverId: ctx.uid,
    module: "vehicle",
    action: "accident.report",
    actor: ctx.uid,
    success: true,
    recordType: "vehicle_accident",
    recordId: ref.id,
    detail: { reference, vehicle_id: vehicleId, attachments: attachmentKeys.length },
  });

  return { ok: true, id: ref.id, reference };
});

export const driverListMyAccidents = onCall(async (request) => {
  const ctx = await requireRider(request);
  const db = getFirestore();
  const snap = await db
    .collection(VEHICLE_ACCIDENTS)
    .where("driver_id", "==", ctx.uid)
    .limit(50)
    .get();

  const rows = snap.docs
    .map((doc) => {
      const row = (doc.data() ?? {}) as Dict;
      const occurred = asDate(row["occurred_at"]);
      const keys = Array.isArray(row["attachment_keys"]) ? row["attachment_keys"] : [];
      return {
        id: doc.id,
        reference: typeof row["reference"] === "string" ? row["reference"] : null,
        occurred_at: occurred ? occurred.toISOString() : null,
        case_status:
          row["case_status"] === "close" || row["case_status"] === "delay"
            ? row["case_status"]
            : "pending",
        plate: typeof row["plate_snapshot"] === "string" ? row["plate_snapshot"] : null,
        location_text: typeof row["location_text"] === "string" ? row["location_text"] : null,
        description: typeof row["description"] === "string" ? row["description"] : null,
        attachment_count: keys.length + (row["storage_key"] ? 1 : 0),
        reviewed: row["reviewed_at"] != null,
      };
    })
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));

  return { ok: true, accidents: rows };
});

