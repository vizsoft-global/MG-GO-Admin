"use client";

import { useQuery } from "@tanstack/react-query";
import { UpdateRequiredDialog } from "@/components/system/update-required-dialog";
import { DEV_BUILD_ID } from "@/lib/app/build-id";
import { queryKeys } from "@/lib/query/query-keys";

/** Inlined at build time — must differ from /api/build-id after a new deploy. */
const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? DEV_BUILD_ID;

const POLL_MS = 15_000;

async function fetchBuildId(): Promise<{ buildId: string }> {
  const res = await fetch(`/api/build-id?t=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`build-id ${res.status}`);
  return res.json() as Promise<{ buildId: string }>;
}

export function VersionGuard() {
  const { data, isSuccess } = useQuery({
    queryKey: queryKeys.app.buildId(),
    queryFn: fetchBuildId,
    staleTime: 0,
    refetchInterval: POLL_MS,
    // Deliberately *not* `refetchIntervalInBackground`. `/api/build-id` is
    // `force-dynamic` with `no-store`, so every poll is an uncacheable function
    // invocation, and a backgrounded tab was spending ~4/min on an answer nobody could
    // see. `refetchOnWindowFocus` already asks the same question the moment the tab is
    // looked at, so the dialog still appears exactly when it did — just not while the
    // operator is working somewhere else.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
  });

  const serverBuildId = data?.buildId?.trim() ?? "";
  const clientBuildId = CLIENT_BUILD_ID.trim();

  const updateRequired =
    process.env.NODE_ENV === "production" &&
    isSuccess &&
    Boolean(serverBuildId) &&
    Boolean(clientBuildId) &&
    serverBuildId !== clientBuildId;

  if (!updateRequired) {
    return null;
  }

  return <UpdateRequiredDialog clientBuildId={clientBuildId} serverBuildId={serverBuildId} />;
}
