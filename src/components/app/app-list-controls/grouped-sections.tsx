"use client";

import type { ReactNode } from "react";
import type { GroupedRows } from "./types";

export function GroupedSections<T>({
  groups,
  children,
}: {
  groups: readonly GroupedRows<T>[];
  children: (rows: T[], group: GroupedRows<T>) => ReactNode;
}) {
  if (groups.length === 1 && groups[0]?.key === "all") {
    return <>{children(groups[0].rows, groups[0])}</>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <header className="flex items-center gap-2 px-1">
            <h3 className="text-xs font-semibold text-foreground">{group.label}</h3>
            <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {group.rows.length}
            </span>
          </header>
          {children(group.rows, group)}
        </section>
      ))}
    </div>
  );
}
