"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchAttendanceAnalyticsSummary,
  fetchAttendanceDailyList,
  fetchAttendanceExceptionsList,
  fetchAttendanceReportingKpis,
  fetchAttendanceThresholdSettings,
  fetchDriverAttendanceDetail,
  fetchDriverAttendanceRange,
  updateAttendanceThresholdSettings,
  upsertAttendanceExceptionAction,
} from "./attendance-reporting-actions";
import type {
  AttendanceListFilters,
  AttendanceThresholdSettings,
  ExceptionResolutionStatus,
} from "./attendance-reporting-types";

export function useAttendanceDailyList(
  filters: AttendanceListFilters,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.attendance.dailyList(filters),
    queryFn: () => fetchAttendanceDailyList(filters),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useAttendanceReportingKpis(
  date: string,
  filters: Pick<AttendanceListFilters, "partnerId" | "zoneId" | "restaurantId"> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.attendance.kpis(date, filters),
    queryFn: () => fetchAttendanceReportingKpis(date, filters),
    enabled,
  });
}

export function useAttendanceExceptionsList(
  params: {
    date?: string;
    search?: string;
    unresolvedOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.attendance.exceptions(params),
    queryFn: () => fetchAttendanceExceptionsList(params),
    enabled,
  });
}

export function useAttendanceAnalytics(fromDate: string, toDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.attendance.analytics(fromDate, toDate),
    queryFn: () => fetchAttendanceAnalyticsSummary(fromDate, toDate),
    enabled,
  });
}

export function useAttendanceThresholdSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.attendance.thresholdSettings(),
    queryFn: fetchAttendanceThresholdSettings,
    enabled,
  });
}

export function useUpdateAttendanceThresholdSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AttendanceThresholdSettings) =>
      updateAttendanceThresholdSettings(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attendance.thresholdSettings(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all() });
    },
  });
}

export function useUpsertAttendanceException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      exceptionKey: string;
      driverId: string;
      exceptionType: string;
      exceptionDate: string;
      resolutionStatus: ExceptionResolutionStatus;
      action?: string;
      note?: string;
    }) => upsertAttendanceExceptionAction(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all() });
    },
  });
}

export function useDriverAttendanceDetail(
  driverId: string,
  date: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.attendance.driverDetail(driverId, date, date),
    queryFn: () => fetchDriverAttendanceDetail(driverId, date),
    enabled: enabled && Boolean(driverId),
  });
}

export function useDriverAttendanceRange(
  driverId: string,
  fromDate: string,
  toDate: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.attendance.driverDetail(driverId, fromDate, toDate),
    queryFn: () => fetchDriverAttendanceRange(driverId, fromDate, toDate),
    enabled: enabled && Boolean(driverId),
  });
}
