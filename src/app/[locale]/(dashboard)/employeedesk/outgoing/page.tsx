import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";

/**
 * EmployeeDesk → Outgoing.
 *
 * `responded` is the other direction: staff answered the rider and the request
 * is back on its way to them. Paired with Incoming it is the two halves of the
 * desk's traffic, and neither is a copy of All requests.
 */
export default async function EmployeeDeskOutgoingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestsPageShell initialStatus="responded" />;
}
