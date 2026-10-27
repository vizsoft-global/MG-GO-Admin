export const CLIENT_THEME_BY_KEY = {
  americana: { header: "#C8102E", accent: "#1B365D" },
  keeta: { header: "#FF6A00", accent: "#111111" },
  default: { header: "#27273F", accent: "#A73C24" },
} as const;

export type OpsClientTheme = {
  header: string;
  accent: string;
  logoUrl: string | null;
};

export function publicLogoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function paletteFor(key: string): { header: string; accent: string } {
  switch (key) {
    case "americana":
      return CLIENT_THEME_BY_KEY.americana;
    case "keeta":
      return CLIENT_THEME_BY_KEY.keeta;
    default:
      return CLIENT_THEME_BY_KEY.default;
  }
}

export function resolveOpsClientTheme(input: {
  projectKeys: readonly string[];
  partners?: readonly { key: string; logo_url?: string | null }[];
}): OpsClientTheme {
  const unique = Array.from(
    new Set(input.projectKeys.map((key) => key.trim().toLowerCase()).filter(Boolean)),
  );
  const selected = unique.length === 1 ? unique[0]! : "";
  const palette = paletteFor(selected);
  let logoUrl: string | null = null;
  if (selected) {
    const partner = (input.partners ?? []).find(
      (row) => row.key.trim().toLowerCase() === selected,
    );
    logoUrl = publicLogoSrc(partner?.logo_url);
  }
  return { header: palette.header, accent: palette.accent, logoUrl };
}
