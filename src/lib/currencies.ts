/** ISO 4217 codes the bank-details picker offers. KWD is first. */
export const PAYMENT_CURRENCIES = [
  { code: "KWD", name: "Kuwaiti Dinar" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "AED", name: "UAE Dirham" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "OMR", name: "Omani Rial" },
  { code: "INR", name: "Indian Rupee" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "BDT", name: "Bangladeshi Taka" },
  { code: "EGP", name: "Egyptian Pound" },
  { code: "JOD", name: "Jordanian Dinar" },
  { code: "LBP", name: "Lebanese Pound" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "NPR", name: "Nepalese Rupee" },
] as const;

export type PaymentCurrencyCode = (typeof PAYMENT_CURRENCIES)[number]["code"];

const CURRENCY_SET = new Set<string>(PAYMENT_CURRENCIES.map((row) => row.code));

export const DEFAULT_PAYMENT_CURRENCY: PaymentCurrencyCode = "KWD";

export function isPaymentCurrency(value: string | null | undefined): value is PaymentCurrencyCode {
  return Boolean(value && CURRENCY_SET.has(value.toUpperCase()));
}

export function normalizePaymentCurrency(value: unknown): PaymentCurrencyCode {
  if (typeof value !== "string") return DEFAULT_PAYMENT_CURRENCY;
  const code = value.trim().toUpperCase();
  return isPaymentCurrency(code) ? code : DEFAULT_PAYMENT_CURRENCY;
}
