import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseRequestDatePreset } from "@/features/requests/date-presets";
import { isRcmQueueType, queueScopeFromParam } from "@/features/requests/rcm-type-queue-columns";
import { RcmTypeQueueShell } from "@/features/requests/rcm-type-queue-shell";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";
import { parseRequestListScope } from "@/features/requests/request-list-scopes";

/**
 * EmployeeDesk → All requests.
 *
 * `type=all` (and any type the per-type queue does not column) keeps
 * `RequestsPageShell`. A specific system type renders `RcmTypeQueueShell`.
 */
export default async function EmployeeDeskAllPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string; preset?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { type, preset, scope } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  if (isRcmQueueType(type)) {
    return (
      <RcmTypeQueueShell
        type={type}
        initialScope={queueScopeFromParam(scope)}
        initialDatePreset={parseRequestDatePreset(preset)}
        initialDueToday={parseRequestListScope(scope) === "due"}
      />
    );
  }
  return (
    <RequestsPageShell
      initialType={type ?? "all"}
      initialDatePreset={preset}
      listScope={parseRequestListScope(scope) ?? "all"}
      scopeTabs
    />
  );
}
