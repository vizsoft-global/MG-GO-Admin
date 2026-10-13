"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { sendPushBatch } from "@/lib/firebase/fcm-provider";
import { buildActionPayload, buildFcmDataPayload } from "@/features/notifications/payload-contract";
import { pickLatestPushTokenByDriver } from "@/features/notifications/push-token-select";
import { lunchBreakOutsideHours, visitHoursInvalid } from "./visit-hours";
import {
  nextDefaultBranchUpdates,
  planVisitWeekdaySlotCopy,
  type RecurringVisitSlot,
} from "./visit-slot-copy";

const DRIVER_PUSH_TOKENS = "driver_push_tokens";

type DocRow = Record<string, unknown> & { id: string };

function cell(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(cell);
  return value;
}

function docRow(id: string, data: DocumentData | undefined): DocRow | null {
  if (!data) return null;
  const row: DocRow = { id };
  for (const [key, value] of Object.entries(data)) row[key] = cell(value);
  return row;
}

async function openDb(): Promise<Firestore | null> {
  return staffDb();
}

async function getDoc(
  name: string,
  id: string,
): Promise<{ row: DocRow | null; error: string | null }> {
  const db = await openDb();
  if (!db) return { row: null, error: "not_configured" };
  try {
    const snap = await db.collection(name).doc(id).get();
    if (!snap.exists) return { row: null, error: null };
    return { row: docRow(snap.id, snap.data()), error: null };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function listDocs(name: string): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    const snap = await db.collection(name).get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function queryDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch {
    const all = await listDocs(name);
    if (all.error) return all;
    return {
      rows: all.rows.filter((row) => filters.every(([field, value]) => row[field] === value)),
      error: null,
    };
  }
}

async function docsByIds(name: string, ids: string[]): Promise<DocRow[]> {
  const db = await openDb();
  if (!db) return [];
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const out: DocRow[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(name).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const row = docRow(snap.id, snap.data());
      if (row) out.push(row);
    }
  }
  return out;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function sortRows(rows: DocRow[], keys: Array<[string, "asc" | "desc"]>): DocRow[] {
  return [...rows].sort((left, right) => {
    for (const [key, dir] of keys) {
      const c = compareValues(left[key], right[key]);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return 0;
  });
}

async function patchDoc(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    const ref = db.collection(name).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(data, { merge: true });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "write_failed";
  }
}

async function insertDoc(
  name: string,
  data: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const db = await openDb();
  if (!db) return { error: "not_configured" };
  const id = crypto.randomUUID();
  try {
    await db.collection(name).doc(id).set({ ...data, id });
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write_failed" };
  }
}

async function insertMany(
  name: string,
  rows: Record<string, unknown>[],
): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      for (const data of rows.slice(i, i + 400)) {
        const id = crypto.randomUUID();
        batch.set(db.collection(name).doc(id), { ...data, id });
      }
      await batch.commit();
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "write_failed";
  }
}

async function deleteDoc(name: string, id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    await db.collection(name).doc(id).delete();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "delete_failed";
  }
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isInteger(item)) : [];
}

export type VisitListRow = {
  id: string;
  booking_code: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  driver_code: string;
  department_key: string;
  department_label: string;
  branch_id: string | null;
  branch_name: string | null;
  slot_id: string;
  slot_start: string | null;
  slot_end: string | null;
  scheduled_date: string;
  status: string;
  note: string | null;
  created_at: string;
  checked_in_at: string | null;
};

export type VisitKpis = {
  today: number;
  today_checked_in: number;
  upcoming: number;
  awaiting_checkin: number;
  no_shows: number;
};

export type VisitDetailRow = VisitListRow & {
  branch_id: string | null;
  branch_name: string | null;
  slot_id: string;
  slot_start: string | null;
  slot_end: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
  /** Staff-authored instruction for the rider (separate from the rider's purpose). */
  note_to_rider: string | null;
};

export type VisitBookingNoteRow = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
};

