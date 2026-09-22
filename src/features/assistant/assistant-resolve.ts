import { searchActiveDrivers } from "@/features/drivers/search-active-drivers";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { requireAssistantModule } from "./assistant-gates";
import {
  ASSISTANT_CANDIDATE_CAP,
  ENTITY_MODULE_PERMISSION,
  FLEET_ENTITY_ID,
  type AssistantCandidate,
  type AssistantEntityType,
  type AssistantQueryKind,
  type AssistantResolveResult,
} from "./assistant-entity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyQueryKind(query: string): AssistantQueryKind {
  const raw = query.trim();
  if (!raw) return "name";
  if (UUID_RE.test(raw)) return "id";
  if (/^\d{4}-\d{2}$/.test(raw)) return "month";
  if (raw.includes("@")) return "email";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && /^[+()\s.\-0-9]+$/.test(raw)) return "phone";
  if (/^\d{4,8}$/.test(raw.replace(/\s+/g, ""))) return "code";
  if (/^[A-Z]{2,}-\d+/i.test(raw) || /^\d{3,}-\d+/.test(raw)) return "ref";
  return "name";
}

export function redactedQueryMeta(query: string): {
  query_kind: AssistantQueryKind;
  query_len: number;
} {
  return { query_kind: classifyQueryKind(query), query_len: query.trim().length };
}

function labelOf(code: string | null | undefined, name: string | null | undefined, fallback: string): string {
  const bits = [code, name].filter((part) => part && part !== "—");
  return bits.length > 0 ? bits.join(" · ") : fallback;
}

function candidate(id: string, label: string, key?: string): AssistantCandidate {
  return { id, label, key };
}

export function finalizeResolve(
  hits: AssistantCandidate[],
  entity_type: AssistantEntityType,
  query_kind: AssistantQueryKind,
): AssistantResolveResult {
  const unique = new Map<string, AssistantCandidate>();
  for (const hit of hits) {
    if (hit.id && !unique.has(hit.id)) unique.set(hit.id, hit);
  }
  const list = [...unique.values()];
  if (list.length === 0) return { status: "not_found", entity_type, query_kind };
  if (list.length === 1) {
    const match = list[0]!;
    return {
      status: "ok",
      entity_type,
      match,
      query_kind,
      focus: { entity_type, id: match.id, label: match.label },
    };
  }
  return {
    status: "ambiguous",
    entity_type,
    candidates: list.slice(0, ASSISTANT_CANDIDATE_CAP),
    query_kind,
  };
}

function profileName(profiles: unknown): string | undefined {
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  return (row as { full_name?: string } | null)?.full_name ?? undefined;
}

async function findDrivers(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  const kind = classifyQueryKind(raw);
  const hits: AssistantCandidate[] = [];

  if (kind === "id") {
    const { data } = await supabase
      .from("drivers")
      .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
      .eq("id", raw)
      .is("archived_at", null)
      .maybeSingle();
    if (data) {
      hits.push(
        candidate(
          data.id,
          labelOf(data.driver_code, profileName(data.profiles), data.id),
          data.driver_code,
        ),
      );
    }
    return hits;
  }

  if (kind === "phone") {
    const digits = raw.replace(/\D/g, "");
    const last8 = digits.slice(-8);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .or(`phone.eq.${raw},phone.eq.${digits},phone.like.%${last8}`)
      .limit(6);
    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length > 0) {
      const { data: drivers } = await supabase
        .from("drivers")
        .select("id, driver_code, profiles!drivers_id_fkey(full_name)")
        .in("id", ids)
        .is("archived_at", null)
        .limit(6);
      for (const row of drivers ?? []) {
        hits.push(candidate(row.id, labelOf(row.driver_code, profileName(row.profiles), row.id), row.driver_code));
      }
    }
    const { data: intakes } = await supabase
      .from("driver_intakes")
      .select("linked_profile_id, driver_code, full_name")
      .or(`phone.eq.${raw},phone.eq.${digits},phone.like.%${last8}`)
      .is("archived_at", null)
      .limit(6);
    for (const row of intakes ?? []) {
      if (!row.linked_profile_id) continue;
      if (hits.some((h) => h.id === row.linked_profile_id)) continue;
      hits.push(
        candidate(
          row.linked_profile_id,
          labelOf(row.driver_code, row.full_name, row.linked_profile_id),
          row.driver_code ?? undefined,
        ),
      );
    }
    return hits;
  }

  if (kind === "email") {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .ilike("email", raw)
      .limit(6);
    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length === 0) return [];
    const { data: drivers } = await supabase
      .from("drivers")
      .select("id, driver_code, profiles!drivers_id_fkey(full_name)")
      .in("id", ids)
      .is("archived_at", null)
      .limit(6);
    return (drivers ?? []).map((row) =>
      candidate(row.id, labelOf(row.driver_code, profileName(row.profiles), row.id), row.driver_code),
    );
  }

  if (kind === "code") {
    const digits = raw.replace(/\s+/g, "");
    const { data } = await supabase
      .from("drivers")
      .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
      .or(`driver_code.eq.${digits},employee_id.eq.${digits}`)
      .is("archived_at", null)
      .limit(6);
    return (data ?? []).map((row) =>
      candidate(row.id, labelOf(row.driver_code, profileName(row.profiles), row.id), row.driver_code),
    );
  }

  const searched = await searchActiveDrivers(supabase, raw, 6);
  return searched.map((row) => candidate(row.id, labelOf(row.driver_code, row.full_name, row.id), row.driver_code));
}

