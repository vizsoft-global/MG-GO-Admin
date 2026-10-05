import { setRequestLocale } from "next-intl/server";
import { TemplatesShell } from "@/features/employeedesk/esign/templates-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function EmployeeDeskEsignTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <TemplatesShell />;
}