export type VisitDepartmentRow = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  is_active: boolean;
  sort_order: number;
  desk_location: string | null;
  assigned_staff_name: string | null;
  avg_handling_minutes: number | null;
  desks_count: number;
  /** Branch this department is offered at. `null` = every branch. */
  branch_id: string | null;
};

export type VisitBranchRow = {
  id: string;
  key: string;
  name: string;
  address: string | null;
  city: string | null;
  working_days: string | null;
  working_dows: number[];
  opening_time: string | null;
  closing_time: string | null;
  desks_count: number;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

export type VisitSlotRow = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  department_key: string;
  department_label: string;
  slot_date: string | null;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active: boolean;
};

async function requireVisitsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireVisitsOperate() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireVisitsManageCatalog() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "visits.manage_catalog",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

export async function fetchAdminVisitsList(input?: {
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: VisitListRow[]; kpi: VisitKpis; error?: string }> {
  await requireVisitsView();
  const { data, error } = await callAdminFunction("admin_list_visits", {
    p_date_from: input?.dateFrom || undefined,
    p_date_to: input?.dateTo || undefined,
    p_status: input?.status || undefined,
    p_limit: input?.limit ?? 50,
    p_offset: input?.offset ?? 0,
  });

  const emptyKpi: VisitKpis = {
    today: 0,
    today_checked_in: 0,
    upcoming: 0,
    awaiting_checkin: 0,
    no_shows: 0,
  };

  if (error) return { rows: [], kpi: emptyKpi, error: error.message };
  const payload = data as {
    ok?: boolean;
    rows?: unknown[];
    kpi?: Record<string, unknown>;
    error?: string;
  };
  if (payload?.ok === false) {
    return { rows: [], kpi: emptyKpi, error: payload.error ?? "failed" };
  }

  const rows = (payload?.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r.id),
      booking_code: String(r.booking_code ?? ""),
      driver_id: String(r.driver_id ?? ""),
      driver_name: String(r.driver_name ?? "—"),
      driver_phone: r.driver_phone != null ? String(r.driver_phone) : null,
      driver_code: String(r.driver_code ?? ""),
      department_key: String(r.department_key ?? ""),
      department_label: String(r.department_label ?? r.department_key ?? ""),
      branch_id: r.branch_id != null ? String(r.branch_id) : null,
      branch_name: r.branch_name != null ? String(r.branch_name) : null,
      slot_id: String(r.slot_id ?? ""),
      slot_start: r.slot_start != null ? String(r.slot_start) : null,
      slot_end: r.slot_end != null ? String(r.slot_end) : null,
      scheduled_date: String(r.scheduled_date ?? ""),
      status: String(r.status ?? ""),
      note: r.note != null ? String(r.note) : null,
      created_at: String(r.created_at ?? ""),
      checked_in_at: r.checked_in_at != null ? String(r.checked_in_at) : null,
    };
  });

  const kpiRaw = payload?.kpi ?? {};
  const kpi: VisitKpis = {
    today: Number(kpiRaw.today ?? 0),
    today_checked_in: Number(kpiRaw.today_checked_in ?? 0),
    upcoming: Number(kpiRaw.upcoming ?? 0),
    awaiting_checkin: Number(kpiRaw.awaiting_checkin ?? 0),
    no_shows: Number(kpiRaw.no_shows ?? 0),
  };

  return { rows, kpi };
}

