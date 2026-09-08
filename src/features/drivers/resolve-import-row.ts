export type ImportRowReason =
  | "ok"
  | "empty"
  | "unknown_id"
  | "blocked"
  | "archived"
  | "ambiguous";

export type ImportLookupMatch = {
  driver_id: string;
  employee_id: string;
  driver_code: string;
  full_name: string;
  is_blocked: boolean;
  archived_at: string | null;
};

export type ImportRowDecision = {
  status: ImportRowReason;
  driver: ImportLookupMatch | null;
};

export function lookupToImportMatch(r: {
  driver_id: string | null;
  employee_id: string;
  driver_code: string | null;
  full_name: string | null;
  error: "not_found" | "blocked" | "archived" | null;
}): ImportLookupMatch | null {
  if (!r.driver_id) return null;
  return {
    driver_id: r.driver_id,
    employee_id: r.employee_id,
    driver_code: r.driver_code ?? "",
    full_name: r.full_name ?? "Driver",
    is_blocked: r.error === "blocked",
    archived_at: r.error === "archived" ? "archived" : null,
  };
}

function token(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Per-row import match. Employee ID and driver code resolve independently.
 * Both filled and pointing at two different live drivers is ambiguous.
 */
export function decideImportRowMatch(input: {
  employeeId?: string | null;
  driverCode?: string | null;
  byEmployee: ImportLookupMatch | null;
  byCode: ImportLookupMatch | null;
}): ImportRowDecision {
  const emp = token(input.employeeId);
  const code = token(input.driverCode);
  if (!emp && !code) {
    return { status: "empty", driver: null };
  }

  const byEmp = emp ? input.byEmployee : null;
  const byCode = code ? input.byCode : null;

  if (byEmp && byCode && byEmp.driver_id !== byCode.driver_id) {
    return { status: "ambiguous", driver: null };
  }

  const match = byEmp ?? byCode;
  if (!match) {
    return { status: "unknown_id", driver: null };
  }
  if (match.archived_at) {
    return { status: "archived", driver: match };
  }
  if (match.is_blocked) {
    return { status: "blocked", driver: match };
  }
  return { status: "ok", driver: match };
}
