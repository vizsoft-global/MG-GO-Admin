import { cache } from "react";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { withDeadline } from "@/lib/async/deadline";

export type AppOpsSettings = {
  maintenanceMode: boolean;
  superAdminClaimed: boolean;
  superAdminUserId: string | null;
};

const OPS_SETTINGS_BUDGET_MS = 5_000;

const FALLBACK: AppOpsSettings = {
  maintenanceMode: false,
  superAdminClaimed: false,
  superAdminUserId: null,
};

async function fetchAppOpsSettings(): Promise<AppOpsSettings> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return FALLBACK;

    const snap = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
    if (!snap.exists) return FALLBACK;

    const data = snap.data() ?? {};
    return {
      maintenanceMode: data.maintenance_mode ?? false,
      superAdminClaimed: data.super_admin_claimed ?? false,
      superAdminUserId: (data.super_admin_user_id as string | null) ?? null,
    };
  } catch {
    return FALLBACK;
  }
}

/**
 * Read on every dashboard render, so it cannot be allowed to hang the page.
 * A timeout yields the same defaults the function already returns for a failed
 * read, which leave maintenance mode off — the fail-open direction, matching
 * the proxy.
 */
export const getAppOpsSettings = cache(() =>
  withDeadline(fetchAppOpsSettings(), OPS_SETTINGS_BUDGET_MS, () => FALLBACK),
);
