"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DEFAULT_PAYROLL_CLIENTS,
  payrollClientLabel,
  type PayrollClientInput,
  type PayrollClientRow,
} from "./payroll-clients";
import {
  deletePayrollClient,
  listPayrollClients,
  upsertPayrollClient,
} from "./payroll-clients-actions";

/**
 * The client catalog, read once and kept fresh.
 *
 * `staleTime: 0` + `refetchOnMount: "always"` is deliberate: a client added in
 * Employee Settings has to appear in the Employee Client dropdown and as an
 * Attendance & Orders card without a page refresh, and the cost is one small
 * collection read when a surface opens.
 */
export function usePayrollClients() {
  return useQuery({
    queryKey: queryKeys.payroll.clients(),
    queryFn: () => listPayrollClients(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useUpsertPayrollClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PayrollClientInput) => upsertPayrollClient(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    },
  });
}

export function useDeletePayrollClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deletePayrollClient(key),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    },
  });
}

/** The catalog, or the seeded three while the read is in flight. */
export function payrollClientRows(rows: readonly PayrollClientRow[] | undefined): PayrollClientRow[] {
  return rows && rows.length > 0 ? [...rows] : [...DEFAULT_PAYROLL_CLIENTS];
}

/** `SearchableSelect` items: active clients plus whatever the rider already has. */
export function payrollClientItems(
  rows: readonly PayrollClientRow[],
  locale: string,
  current: string | null | undefined,
): { value: string; label: string }[] {
  const items = rows
    .filter((row) => row.isActive)
    .map((row) => ({ value: row.key, label: payrollClientLabel(row, locale) }));
  const key = (current ?? "").trim().toLowerCase();
  if (key && !items.some((item) => item.value === key)) {
    const known = rows.find((row) => row.key === key);
    items.unshift({
      value: key,
      label: known ? payrollClientLabel(known, locale) : key,
    });
  }
  return items;
}

/** The card shape Attendance & Orders needs. */
export function payrollClientViews(
  rows: readonly PayrollClientRow[],
): { key: string; name: string; usesHours: boolean; sortOrder: number }[] {
  return rows
    .filter((row) => row.isActive)
    .map((row) => ({
      key: row.key,
      name: row.name,
      usesHours: row.usesHours,
      sortOrder: row.sortOrder,
    }));
}
