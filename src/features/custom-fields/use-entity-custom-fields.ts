"use client";

import { useMemo } from "react";
import { customFieldColumnId, type CustomFieldDefinition } from "@/lib/custom-fields/types";
import {
  formatCustomFieldDisplay,
  isMultiCheckboxField,
  parseCustomFieldsJson,
} from "@/lib/custom-fields/validate";
import { useCustomFieldDefinitions } from "./use-custom-fields";

/**
 * The custom columns and slicers for one entity's list page.
 *
 * Three lines per page, and a definition added in Settings appears as a column,
 * a filter chip and an Excel column without the page changing:
 *
 *   const cf = useEntityCustomFields("partner");
 *   // column defs:  cf.columns            (id = `cf:<key>`)
 *   // cell value:   cf.display(row, key)
 *   // filter chips: cf.filters
 *
 * A `select`, `checkbox`-with-options or `date` field also becomes a **slicer**;
 * free text becomes a contains filter. That is why one definition satisfies both
 * halves of the client's ask — "add a new column and a new slicer" is one step.
 */
export type EntityCustomFieldColumn = {
  id: string;
  label: string;
  key: string;
  fieldType: CustomFieldDefinition["field_type"];
  options: CustomFieldDefinition["options"];
};

export type EntityCustomFieldFilter =
  | { kind: "list"; id: string; label: string; key: string; values: string[]; labels: Record<string, string> }
  | { kind: "text"; id: string; label: string; key: string }
  | { kind: "date"; id: string; label: string; key: string };

export function useEntityCustomFields(entityType: string) {
  const { data: defs = [], isLoading } = useCustomFieldDefinitions(entityType);
  const active = useMemo(() => defs.filter((d) => d.is_active && !d.archived_at), [defs]);

  const columns = useMemo<EntityCustomFieldColumn[]>(
    () =>
      active.map((def) => ({
        id: customFieldColumnId(def.key),
        label: def.label,
        key: def.key,
        fieldType: def.field_type,
        options: def.options,
      })),
    [active],
  );

  const filters = useMemo<EntityCustomFieldFilter[]>(
    () =>
      active.map((def) => {
        const id = customFieldColumnId(def.key);
        if (def.field_type === "select" || isMultiCheckboxField(def)) {
          return {
            kind: "list" as const,
            id,
            label: def.label,
            key: def.key,
            values: def.options.map((option) => option.value),
            labels: Object.fromEntries(def.options.map((option) => [option.value, option.label])),
          };
        }
        if (def.field_type === "date") {
          return { kind: "date" as const, id, label: def.label, key: def.key };
        }
        return { kind: "text" as const, id, label: def.label, key: def.key };
      }),
    [active],
  );

  /** One row's stored values, coerced to the shapes the validators accept. */
  function valuesOf(row: { custom_fields?: unknown }): Record<string, unknown> {
    return parseCustomFieldsJson(row.custom_fields) as Record<string, unknown>;
  }

  /** What a cell prints — an option's label, `Yes`/`No`, or the raw value. */
  function display(row: { custom_fields?: unknown }, key: string): string {
    const def = active.find((item) => item.key === key);
    if (!def) return "";
    const values = valuesOf(row);
    return formatCustomFieldDisplay(def.field_type, values[key] as never, def.options);
  }

  /** Does a row pass one filter? Used by the page's own filter pass. */
  function matches(row: { custom_fields?: unknown }, filter: EntityCustomFieldFilter, query: unknown): boolean {
    const values = valuesOf(row);
    const raw = values[filter.key];
    if (filter.kind === "list") {
      if (!Array.isArray(query) || query.length === 0) return true;
      const allowed = query.map(String);
      if (Array.isArray(raw)) return raw.some((item) => allowed.includes(String(item)));
      return allowed.includes(String(raw ?? ""));
    }
    if (filter.kind === "date") {
      if (typeof query !== "string" || !query) return true;
      return String(raw ?? "") === query;
    }
    if (typeof query !== "string" || !query.trim()) return true;
    return String(raw ?? "").toLowerCase().includes(query.trim().toLowerCase());
  }

  return { columns, filters, display, valuesOf, matches, isLoading, definitions: active };
}
