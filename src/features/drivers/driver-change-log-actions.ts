"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  DRIVER_CHANGE_SOURCES,
  type DriverChangeEntry,
  type DriverChangeSource,
} from "./driver-change-log-shared";

export type DriverChangeEventRow = {
  id: string;
  created_at: string;
  intake_id: string;
  driver_id: string | null;
  actor_id: string;
  actor_name: string;
  source: DriverChangeSource;
  changes: DriverChangeEntry[];
  context: Record<string, unknown>;
};

const PAGE_SIZE = 30;

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function parseChanges(value: unknown): DriverChangeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.field !== "string") return [];
    return [
      {
        field: row.field,
        before: row.before == null ? null : String(row.before),
        after: row.after == null ? null : String(row.after),
      },
    ];
  });
}

export async function listDriverChangeEvents(input: {
  intakeId: string;
  source?: DriverChangeSource | "all";
  cursor?: string | null;
}): Promise<
  | { rows: DriverChangeEventRow[]; nextCursor: string | null }
  | { error: "not_authorized" | "load_failed" }
> {
  const auth = await requireDriversView();
  if ("error" in auth) return { error: "not_authorized" };
  if (!input.intakeId) return { rows: [], nextCursor: null };

  const supabase = await createClient();
  let query = supabase
    .from("driver_change_events")
    .select(
      "id, created_at, intake_id, driver_id, actor_id, actor_name, source, changes, context",
    )
    .eq("intake_id", input.intakeId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (input.source && input.source !== "all") {
    query = query.eq("source", input.source);
  }
  if (input.cursor) {
    query = query.lt("created_at", input.cursor);
  }

  const { data, error } = await query;
  if (error) return { error: "load_failed" };

  const page = (data ?? []).slice(0, PAGE_SIZE);
  const extra = (data ?? []).length > PAGE_SIZE;
  const rows: DriverChangeEventRow[] = page.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    intake_id: row.intake_id,
    driver_id: row.driver_id,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    source: DRIVER_CHANGE_SOURCES.includes(row.source as DriverChangeSource)
      ? (row.source as DriverChangeSource)
      : "edit",
    changes: parseChanges(row.changes),
    context:
      row.context && typeof row.context === "object" && !Array.isArray(row.context)
        ? (row.context as Record<string, unknown>)
        : {},
  }));

  return {
    rows,
    nextCursor: extra ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}
