import type { RequestDetail } from "./types";

export type TypedField = { key: string; label: string; from?: "payload" | "column" };

/** Figma §2 field matrices — keys must match driver payload / shared columns. */
export const TYPE_FIELDS: Record<string, TypedField[]> = {
  leave: [
    { key: "leave_type", label: "Leave type" },
    { key: "start_date", label: "From", from: "column" },
    { key: "end_date", label: "To", from: "column" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  sick_leave: [
    { key: "leave_subtype", label: "Leave type" },
    { key: "start_date", label: "From", from: "column" },
    { key: "end_date", label: "To", from: "column" },
    { key: "comment", label: "Comment" },
    { key: "symptoms_details", label: "Symptoms / details" },
  ],
  loan: [
    { key: "amount_kwd", label: "Amount (KWD)", from: "column" },
    { key: "tenure_months", label: "Tenure" },
    { key: "needed_by", label: "Needed by" },
    { key: "reason", label: "Reason" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  asset: [
    { key: "asset_type", label: "Asset type" },
    { key: "size", label: "Size" },
    { key: "quantity", label: "Quantity" },
    { key: "request_mode", label: "Renewal / First Time" },
    { key: "asset_current_status", label: "Current status" },
    { key: "justification", label: "Justification" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  fuel: [
    { key: "amount_kwd", label: "Amount (KWD)", from: "column" },
    { key: "period_month", label: "Period" },
    { key: "distance_km", label: "Distance (km)" },
  ],
  document: [
    { key: "document_type", label: "Document type" },
    { key: "language", label: "Language" },
    { key: "needed_by", label: "Needed by" },
    { key: "delivery_method", label: "Delivery method" },
    { key: "comment", label: "Comment" },
  ],
  complaint: [
    { key: "category", label: "Category" },
    { key: "severity", label: "Severity", from: "column" },
    { key: "subject", label: "Subject" },
    { key: "description", label: "Description" },
  ],
  salary_justification: [
    { key: "salary_month", label: "Salary Month" },
    { key: "expected_amount", label: "Expected amount" },
    { key: "received_amount", label: "Received amount" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
  ],
};

/** Field keys whose Values stay client-gated-empty — never invent options here. */
export const GATED_FIELD_KEYS: Record<string, string> = {
  category: "categoryGated",
  tenure_months: "tenureGated",
};

export function formatFieldValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map(formatFieldValue).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str).toLocaleDateString();
  return str;
}

function readTypedField(request: RequestDetail, field: TypedField): unknown {
  if (field.from === "column") {
    if (field.key === "amount_kwd") return request.amount_kwd;
    if (field.key === "start_date") return request.start_date;
    if (field.key === "end_date") return request.end_date;
    if (field.key === "severity") return request.severity;
  }
  return request.payload?.[field.key];
}

export type TypedFieldRow = {
  key: string;
  label: string;
  value: string;
  gatedKey?: string;
};

/** Structured Figma "Request details" rows for a request type — replaces raw payload dumps. */
export function getTypedFieldRows(request: RequestDetail): TypedFieldRow[] {
  const fields = TYPE_FIELDS[request.request_type] ?? [];
  return fields.map((field) => {
    const raw = readTypedField(request, field);
    const value = formatFieldValue(raw);
    const gatedKey = value === "—" ? GATED_FIELD_KEYS[field.key] : undefined;
    return { key: field.key, label: field.label, value, gatedKey };
  });
}
