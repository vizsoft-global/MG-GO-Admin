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

export async function resolveDriverId(codeOrEmployeeOrName?: string | null): Promise<{
  id?: string;
  name?: string;
  driver_code?: string;
  employee_id?: string;
}> {
  const raw = codeOrEmployeeOrName?.trim();
  if (!raw) return {};
  const supabase = await createClient();
  const digits = raw.replace(/\s+/g, "");
  if (/^\d{4,8}$/.test(digits) || /^\d{5}$/.test(digits)) {
    const byCode = await supabase
      .from("drivers")
      .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
      .or(`driver_code.eq.${digits},employee_id.eq.${digits}`)
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
  }
  return {};
}
