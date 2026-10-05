import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { EsignWaitingShell } from "@/features/esign/esign-waiting-shell";

/**
 * EmployeeDesk → To sign.
 *
 * "What still has to be signed" is a narrower question than "who is holding my
 * document", so this opens the waiting shell on **Not opened**: a document the
 * rider has not seen is the one a reminder cannot reach, which is why this door
 * exists beside the Waiting one rather than instead of it. It is the same shell
 * — a fork is the only way the two lists can disagree.
 *
 * Gated `employeedesk.manage` / `requests.manage` for the same reason as the
 * Waiting twin: the shell's list and count actions are write-gated, so a
 * view-only gate would open onto a `not_authorized` error.
 */
export default async function EmployeeDeskEsignSigningPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <EsignWaitingShell initialTab="not_opened" />;
}
