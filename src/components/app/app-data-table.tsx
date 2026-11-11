import type { ComponentProps, ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TableStage } from "./table-toolbar/table-stage";
import { AppTableScrollRail } from "./app-table-scroll-rail";
import { TABLE_HEAD_CLASS } from "./constants";

/**
 * Height of the sticky table viewport.
 *
 * One viewport tall, less only the shell's 12px bottom gutter
 * (`LAYOUT.commandPageInset`), so a docked table reaches the bottom of the
 * screen instead of stopping at a fixed pixel ceiling and leaving dead space
 * under the last row. The floor keeps short viewports (landscape tablet, a
 * phone with the keyboard open) from collapsing the table into a few rows.
 *
 * The card that hosts the table drops its own 16px bottom padding
 * (`[data-slot="card"]:has([data-table-scroll])` in `globals.css`), which is
 * what makes the geometry exact: the page can scroll no further than the point
 * where this viewport's top edge reaches the top of `<main>`, so the header row
 * is never clipped and no dead band appears under the last row.
 */
const VIEWPORT_FILL =
  "sticky top-0 z-20 h-[calc(100dvh-0.75rem)] min-h-[320px] overflow-auto";

export function AppDataTable({
  columns,
  children,
  empty,
  footer,
  className,
  headerRowClassName,
  stickyHeader = false,
  toolbar,
}: {
  columns: { id: string; label: ReactNode; className?: string }[];
  children: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerRowClassName?: string;
  /** Keep the header row visible inside this table's own scroller. */
  stickyHeader?: boolean;
  /** Shared toolbar. Sits above the table and never scrolls with it. */
  toolbar?: ReactNode;
}) {
  const sticky = stickyHeader || Boolean(toolbar);
  const surface = (
    <>
      <Table>
        <TableHeader
          className={sticky ? "sticky top-0 z-20 bg-card shadow-sm" : undefined}
        >
          <TableRow
            className={cn(
              toolbar ? "bg-card hover:bg-card" : "bg-muted/30 hover:bg-muted/30",
              stickyHeader && "bg-card hover:bg-card",
              headerRowClassName,
            )}
          >
            {columns.map((col) => (
              <TableHead
                key={col.id}
                className={cn(TABLE_HEAD_CLASS, stickyHeader && "bg-card", col.className)}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
      {empty}
      {footer}
    </>
  );

  if (!toolbar) {
    return (
      <div
        data-table-scroll=""
        className={cn(
          sticky
            ? `${VIEWPORT_FILL} [&_[data-slot=table-container]]:overflow-visible`
            : "overflow-x-auto",
          className,
        )}
      >
        <AppTableScrollRail />
        {surface}
      </div>
    );
  }

  /**
   * The toolbar is a sibling of the scroll viewport, not a child of it: panning
   * the columns sideways must never drag the filters, search, pager or actions
   * out of view, and a toolbar inside the scroller also left a bare strip to its
   * right once the table was scrolled.
   *
   * The viewport is also the page's scroll target. Page chrome (header, KPI
   * cards, toolbar, rail) keeps its normal flow and scrolls away; once it has,
   * this container pins to the top of `<main>` at viewport height and owns both
   * axes from there, so the header row and the rows below it stay on screen
   * instead of being cut off by a fixed 640px ceiling.
   */
  return (
    <div className={cn("flex flex-col", className)}>
      <TableStage toolbar={toolbar} />
      <AppTableScrollRail />
      <div
        data-table-scroll=""
        className={cn(VIEWPORT_FILL, "[&_[data-slot=table-container]]:overflow-visible")}
      >
        {surface}
      </div>
    </div>
  );
}

export function AppDataTableEmpty({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-t border-border px-4 py-12 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AppDataTableRow({
  children,
  onClick,
  className,
  ...props
}: ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      className={cn(
        onClick && "cursor-pointer hover:bg-muted/40",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </TableRow>
  );
}

export { TableCell };
