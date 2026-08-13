"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
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
  const supabase = await createClient();

  const [defs, fields, steps, requests] = await Promise.all([
    (supabase as any).from("request_type_definitions").select("*").order("sort_order"),
    (supabase as any).from("request_field_definitions").select("type_key"),
    supabase.from("request_approval_step_templates").select("request_type"),
    supabase.from("requests").select("request_type"),
  ]);

  if (defs.error) return { rows: [], error: defs.error.message };

  const count = (rows: unknown, key: string) => {
    const map: Record<string, number> = {};
    for (const row of (rows as Record<string, unknown>[] | null) ?? []) {
      const k = String(row[key] ?? "");
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  };

  const fieldCounts = count(fields.data, "type_key");
  const stepCounts = count(steps.data, "request_type");
  const requestCounts = count(requests.data, "request_type");

  await logAdminRead("requests", "requests.settings.types.list");

  return {
    rows: ((defs.data as Record<string, unknown>[] | null) ?? []).map((row) => {
      const key = String(row.key ?? "");
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
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("request_field_definitions")
    .select(
      "id, field_key, label_en, label_ar, kind, target, is_required, is_server_required, sort_order, options_source, options, help_en",
    )
    .eq("type_key", typeKey)
    .order("sort_order");

  if (error) return { rows: [], error: error.message };
  return { rows: ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow) };
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

  const supabase = await createClient();
  const { error } = await (supabase as any).from("request_type_definitions").insert({
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
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "key_exists" : error.message,
    };
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

  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("request_type_definitions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) return { ok: false, error: error.message };

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
  const supabase = await createClient();

  // The FK from `requests` would reject this anyway, but a Postgres FK message is
  // not something to put in front of an operator.
  const { count } = await supabase
    .from("requests")
    .select("id", { count: "exact", head: true })
    .eq("request_type", key);
  if ((count ?? 0) > 0) return { ok: false, error: "type_in_use" };

  const { error } = await (supabase as any)
    .from("request_type_definitions")
    .delete()
    .eq("key", key);

  if (error) {
    return {
      ok: false,
      error: error.message.includes("system_type_undeletable")
        ? "system_type_undeletable"
        : error.message,
    };
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
    // A choice field with nothing to choose from renders as a dead control.
    if (
      (field.kind === "select" || field.kind === "multiselect") &&
      field.options_source === "static" &&
      normalizeOptions(field.options).length === 0
    ) {
      return { ok: false, error: "options_required" };
    }
  }

  const supabase = await createClient();

  const { error: deleteError } = await (supabase as any)
    .from("request_field_definitions")
    .delete()
    .eq("type_key", typeKey);
  if (deleteError) {
    return {
      ok: false,
      error: deleteError.message.includes("system_type_fields_locked")
        ? "system_type_fields_locked"
        : deleteError.message,
    };
  }

  if (fields.length > 0) {
    const { error } = await (supabase as any).from("request_field_definitions").insert(
      fields.map((field, index) => ({
        type_key: typeKey,
        field_key: field.field_key,
        label_en: field.label_en.trim(),
        label_ar: field.label_ar?.trim() || null,
        kind: field.kind,
        target: field.target,
        is_required: field.is_required,
        // A server gate on a field the form does not mark required would reject
        // submissions the rider had no way to satisfy.
        is_server_required: field.is_required && field.is_server_required,
        sort_order: index + 1,
        options_source: field.options_source,
        options: normalizeOptions(field.options),
        help_en: field.help_en?.trim() || null,
      })),
    );
    if (error) return { ok: false, error: error.message };
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
