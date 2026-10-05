import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";

/**
 * EmployeeDesk → Incoming.
 *
 * `submitted` is the queue of requests the riders have filed and nobody has
 * decided yet. It is the same shell as All requests; the seeded status is what
 * makes this a door rather than a second name for one screen.
 */
export default async function EmployeeDeskIncomingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestsPageShell initialStatus="submitted" />;
}
