/**
 * Standard index table header cell styling — sentence case, 12px bold.
 *
 * Req 1.6 of the payroll review: every detailed data table prints its headers
 * bold. One constant, so Employees, Fleet, Deliveries, Payroll and the rest
 * cannot drift apart again.
 */
export const TABLE_HEAD_CLASS =
  "text-xs font-bold normal-case tracking-normal text-muted-foreground";

/** Inline editors stay plain text until hover or focus. */
export const INLINE_EDIT_CELL_CLASS =
  "h-9 border-transparent bg-transparent shadow-none hover:border-input hover:bg-background focus-visible:border-input focus-visible:bg-background";
