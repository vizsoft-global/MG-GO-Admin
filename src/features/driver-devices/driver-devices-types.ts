/**
 * Row shape returned by `admin_list_driver_devices()`.
 *
 * One row per non-archived driver, joined to the device session their *current*
 * phone logged in with — so every device field is nullable: a driver who has
 * never opened the app, or whose session was revoked, still has a row, and
 * "no device data" is one of the states the page exists to surface.
 */

export type DriverDeviceSeverity = "critical" | "high" | "medium" | "low";

/**
 * The `device_meta` blob the app reports. Keys mirror `kDeviceProfileKeys` in
 * MG-GO `device_profile_service.dart`; the server allow-lists the same set, so
 * an unknown key here means the two have drifted rather than that a phone lied.
 */
export type DriverDeviceMeta = {
  model: string | null;
  manufacturer: string | null;
  brand: string | null;
  hardware: string | null;
  board: string | null;
  soc_model: string | null;
  soc_manufacturer: string | null;
  cpu_cores: number | null;
  ram_total_mb: number | null;
  ram_free_mb: number | null;
  is_low_ram: boolean | null;
  os_version: string | null;
  android_sdk_int: number | null;
  android_security_patch: string | null;
  supported_abis: string[] | null;
  is_physical_device: boolean | null;
  battery_pct: number | null;
  battery_health: string | null;
  battery_temp_c: number | null;
  charging_state: string | null;
  locale: string | null;
  collected_at: string | null;
};

export type DriverDeviceRow = {
  driver_id: string;
  driver_code: string;
  employee_id: string | null;
  full_name: string;
  phone: string | null;
  status: string;
  is_on_duty: boolean;
  is_blocked: boolean;
  avatar_object_key: string | null;
  zone_id: string | null;
  zone_name: string | null;
  active_device_id: string | null;
  session_id: string | null;
  device_model: string | null;
  device_manufacturer: string | null;
  os_version: string | null;
  android_sdk_int: number | null;
  app_version_name: string | null;
  app_version_code: number | null;
  device_meta: DriverDeviceMeta | null;
  device_meta_at: string | null;
  last_seen_at: string | null;
  first_seen_at: string | null;
  force_app_update_at: string | null;
  force_app_update_min_code: number | null;
};

/** A row with the client-side derivations the table sorts and filters on. */
export type DriverDeviceListRow = DriverDeviceRow & {
  severity: DriverDeviceSeverity;
  /** How many builds behind the latest known build this install is. */
  buildGap: number | null;
  outdated: boolean;
  lastSeenDays: number | null;
  hasDeviceData: boolean;
  forced: boolean;
  sentryEvents: number;
  sentryIssues: number;
};

export type DriverDevicesSnapshot = {
  minVersionCode: number | null;
  minVersionName: string | null;
  /** Highest build seen in the field — the effective "latest" the fleet knows. */
  latestVersionCode: number | null;
  rows: DriverDeviceRow[];
};

export type DriverDevicesTab =
  | "all"
  | "critical"
  | "high"
  | "outdated"
  | "latest"
  | "errors"
  | "no-device"
  | "forced";

export const DRIVER_DEVICES_TABS: readonly DriverDevicesTab[] = [
  "all",
  "critical",
  "high",
  "outdated",
  "latest",
  "errors",
  "no-device",
  "forced",
] as const;

export function parseDriverDevicesTab(value: string | null | undefined): DriverDevicesTab {
  return DRIVER_DEVICES_TABS.includes(value as DriverDevicesTab)
    ? (value as DriverDevicesTab)
    : "all";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseDeviceMeta(raw: unknown): DriverDeviceMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const abis = Array.isArray(m.supported_abis)
    ? m.supported_abis.filter((v): v is string => typeof v === "string")
    : null;
  const meta: DriverDeviceMeta = {
    model: text(m.model),
    manufacturer: text(m.manufacturer),
    brand: text(m.brand),
    hardware: text(m.hardware),
    board: text(m.board),
    soc_model: text(m.soc_model),
    soc_manufacturer: text(m.soc_manufacturer),
    cpu_cores: int(m.cpu_cores),
    ram_total_mb: int(m.ram_total_mb),
    ram_free_mb: int(m.ram_free_mb),
    is_low_ram: bool(m.is_low_ram),
    os_version: text(m.os_version),
    android_sdk_int: int(m.android_sdk_int),
    android_security_patch: text(m.android_security_patch),
    supported_abis: abis && abis.length > 0 ? abis : null,
    is_physical_device: bool(m.is_physical_device),
    battery_pct: int(m.battery_pct),
    battery_health: text(m.battery_health),
    battery_temp_c: num(m.battery_temp_c),
    charging_state: text(m.charging_state),
    locale: text(m.locale),
    collected_at: text(m.collected_at),
  };
  // An empty object is not a profile. Treated as absent so "no device data" stays
  // one state rather than splitting into "missing" and "reported nothing".
  return Object.values(meta).some((v) => v != null) ? meta : null;
}

