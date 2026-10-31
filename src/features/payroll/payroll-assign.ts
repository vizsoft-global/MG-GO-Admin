import { partnerLabel } from "@/features/performance/performance-ops-format";

/**
 * Client Name, Zone and Restaurant are catalog picks, not free-text identity
 * cells. Restaurant joined them for the Combined Payroll row (SOP item 13).
 */
export type PayrollAssignField = "projectKey" | "zoneId" | "restaurantName";

export function payrollAssignField(columnId: string): PayrollAssignField | null {
  switch (columnId) {
    case "partner":
      return "projectKey";
    case "zone":
      return "zoneId";
    case "rest":
    case "restaurant":
      return "restaurantName";
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
