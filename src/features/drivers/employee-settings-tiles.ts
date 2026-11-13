import type { LucideIcon } from "lucide-react";
import {
  Bike,
  BriefcaseBusiness,
  ClipboardCheck,
  ClipboardList,
  FormInput,
  Globe,
  Landmark,
  Layers,
  ListChecks,
  UsersRound,
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
   * the shared `EmployeeCatalogPanel`; the named ones are the module panels.
   */
  view:
    | { kind: "catalog"; catalog: EmployeeCatalogKind }
    | { kind: "serviceTypes" }
    | { kind: "attendance" }
    | { kind: "vehicleTypes" }
    | { kind: "driverFields" }
    | { kind: "clients" };
};

export const EMPLOYEE_SETTINGS_TILES: readonly EmployeeSettingsTile[] = [
  {
    key: "driverFields",
    href: "/settings/driver-fields",
    icon: FormInput,
    permission: "drivers.manage",
    superAdminOnly: true,
    view: { kind: "driverFields" },
  },
  {
    key: "serviceTypes",
    href: "/settings/service-types",
    icon: ListChecks,
    permission: "service.manage",
    view: { kind: "serviceTypes" },
  },
  {
    key: "attendanceSettings",
    href: "/settings/attendance",
    icon: ClipboardCheck,
    permission: "attendance.manage",
    view: { kind: "attendance" },
  },
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