function parseRow(raw: unknown): DriverDeviceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const driverId = text(r.driver_id);
  if (!driverId) return null;
  return {
    driver_id: driverId,
    driver_code: text(r.driver_code) ?? "",
    employee_id: text(r.employee_id),
    full_name: text(r.full_name) ?? "—",
    phone: text(r.phone),
    status: text(r.status) ?? "pending",
    is_on_duty: r.is_on_duty === true,
    is_blocked: r.is_blocked === true,
    avatar_object_key: text(r.avatar_object_key),
    zone_id: text(r.zone_id),
    zone_name: text(r.zone_name),
    active_device_id: text(r.active_device_id),
    session_id: text(r.session_id),
    device_model: text(r.device_model),
    device_manufacturer: text(r.device_manufacturer),
    os_version: text(r.os_version),
    android_sdk_int: int(r.android_sdk_int),
    app_version_name: text(r.app_version_name),
    app_version_code: int(r.app_version_code),
    device_meta: parseDeviceMeta(r.device_meta),
    device_meta_at: text(r.device_meta_at),
    last_seen_at: text(r.last_seen_at),
    first_seen_at: text(r.first_seen_at),
    force_app_update_at: text(r.force_app_update_at),
    force_app_update_min_code: int(r.force_app_update_min_code),
  };
}

export function parseDriverDevicesSnapshot(raw: unknown): DriverDevicesSnapshot {
  const empty: DriverDevicesSnapshot = {
    minVersionCode: null,
    minVersionName: null,
    latestVersionCode: null,
    rows: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const payload = raw as Record<string, unknown>;
  const rows = (Array.isArray(payload.rows) ? payload.rows : [])
    .map(parseRow)
    .filter((row): row is DriverDeviceRow => row != null);

  // "Latest" is the highest build actually observed in the field, not a number
  // an operator typed. The minimum is a policy the admin sets; the latest is a
  // fact about the fleet, and the build gap has to be measured against the fact
  // or it moves every time the policy is edited.
  let latest: number | null = null;
  for (const row of rows) {
    if (row.app_version_code != null && (latest == null || row.app_version_code > latest)) {
      latest = row.app_version_code;
    }
  }
  const minVersionCode = int(payload.min_version_code);
  if (minVersionCode != null && (latest == null || minVersionCode > latest)) {
    latest = minVersionCode;
  }

  return {
    minVersionCode,
    minVersionName: text(payload.min_version_name),
    latestVersionCode: latest,
    rows,
  };
}

/** Battery is worth flagging when the cell is degrading or running hot. */
export function batteryNeedsAttention(meta: DriverDeviceMeta | null): boolean {
  if (!meta) return false;
  if (meta.battery_health != null && meta.battery_health.toLowerCase() !== "good") return true;
  return meta.battery_temp_c != null && meta.battery_temp_c > 40;
}

export function formatRam(meta: DriverDeviceMeta | null): string {
  if (!meta?.ram_total_mb) return "—";
  const gb = meta.ram_total_mb / 1024;
  const total = gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${meta.ram_total_mb} MB`;
  if (meta.ram_free_mb == null) return total;
  const freeGb = meta.ram_free_mb / 1024;
  const free = freeGb >= 1 ? `${freeGb.toFixed(1)} GB` : `${meta.ram_free_mb} MB`;
  return `${total} · ${free} free`;
}

export function formatProcessor(meta: DriverDeviceMeta | null): string {
  if (!meta) return "—";
  const chip =
    meta.soc_model ??
    meta.hardware ??
    meta.board ??
    (meta.soc_manufacturer ? meta.soc_manufacturer : null);
  if (!chip) return meta.cpu_cores ? `${meta.cpu_cores} cores` : "—";
  return meta.cpu_cores ? `${chip} · ${meta.cpu_cores} cores` : chip;
}

export function formatDeviceName(row: DriverDeviceRow): string {
  const manufacturer = row.device_manufacturer ?? row.device_meta?.manufacturer ?? null;
  const model = row.device_model ?? row.device_meta?.model ?? null;
  const parts = [manufacturer, model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

export function formatAndroid(row: DriverDeviceRow): string {
  const release = row.os_version ?? row.device_meta?.os_version ?? null;
  const sdk = row.android_sdk_int ?? row.device_meta?.android_sdk_int ?? null;
  if (release && sdk != null) return `${release} (API ${sdk})`;
  if (release) return release;
  if (sdk != null) return `API ${sdk}`;
  return "—";
}

export function formatBuild(row: DriverDeviceRow): string {
  if (row.app_version_name && row.app_version_code != null) {
    return `${row.app_version_name} (${row.app_version_code})`;
  }
  if (row.app_version_name) return row.app_version_name;
  if (row.app_version_code != null) return `#${row.app_version_code}`;
  return "—";
}

export type DriverDevicesListResult = {
  minVersionCode: number | null;
  minVersionName: string | null;
  latestVersionCode: number | null;
  rows: DriverDeviceListRow[];
  sentryConnected: boolean;
  sentryReason?: string;
};
