import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";
import { parseRequestListScope } from "@/features/requests/request-list-scopes";

/**
 * EmployeeDesk → All requests.
 *
 * A re-export, not a fork: this renders the same `RequestsPageShell` as
 * `/requests/overview` so no feature can drift between the V1 route and the V2
 * one. The only difference is which door the operator came through.
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
  return (
    <RequestsPageShell
      initialType={type ?? "all"}
      initialDatePreset={preset}
      listScope={parseRequestListScope(scope) ?? "all"}
      scopeTabs
    />
  );
}
