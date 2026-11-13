"use server";

import { staffClient } from "@/features/drivers/driver-uniqueness";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import {
  DRIVER_ENTITY_TYPE,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type CustomFieldOption,
  type CustomFieldValue,
  type CustomFieldValues,
} from "@/lib/custom-fields/types";
import { customFieldEntity, isCustomFieldEntity } from "@/lib/custom-fields/entities";
import {
  isCustomFieldType,
  normalizeFieldKey,
  parseOptions,
  validateDefinitionInput,
  validateCustomFieldValues,
} from "@/lib/custom-fields/validate";
import { staffDb } from "@/lib/firebase/staff-db";
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

/**
 * Definitions are **Super Admin only**.
 *
 * A definition adds a column to a table every staff member reads and a slicer
 * they all filter by, so it is shared configuration, not a personal view — 5.2
 * of the client review asks for exactly that split. A manager's own column
 * order and hidden columns still live in `admin_ui_preferences`, per user.
 */
async function requireDefinitionAdmin() {
  const session = await getSessionUser();
  if (!session || !session.isSuperAdmin) return null;
  return session;
}

/** Reading definitions follows the entity's own list permission. */
async function requireEntityView(entityType: string) {
  const entry = customFieldEntity(entityType);
  if (!entry) return null;
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, entry.viewPermission, session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

export async function listCustomFieldDefinitions(
  entityType: string = DRIVER_ENTITY_TYPE,
  opts?: { includeInactive?: boolean },
): Promise<CustomFieldDefinition[]> {
  if (!isCustomFieldEntity(entityType)) return [];
  const session = await requireEntityView(entityType);
  if (!session) return [];

  const db = await staffClient();
  let query = db
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
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const session = await requireDefinitionAdmin();
  if (!session) return { error: "not_authorized" };

  const entityType = (input.entity_type || DRIVER_ENTITY_TYPE).trim();
  if (!isCustomFieldEntity(entityType)) return { error: "invalid_entity" };

  const key = normalizeFieldKey(input.key);
  if (!key) return { error: "invalid_key" };

  const defError = validateDefinitionInput({ ...input, key, entity_type: entityType });
  if (defError) return { error: "invalid_definition" };

  // Checkbox with options = multi-select; empty options keeps legacy boolean.
  const options: CustomFieldOption[] =
    input.field_type === "select" || input.field_type === "checkbox"
      ? parseOptions(input.options)
      : [];
  const lettersOnly =
    input.field_type === "text" ? Boolean(input.letters_only) : false;
  const db = await staffClient();
  const now = new Date().toISOString();

  if (input.id) {
    const { data, error } = await db
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

  const { count } = await db
    .from("custom_field_definitions")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", entityType)
    .is("archived_at", null);

  const { data, error } = await db
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
  entityType: string = DRIVER_ENTITY_TYPE,
): Promise<{ success?: boolean; error?: string }> {
  if (!isCustomFieldEntity(entityType)) return { error: "invalid_entity" };
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const session = await requireDefinitionAdmin();
  if (!session) return { error: "not_authorized" };

  const db = await staffClient();
  const { error } = await db
    .from("custom_field_definitions")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("entity_type", entityType);

  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "update",
    entityType: "custom_field_definition",
    entityId: id,
    routeName: "setCustomFieldActive",
    after: { is_active: active, entity_type: entityType },
  });
  return { success: true };
}

export async function archiveCustomFieldDefinition(
  id: string,
  entityType: string = DRIVER_ENTITY_TYPE,
): Promise<{ success?: boolean; error?: string }> {
  if (!isCustomFieldEntity(entityType)) return { error: "invalid_entity" };
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const session = await requireDefinitionAdmin();
  if (!session) return { error: "not_authorized" };

  const db = await staffClient();
  const { error } = await db
    .from("custom_field_definitions")
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("entity_type", entityType);

  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "delete",
    entityType: "custom_field_definition",
    entityId: id,
    routeName: "archiveCustomFieldDefinition",
    after: { entity_type: entityType },
  });
  return { success: true };
}

export async function reorderCustomFieldDefinitions(
  ids: string[],
  entityType: string = DRIVER_ENTITY_TYPE,
): Promise<{ success?: boolean; error?: string }> {
  if (!isCustomFieldEntity(entityType)) return { error: "invalid_entity" };
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const session = await requireDefinitionAdmin();
  if (!session) return { error: "not_authorized" };
  if (ids.length === 0) return { success: true };

  const db = await staffClient();
  const now = new Date().toISOString();
  const results = await Promise.all(
    ids.map((id, index) =>
      db
        .from("custom_field_definitions")
        .update({ sort_order: index, updated_at: now })
        .eq("id", id)
        .eq("entity_type", entityType),
    ),
  );
  if (results.some((r) => r.error)) return { error: "save_failed" };
  return { success: true };
}

/**
 * Write a record's custom values onto its own document.
 *
 * Deliberately one small action rather than a change to each entity's save path:
 * the page saves its own fields, then hands the `cf:` values here. Validation
 * runs against the live definitions, so a value for an archived field is carried
 * through rather than refused (an operator cannot correct what the form no longer
 * renders — see `allowLegacyKeys`).
 */
export async function saveEntityCustomFields(
  entityType: string,
  entityId: string,
  values: CustomFieldValues,
): Promise<{ success?: boolean; error?: string }> {
  const entry = customFieldEntity(entityType);
  if (!entry) return { error: "invalid_entity" };
  if (!entityId) return { error: "invalid_entity" };

  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };

  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, entry.managePermission, session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }

  const defs = await listCustomFieldDefinitions(entityType, { includeInactive: true });
  const { values: clean, errors } = validateCustomFieldValues(defs, values, {
    allowLegacyKeys: true,
  });
  if (errors.length > 0) {
    return { error: errors[0]?.code === "required" ? "required" : "invalid_definition" };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed" };
  try {
    await db
      .collection(entry.collection)
      .doc(entityId)
      .set({ custom_fields: clean, updated_at: new Date() }, { merge: true });
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: `${entityType}_custom_fields`,
    entityId,
    routeName: "saveEntityCustomFields",
    after: { keys: Object.keys(clean) },
  });
  return { success: true };
}

export async function listAdminRoleOptions(): Promise<Array<{ id: string; name: string; slug: string }>> {  const session = await getSessionUser();
  if (!session) return [];
  const db = await staffClient();
  const { data, error } = await db.from("admin_roles").select("id, name, slug").order("name");
  if (error || !data) return [];
  return data as Array<{ id: string; name: string; slug: string }>;
}
