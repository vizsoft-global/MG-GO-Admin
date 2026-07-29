import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type CustomFieldOption,
  type CustomFieldType,
  type CustomFieldValue,
  type CustomFieldValues,
} from "./types";

export type CustomFieldValidationError = {
  key: string;
  code:
    | "required"
    | "invalid_type"
    | "invalid_option"
    | "invalid_date"
    | "invalid_number"
    | "unknown_key"
    | "invalid_definition";
};

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === "string" &&
    (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeFieldKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!KEY_RE.test(key)) return null;
  return key;
}

export function parseOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFieldOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = String((item as { value?: unknown }).value ?? "").trim();
    const label = String((item as { label?: unknown }).label ?? value).trim();
    if (!value) continue;
    out.push({ value, label: label || value });
  }
  return out;
}

export function validateDefinitionInput(
  input: CustomFieldDefinitionInput,
): CustomFieldValidationError | null {
  const key = normalizeFieldKey(input.key);
  if (!key) {
    return { key: input.key, code: "invalid_definition" };
  }
  if (!input.label.trim()) {
    return { key, code: "invalid_definition" };
  }
  if (!isCustomFieldType(input.field_type)) {
    return { key, code: "invalid_definition" };
  }
  if (input.field_type === "select") {
    const options = parseOptions(input.options);
    if (options.length === 0) {
      return { key, code: "invalid_definition" };
    }
  }
  return null;
}

export function coerceCustomFieldValue(
  fieldType: CustomFieldType,
  raw: unknown,
  options: CustomFieldOption[],
): { value: CustomFieldValue; error?: CustomFieldValidationError["code"] } {
  if (raw === undefined || raw === null || raw === "") {
    return { value: fieldType === "checkbox" ? false : null };
  }

  switch (fieldType) {
    case "text":
    case "select": {
      const text = String(raw).trim();
      if (!text) return { value: null };
      if (fieldType === "select") {
        const ok = options.some((o) => o.value === text);
        if (!ok) return { value: null, error: "invalid_option" };
      }
      return { value: text };
    }
    case "number": {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return { value: raw };
      }
      const n = Number(String(raw).trim());
      if (!Number.isFinite(n)) return { value: null, error: "invalid_number" };
      return { value: n };
    }
    case "date": {
      const text = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { value: null, error: "invalid_date" };
      }
      const t = Date.parse(`${text}T00:00:00Z`);
      if (Number.isNaN(t)) return { value: null, error: "invalid_date" };
      return { value: text };
    }
    case "checkbox": {
      if (typeof raw === "boolean") return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (["1", "true", "yes", "y", "on"].includes(s)) return { value: true };
      if (["0", "false", "no", "n", "off", ""].includes(s)) return { value: false };
      return { value: null, error: "invalid_type" };
    }
    default:
      return { value: null, error: "invalid_type" };
  }
}

export function parseCustomFieldsJson(raw: unknown): CustomFieldValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CustomFieldValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

export function validateCustomFieldValues(
  defs: Pick<
    CustomFieldDefinition,
    "key" | "field_type" | "required" | "options" | "is_active" | "archived_at"
  >[],
  input: CustomFieldValues,
  opts?: { allowInactiveKeys?: boolean },
): { values: CustomFieldValues; errors: CustomFieldValidationError[] } {
  const activeDefs = defs.filter((d) => d.is_active && !d.archived_at);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: CustomFieldValidationError[] = [];
  const values: CustomFieldValues = {};

  for (const key of Object.keys(input)) {
    const def = byKey.get(key);
    if (!def) {
      errors.push({ key, code: "unknown_key" });
      continue;
    }
    if (!def.is_active || def.archived_at) {
      if (opts?.allowInactiveKeys) {
        values[key] = input[key] ?? null;
      }
      continue;
    }
    const coerced = coerceCustomFieldValue(def.field_type, input[key], def.options);
    if (coerced.error) {
      errors.push({ key, code: coerced.error });
      continue;
    }
    values[key] = coerced.value;
  }

  for (const def of activeDefs) {
    if (!(def.key in values)) {
      values[def.key] =
        def.field_type === "checkbox" ? Boolean(input[def.key]) : (input[def.key] ?? null);
      const coerced = coerceCustomFieldValue(def.field_type, values[def.key], def.options);
      if (coerced.error) {
        errors.push({ key: def.key, code: coerced.error });
      } else {
        values[def.key] = coerced.value;
      }
    }
    const v = values[def.key];
    const empty =
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (def.field_type === "checkbox" && v === false && def.required);
    if (def.required && empty && def.field_type !== "checkbox") {
      errors.push({ key: def.key, code: "required" });
    }
    if (def.required && def.field_type === "checkbox" && v !== true) {
      // checkbox required means must be checked
      errors.push({ key: def.key, code: "required" });
    }
  }

  return { values, errors };
}

export function defaultsFromDefinitions(
  defs: Pick<CustomFieldDefinition, "key" | "default_value" | "field_type" | "is_active" | "archived_at">[],
): CustomFieldValues {
  const out: CustomFieldValues = {};
  for (const def of defs) {
    if (!def.is_active || def.archived_at) continue;
    if (def.default_value !== undefined && def.default_value !== null) {
      out[def.key] = def.default_value;
    } else if (def.field_type === "checkbox") {
      out[def.key] = false;
    } else {
      out[def.key] = null;
    }
  }
  return out;
}

export function formatCustomFieldDisplay(
  fieldType: CustomFieldType,
  value: CustomFieldValue,
  options: CustomFieldOption[] = [],
): string {
  if (value === null || value === undefined) return "";
  if (fieldType === "checkbox") return value ? "Yes" : "No";
  if (fieldType === "select") {
    const opt = options.find((o) => o.value === String(value));
    return opt?.label ?? String(value);
  }
  return String(value);
}
