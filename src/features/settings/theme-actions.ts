"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { DEFAULT_THEME_ID, isPresetThemeId } from "@/lib/theme/presets";
import type { ThemeTokens } from "@/lib/theme/presets";

async function requireManage() {
  const session = await getSessionUser();
  if (!session) return { error: "not_authenticated" as const };
  if (!hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function invalidateThemeCaches() {
  updateTag("app-settings");
  updateTag("app-theme");
}

export async function setActiveTheme(
  themeId: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireManage();
  if ("error" in auth) return auth;

  const id = themeId.trim();
  if (!id) return { error: "invalid_theme" };

  const supabase = await createClient();

  if (!isPresetThemeId(id)) {
    const { data } = await supabase.from("app_themes").select("id").eq("id", id).maybeSingle();
    if (!data) return { error: "theme_not_found" };
  }

  const { error } = await supabase
    .from("app_settings")
    .update({
      theme_id: id,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    })
    .eq("id", 1);

  if (error) return { error: "save_failed" };
  invalidateThemeCaches();
  return { success: true };
}

export async function createCustomTheme(input: {
  name: string;
  basePreset: string;
  lightTokens?: Partial<ThemeTokens>;
  darkTokens?: Partial<ThemeTokens>;
}): Promise<{ error?: string; success?: boolean; id?: string }> {
  const auth = await requireManage();
  if ("error" in auth) return auth;

  const name = input.name.trim();
  if (!name) return { error: "missing_name" };

  const base = isPresetThemeId(input.basePreset) ? input.basePreset : DEFAULT_THEME_ID;
  const id = `custom-${crypto.randomUUID().slice(0, 8)}`;

  const supabase = await createClient();
  const { error } = await supabase.from("app_themes").insert({
    id,
    name,
    base_preset: base,
    light_tokens: input.lightTokens ?? {},
    dark_tokens: input.darkTokens ?? {},
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: "save_failed" };
  invalidateThemeCaches();
  return { success: true, id };
}

export async function updateCustomTheme(
  id: string,
  input: {
    name?: string;
    basePreset?: string;
    lightTokens?: Partial<ThemeTokens>;
    darkTokens?: Partial<ThemeTokens>;
  },
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireManage();
  if ("error" in auth) return auth;

  if (isPresetThemeId(id)) return { error: "cannot_edit_preset" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_themes")
    .update({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.basePreset !== undefined
        ? {
            base_preset: isPresetThemeId(input.basePreset)
              ? input.basePreset
              : DEFAULT_THEME_ID,
          }
        : {}),
      ...(input.lightTokens !== undefined ? { light_tokens: input.lightTokens } : {}),
      ...(input.darkTokens !== undefined ? { dark_tokens: input.darkTokens } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: "save_failed" };
  invalidateThemeCaches();
  return { success: true };
}

export async function deleteCustomTheme(
  id: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireManage();
  if ("error" in auth) return auth;

  if (isPresetThemeId(id)) return { error: "cannot_delete_preset" };

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("theme_id")
    .eq("id", 1)
    .maybeSingle();

  if (settings?.theme_id === id) {
    await supabase
      .from("app_settings")
      .update({ theme_id: DEFAULT_THEME_ID, updated_at: new Date().toISOString() })
      .eq("id", 1);
  }

  const { error } = await supabase.from("app_themes").delete().eq("id", id);

  if (error) return { error: "save_failed" };
  invalidateThemeCaches();
  return { success: true };
}
