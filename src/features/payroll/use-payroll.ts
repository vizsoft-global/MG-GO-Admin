"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  addPayrollClient,
  applyPayrollAdjustments,
  deletePayrollClient,
  fetchPayrollAdjustmentAudit,
  fetchPayrollMonthSnapshot,
  fetchPayrollRuleConfig,
  fetchPayrollZoneSettings,
  openPayrollRuleMonth,
  recomputePayrollZoneMetrics,
  resetPayrollClientRules,
  savePayrollClient,
  savePayrollClientRules,
  savePayrollZoneOverride,
  savePayrollZoneSettings,
} from "./payroll-actions";
import { monthKeysTouched, type PayrollPeriod } from "./payroll-formulas";
import { stitchPayrollRange } from "./payroll-snapshot";
import type { PayrollSlicers } from "./payroll-types";

export function usePayrollSnapshot(monthKey: string, slicers: PayrollSlicers) {
  return useQuery({
    queryKey: queryKeys.payroll.snapshot({ monthKey, ...slicers }),
    queryFn: () => fetchPayrollMonthSnapshot({ monthKey, slicers }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function usePayrollRangeSnapshot(period: PayrollPeriod, slicers: PayrollSlicers) {
  const monthKeys = useMemo(
    () => monthKeysTouched(period.from, period.to),
    [period.from, period.to],
  );
  return useQuery({
    queryKey: queryKeys.payroll.snapshot({ from: period.from, to: period.to, ...slicers }),
    queryFn: async () => {
      const snaps = await Promise.all(
        monthKeys.map((monthKey) => fetchPayrollMonthSnapshot({ monthKey, slicers })),
      );
      return stitchPayrollRange(snaps, period);
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    enabled: monthKeys.length > 0,
  });
}

export function usePayrollRuleConfig(monthKey: string) {
  return useQuery({
    queryKey: queryKeys.payroll.config(monthKey),
    queryFn: () => fetchPayrollRuleConfig({ monthKey }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function usePayrollAdjustmentAudit(filters: {
  from?: string | null;
  to?: string | null;
  driverId?: string | null;
}) {
  return useQuery({
    queryKey: queryKeys.payroll.adjustmentAudit(filters),
    queryFn: () =>
      fetchPayrollAdjustmentAudit({
        from: filters.from ?? null,
        to: filters.to ?? null,
        driverId: filters.driverId ?? null,
      }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Every write invalidates both the grid and the config: a rule change re-scores
 * days, and an adjustment changes the grid, so neither can be left stale.
 */
function usePayrollInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.payroll.all() });
  };
}

export function useSavePayrollClient() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: savePayrollClient,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useAddPayrollClient() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: addPayrollClient,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useSavePayrollClientRules() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: savePayrollClientRules,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useResetPayrollClientRules() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: resetPayrollClientRules,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

/**
 * Open a rule month: seeds the SOP starting rules the first time a month is
 * touched and copies the previous month's saved list afterwards. Idempotent, so
 * landing on the Settings tab can call it without a guard.
 */
export function useOpenPayrollRuleMonth() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: openPayrollRuleMonth,
    onSuccess: () => invalidate(),
  });
}

export function useRecomputePayrollZoneMetrics() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: recomputePayrollZoneMetrics,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useSavePayrollZoneOverride() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: savePayrollZoneOverride,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useSavePayrollZoneSettings() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: savePayrollZoneSettings,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function usePayrollZoneSettings(monthKey: string) {
  return useQuery({
    queryKey: queryKeys.payroll.zoneSettings(monthKey),
    queryFn: () => fetchPayrollZoneSettings({ monthKey }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useDeletePayrollClient() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: deletePayrollClient,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}

export function useApplyPayrollAdjustments() {
  const invalidate = usePayrollInvalidate();
  return useMutation({
    mutationFn: applyPayrollAdjustments,
    onSuccess: (result) => {
      if (!("error" in result)) invalidate();
    },
  });
}
