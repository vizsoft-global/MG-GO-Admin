"use client";

import * as React from "react";

/** The leading columns `globals.css` knows how to freeze. */
export const FROZEN_COLUMN_LIMIT = 4;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Publishes the cumulative start offset of each leading frozen column as
 * `--fc-1` / `--fc-2` on the `<table>`.
 *
 * `globals.css` sticks column 1 at `0`, column 2 at `--fc-1` and column 3 at
 * `--fc-2`. Measuring the rendered header cells is what makes that work for
 * every table in the panel without a single page declaring its column widths:
 * a hidden column, a resized column, a localized header or an RTL layout all
 * land on the real pixels instead of a guess.
 *
 * Measured in a layout effect, so the offsets are on the table before the first
 * paint — a frame with `--fc-1` still unset would briefly stack columns 1 and 2
 * on top of each other. The observer then only fires when a column actually
 * changes width, which is why a table of a thousand rows costs one measurement
 * rather than one per row.
 */
export function useFrozenColumnOffsets(
  tableRef: React.RefObject<HTMLTableElement | null>,
  frozen: number,
) {
  const count = Math.min(Math.max(frozen, 0), FROZEN_COLUMN_LIMIT);

  useIsomorphicLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || count < 2) return;

    const headerCells = () => {
      const row = table.tHead?.rows[0] ?? table.tBodies[0]?.rows[0];
      return row ? Array.from(row.cells).slice(0, count) : [];
    };

    const measure = () => {
      const cells = headerCells();
      if (cells.length < count) return;
      let start = 0;
      const offsets: number[] = [];
      for (const cell of cells) {
        // A spanning cell owns more than one logical column, so a positional
        // offset after it is meaningless; leave the previous offsets alone.
        if (cell.colSpan > 1) return;
        offsets.push(start);
        // Snapped to whole pixels. A sticky column parked on a fractional
        // offset paints its opaque background over part of the divider on the
        // column before it, which leaves that one line a shade lighter and
        // broken between rows while every other column rule stays crisp.
        start = Math.round(start + cell.getBoundingClientRect().width);
      }
      for (let index = 1; index < offsets.length; index += 1) {
        table.style.setProperty(`--fc-${index}`, `${offsets[index]}px`);
      }
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(table);
    for (const cell of headerCells()) observer.observe(cell);
    return () => observer.disconnect();
  }, [tableRef, count]);
}
