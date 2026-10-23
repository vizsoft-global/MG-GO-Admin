import { DEFAULT_PAYMENT_CURRENCY, type PaymentCurrencyCode } from "@/lib/currencies";
import type { DriverBankDetails } from "@/features/employees/bank-details";
import type { DriverImportPreviewRow, DriverImportTargetField } from "../types";

export type ImportWriteMode = "create" | "update";

/** Two sheet headers mapped onto one field, or one header reused by two fields. */
export function duplicateHeaderFields(
  mapping: Partial<Record<string, string | undefined>>,
): string[] {
  const owner = new Map<string, string>();
  const dups = new Set<string>();
  for (const [field, header] of Object.entries(mapping)) {
    const key = header?.trim().toLowerCase();
    if (!key) continue;
    const prev = owner.get(key);
    if (prev) {
      dups.add(field);
      dups.add(prev);
    } else {
      owner.set(key, field);
    }
  }
  return [...dups];
}

export function writesCell(
  row: {
    present: Partial<Record<string, boolean | undefined>>;
    cleared?: Partial<Record<string, boolean | undefined>>;
  },
  field: string,
  hasValue: boolean,
  mode: ImportWriteMode,
): boolean {
  if (!row.present[field]) return false;
  if (row.cleared?.[field]) return true;
  if (mode === "create") return true;
  return hasValue;
}

function cleared(row: DriverImportPreviewRow, field: DriverImportTargetField): boolean {
  return Boolean(row.cleared?.[field]);
}

/**
 * Intake / driver columns this row is allowed to change. Blank cells on an
 * update are omitted. `-` writes null (or [] / false for lists and toggles).
 */
