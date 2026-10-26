"use client";

import type { ReactNode } from "react";
import { FlatListPager, GroupHeaderBar } from "./group-list-chrome";
import type { GroupedRows } from "./types";
import { useGroupedListView } from "./use-grouped-list-view";

export function GroupedSections<T>({
  groups,
  children,
  paged = false,
  resetKey = "",
}: {
  groups: readonly GroupedRows<T>[];
  children: (rows: T[], group: GroupedRows<T>) => ReactNode;
  paged?: boolean;
  resetKey?: string;
}) {
  const grouped = !(groups.length === 1 && groups[0]?.key === "all");
  const view = useGroupedListView(groups, paged && grouped, resetKey);

  if (!paged) {
    if (!grouped) {
      const only = groups[0];
      return <>{only ? children(only.rows, only) : null}</>;
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

  if (!grouped) {
    const source = groups[0];
    const section = view.sections[0];
    if (!source || !section) return null;
    return (
      <div className="space-y-2">
        <FlatListPager pager={view.flatPager} onStep={view.stepFlat} bare />
        {children(section.visibleRows, { ...source, rows: section.visibleRows })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {view.sections.map((section) => {
        const source = groups.find((group) => group.key === section.key);
        return (
          <section key={section.key} className="space-y-2">
            <header className="px-1">
              <GroupHeaderBar
                label={section.label}
                total={section.total}
                open={section.open}
                page={section.page}
                showPager={section.showPager}
                onToggle={() => view.toggle(section.key)}
                onStep={(dir) => view.step(section.key, dir)}
              />
            </header>
            {section.open && source
              ? children(section.visibleRows, { ...source, rows: section.visibleRows })
              : null}
          </section>
        );
      })}
    </div>
  );
}
