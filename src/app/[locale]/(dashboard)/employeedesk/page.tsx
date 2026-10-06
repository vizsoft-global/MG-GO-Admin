import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { RcmV2HubShell } from "@/features/employeedesk/rcm-v2-hub-shell";

export default async function EmployeeDeskHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.view", "requests.view"]);
  return <RcmV2HubShell />;
}
