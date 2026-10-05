import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestDetailPageShell } from "@/features/requests/request-detail-page-shell";

/**
 * EmployeeDesk → request detail.
 *
 * The static segments above (`all`, `incoming`, `outgoing`, `esign`, `visits`,
 * `reports`, `settings`) take precedence over this dynamic one, so `[id]` only
 * ever receives a real uuid — the same shell as `/requests/[id]`.
 */
export default async function EmployeeDeskRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestDetailPageShell requestId={id} />;
}
