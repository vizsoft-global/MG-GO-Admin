import type { CustomFieldDefinition, CustomFieldValues } from "./types";
import {
  isMultiCheckboxField,
  parseCustomFieldsJson,
  validateCustomFieldValues,
} from "./validate";

export function parseCustomFieldsFromFormData(
  formData: FormData,
  defs: CustomFieldDefinition[],
): ReturnType<typeof validateCustomFieldValues> {
  const raw: CustomFieldValues = {};
  for (const def of defs) {
    if (!def.is_active || def.archived_at) continue;
    if (def.field_type === "checkbox") {
      if (isMultiCheckboxField(def)) {
        const v = formData.get(`cf_${def.key}`);
        if (v == null || v === "") {
          raw[def.key] = [];
        } else {
          const s = String(v);
          try {
            const parsed = JSON.parse(s) as unknown;
            raw[def.key] = Array.isArray(parsed)
              ? parsed.map(String)
              : s;
          } catch {
            raw[def.key] = s;
          }
        }
      } else {
        raw[def.key] =
          formData.get(`cf_${def.key}`) === "true" ||
          formData.get(`cf_${def.key}`) === "on";
      }
    } else {
      const v = formData.get(`cf_${def.key}`);
      raw[def.key] = v == null ? null : String(v);
    }
  }

  const jsonBlob = formData.get("customFieldsJson");
  if (typeof jsonBlob === "string" && jsonBlob.trim()) {
    try {
      const parsed = parseCustomFieldsJson(JSON.parse(jsonBlob));
      Object.assign(raw, parsed);
    } catch {
      /* ignore malformed blob; field keys win */
    }
  }

  return validateCustomFieldValues(defs, raw);
}

export function customFieldsToFormEntries(values: CustomFieldValues): [string, string][] {
  return Object.entries(values).map(([key, value]) => {
    if (Array.isArray(value)) return [`cf_${key}`, JSON.stringify(value)];
    if (typeof value === "boolean") return [`cf_${key}`, value ? "true" : "false"];
    if (value == null) return [`cf_${key}`, ""];
    return [`cf_${key}`, String(value)];
  });
}
