const PREFIX_END = "\uf8ff";

export function lowerText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function digitsOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

export function prefixBounds(term: string): { start: string; end: string } | null {
  const start = lowerText(term);
  if (!start) return null;
  return { start, end: `${start}${PREFIX_END}` };
}

const TOKEN_SPLIT = /[\s,./|+\-_()]+/;

function startsAtWord(text: string, term: string): boolean {
  let from = 0;
  while (from <= text.length - term.length) {
    if (text.startsWith(term, from)) return true;
    const next = text.indexOf(" ", from);
    if (next < 0) return false;
    from = next + 1;
  }
  return false;
}

/** Prefix of a whitespace-bounded span, or of one punctuation-stripped token. */
export function tokenPrefixMatch(haystack: string, needle: string): boolean {
  const term = lowerText(needle);
  if (!term) return true;
  const text = lowerText(haystack);
  if (!text) return false;
  if (startsAtWord(text, term)) return true;
  return text.split(TOKEN_SPLIT).some((token) => token.length > 0 && token.startsWith(term));
}

export function anyTokenPrefix(fields: readonly (string | null | undefined)[], needle: string): boolean {
  return fields.some((field) => tokenPrefixMatch(field ?? "", needle));
}

function put(out: Record<string, string>, key: string, value: string): void {
  if (value) out[key] = value;
}

export type DriverSearchInput = {
  fullName?: unknown;
  name?: unknown;
  driverCode?: unknown;
  employeeId?: unknown;
  phone?: unknown;
  clientId?: unknown;
  clientName?: unknown;
  zoneName?: unknown;
  partnerName?: unknown;
  companyName?: unknown;
};

/** Lowercase fields written on driver / intake create and update. Empty inputs are omitted. */
export function driverSearchStamp(input: DriverSearchInput): Record<string, string> {
  const out: Record<string, string> = {};
  const name = lowerText(input.fullName) || lowerText(input.name);
  const code = lowerText(input.driverCode);
  const employee = lowerText(input.employeeId);
  const clientId = lowerText(input.clientId);
  const clientName = lowerText(input.clientName);
  const zone = lowerText(input.zoneName);
  const partner = lowerText(input.partnerName);
  const company = lowerText(input.companyName);
  const phone = digitsOnly(typeof input.phone === "string" ? input.phone : "");
  put(out, "name_lower", name);
  put(out, "driver_code_lower", code);
  put(out, "employee_id_lower", employee);
  put(out, "client_id_lower", clientId);
  put(out, "client_name_lower", clientName);
  put(out, "zone_name_lower", zone);
  put(out, "partner_name_lower", partner);
  put(out, "company_name_lower", company);
  put(out, "phone_digits", phone);
  const identity = [name, code, employee, clientName, clientId, zone, partner, company].filter(Boolean);
  if (identity.length > 0) {
    out.search_name = [...identity, phone].filter(Boolean).join(" ");
  }
  return out;
}

export function catalogNameStamp(name: unknown, merchantId?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const lower = lowerText(name);
  const merchant = lowerText(merchantId);
  put(out, "name_lower", lower);
  put(out, "merchant_id_lower", merchant);
  const search = [lower, merchant].filter(Boolean).join(" ");
  if (search) out.search_name = search;
  return out;
}

export function requestSearchStamp(input: {
  requestCode?: unknown;
  driverName?: unknown;
  driverCode?: unknown;
  employeeId?: unknown;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const code = lowerText(input.requestCode);
  const name = lowerText(input.driverName);
  const driverCode = lowerText(input.driverCode);
  const employee = lowerText(input.employeeId);
  put(out, "request_code_lower", code);
  put(out, "driver_name_lower", name);
  put(out, "driver_code_lower", driverCode);
  put(out, "employee_id_lower", employee);
  const identity = [code, name, driverCode, employee].filter(Boolean);
  if (identity.length > 0) out.search_name = identity.join(" ");
  return out;
}

export const DRIVER_PREFIX_FIELDS = [
  "name_lower",
  "driver_code_lower",
  "employee_id_lower",
  "client_id_lower",
  "client_name_lower",
  "zone_name_lower",
  "partner_name_lower",
  "company_name_lower",
  "search_name",
] as const;

export const REQUEST_PREFIX_FIELDS = [
  "request_code_lower",
  "driver_name_lower",
  "driver_code_lower",
  "employee_id_lower",
  "search_name",
] as const;

export function driverPrefixQueries(term: string): { field: string; term: string }[] {
  const text = lowerText(term);
  if (!text) return [];
  const queries: { field: string; term: string }[] = DRIVER_PREFIX_FIELDS.map((field) => ({
    field,
    term: text,
  }));
  const digits = digitsOnly(term);
  if (digits) queries.push({ field: "phone_digits", term: digits });
  return queries;
}

export function requestPrefixQueries(term: string): { field: string; term: string }[] {
  const text = lowerText(term);
  if (!text) return [];
  return REQUEST_PREFIX_FIELDS.map((field) => ({ field, term: text }));
}

export function catalogPrefixQueries(term: string): { field: string; term: string }[] {
  const text = lowerText(term);
  if (!text) return [];
  return [
    { field: "name_lower", term: text },
    { field: "search_name", term: text },
    { field: "merchant_id_lower", term: text },
  ];
}
