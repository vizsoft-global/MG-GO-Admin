import type { SearchSelectItem } from "@/components/ui/search-select";

type NullableString = string | null | undefined;

function compactKeywords(parts: Array<NullableString>): string[] {
  return parts.map((part) => part?.trim() ?? "").filter(Boolean);
}

export function driverSearchOptions<
  T extends {
    id: string;
    name?: NullableString;
    full_name?: NullableString;
    driver_name?: NullableString;
    mobile?: NullableString;
    phone?: NullableString;
    employee_id?: NullableString;
    employee_code?: NullableString;
    user_id?: NullableString;
    code?: NullableString;
  },
>(rows: T[]): SearchSelectItem[] {
  return rows.map((row) => {
    const name =
      row.name ?? row.full_name ?? row.driver_name ?? row.code ?? row.id;
    const employee = row.employee_id ?? row.employee_code ?? row.code ?? null;
    const mobile = row.mobile ?? row.phone ?? null;
    return {
      value: row.id,
      label: name,
      hint: compactKeywords([employee, mobile]).join(" · ") || undefined,
      keywords: compactKeywords([name, employee, mobile, row.user_id, row.id]),
    };
  });
}

export function zoneSearchOptions<
  T extends { id: string; name: string; code?: NullableString },
>(rows: T[]): SearchSelectItem[] {
  return rows.map((row) => ({
    value: row.id,
    label: row.name,
    hint: row.code ?? undefined,
    keywords: compactKeywords([row.name, row.code, row.id]),
  }));
}

export function partnerSearchOptions<
  T extends { id: string; name: string; code?: NullableString },
>(rows: T[]): SearchSelectItem[] {
  return rows.map((row) => ({
    value: row.id,
    label: row.name,
    hint: row.code ?? undefined,
    keywords: compactKeywords([row.name, row.code, row.id]),
  }));
}

export function restaurantSearchOptions<
  T extends {
    id: string;
    name: string;
    code?: NullableString;
    address_line?: NullableString;
    partner_name?: NullableString;
  },
>(rows: T[]): SearchSelectItem[] {
  return rows.map((row) => ({
    value: row.id,
    label: row.name,
    hint: compactKeywords([row.partner_name, row.code, row.address_line]).join(
      " · ",
    ),
    keywords: compactKeywords([
      row.name,
      row.partner_name,
      row.code,
      row.address_line,
      row.id,
    ]),
  }));
}

export function userSearchOptions<
  T extends {
    id: string;
    name?: NullableString;
    full_name?: NullableString;
    email?: NullableString;
    mobile?: NullableString;
    employee_id?: NullableString;
    user_id?: NullableString;
  },
>(rows: T[]): SearchSelectItem[] {
  return rows.map((row) => {
    const name = row.name ?? row.full_name ?? row.email ?? row.id;
    return {
      value: row.id,
      label: name,
      hint: compactKeywords([row.employee_id, row.mobile, row.email]).join(" · "),
      keywords: compactKeywords([
        name,
        row.email,
        row.mobile,
        row.employee_id,
        row.user_id,
        row.id,
      ]),
    };
  });
}

