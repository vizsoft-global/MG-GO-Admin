/**
 * Merges the Phase 3 telemetry feed with the read-only Phase 1 operation feed
 * into one descending technical timeline:
 *
 *   09:13  Order delivered        (operation, Phase 1)
 *   09:12  Offline queue flushed  (telemetry)
 *   09:05  Offline queue created  (telemetry)
 *
 * Pure and structurally typed on purpose: it must be unit-testable without
 * importing either server action module, and it must not change any Phase 1
 * shape or signature.
 */

export type TimelineTelemetryRow = { id: string; clientTs: string };
export type TimelineOperationRow = { id: string; occurredAt: string };

export type MergedTimelineEntry<
  T extends TimelineTelemetryRow,
  O extends TimelineOperationRow,
> =
  | { kind: "telemetry"; key: string; at: string; telemetry: T }
  | { kind: "operation"; key: string; at: string; operation: O };

export function mergeTelemetryWithOperations<
  T extends TimelineTelemetryRow,
  O extends TimelineOperationRow,
>(
  telemetry: T[],
  operations: O[],
  options: { includeOperations?: boolean; limit?: number } = {},
): MergedTimelineEntry<T, O>[] {
  const entries: MergedTimelineEntry<T, O>[] = telemetry.map((row) => ({
    kind: "telemetry" as const,
    key: `t:${row.id}`,
    at: row.clientTs,
    telemetry: row,
  }));

  // Off by default and only ever enabled for a single driver: a merged feed
  // across the whole fleet would interleave unrelated riders and read as noise.
  if (options.includeOperations) {
    for (const row of operations) {
      entries.push({
        kind: "operation" as const,
        key: `o:${row.id}`,
        at: row.occurredAt,
        operation: row,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.at === b.at) {
      // Stable, deterministic tie-break so a rerender cannot reorder two events
      // that share a timestamp.
      return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
    }
    return a.at < b.at ? 1 : -1;
  });

  return options.limit != null ? entries.slice(0, options.limit) : entries;
}
