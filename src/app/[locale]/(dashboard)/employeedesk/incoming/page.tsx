import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";
import { parseRequestListScope } from "@/features/requests/request-list-scopes";

const SCOPES = new Set(["assigned", "forwarded", "action", "due"]);

export default async function EmployeeDeskIncomingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { locale } = await params;
  const { scope } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  if (!scope || !SCOPES.has(scope)) {
    redirect({ href: "/employeedesk?tab=incoming", locale });
  }
  return (
    <RequestsPageShell
      listScope={parseRequestListScope(scope)}
      initialDatePreset="all"
    />
  );
}
