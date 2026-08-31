export const DRIVER_CHANGE_SOURCES = [
  "manual_create",
  "bulk_import",
  "edit",
  "approve",
  "archive",
  "restore",
  "status",
  "block",
  "unblock",
  "passcode",
  "document",
  "asset",
  "assignment",
] as const;

export type DriverChangeSource = (typeof DRIVER_CHANGE_SOURCES)[number];

export type DriverChangeValue = string | null;

export type DriverChangeSnapshot = Record<string, DriverChangeValue>;

export type DriverChangeEntry = {
  field: string;
  before: DriverChangeValue;
  after: DriverChangeValue;
};

const SKIP_WHEN_EMPTY = new Set<DriverChangeSource>([
  "edit",
  "bulk_import",
  "document",
  "asset",
  "assignment",
]);

export function displayChangeValue(value: unknown): DriverChangeValue {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(", ");
    return joined || null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function flattenProfileSnapshot(input: {
  full_name?: unknown;
  phone?: unknown;
  civil_id?: unknown;
  employee_id?: unknown;
  driver_code?: unknown;
  partner?: unknown;
  zone?: unknown;
  restaurants?: unknown;
  vehicle?: unknown;
  nationality?: unknown;
  rider_category?: unknown;
  client_id?: unknown;
  client_name?: unknown;
  workflow_status?: unknown;
  account_status?: unknown;
  custom_fields?: Record<string, unknown> | null;
}): DriverChangeSnapshot {
  const snapshot: DriverChangeSnapshot = {
    full_name: displayChangeValue(input.full_name),
    phone: displayChangeValue(input.phone),
    civil_id: displayChangeValue(input.civil_id),
    employee_id: displayChangeValue(input.employee_id),
    driver_code: displayChangeValue(input.driver_code),
    partner: displayChangeValue(input.partner),
    zone: displayChangeValue(input.zone),
    restaurants: displayChangeValue(input.restaurants),
    vehicle: displayChangeValue(input.vehicle),
    nationality: displayChangeValue(input.nationality),
    rider_category: displayChangeValue(input.rider_category),
    client_id: displayChangeValue(input.client_id),
    client_name: displayChangeValue(input.client_name),
    workflow_status: displayChangeValue(input.workflow_status),
    account_status: displayChangeValue(input.account_status),
  };
  for (const [key, value] of Object.entries(input.custom_fields ?? {})) {
    snapshot[`custom.${key}`] = displayChangeValue(value);
  }
  return snapshot;
}

export function diffDriverChange(
  before: DriverChangeSnapshot,
  after: DriverChangeSnapshot,
): DriverChangeEntry[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: DriverChangeEntry[] = [];
  for (const field of keys) {
    const left = displayChangeValue(before[field]);
    const right = displayChangeValue(after[field]);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      changes.push({ field, before: left, after: right });
    }
  }
  return changes;
}

export function shouldInsertDriverChange(
  source: DriverChangeSource,
  changes: readonly DriverChangeEntry[],
): boolean {
  if (changes.length > 0) return true;
  return !SKIP_WHEN_EMPTY.has(source);
}

export function sanitizeDriverChangeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (/passcode/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}
