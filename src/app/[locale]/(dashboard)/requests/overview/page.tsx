import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsPageShell } from "@/features/requests/requests-page-shell";

export default async function RequestsOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { locale } = await params;
  const { type } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestsPageShell initialType={type ?? "all"} />;
}
