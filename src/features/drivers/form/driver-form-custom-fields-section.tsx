"use client";

import { FormInput } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from "@/lib/custom-fields/types";
import { isMultiCheckboxField } from "@/lib/custom-fields/validate";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./driver-form-primitives";

function asStringList(value: CustomFieldValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

export function DriverFormCustomFieldsSection({
  definitions,
  values,
  onChange,
  errors,
  disabled,
  title,
}: {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (key: string, value: CustomFieldValue) => void;
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
  title: string;
}) {
  if (definitions.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <SectionHeading icon={FormInput} accent="primary">
        {title}
      </SectionHeading>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {definitions.map((def) => {
          const err = errors?.[def.key];
          const value = values[def.key];
          const multiCheckbox = isMultiCheckboxField(def);
          return (
            <div
              key={def.id}
              className={cn(
                "space-y-1.5",
                multiCheckbox && def.options.length > 2 && "sm:col-span-2",
              )}
            >
              <Label htmlFor={`cf_${def.key}`} className="text-xs">
                {def.label}
                {def.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              {def.field_type === "text" ? (
                <Input
                  id={`cf_${def.key}`}
                  className="h-9"
                  value={value == null ? "" : String(value)}
                  onChange={(e) => onChange(def.key, e.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                  inputMode={def.letters_only ? "text" : undefined}
                  aria-invalid={Boolean(err)}
                />
              ) : null}
              {def.field_type === "number" ? (
                <Input
                  id={`cf_${def.key}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className="h-9"
                  value={value == null ? "" : String(value)}
                  onChange={(e) =>
                    onChange(def.key, e.target.value === "" ? null : e.target.value)
                  }
                  disabled={disabled}
                  aria-invalid={Boolean(err)}
                />
              ) : null}
              {def.field_type === "date" ? (
                <Input
                  id={`cf_${def.key}`}
                  type="date"
                  className="h-9"
                  value={value == null ? "" : String(value)}
                  onChange={(e) => onChange(def.key, e.target.value || null)}
                  disabled={disabled}
                />
              ) : null}
              {def.field_type === "select" ? (
                <Select
                  value={value == null || value === "" ? undefined : String(value)}
                  onValueChange={(v) => onChange(def.key, v ?? null)}
                  disabled={disabled}
                >
                  <SelectTrigger id={`cf_${def.key}`} className="h-9">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {def.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {def.field_type === "checkbox" && multiCheckbox ? (
                <div
                  id={`cf_${def.key}`}
                  className={cn(
                    "flex flex-wrap gap-2 rounded-lg border border-border p-2",
                    disabled && "opacity-60",
                  )}
                  role="group"
                  aria-label={def.label}
                >
                  {def.options.map((opt) => {
                    const selected = asStringList(value);
                    const checked = selected.includes(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            if (next === true) {
                              onChange(
                                def.key,
                                selected.includes(opt.value)
                                  ? selected
                                  : [...selected, opt.value],
                              );
                            } else {
                              onChange(
                                def.key,
                                selected.filter((v) => v !== opt.value),
                              );
                            }
                          }}
                          disabled={disabled}
                        />
                        <span className="text-muted-foreground">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {def.field_type === "checkbox" && !multiCheckbox ? (
                <label
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm",
                    disabled && "opacity-60",
                  )}
                >
                  <Checkbox
                    id={`cf_${def.key}`}
                    checked={value === true}
                    onCheckedChange={(checked) => onChange(def.key, checked === true)}
                    disabled={disabled}
                  />
                  <span className="text-muted-foreground">{def.label}</span>
                </label>
              ) : null}
              {err ? <p className="text-[10px] text-destructive">{err}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
