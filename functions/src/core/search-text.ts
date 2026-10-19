const PREFIX_END = "\uf8ff";

export function lowerText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function digitsOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

/** `13123` matches `EMP13123` because the digit run starts with the typed digits. */
export function digitRunPrefixMatch(haystack: string, needle: string): boolean {
  const digits = digitsOnly(needle);
  if (!digits) return false;
  return digitsOnly(haystack).startsWith(digits);
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

const SPACE_SPLIT = /\s+/;

/**
 * Substring search for in-memory roster scans.
 *
 * Every typed word must appear somewhere in the text, in any order — `doe jen`
 * finds "Jenson Doe", and `ally` finds "Hawally". A single-word needle is just
 * a substring test. Prefix-only matching is kept for the indexed Firestore
 * range queries, which cannot express a substring.
 */
export function textContainsMatch(haystack: unknown, needle: string): boolean {
  const term = lowerText(needle);
  if (!term) return true;
  const text = lowerText(haystack);
  if (!text) return false;
  const words = term.split(SPACE_SPLIT).filter(Boolean);
  return words.every((word) => text.includes(word));
}

export function anyTextContains(fields: readonly unknown[], needle: string): boolean {
  return fields.some((field) => textContainsMatch(field, needle));
}

/** Digit subsequence: `13123` and `312` both match `EMP13123`; `213` does not. */
export function digitSubsequenceMatch(haystack: unknown, needle: string): boolean {
  const digits = digitsOnly(typeof needle === "string" ? needle : "");
  if (!digits) return false;
  const text = digitsOnly(typeof haystack === "string" ? haystack : "");
  if (!text) return false;
  if (text.includes(digits)) return true;
  let cursor = 0;
  for (const char of text) {
    if (char === digits[cursor]) cursor += 1;
    if (cursor === digits.length) return true;
  }
  return false;
}

/**
 * Every column that names or identifies a rider, in the order they are printed
 * on a roster row. A search box is one field for the operator, so a scan that
 * only looked at name + driver code refused `10034`, `2910…`, a passport or the
 * client company the rider is supplied to — the same identifiers every other
 * list lets them type.
 */
const IDENTITY_SEARCH_KEYS = [
  "full_name",
  "name",
  "driver_name",
  "rider_name",
  "driver_code",
  "employee_id",
  "mg_id",
  "civil_id",
  "passport_number",
  "passport",
  "phone",
  "phone_digits",
  "client_id",
  "client_name",
  "project_key",
  "reg_number",
  "bike_id",
] as const;

/** Flattens the identity columns of one or more docs into a search haystack. */
export function identitySearchValues(
  ...sources: Array<Record<string, unknown> | null | undefined>
): unknown[] {
  const values: unknown[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const key of IDENTITY_SEARCH_KEYS) {
      const value = source[key];
      if (value !== null && value !== undefined) values.push(value);
    }
  }
  return values;
}

/**
 * Text match first, then digit subsequence — so a name, code, ID or phone all
 * answer the same box. Letters are required before the digit shortcut runs, or
 * a two-letter query would match any rider whose phone happens to contain them.
 */
export function identityMatchesSearch(values: readonly unknown[], needle: string): boolean {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Each typed word may live in a different column — `doe 10034` is a name and
  // an employee ID, which no single field contains.
  if (words.every((word) => values.some((value) => textContainsMatch(value, word)))) return true;
  const digits = digitsOnly(needle);
  if (!digits || digits.length < 2) return false;
  return values.some((value) => digitSubsequenceMatch(value, digits));
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
  civilId?: unknown;
  passport?: unknown;
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
  const civilId = digitsOnly(typeof input.civilId === "string" ? input.civilId : "") || lowerText(input.civilId);
  const passport = lowerText(input.passport);
  const phone = digitsOnly(typeof input.phone === "string" ? input.phone : "");
  put(out, "name_lower", name);
  put(out, "driver_code_lower", code);
  put(out, "employee_id_lower", employee);
  put(out, "client_id_lower", clientId);
  put(out, "client_name_lower", clientName);
  put(out, "zone_name_lower", zone);
  put(out, "partner_name_lower", partner);
  put(out, "company_name_lower", company);
  put(out, "civil_id_lower", civilId);
  put(out, "passport_lower", passport);
  put(out, "phone_digits", phone);
  const identity = [name, code, employee, clientName, clientId, zone, partner, company, civilId, passport].filter(Boolean);
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
  "civil_id_lower",
  "passport_lower",
  "search_name",
] as const;