async function findNamed(
  table: "zones" | "partners" | "restaurants",
  query: string,
  extraExact?: { column: string; value: string }[],
): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from(table).select("id, name").eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, data.name ?? data.id)];
  }
  for (const extra of extraExact ?? []) {
    const { data } = await supabase
      .from(table)
      .select("id, name")
      .eq(extra.column, extra.value)
      .limit(6);
    if ((data ?? []).length > 0) {
      return (data ?? []).map((row) => candidate(row.id, row.name ?? row.id, extra.value));
    }
  }
  const exact = await supabase.from(table).select("id, name").ilike("name", raw).limit(6);
  if ((exact.data ?? []).length > 0) {
    return (exact.data ?? []).map((row) => candidate(row.id, row.name ?? row.id));
  }
  const fuzzy = await supabase.from(table).select("id, name").ilike("name", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, row.name ?? row.id));
}

async function findZones(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("zones").select("id, name, code").eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, labelOf(data.code, data.name, data.id), data.code)];
  }
  const byCode = await supabase.from("zones").select("id, name, code").eq("code", raw).limit(6);
  if ((byCode.data ?? []).length > 0) {
    return (byCode.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
  }
  const exact = await supabase.from("zones").select("id, name, code").ilike("name", raw).limit(6);
  if ((exact.data ?? []).length > 0) {
    return (exact.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
  }
  const fuzzy = await supabase.from("zones").select("id, name, code").ilike("name", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
}

async function findRestaurants(query: string): Promise<AssistantCandidate[]> {
  return findNamed("restaurants", query, [
    { column: "restaurant_code", value: query.trim() },
    { column: "external_merchant_id", value: query.trim() },
  ]);
}

async function findVehicles(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  const select = "id, bike_id, reg_number";
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("vehicles").select(select).eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, labelOf(data.bike_id, data.reg_number, data.id), data.bike_id)];
  }
  const byBike = await supabase.from("vehicles").select(select).eq("bike_id", raw).limit(6);
  if ((byBike.data ?? []).length > 0) {
    return (byBike.data ?? []).map((row) => candidate(row.id, labelOf(row.bike_id, row.reg_number, row.id), row.bike_id));
  }
  const byPlate = await supabase.from("vehicles").select(select).ilike("reg_number", raw).limit(6);
  if ((byPlate.data ?? []).length > 0) {
    return (byPlate.data ?? []).map((row) => candidate(row.id, labelOf(row.bike_id, row.reg_number, row.id), row.bike_id));
  }
  const fuzzy = await supabase.from("vehicles").select(select).ilike("reg_number", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, labelOf(row.bike_id, row.reg_number, row.id), row.bike_id));
}

async function findRequests(query: string, complaintOnly: boolean): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  let q = supabase.from("requests").select("id, request_code, request_type, status");
  if (complaintOnly) q = q.eq("request_type", "complaint");
  if (UUID_RE.test(raw)) {
    const { data } = await q.eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, labelOf(data.request_code, data.request_type, data.id), data.request_code)];
    return [];
  }
  const byCode = await q.eq("request_code", raw).limit(6);
  if ((byCode.data ?? []).length > 0) {
    return (byCode.data ?? []).map((row) =>
      candidate(row.id, labelOf(row.request_code, row.request_type, row.id), row.request_code),
    );
  }
  const fuzzy = await supabase
    .from("requests")
    .select("id, request_code, request_type")
    .ilike("request_code", `%${raw}%`)
    .limit(6);
  const rows = complaintOnly
    ? (fuzzy.data ?? []).filter((row) => row.request_type === "complaint")
    : (fuzzy.data ?? []);
  return rows.map((row) => candidate(row.id, labelOf(row.request_code, row.request_type, row.id), row.request_code));
}

