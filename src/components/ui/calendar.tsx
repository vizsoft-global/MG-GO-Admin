"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3", className)}
      classNames={{
        months: "flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold",
        nav: "absolute inset-x-3 top-3 z-10 flex h-8 items-center justify-between",
        button_previous:
          "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        button_next:
          "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 text-center text-[11px] font-medium text-muted-foreground",
        week: "mt-1 flex",
        day: cn(
          "relative h-8 w-8 p-0 text-center text-sm",
          "[&.rdp-range_middle]:bg-primary/10 [&.rdp-range_middle]:first:rounded-s-md [&.rdp-range_middle]:last:rounded-e-md",
        ),
        day_button:
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-sm tabular-nums transition-colors hover:bg-muted aria-selected:hover:bg-primary",
        range_start:
          "rounded-s-md bg-primary/10 [&>button]:bg-primary [&>button]:text-primary-foreground",
        range_end:
          "rounded-e-md bg-primary/10 [&>button]:bg-primary [&>button]:text-primary-foreground",
        range_middle: "rdp-range_middle [&>button]:hover:bg-primary/15",
        selected: "[&>button]:font-semibold",
        today: "[&>button]:font-bold [&>button]:text-primary",
        outside: "text-muted-foreground/50 [&>button]:text-muted-foreground/50",
        disabled: "opacity-40 [&>button]:cursor-default",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4 rtl:rotate-180" {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
