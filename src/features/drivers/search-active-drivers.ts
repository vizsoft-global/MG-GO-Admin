export type ActiveDriverHit = {
  id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
};

function sanitizeTerm(term: string): string {
  return term.replace(/[%(),]/g, " ").trim();
}

/**
 * Search live drivers by employee ID, driver code, or profile name.
 * Name is resolved on `profiles` first — PostgREST cannot `.or()` a nested column.
 */
export async function searchActiveDrivers(
  supabase: { from: (table: string) => any },
  query: string,
  limit = 30,
): Promise<ActiveDriverHit[]> {
  const term = sanitizeTerm(query);
  if (!term) return [];

  const like = `%${term}%`;
  const { data: nameRows } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", like)
    .limit(limit);

  const nameIds = (nameRows ?? []).map((r: { id: string }) => r.id);
  const orParts = [`employee_id.ilike.${like}`, `driver_code.ilike.${like}`];
  if (nameIds.length > 0) {
    orParts.push(`id.in.(${nameIds.join(",")})`);
  }

  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
    .is("archived_at", null)
    .or(orParts.join(","))
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((d: any) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? "",
      full_name: profile?.full_name?.trim() || "Driver",
    };
  });
}