async function findDeliveries(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  const select = "id, external_order_id, status";
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("deliveries").select(select).eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, labelOf(data.external_order_id, data.status, data.id), data.external_order_id ?? undefined)];
    return [];
  }
  const byOrder = await supabase.from("deliveries").select(select).eq("external_order_id", raw).limit(6);
  return (byOrder.data ?? []).map((row) =>
    candidate(row.id, labelOf(row.external_order_id, row.status, row.id), row.external_order_id ?? undefined),
  );
}

async function findGroups(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("driver_groups").select("id, name").eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, data.name ?? data.id)];
  }
  const exact = await supabase.from("driver_groups").select("id, name").ilike("name", raw).limit(6);
  if ((exact.data ?? []).length > 0) {
    return (exact.data ?? []).map((row) => candidate(row.id, row.name ?? row.id));
  }
  const fuzzy = await supabase.from("driver_groups").select("id, name").ilike("name", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, row.name ?? row.id));
}

async function findAssets(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("asset_catalog").select("id, name, code").eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, labelOf(data.code, data.name, data.id), data.code)];
  }
  const byCode = await supabase.from("asset_catalog").select("id, name, code").eq("code", raw).limit(6);
  if ((byCode.data ?? []).length > 0) {
    return (byCode.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
  }
  const exact = await supabase.from("asset_catalog").select("id, name, code").ilike("name", raw).limit(6);
  if ((exact.data ?? []).length > 0) {
    return (exact.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
  }
  const fuzzy = await supabase.from("asset_catalog").select("id, name, code").ilike("name", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, labelOf(row.code, row.name, row.id), row.code));
}

async function findNotifications(query: string): Promise<AssistantCandidate[]> {
  const supabase = await createClient();
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const { data } = await supabase.from("notification_campaigns").select("id, title").eq("id", raw).maybeSingle();
    if (data) return [candidate(data.id, data.title ?? data.id)];
  }
  const exact = await supabase.from("notification_campaigns").select("id, title").ilike("title", raw).limit(6);
  if ((exact.data ?? []).length > 0) {
    return (exact.data ?? []).map((row) => candidate(row.id, row.title ?? row.id));
  }
  const fuzzy = await supabase.from("notification_campaigns").select("id, title").ilike("title", `%${raw}%`).limit(6);
  return (fuzzy.data ?? []).map((row) => candidate(row.id, row.title ?? row.id));
}

async function hitsForType(type: AssistantEntityType, query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  switch (type) {
    case "driver":
      return findDrivers(raw);
    case "zone":
      return findZones(raw);
    case "restaurant":
      return findRestaurants(raw);
    case "partner":
      return findNamed("partners", raw);
    case "vehicle":
      return findVehicles(raw);
    case "request":
      return findRequests(raw, false);
    case "complaint":
      return findRequests(raw, true);
    case "delivery":
      return findDeliveries(raw);
    case "driver_group":
      return findGroups(raw);
    case "asset":
      return findAssets(raw);
    case "notification":
      return findNotifications(raw);
    case "fleet": {
      const q = raw.toLowerCase();
      if (!q || q === "fleet" || q === "الأسطول" || q === "اسطول") {
        return [candidate(FLEET_ENTITY_ID, "Fleet")];
      }
      const groups = await findGroups(raw);
      if (groups.length > 0) return groups;
      return findVehicles(raw);
    }
    case "attendance":
    case "payroll":
    case "performance": {
      if (/^\d{4}-\d{2}$/.test(raw)) return [candidate(raw, raw)];
      return findDrivers(raw);
    }
    default:
      return [];
  }
}

export async function resolveEntity(
  entityType: AssistantEntityType,
  query: string,
): Promise<AssistantResolveResult> {
  const raw = query.trim();
  const query_kind = classifyQueryKind(raw);
  if (!raw && entityType !== "fleet") {
    return { status: "not_found", entity_type: entityType, query_kind };
  }
  try {
    await requireAssistantModule(ENTITY_MODULE_PERMISSION[entityType]);
    const hits = await hitsForType(entityType, raw);
    const result = finalizeResolve(hits, entityType, query_kind);
    void logAdminRead("assistant", "assistant.tool", {
      tool: "resolve_entity",
      entity_type: entityType,
      query_kind,
      status: result.status,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "tool_failed";
    return { status: "error", error: message, entity_type: entityType };
  }
}
