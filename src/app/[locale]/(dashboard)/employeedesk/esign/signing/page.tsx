import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { EsignToSignInboxShell } from "@/features/esign/esign-to-sign-inbox-shell";

export default async function EmployeeDeskEsignSigningPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, [
    "esign.sign",
    "employeedesk.manage",
    "requests.manage",
  ]);
  return <EsignToSignInboxShell />;
}
