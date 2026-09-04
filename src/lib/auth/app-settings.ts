import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { withDeadline } from "@/lib/supabase/deadline";

export type AppOpsSettings = {
  maintenanceMode: boolean;
  superAdminClaimed: boolean;
  superAdminUserId: string | null;
};

const OPS_SETTINGS_BUDGET_MS = 5_000;

async function fetchAppOpsSettings(): Promise<AppOpsSettings> {
  try {
    const supabase = await createClient({ timeoutMs: OPS_SETTINGS_BUDGET_MS });
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

/**
 * Read on every dashboard render, so it cannot be allowed to hang the page.
 * A timeout yields the same defaults the function already returns for a failed
 * read, which leave maintenance mode off — the fail-open direction, matching
 * the proxy.
 */
export const getAppOpsSettings = cache(() =>
  withDeadline(fetchAppOpsSettings(), OPS_SETTINGS_BUDGET_MS, () => ({
    maintenanceMode: false,
    superAdminClaimed: false,
    superAdminUserId: null,
  })),
);
