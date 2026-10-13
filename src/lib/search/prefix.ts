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

export function tokenPrefixMatch(haystack: string, needle: string): boolean {
  const term = lowerText(needle);
  if (!term) return true;
  const text = lowerText(haystack);
  if (!text) return false;
  if (startsAtWord(text, term)) return true;
  return text.split(TOKEN_SPLIT).some((token) => token.length > 0 && token.startsWith(term));
}

function put(out: Record<string, string>, key: string, value: string): void {
  if (value) out[key] = value;
}

export function driverSearchStamp(input: {
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
}): Record<string, string> {
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
  if (identity.length > 0) out.search_name = [...identity, phone].filter(Boolean).join(" ");
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

const PREFIX_TABLES = new Set([
  "driver_intakes",
  "drivers",
  "restaurants",
  "delivery_rules",
  "incentive_rules",
  "requests",
]);

export function stampSearchFields(table: string, data: Record<string, unknown>): void {
  if (!PREFIX_TABLES.has(table)) return;
  if (table === "driver_intakes" || table === "drivers") {
    Object.assign(
      data,
      driverSearchStamp({
        fullName: data.full_name,
        name: data.name,
        driverCode: data.driver_code,
        employeeId: data.employee_id,
        phone: data.phone,
        clientId: data.client_id,
        clientName: data.client_name,
        zoneName: data.zone_name,
        partnerName: data.partner_name,
        companyName: data.company_name,
      }),
    );
    return;
  }
  if (table === "restaurants") {
    Object.assign(data, catalogNameStamp(data.name, data.external_merchant_id));
    return;
  }
  if (table === "delivery_rules" || table === "incentive_rules") {
    Object.assign(data, catalogNameStamp(data.name));
    return;
  }
  Object.assign(
    data,
    requestSearchStamp({
      requestCode: data.request_code,
      driverName: data.driver_name,
      driverCode: data.driver_code,
      employeeId: data.employee_id,
    }),
  );
}
