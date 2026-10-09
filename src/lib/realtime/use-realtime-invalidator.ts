"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Polls on a fixed interval and invalidates the given TanStack Query keys.
 *
 * There is no live row stream. The same keys a change listener used to refresh
 * are invalidated every 20s instead, so list pages still pick up inserts and
 * edits from another session. `onChange` fires on every tick so a paused feed
 * can count new rows without waiting for the visible query to refetch.
 */
export type RealtimeTableSubscription = {
  /** Collection name (former table, without schema prefix). */
  table: string;
  /** Kept so existing call sites compile; unused by the poller. */
  schema?: string;
  /** Kept so existing call sites compile; unused by the poller. */
  filter?: string;
  /** Event type — defaults to all changes. Unused by the poller. */
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
};

export type UseRealtimeInvalidatorOptions = {
  /** Stable channel name. Make it unique per page so multiple subscribers don't collide. */
  channel: string;
  /** Tables that used to be watched. Shape is kept for call-site compatibility. */
  tables: RealtimeTableSubscription[];
  /** Query keys to invalidate on any matched change. */
  invalidateKeys: QueryKey[];
  /** Set to false to pause the subscription (e.g. while a tab is hidden). */
  enabled?: boolean;
  /** Optional debounce window (ms) — unused by the poller; kept for call sites. */
  debounceMs?: number;
  /**
   * Fires once per poll tick. Debouncing is a refetch concern; a caller
   * counting events (e.g. an "N new events" pill) must see every tick.
   */
  onChange?: () => void;
};

const POLL_MS = 20_000;

export function useRealtimeInvalidator({
  channel,
  tables,
  invalidateKeys,
  enabled = true,
  debounceMs = 300,
  onChange,
}: UseRealtimeInvalidatorOptions): void {
  const queryClient = useQueryClient();
  const keysRef = useRef(invalidateKeys);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    keysRef.current = invalidateKeys;
  }, [invalidateKeys]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const tablesKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    void channel;
    void debounceMs;
    void tablesKey;

    const tick = () => {
      for (const key of keysRef.current) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onChangeRef.current?.();
    };

    const handle = setInterval(tick, POLL_MS);
    return () => {
      clearInterval(handle);
    };
  }, [channel, tablesKey, enabled, debounceMs, queryClient]);
}
