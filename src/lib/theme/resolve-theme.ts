import {
  DEFAULT_THEME_ID,
  getPresetById,
  isPresetThemeId,
  type ThemeTokens,
} from "@/lib/theme/presets";

export type ResolvedTheme = {
  themeId: string;
  isPreset: boolean;
  name: string;
  lightTokens: Partial<ThemeTokens>;
  darkTokens: Partial<ThemeTokens>;
};

export type CustomThemeRow = {
  id: string;
  name: string;
  base_preset: string;
  light_tokens: Partial<ThemeTokens>;
  dark_tokens: Partial<ThemeTokens>;
};

export function resolveTheme(
  themeId: string | null | undefined,
  customThemes: CustomThemeRow[] = [],
): ResolvedTheme {
  const id = themeId?.trim() || DEFAULT_THEME_ID;

  if (isPresetThemeId(id)) {
    const preset = getPresetById(id)!;
    return {
      themeId: id,
      isPreset: true,
      name: preset.name,
      lightTokens: preset.lightTokens,
      darkTokens: preset.darkTokens,
    };
  }

  const custom = customThemes.find((t) => t.id === id);
  if (custom) {
    const base = getPresetById(
      isPresetThemeId(custom.base_preset) ? custom.base_preset : DEFAULT_THEME_ID,
    )!;
    return {
      themeId: custom.id,
      isPreset: false,
      name: custom.name,
      lightTokens: { ...base.lightTokens, ...custom.light_tokens },
      darkTokens: { ...base.darkTokens, ...custom.dark_tokens },
    };
  }

  const fallback = getPresetById(DEFAULT_THEME_ID)!;
  return {
    themeId: DEFAULT_THEME_ID,
    isPreset: true,
    name: fallback.name,
    lightTokens: fallback.lightTokens,
    darkTokens: fallback.darkTokens,
  };
}
