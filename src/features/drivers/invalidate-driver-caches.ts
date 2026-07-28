import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";

export type InvalidateDriverCachesInput = {
  /** Intake row id — used for documents cache and detail when the route uses intake id. */
  intakeId?: string | null;
  profileId?: string | null;
  /** Current driver detail route param — always invalidate this key when provided. */
  detailId?: string | null;
};

/** Await invalidation so list/detail/documents refetch before UI reads stale cache. */
export async function invalidateDriverCaches(
  queryClient: QueryClient,
  input: InvalidateDriverCachesInput = {},
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.all() });

  const detailIds = [
    ...new Set(
      [input.detailId, input.intakeId, input.profileId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  await Promise.all(
    detailIds.map((detailId) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.drivers.detail(detailId) }),
    ),
  );

  if (input.intakeId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.drivers.documents(input.intakeId, input.profileId ?? null),
    });
  }

  await queryClient.invalidateQueries({ queryKey: queryKeys.documentExpiry.all() });
}
