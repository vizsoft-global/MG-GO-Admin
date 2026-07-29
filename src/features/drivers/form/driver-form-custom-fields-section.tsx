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
import { cn } from "@/lib/utils";
import { SectionHeading } from "./driver-form-primitives";

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
          return (
            <div key={def.id} className="space-y-1.5">
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
                />
              ) : null}
              {def.field_type === "number" ? (
                <Input
                  id={`cf_${def.key}`}
                  type="number"
                  className="h-9"
                  value={value == null ? "" : String(value)}
                  onChange={(e) =>
                    onChange(def.key, e.target.value === "" ? null : e.target.value)
                  }
                  disabled={disabled}
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
              {def.field_type === "checkbox" ? (
                <label
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm",
                    disabled && "opacity-60",
                  )}
                >
                  <Checkbox
                    id={`cf_${def.key}`}
                    checked={Boolean(value)}
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
