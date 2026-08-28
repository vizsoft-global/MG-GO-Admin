import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Two-column request detail row — label track stays put; values wrap start-aligned. */
export function RequestFieldRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(7rem,38%)_minmax(0,1fr)] items-start gap-x-3 px-2.5 py-1.5">
      <span className="pt-0.5 text-xs text-muted-foreground">{label}</span>
      <div className={cn("min-w-0 break-words text-start text-sm font-medium", muted && "font-normal text-muted-foreground")}>
        {children}
      </div>
    </div>
  );
}
