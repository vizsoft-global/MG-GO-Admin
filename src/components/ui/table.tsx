"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  FROZEN_COLUMN_LIMIT,
  useFrozenColumnOffsets,
} from "@/components/ui/use-frozen-column-offsets"

type TableProps = React.ComponentProps<"table"> & {
  /**
   * Leading columns that hold their place while the rest pan sideways
   * (`globals.css` → "Frozen leading columns"). Three by default, because a
   * data table's identity — reference, name, status — lives in its first three
   * columns and an operator scrolling to a far-right figure should not lose
   * track of the row. `0` opts a table out entirely.
   */
  frozenColumns?: number
}

function Table({ className, frozenColumns = 3, ...props }: TableProps) {
  const tableRef = React.useRef<HTMLTableElement>(null)
  const frozen = Math.min(Math.max(frozenColumns, 0), FROZEN_COLUMN_LIMIT)
  useFrozenColumnOffsets(tableRef, frozen)

  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        ref={tableRef}
        data-slot="table"
        data-frozen-cols={frozen || undefined}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        // Pins the header inside whichever scroll viewport the table sits in
        // (a page list viewport, or a dialog/sheet body). The opaque card
        // background is what stops scrolling rows showing through the row.
        "sticky top-0 z-20 bg-card [&_tr]:border-b",
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-bold whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
