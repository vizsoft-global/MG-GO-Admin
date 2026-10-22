import type { DriverRiderCategory } from "./types";

/** Row of `public.source_companies`. `client_code` is the company's Client ID. */
export type SourceCompany = {
  key: string;
  name: string;
  client_code: string | null;
  is_active: boolean;
  is_system: boolean;
  /** R2 object key `source_companies/{key}/logo.{ext}`, or null when none. */
  logo_url: string | null;
  /** Presigned URL resolved on the server; never stored. */
  logo_display_url?: string | null;
  sort_order: number;
  dpd_target: number | null;
  incentive_enabled: boolean;
  incentive_above_kwd: number | null;
  incentive_below_kwd: number | null;
  effective_from: string | null;
};

export type SourceCompanyWithUsage = SourceCompany & { driver_count: number };

export const COMPANY_KEY_RE = /^[a-z0-9_]{1,24}$/;
export const CLIENT_CODE_RE = /^[A-Z0-9-]{1,32}$/;

export function normalizeClientCode(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return v || null;
}

/**
 * Arabic letters that carry no Latin form under NFKD. Transliterating them
 * keeps a readable key ("شركة توصيل" → "shrkh_tsyl") instead of an opaque hash.
 */
const ARABIC_KEY_LETTERS: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "a",
  آ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ى: "a",
  ة: "h",
  ء: "",
  ئ: "y",
  ؤ: "w",
};

function transliterateArabic(value: string): string {
  let out = "";
  for (const char of value) out += ARABIC_KEY_LETTERS[char] ?? char;
  return out;
}

/** Stable FNV-1a hash, base36. Only used when a name has no usable letters at all. */
function hashKeySource(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Derives a key from a new company's name: "Al Sadeeq Co." → "al_sadeeq_co".
 * Non-Latin names are transliterated, and a name with no usable characters
 * falls back to a stable `co_<hash>` so a new company is never rejected just
 * because its script is not A–Z.
 */
export function companyKeyFromName(name: string): string {
  const raw = name.trim();
  const ascii = raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  const slug = transliterateArabic(ascii)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return `co_${hashKeySource(raw || "company")}`.slice(0, 24);
  if (slug.length <= 24) return slug;
  // Two long names that share the first 24 characters would otherwise derive the
  // same key, and the second one would be refused as "already exists".
  const stem = slug.slice(0, 19).replace(/_+$/g, "");
  return `${stem}_${hashKeySource(raw).slice(0, 4)}`;
}

/**
 * Sheet / form input → company key. Matches key, name or Client ID
 * (case-insensitive). Inactive companies do not match. Blank is null.
 */
export function resolveCompanyInput(
  raw: string | null | undefined,
  companies: readonly SourceCompany[],
): string | null | "invalid" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const hit = companies.find(
    (c) =>
      c.is_active &&
      (c.key === value ||
        c.name.trim().toLowerCase() === value ||
        (c.client_code ?? "").toLowerCase() === value),
  );
  return hit ? hit.key : "invalid";
}

/**
 * In-house riders belong to the system company (MG); outsourced riders to a
 * non-system one or none (Unassigned).
 */
export function companyMatchesCategory(
  riderCategory: DriverRiderCategory,
  companyKey: string | null,
  companies: readonly SourceCompany[],
): boolean {
  if (!companyKey) return true;
  const company = companies.find((c) => c.key === companyKey);
  if (!company) return false;
  return riderCategory === "in_house" ? company.is_system : !company.is_system;
}

/** Companies an operator may pick for this category (current value kept even if inactive). */
export function selectableCompanies(
  riderCategory: DriverRiderCategory,
  companies: readonly SourceCompany[],
  currentKey: string | null,
): SourceCompany[] {
  return companies.filter(
    (c) =>
      (c.is_active || c.key === currentKey) &&
      (riderCategory === "in_house" ? c.is_system : !c.is_system),
  );
}

/** Flat above/below per-order scheme result (mirrors `compute_source_company_incentive` SQL). */
export type SourceCompanyScheme = {
  incentiveKwd: number;
  deductionKwd: number;
  netKwd: number;
};

/**
 * Flat above/below per-order incentive. Above target pays `(n - T) * above`;
 * below target deducts `(T - n) * below`; n = 0 with a scheme is a full
 * deduction `T * below`. Mirrors `compute_source_company_incentive` (SQL
 * `numeric(10,3)`), so results are rounded to 3 decimals.
 */
export function computeSourceCompanyIncentive(
  orders: number,
  target: number,
  aboveKwd: number | null | undefined,
  belowKwd: number | null | undefined,
): SourceCompanyScheme {
  const n = Math.max(0, orders);
  const above = aboveKwd ?? 0;
  const below = belowKwd ?? 0;
  const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
  const incentiveKwd = n > target ? (n - target) * above : 0;
  const deductionKwd = n < target ? (target - n) * below : 0;
  return {
    incentiveKwd: round3(incentiveKwd),
    deductionKwd: round3(deductionKwd),
    netKwd: round3(incentiveKwd - deductionKwd),
  };
}

/** Parses a positive integer DPD target from a form string; null when blank or invalid. */
export function parseDpdTarget(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parses a positive KWD rate from a form string; null when blank or invalid. */
export function parseRateKwd(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type SourceCompanySchemeError =
  | "invalid_dpd_target"
  | "invalid_incentive_rate"
  | "incentive_effective_from_required";

/**
 * Client-side mirror of the RPC validation, so the form and the preview agree
 * with the server before the request is sent.
 */
export function validateSourceCompanyScheme(input: {
  dpdTarget: string;
  incentiveEnabled: boolean;
  aboveKwd: string;
  belowKwd: string;
  effectiveFrom: string;
}): SourceCompanySchemeError | null {
  const target = parseDpdTarget(input.dpdTarget);
  if (input.dpdTarget.trim() !== "" && target === null) return "invalid_dpd_target";
  if (!input.incentiveEnabled) return null;
  if (target === null) return "invalid_dpd_target";
  if (parseRateKwd(input.aboveKwd) === null) return "invalid_incentive_rate";
  if (parseRateKwd(input.belowKwd) === null) return "invalid_incentive_rate";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return "incentive_effective_from_required";
  return null;
}
