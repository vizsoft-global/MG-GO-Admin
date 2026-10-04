export type ActiveDriverHit = {
  id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
};

/**
 * Split a search box value into a name and/or a numeric id.
 *
 * `"Shambhavi Testing (10084)"` is the shape the panel prints on a row and
 * therefore the shape operators paste back. Reducing it to
 * `"Shambhavi Testing 10084"` and then matching the whole string against
 * `full_name` (the previous behaviour) found nothing, because the profile name
 * is `"Shambhavi Testing"` and the code lives in a different column.
 */
export function parseSearchTerm(query: string): { name: string; id: string } {
  const cleaned = query
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { name: "", id: "" };
  const trailing = cleaned.match(/^(.*?)\s*(\d{4,8})$/);
  if (trailing) return { name: trailing[1]!.trim(), id: trailing[2]! };
  return { name: cleaned, id: "" };
}

/**
 * Search live drivers by employee ID, driver code, or profile name.
 * Name is resolved on `profiles` first — PostgREST cannot `.or()` a nested
 * column — with approved intakes as a second source for a rider who is not
 * linked to a driver row yet.
 */
export async function searchActiveDrivers(
  supabase: { from: (table: string) => any },
  query: string,
  limit = 30,
): Promise<ActiveDriverHit[]> {
  const { name, id } = parseSearchTerm(query);
  if (!name && !id) return [];

  const orParts: string[] = [];
  if (id) {
    orParts.push(`employee_id.ilike.%${id}%`, `driver_code.ilike.%${id}%`);
  }

  if (name) {
    const like = `%${name}%`;
    const { data: nameRows } = await supabase
      .from("profiles")
      .select("id")
      .ilike("full_name", like)
      .limit(limit);

    const nameIds = new Set<string>((nameRows ?? []).map((r: { id: string }) => r.id));

    // Approved intakes that have not been linked to `drivers` yet still carry
    // the name the operator typed. PostgREST cannot `.or()` a nested column,
    // so these are resolved separately and folded into the id set.
    const { data: intakeRows } = await supabase
      .from("driver_intakes")
      .select("linked_profile_id")
      .ilike("full_name", like)
      .is("archived_at", null)
      .limit(limit);
    for (const row of intakeRows ?? []) {
      if (row.linked_profile_id) nameIds.add(String(row.linked_profile_id));
    }

    if (nameIds.size > 0) {
      orParts.push(`id.in.(${[...nameIds].join(",")})`);
    }
  }

  if (orParts.length === 0) return [];

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
