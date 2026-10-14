import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function EmployeeDeskEsignSentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  redirect({ href: "/employeedesk/esign/batches?scope=individual", locale });
}
