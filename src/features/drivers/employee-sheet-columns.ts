/**
 * Shared identity column order for the employees list, export, and the
 * import template's human headers. Live-ops columns (today deliveries,
 * attendance, passcode) stay list-only.
 *
 * The template still leads with Full Name so `guessColumnMapping` does not
 * let "Company Name" steal the name needle.
 */
export const EMPLOYEE_IDENTITY_HEADERS = {
  client_id: "Client ID",
  employee_id: "MG ID",
  rider_category: "Category",
  company_client_id: "Company Client ID",
  company_name: "Company Name",
  full_name: "Name",
  phone: "Phone",
  restaurants: "Restaurant",
  zone: "Zone",
  vehicle: "Vehicle",
  section: "Employee Category",
  partner: "Project",
  employee_status: "Employee Status",
  driver_code: "Driver ID",
  project_key: "Project key",
  client_name: "Platform",
  account_status: "Status",
  on_duty: "Attendance",
  today_deliveries: "Today Deliveries",
  workflow_status: "Workflow",
  linked: "App linked",
} as const;

export type EmployeeSheetColumnId = keyof typeof EMPLOYEE_IDENTITY_HEADERS;

export const EMPLOYEE_IDENTITY_COLUMN_IDS = [
  "client_id",
  "employee_id",
  "rider_category",
  "company_client_id",
  "company_name",
  "full_name",
  "phone",
  "restaurants",
  "zone",
  "vehicle",
  "section",
  "partner",
  "employee_status",
] as const satisfies readonly EmployeeSheetColumnId[];

export const EMPLOYEE_OPTIONAL_EXPORT_IDS = [
  "driver_code",
  "project_key",
  "client_name",
  "account_status",
  "on_duty",
  "today_deliveries",
  "workflow_status",
  "linked",
] as const satisfies readonly EmployeeSheetColumnId[];

export function employeeSheetHeader(id: string): string {
  return id in EMPLOYEE_IDENTITY_HEADERS
    ? EMPLOYEE_IDENTITY_HEADERS[id as EmployeeSheetColumnId]
    : id;
}
