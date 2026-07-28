"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function RequiredLabel({
  children,
  required,
  className,
}: {
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <Label className={cn(className)}>
      {children}
      {required ? <span className="ms-0.5 text-destructive">*</span> : null}
    </Label>
  );
}
