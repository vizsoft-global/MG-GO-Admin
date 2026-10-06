import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function EmployeeDeskOutgoingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  redirect({ href: "/employeedesk?tab=outgoing", locale });
}
