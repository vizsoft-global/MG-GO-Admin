import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AppOpsSettings = {
  maintenanceMode: boolean;
  superAdminClaimed: boolean;
  superAdminUserId: string | null;
};

async function fetchAppOpsSettings(): Promise<AppOpsSettings> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("maintenance_mode, super_admin_claimed, super_admin_user_id")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return {
        maintenanceMode: false,
        superAdminClaimed: false,
        superAdminUserId: null,
      };
    }

    return {
      maintenanceMode: data.maintenance_mode ?? false,
      superAdminClaimed: data.super_admin_claimed ?? false,
      superAdminUserId: data.super_admin_user_id,
    };
  } catch {
    return {
      maintenanceMode: false,
      superAdminClaimed: false,
      superAdminUserId: null,
    };
  }
}

export const getAppOpsSettings = cache(fetchAppOpsSettings);
