import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-card)] p-[var(--pad-card)]",
        className,
      )}
    >
      {title || action ? (
        <div className="mb-[var(--gap-section)] flex items-center justify-between gap-[var(--gap-tight)]">
          {title ? <h2 className="text-base font-bold text-[var(--text-primary)]">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