export async function fetchAdminVisitDetail(
  bookingId: string,
): Promise<{ visit: VisitDetailRow | null; error?: string }> {
  await requireVisitsView();
  const loaded = await getDoc(COLLECTIONS.visitBookings, bookingId);
  if (loaded.error) return { visit: null, error: loaded.error };
  const booking = loaded.row;
  if (!booking) return { visit: null };

  const driverId = text(booking.driver_id);
  const departmentKey = text(booking.department_key);
  const branchId = textOrNull(booking.branch_id);
  const slotId = text(booking.slot_id);
  const [driver, profile, departments, branch, slot] = await Promise.all([
    getDoc(COLLECTIONS.drivers, driverId),
    getDoc(COLLECTIONS.profiles, driverId),
    queryDocs(COLLECTIONS.visitDepartments, [["key", departmentKey]]),
    branchId ? getDoc(COLLECTIONS.visitBranches, branchId) : Promise.resolve({ row: null, error: null }),
    slotId ? getDoc(COLLECTIONS.visitSlots, slotId) : Promise.resolve({ row: null, error: null }),
  ]);
  const department = departments.rows[0];

  return {
    visit: {
      id: booking.id,
      booking_code: text(booking.booking_code),
      driver_id: driverId,
      driver_name: text(profile.row?.full_name) || "—",
      driver_phone: textOrNull(profile.row?.phone),
      driver_code: text(driver.row?.driver_code),
      department_key: departmentKey,
      department_label: text(department?.label_en) || departmentKey,
      scheduled_date: text(booking.scheduled_date),
      status: text(booking.status),
      note: textOrNull(booking.note),
      created_at: text(booking.created_at),
      branch_id: branchId,
      branch_name: textOrNull(branch.row?.name),
      slot_id: slotId,
      slot_start: textOrNull(slot.row?.start_time),
      slot_end: textOrNull(slot.row?.end_time),
      checked_in_at: textOrNull(booking.checked_in_at),
      completed_at: textOrNull(booking.completed_at),
      cancelled_at: textOrNull(booking.cancelled_at),
      updated_at: text(booking.updated_at),
      note_to_rider: textOrNull(booking.note_to_rider),
    },
  };
}

export async function fetchVisitBookingNotes(
  bookingId: string,
): Promise<{ rows: VisitBookingNoteRow[]; error?: string }> {
  await requireVisitsView();
  const listed = await queryDocs(COLLECTIONS.visitBookingNotes, [["booking_id", bookingId]]);
  if (listed.error) return { rows: [], error: listed.error };
  const notes = sortRows(listed.rows, [["created_at", "desc"]]);
  const authors = await docsByIds(
    COLLECTIONS.profiles,
    notes.map((note) => text(note.author_id)),
  );
  const nameById = new Map(authors.map((author) => [author.id, textOrNull(author.full_name)]));

  return {
    rows: notes.map((note) => ({
      id: note.id,
      body: text(note.body),
      created_at: text(note.created_at),
      author_name: note.author_id ? (nameById.get(text(note.author_id)) ?? null) : null,
    })),
  };
}

export async function addVisitBookingNote(input: {
  bookingId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireVisitsView();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "note_required" };

  const inserted = await insertDoc(COLLECTIONS.visitBookingNotes, {
    booking_id: input.bookingId,
    author_id: session.id,
    body,
    created_at: new Date(),
  });
  if (inserted.error) return { ok: false, error: inserted.error };
  return { ok: true };
}

export async function updateVisitNoteToRider(input: {
  bookingId: string;
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsOperate();
  const { data, error } = await callAdminFunction("admin_set_visit_note_to_rider", {
    p_booking_id: input.bookingId,
    p_note: input.note,
  });

  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? "save_failed") };
  }
  if (payload.notified === true && typeof payload.driver_id === "string") {
    await sendVisitNotePush({
      driverId: payload.driver_id,
      bookingId: input.bookingId,
      bookingCode: typeof payload.booking_code === "string" ? payload.booking_code : "",
      note: input.note.trim(),
      campaignId: typeof payload.campaign_id === "string" ? payload.campaign_id : "",
      dispatchItemId:
        typeof payload.dispatch_item_id === "string" ? payload.dispatch_item_id : "",
    });
  }
  return { ok: true };
}

