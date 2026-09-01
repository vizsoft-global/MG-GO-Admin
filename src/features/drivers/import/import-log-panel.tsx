"use client";

import { useEffect, useRef } from "react";
import {
  formatImportLogLine,
  type DriverImportLogEvent,
} from "./import-progress";

export function ImportLogPanel({
  events,
  progressLabel,
  title,
  waitingLabel,
}: {
  events: readonly DriverImportLogEvent[];
  progressLabel: string;
  title: string;
  waitingLabel: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {progressLabel}
        </p>
      </div>
      <div
        className="h-40 overflow-auto rounded-lg border border-border bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-5"
        role="log"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <p className="text-muted-foreground">{waitingLabel}</p>
        ) : (
          events.map((event, index) => (
            <p
              key={`${event.at}-${event.rowIndex}-${event.kind}-${index}`}
              className={
                event.kind === "failed"
                  ? "text-destructive"
                  : event.kind === "skipped"
                    ? "text-muted-foreground"
                    : "text-foreground"
              }
            >
              {formatImportLogLine(event)}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
