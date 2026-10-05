import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { EsignWaitingShell } from "@/features/esign/esign-waiting-shell";

/**
 * The `/employeedesk` twin of `/requests/esign/waiting`.
 *
 * Same shell, no fork: the V2 tree is an additive route tree over the V1
 * features, so both URLs are the one screen with two entry points and a bookmark
 * under either stays valid.
 *
 * Gated like every other write-capable screen in this tree —
 * `employeedesk.manage` or `requests.manage` — because the shell's list and
 * counts actions require the latter. A view-only gate here would open the page
 * onto a `not_authorized` error, which is not a read-only screen.
 */
export default async function EmployeeDeskEsignWaitingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <EsignWaitingShell />;
}
