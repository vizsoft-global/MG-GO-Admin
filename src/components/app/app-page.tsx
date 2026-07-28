import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppPage({
  children,
  className,
  narrow,
}: {
  children: ReactNode;
  className?: string;
  /** Constrain width for long forms */
  narrow?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-6",
        narrow && "mx-auto w-full max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
