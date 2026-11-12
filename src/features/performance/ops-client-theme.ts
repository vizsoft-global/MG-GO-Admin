/**
 * Client themes for the Performance dashboard.
 *
 * The client's reference dashboard (MGHub Performance) paints the whole page from
 * one palette per client: a seven-shade ramp for charts, plus five surface
 * tokens (page canvas, title ink, KPI/button ink, tint, and a second border).
 * Americana is blue, Keeta is gold, and "All clients" is the neutral slate.
 *
 * The previous version carried two colours per client and only reached the header
 * bar, so "apply the theme across the entire page" was ~5% done. Every token is
 * exported as a CSS custom property here (`--ops-c1` … `--ops-c7`, `--ops-bg`,
 * `--ops-title`, `--ops-ink`, `--ops-soft`, `--ops-line`) and the shell puts them
 * on one wrapper, which is what lets cards, buttons, chart cards, titles and
 * table headers all follow the selected client without a prop on every node.
 *
 * Colours are the values from the client's own Power BI dashboards. They are
 * deliberately NOT derived from a brand hex: Americana's brand red is not the
 * blue the client asked for, and Keeta's orange is not the gold.
 */
export type OpsClientKey = "all" | "americana" | "keeta";

export type OpsClientPalette = {
  /** Seven steps, darkest (highest value) to lightest. Charts use this whole ramp. */
  ramp: readonly [string, string, string, string, string, string, string];
  /** Page canvas behind every card. */
  bg: string;
  /** Title / heading ink. */
  title: string;
  /** KPI figures, primary buttons, selected chips, table header rule. */
  ink: string;
  /** Tint used by "new" KPI cards and selected filter boxes. */
  soft: string;
  /** Second-level border (selected / accent surfaces). */
  line: string;
  /** Wordmark shown when no logo image resolves. */
  shortLabel: string;
};

const NEUTRAL = {
  ramp: ["#2f3b4f", "#3f4f68", "#556781", "#70839c", "#93a3b8", "#b8c3d1", "#d8dee7"],
  bg: "#f1f2f3",
  title: "#2f3b4f",
  ink: "#3f4f68",
  soft: "#eef1f5",
  line: "#cfd6e0",
  shortLabel: "ALL CLIENTS",
} as const;

const AMERICANA = {
  ramp: ["#1b4f8f", "#22669f", "#2e7fbf", "#4f9bd3", "#7ab6e1", "#a7d0ec", "#d2e5f6"],
  bg: "#eef1f6",
  title: "#1f4e9c",
  ink: "#2060b0",
  soft: "#e8f0fa",
  line: "#bcd6ef",
  shortLabel: "AMERICANA",
} as const;

const KEETA = {
  ramp: ["#7a6210", "#9a7c14", "#b4951f", "#c9ae4a", "#dbc781", "#e8dcad", "#f3ecd3"],
  bg: "#f4f2ea",
  title: "#6b5410",
  ink: "#a8891a",
  soft: "#faf5e4",
  line: "#e3d6a4",
  shortLabel: "KEETA",
} as const;

export const OPS_CLIENT_PALETTES: Record<OpsClientKey, OpsClientPalette> = {
  all: NEUTRAL,
  americana: AMERICANA,
  keeta: KEETA,
};

/**
 * Legacy shape, kept because the shell and a couple of call sites still read
 * `handled`/`accent`. `header` is the page title ink and `accent` the KPI ink, so
 * an old consumer keeps painting in the right family instead of a stale red.
 */
export const CLIENT_THEME_BY_KEY = {
  americana: { header: AMERICANA.title, accent: AMERICANA.ink },
  keeta: { header: KEETA.title, accent: KEETA.ink },
  default: { header: NEUTRAL.title, accent: NEUTRAL.ink },
} as const;

export type OpsClientTheme = {
  /** Which palette resolved. `all` when zero or several clients are selected. */
  key: OpsClientKey;
  palette: OpsClientPalette;
  /** Legacy: page title ink. */
  header: string;
  /** Legacy: KPI / primary ink. */
  accent: string;
  logoUrl: string | null;
  /** Wordmark printed when the logo image fails or no client is selected. */
  shortLabel: string;
};

/**
 * A logo that can go straight into `<img src>`.
 *
 * Only an absolute http(s) URL is accepted here. An R2 object key is NOT a URL,
 * and returning one produced a broken image with no error — which is exactly why
 * a stored `partners/{key}/logo.png` seemed to silently disappear. The read path
 * signs keys before they reach this module (see `resolveOpsClientLogoUrl` in
 * `performance-actions.ts`); anything else returns null so the caller falls back
 * to the wordmark rather than rendering a broken icon.
 */
export function publicLogoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function clientKeyOf(raw: string): OpsClientKey {
  const key = raw.trim().toLowerCase();
  if (key === "americana") return "americana";
  if (key === "keeta") return "keeta";
  return "all";
}

/**
 * The palette for the current client selection.
 *
 * A theme needs exactly one client. All / several selections keep the neutral
 * slate, because a page tinted for one client while showing two is a lie about
 * what the reader is looking at.
 */
export function resolveOpsClientTheme(input: {
  projectKeys: readonly string[];
  partners?: readonly { key: string; logo_url?: string | null }[];
}): OpsClientTheme {
  const unique = Array.from(
    new Set(input.projectKeys.map((key) => key.trim().toLowerCase()).filter(Boolean)),
  );
  const single = unique.length === 1 ? unique[0]! : "";
  const key = clientKeyOf(single);
  const palette = OPS_CLIENT_PALETTES[key];

  let logoUrl: string | null = null;
  if (key !== "all") {
    const partner = (input.partners ?? []).find(
      (row) => row.key.trim().toLowerCase() === key,
    );
    logoUrl = publicLogoSrc(partner?.logo_url);
  }

  return {
    key,
    palette,
    header: palette.title,
    accent: palette.ink,
    logoUrl,
    shortLabel: palette.shortLabel,
  };
}

/** The CSS custom properties the shell spreads onto its wrapper. */
export function opsThemeStyleVars(palette: OpsClientPalette): Record<string, string> {
  const vars: Record<string, string> = {
    "--ops-bg": palette.bg,
    "--ops-title": palette.title,
    "--ops-ink": palette.ink,
    "--ops-soft": palette.soft,
    "--ops-line": palette.line,
  };
  palette.ramp.forEach((color, index) => {
    vars[`--ops-c${index + 1}`] = color;
  });
  // Legacy aliases, so a call site that still reads them keeps a themed colour.
  vars["--ops-header"] = palette.title;
  vars["--ops-accent"] = palette.ink;
  return vars;
}

/**
 * A chart series colour on the client ramp.
 *
 * `index` is the series' position in a ranked list, `count` the list length, so
 * the darkest step is the highest value and the ramp lightens down the ranking —
 * the reference dashboard's own rule. A single bar takes the second step rather
 * than the darkest, so one category does not read as "the only good one".
 *
 * Returns a CSS variable with the palette's own step as the fallback, which is
 * what lets a recharts `fill` follow the theme without re-rendering the chart.
 */
export function opsRampColorFor(
  palette: OpsClientPalette,
  index: number,
  count: number,
): string {
  const ramp = palette.ramp;
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1;
  const step = safeCount <= 1
    ? 1
    : Math.min(ramp.length - 1, Math.max(0, Math.round((index / (safeCount - 1)) * (ramp.length - 1))));
  return `var(--ops-c${step + 1}, ${ramp[step]})`;
}
