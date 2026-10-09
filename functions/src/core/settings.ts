import { getFirestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "./collections";

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
