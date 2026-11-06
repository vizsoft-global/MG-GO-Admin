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
};

export const EMPLOYEE_SETTINGS_TILES: readonly EmployeeSettingsTile[] = [
  { key: "driverFields", href: "/settings/driver-fields", icon: FormInput, permission: "drivers.manage" },
  { key: "serviceTypes", href: "/settings/service-types", icon: ListChecks, permission: "service.manage" },
  {
    key: "attendanceSettings",
    href: "/settings/attendance",
    icon: ClipboardCheck,
    permission: "attendance.manage",
  },
  { key: "vehicleTypes", href: "/settings/vehicle-types", icon: Bike, permission: "vehicles.manage" },
  {
    key: "employeeStatuses",
    href: "/settings/employee-statuses",
    icon: ClipboardList,
    permission: "drivers.manage",
  },
  { key: "employeeSections", href: "/settings/employee-sections", icon: Layers, permission: "drivers.manage" },
  {
    key: "nationalityCategories",
    href: "/settings/nationality-categories",
    icon: Globe,
    permission: "drivers.manage",
  },
  { key: "bankCodes", href: "/settings/bank-codes", icon: Landmark, permission: "drivers.manage" },
  {
    key: "jobPositions",
    href: "/settings/job-positions",
    icon: BriefcaseBusiness,
    permission: "drivers.manage",
  },
  // The client catalog is the Employee Client dropdown's own source of truth, so
  // it belongs with the other employee catalogs rather than inside Payroll.
  { key: "clients", href: "/settings/payroll-clients", icon: UsersRound, permission: "drivers.manage" },
] as const;

export function visibleEmployeeSettingsTiles(
  permissions: ReadonlySet<string> | Iterable<string>,
  isSuperAdmin: boolean,
): EmployeeSettingsTile[] {
  const ticks = permissions instanceof Set ? permissions : new Set(permissions);
  return EMPLOYEE_SETTINGS_TILES.filter((tile) =>
    hasPermissionInSet(ticks, tile.permission, isSuperAdmin),
  );
}
