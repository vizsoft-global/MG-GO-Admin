"use client";

import { Briefcase } from "lucide-react";
import { SegmentOption } from "@/components/app/toggle-chip";
import { FieldBlock, FieldLabel } from "@/features/drivers/form/driver-form-primitives";
import { DRIVER_PROJECT_KEYS, type DriverProjectKey } from "./fleet-labels";

export type ProjectKeyFormValue = DriverProjectKey | "";

export function ProjectKeyField({
  value,
  onChange,
  label,
  keetaLabel,
  americanaLabel,
  fiveGuysLabel,
  unsetLabel,
  hint,
  disabled,
}: {
  value: ProjectKeyFormValue;
  onChange: (next: ProjectKeyFormValue) => void;
  label: string;
  keetaLabel: string;
  americanaLabel: string;
  fiveGuysLabel: string;
  unsetLabel: string;
  hint?: string;
  disabled?: boolean;
}) {
  const optionLabel = (key: DriverProjectKey): string => {
    switch (key) {
      case "keeta":
        return keetaLabel;
      case "americana":
        return americanaLabel;
      case "five_guys":
        return fiveGuysLabel;
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
  };

  return (
    <FieldBlock>
      <FieldLabel icon={Briefcase}>{label}</FieldLabel>
      <div role="radiogroup" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {DRIVER_PROJECT_KEYS.map((key) => {
          const selected = value === key;
          return (
            <SegmentOption
              key={key}
              selected={selected}
              disabled={disabled}
              variant={selected ? "success" : "default"}
              onClick={() => onChange(key)}
            >
              {optionLabel(key)}
            </SegmentOption>
          );
        })}
        <SegmentOption
          selected={value === ""}
          disabled={disabled}
          variant="default"
          onClick={() => onChange("")}
        >
          {unsetLabel}
        </SegmentOption>
      </div>
      {hint ? <p className="text-xs leading-tight text-muted-foreground">{hint}</p> : null}
    </FieldBlock>
  );
}
