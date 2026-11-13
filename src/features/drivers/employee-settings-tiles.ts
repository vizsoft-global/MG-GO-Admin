import type { LucideIcon } from "lucide-react";
import {
  Bike,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  Globe,
  Landmark,
  Layers,
  LogOut,
  MapPin,
  Store,
  UsersRound,
  UserRoundCheck,
} from "lucide-react";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import type { EmployeeCatalogKind } from "@/features/employees/employee-catalogs";

/**
 * The Employee Settings doors.
 *
 * One list, so the header dialog, its permission filter and the test all read
 * the same thing. Each tile is gated on the permission its page already asks
 * for — no new slugs — and the dialog simply hides what the operator cannot
 * open.
 *
 * The client's review asked for three doors to go and eleven to arrive. The
 * three that went — Employee fields, Service types and Attendance settings —
 * configured a *module*, not an employee, and the Employees header was the wrong
 * place to reach them. Of the eleven asked for, seven are masters that belong
 * here; the other four (Beneficiary Civil ID, Off structure, Accommodation) are
 * values on one rider's record, which are edited on that rider's profile and
 * would have nothing to list in a catalog.
 */
export type EmployeeSettingsTile = {
  key: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  /**
   * A tile whose page is super-admin only. Without this the sheet would offer a
   * manager a door that answers /unauthorized — the same rule the OperationsHub
   * tile and the sidebar row follow.
   */
  superAdminOnly?: boolean;
  /**
   * Which editor the Employee Settings sheet renders in place. `catalog` uses
   * the shared `EmployeeCatalogPanel`; the named ones are the module panels; a
   * `link` door hands off to a page that is a map or a grid of its own rather
   * than a list of labels, so it is better opened than embedded.
   */
  view:
    | { kind: "catalog"; catalog: EmployeeCatalogKind }
    | { kind: "vehicleTypes" }
    | { kind: "clients" }
    | { kind: "link"; descriptionKey: string };
};

export const EMPLOYEE_SETTINGS_TILES: readonly EmployeeSettingsTile[] = [
  // The four catalogs that used to be compiled enums or fixed lists in code.
  {
    key: "nationalities",
    href: "/settings/nationalities",
    icon: Globe,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "nationalities" },
  },
  {
    key: "hiringTypes",
    href: "/settings/hiring-types",
    icon: UserRoundCheck,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "hiring_types" },
  },
  {
    key: "jobEndDescriptions",
    href: "/settings/job-end-descriptions",
    icon: LogOut,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "job_end_descriptions" },
  },
  {
    key: "paymentCurrencies",
    href: "/settings/payment-currencies",
    icon: Coins,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "payment_currencies" },
  },
  {
    key: "sponsorships",
    href: "/settings/sponsorships",
    icon: CalendarClock,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "sponsorships" },
  },
  // Company, Zone and Restaurant are modules with their own editors, so the door
  // hands off rather than re-implementing a grid or a map inside a dialog.
  {
    key: "companies",
    href: "/settings/source-companies",
    icon: Building2,
    permission: "drivers.manage",
    view: { kind: "link", descriptionKey: "companiesHint" },
  },
  {
    key: "zones",
    href: "/zones",
    icon: MapPin,
    permission: "zones.view",
    view: { kind: "link", descriptionKey: "zonesHint" },
  },
  {
    key: "restaurants",
    href: "/restaurants",
    icon: Store,
    permission: "restaurants.view",
    view: { kind: "link", descriptionKey: "restaurantsHint" },
  },
  // Kept, in the client's own order.
  {
    key: "vehicleTypes",
    href: "/settings/vehicle-types",
    icon: Bike,
    permission: "vehicles.manage",
    view: { kind: "vehicleTypes" },
  },
  {
    key: "employeeStatuses",
    href: "/settings/employee-statuses",
    icon: ClipboardList,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "employee_statuses" },
  },
  {
    key: "employeeSections",
    href: "/settings/employee-sections",
    icon: Layers,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "employee_sections" },
  },
  {
    key: "nationalityCategories",
    href: "/settings/nationality-categories",
    icon: Globe,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "nationality_categories" },
  },
  {
    key: "bankCodes",
    href: "/settings/bank-codes",
    icon: Landmark,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "bank_codes" },
  },
  {
    key: "jobPositions",
    href: "/settings/job-positions",
    icon: BriefcaseBusiness,
    permission: "drivers.manage",
    view: { kind: "catalog", catalog: "job_positions" },
  },
  // The client catalog is the Employee Client dropdown's own source of truth, so
  // it belongs with the other employee catalogs rather than inside Payroll.
  {
    key: "clients",
    href: "/settings/payroll-clients",
    icon: UsersRound,
    permission: "drivers.manage",
    view: { kind: "clients" },
  },
] as const;

export function visibleEmployeeSettingsTiles(
  permissions: ReadonlySet<string> | Iterable<string>,
  isSuperAdmin: boolean,
): EmployeeSettingsTile[] {
  const ticks = permissions instanceof Set ? permissions : new Set(permissions);
  return EMPLOYEE_SETTINGS_TILES.filter(
    (tile) =>
      (!tile.superAdminOnly || isSuperAdmin) &&
      hasPermissionInSet(ticks, tile.permission, isSuperAdmin),
  );
}
