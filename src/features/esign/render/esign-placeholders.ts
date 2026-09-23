const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export const EMPLOYEE_PLACEHOLDER_KEYS = [
  "company_name",
  "employee_name",
  "employee_id",
  "driver_code",
  "zone",
  "project",
  "nationality",
] as const;

export type EsignEmployeeSnapshot = {
  company_name: string;
  employee_name: string;
  employee_id: string;
  driver_code: string;
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
