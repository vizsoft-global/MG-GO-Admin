import { partnerLabel } from "@/features/performance/performance-ops-format";

/** Client Name and Zone are catalog picks, not free-text identity cells. */
export type PayrollAssignField = "projectKey" | "zoneId";

export function payrollAssignField(columnId: string): PayrollAssignField | null {
  switch (columnId) {
    case "partner":
      return "projectKey";
    case "zone":
      return "zoneId";
    default:
      return null;
  }
}

/** Printed Client Name: the payroll catalog name, then Keeta / Americana. */
export function payrollPartnerLabel(
  projectKey: string | null | undefined,
  clientName: string | null | undefined,
): string {
  const named = clientName?.trim();
  if (named) return named;
  return partnerLabel(projectKey);
}
