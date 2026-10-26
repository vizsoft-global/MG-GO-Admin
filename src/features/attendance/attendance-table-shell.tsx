"use client";

"use client";

import type { ReactNode } from "react";

export function AttendanceTableShell({
  toolbar,
  kpis,
  children,
  footer,
  empty,
  isEmpty,
}: {
  toolbar: ReactNode;
  kpis?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  isEmpty?: boolean;
}) {
  return (
    <div className="space-y-4">
      {kpis}
      {toolbar}
      {isEmpty ? empty : children}
      {!isEmpty ? footer : null}
    </div>
  );
}