async function sendVisitNotePush(input: {
  driverId: string;
  bookingId: string;
  bookingCode: string;
  note: string;
  campaignId: string;
  dispatchItemId: string;
}): Promise<void> {
  if (!input.note || !input.campaignId) return;
  try {
    const listed = await queryDocs(DRIVER_PUSH_TOKENS, [
      ["driver_id", input.driverId],
      ["is_active", true],
    ]);
    const token = pickLatestPushTokenByDriver(
      listed.rows.map((row) => ({
        id: row.id,
        driver_id: text(row.driver_id),
        token: text(row.token),
        last_seen_at: textOrNull(row.last_seen_at),
      })),
    ).get(input.driverId);
    if (!token) return;
    const action = buildActionPayload({
      actionType: "open_record",
      actionParams: {
        record_type: "visit",
        record_id: input.bookingId,
        route: "/profile/support/visits",
        booking_code: input.bookingCode,
        note_to_rider: input.note,
      },
      deepLink: "musallam:///profile/support/visits",
      campaignId: input.campaignId,
    });
    await sendPushBatch([
      {
        token: token.token,
        title: `Visit note — ${input.bookingCode}`.trim(),
        body: input.note,
        data: buildFcmDataPayload({
          campaignId: input.campaignId,
          dispatchItemId: input.dispatchItemId || null,
          action,
          category: "operations",
          priority: "normal",
        }),
      },
    ]);
  } catch {
    // Inbox row already exists; a dead FCM path must not fail the save.
  }
}

export async function rescheduleAdminVisit(input: {
  bookingId: string;
  scheduledDate: string;
  slotId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    return { ok: false, error: "not_authorized" };
  }

  const { data, error } = await callAdminFunction("admin_reschedule_visit", {
    p_booking_id: input.bookingId,
    p_new_date: input.scheduledDate,
    p_new_slot_id: input.slotId,
  });

  if (error) return { ok: false, error: error.message };
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.ok === false) return { ok: false, error: payload.error ?? "failed" };
  return { ok: true };
}

export async function fetchReceptionVisitsToday(): Promise<{
  rows: VisitListRow[];
  error?: string;
}> {
  await requireVisitsOperate();
  const today = new Date().toISOString().slice(0, 10);
  return fetchAdminVisitsList({
    status: "confirmed",
    dateFrom: today,
    dateTo: today,
    limit: 200,
  });
}

export async function updateAdminVisitStatus(input: {
  bookingId: string;
  status: "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    return { ok: false, error: "not_authorized" };
  }
  const { data, error } = await callAdminFunction("admin_update_visit_status", {
    p_booking_id: input.bookingId,
    p_status: input.status,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.ok === false) return { ok: false, error: payload.error ?? "failed" };
  return { ok: true };
}

/**
 * Bulk status change runs the same per-booking RPC in a loop, so permissions and the
 * rider notification behave exactly as they do for a single row. Failures are reported
 * per booking instead of aborting the batch — same contract as bulk request decisions.
 */
export async function updateAdminVisitStatusBulk(input: {
  bookingIds: string[];
  status: "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
}): Promise<{
  ok: boolean;
  succeeded: string[];
  failed: Array<{ bookingId: string; error: string }>;
  error?: string;
}> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    return { ok: false, succeeded: [], failed: [], error: "not_authorized" };
  }
  if (input.bookingIds.length === 0) {
    return { ok: false, succeeded: [], failed: [], error: "no_bookings" };
  }

  const succeeded: string[] = [];
  const failed: Array<{ bookingId: string; error: string }> = [];

  for (const bookingId of input.bookingIds) {
    const { data, error } = await callAdminFunction("admin_update_visit_status", {
      p_booking_id: bookingId,
      p_status: input.status,
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string };
    if (error) {
      failed.push({ bookingId, error: error.message });
    } else if (payload.ok === false) {
      failed.push({ bookingId, error: payload.error ?? "failed" });
    } else {
      succeeded.push(bookingId);
    }
  }

  return { ok: failed.length === 0, succeeded, failed };
}

export async function fetchVisitDepartments(): Promise<{
  rows: VisitDepartmentRow[];
  error?: string;
}> {
  await requireVisitsView();
  const listed = await listDocs(COLLECTIONS.visitDepartments);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["sort_order", "asc"]]).map(
      (row): VisitDepartmentRow => ({
        id: row.id,
        key: text(row.key),
        label_en: text(row.label_en),
        label_ar: textOrNull(row.label_ar),
        is_active: row.is_active === true,
        sort_order: Number(row.sort_order ?? 0),
        desk_location: textOrNull(row.desk_location),
        assigned_staff_name: textOrNull(row.assigned_staff_name),
        avg_handling_minutes:
          row.avg_handling_minutes == null ? null : Number(row.avg_handling_minutes),
        desks_count: Number(row.desks_count ?? 0),
        branch_id: textOrNull(row.branch_id),
      }),
    ),
  };
}

