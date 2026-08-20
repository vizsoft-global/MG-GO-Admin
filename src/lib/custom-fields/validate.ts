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
    | "negative_number"
    | "invalid_letters"
    | "unknown_key"
    | "invalid_definition";
};

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;
/** Unicode letters + spaces / hyphen / apostrophe; at least one letter. */
const LETTERS_ONLY_RE = /^(?=.*\p{L})[\p{L}\s'-]+$/u;

export function isLettersOnlyText(value: string): boolean {
  return LETTERS_ONLY_RE.test(value.trim());
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === "string" &&
    (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
  );
}

/** Checkbox with configured options → multi-select; empty options → legacy boolean. */
export function isMultiCheckboxField(
  def: Pick<CustomFieldDefinition, "field_type" | "options">,
): boolean {
  return def.field_type === "checkbox" && def.options.length > 0;
}

export function normalizeFieldKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!KEY_RE.test(key)) return null;
  return key;
}

/** Stable stored value when an admin types only a display label. */
export function optionValueFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "option";
}

export function parseOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFieldOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rawValue = String((item as { value?: unknown }).value ?? "").trim();
    const rawLabel = String((item as { label?: unknown }).label ?? "").trim();
    if (!rawValue && !rawLabel) continue;
    let value = rawValue || optionValueFromLabel(rawLabel);
    const label = rawLabel || rawValue;
    if (seen.has(value)) {
      let n = 2;
      while (seen.has(`${value}_${n}`)) n += 1;
      value = `${value}_${n}`;
    }
    seen.add(value);
    out.push({ value, label });
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
  if (
    input.field_type === "checkbox" &&
    Array.isArray(input.options) &&
    input.options.length > 0
  ) {
    const options = parseOptions(input.options);
    if (options.length === 0) {
      return { key, code: "invalid_definition" };
    }
  }
  return null;
}

function parseMultiCheckboxRaw(
  raw: unknown,
  options: CustomFieldOption[],
): { value: string[]; error?: CustomFieldValidationError["code"] } {
  let selected: string[] = [];
  if (Array.isArray(raw)) {
    selected = raw.map((item) => String(item).trim()).filter(Boolean);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { value: [] };
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed)) {
          return { value: [], error: "invalid_type" };
        }
        selected = parsed.map((item) => String(item).trim()).filter(Boolean);
      } catch {
        return { value: [], error: "invalid_type" };
      }
    } else {
      selected = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else if (typeof raw === "boolean") {
    // Legacy boolean on a field that now has options — treat as none selected.
    return { value: [] };
  } else {
    return { value: [], error: "invalid_type" };
  }

  const allowed = new Set(options.map((o) => o.value));
  const labelToValue = new Map(
    options.map((o) => [o.label.toLowerCase(), o.value] as const),
  );
  const out: string[] = [];
  for (const item of selected) {
    if (allowed.has(item)) {
      if (!out.includes(item)) out.push(item);
      continue;
    }
    const byLabel = labelToValue.get(item.toLowerCase());
    if (byLabel) {
      if (!out.includes(byLabel)) out.push(byLabel);
      continue;
    }
    return { value: [], error: "invalid_option" };
  }
  return { value: out };
}

export function coerceCustomFieldValue(
  fieldType: CustomFieldType,
  raw: unknown,
  options: CustomFieldOption[],
  opts?: { lettersOnly?: boolean },
): { value: CustomFieldValue; error?: CustomFieldValidationError["code"] } {
  const multiCheckbox = fieldType === "checkbox" && options.length > 0;

  if (raw === undefined || raw === null || raw === "") {
    if (fieldType === "checkbox") {
      return { value: multiCheckbox ? [] : false };
    }
    return { value: null };
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
      if (fieldType === "text" && opts?.lettersOnly && !isLettersOnlyText(text)) {
        return { value: null, error: "invalid_letters" };
      }
      return { value: text };
    }
    case "number": {
      const n =
        typeof raw === "number" && Number.isFinite(raw)
          ? raw
          : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { value: null, error: "invalid_number" };
      // Custom number fields are non-negative (age, counts, IDs, etc.).
      if (n < 0) return { value: null, error: "negative_number" };
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
      if (multiCheckbox) {
        return parseMultiCheckboxRaw(raw, options);
      }
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
    } else if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      out[key] = value;
    }
  }
  return out;
}

export function validateCustomFieldValues(
  defs: Pick<
    CustomFieldDefinition,
    | "key"
    | "field_type"
    | "required"
    | "options"
    | "is_active"
    | "archived_at"
    | "letters_only"
  >[],
  input: CustomFieldValues,
  opts?: { allowInactiveKeys?: boolean },
): { values: CustomFieldValues; errors: CustomFieldValidationError[] } {
  const activeDefs = defs.filter((d) => d.is_active && !d.archived_at);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: CustomFieldValidationError[] = [];
  const values: CustomFieldValues = {};

  const coerceOpts = (def: { field_type: CustomFieldType; letters_only?: boolean }) => ({
    lettersOnly: def.field_type === "text" && Boolean(def.letters_only),
  });

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
    const coerced = coerceCustomFieldValue(
      def.field_type,
      input[key],
      def.options,
      coerceOpts(def),
    );
    if (coerced.error) {
      errors.push({ key, code: coerced.error });
      continue;
    }
    values[key] = coerced.value;
  }

  for (const def of activeDefs) {
    if (!(def.key in values)) {
      if (def.field_type === "checkbox") {
        values[def.key] = isMultiCheckboxField(def)
          ? (input[def.key] ?? [])
          : Boolean(input[def.key]);
      } else {
        values[def.key] = input[def.key] ?? null;
      }
      const coerced = coerceCustomFieldValue(
        def.field_type,
        values[def.key],
        def.options,
        coerceOpts(def),
      );
      if (coerced.error) {
        errors.push({ key: def.key, code: coerced.error });
      } else {
        values[def.key] = coerced.value;
      }
    }
    const v = values[def.key];
    if (!def.required) continue;

    if (isMultiCheckboxField(def)) {
      if (!Array.isArray(v) || v.length === 0) {
        errors.push({ key: def.key, code: "required" });
      }
      continue;
    }
    if (def.field_type === "checkbox") {
      if (v !== true) {
        errors.push({ key: def.key, code: "required" });
      }
      continue;
    }
    const empty =
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "");
    if (empty) {
      errors.push({ key: def.key, code: "required" });
    }
  }

  return { values, errors };
}

export function defaultsFromDefinitions(
  defs: Pick<
    CustomFieldDefinition,
    | "key"
    | "default_value"
    | "field_type"
    | "options"
    | "is_active"
    | "archived_at"
  >[],
): CustomFieldValues {
  const out: CustomFieldValues = {};
  for (const def of defs) {
    if (!def.is_active || def.archived_at) continue;
    if (isMultiCheckboxField(def)) {
      if (Array.isArray(def.default_value)) {
        out[def.key] = def.default_value;
      } else {
        out[def.key] = [];
      }
      continue;
    }
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
  if (fieldType === "checkbox") {
    if (Array.isArray(value)) {
      if (value.length === 0) return "";
      return value
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .join(", ");
    }
    return value ? "Yes" : "No";
  }
  if (fieldType === "select") {
    const opt = options.find((o) => o.value === String(value));
    return opt?.label ?? String(value);
  }
  return String(value);
}