export const DRIVER_SEARCH_FIELD_MAP = {
  all: null,
  name: "name_lower",
  employeeId: "employee_id_lower",
  driverId: "driver_code_lower",
  civilId: "civil_id_lower",
  passport: "passport_lower",
  zone: "zone_name_lower",
  phone: "phone_digits",
} as const;

export type DriverSearchField = keyof typeof DRIVER_SEARCH_FIELD_MAP;

export function driverPrefixQueriesForField(
  term: string,
  field: string | null | undefined,
): { field: string; term: string }[] {
  const mapped =
    field && field !== "all" && field in DRIVER_SEARCH_FIELD_MAP
      ? DRIVER_SEARCH_FIELD_MAP[field as DriverSearchField]
      : null;
  if (!mapped) return driverPrefixQueries(term);
  const text = mapped === "phone_digits" || mapped === "civil_id_lower" ? digitsOnly(term) || lowerText(term) : lowerText(term);
  if (!text) return [];
  return [{ field: mapped, term: text }];
}

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

export function deliverySearchStamp(input: {
  orderId?: unknown;
  externalOrderId?: unknown;
  riderName?: unknown;
  driverName?: unknown;
  driverCode?: unknown;
  employeeId?: unknown;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const order = lowerText(input.externalOrderId) || lowerText(input.orderId);
  const rider = lowerText(input.riderName) || lowerText(input.driverName);
  const code = lowerText(input.driverCode);
  const employee = lowerText(input.employeeId);
  put(out, "order_id_lower", order);
  put(out, "rider_name_lower", rider);
  put(out, "driver_name_lower", rider);
  put(out, "driver_code_lower", code);
  put(out, "employee_id_lower", employee);
  const identity = [order, rider, code, employee].filter(Boolean);
  if (identity.length > 0) out.search_name = identity.join(" ");
  return out;
}

export const DELIVERY_PREFIX_FIELDS = [
  "order_id_lower",
  "rider_name_lower",
  "driver_name_lower",
  "driver_code_lower",
  "employee_id_lower",
  "search_name",
] as const;

export type SearchEntity =
  | "drivers"
  | "driver_intakes"
  | "requests"
  | "restaurants"
  | "delivery_rules"
  | "incentive_rules"
  | "deliveries";

/** Same stamp the admin and rider write handlers spread onto the stored row. */
export function stampStoredRow(entity: SearchEntity, row: Record<string, unknown>): Record<string, string> {
  switch (entity) {
    case "drivers":
    case "driver_intakes":
      return driverSearchStamp({
        fullName: row.full_name,
        name: row.name,
        driverCode: row.driver_code,
        employeeId: row.employee_id,
        phone: row.phone,
        clientId: row.client_id,
        clientName: row.client_name,
        zoneName: row.zone_name,
        partnerName: row.partner_name,
        companyName: row.company_name,
      });
    case "requests":
      return requestSearchStamp({
        requestCode: row.request_code,
        driverName: row.driver_name,
        driverCode: row.driver_code,
        employeeId: row.employee_id,
      });
    case "restaurants":
      return catalogNameStamp(row.name, row.external_merchant_id);
    case "delivery_rules":
    case "incentive_rules":
      return catalogNameStamp(row.name);
    case "deliveries":
      return deliverySearchStamp({
        externalOrderId: row.external_order_id,
        orderId: row.order_id,
        riderName: row.rider_name,
        driverName: row.driver_name,
        driverCode: row.driver_code,
        employeeId: row.employee_id,
      });
    default: {
      const unreachable: never = entity;
      throw new Error(`unknown_search_entity:${String(unreachable)}`);
    }
  }
}