export async function updateVisitDepartmentDesks(input: {
  id: string;
  desks_count: number;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  if (!Number.isInteger(input.desks_count) || input.desks_count < 0) {
    return { ok: false, error: "invalid_desks_count" };
  }
  const error = await patchDoc(COLLECTIONS.visitDepartments, input.id, {
    desks_count: input.desks_count,
    updated_at: new Date(),
  });
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function createVisitDepartment(input: {
  key: string;
  label_en: string;
  label_ar?: string | null;
  desk_location?: string | null;
  assigned_staff_name?: string | null;
  avg_handling_minutes?: number | null;
  desks_count?: number;
  branch_id?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireVisitsManageCatalog();
  if (!input.key.trim() || !input.label_en.trim()) {
    return { ok: false, error: "key_and_label_required" };
  }
  if (
    input.desks_count !== undefined &&
    (!Number.isInteger(input.desks_count) || input.desks_count < 0)
  ) {
    return { ok: false, error: "invalid_desks_count" };
  }
  const inserted = await insertDoc(COLLECTIONS.visitDepartments, {
    key: input.key.trim(),
    label_en: input.label_en.trim(),
    label_ar: input.label_ar ?? null,
    desk_location: input.desk_location ?? null,
    assigned_staff_name: input.assigned_staff_name ?? null,
    avg_handling_minutes: input.avg_handling_minutes ?? null,
    desks_count: input.desks_count ?? 1,
    branch_id: input.branch_id ?? null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  if (inserted.error || !inserted.id) return { ok: false, error: inserted.error ?? "write_failed" };
  return { ok: true, id: inserted.id };
}

export async function updateVisitDepartment(input: {
  id: string;
  is_active?: boolean;
  desk_location?: string | null;
  assigned_staff_name?: string | null;
  avg_handling_minutes?: number | null;
  desks_count?: number;
  branch_id?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  if (
    input.desks_count !== undefined &&
    (!Number.isInteger(input.desks_count) || input.desks_count < 0)
  ) {
    return { ok: false, error: "invalid_desks_count" };
  }
  const patch = {
    updated_at: new Date(),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    ...(input.desk_location !== undefined ? { desk_location: input.desk_location } : {}),
    ...(input.assigned_staff_name !== undefined
      ? { assigned_staff_name: input.assigned_staff_name }
      : {}),
    ...(input.avg_handling_minutes !== undefined
      ? { avg_handling_minutes: input.avg_handling_minutes }
      : {}),
    ...(input.desks_count !== undefined ? { desks_count: input.desks_count } : {}),
    ...(input.branch_id !== undefined ? { branch_id: input.branch_id } : {}),
  };
  const error = await patchDoc(COLLECTIONS.visitDepartments, input.id, patch);
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function fetchVisitBranches(): Promise<{
  rows: VisitBranchRow[];
  error?: string;
}> {
  await requireVisitsView();
  const listed = await listDocs(COLLECTIONS.visitBranches);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["sort_order", "asc"]]).map(
      (row): VisitBranchRow => ({
        id: row.id,
        key: text(row.key),
        name: text(row.name),
        address: textOrNull(row.address),
        city: textOrNull(row.city),
        working_days: textOrNull(row.working_days),
        working_dows: numberList(row.working_dows),
        opening_time: textOrNull(row.opening_time),
        closing_time: textOrNull(row.closing_time),
        desks_count: Number(row.desks_count ?? 0),
        is_default: row.is_default === true,
        is_active: row.is_active === true,
        sort_order: Number(row.sort_order ?? 0),
      }),
    ),
  };
}

export async function createVisitBranch(input: {
  key: string;
  name: string;
  address?: string | null;
  city?: string | null;
  working_days?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  desks_count?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireVisitsManageCatalog();
  if (!input.key.trim() || !input.name.trim()) {
    return { ok: false, error: "key_and_name_required" };
  }
  if (visitHoursInvalid(input.opening_time, input.closing_time)) {
    return { ok: false, error: "invalid_hours" };
  }
  const inserted = await insertDoc(COLLECTIONS.visitBranches, {
    key: input.key.trim(),
    name: input.name.trim(),
    address: input.address ?? null,
    city: input.city ?? null,
    working_days: input.working_days ?? null,
    opening_time: input.opening_time ?? null,
    closing_time: input.closing_time ?? null,
    desks_count: input.desks_count ?? 1,
    is_active: true,
    is_default: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
  if (inserted.error || !inserted.id) return { ok: false, error: inserted.error ?? "write_failed" };
  return { ok: true, id: inserted.id };
}

export async function updateVisitBranch(input: {
  id: string;
  name?: string;
  address?: string | null;
  city?: string | null;
  working_days?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  desks_count?: number;
  is_active?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  if (visitHoursInvalid(input.opening_time, input.closing_time)) {
    return { ok: false, error: "invalid_hours" };
  }
  const patch = {
    updated_at: new Date(),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.working_days !== undefined ? { working_days: input.working_days } : {}),
    ...(input.opening_time !== undefined ? { opening_time: input.opening_time } : {}),
    ...(input.closing_time !== undefined ? { closing_time: input.closing_time } : {}),
    ...(input.desks_count !== undefined ? { desks_count: input.desks_count } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  };

  const error = await patchDoc(COLLECTIONS.visitBranches, input.id, patch);
  if (error) return { ok: false, error };
  return { ok: true };
}

/**
 * One default only — enforced by existing unique index
 * `visit_branches_single_default_uidx` (migration 20260827103000). No new SQL.
 */
export async function setVisitBranchDefault(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  const listed = await listDocs(COLLECTIONS.visitBranches);
  if (listed.error) return { ok: false, error: listed.error };

  const plan = nextDefaultBranchUpdates(
    listed.rows.map((row) => ({
      id: row.id,
      is_default: row.is_default === true,
      is_active: row.is_active === true,
    })),
    id,
  );
  if (!plan.ok) return { ok: false, error: plan.error };
  if (plan.already) return { ok: true };

  const now = new Date();
  for (const clearId of plan.clearIds) {
    const clearError = await patchDoc(COLLECTIONS.visitBranches, clearId, {
      is_default: false,
      updated_at: now,
    });
    if (clearError) return { ok: false, error: clearError };
  }

  const setError = await patchDoc(COLLECTIONS.visitBranches, id, {
    is_default: true,
    updated_at: now,
  });
  if (setError) {
    if (plan.clearIds.length > 0) {
      await patchDoc(COLLECTIONS.visitBranches, plan.clearIds[0], {
        is_default: true,
        updated_at: new Date(),
      });
    }
    return { ok: false, error: setError };
  }
  return { ok: true };
}

/**
 * Copies recurring weekday templates onto every other active branch.
 * Inserts `visit_slots` only — never reads or writes `visit_bookings`.
 * A second run is a no-op (skip-if-exists on dept / dow / start / end).
 */
export async function copyVisitWeekdaySlotsToAllBranches(): Promise<{
  ok: boolean;
  inserted: number;
  sourceBranchId: string | null;
  error?: string;
}> {
  await requireVisitsManageCatalog();
  const [branchesRes, slotsRes] = await Promise.all([
    listDocs(COLLECTIONS.visitBranches),
    listDocs(COLLECTIONS.visitSlots),
  ]);
  if (branchesRes.error) {
    return { ok: false, inserted: 0, sourceBranchId: null, error: branchesRes.error };
  }
  if (slotsRes.error) {
    return { ok: false, inserted: 0, sourceBranchId: null, error: slotsRes.error };
  }

  const planned = planVisitWeekdaySlotCopy(
    branchesRes.rows.map((row) => ({
      id: row.id,
      is_default: row.is_default === true,
      is_active: row.is_active === true,
      working_dows: numberList(row.working_dows),
    })),
    slotsRes.rows
      .filter((row) => row.slot_date == null)
      .map(
        (row): RecurringVisitSlot => ({
          id: row.id,
          branch_id: textOrNull(row.branch_id),
          department_key: text(row.department_key),
          slot_date: null,
          day_of_week: row.day_of_week == null ? null : Number(row.day_of_week),
          start_time: text(row.start_time),
          end_time: text(row.end_time),
          capacity: Number(row.capacity ?? 0),
          is_active: row.is_active === true,
        }),
      ),
  );
  if (planned.inserts.length === 0) {
    return { ok: true, inserted: 0, sourceBranchId: planned.sourceBranchId };
  }

  const insertError = await insertMany(
    COLLECTIONS.visitSlots,
    planned.inserts.map((row) => ({ ...row, created_at: new Date() })),
  );
  if (insertError) {
    return {
      ok: false,
      inserted: 0,
      sourceBranchId: planned.sourceBranchId,
      error: insertError,
    };
  }
  return {
    ok: true,
    inserted: planned.inserts.length,
    sourceBranchId: planned.sourceBranchId,
  };
}

export type VisitBookingConfigRow = {
  branch_id: string;
  branch_name: string;
  working_dows: number[];
  opening_time: string | null;
  closing_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  slot_length_minutes: number;
  slot_buffer_minutes: number;
  default_slot_capacity: number;
  booking_window_days: number;
};

export type VisitBlockedDateRow = {
  id: string;
  branch_id: string | null;
  blocked_date: string;
  reason: string | null;
};

function mapBookingConfig(raw: Record<string, unknown>): VisitBookingConfigRow {
  const dows = Array.isArray(raw.working_dows) ? raw.working_dows : [];
  return {
    branch_id: String(raw.id),
    branch_name: String(raw.name ?? ""),
    working_dows: dows.map((d) => Number(d)).filter((d) => Number.isInteger(d)),
    opening_time: raw.opening_time != null ? String(raw.opening_time) : null,
    closing_time: raw.closing_time != null ? String(raw.closing_time) : null,
    lunch_start: raw.lunch_start != null ? String(raw.lunch_start) : null,
    lunch_end: raw.lunch_end != null ? String(raw.lunch_end) : null,
    slot_length_minutes: Number(raw.slot_length_minutes ?? 30),
    slot_buffer_minutes: Number(raw.slot_buffer_minutes ?? 0),
    default_slot_capacity: Number(raw.default_slot_capacity ?? 1),
    booking_window_days: Number(raw.booking_window_days ?? 14),
  };
}

export async function fetchVisitBookingConfigs(): Promise<{
  rows: VisitBookingConfigRow[];
  error?: string;
}> {
  await requireVisitsView();
  const listed = await listDocs(COLLECTIONS.visitBranches);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["sort_order", "asc"]]).map(mapBookingConfig),
  };
}

export async function saveVisitBookingConfig(input: {
  branch_id: string;
  working_dows: number[];
  opening_time: string;
  closing_time: string;
  lunch_start: string | null;
  lunch_end: string | null;
  slot_length_minutes: number;
  slot_buffer_minutes: number;
  default_slot_capacity: number;
  booking_window_days: number;
}): Promise<{ ok: boolean; error?: string; addedSlots?: number }> {
  await requireVisitsManageCatalog();

  if (input.closing_time <= input.opening_time) return { ok: false, error: "invalid_hours" };
  if (input.lunch_start && input.lunch_end && input.lunch_end <= input.lunch_start) {
    return { ok: false, error: "invalid_lunch_break" };
  }
  if (
    lunchBreakOutsideHours(
      input.opening_time,
      input.closing_time,
      input.lunch_start,
      input.lunch_end,
    )
  ) {
    return { ok: false, error: "lunch_outside_hours" };
  }
  if (input.slot_length_minutes <= 0) return { ok: false, error: "invalid_slot_length" };
  if (input.default_slot_capacity <= 0) return { ok: false, error: "invalid_capacity" };
  if (input.booking_window_days <= 0) return { ok: false, error: "invalid_booking_window" };

  const error = await patchDoc(COLLECTIONS.visitBranches, input.branch_id, {
    working_dows: [...new Set(input.working_dows)].sort((a, b) => a - b),
    opening_time: input.opening_time,
    closing_time: input.closing_time,
    lunch_start: input.lunch_start,
    lunch_end: input.lunch_end,
    slot_length_minutes: input.slot_length_minutes,
    slot_buffer_minutes: input.slot_buffer_minutes,
    default_slot_capacity: input.default_slot_capacity,
    booking_window_days: input.booking_window_days,
    updated_at: new Date(),
  });
  if (error) return { ok: false, error };

  // The weekday toggles are the branch's opening days, so they have to become
  // real slots or the setting is decorative. Add-only and idempotent; a failure
  // here must not lose the settings that were just saved, so it reports rather
  // than rolls back.
  const { data: syncData, error: syncError } = await callAdminFunction(
    "admin_sync_branch_slots_to_working_days",
    { p_branch_id: input.branch_id },
  );
  if (syncError) return { ok: true, addedSlots: 0, error: "slot_sync_failed" };

  const payload = (syncData ?? {}) as Record<string, unknown>;
  return { ok: true, addedSlots: Number(payload.added ?? 0) };
}

export async function fetchVisitBlockedDates(): Promise<{
  rows: VisitBlockedDateRow[];
  error?: string;
}> {
  await requireVisitsView();
  const listed = await listDocs(COLLECTIONS.visitBlockedDates);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["blocked_date", "asc"]]).map(
      (row): VisitBlockedDateRow => ({
        id: row.id,
        branch_id: textOrNull(row.branch_id),
        blocked_date: text(row.blocked_date),
        reason: textOrNull(row.reason),
      }),
    ),
  };
}

export async function addVisitBlockedDate(input: {
  branch_id: string | null;
  blocked_date: string;
  reason?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireVisitsManageCatalog();
  if (!input.blocked_date) return { ok: false, error: "date_required" };

  const inserted = await insertDoc(COLLECTIONS.visitBlockedDates, {
    branch_id: input.branch_id,
    blocked_date: input.blocked_date,
    reason: input.reason?.trim() || null,
    created_by: session.id,
    created_at: new Date(),
  });
  if (inserted.error) return { ok: false, error: inserted.error };
  return { ok: true };
}

export async function removeVisitBlockedDate(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  const error = await deleteDoc(COLLECTIONS.visitBlockedDates, id);
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function fetchVisitSlots(): Promise<{
  rows: VisitSlotRow[];
  error?: string;
}> {
  await requireVisitsView();
  const listed = await listDocs(COLLECTIONS.visitSlots);
  if (listed.error) return { rows: [], error: listed.error };
  const slots = sortRows(listed.rows, [
    ["department_key", "asc"],
    ["day_of_week", "asc"],
    ["slot_date", "asc"],
    ["start_time", "asc"],
  ]);
  const deptKeys = new Set(slots.map((slot) => text(slot.department_key)).filter((key) => key.length > 0));
  const departments = await listDocs(COLLECTIONS.visitDepartments);
  const branches = await docsByIds(
    COLLECTIONS.visitBranches,
    slots.map((slot) => text(slot.branch_id)),
  );
  const deptMap = new Map(
    departments.rows
      .filter((row) => deptKeys.has(text(row.key)))
      .map((row) => [text(row.key), text(row.label_en)]),
  );
  const branchMap = new Map(branches.map((row) => [row.id, text(row.name)]));

  const rows: VisitSlotRow[] = slots.map((slot) => {
    const branchId = textOrNull(slot.branch_id);
    const departmentKey = text(slot.department_key);
    return {
      id: slot.id,
      branch_id: branchId,
      branch_name: branchId ? (branchMap.get(branchId) ?? null) : null,
      department_key: departmentKey,
      department_label: deptMap.get(departmentKey) ?? departmentKey,
      slot_date: textOrNull(slot.slot_date),
      day_of_week: slot.day_of_week == null ? null : Number(slot.day_of_week),
      start_time: text(slot.start_time),
      end_time: text(slot.end_time),
      capacity: Number(slot.capacity ?? 0),
      is_active: slot.is_active === true,
    };
  });

  return { rows };
}

