import { setRequestLocale } from "next-intl/server";
import { EsignSentShell } from "@/features/esign/esign-sent-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function EmployeeDeskEsignSentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <EsignSentShell />;
}
