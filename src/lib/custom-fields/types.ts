export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "select",
  "date",
  "checkbox",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldOption = {
  value: string;
  label: string;
};

export type CustomFieldValue = string | number | boolean | string[] | null;

export type CustomFieldValues = Record<string, CustomFieldValue>;

export type CustomFieldDefinition = {
  id: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: CustomFieldType;
  required: boolean;
  /** When true and field_type is text: letters, spaces, hyphen, apostrophe only. */
  letters_only: boolean;
  options: CustomFieldOption[];
  default_value: CustomFieldValue;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomFieldDefinitionInput = {
  id?: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: CustomFieldType;
  required: boolean;
  letters_only?: boolean;
  options?: CustomFieldOption[];
  default_value?: CustomFieldValue;
  sort_order?: number;
  is_active?: boolean;
};

export const DRIVER_ENTITY_TYPE = "driver";

export function customFieldColumnId(key: string): string {
  return `cf:${key}`;
}

export function parseCustomFieldColumnId(id: string): string | null {
  if (!id.startsWith("cf:")) return null;
  const key = id.slice(3);
  return key || null;
}
