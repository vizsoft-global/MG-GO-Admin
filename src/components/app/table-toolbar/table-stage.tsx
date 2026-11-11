"use client";

import type { ReactNode } from "react";

/**
 * Fixed top band of a list card. The toolbar lives above the table's scroll
 * viewport on purpose: panning the columns sideways must not drag the filters,
 * search, pager or actions with it, and a toolbar sharing the scroller left a
 * bare strip beside it once the table was scrolled.
 */
export function TableStage({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <div
        data-table-toolbar=""
        className="overflow-x-auto border-b border-[var(--border-default)] bg-card"
      >
        {toolbar}
      </div>
      {children}
    </div>
  );
}
