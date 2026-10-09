"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  REQUEST_FIELD_KINDS,
  REQUEST_FIELD_OPTION_SOURCES,
  REQUEST_FIELD_TARGETS,
  REQUEST_TERMINAL_STATUSES,
  type RequestFieldDefinitionRow,
  type RequestFieldKind,
  type RequestFieldOptionSource,
  type RequestFieldTarget,
  type RequestTerminalStatus,
  type RequestTypeDefinitionRow,
  type RequestTypeInput,
} from "./settings-types";

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
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function countDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ count: number; error: string | null }> {
  const db = await openDb();
  if (!db) return { count: 0, error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.count().get();
    return { count: snap.data().count, error: null };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function findTypeDef(key: string): Promise<{ row: DocRow | null; error: string | null }> {
  const db = await openDb();
  if (!db) return { row: null, error: "not_configured" };
  try {
    const direct = await db.collection(COLLECTIONS.requestTypeDefinitions).doc(key).get();
    if (direct.exists) return { row: docRow(direct.id, direct.data()), error: null };
    const listed = await queryDocs(COLLECTIONS.requestTypeDefinitions, [["key", key]]);
    if (listed.error) return { row: null, error: listed.error };
    return { row: listed.rows[0] ?? null, error: null };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function removeWhere(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ error: string | null }> {
  const found = await queryDocs(name, filters);
  if (found.error) return { error: found.error };
  const db = await openDb();
  if (!db) return { error: "not_configured" };
  try {
    const writer = db.bulkWriter();
    for (const row of found.rows) writer.delete(db.collection(name).doc(row.id));
    await writer.close();
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write_failed" };
  }
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

async function requireRequestsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter((o) => o.length > 0);
}

function coerceRow(row: Record<string, unknown>): RequestFieldDefinitionRow {
  return {
    id: row.id as string,
    field_key: String(row.field_key ?? ""),
    label_en: String(row.label_en ?? ""),
    label_ar: (row.label_ar as string | null) ?? null,
    kind: row.kind as RequestFieldKind,
    target: row.target as RequestFieldTarget,
    is_required: Boolean(row.is_required),
    is_server_required: Boolean(row.is_server_required),
    sort_order: Number(row.sort_order ?? 0),
    options_source: (row.options_source as RequestFieldOptionSource | null) ?? null,
    options: normalizeOptions(row.options),
    help_en: (row.help_en as string | null) ?? null,
  };
}

/**
 * Types plus the three counts the list needs. `request_count` is what makes a type
 * undeletable — the FK on `requests.request_type` blocks the delete anyway, but the
 * UI should say so before the user tries.
 */
export async function fetchRequestTypeDefinitions(): Promise<{
  rows: RequestTypeDefinitionRow[];
  error?: string;
}> {
  await requireRequestsManage();

  const [defs, fields, steps, requests] = await Promise.all([
    listDocs(COLLECTIONS.requestTypeDefinitions),
    listDocs(COLLECTIONS.requestFieldDefinitions),
    listDocs(COLLECTIONS.requestApprovalStepTemplates),
    listDocs(COLLECTIONS.requests),
  ]);

  if (defs.error) return { rows: [], error: defs.error };

  const count = (rows: DocRow[], key: string) => {
    const map: Record<string, number> = {};
    for (const row of rows) {
      const k = String(row[key] ?? "");
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  };

  const fieldCounts = count(fields.rows, "type_key");
  const stepCounts = count(steps.rows, "request_type");
  const requestCounts = count(requests.rows, "request_type");

  await logAdminRead("requests", "requests.settings.types.list");

  return {
    rows: sortRows(defs.rows, [["sort_order", "asc"]]).map((row) => {
      const key = String(row.key ?? row.id);
      return {
        key,
        label_en: String(row.label_en ?? ""),
        label_ar: (row.label_ar as string | null) ?? null,
        icon_key: (row.icon_key as string | null) ?? null,
        is_system: Boolean(row.is_system),
        is_active: Boolean(row.is_active),
        sort_order: Number(row.sort_order ?? 0),
        screenshot_restricted: Boolean(row.screenshot_restricted),
        terminal_status_on_approve: (row.terminal_status_on_approve ??
          "approved") as RequestTerminalStatus,
        requires_driver_ack_on_approve: Boolean(row.requires_driver_ack_on_approve),
        date_range_required: Boolean(row.date_range_required),
        min_attachments: Number(row.min_attachments ?? 0),
        attachments_error_code: (row.attachments_error_code as string | null) ?? null,
        field_count: fieldCounts[key] ?? 0,
        step_count: stepCounts[key] ?? 0,
        request_count: requestCounts[key] ?? 0,
      };
    }),
  };
}

export async function fetchRequestFieldDefinitions(typeKey: string): Promise<{
  rows: RequestFieldDefinitionRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await queryDocs(COLLECTIONS.requestFieldDefinitions, [["type_key", typeKey]]);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["sort_order", "asc"]]).map(coerceRow),
  };
}

function validateType(input: RequestTypeInput): string | null {
  if (!KEY_PATTERN.test(input.key)) return "invalid_key";
  if (!input.label_en.trim()) return "label_required";
  if (!REQUEST_TERMINAL_STATUSES.includes(input.terminal_status_on_approve)) {
    return "invalid_terminal_status";
  }
  if (!Number.isInteger(input.min_attachments) || input.min_attachments < 0) {
    return "invalid_min_attachments";
  }
  return null;
}

export async function createRequestType(
  input: RequestTypeInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const invalid = validateType(input);
  if (invalid) return { ok: false, error: invalid };

  const existing = await findTypeDef(input.key);
  if (existing.error) return { ok: false, error: existing.error };
  if (existing.row) return { ok: false, error: "key_exists" };

  const db = await openDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    await db.collection(COLLECTIONS.requestTypeDefinitions).doc(input.key).set({
      id: input.key,
      key: input.key,
      label_en: input.label_en.trim(),
      label_ar: input.label_ar?.trim() || null,
      icon_key: input.icon_key?.trim() || null,
      is_active: input.is_active,
      sort_order: input.sort_order,
      screenshot_restricted: input.screenshot_restricted,
      terminal_status_on_approve: input.terminal_status_on_approve,
      requires_driver_ack_on_approve: input.requires_driver_ack_on_approve,
      date_range_required: input.date_range_required,
      min_attachments: input.min_attachments,
      is_system: false,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write_failed" };
  }

  await logAdminMutation({
    action: "create",
    entityType: "request_type_definitions",
    entityId: input.key,
    routeName: "requests.settings.types.create",
    context: { label: input.label_en },
  });
  return { ok: true };
}

export async function updateRequestType(
  key: string,
  patch: Partial<Omit<RequestTypeInput, "key">>,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  if (patch.label_en !== undefined && !patch.label_en.trim()) {
    return { ok: false, error: "label_required" };
  }
  if (
    patch.terminal_status_on_approve !== undefined &&
    !REQUEST_TERMINAL_STATUSES.includes(patch.terminal_status_on_approve)
  ) {
    return { ok: false, error: "invalid_terminal_status" };
  }

  const existing = await findTypeDef(key);
  if (existing.error) return { ok: false, error: existing.error };
  if (!existing.row) return { ok: true };

  const db = await openDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    await db.collection(COLLECTIONS.requestTypeDefinitions).doc(existing.row.id).set(
      { ...patch, updated_at: new Date() },
      { merge: true },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write_failed" };
  }

  await logAdminMutation({
    action: "update",
    entityType: "request_type_definitions",
    entityId: key,
    routeName: "requests.settings.types.update",
    context: patch,
  });
  return { ok: true };
}

export async function deleteRequestType(
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();

  const existing = await findTypeDef(key);
  if (existing.error) return { ok: false, error: existing.error };
  if (existing.row?.is_system === true) return { ok: false, error: "system_type_undeletable" };

  const used = await countDocs(COLLECTIONS.requests, [["request_type", key]]);
  if (used.error) return { ok: false, error: used.error };
  if (used.count > 0) return { ok: false, error: "type_in_use" };

  if (!existing.row) return { ok: true };
  const db = await openDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    await db.collection(COLLECTIONS.requestTypeDefinitions).doc(existing.row.id).delete();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write_failed" };
  }

  await logAdminMutation({
    action: "delete",
    entityType: "request_type_definitions",
    entityId: key,
    routeName: "requests.settings.types.delete",
  });
  return { ok: true };
}

/**
 * Replaces the whole field set for a type. Delete-then-insert rather than a diff:
 * the rows carry no history worth preserving, and a diff would need a stable id the
 * builder does not have for newly added rows.
 */
export async function saveRequestFieldDefinitions(
  typeKey: string,
  fields: RequestFieldDefinitionRow[],
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();

  const seen = new Set<string>();
  for (const field of fields) {
    if (!KEY_PATTERN.test(field.field_key)) return { ok: false, error: "invalid_field_key" };
    if (seen.has(field.field_key)) return { ok: false, error: "duplicate_field_key" };
    seen.add(field.field_key);
    if (!field.label_en.trim()) return { ok: false, error: "label_required" };
    if (!REQUEST_FIELD_KINDS.includes(field.kind)) return { ok: false, error: "invalid_kind" };
    if (!REQUEST_FIELD_TARGETS.includes(field.target)) {
      return { ok: false, error: "invalid_target" };
    }
    if (
      field.options_source !== null &&
      !REQUEST_FIELD_OPTION_SOURCES.includes(field.options_source)
    ) {
      return { ok: false, error: "invalid_options_source" };
    }
    if (
      (field.kind === "select" || field.kind === "multiselect") &&
      field.options_source === "static" &&
      normalizeOptions(field.options).length === 0
    ) {
      return { ok: false, error: "options_required" };
    }
  }

  const typeDef = await findTypeDef(typeKey);
  if (typeDef.error) return { ok: false, error: typeDef.error };
  if (typeDef.row?.is_system === true) return { ok: false, error: "system_type_fields_locked" };

  const removed = await removeWhere(COLLECTIONS.requestFieldDefinitions, [["type_key", typeKey]]);
  if (removed.error) return { ok: false, error: removed.error };

  if (fields.length > 0) {
    const db = await openDb();
    if (!db) return { ok: false, error: "not_configured" };
    try {
      const writer = db.bulkWriter();
      fields.forEach((field, index) => {
        const id = crypto.randomUUID();
        writer.set(db.collection(COLLECTIONS.requestFieldDefinitions).doc(id), {
          id,
          type_key: typeKey,
          field_key: field.field_key,
          label_en: field.label_en.trim(),
          label_ar: field.label_ar?.trim() || null,
          kind: field.kind,
          target: field.target,
          is_required: field.is_required,
          is_server_required: field.is_required && field.is_server_required,
          sort_order: index + 1,
          options_source: field.options_source,
          options: normalizeOptions(field.options),
          help_en: field.help_en?.trim() || null,
        });
      });
      await writer.close();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "write_failed" };
    }
  }

  await logAdminMutation({
    action: "update",
    entityType: "request_field_definitions",
    entityId: typeKey,
    routeName: "requests.settings.types.fields.save",
    context: { fieldCount: fields.length },
  });
  return { ok: true };
}
