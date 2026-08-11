import type { RequestDetail } from "./types";

export type TypedField = {
  key: string;
  label: string;
  from?: "payload" | "column" | "derived";
  format?: "currency";
};

/** Figma §2 field matrices — keys must match driver payload / shared columns. */
export const TYPE_FIELDS: Record<string, TypedField[]> = {
  leave: [
    { key: "leave_type", label: "Leave type" },
    { key: "date_range", label: "Dates", from: "derived" },
    { key: "duration_days", label: "Duration", from: "derived" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  sick_leave: [
    { key: "leave_subtype", label: "Leave type" },
    { key: "date_range", label: "Dates", from: "derived" },
    { key: "duration_days", label: "Days", from: "derived" },
    { key: "comment", label: "Comment" },
    { key: "symptoms_details", label: "Symptoms / details" },
  ],
  loan: [
    { key: "amount_kwd", label: "Amount", from: "column", format: "currency" },
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
    { key: "amount_kwd", label: "Amount", from: "column", format: "currency" },
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
    { key: "salary_month", label: "Period" },
    { key: "received_amount", label: "Net paid", format: "currency" },
    { key: "expected_amount", label: "Expected", format: "currency" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
  ],
};

/** Field keys whose Values stay client-gated-empty — never invent options here. */
export const GATED_FIELD_KEYS: Record<string, string> = {
  category: "categoryGated",
  tenure_months: "tenureGated",
};

/** Pinned so the server and client render the same string (no hydration drift). */
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Single lowercase token (`annual`, `sick_leave`, `high`) — free text keeps its casing. */
function humanizeToken(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(value)) return value;
  return value
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatFieldValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map(formatFieldValue).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return DATE_FORMAT.format(new Date(`${str}T00:00:00`));
  return humanizeToken(str);
}

/** Inclusive day count — Figma shows leave as a duration, not just two dates. */
function durationDays(request: RequestDetail): number | null {
  if (!request.start_date || !request.end_date) return null;
  const start = new Date(`${request.start_date}T00:00:00`).getTime();
  const end = new Date(`${request.end_date}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

/** Figma shows leave as one "Dates" row (`18–20 Jul`), not two From/To rows. */
function dateRange(request: RequestDetail): string | null {
  const { start_date: start, end_date: end } = request;
  if (!start) return null;
  const startDate = new Date(`${start}T00:00:00`);
  if (!end || end === start) return DATE_FORMAT.format(startDate);
  const endDate = new Date(`${end}T00:00:00`);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const head = sameMonth ? String(startDate.getDate()).padStart(2, "0") : DAY_MONTH_FORMAT.format(startDate);
  return `${head} – ${DATE_FORMAT.format(endDate)}`;
}

function readTypedField(request: RequestDetail, field: TypedField): unknown {
  if (field.from === "column") {
    if (field.key === "amount_kwd") return request.amount_kwd;
    if (field.key === "start_date") return request.start_date;
    if (field.key === "end_date") return request.end_date;
    if (field.key === "severity") return request.severity;
  }
  if (field.from === "derived") {
    if (field.key === "date_range") return dateRange(request);
    if (field.key === "duration_days") {
      const days = durationDays(request);
      return days == null ? null : `${days} ${days === 1 ? "day" : "days"}`;
    }
  }
  return request.payload?.[field.key];
}

export type TypedFieldRow = {
  key: string;
  label: string;
  value: string;
  gatedKey?: string;
};

/**
 * Structured Figma "Request details" rows for a request type — replaces raw payload dumps.
 * Fields the driver did not send are dropped (Figma lists only populated rows); gated fields
 * stay so the client-pending state is still visible.
 */
export function getTypedFieldRows(request: RequestDetail): TypedFieldRow[] {
  const fields = TYPE_FIELDS[request.request_type] ?? [];
  return fields
    .map((field) => {
      const raw = readTypedField(request, field);
      const value =
        field.format === "currency" && raw != null && raw !== "" && !Number.isNaN(Number(raw))
          ? `${Number(raw).toFixed(3)} KWD`
          : formatFieldValue(raw);
      const gatedKey = value === "—" ? GATED_FIELD_KEYS[field.key] : undefined;
      return { key: field.key, label: field.label, value, gatedKey };
    })
    .filter((row) => row.value !== "—" || row.gatedKey != null);
}

/** Workflow bookkeeping the admin already sees as status/badges — never a "detail" row. */
const INTERNAL_PAYLOAD_KEYS = new Set([
  "demo_qa",
  "awaiting_driver_ack",
  "driver_ack_at",
  "driver_ack_note",
  "created_on_behalf",
  "created_on_behalf_by",
  "created_on_behalf_by_name",
  "created_on_behalf_at",
]);

/**
 * Payload keys the driver app sent that this build's field matrix does not know about.
 * Without this the admin silently loses data whenever the app ships a new field.
 */
export function getExtraPayloadRows(request: RequestDetail): TypedFieldRow[] {
  const known = new Set((TYPE_FIELDS[request.request_type] ?? []).map((f) => f.key));
  return Object.entries(request.payload ?? {})
    .filter(([key, value]) => {
      if (known.has(key) || INTERNAL_PAYLOAD_KEYS.has(key)) return false;
      return value != null && value !== "";
    })
    .map(([key, value]) => ({
      key,
      label: humanizeToken(key),
      value: formatFieldValue(value),
    }));
}
