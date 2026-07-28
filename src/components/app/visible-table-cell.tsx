"use client";

import type { ComponentProps } from "react";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function VisibleTableCell({
  columnId,
  isVisible,
  className,
  children,
  ...props
}: {
  columnId: string;
  isVisible: (id: string) => boolean;
} & ComponentProps<typeof TableCell>) {
  if (!isVisible(columnId)) return null;
  return (
    <TableCell className={cn(className)} {...props}>
      {children}
    </TableCell>
  );
}
