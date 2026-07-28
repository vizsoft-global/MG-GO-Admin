"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Supabase Realtime `postgres_changes` for one or more tables and
 * invalidates the given TanStack Query keys whenever a change is received.
 *
 * Used to make admin views (deliveries, zones, live tracking) auto-refresh when
 * a row is inserted/updated/deleted by another session — without polling.
 *
 * The referenced tables must be part of the `supabase_realtime` publication;
 * if a table is missing, the channel still subscribes but no events arrive.
 */
export type RealtimeTableSubscription = {
  /** Postgres table name (without schema prefix). */
  table: string;
  /** Postgres schema (defaults to `public`). */
  schema?: string;
  /** Optional `column=eq.value` filter passed to Supabase Realtime. */
  filter?: string;
  /** Event type — defaults to all changes. */
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
};

export type UseRealtimeInvalidatorOptions = {
  /** Stable channel name. Make it unique per page so multiple subscribers don't collide. */
  channel: string;
  /** Tables to watch. */
  tables: RealtimeTableSubscription[];
  /** Query keys to invalidate on any matched change. */
  invalidateKeys: QueryKey[];
  /** Set to false to pause the subscription (e.g. while a tab is hidden). */
  enabled?: boolean;
  /** Optional debounce window (ms) — coalesces rapid bursts of changes. */
  debounceMs?: number;
};

export function useRealtimeInvalidator({
  channel,
  tables,
  invalidateKeys,
  enabled = true,
  debounceMs = 300,
}: UseRealtimeInvalidatorOptions): void {
  const queryClient = useQueryClient();
  const keysRef = useRef(invalidateKeys);

  useEffect(() => {
    keysRef.current = invalidateKeys;
  }, [invalidateKeys]);

  // Serialize tables config so the effect re-runs only on shape changes,
  // not on every render that creates a new array literal.
  const tablesKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const subscriptions = JSON.parse(tablesKey) as RealtimeTableSubscription[];
    const supabase = createClient();
    const realtimeChannel = supabase.channel(channel);

    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    const triggerInvalidate = () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        for (const key of keysRef.current) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }, debounceMs);
    };

    for (const sub of subscriptions) {
      realtimeChannel.on(
        "postgres_changes",
        {
          event: sub.event ?? "*",
          schema: sub.schema ?? "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        () => {
          triggerInvalidate();
        },
      );
    }

    realtimeChannel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Surface the failure once so we know if a table is missing from the
        // publication; do not throw — the page still works with manual refresh.
        if (typeof console !== "undefined") {
          console.warn(`[realtime] channel ${channel} status: ${status}`);
        }
      }
    });

    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      void supabase.removeChannel(realtimeChannel);
    };
  }, [channel, tablesKey, enabled, debounceMs, queryClient]);
}
