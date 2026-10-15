import { DEFAULT_PAYMENT_CURRENCY, normalizePaymentCurrency, type PaymentCurrencyCode } from "@/lib/currencies";
import { isNbkBank, type EmployeeCatalogRow } from "./employee-catalogs";

export type DriverBankDetails = {
  beneficiary_civil_id: string | null;
  bank_code: string | null;
  account_number: string | null;
  iban: string | null;
  currency: PaymentCurrencyCode;
};

export const EMPTY_BANK_DETAILS: DriverBankDetails = {
  beneficiary_civil_id: null,
  bank_code: null,
  account_number: null,
  iban: null,
  currency: DEFAULT_PAYMENT_CURRENCY,
};

const CIVIL_ID_RE = /^\d{12}$/;
const ACCOUNT_RE = /^\d{6,20}$/;
const KUWAIT_IBAN_RE = /^KW[0-9A-Z]{28}$/;

export function maskBankNumber(value: string | null | undefined): string {
  const compact = (value ?? "").replace(/\s+/g, "");
  if (!compact) return "—";
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

export function compactIban(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 mod-97. Letters A–Z map to 10–35. */
export function ibanMod97Valid(iban: string): boolean {
  const compact = compactIban(iban);
  if (compact.length < 15) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const chunk = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function isKuwaitIban(value: string | null | undefined): boolean {
  const compact = compactIban(value);
  return KUWAIT_IBAN_RE.test(compact) && ibanMod97Valid(compact);
}

export type BankDetailsIssue =
  | "invalid_beneficiary_civil_id"
  | "bank_required"
  | "account_required"
  | "invalid_account_number"
  | "iban_required"
  | "invalid_iban";

export function validateBankDetails(
  raw: Partial<DriverBankDetails> | null | undefined,
  banks: readonly EmployeeCatalogRow[],
): { ok: true; value: DriverBankDetails } | { ok: false; error: BankDetailsIssue } {
  if (!raw) return { ok: true, value: { ...EMPTY_BANK_DETAILS } };

  const beneficiary = (raw.beneficiary_civil_id ?? "").replace(/\D/g, "");
  if (beneficiary && !CIVIL_ID_RE.test(beneficiary)) {
    return { ok: false, error: "invalid_beneficiary_civil_id" };
  }

  const bankCode = (raw.bank_code ?? "").trim().toLowerCase() || null;
  const currency = normalizePaymentCurrency(raw.currency);
  const nbk = isNbkBank(bankCode, banks);
  const account = (raw.account_number ?? "").replace(/\D/g, "") || null;
  const iban = compactIban(raw.iban) || null;

  const empty =
    !beneficiary && !bankCode && !account && !iban && currency === DEFAULT_PAYMENT_CURRENCY;
  if (empty) return { ok: true, value: { ...EMPTY_BANK_DETAILS } };

  if (!bankCode) return { ok: false, error: "bank_required" };

  if (nbk) {
    if (!account) return { ok: false, error: "account_required" };
    if (!ACCOUNT_RE.test(account)) return { ok: false, error: "invalid_account_number" };
    return {
      ok: true,
      value: {
        beneficiary_civil_id: beneficiary || null,
        bank_code: bankCode,
        account_number: account,
        iban: null,
        currency,
      },
    };
  }

  if (!iban) return { ok: false, error: "iban_required" };
  if (!isKuwaitIban(iban)) return { ok: false, error: "invalid_iban" };
  return {
    ok: true,
    value: {
      beneficiary_civil_id: beneficiary || null,
      bank_code: bankCode,
      account_number: null,
      iban,
      currency,
    },
  };
}

export function parseBankDetails(raw: unknown): DriverBankDetails {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BANK_DETAILS };
  const row = raw as Record<string, unknown>;
  return {
    beneficiary_civil_id:
      typeof row.beneficiary_civil_id === "string" ? row.beneficiary_civil_id : null,
    bank_code: typeof row.bank_code === "string" ? row.bank_code : null,
    account_number: typeof row.account_number === "string" ? row.account_number : null,
    iban: typeof row.iban === "string" ? row.iban : null,
    currency: normalizePaymentCurrency(row.currency),
  };
}

/** Strip account / IBAN / civil id so audit rows never store them. */
export function sanitizeBankForLog<T extends Record<string, unknown>>(payload: T): T {
  const next: Record<string, unknown> = { ...payload };
  delete next.account_number;
  delete next.iban;
  delete next.beneficiary_civil_id;
  delete next.bank_details;
  const bank = next.bank;
  if (bank && typeof bank === "object") {
    next.bank = { bank_code: (bank as DriverBankDetails).bank_code ?? null };
  }
  return next as T;
}

export function displayBankValue(
  details: DriverBankDetails | null | undefined,
  banks: readonly EmployeeCatalogRow[],
): { kind: "account" | "iban" | "empty"; masked: string } {
  if (!details) return { kind: "empty", masked: "—" };
  if (isNbkBank(details.bank_code, banks) && details.account_number) {
    return { kind: "account", masked: maskBankNumber(details.account_number) };
  }
  if (details.iban) return { kind: "iban", masked: maskBankNumber(details.iban) };
  return { kind: "empty", masked: "—" };
}
