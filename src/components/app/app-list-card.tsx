import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AppListCard({
  title,
  description,
  headerActions,
  toolbar,
  filterChips,
  children,
  className,
}: {
  /** Omit when page title is already in AppPageHeader above the card */
  title?: string;
  description?: string;
  headerActions?: ReactNode;
  toolbar?: ReactNode;
  filterChips?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-xl border-border bg-card shadow-sm",
        className,
      )}
    >
      {(title || headerActions || toolbar || filterChips) ? (
        <div className="border-b border-border px-4 py-4">
          {(title || headerActions) ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {title ? (
                <div className="min-w-0">
                  <h2 className="text-base font-semibold tracking-tight text-foreground">
                    {title}
                  </h2>
                  {description ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {description}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex-1" />
              )}
              {headerActions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {headerActions}
                </div>
              ) : null}
            </div>
          ) : null}
          {toolbar ? <div className={title || headerActions ? "mt-4" : ""}>{toolbar}</div> : null}
          {filterChips ? (
            <div className="mt-3 flex flex-wrap gap-2">{filterChips}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
