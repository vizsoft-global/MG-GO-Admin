import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestDetailPageShell } from "@/features/requests/request-detail-page-shell";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <RequestDetailPageShell requestId={id} />;
}
