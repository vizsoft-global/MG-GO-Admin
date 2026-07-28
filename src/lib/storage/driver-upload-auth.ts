import { createAdminClient } from "@/lib/supabase/admin";

export type DriverAuthContext = {
  authUid: string;
  driverId: string;
};

export async function requireDriverFromRequest(
  request: Request,
): Promise<DriverAuthContext | { error: string; status: number }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "missing_token", status: 401 };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: "missing_token", status: 401 };
  }

  const admin = createAdminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData.user) {
    return { error: "invalid_token", status: 401 };
  }

  const authUid = userData.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", authUid)
    .maybeSingle();

  if (profile?.role !== "rider") {
    return { error: "not_a_driver", status: 403 };
  }

  const { data: driver } = await admin
    .from("drivers")
    .select("id, archived_at")
    .eq("id", authUid)
    .maybeSingle();

  if (!driver) {
    return { error: "driver_not_found", status: 403 };
  }

  if (driver.archived_at) {
    return { error: "driver_archived", status: 403 };
  }

  return { authUid, driverId: driver.id };
}
