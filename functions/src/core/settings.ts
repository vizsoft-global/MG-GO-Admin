import { getFirestore } from "./fs";
import { COLLECTIONS } from "./collections";
import { createConfigCache } from "./config-cache";

const APP_SETTINGS_DOC_ID = "1";

export type AppSettings = {
  attendance_late_grace_minutes: number;
  attendance_early_out_grace_minutes: number;
  attendance_gps_stale_minutes: number;
  attendance_gps_min_accuracy_meters: number;
  delivery_ontime_minutes: number;
  incentive_band_math_from: string | null;
  payroll_zone_efficiency_good: number;
  payroll_zone_efficiency_low: number;
};

const DEFAULTS: AppSettings = {
  attendance_late_grace_minutes: 10,
  attendance_early_out_grace_minutes: 5,
  attendance_gps_stale_minutes: 10,
  attendance_gps_min_accuracy_meters: 100,
  delivery_ontime_minutes: 45,
  incentive_band_math_from: null,
  payroll_zone_efficiency_good: 110,
  payroll_zone_efficiency_low: 70,
};

/**
 * `app_settings` is read with the same defaults the SQL used in its `settings`
 * CTE, so a missing doc produces the pre-migration behaviour rather than zeros.
 * A zero grace period would mark the whole fleet late, which is the one way this
 * read can be wrong loudly.
 */
export async function loadAppSettings(): Promise<AppSettings> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      (out as Record<string, unknown>)[key] = value;
    } else if (typeof value === "string" && key === "incentive_band_math_from") {
      out.incentive_band_math_from = value;
    }
  }
  return out;
}

/**
 * `app_settings/1.home_snapshot_enabled` (serve the snapshot) and
 * `home_snapshot_shadow` (compute both and log mismatches).
 *
 * Two deliberate choices:
 *
 * * **Default off.** A missing document, a missing key or a non-boolean value is
 *   `false`. Turning the snapshot on is an explicit write, so a fresh
 *   environment keeps the 25-document path it was last verified on.
 * * **Epoch-keyed isolate cache.** `loadAppSettings` is read with the numeric
 *   map above; a boolean would be silently dropped by it, so the flags get their
 *   own reader. They are cached under `auth_epochs/current.config`, which the
 *   panel already bumps on a settings edit, so flipping a flag takes effect on
 *   the next call without adding a read to every Home call.
 */
export type HomeSnapshotFlags = { enabled: boolean; shadow: boolean };

const homeSnapshotFlags = createConfigCache<HomeSnapshotFlags>();

export async function loadHomeSnapshotFlags(configEpoch = 0): Promise<HomeSnapshotFlags> {
  try {
    return await homeSnapshotFlags.get(configEpoch, async () => {
      const snap = await getFirestore()
        .collection(COLLECTIONS.appSettings)
        .doc(APP_SETTINGS_DOC_ID)
        .get();
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      return {
        enabled: data["home_snapshot_enabled"] === true,
        shadow: data["home_snapshot_shadow"] === true,
      };
    });
  } catch {
    return { enabled: false, shadow: false };
  }
}

export async function loadHomeSnapshotEnabled(configEpoch = 0): Promise<boolean> {
  return (await loadHomeSnapshotFlags(configEpoch)).enabled;
}
