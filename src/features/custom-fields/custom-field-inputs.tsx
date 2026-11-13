"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleChip } from "@/components/app/toggle-chip";
import type { CustomFieldDefinition, CustomFieldValues } from "@/lib/custom-fields/types";
import { isMultiCheckboxField } from "@/lib/custom-fields/validate";

/**
 * The custom fields an operator fills in on an edit form.
 *
 * Renders from the live definitions, so a column added in Settings needs no page
 * change — the form, the list and the Excel export all read the same source.
 * Values are handed back unsaved; the page calls `saveEntityCustomFields` after
 * its own save so a custom value can never land on a record that failed to save.
 */
export function CustomFieldInputs({
  definitions,
  values,
  onChange,
  disabled,
  requiredLabel = "required",
}: {
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
  disabled?: boolean;
  requiredLabel?: string;
}) {
  const active = definitions.filter((def) => def.is_active && !def.archived_at);
  if (active.length === 0) return null;

  function set(key: string, value: CustomFieldValues[string]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {active.map((def) => {
        const value = values[def.key];
        const id = `cf-${def.key}`;
        return (
          <div key={def.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {def.label}
              {def.required ? (
                <span className="text-destructive" aria-label={requiredLabel}>
                  {" "}
                  *
                </span>
              ) : null}
            </Label>

            {def.field_type === "text" ? (
              <Input
                id={id}
                className="h-9"
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(event) => set(def.key, event.target.value)}
              />
            ) : null}

            {def.field_type === "number" ? (
              <Input
                id={id}
                className="h-9 tabular-nums"
                type="number"
                min={0}
                value={typeof value === "number" ? value : ""}
                disabled={disabled}
                onChange={(event) =>
                  set(def.key, event.target.value === "" ? null : Number(event.target.value))
                }
              />
            ) : null}

            {def.field_type === "date" ? (
              <Input
                id={id}
                className="h-9"
                type="date"
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(event) => set(def.key, event.target.value || null)}
              />
            ) : null}

            {def.field_type === "select" ? (
              <Select
                items={[
                  { value: "", label: "—" },
                  ...def.options.map((option) => ({ value: option.value, label: option.label })),
                ]}
                value={typeof value === "string" ? value : ""}
                onValueChange={(next) => set(def.key, !next ? null : next)}
                disabled={disabled}
              >
                <SelectTrigger className="h-9 w-full" aria-label={def.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">—</SelectItem>
                  {def.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {def.field_type === "checkbox" && !isMultiCheckboxField(def) ? (
              <ToggleChip
                selected={value === true}
                className="h-9"
                disabled={disabled}
                onClick={() => set(def.key, value !== true)}
              >
                {def.label}
              </ToggleChip>
            ) : null}

            {def.field_type === "checkbox" && isMultiCheckboxField(def) ? (
              <div className="flex flex-wrap gap-1.5">
                {def.options.map((option) => {
                  const selected = Array.isArray(value) ? value.includes(option.value) : false;
                  return (
                    <ToggleChip
                      key={option.value}
                      selected={selected}
                      className="h-9"
                      disabled={disabled}
                      onClick={() => {
                        const current = Array.isArray(value) ? [...value] : [];
                        const next = selected
                          ? current.filter((item) => item !== option.value)
                          : [...current, option.value];
                        set(def.key, next);
                      }}
                    >
                      {option.label}
                    </ToggleChip>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
