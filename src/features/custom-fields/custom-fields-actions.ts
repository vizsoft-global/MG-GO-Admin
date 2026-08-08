"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  DRIVER_ENTITY_TYPE,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type CustomFieldOption,
  type CustomFieldValue,
} from "@/lib/custom-fields/types";
import {
  isCustomFieldType,
  normalizeFieldKey,
  parseOptions,
  validateDefinitionInput,
} from "@/lib/custom-fields/validate";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

function mapRow(row: {
  id: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: string;
  required: boolean;
  letters_only?: boolean | null;
  options: Json;
  default_value: Json;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}): CustomFieldDefinition | null {
  if (!isCustomFieldType(row.field_type)) return null;
  let defaultValue: CustomFieldValue = null;
  if (
    row.default_value === null ||
    typeof row.default_value === "string" ||
    typeof row.default_value === "number" ||
    typeof row.default_value === "boolean"
  ) {
    defaultValue = row.default_value;
  } else if (
    Array.isArray(row.default_value) &&
    row.default_value.every((item) => typeof item === "string")
  ) {
    defaultValue = row.default_value as string[];
  }
  return {
    id: row.id,
    entity_type: row.entity_type,
    key: row.key,
    label: row.label,
    field_type: row.field_type,
    required: row.required,
    letters_only: row.field_type === "text" && Boolean(row.letters_only),
    options: parseOptions(row.options),
    default_value: defaultValue,
    sort_order: row.sort_order,
    is_active: row.is_active,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function requireDriversManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

export async function listCustomFieldDefinitions(
  entityType: string = DRIVER_ENTITY_TYPE,
  opts?: { includeInactive?: boolean },
): Promise<CustomFieldDefinition[]> {
  const session = await requireDriversView();
  if (!session) return [];

  const supabase = await createClient();
  let query = supabase
    .from("custom_field_definitions")
    .select("*")
    .eq("entity_type", entityType)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapRow).filter((d): d is CustomFieldDefinition => d != null);
}

export async function upsertCustomFieldDefinition(
  input: CustomFieldDefinitionInput,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  const session = await requireDriversManage();
  if (!session) return { error: "not_authorized" };

  const entityType = (input.entity_type || DRIVER_ENTITY_TYPE).trim();
  if (entityType !== DRIVER_ENTITY_TYPE) return { error: "invalid_entity" };

  const key = normalizeFieldKey(input.key);
  if (!key) return { error: "invalid_key" };

  const defError = validateDefinitionInput({ ...input, key, entity_type: entityType });
  if (defError) return { error: "invalid_definition" };

  const options: CustomFieldOption[] =
    input.field_type === "select" ? parseOptions(input.options) : [];
  const lettersOnly =
    input.field_type === "text" ? Boolean(input.letters_only) : false;
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (input.id) {
    const { data, error } = await supabase
      .from("custom_field_definitions")
      .update({
        label: input.label.trim(),
        field_type: input.field_type,
        required: Boolean(input.required),
        letters_only: lettersOnly,
        options: options as unknown as Json,
        default_value: (input.default_value ?? null) as Json,
        sort_order: input.sort_order ?? 0,
        is_active: input.is_active ?? true,
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("entity_type", entityType)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "save_failed" };
    void logAdminMutation({
      action: "update",
      entityType: "custom_field_definition",
      entityId: data.id,
      routeName: "upsertCustomFieldDefinition",
      after: {
        key,
        label: input.label.trim(),
        field_type: input.field_type,
        letters_only: lettersOnly,
      },
    });
    return { success: true, id: data.id };
  }

  const { count } = await supabase
    .from("custom_field_definitions")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", entityType)
    .is("archived_at", null);

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      entity_type: entityType,
      key,
      label: input.label.trim(),
      field_type: input.field_type,
      required: Boolean(input.required),
      letters_only: lettersOnly,
      options: options as unknown as Json,
      default_value: (input.default_value ?? null) as Json,
      sort_order: input.sort_order ?? count ?? 0,
      is_active: input.is_active ?? true,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { error: "key_exists" };
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "create",
    entityType: "custom_field_definition",
    entityId: data.id,
    routeName: "upsertCustomFieldDefinition",
    after: { key, label: input.label.trim(), field_type: input.field_type },
  });
  return { success: true, id: data.id };
}

export async function setCustomFieldActive(
  id: string,
  active: boolean,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireDriversManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("entity_type", DRIVER_ENTITY_TYPE);

  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "update",
    entityType: "custom_field_definition",
    entityId: id,
    routeName: "setCustomFieldActive",
    after: { is_active: active },
  });
  return { success: true };
}

export async function archiveCustomFieldDefinition(
  id: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireDriversManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_definitions")
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("entity_type", DRIVER_ENTITY_TYPE);

  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "delete",
    entityType: "custom_field_definition",
    entityId: id,
    routeName: "archiveCustomFieldDefinition",
  });
  return { success: true };
}

export async function reorderCustomFieldDefinitions(
  ids: string[],
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireDriversManage();
  if (!session) return { error: "not_authorized" };
  if (ids.length === 0) return { success: true };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from("custom_field_definitions")
        .update({ sort_order: index, updated_at: now })
        .eq("id", id)
        .eq("entity_type", DRIVER_ENTITY_TYPE),
    ),
  );
  if (results.some((r) => r.error)) return { error: "save_failed" };
  return { success: true };
}
