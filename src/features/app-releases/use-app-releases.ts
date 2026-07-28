"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  activateAppRelease,
  deleteAppRelease,
  fetchAppReleaseAdoption,
  fetchAppReleaseDrivers,
  listAppReleases,
  markAppReleaseRequired,
} from "./app-releases-actions";
import type { AppReleaseChannel } from "./types";

export function useAppReleasesList(channel: AppReleaseChannel) {
  return useQuery({
    queryKey: queryKeys.appReleases.list(channel),
    queryFn: async () => {
      const result = await listAppReleases(channel);
      if (!result.ok) throw new Error(result.error);
      return result.items;
    },
  });
}

export function useAppReleaseAdoption(channel: AppReleaseChannel) {
  return useQuery({
    queryKey: queryKeys.appReleases.adoption("android", channel),
    queryFn: async () => {
      const result = await fetchAppReleaseAdoption(channel);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useAppReleaseDrivers(
  channel: AppReleaseChannel,
  versionCode: number | null,
  search: string,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.appReleases.drivers("android", channel, versionCode),
      search,
      page,
    ],
    queryFn: async () => {
      const result = await fetchAppReleaseDrivers(channel, versionCode, search, page);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled,
  });
}

export function useAppReleaseMutations(channel: AppReleaseChannel) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.appReleases.all() });
  };

  const activate = useMutation({
    mutationFn: async (id: string) => {
      const result = await activateAppRelease(id);
      if (!result.ok) throw new Error(result.error);
      return result.release;
    },
    onSuccess: invalidate,
  });

  const markRequired = useMutation({
    mutationFn: async ({ id, required }: { id: string; required: boolean }) => {
      const result = await markAppReleaseRequired(id, required);
      if (!result.ok) throw new Error(result.error);
      return result.release;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteAppRelease(id);
      if (!result.ok) throw new Error(result.error);
      return result.release;
    },
    onSuccess: invalidate,
  });

  return { activate, markRequired, remove };
}
