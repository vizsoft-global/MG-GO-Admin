import { QueryClient } from "@tanstack/react-query";

/**
 * Panel query defaults.
 *
 * `staleTime` used to be 60s, which meant every mounted screen re-read its
 * Cloud Function on the minute even when the operator had not touched it — the
 * panel's share of the Firestore bill was mostly this echo. Five minutes matches
 * the server-side config cache TTL, so a screen that is merely re-rendered does
 * not ask the backend for data it already has. Screens that genuinely need live
 * data set their own `refetchInterval`.
 */
const staleTime = 5 * 60_000;
const gcTime = 30 * 60_000;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime,
        gcTime,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status =
            typeof error === "object" && error && "status" in error
              ? Number((error as { status?: number }).status)
              : undefined;
          if (status && (status === 401 || status === 403 || status === 404)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