export function buildImportWritePatch(input: {
  row: DriverImportPreviewRow;
  mode: ImportWriteMode;
  existingCustom?: Record<string, unknown> | null;
  existingBank?: Partial<DriverBankDetails> | null;
}): { intake: Record<string, unknown>; profile: Record<string, unknown> } {
  const { row, mode } = input;
  const intake: Record<string, unknown> = {};

  const put = (
    field: DriverImportTargetField,
    key: string,
    value: unknown,
    hasValue: boolean,
    clearedValue: unknown = null,
  ) => {
    if (!writesCell(row, field, hasValue, mode)) return;
    if (cleared(row, field)) {
      intake[key] = clearedValue;
      return;
    }
    if (value == null && mode === "create") return;
    intake[key] = value;
  };

  put("full_name", "full_name", row.full_name?.trim() || null, Boolean(row.full_name?.trim()));
  put("phone", "phone", row.phone, Boolean(row.phone));
  put("civil_id", "civil_id", row.civil_id, Boolean(row.civil_id));
  put("employee_id", "employee_id", row.employee_id, Boolean(row.employee_id));
  put("passport_number", "passport_number", row.passport_number, Boolean(row.passport_number));
  put("partner_id", "partner_id", row.partner_id, Boolean(row.partner_id));
  put("zone_id", "zone_id", row.zone_id, Boolean(row.zone_id));
  put("vehicle_label", "vehicle_id", row.vehicle_id, Boolean(row.vehicle_id));
  put("vehicle_type", "vehicle_type_key", row.vehicle_type_key, Boolean(row.vehicle_type_key));
  put("nationality", "nationality", row.nationality, Boolean(row.nationality));
  put("rider_category", "rider_category", row.rider_category, true);
  put("source_company", "source_company", row.source_company, Boolean(row.source_company));
  put("project_key", "project_key", row.project_key, Boolean(row.project_key));
  put("client_id", "client_id", row.client_id, Boolean(row.client_id));
  put("client_name", "client_name", row.client_name, Boolean(row.client_name));
  put("accommodation", "accommodation", row.accommodation, Boolean(row.accommodation));
  put("employee_status_key", "employee_status_key", row.employee_status_key, Boolean(row.employee_status_key));
  put("section_keys", "section_keys", row.section_keys, (row.section_keys?.length ?? 0) > 0, []);
  put(
    "nationality_category_keys",
    "nationality_category_keys",
    row.nationality_category_keys,
    (row.nationality_category_keys?.length ?? 0) > 0,
    [],
  );
  put("work_start_date", "work_start_date", row.work_start_date, Boolean(row.work_start_date));
  put("sponsorship_key", "sponsorship_key", row.sponsorship_key, Boolean(row.sponsorship_key));
  put("job_position", "job_position", row.job_position, Boolean(row.job_position));
  put("hiring_type", "hiring_type", row.hiring_type, Boolean(row.hiring_type));
  put("job_end_date", "job_end_date", row.job_end_date, Boolean(row.job_end_date));
  put(
    "job_end_description",
    "job_end_description",
    row.job_end_description,
    Boolean(row.job_end_description),
  );
  put(
    "residency_expiry_date",
    "residency_expiry_date",
    row.residency_expiry_date,
    Boolean(row.residency_expiry_date),
  );
  put("fixed_salary", "fixed_salary", row.fixed_salary, row.fixed_salary != null);
  put(
    "work_permit_salary",
    "work_permit_salary",
    row.work_permit_salary,
    row.work_permit_salary != null,
  );
  put(
    "last_increment_date",
    "last_increment_date",
    row.last_increment_date,
    Boolean(row.last_increment_date),
  );
  if (writesCell(row, "screenshots_allowed", row.screenshots_allowed != null, mode)) {
    intake.screenshots_allowed = cleared(row, "screenshots_allowed") ? false : row.screenshots_allowed;
  }
  if (writesCell(row, "login_verification_exempt", row.login_verification_exempt != null, mode)) {
    intake.login_verification_exempt = cleared(row, "login_verification_exempt")
      ? false
      : row.login_verification_exempt;
  }

  const bankFields: DriverImportTargetField[] = [
    "bank_code",
    "account_number",
    "iban",
    "beneficiary_civil_id",
    "currency",
  ];
  if (bankFields.some((field) => row.present[field])) {
    if (cleared(row, "bank_code")) {
      intake.bank_details = null;
    } else {
      const hasBankValue = Boolean(
        row.bank_code || row.account_number || row.iban || row.beneficiary_civil_id || row.currency,
      );
      const writing =
        mode === "create" ||
        hasBankValue ||
        bankFields.some((field) => cleared(row, field));
      if (writing && (mode === "create" ? hasBankValue : true) && (mode === "update" ? hasBankValue || bankFields.some((field) => cleared(row, field)) : true)) {
        const base: DriverBankDetails = {
          beneficiary_civil_id: input.existingBank?.beneficiary_civil_id ?? null,
          bank_code: input.existingBank?.bank_code ?? null,
          account_number: input.existingBank?.account_number ?? null,
          iban: input.existingBank?.iban ?? null,
          currency: input.existingBank?.currency ?? DEFAULT_PAYMENT_CURRENCY,
        };
        if (writesCell(row, "beneficiary_civil_id", Boolean(row.beneficiary_civil_id), mode)) {
          base.beneficiary_civil_id = cleared(row, "beneficiary_civil_id") ? null : row.beneficiary_civil_id;
        }
        if (writesCell(row, "bank_code", Boolean(row.bank_code), mode)) {
          base.bank_code = cleared(row, "bank_code") ? null : row.bank_code;
        }
        if (writesCell(row, "account_number", Boolean(row.account_number), mode)) {
          base.account_number = cleared(row, "account_number") ? null : row.account_number;
        }
        if (writesCell(row, "iban", Boolean(row.iban), mode)) {
          base.iban = cleared(row, "iban") ? null : row.iban;
        }
        if (writesCell(row, "currency", Boolean(row.currency), mode)) {
          base.currency = (cleared(row, "currency")
            ? DEFAULT_PAYMENT_CURRENCY
            : row.currency ?? DEFAULT_PAYMENT_CURRENCY) as PaymentCurrencyCode;
        } else if (!base.currency) {
          base.currency = DEFAULT_PAYMENT_CURRENCY;
        }
        if (base.bank_code === "cash") {
          base.account_number = null;
          base.iban = null;
        }
        intake.bank_details = base;
      }
    }
  }

  const custom: Record<string, unknown> = {};
  let customTouched = false;
  for (const [key, value] of Object.entries(row.custom_fields ?? {})) {
    const field = `cf:${key}`;
    if (!writesCell(row, field, Boolean(value), mode)) continue;
    customTouched = true;
    custom[key] = cleared(row, field as DriverImportTargetField) ? null : value;
  }
  if (customTouched) {
    intake.custom_fields = { ...(input.existingCustom ?? {}), ...custom };
  }

  const profile: Record<string, unknown> = {};
  if ("full_name" in intake) profile.full_name = intake.full_name;
  if ("phone" in intake) profile.phone = intake.phone;
  return { intake, profile };
}
