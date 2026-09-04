import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withDeadline } from "@/lib/supabase/deadline";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_DRIVER_APP_SETTINGS,
  type FontFamilyId,
  type LogoType,
  isFontFamilyId,
} from "@/lib/branding/constants";
import { DEFAULT_THEME_ID } from "@/lib/theme/presets";
import {
  resolveTheme,
  type CustomThemeRow,
} from "@/lib/theme/resolve-theme";
import type { ResolvedTheme } from "@/lib/theme/resolve-theme";
import type { ThemeTokens } from "@/lib/theme/presets";

export type AppThemeRecord = {
  id: string;
  name: string;
  basePreset: string;
  lightTokens: Partial<ThemeTokens>;
  darkTokens: Partial<ThemeTokens>;
};

export type AppSettings = {
  appName: string;
  appSubtitle: string;
  driverAppLoginHint: string;
  driverAppTitle: string;
  driverAppLogoUrl: string | null;
  driverAppSplashUrl: string | null;
  driverAppIconUrl: string | null;
  driverAppMaintenanceMode: boolean;
  driverAppMaintenanceMessage: string;
  driverAppLoginVerificationExemptAll: boolean;
  driverAppDeliveryProximityMeters: number;
  driverAppForceUpdate: boolean;
  driverAppMinVersionCode: number | null;
  driverAppMinVersionName: string | null;
  driverAppUpdateMessage: string | null;
  fontFamily: FontFamilyId;
  logoUrl: string | null;
  logoType: LogoType;
  themeId: string;
  theme: ResolvedTheme;
  customThemes: AppThemeRecord[];
};

function parseTokens(json: unknown): Partial<ThemeTokens> {
  if (!json || typeof json !== "object") return {};
  return json as Partial<ThemeTokens>;
}

function normalizeRow(
  row: {
    app_name: string;
    app_subtitle: string;
    driver_app_login_hint?: string | null;
    driver_app_title?: string | null;
    driver_app_logo_url?: string | null;
    driver_app_splash_url?: string | null;
    driver_app_icon_url?: string | null;
    driver_app_maintenance_mode?: boolean | null;
    driver_app_maintenance_message?: string | null;
    driver_app_login_verification_exempt_all?: boolean | null;
    driver_app_delivery_proximity_meters?: number | null;
    driver_app_force_update?: boolean | null;
    driver_app_min_version_code?: number | null;
    driver_app_min_version_name?: string | null;
    driver_app_update_message?: string | null;
    font_family: string;
    logo_url: string | null;
    logo_type: string;
    theme_id?: string | null;
  },
  customThemes: AppThemeRecord[],
): Omit<AppSettings, "theme"> & { themeId: string } {
  return {
    appName: row.app_name,
    appSubtitle: row.app_subtitle,
    driverAppLoginHint:
      row.driver_app_login_hint?.trim() ||
      "Enter your ID and passcode from admin",
    driverAppTitle:
      row.driver_app_title?.trim() || DEFAULT_DRIVER_APP_SETTINGS.driver_app_title,
    driverAppLogoUrl: row.driver_app_logo_url ?? null,
    driverAppSplashUrl: row.driver_app_splash_url ?? null,
    driverAppIconUrl: row.driver_app_icon_url ?? null,
    driverAppMaintenanceMode: row.driver_app_maintenance_mode ?? false,
    driverAppMaintenanceMessage:
      row.driver_app_maintenance_message?.trim() ||
      DEFAULT_DRIVER_APP_SETTINGS.driver_app_maintenance_message,
    driverAppLoginVerificationExemptAll:
      row.driver_app_login_verification_exempt_all ?? false,
    driverAppDeliveryProximityMeters:
      row.driver_app_delivery_proximity_meters ??
      DEFAULT_DRIVER_APP_SETTINGS.driver_app_delivery_proximity_meters,
    driverAppForceUpdate: row.driver_app_force_update ?? false,
    driverAppMinVersionCode: row.driver_app_min_version_code ?? null,
    driverAppMinVersionName: row.driver_app_min_version_name?.trim() || null,
    driverAppUpdateMessage: row.driver_app_update_message?.trim() || null,
    fontFamily: isFontFamilyId(row.font_family) ? row.font_family : "inter",
    logoUrl: row.logo_url,
    logoType: row.logo_type === "svg" ? "svg" : "image",
    themeId: row.theme_id?.trim() || DEFAULT_THEME_ID,
    customThemes,
  };
}

const BRANDING_BUDGET_MS = 5_000;

async function fetchCustomThemes(): Promise<AppThemeRecord[]> {
  try {
    const supabase = await createClient({ timeoutMs: BRANDING_BUDGET_MS });
    const { data, error } = await supabase
      .from("app_themes")
      .select("id, name, base_preset, light_tokens, dark_tokens")
      .order("name");

    if (error) {
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      basePreset: row.base_preset,
      lightTokens: parseTokens(row.light_tokens),
      darkTokens: parseTokens(row.dark_tokens),
    }));
  } catch {
    return [];
  }
}

