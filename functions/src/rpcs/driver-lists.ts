import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
import { pickCount, pickDay, pickId, pickText, type Dict } from "./_shared";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYOUT_STATUSES = ["approved", "paid"] as const;
const EARNINGS_SCAN = 400;
const VISITS_SCAN = 200;

export const driverListsDeps = {
  requireRider,
  getFirestore,
};

function asData(request: CallableRequest<unknown>): Dict {
  return (request.data ?? {}) as Dict;
}

function clampLimit(data: Dict, fallback: number, max: number, ...names: string[]): number {
  const raw = pickCount(data, fallback, ...names);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(raw, max);
}

function requireDay(value: string | null): string {
  if (!value || !DAY_RE.test(value)) throw riderError("invalid-argument", "invalid_date");
  return value;
}

function asDay(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const instant = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOf(value: unknown): boolean {
  return value === true;
}

function rowOf(id: string, data: Dict): Dict {
  return { ...data, id };
}

function mapDocs(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
): Dict[] {
  return docs.map((doc) => rowOf(doc.id, (doc.data() ?? {}) as Dict));
}

export const driverListMyDeliveries = onCall(async (request) => {
  const ctx = await driverListsDeps.requireRider(request);
  const limit = clampLimit(asData(request), 50, 200, "limit", "p_limit");
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where(FIELDS.deliveries.driverId, "==", ctx.uid)
    .orderBy(FIELDS.deliveries.createdAt, "desc")
    .limit(limit)
    .get();
  return { ok: true, rows: mapDocs(snap.docs) };
});

export const driverListEarningsDaily = onCall(async (request) => {
  const ctx = await driverListsDeps.requireRider(request);
  const data = asData(request);
  const from = requireDay(pickDay(data, "p_from", "from", "p_start_date"));
  const to = requireDay(pickDay(data, "p_to", "to", "p_end_date"));
  if (from > to) throw riderError("invalid-argument", "invalid_date");

  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.driverEarningsDaily)
    .where("driver_id", "==", ctx.uid)
    .where("earn_date", ">=", from)
    .where("earn_date", "<=", to)
    .orderBy("earn_date", "desc")
    .limit(EARNINGS_SCAN)
    .get();
  return { ok: true, rows: mapDocs(snap.docs) };
});

export const driverListPayouts = onCall(async (request) => {
  const ctx = await driverListsDeps.requireRider(request);
  const limit = clampLimit(asData(request), 30, 100, "limit", "p_limit");
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.driverPayouts)
    .where("driver_id", "==", ctx.uid)
    .where("status", "in", [...PAYOUT_STATUSES])
    .orderBy("period_end", "desc")
    .limit(limit)
    .get();
  return { ok: true, rows: mapDocs(snap.docs) };
});

export const driverListRequestTypes = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.requestTypeDefinitions)
    .where("is_active", "==", true)
    .orderBy("sort_order", "asc")
    .get();
  return {
    ok: true,
    rows: snap.docs.map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return {
        key: textOf(raw.key),
        label_en: textOf(raw.label_en),
        label_ar: textOf(raw.label_ar),
        icon_key: textOf(raw.icon_key),
        is_system: boolOf(raw.is_system),
        sort_order: numberOf(raw.sort_order) ?? 0,
        date_range_required: boolOf(raw.date_range_required),
        min_attachments: numberOf(raw.min_attachments) ?? 0,
        attachments_error_code: textOf(raw.attachments_error_code),
      };
    }),
  };
});

export const driverListRequestFields = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const typeKey = pickText(asData(request), "p_type_key", "type_key", "typeKey");
  if (!typeKey) throw riderError("invalid-argument", "type_required");

  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.requestFieldDefinitions)
    .where("type_key", "==", typeKey)
    .orderBy("sort_order", "asc")
    .get();
  return {
    ok: true,
    rows: snap.docs.map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return {
        field_key: textOf(raw.field_key),
        label_en: textOf(raw.label_en),
        label_ar: textOf(raw.label_ar),
        kind: textOf(raw.kind),
        target: textOf(raw.target),
        is_required: boolOf(raw.is_required),
        sort_order: numberOf(raw.sort_order) ?? 0,
        options_source: textOf(raw.options_source),
        options: raw.options ?? [],
        min_value: numberOf(raw.min_value),
        max_value: numberOf(raw.max_value),
        help_en: textOf(raw.help_en),
        help_ar: textOf(raw.help_ar),
      };
    }),
  };
});

export const driverListTenureOptions = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.loanTenureOptions)
    .where("is_active", "==", true)
    .orderBy("sort_order", "asc")
    .get();
  return {
    ok: true,
    rows: snap.docs.map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return { months: numberOf(raw.months), label: textOf(raw.label) };
    }),
  };
});

export const driverListComplaintCategories = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.complaintCategories)
    .where("is_active", "==", true)
    .orderBy("sort_order", "asc")
    .get();
  return {
    ok: true,
    rows: snap.docs.map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return {
        key: textOf(raw.key),
        label_en: textOf(raw.label_en),
        label_ar: textOf(raw.label_ar),
      };
    }),
  };
});

export const driverGetDefaultVisitBranch = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.visitBranches)
    .where("is_active", "==", true)
    .orderBy("is_default", "desc")
    .orderBy("sort_order", "asc")
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return { ok: true, branch: doc ? rowOf(doc.id, (doc.data() ?? {}) as Dict) : null };
});

export const driverListVisitDepartments = onCall(async (request) => {
  await driverListsDeps.requireRider(request);
  const branchId = pickId(asData(request), "p_branch_id", "branch_id", "branchId");
  const col = driverListsDeps.getFirestore().collection(COLLECTIONS.visitDepartments);

  const snaps = branchId
    ? await Promise.all([
        col.where("is_active", "==", true).where("branch_id", "==", null).get(),
        col.where("is_active", "==", true).where("branch_id", "==", branchId).get(),
      ])
    : [await col.where("is_active", "==", true).orderBy("sort_order", "asc").get()];

  const seen = new Set<string>();
  const rows: Array<{
    key: string | null;
    label_en: string | null;
    label_ar: string | null;
    branch_id: string | null;
    sort_order: number;
  }> = [];
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const raw = (doc.data() ?? {}) as Dict;
      rows.push({
        key: textOf(raw.key),
        label_en: textOf(raw.label_en),
        label_ar: textOf(raw.label_ar),
        branch_id: textOf(raw.branch_id),
        sort_order: numberOf(raw.sort_order) ?? 0,
      });
    }
  }
  rows.sort((a, b) => a.sort_order - b.sort_order);
  return {
    ok: true,
    rows: rows.map((row) => ({
      key: row.key,
      label_en: row.label_en,
      label_ar: row.label_ar,
      branch_id: row.branch_id,
    })),
  };
});

export const driverListMyVisits = onCall(async (request) => {
  const ctx = await driverListsDeps.requireRider(request);
  const snap = await driverListsDeps
    .getFirestore()
    .collection(COLLECTIONS.visitBookings)
    .where("driver_id", "==", ctx.uid)
    .orderBy("scheduled_date", "desc")
    .limit(VISITS_SCAN)
    .get();
  return {
    ok: true,
    rows: snap.docs.map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return {
        id: doc.id,
        booking_code: textOf(raw.booking_code),
        department_key: textOf(raw.department_key),
        scheduled_date: asDay(raw.scheduled_date) ?? textOf(raw.scheduled_date),
        status: textOf(raw.status),
        note: textOf(raw.note),
        note_to_rider: textOf(raw.note_to_rider),
      };
    }),
  };
});
