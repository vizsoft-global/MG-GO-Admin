"use server";

import { updateTag } from "next/cache";
import { writeWithEpoch } from "@/lib/auth/auth-epochs";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { DEFAULT_THEME_ID, isPresetThemeId } from "@/lib/theme/presets";
import type { ThemeTokens } from "@/lib/theme/presets";

const THEMES = "app_themes";

async function requireManage() {
  const auth = await requireMutationAuth("settings.manage");
  if ("error" in auth) {
    return { error: auth.error === "not_configured" ? ("not_authenticated" as const) : auth.error };
  }
  return { session: auth.session };
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

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  if (!isPresetThemeId(id)) {
    const theme = await db.collection(THEMES).doc(id).get();
    if (!theme.exists) return { error: "theme_not_found" };
  }

  try {
    await writeWithEpoch(db, "settings", ({ tx }) => {
      tx.set(
        db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID),
        {
          theme_id: id,
          updated_at: new Date(),
          updated_by: auth.session.id,
        },
        { merge: true },
      );
    });
  } catch {
    return { error: "save_failed" };
  }

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

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const base = isPresetThemeId(input.basePreset) ? input.basePreset : DEFAULT_THEME_ID;
  const id = `custom-${crypto.randomUUID().slice(0, 8)}`;

  try {
    await db.collection(THEMES).doc(id).set({
      id,
      name,
      base_preset: base,
      light_tokens: input.lightTokens ?? {},
      dark_tokens: input.darkTokens ?? {},
      updated_at: new Date(),
    });
  } catch {
    return { error: "save_failed" };
  }

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

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.basePreset !== undefined) {
    patch.base_preset = isPresetThemeId(input.basePreset) ? input.basePreset : DEFAULT_THEME_ID;
  }
  if (input.lightTokens !== undefined) patch.light_tokens = input.lightTokens;
  if (input.darkTokens !== undefined) patch.dark_tokens = input.darkTokens;

  try {
    await db.collection(THEMES).doc(id).set(patch, { merge: true });
  } catch {
    return { error: "save_failed" };
  }

  invalidateThemeCaches();
  return { success: true };
}

export async function deleteCustomTheme(
  id: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireManage();
  if ("error" in auth) return auth;

  if (isPresetThemeId(id)) return { error: "cannot_delete_preset" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const settingsRef = db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID);
  const settings = await settingsRef.get();
  if (settings.data()?.theme_id === id) {
    await writeWithEpoch(db, "settings", ({ tx }) => {
      tx.set(
        settingsRef,
        { theme_id: DEFAULT_THEME_ID, updated_at: new Date() },
        { merge: true },
      );
    });
  }

  try {
    await db.collection(THEMES).doc(id).delete();
  } catch {
    return { error: "save_failed" };
  }

  invalidateThemeCaches();
  return { success: true };
}
