import { cache } from "react";
import { makeQueryClient } from "@/lib/query/make-query-client";

let browserQueryClient: ReturnType<typeof makeQueryClient> | undefined;

/**
 * Browser singleton. On the server, returns a new client each call — prefer
 * `getServerQueryClient` in a single RSC tree for prefetch + dehydrate.
 */
export function getQueryClient(): ReturnType<typeof makeQueryClient> {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/** RSC-safe memoized factory: one client per request on the server. */
export const getServerQueryClient = cache(makeQueryClient);
