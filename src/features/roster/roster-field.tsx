"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { rosterLabel } from "./roster-ui";

export function RosterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-[132px] flex-1 flex-col gap-1", className)}>
      <span className={rosterLabel}>{label}</span>
      {children}
    </label>
  );
}

export function RosterUnitField({
  label,
  prefix,
  unit,
  value,
  onChange,
  className,
}: {
  label: string;
  prefix?: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs text-[#5E5754]">{label}</span>
      <span className="flex h-9 items-center rounded-[10px] border border-[#E2DCD8] bg-white px-2">
        {prefix ? <span className="me-1 shrink-0 text-xs text-[#5E5754]">{prefix}</span> : null}
        <Input
          className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="ms-1 shrink-0 text-xs text-[#5E5754]">{unit}</span>
      </span>
    </label>
  );
}
