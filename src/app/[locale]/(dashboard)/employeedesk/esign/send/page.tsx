import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * The create-from-template screen lives at `/employeedesk/esign/templates/new`.
 * This path stays so hub tiles and saved links still open that screen.
 */
export default async function EmployeeDeskEsignSendPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);

  const parts: string[] = [];
  for (const key of ["template", "draft", "category", "driver", "resentFrom"] as const) {
    const value = query[key];
    if (typeof value === "string" && value) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  const href =
    parts.length > 0
      ? `/employeedesk/esign/templates/new?${parts.join("&")}`
      : "/employeedesk/esign/templates/new";
  redirect({ href, locale });
}
