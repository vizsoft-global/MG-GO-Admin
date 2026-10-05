import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";

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
  searchParams: Promise<{ type?: string; preset?: string }>;
}) {
  const { locale } = await params;
  const { type, preset } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestsPageShell initialType={type ?? "all"} initialDatePreset={preset} />;
}
