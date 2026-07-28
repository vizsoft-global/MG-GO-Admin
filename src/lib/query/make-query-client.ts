import { QueryClient } from "@tanstack/react-query";

const staleTime = 60_000;
const gcTime = 5 * 60_000;

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
