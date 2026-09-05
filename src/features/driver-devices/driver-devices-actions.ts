"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { sendDirectDriverNotification } from "@/features/notifications/notifications-actions";
import {
  getSentryDeviceOverview,
  sentryDriverIssuesUrl,
  type SentryDisconnectedReason,
} from "@/lib/sentry/sentry-api";
import { parseDriverDevicesSnapshot } from "./driver-devices-types";

const DRIVER_APP_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.musallam_delivery.app";

const FORCE_BATCH_CAP = 200;

export type DriverDevicesSentryView =
  | {
      connected: true;
      byDriver: Record<string, { events: number; issues: number; url: string | null }>;
      byBuild: Record<string, { events: number; users: number }>;
    }
  | {
      connected: false;
      reason: SentryDisconnectedReason;
      byDriver: Record<string, never>;
      byBuild: Record<string, never>;
    };

export type DriverDevicesPageData = {
  snapshot: ReturnType<typeof parseDriverDevicesSnapshot>;
  sentry: DriverDevicesSentryView;
};

async function requireView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_devices.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireExport() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "driver_devices.export",
      session.isSuperAdmin,
    )
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireManageDrivers() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function toSentryView(
  overview: Awaited<ReturnType<typeof getSentryDeviceOverview>>,
): DriverDevicesSentryView {
  if (!overview.connected) {
    return {
      connected: false,
      reason: overview.reason,
      byDriver: {},
      byBuild: {},
    };
  }
  const byDriver: Record<
    string,
    { events: number; issues: number; url: string | null }
  > = {};
  for (const d of overview.drivers) {
    byDriver[d.driverId] = {
      events: d.events,
      issues: d.issues,
      url: sentryDriverIssuesUrl(d.driverId),
    };
  }
  const byBuild: Record<string, { events: number; users: number }> = {};
  for (const b of overview.builds) {
    const key = b.versionCode == null ? "unknown" : String(b.versionCode);
    byBuild[key] = { events: b.events, users: b.users };
  }
  return { connected: true, byDriver, byBuild };
}

async function loadDevicesPageData(): Promise<DriverDevicesPageData | { error: string }> {
  const supabase = await createClient();
  const [{ data, error }, overview] = await Promise.all([
    supabase.rpc("admin_list_driver_devices" as never),
    getSentryDeviceOverview(),
  ]);
  if (error) {
    console.error("[driver-devices] list failed", error.message);
    return { error: "load_failed" };
  }
  return {
    snapshot: parseDriverDevicesSnapshot(data),
    sentry: toSentryView(overview),
  };
}

export async function listDriverDevices(): Promise<DriverDevicesPageData> {
  const auth = await requireView();
  if ("error" in auth) {
    return {
      snapshot: parseDriverDevicesSnapshot(null),
      sentry: {
        connected: false,
        reason: "not_configured",
        byDriver: {},
        byBuild: {},
      },
    };
  }
  const result = await loadDevicesPageData();
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result;
}

export async function exportDriverDevices(): Promise<DriverDevicesPageData> {
  const auth = await requireExport();
  if ("error" in auth) {
    throw new Error(auth.error);
  }
  const result = await loadDevicesPageData();
  if ("error" in result) {
    throw new Error(result.error);
  }
  void logAdminMutation({
    action: "export",
    entityType: "driver_devices",
    routeName: "driverDevices.export",
    after: { rows: result.snapshot.rows.length },
  });
  return result;
}

export async function setDriverDevicesForceUpdate(input: {
  driverIds: string[];
  minVersionCode: number | null;
  enabled: boolean;
}): Promise<{ updated: number } | { error: string; errorDetail?: string }> {
  const auth = await requireManageDrivers();
  if (auth.error) return { error: auth.error };

  const ids = [...new Set(input.driverIds.filter(Boolean))];
  if (ids.length === 0) return { error: "empty_selection" };
  if (ids.length > FORCE_BATCH_CAP) return { error: "too_many_drivers" };

  const minCode = input.enabled
    ? input.minVersionCode != null && Number.isFinite(input.minVersionCode)
      ? Math.trunc(input.minVersionCode)
      : null
    : 1;
  if (input.enabled && (minCode == null || minCode < 1)) {
    return { error: "invalid_min_code" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_driver_force_update" as never, {
    p_driver_ids: ids,
    p_min_code: minCode ?? 1,
    p_enabled: input.enabled,
  } as never);

  if (error) {
    console.error("[driver-devices] force update failed", error.message);
    return { error: "save_failed", errorDetail: error.message };
  }

  const updated =
    data && typeof data === "object" && "updated" in data
      ? Number((data as { updated: unknown }).updated ?? 0)
      : 0;

  void logAdminMutation({
    action: "update",
    entityType: "drivers",
    routeName: "driverDevices.forceUpdate",
    after: {
      enabled: input.enabled,
      min_code: minCode,
      driver_ids: ids,
      updated,
    },
  });

  return { updated };
}

export async function notifyDriverDevices(input: {
  driverIds: string[];
  title: string;
  body: string;
}): Promise<
  | { success: true; recipients: number; pushed: number; skipped: number; failed: number }
  | { error: string }
> {
  const auth = await requireView();
  if (auth.error) return { error: auth.error };

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return { error: "missing_fields" };
  const driverIds = [...new Set(input.driverIds.filter(Boolean))];
  if (driverIds.length === 0) return { error: "empty_selection" };

  const result = await sendDirectDriverNotification({
    driverIds,
    title,
    body,
    url: DRIVER_APP_PLAY_URL,
    category: "system_alert",
    routeName: "driverDevices.notifyUpdate",
  });
  if ("error" in result) {
    return {
      error:
        result.error === "not_authorized"
          ? "notifications_send_required"
          : result.error,
    };
  }

  void logAdminMutation({
    action: "create",
    entityType: "drivers",
    routeName: "driverDevices.notifyUpdate",
    after: {
      recipients: driverIds.length,
      pushed: result.sent,
    },
  });

  return {
    success: true,
    recipients: driverIds.length,
    pushed: result.sent,
    skipped: result.skipped,
    failed: result.failed,
  };
}
