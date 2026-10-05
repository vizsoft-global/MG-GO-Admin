const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Keys the employee block always resolves from the rider's own record.
 *
 * This is the *order* the block prints in: the first three are always drawn,
 * the remainder only when they carry a value, so a rider with no civil ID does
 * not get an empty line on a signed document. `civil_id`, `joined_at` and
 * `accommodation` were added for EmployeeDesk V2 — the reference design's
 * employee block carries a joining date, a civil ID and accommodation, and all
 * three are columns the rider record already holds. Nothing was invented to
 * fill the block: a key that has no column simply is not here.
 */
export const EMPLOYEE_PLACEHOLDER_KEYS = [
  "company_name",
  "employee_name",
  "employee_id",
  "driver_code",
  "civil_id",
  "joined_at",
  "accommodation",
  "zone",
  "project",
  "nationality",
] as const;

export type EsignEmployeeSnapshot = {
  company_name: string;
  employee_name: string;
  employee_id: string;
  driver_code: string;
  /** ISO `YYYY-MM-DD`, so a consumer can parse it; the PDF prints it as-is. */
  civil_id: string | null;
  joined_at: string | null;
  accommodation: string | null;
  zone: string | null;
  project: string | null;
  nationality: string | null;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function snapshotValues(snapshot: EsignEmployeeSnapshot): Record<string, string> {
  return {
    company_name: snapshot.company_name,
    employee_name: snapshot.employee_name,
    employee_id: snapshot.employee_id,
    driver_code: snapshot.driver_code,
    civil_id: snapshot.civil_id ?? "",
    joined_at: snapshot.joined_at ?? "",
    accommodation: snapshot.accommodation ?? "",
    zone: snapshot.zone ?? "",
    project: snapshot.project ?? "",
    nationality: snapshot.nationality ?? "",
  };
}

/** Fill `{{tokens}}`. Values are HTML-escaped. Missing keys become empty. */
export function fillPlaceholders(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  return template.replace(PLACEHOLDER, (_all, key: string) => {
    const raw = values[key];
    if (raw == null) return "";
    return escapeHtml(String(raw));
  });
}

export function listPlaceholders(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    keys.add(match[1]);
  }
  return [...keys];
}
