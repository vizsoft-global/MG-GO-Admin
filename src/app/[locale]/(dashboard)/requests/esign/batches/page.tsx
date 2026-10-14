import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { parseSentScope } from "@/features/esign/esign-sent-scope";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function EsignBatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  const scope = parseSentScope(query.scope);
  redirect({
    href:
      scope === "all"
        ? "/employeedesk/esign/batches"
        : `/employeedesk/esign/batches?scope=${scope}`,
    locale,
  });
}
