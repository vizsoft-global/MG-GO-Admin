"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchPayrollMonthSnapshot } from "./payroll-actions";
import type { PayrollSlicers } from "./payroll-types";

export function usePayrollSnapshot(monthKey: string, slicers: PayrollSlicers) {
  return useQuery({
    queryKey: queryKeys.payroll.snapshot({ monthKey, ...slicers }),
    queryFn: () => fetchPayrollMonthSnapshot({ monthKey, slicers }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
