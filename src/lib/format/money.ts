/**
 * Kuwaiti dinar as the client reads it: one decimal, thousands separators,
 * Latin digits in both locales.
 *
 * `Intl` formats every magnitude as full digits, so a bad legacy value prints
 * `2,345,670,965,431,234,000,000.0` instead of `Number.prototype.toFixed`'s
 * `2.3456709654312343e+21` (toFixed switches to exponent notation at 1e21).
 */
const KWD = new Intl.NumberFormat("en-KW", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  numberingSystem: "latn",
  useGrouping: true,
});

const AXIS = new Intl.NumberFormat("en-KW", {
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
  numberingSystem: "latn",
});

const DASH = "\u2014";

function asNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** `1,250.5`. A missing or non-finite value prints an em dash. */
export function formatKwd(value: number | string | null | undefined): string {
  const n = asNumber(value);
  return n == null ? DASH : KWD.format(n);
}

/** Chart axis tick: `25`, `1.2K`, `3.4M` — never `4e+75`. */
export function formatKwdAxis(value: number | string | null | undefined): string {
  const n = asNumber(value);
  return n == null ? DASH : AXIS.format(n);
}
