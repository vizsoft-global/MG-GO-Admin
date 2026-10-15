"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { callAdminFunction } from "@/lib/firebase/callable";
import { aggregateEmployeesDashboard, type EmployeesDashboard } from "./employees-dashboard";

export async function fetchEmployeesDashboard(): Promise<EmployeesDashboard> {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  const { data, error } = await callAdminFunction("admin_employees_dashboard", {});
  if (!error && data && typeof data === "object") {
    const row = data as EmployeesDashboard;
    if (typeof row.total === "number") return row;
  }
  return aggregateEmployeesDashboard([]);
}
