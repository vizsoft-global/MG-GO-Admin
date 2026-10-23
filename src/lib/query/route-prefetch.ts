import type { QueryClient } from "@tanstack/react-query";

/**
 * Hover prefetch for one known list. The import stays dynamic because the
 * sidebar mounts on every page and must not pull the order-exceptions module
 * into that bundle. Payroll is deliberately absent: hovering it would start
 * a month scan the operator may never open.
 */
export function prefetchAdminRoute(client: QueryClient, href: string): void {
  const path = href.split("?")[0] ?? "";
  if (!path.endsWith("/order-exceptions")) return;
  void prefetchOrderExceptions(client);
}

async function prefetchOrderExceptions(client: QueryClient): Promise<void> {
  const [{ listOrderExceptions }, { ORDER_EXCEPTION_FIRST_PAGE }, { orderExceptionKeys }] =
    await Promise.all([
      import("@/features/order-exceptions/order-exceptions-actions"),
      import("@/features/order-exceptions/types"),
      import("@/features/order-exceptions/use-order-exceptions"),
    ]);
  await client.prefetchQuery({
    queryKey: orderExceptionKeys.list(ORDER_EXCEPTION_FIRST_PAGE),
    queryFn: async () => {
      const result = await listOrderExceptions(ORDER_EXCEPTION_FIRST_PAGE);
      if (result.error || result.data === null) throw new Error(result.error ?? "unknown");
      return result.data;
    },
    staleTime: 20_000,
  });
}
