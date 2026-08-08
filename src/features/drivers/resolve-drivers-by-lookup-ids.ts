import { normalizeDriverLookupIds } from "./parse-pasted-driver-ids";

export type ResolvedDriverLookup = {
  /** Original pasted / requested token */
  lookup_id: string;
  /** Canonical employee_id from drivers row when matched */
  employee_id: string;
  driver_id: string | null;
  driver_code: string | null;
  full_name: string | null;
  error: "not_found" | "blocked" | null;
};

type DriverMatchRow = {
  driver_id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
  is_blocked: boolean;
  archived_at: string | null;
};

function rowFromDriver(d: {
  id: string;
  driver_code: string;
  employee_id: string;
  is_blocked: boolean;
  archived_at: string | null;
  profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null;
}): DriverMatchRow {
  const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
  return {
    driver_id: d.id,
    driver_code: d.driver_code,
    employee_id: d.employee_id,
    full_name: profile?.full_name?.trim() || "Driver",
    is_blocked: d.is_blocked,
    archived_at: d.archived_at,
  };
}

/**
 * Resolve pasted IDs against drivers.employee_id OR drivers.driver_code.
 */
export async function resolveDriversByLookupIds(
  supabase: {
    from: (table: string) => any;
  },
  lookupIds: string[],
): Promise<ResolvedDriverLookup[]> {
  const normalized = normalizeDriverLookupIds(lookupIds);
  if (normalized.length === 0) return [];

  const select =
    "id, driver_code, employee_id, is_blocked, archived_at, profiles(full_name)";

  const [byEmployeeResult, byCodeResult] = await Promise.all([
    supabase.from("drivers").select(select).in("employee_id", normalized),
    supabase.from("drivers").select(select).in("driver_code", normalized),
  ]);

  if (byEmployeeResult.error) throw new Error(byEmployeeResult.error.message);
  if (byCodeResult.error) throw new Error(byCodeResult.error.message);

  const byLookup = new Map<string, DriverMatchRow>();

  for (const d of byEmployeeResult.data ?? []) {
    const row = rowFromDriver(d);
    byLookup.set(row.employee_id, row);
  }
  for (const d of byCodeResult.data ?? []) {
    const row = rowFromDriver(d);
    // Prefer employee_id match when the same token hits both (rare).
    if (!byLookup.has(row.driver_code)) {
      byLookup.set(row.driver_code, row);
    }
  }

  return normalized.map((lookup_id) => {
    const match = byLookup.get(lookup_id);
    if (!match) {
      return {
        lookup_id,
        employee_id: lookup_id,
        driver_id: null,
        driver_code: null,
        full_name: null,
        error: "not_found" as const,
      };
    }
    if (match.archived_at || match.is_blocked) {
      return {
        lookup_id,
        employee_id: match.employee_id,
        driver_id: match.driver_id,
        driver_code: match.driver_code,
        full_name: match.full_name,
        error: "blocked" as const,
      };
    }
    return {
      lookup_id,
      employee_id: match.employee_id,
      driver_id: match.driver_id,
      driver_code: match.driver_code,
      full_name: match.full_name,
      error: null,
    };
  });
}
