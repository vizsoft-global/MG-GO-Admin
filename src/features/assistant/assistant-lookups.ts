import { createClient } from "@/lib/supabase/server";

export async function resolveZoneId(nameOrId?: string | null): Promise<{
  id?: string;
  name?: string;
}> {
  const raw = nameOrId?.trim();
  if (!raw || raw.toLowerCase() === "all") return {};
  const supabase = await createClient();
  const byId = await supabase.from("zones").select("id, name").eq("id", raw).maybeSingle();
  if (byId.data) return { id: byId.data.id, name: byId.data.name };
  const { data } = await supabase
    .from("zones")
    .select("id, name")
    .ilike("name", raw)
    .limit(2);
  if ((data ?? []).length === 1) return { id: data![0]!.id, name: data![0]!.name };
  const fuzzy = await supabase.from("zones").select("id, name").ilike("name", `%${raw}%`).limit(2);
  if ((fuzzy.data ?? []).length === 1) {
    return { id: fuzzy.data![0]!.id, name: fuzzy.data![0]!.name };
  }
  return {};
}

export async function resolvePartnerId(nameOrId?: string | null): Promise<{
  id?: string;
  name?: string;
}> {
  const raw = nameOrId?.trim();
  if (!raw || raw.toLowerCase() === "all") return {};
  const supabase = await createClient();
  const byId = await supabase.from("partners").select("id, name").eq("id", raw).maybeSingle();
  if (byId.data) return { id: byId.data.id, name: byId.data.name };
  const { data } = await supabase
    .from("partners")
    .select("id, name")
    .ilike("name", raw)
    .limit(2);
  if ((data ?? []).length === 1) return { id: data![0]!.id, name: data![0]!.name };
  const fuzzy = await supabase.from("partners").select("id, name").ilike("name", `%${raw}%`).limit(2);
  if ((fuzzy.data ?? []).length === 1) {
    return { id: fuzzy.data![0]!.id, name: fuzzy.data![0]!.name };
  }
  return {};
}

export async function resolveRestaurantId(nameOrId?: string | null): Promise<{
  id?: string;
  name?: string;
}> {
  const raw = nameOrId?.trim();
  if (!raw || raw.toLowerCase() === "all") return {};
  const supabase = await createClient();
  const byId = await supabase.from("restaurants").select("id, name").eq("id", raw).maybeSingle();
  if (byId.data) return { id: byId.data.id, name: byId.data.name };
  const { data } = await supabase
    .from("restaurants")
    .select("id, name")
    .ilike("name", raw)
    .limit(2);
  if ((data ?? []).length === 1) return { id: data![0]!.id, name: data![0]!.name };
  const fuzzy = await supabase
    .from("restaurants")
    .select("id, name")
    .ilike("name", `%${raw}%`)
    .limit(2);
  if ((fuzzy.data ?? []).length === 1) {
    return { id: fuzzy.data![0]!.id, name: fuzzy.data![0]!.name };
  }
  return {};
}

/**
 * Split a user-typed rider reference into an optional numeric id and a name.
 *
 * Handles the shape the UI shows on a row — `"Shambhavi Testing (10084)"` —
 * so a pasted label resolves instead of failing the whole search. A bare
 * `"10084"` is an id with no name, and `"Shambhavi Testing"` is a name with
 * no id.
 */
export function parseDriverReference(raw: string): { name: string; id?: string } {
  const cleaned = raw
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { name: "" };
  const trailing = cleaned.match(/^(.*?)\s*(\d{4,8})$/);
  if (trailing) {
    return { name: trailing[1]!.trim(), id: trailing[2]! };
  }
  return { name: cleaned };
}

export async function resolveDriverId(codeOrEmployeeOrName?: string | null): Promise<{
  id?: string;
  name?: string;
  driver_code?: string;
  employee_id?: string;
}> {
  const raw = codeOrEmployeeOrName?.trim();
  if (!raw) return {};
  const supabase = await createClient();
  const { name, id } = parseDriverReference(raw);

  if (id) {
    const byCode = await supabase
      .from("drivers")
      .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
      .or(`driver_code.eq.${id},employee_id.eq.${id}`)
      .is("archived_at", null)
      .limit(2);
    if ((byCode.data ?? []).length === 1) {
      const row = byCode.data![0]!;
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        driver_code: row.driver_code,
        employee_id: row.employee_id ?? undefined,
        name: profile?.full_name ?? undefined,
      };
    }
    if (!name) return {};
  }

  if (!name) return {};

  // Name is resolved on `profiles` first — PostgREST cannot `.or()` a nested
  // column — with approved intakes as a second source so a rider who has not
  // been linked yet is still findable.
  const { data: nameRows } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", `%${name}%`)
    .limit(2);
  const nameIds = (nameRows ?? []).map((r: { id: string }) => r.id);
  const { data: intakeRows } = await supabase
    .from("driver_intakes")
    .select("linked_profile_id, driver_code, employee_id, full_name")
    .ilike("full_name", `%${name}%`)
    .is("archived_at", null)
    .limit(2);

  for (const intake of intakeRows ?? []) {
    if (intake.linked_profile_id && !nameIds.includes(intake.linked_profile_id)) {
      nameIds.push(intake.linked_profile_id);
    }
  }

  if (nameIds.length === 0) return {};
  const { data: byName } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
    .in("id", nameIds)
    .is("archived_at", null)
    .limit(2);
  if ((byName ?? []).length !== 1) return {};
  const row = byName![0]!;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    driver_code: row.driver_code,
    employee_id: row.employee_id ?? undefined,
    name: profile?.full_name ?? undefined,
  };
}
