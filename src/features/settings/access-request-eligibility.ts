/** Staff panel sign-ups waiting for a role — not rider / driver accounts. */
export function isAdminAccessRequestProfile(row: {
  role: string | null;
  approval_status: string | null;
  isDriver?: boolean;
}): boolean {
  if (row.role !== "staff") return false;
  if (row.approval_status !== "pending") return false;
  if (row.isDriver) return false;
  return true;
}
