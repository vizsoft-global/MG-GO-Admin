export type CompiledAudience = {
  snapshotId: string | null;
  recipientIds: string[] | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return ids;
}

function snapshotIdOf(record: Record<string, unknown>): string | null {
  for (const key of ["snapshot_id", "snapshotId", "id"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value !== "[object Object]") return value;
  }
  return null;
}

export function recipientIdsFromCompile(data: unknown): CompiledAudience {
  if (typeof data === "string" && data.length > 0 && data !== "[object Object]") {
    return { snapshotId: data, recipientIds: null };
  }
  const listed = stringList(data);
  if (listed) return { snapshotId: null, recipientIds: listed };

  const record = asRecord(data);
  if (!record) return { snapshotId: null, recipientIds: null };

  const nested = asRecord(record["data"]) ?? asRecord(record["result"]);
  const source = nested ?? record;
  const ids = stringList(source["recipient_ids"]) ?? stringList(source["recipientIds"]);
  return { snapshotId: snapshotIdOf(source) ?? snapshotIdOf(record), recipientIds: ids };
}
