export type DeviceSessionRevokedReason =
  | "override"
  | "manual_signout"
  | "admin_forced"
  | "flushed";

export type DeviceSessionStatus =
  | "active"
  | "override_pending"
  | "signed_out"
  | "admin_forced"
  | "inactive";

export type DriverDeviceSessionRow = {
  session_id: string;
  device_id: string;
  device_model: string | null;
  device_manufacturer: string | null;
  os_version: string | null;
  android_sdk_int: number | null;
  app_version_name: string | null;
  app_version_code: number | null;
  first_seen_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  revoked_reason: DeviceSessionRevokedReason | null;
  flush_deadline_at: string | null;
  flushed_at: string | null;
  is_active: boolean;
};

export type DriverDeviceOverview = {
  driver_id: string;
  active_device_id: string | null;
  active_device: DriverDeviceSessionRow | null;
  history: DriverDeviceSessionRow[];
};

export type DriverMultiDeviceRecentRow = {
  driver_id: string;
  device_count: number;
  latest_activity_at: string;
};

function parseSessionRow(raw: Record<string, unknown>): DriverDeviceSessionRow | null {
  const sessionId = raw.session_id;
  const deviceId = raw.device_id;
  if (typeof sessionId !== "string" || typeof deviceId !== "string") return null;

  return {
    session_id: sessionId,
    device_id: deviceId,
    device_model: typeof raw.device_model === "string" ? raw.device_model : null,
    device_manufacturer:
      typeof raw.device_manufacturer === "string" ? raw.device_manufacturer : null,
    os_version: typeof raw.os_version === "string" ? raw.os_version : null,
    android_sdk_int: typeof raw.android_sdk_int === "number" ? raw.android_sdk_int : null,
    app_version_name:
      typeof raw.app_version_name === "string" ? raw.app_version_name : null,
    app_version_code:
      typeof raw.app_version_code === "number" ? raw.app_version_code : null,
    first_seen_at: typeof raw.first_seen_at === "string" ? raw.first_seen_at : "",
    last_seen_at: typeof raw.last_seen_at === "string" ? raw.last_seen_at : "",
    revoked_at: typeof raw.revoked_at === "string" ? raw.revoked_at : null,
    revoked_reason:
      raw.revoked_reason === "override" ||
      raw.revoked_reason === "manual_signout" ||
      raw.revoked_reason === "admin_forced" ||
      raw.revoked_reason === "flushed"
        ? raw.revoked_reason
        : null,
    flush_deadline_at:
      typeof raw.flush_deadline_at === "string" ? raw.flush_deadline_at : null,
    flushed_at: typeof raw.flushed_at === "string" ? raw.flushed_at : null,
    is_active: raw.is_active === true,
  };
}

export function parseDriverDeviceOverview(raw: unknown): DriverDeviceOverview | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const driverId = payload.driver_id;
  if (typeof driverId !== "string") return null;

  const activeRaw = payload.active_device;
  const activeDevice =
    activeRaw && typeof activeRaw === "object" && activeRaw !== null
      ? parseSessionRow(activeRaw as Record<string, unknown>)
      : null;

  const historyRaw = Array.isArray(payload.history) ? payload.history : [];
  const history = historyRaw
    .map((row) =>
      row && typeof row === "object" ? parseSessionRow(row as Record<string, unknown>) : null,
    )
    .filter((row): row is DriverDeviceSessionRow => row != null);

  return {
    driver_id: driverId,
    active_device_id:
      typeof payload.active_device_id === "string" ? payload.active_device_id : null,
    active_device: activeDevice,
    history,
  };
}

export function resolveDeviceSessionStatus(
  session: Pick<
    DriverDeviceSessionRow,
    "is_active" | "revoked_at" | "revoked_reason" | "flushed_at" | "flush_deadline_at"
  >,
): DeviceSessionStatus {
  if (session.is_active && !session.revoked_at) return "active";
  if (
    session.revoked_reason === "override" &&
    !session.flushed_at &&
    session.flush_deadline_at &&
    new Date(session.flush_deadline_at).getTime() > Date.now()
  ) {
    return "override_pending";
  }
  if (session.revoked_reason === "admin_forced") return "admin_forced";
  if (
    session.revoked_reason === "manual_signout" ||
    session.revoked_reason === "flushed" ||
    (session.revoked_reason === "override" && session.flushed_at)
  ) {
    return "signed_out";
  }
  return "inactive";
}

export function formatDeviceLabel(session: Pick<
  DriverDeviceSessionRow,
  "device_manufacturer" | "device_model" | "device_id"
>): string {
  const parts = [session.device_manufacturer, session.device_model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return session.device_id;
}

export function formatAppVersion(session: Pick<
  DriverDeviceSessionRow,
  "app_version_name" | "app_version_code"
>): string {
  if (session.app_version_name && session.app_version_code != null) {
    return `${session.app_version_name} (${session.app_version_code})`;
  }
  if (session.app_version_name) return session.app_version_name;
  if (session.app_version_code != null) return String(session.app_version_code);
  return "—";
}

export function formatOsVersion(session: Pick<
  DriverDeviceSessionRow,
  "os_version" | "android_sdk_int"
>): string {
  if (session.os_version && session.android_sdk_int != null) {
    return `Android ${session.os_version} (API ${session.android_sdk_int})`;
  }
  if (session.os_version) return `Android ${session.os_version}`;
  if (session.android_sdk_int != null) return `API ${session.android_sdk_int}`;
  return "—";
}
