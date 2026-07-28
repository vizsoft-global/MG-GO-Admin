"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SectionAccent = "primary" | "success" | "warning" | "neutral";

const ACCENT_CHIP: Record<SectionAccent, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-muted text-muted-foreground",
};

export function SectionHeading({
  icon: Icon,
  accent,
  children,
}: {
  icon: LucideIcon;
  accent: SectionAccent;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          ACCENT_CHIP[accent],
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{children}</p>
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={cn("text-xs font-medium", className)}>
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </Label>
  );
}

export function FieldBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-1", className)}>{children}</div>;
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-[11px] text-destructive" role="alert">
      {message}
    </p>
  );
}

export function MetadataBadge({
  code,
  label,
}: {
  code: string;
  label: string;
}) {
  return (
    <div className="flex h-9 flex-col justify-center rounded-md border border-primary/20 bg-primary/10 px-2.5">
      <p className="truncate font-mono text-xs font-semibold tabular-nums text-primary">{code}</p>
      <p className="truncate text-[10px] text-primary/70">{label}</p>
    </div>
  );
}

export function avatarTintFromName(name: string): string {
  const tints = [
    "bg-primary/15 text-primary",
    "bg-success-bg text-success",
    "bg-warning-bg text-warning",
    "bg-muted text-muted-foreground",
    "bg-accent text-accent-foreground",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return tints[Math.abs(hash) % tints.length] ?? tints[0];
}
