"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  WRONG_ACTION_SEVERITIES,
  WRONG_ACTION_TYPES,
  type WrongActionRow,
  type WrongActionSeverity,
  type WrongActionType,
} from "./types";

export type WrongActionDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
  zone_name: string | null;
};

async function requireWrongActions(permission: "wrong_actions.view" | "wrong_actions.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type DriverJoin = {
  id: string;
  driver_code: string | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  zones: { name: string | null } | { name: string | null }[] | null;
};

const SELECT_COLUMNS =
  "id, driver_id, action_type, severity, details, occurred_at, source, created_at, created_by, drivers!inner(id, driver_code, profiles(full_name), zones(name))";

function mapRow(
  row: Record<string, unknown>,
  authorNames: Map<string, string>,
): WrongActionRow {
  const driver = firstOf(row.drivers as DriverJoin | DriverJoin[] | null);
  const profile = firstOf(driver?.profiles ?? null);
  const zone = firstOf(driver?.zones ?? null);
  const createdBy = (row.created_by as string | null) ?? null;
  return {
    id: row.id as string,
    driver_id: row.driver_id as string,
    action_type: row.action_type as WrongActionType,
    severity: row.severity as WrongActionSeverity,
    details: (row.details as string | null) ?? null,
    occurred_at: row.occurred_at as string,
    source: row.source as WrongActionRow["source"],
    created_at: row.created_at as string,
    created_by: createdBy,
    driver_name: profile?.full_name ?? null,
    driver_code: driver?.driver_code ?? null,
    driver_zone_name: zone?.name ?? null,
    created_by_name: createdBy ? (authorNames.get(createdBy) ?? null) : null,
  };
}

async function resolveAuthorNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: Array<{ created_by?: string | null }>,
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  );
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  return new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null }>)
      .filter((row) => row.full_name)
      .map((row) => [row.id, row.full_name as string]),
  );
}

export async function listWrongActions(): Promise<WrongActionRow[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wrong_actions")
    .select(SELECT_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const authorNames = await resolveAuthorNames(
    supabase,
    rows as Array<{ created_by?: string | null }>,
  );

  void logAdminRead("wrong_actions", "/wrong-actions");

  return rows.map((row) => mapRow(row, authorNames));
}

export async function listWrongActionsForDriver(driverId: string): Promise<WrongActionRow[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);
  if (!driverId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wrong_actions")
    .select(SELECT_COLUMNS)
    .eq("driver_id", driverId)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const authorNames = await resolveAuthorNames(
    supabase,
    rows as Array<{ created_by?: string | null }>,
  );
  return rows.map((row) => mapRow(row, authorNames));
}

export async function getWrongAction(id: string): Promise<WrongActionRow | null> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wrong_actions")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const authorNames = await resolveAuthorNames(supabase, [
    row as { created_by?: string | null },
  ]);
  return mapRow(row, authorNames);
}

export async function listWrongActionDriverOptions(): Promise<WrongActionDriverOption[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles(full_name), zones(name)")
    .is("archived_at", null)
    .order("driver_code");
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{
    id: string;
    driver_code: string | null;
    employee_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    zones: { name: string | null } | { name: string | null }[] | null;
  }>).map((row) => ({
    id: row.id,
    full_name: firstOf(row.profiles)?.full_name ?? row.driver_code ?? "—",
    driver_code: row.driver_code ?? "",
    employee_id: row.employee_id ?? null,
    zone_name: firstOf(row.zones)?.name ?? null,
  }));
}

function parseIncident(formData: FormData) {
  const driverId = String(formData.get("driverId") ?? "").trim();
  const actionType = String(formData.get("actionType") ?? "").trim();
  const severity = String(formData.get("severity") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();

  if (!driverId || !occurredAt) return { error: "missing_fields" as const };
  if (!(WRONG_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return { error: "invalid_type" as const };
  }
  if (!(WRONG_ACTION_SEVERITIES as readonly string[]).includes(severity)) {
    return { error: "invalid_severity" as const };
  }

  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) return { error: "invalid_date" as const };
  // An incident is a record of something that happened. A future date would
  // score a day that has not been worked yet, and the rollup would move it
  // again when that day arrives.
  if (occurred.getTime() > Date.now()) return { error: "future_date" as const };

  return {
    driver_id: driverId,
    action_type: actionType as WrongActionType,
    severity: severity as WrongActionSeverity,
    details: details || null,
    occurred_at: occurred.toISOString(),
  };
}

export async function saveWrongAction(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireWrongActions("wrong_actions.manage");
  if ("error" in auth) return auth;

  const parsed = parseIncident(formData);
  if ("error" in parsed) return parsed;

  const payload = {
    driver_id: parsed.driver_id,
    action_type: parsed.action_type,
    severity: parsed.severity,
    details: parsed.details,
    occurred_at: parsed.occurred_at,
  };

  const id = String(formData.get("id") ?? "").trim();
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("wrong_actions")
      .select("driver_id, action_type, severity, details, occurred_at")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase
      .from("wrong_actions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };

    void logAdminMutation({
      action: "update",
      entityType: "wrong_action",
      entityId: id,
      routeName: "/wrong-actions",
      before: before ?? undefined,
      after: payload,
    });
    return { id };
  }

  // `source` stays 'admin' and is never taken from the form: it distinguishes a
  // human filing from a rule raising, and a form field would let one claim to
  // be the other.
  const { data, error } = await supabase
    .from("wrong_actions")
    .insert({ ...payload, source: "admin", created_by: auth.session.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  void logAdminMutation({
    action: "create",
    entityType: "wrong_action",
    entityId: data.id,
    routeName: "/wrong-actions",
    after: { ...payload, source: "admin" },
  });
  return { id: data.id };
}

export async function deleteWrongAction(id: string): Promise<{ error?: string }> {
  const auth = await requireWrongActions("wrong_actions.manage");
  if ("error" in auth) return auth;
  if (!id) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("wrong_actions")
    .select("driver_id, action_type, severity, details, occurred_at, source")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("wrong_actions").delete().eq("id", id);
  if (error) return { error: error.message };

  void logAdminMutation({
    action: "delete",
    entityType: "wrong_action",
    entityId: id,
    routeName: "/wrong-actions",
    before: before ?? undefined,
  });
  return {};
}