const getCustomThemes = cache(fetchCustomThemes);

const APP_SETTINGS_SELECT =
  "app_name, app_subtitle, driver_app_login_hint, driver_app_title, driver_app_logo_url, driver_app_splash_url, driver_app_icon_url, driver_app_maintenance_mode, driver_app_maintenance_message, driver_app_login_verification_exempt_all, driver_app_delivery_proximity_meters, driver_app_force_update, driver_app_min_version_code, driver_app_min_version_name, driver_app_update_message, font_family, logo_url, logo_type, theme_id";

async function loadAppSettingsRow(): Promise<{
  app_name: string;
  app_subtitle: string;
  driver_app_login_hint?: string | null;
  driver_app_title?: string | null;
  driver_app_logo_url?: string | null;
  driver_app_splash_url?: string | null;
  driver_app_icon_url?: string | null;
  driver_app_maintenance_mode?: boolean | null;
  driver_app_maintenance_message?: string | null;
  driver_app_login_verification_exempt_all?: boolean | null;
  driver_app_delivery_proximity_meters?: number | null;
  driver_app_force_update?: boolean | null;
  driver_app_min_version_code?: number | null;
  driver_app_min_version_name?: string | null;
  driver_app_update_message?: string | null;
  font_family: string;
  logo_url: string | null;
  logo_type: string;
  theme_id?: string | null;
} | null> {
  try {
    const supabase = await createClient({ timeoutMs: BRANDING_BUDGET_MS });
    let { data, error } = await supabase
      .from("app_settings")
      .select(APP_SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (error?.code === "42703") {
      ({ data, error } = await supabase
        .from("app_settings")
        .select("app_name, app_subtitle, font_family, logo_url, logo_type")
        .eq("id", 1)
        .maybeSingle());
    }

    if (!error && data) return data;
  } catch {
    /* fall through to service role */
  }

  try {
    const admin = createAdminClient({ timeoutMs: BRANDING_BUDGET_MS });
    const { data, error } = await admin
      .from("app_settings")
      .select(APP_SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (!error && data) return data;
  } catch {
    /* use defaults */
  }

  return null;
}

/**
 * Branding is on the critical path of every rendered page — the locale layout
 * is force-dynamic — so it may never be the reason a page does not paint.
 * Falling back to the default logo and name during a backend outage is a
 * cosmetic regression for the length of the outage; hanging is an outage of
 * its own, and it is what made every page load take a minute.
 */
async function fetchAppSettings(): Promise<AppSettings> {
  // Independent reads, so they cost one round trip rather than two. The row
  // read carries its own service-role retry, which shares this budget.
  const [customThemes, data] = await Promise.all([
    withDeadline(getCustomThemes(), BRANDING_BUDGET_MS, () => []),
    withDeadline(loadAppSettingsRow(), BRANDING_BUDGET_MS, () => null),
  ]);

  const customRows: CustomThemeRow[] = customThemes.map((t) => ({
    id: t.id,
    name: t.name,
    base_preset: t.basePreset,
    light_tokens: t.lightTokens,
    dark_tokens: t.darkTokens,
  }));

  if (!data) {
    const themeId = DEFAULT_THEME_ID;
    return {
      appName: DEFAULT_APP_SETTINGS.app_name,
      appSubtitle: DEFAULT_APP_SETTINGS.app_subtitle,
      driverAppLoginHint: "Enter your ID and passcode from admin",
      driverAppTitle: DEFAULT_DRIVER_APP_SETTINGS.driver_app_title,
      driverAppLogoUrl: null,
      driverAppSplashUrl: null,
      driverAppIconUrl: null,
      driverAppMaintenanceMode: false,
      driverAppMaintenanceMessage:
        DEFAULT_DRIVER_APP_SETTINGS.driver_app_maintenance_message,
      driverAppLoginVerificationExemptAll: false,
      driverAppDeliveryProximityMeters:
        DEFAULT_DRIVER_APP_SETTINGS.driver_app_delivery_proximity_meters,
      driverAppForceUpdate: false,
      driverAppMinVersionCode: null,
      driverAppMinVersionName: null,
      driverAppUpdateMessage: null,
      fontFamily: DEFAULT_APP_SETTINGS.font_family,
      logoUrl: DEFAULT_APP_SETTINGS.logo_url,
      logoType: DEFAULT_APP_SETTINGS.logo_type,
      themeId,
      customThemes,
      theme: resolveTheme(themeId, customRows),
    };
  }

  const base = normalizeRow(data, customThemes);
  return {
    ...base,
    theme: resolveTheme(base.themeId, customRows),
  };
}

/** Per-request cache only — avoids stale logos after branding upload. */
export const getAppSettings = cache(fetchAppSettings);
