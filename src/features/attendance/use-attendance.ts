"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  correctAttendanceLog,
  fetchAttendanceForTab,
} from "./attendance-actions";
import type { AttendanceCorrectionInput, AttendanceTabFilter } from "./types";

export type AttendanceListFilters = {
  tab: AttendanceTabFilter;
  fromDate?: string;
  toDate?: string;
};

export function useAttendanceList(filters: AttendanceListFilters) {
  return useQuery({
    queryKey: queryKeys.attendance.list(filters),
    queryFn: () =>
      fetchAttendanceForTab(filters.tab, filters.fromDate, filters.toDate),
    refetchInterval: false,
  });
}

export function useCorrectAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AttendanceCorrectionInput) => correctAttendanceLog(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all() });
    },
  });
}
